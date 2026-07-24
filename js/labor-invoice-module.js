// ════════════════════════════════════════════════════════════
// LABOR INVOICE MODULE (Admin)
// Generates, manages, and prints labor invoices from weekly
// bill entries recorded in the Labor Module (pm-admin.js).
// Mirrors the layout and billing workflow of invoice-module.js.
// ════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── State ──────────────────────────────────────────────────────────
    let _laborInvoices = [];
    let _loading       = false;
    let _ownerUid      = null;
    let _defaults      = {};   // cached from settings/invoiceDefaults (shared with material invoices)
    let _editId        = null; // null = new invoice
    let _projects      = [];   // constructionProjects for the project picker
    let _weeklyEntries = [];   // weeklyBills for the selected project

    // ── Collection name ────────────────────────────────────────────────
    const COLLECTION = 'laborInvoices';

    // ══════════════════════════════════════════════════════
    // PUBLIC ENTRY POINT
    // ══════════════════════════════════════════════════════

    window.initLaborInvoiceModule = function () {
        if (_loading) return;
        const main = document.querySelector('.main-content') || document.documentElement;
        if (main) main.scrollTop = 0;
        if (_laborInvoices.length > 0 || _ownerUid) {
            _renderList();
            return;
        }
        _boot();
    };

    // Called from pm-admin.js when the user clicks Invoice on a weekly row.
    // Opens a pre-filled new labor invoice form for that single entry.
    window._labInvPreFill = async function (proj, entry) {
        if (!_ownerUid) await _resolveOwnerUid();
        if (!_defaults || !Object.keys(_defaults).length) await _loadDefaults();
        if (!_projects.length) await _loadProjects();

        // Load weekly entries for this project so the checklist renders
        await _loadWeeklyEntries(proj.id);

        // Render a new form with the project pre-selected and this entry's id pre-checked
        const inv = {
            constructionProjectId: proj.id,
            linkedWeeklyIds:       [entry.id],
            clientName:            proj.clientName  || '',
            clientAddress:         proj.address     || '',
            date:                  _todayStr(),
            // Pre-build the single line item from this entry
            items: [{
                description: `Labor — Week Ending ${entry.weekEndingDate
                    ? new Date(entry.weekEndingDate + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '—'}`,
                qty:       1,
                unitPrice: entry.grandTotal || 0,
                discount:  0,
                amount:    entry.grandTotal || 0
            }]
        };
        await _renderForm(inv);
        // Auto-generate invoice number
        _generateLaborInvoiceNo().then(no => {
            const el = document.getElementById('labInvNo');
            if (el) { el.value = no; el.removeAttribute('readonly'); }
        });
    };

    async function _boot() {
        await _resolveOwnerUid();
        _loadDefaults();
        await _loadProjects();
        _loadLaborInvoices();
    }

    // ══════════════════════════════════════════════════════
    // OWNER UID
    // ══════════════════════════════════════════════════════

    async function _resolveOwnerUid() {
        const user = firebase.auth().currentUser;
        if (!user) { _ownerUid = null; return; }
        try {
            const doc = await db.collection('users').doc(user.uid).get();
            if (doc.exists) {
                const data = doc.data();
                _ownerUid = (data.role === 'staff' && data.ownerUid) ? data.ownerUid : user.uid;
            } else {
                _ownerUid = user.uid;
            }
        } catch (e) {
            _ownerUid = (firebase.auth().currentUser || {}).uid || null;
        }
    }

    // ══════════════════════════════════════════════════════
    // BUSINESS DEFAULTS (shared with material invoice)
    // ══════════════════════════════════════════════════════

    async function _loadDefaults() {
        try {
            const doc = await db.collection('settings').doc('invoiceDefaults').get();
            if (doc.exists) _defaults = doc.data() || {};
        } catch (e) { /* non-critical */ }
    }

    // ══════════════════════════════════════════════════════
    // LOAD CONSTRUCTION PROJECTS (for project picker)
    // ══════════════════════════════════════════════════════

    async function _loadProjects() {
        try {
            const snap = await db.collection('constructionProjects').orderBy('clientName').get();
            _projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            _projects = [];
        }
    }

    // ══════════════════════════════════════════════════════
    // LOAD WEEKLY BILLS for a given projectId
    // ══════════════════════════════════════════════════════

    async function _loadWeeklyEntries(projectId) {
        if (!projectId) { _weeklyEntries = []; return; }
        try {
            const snap = await db.collection('constructionProjects')
                .doc(projectId)
                .collection('weeklyBills')
                .orderBy('weekEndingDate', 'desc')
                .get();
            _weeklyEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            _weeklyEntries = [];
        }
    }

    // ══════════════════════════════════════════════════════
    // DATA — Load labor invoices
    // ══════════════════════════════════════════════════════

    async function _loadLaborInvoices() {
        _loading = true;
        _showLoading(true);
        try {
            const snap = await db.collection(COLLECTION)
                .where('userId', '==', _ownerUid)
                .get();
            _laborInvoices = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));
        } catch (e) {
            console.error('LaborInvoiceModule: load error', e);
            _laborInvoices = [];
            const el = document.getElementById('labInvLoading');
            if (el) el.innerHTML = `<p style="color:#b91c1c;font-weight:600;">Could not load labor invoices.</p>
                <p style="font-size:12px;color:#6b7280;">${_esc(e.message)}</p>`;
            _loading = false;
            return;
        }
        _loading = false;
        _showLoading(false);
        _renderList();
    }

    // ══════════════════════════════════════════════════════
    // LIST VIEW
    // ══════════════════════════════════════════════════════

    const _expandedGroups = new Set();

    document.addEventListener('click', function (e) {
        const row = e.target.closest('.labinv-group-toggle');
        if (!row) return;
        const key = row.getAttribute('data-group-key');
        if (!key) return;
        if (_expandedGroups.has(key)) _expandedGroups.delete(key);
        else _expandedGroups.add(key);
        _renderList();
    });

    function _invoiceRow(inv) {
        return `
        <tr>
            <td><span class="inv-no">${_esc(inv.invoiceNo || '—')}</span></td>
            <td style="white-space:nowrap;">${inv.date ? _fmtDate(inv.date) : '—'}</td>
            <td class="inv-amt">${_fmt(inv.totalAmount || 0)}</td>
            <td>${_esc(inv.clientName || '—')}</td>
            <td style="font-family:monospace;font-size:12px;">${_esc(inv.clientTin || '—')}</td>
            <td class="inv-addr">${_esc(inv.clientAddress || '—')}</td>
            <td><span class="inv-status inv-status--${inv.status || 'draft'}">${inv.status === 'issued' ? 'Issued' : 'Draft'}</span></td>
            <td>
                <div class="inv-actions">
                    <button class="inv-action-btn" title="Print Preview" onclick="window.labInvPreview('${inv.id}')">
                        <i data-lucide="eye" style="width:14px;height:14px;"></i>
                    </button>
                    <button class="inv-action-btn" title="Print" onclick="window.labInvPrint('${inv.id}')">
                        <i data-lucide="printer" style="width:14px;height:14px;"></i>
                    </button>
                    <button class="inv-action-btn" title="Edit" onclick="window.labInvShowForm('${inv.id}')">
                        <i data-lucide="pencil" style="width:14px;height:14px;"></i>
                    </button>
                    <button class="inv-action-btn inv-action-btn--danger" title="Delete" onclick="window.labInvDelete('${inv.id}')">
                        <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }

    function _renderList() {
        _editId = null;
        const startOfMonth = new Date();
        startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

        let totalAmt = 0, monthAmt = 0, issuedCount = 0;
        _laborInvoices.forEach(inv => {
            const amt = inv.totalAmount || 0;
            totalAmt   += amt;
            issuedCount += inv.status === 'issued' ? 1 : 0;
            if (_tsToMs(inv.createdAt) >= startOfMonth.getTime()) monthAmt += amt;
        });

        // Group by clientName
        const groups = {};
        _laborInvoices.forEach(inv => {
            const key = (inv.clientName || '—').trim();
            if (!groups[key]) groups[key] = [];
            groups[key].push(inv);
        });

        let rows = '';
        if (_laborInvoices.length === 0) {
            rows = `<tr><td colspan="8" class="inv-empty">No labor invoices yet. Click <strong>New Labor Invoice</strong> to create one.</td></tr>`;
        } else {
            Object.entries(groups).forEach(([clientName, invList]) => {
                if (invList.length === 1) {
                    rows += _invoiceRow(invList[0]);
                } else {
                    const key      = _esc(clientName);
                    const expanded = _expandedGroups.has(clientName);
                    const groupTotal = invList.reduce((s, i) => s + (i.totalAmount || 0), 0);
                    const chevron  = expanded
                        ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`
                        : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
                    rows += `
                    <tr class="inv-group-row labinv-group-toggle" data-group-key="${key}" style="cursor:pointer;">
                        <td colspan="2">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="color:#059669;">${chevron}</span>
                                <span style="font-weight:700;color:#111827;">${key}</span>
                                <span class="inv-group-badge">${invList.length} invoices</span>
                            </div>
                        </td>
                        <td class="inv-amt" style="font-weight:700;">${_fmt(groupTotal)}</td>
                        <td colspan="5" style="color:#6b7280;font-size:12px;">${expanded ? 'Click to collapse' : 'Click to view invoices'}</td>
                    </tr>`;
                    if (expanded) {
                        invList.forEach(inv => { rows += _invoiceRow(inv); });
                    }
                }
            });
        }

        _setContent(`
        <div style="display:flex;justify-content:flex-end;margin-bottom:1rem;gap:8px;">
            <button class="inv-btn inv-btn-outline" onclick="window.labInvExportCSV()">
                <i data-lucide="download" style="width:15px;height:15px;"></i> Export CSV
            </button>
            <button class="inv-btn inv-btn-ghost" onclick="window.invOpenSettings()">
                <i data-lucide="settings" style="width:15px;height:15px;"></i> Business Settings
            </button>
            <button class="inv-btn inv-btn-primary" onclick="window.labInvShowForm(null)">
                <i data-lucide="plus" style="width:15px;height:15px;"></i> New Labor Invoice
            </button>
        </div>

        <div class="inv-stats-grid">
            <div class="inv-stat-card">
                <div class="inv-stat-label">Total Invoices</div>
                <div class="inv-stat-value">${_laborInvoices.length}</div>
                <div class="inv-stat-sub">All records</div>
            </div>
            <div class="inv-stat-card">
                <div class="inv-stat-label">Total Billed</div>
                <div class="inv-stat-value">${_fmt(totalAmt)}</div>
                <div class="inv-stat-sub">Lifetime</div>
            </div>
            <div class="inv-stat-card">
                <div class="inv-stat-label">This Month</div>
                <div class="inv-stat-value">${_fmt(monthAmt)}</div>
                <div class="inv-stat-sub">Current billing period</div>
            </div>
            <div class="inv-stat-card">
                <div class="inv-stat-label">Issued</div>
                <div class="inv-stat-value">${issuedCount}</div>
                <div class="inv-stat-sub">Finalized invoices</div>
            </div>
        </div>

        <div class="inv-table-card">
            <div class="inv-table-header">
                <div class="inv-table-title">Labor Invoice Listing</div>
                <div class="inv-total-badge">Total: <strong>${_laborInvoices.length}</strong></div>
            </div>
            <div class="inv-table-wrap">
                <table class="inv-table">
                    <thead>
                        <tr>
                            <th>Invoice No.</th>
                            <th>Invoice Date</th>
                            <th>Total Amount</th>
                            <th>Client Name</th>
                            <th>TIN No.</th>
                            <th>Business Address</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`);

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ══════════════════════════════════════════════════════
    // FORM VIEW — New / Edit
    // ══════════════════════════════════════════════════════

    window.labInvShowForm = async function (id) {
        _editId = id;
        const inv = id ? _laborInvoices.find(i => i.id === id) : null;
        await _renderForm(inv);
    };

    async function _renderForm(inv) {
        const isEdit = !!inv;
        const d      = inv || {};
        const pd     = d.paymentDetails || _defaults.paymentDetails || {};

        // Build project options
        const projOpts = _projects.map(p =>
            `<option value="${_esc(p.id)}" ${d.constructionProjectId === p.id ? 'selected' : ''}>${_esc(_projLabel(p))}</option>`
        ).join('');

        // Build weekly bill checkboxes if editing and a project was saved
        let weeklyHtml = _buildWeeklySection(d.constructionProjectId, d.linkedWeeklyIds || []);

        _setContent(`
        <div class="inv-form-header">
            <button class="inv-btn inv-btn-ghost" onclick="window.labInvBackToList()">
                <i data-lucide="arrow-left" style="width:15px;height:15px;"></i> Back
            </button>
            <h2 class="inv-page-title" style="margin:0;">${isEdit ? 'Edit Labor Invoice' : 'New Labor Invoice'}</h2>
            <div class="inv-header-actions">
                ${isEdit ? `<button class="inv-btn inv-btn-outline" onclick="window.labInvPrint('${inv.id}')">
                    <i data-lucide="printer" style="width:15px;height:15px;"></i> Print
                </button>` : ''}
                <button class="inv-btn inv-btn-secondary" onclick="window.labInvSaveDraft()">Save Draft</button>
                <button class="inv-btn inv-btn-primary" onclick="window.labInvIssue()">
                    <i data-lucide="send" style="width:15px;height:15px;"></i> Save &amp; Issue
                </button>
            </div>
        </div>

        <div class="inv-form-body">
        <div class="inv-form-card">

            <div class="inv-section-title">Business Information</div>
            <div class="inv-form-grid inv-form-grid--3">
                <div class="inv-field inv-field--wide">
                    <label>Business Name</label>
                    <input type="text" id="labInvBusinessName" class="inv-input"
                           placeholder="e.g. DAC's Building Design"
                           value="${_esc(d.businessName || _defaults.businessName || '')}">
                </div>
                <div class="inv-field">
                    <label>Business TIN</label>
                    <input type="text" id="labInvBusinessTin" class="inv-input"
                           placeholder="000-000-000-000"
                           value="${_esc(d.businessTin || _defaults.businessTin || '')}">
                </div>
                <div class="inv-field inv-field--wide">
                    <label>Business Address</label>
                    <input type="text" id="labInvBusinessAddress" class="inv-input"
                           placeholder="Full business address"
                           value="${_esc(d.businessAddress || _defaults.businessAddress || '')}">
                </div>
            </div>

            <div class="inv-section-title" style="margin-top:20px;">Invoice Details</div>
            <div class="inv-form-grid inv-form-grid--3">
                <div class="inv-field">
                    <label>Invoice No.</label>
                    <input type="text" id="labInvNo" class="inv-input"
                           placeholder="Auto-generated"
                           value="${_esc(d.invoiceNo || '')}"
                           ${isEdit ? '' : 'readonly'}>
                </div>
                <div class="inv-field">
                    <label>Date</label>
                    <input type="date" id="labInvDate" class="inv-input"
                           value="${d.date || _todayStr()}">
                </div>
            </div>

            <div class="inv-section-title" style="margin-top:20px;">Bill To</div>
            <div class="inv-form-grid inv-form-grid--3">
                <div class="inv-field">
                    <label>Client Name</label>
                    <input type="text" id="labInvClientName" class="inv-input"
                           placeholder="Full name"
                           value="${_esc(d.clientName || '')}">
                </div>
                <div class="inv-field">
                    <label>Customer TIN</label>
                    <input type="text" id="labInvClientTin" class="inv-input"
                           placeholder="000-000-000-000"
                           value="${_esc(d.clientTin || '')}">
                </div>
                <div class="inv-field inv-field--wide">
                    <label>Customer Address</label>
                    <input type="text" id="labInvClientAddress" class="inv-input"
                           placeholder="Full address"
                           value="${_esc(d.clientAddress || '')}">
                </div>
            </div>

            <div class="inv-section-title" style="margin-top:20px;">Labor Source — Construction Project</div>
            <div class="inv-form-grid inv-form-grid--3" style="margin-bottom:12px;">
                <div class="inv-field inv-field--wide">
                    <label>Construction Project</label>
                    <select id="labInvProjectSelect" class="inv-input" onchange="window.labInvOnProjectChange(this.value)">
                        <option value="">— Select a project —</option>
                        ${projOpts}
                    </select>
                </div>
            </div>
            <div id="labInvWeeklySection">${weeklyHtml}</div>

            <div class="inv-section-title" style="margin-top:20px;">Labor Line Items</div>
            <div style="font-size:12px;color:#6b7280;margin-bottom:8px;">
                Items are auto-populated from selected weekly bill entries. You can also add manual lines below.
            </div>
            <div class="inv-items-wrap">
                <table class="inv-items-table">
                    <thead>
                        <tr>
                            <th class="inv-col-desc">Item Description / Service</th>
                            <th class="inv-col-qty">Qty</th>
                            <th class="inv-col-price">Unit Price</th>
                            <th class="inv-col-disc">Disc. (%)</th>
                            <th class="inv-col-amt">Amount</th>
                            <th class="inv-col-del"></th>
                        </tr>
                    </thead>
                    <tbody id="labInvItemsBody">${_buildItemRows(d.items || [])}</tbody>
                </table>
                <button class="inv-add-item-btn" onclick="window.labInvAddItem()">
                    <i data-lucide="plus-circle" style="width:14px;height:14px;"></i> Add Manual Item
                </button>
            </div>

            <div class="inv-totals-wrap">
                <div class="inv-totals-row">
                    <span>Total Labor Cost</span>
                    <span id="labInvSubtotal">₱ 0.00</span>
                </div>
                <div class="inv-totals-row inv-totals-row--total">
                    <span>TOTAL AMOUNT DUE</span>
                    <span id="labInvTotal">₱ 0.00</span>
                </div>
            </div>

            <div class="inv-section-title" style="margin-top:24px;">Payment Details</div>
            <div style="display:flex;gap:10px;margin-bottom:16px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px;font-weight:500;color:#374151;">
                    <input type="radio" name="labInvPayMethod" value="bank" id="labInvPayMethodBank"
                        ${(!pd.method || pd.method === 'bank') ? 'checked' : ''}
                        onchange="labInvTogglePayMethod()"> Bank Transfer
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px;font-weight:500;color:#374151;">
                    <input type="radio" name="labInvPayMethod" value="gcash" id="labInvPayMethodGcash"
                        ${pd.method === 'gcash' ? 'checked' : ''}
                        onchange="labInvTogglePayMethod()"> GCash
                </label>
            </div>

            <div id="labInvBankFields" class="inv-form-grid inv-form-grid--2" style="${pd.method === 'gcash' ? 'display:none;' : ''}">
                <div class="inv-field">
                    <label>Bank Name</label>
                    <select id="labInvBank" class="inv-input">
                        <option value="">— Select Bank —</option>
                        ${['BDO','BPI','Metrobank','PNB','UnionBank','Landbank','DBP','Chinabank','Security Bank','RCBC','EastWest Bank','PBCom','Asia United Bank','Robinsons Bank','Sterling Bank','CTBC Bank','Maybank','HSBC','Citibank','Other'].map(b =>
                            `<option value="${b}" ${pd.bank === b ? 'selected' : ''}>${b}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="inv-field">
                    <label>Account No.</label>
                    <input type="text" id="labInvAccountNo" class="inv-input"
                           placeholder="Account number" value="${_esc(pd.accountNo || '')}">
                </div>
                <div class="inv-field">
                    <label>Account Name</label>
                    <input type="text" id="labInvAccountName" class="inv-input"
                           placeholder="Account holder name" value="${_esc(pd.accountName || '')}">
                </div>
                <div class="inv-field">
                    <label>Branch</label>
                    <input type="text" id="labInvBranch" class="inv-input"
                           placeholder="Branch (optional)" value="${_esc(pd.branch || '')}">
                </div>
            </div>

            <div id="labInvGcashFields" class="inv-form-grid inv-form-grid--2" style="${pd.method !== 'gcash' ? 'display:none;' : ''}">
                <div class="inv-field">
                    <label>GCash Number</label>
                    <input type="text" id="labInvGcashNumber" class="inv-input"
                           placeholder="09XX XXX XXXX" value="${_esc(pd.gcashNumber || '')}">
                </div>
                <div class="inv-field">
                    <label>Account Name</label>
                    <input type="text" id="labInvGcashName" class="inv-input"
                           placeholder="GCash account name" value="${_esc(pd.gcashName || '')}">
                </div>
            </div>

            <div class="inv-section-title" style="margin-top:20px;">Notes / Memo</div>
            <textarea id="labInvNotes" class="inv-textarea" rows="3"
                      placeholder="Additional notes or instructions...">${_esc(d.notes || '')}</textarea>

            <label class="inv-save-defaults-label">
                <input type="checkbox" id="labInvSaveDefaults">
                Save business info &amp; payment details as defaults for future invoices
            </label>

        </div>
        </div>`);

        if (typeof lucide !== 'undefined') lucide.createIcons();

        if (!isEdit) {
            _generateLaborInvoiceNo().then(no => {
                const el = document.getElementById('labInvNo');
                if (el) el.value = no;
            });
            // If editing with existing items, populate them
        } else if (d.items && d.items.length) {
            // items already rendered via _buildItemRows
        }

        window.labInvRecalc();
    }

    // ── Weekly Bill Section ────────────────────────────────────────────
    function _buildWeeklySection(projectId, linkedIds) {
        if (!projectId) return '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">Select a project above to view and link weekly labor entries.</div>';
        const entries = _weeklyEntries;
        if (!entries.length) return '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">No weekly entries found for this project.</div>';
        const rows = entries.map(e => {
            const dateStr = e.weekEndingDate
                ? new Date(e.weekEndingDate + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—';
            const checked = linkedIds.includes(e.id) ? 'checked' : '';
            return `<tr>
                <td style="width:36px;text-align:center;">
                    <input type="checkbox" class="labinv-weekly-check" value="${_esc(e.id)}"
                        data-labor="${e.labor || 0}" data-fee="${e.managementFee || 0}" data-grand="${e.grandTotal || 0}"
                        data-date="${_esc(e.weekEndingDate || '')}"
                        ${checked} onchange="window.labInvSyncFromWeekly()">
                </td>
                <td style="font-weight:600;">${_esc(dateStr)}</td>
                <td>${_fmtPeso(e.labor || 0)}</td>
                <td>${_fmtPeso(e.materials || 0)}</td>
                <td>${_fmtPeso(e.managementFee || 0)}</td>
                <td style="font-weight:700;">${_fmtPeso(e.grandTotal || 0)}</td>
                <td>${e.status === 'Paid' ? '<span class="inv-status inv-status--issued">Paid</span>' : '<span class="inv-status inv-status--draft">Submitted</span>'}</td>
            </tr>`;
        }).join('');

        return `
        <div style="overflow-x:auto;margin-bottom:8px;">
            <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
                <thead>
                    <tr style="background:#f1f5f9;">
                        <th style="padding:7px 8px;text-align:center;font-weight:600;color:#374151;">✓</th>
                        <th style="padding:7px 8px;text-align:left;font-weight:600;color:#374151;">Week Ending</th>
                        <th style="padding:7px 8px;text-align:left;font-weight:600;color:#374151;">Labor</th>
                        <th style="padding:7px 8px;text-align:left;font-weight:600;color:#374151;">Materials</th>
                        <th style="padding:7px 8px;text-align:left;font-weight:600;color:#374151;">Mgmt Fee</th>
                        <th style="padding:7px 8px;text-align:left;font-weight:600;color:#374151;">Grand Total</th>
                        <th style="padding:7px 8px;text-align:left;font-weight:600;color:#374151;">Status</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:4px;">
            <button class="inv-btn inv-btn-ghost" style="font-size:12px;padding:4px 10px;" onclick="window.labInvSelectAllWeekly(true)">Select All</button>
            <button class="inv-btn inv-btn-ghost" style="font-size:12px;padding:4px 10px;" onclick="window.labInvSelectAllWeekly(false)">Deselect All</button>
        </div>`;
    }

    window.labInvOnProjectChange = async function (projectId) {
        const section = document.getElementById('labInvWeeklySection');
        if (!section) return;
        section.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">Loading weekly entries…</div>';
        // Auto-fill client name from project
        const proj = _projects.find(p => p.id === projectId);
        if (proj) {
            const nameEl = document.getElementById('labInvClientName');
            const addrEl = document.getElementById('labInvClientAddress');
            if (nameEl && !nameEl.value) nameEl.value = proj.clientName || '';
            if (addrEl && !addrEl.value) addrEl.value = proj.address || '';
        }
        await _loadWeeklyEntries(projectId);
        section.innerHTML = _buildWeeklySection(projectId, []);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.labInvSelectAllWeekly = function (checked) {
        document.querySelectorAll('.labinv-weekly-check').forEach(cb => { cb.checked = checked; });
        window.labInvSyncFromWeekly();
    };

    // Sync checked weekly entries → line items in the invoice
    window.labInvSyncFromWeekly = function () {
        const tbody = document.getElementById('labInvItemsBody');
        if (!tbody) return;

        // Remove auto-generated rows (keep manual ones without data-auto)
        Array.from(tbody.querySelectorAll('tr[data-auto="1"]')).forEach(r => r.remove());

        // Gather checked entries
        const checked = Array.from(document.querySelectorAll('.labinv-weekly-check:checked'));
        checked.forEach(cb => {
            const dateStr = cb.getAttribute('data-date')
                ? new Date(cb.getAttribute('data-date') + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—';
            const labor = parseFloat(cb.getAttribute('data-labor')) || 0;
            const fee   = parseFloat(cb.getAttribute('data-fee'))   || 0;
            const grand = parseFloat(cb.getAttribute('data-grand')) || 0;
            const desc  = `Labor — Week Ending ${dateStr}`;
            const i     = _nextRowId();
            const rowHtml = `<tr id="labInvRow_${i}" data-auto="1">
                <td><input type="text" class="inv-input inv-input--sm" id="labInvDesc_${i}" value="${_esc(desc)}" placeholder="Description"></td>
                <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvQty_${i}" value="1" min="0" step="any" oninput="window.labInvRecalc()"></td>
                <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvPrice_${i}" value="${grand}" min="0" step="any" oninput="window.labInvRecalc()"></td>
                <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvDisc_${i}" value="0" min="0" max="100" step="any" oninput="window.labInvRecalc()"></td>
                <td><span class="inv-item-amt" id="labInvAmt_${i}">${_fmt(grand)}</span></td>
                <td><button class="inv-del-row-btn" title="Remove row" onclick="window.labInvRemoveItem(${i})"><i data-lucide="x" style="width:12px;height:12px;"></i></button></td>
            </tr>`;
            const tmp = document.createElement('table');
            tmp.innerHTML = '<tbody>' + rowHtml + '</tbody>';
            const newRow = tmp.querySelector('tbody tr');
            // Insert auto rows before any existing manual rows
            const firstManual = Array.from(tbody.querySelectorAll('tr:not([data-auto])'))[0];
            if (firstManual) tbody.insertBefore(newRow, firstManual);
            else tbody.appendChild(newRow);
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
        window.labInvRecalc();
    };

    let _rowCounter = 0;
    function _nextRowId() { return ++_rowCounter; }

    function _buildItemRows(items) {
        if (!items || !items.length) return '';
        return items.map((item, i) => {
            const id = ++_rowCounter;
            return `<tr id="labInvRow_${id}">
                <td><input type="text" class="inv-input inv-input--sm" id="labInvDesc_${id}" value="${_esc(item.description || '')}" placeholder="Description"></td>
                <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvQty_${id}" value="${item.qty != null ? item.qty : 1}" min="0" step="any" oninput="window.labInvRecalc()"></td>
                <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvPrice_${id}" value="${item.unitPrice != null ? item.unitPrice : 0}" min="0" step="any" oninput="window.labInvRecalc()"></td>
                <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvDisc_${id}" value="${item.discount != null ? item.discount : 0}" min="0" max="100" step="any" oninput="window.labInvRecalc()"></td>
                <td><span class="inv-item-amt" id="labInvAmt_${id}">${_fmt(item.amount || 0)}</span></td>
                <td><button class="inv-del-row-btn" title="Remove row" onclick="window.labInvRemoveItem(${id})"><i data-lucide="x" style="width:12px;height:12px;"></i></button></td>
            </tr>`;
        }).join('');
    }

    window.labInvAddItem = function () {
        const tbody = document.getElementById('labInvItemsBody');
        if (!tbody) return;
        const id = _nextRowId();
        const html = `<tr id="labInvRow_${id}">
            <td><input type="text" class="inv-input inv-input--sm" id="labInvDesc_${id}" value="" placeholder="Description or service"></td>
            <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvQty_${id}" value="1" min="0" step="any" oninput="window.labInvRecalc()"></td>
            <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvPrice_${id}" value="0" min="0" step="any" oninput="window.labInvRecalc()"></td>
            <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="labInvDisc_${id}" value="0" min="0" max="100" step="any" oninput="window.labInvRecalc()"></td>
            <td><span class="inv-item-amt" id="labInvAmt_${id}">${_fmt(0)}</span></td>
            <td><button class="inv-del-row-btn" title="Remove row" onclick="window.labInvRemoveItem(${id})"><i data-lucide="x" style="width:12px;height:12px;"></i></button></td>
        </tr>`;
        const tmp = document.createElement('table');
        tmp.innerHTML = '<tbody>' + html + '</tbody>';
        tbody.appendChild(tmp.querySelector('tbody tr'));
        if (typeof lucide !== 'undefined') lucide.createIcons();
        window.labInvRecalc();
    };

    window.labInvRemoveItem = function (id) {
        const row = document.getElementById('labInvRow_' + id);
        if (row) row.remove();
        window.labInvRecalc();
    };

    window.labInvRecalc = function () {
        let subtotal = 0;
        document.querySelectorAll('#labInvItemsBody tr').forEach(row => {
            const id    = row.id.replace('labInvRow_', '');
            const qty   = parseFloat(document.getElementById('labInvQty_'   + id)?.value) || 0;
            const price = parseFloat(document.getElementById('labInvPrice_' + id)?.value) || 0;
            const disc  = parseFloat(document.getElementById('labInvDisc_'  + id)?.value) || 0;
            const amt   = qty * price * (1 - disc / 100);
            subtotal += amt;
            const amtEl = document.getElementById('labInvAmt_' + id);
            if (amtEl) amtEl.textContent = _fmt(amt);
        });
        _setText('labInvSubtotal', _fmt(subtotal));
        _setText('labInvTotal',    _fmt(subtotal));
    };

    window.labInvTogglePayMethod = function () {
        const method = document.querySelector('input[name="labInvPayMethod"]:checked')?.value || 'bank';
        document.getElementById('labInvBankFields').style.display  = method === 'bank'  ? '' : 'none';
        document.getElementById('labInvGcashFields').style.display = method === 'gcash' ? '' : 'none';
    };

    // ══════════════════════════════════════════════════════
    // COLLECT FORM DATA
    // ══════════════════════════════════════════════════════

    function _collectForm(status) {
        const items = [];
        document.querySelectorAll('#labInvItemsBody tr').forEach(row => {
            const id    = row.id.replace('labInvRow_', '');
            const desc  = (document.getElementById('labInvDesc_'  + id)?.value  || '').trim();
            const qty   = parseFloat(document.getElementById('labInvQty_'   + id)?.value) || 0;
            const price = parseFloat(document.getElementById('labInvPrice_' + id)?.value) || 0;
            const disc  = parseFloat(document.getElementById('labInvDisc_'  + id)?.value) || 0;
            const amt   = qty * price * (1 - disc / 100);
            if (desc || qty || price) {
                items.push({ description: desc, qty, unitPrice: price, discount: disc, amount: amt });
            }
        });

        const subtotal = items.reduce((s, it) => s + it.amount, 0);

        const linkedWeeklyIds = Array.from(document.querySelectorAll('.labinv-weekly-check:checked'))
            .map(cb => cb.value);

        return {
            userId:                _ownerUid,
            invoiceNo:             (document.getElementById('labInvNo')?.value              || '').trim(),
            date:                  document.getElementById('labInvDate')?.value             || _todayStr(),
            businessName:          (document.getElementById('labInvBusinessName')?.value    || '').trim(),
            businessTin:           (document.getElementById('labInvBusinessTin')?.value     || '').trim(),
            businessAddress:       (document.getElementById('labInvBusinessAddress')?.value || '').trim(),
            clientName:            (document.getElementById('labInvClientName')?.value      || '').trim(),
            clientTin:             (document.getElementById('labInvClientTin')?.value       || '').trim(),
            clientAddress:         (document.getElementById('labInvClientAddress')?.value   || '').trim(),
            constructionProjectId: document.getElementById('labInvProjectSelect')?.value   || '',
            linkedWeeklyIds,
            items,
            subtotal,
            totalAmount: subtotal,
            paymentDetails: (function () {
                const method = document.querySelector('input[name="labInvPayMethod"]:checked')?.value || 'bank';
                if (method === 'gcash') {
                    return {
                        method:      'gcash',
                        gcashNumber: (document.getElementById('labInvGcashNumber')?.value || '').trim(),
                        gcashName:   (document.getElementById('labInvGcashName')?.value   || '').trim(),
                    };
                }
                return {
                    method:      'bank',
                    bank:        (document.getElementById('labInvBank')?.value        || '').trim(),
                    accountNo:   (document.getElementById('labInvAccountNo')?.value   || '').trim(),
                    accountName: (document.getElementById('labInvAccountName')?.value || '').trim(),
                    branch:      (document.getElementById('labInvBranch')?.value      || '').trim(),
                };
            })(),
            notes:  (document.getElementById('labInvNotes')?.value || '').trim(),
            status: status || 'draft'
        };
    }

    // ══════════════════════════════════════════════════════
    // SAVE
    // ══════════════════════════════════════════════════════

    async function _save(status) {
        const data = _collectForm(status);
        if (!data.clientName)   { alert('Please enter a customer name.');     return; }
        if (!data.items.length) { alert('Please add at least one line item.'); return; }

        if (document.getElementById('labInvSaveDefaults')?.checked) {
            try {
                await db.collection('settings').doc('invoiceDefaults').set({
                    businessName:    data.businessName,
                    businessTin:     data.businessTin,
                    businessAddress: data.businessAddress,
                    paymentDetails:  data.paymentDetails
                }, { merge: true });
                _defaults = {
                    businessName: data.businessName,
                    businessTin:  data.businessTin,
                    businessAddress: data.businessAddress,
                    paymentDetails:  data.paymentDetails
                };
            } catch (e) { console.warn('LaborInvoiceModule: could not save defaults', e); }
        }

        const now = firebase.firestore.FieldValue.serverTimestamp();
        try {
            if (_editId) {
                await db.collection(COLLECTION).doc(_editId).update({ ...data, updatedAt: now });
                const idx = _laborInvoices.findIndex(i => i.id === _editId);
                if (idx >= 0) _laborInvoices[idx] = { id: _editId, ...data };
            } else {
                const ref = await db.collection(COLLECTION).add({
                    ...data,
                    createdAt: now,
                    updatedAt: now,
                    createdBy: firebase.auth().currentUser?.uid || ''
                });
                _editId = ref.id;
                _laborInvoices.unshift({ id: ref.id, ...data });
            }
            if (status === 'issued') {
                _doPrint({ id: _editId, ...data });
            }
            _renderList();
        } catch (e) {
            console.error('LaborInvoiceModule: save error', e);
            alert('Error saving labor invoice: ' + e.message);
        }
    }

    window.labInvSaveDraft = function () { _save('draft'); };
    window.labInvIssue     = function () { _save('issued'); };

    // ══════════════════════════════════════════════════════
    // DELETE
    // ══════════════════════════════════════════════════════

    window.labInvDelete = async function (id) {
        if (!await window.showDeleteConfirm('Delete this labor invoice? This cannot be undone.')) return;
        db.collection(COLLECTION).doc(id).delete()
            .then(() => {
                _laborInvoices = _laborInvoices.filter(i => i.id !== id);
                _renderList();
            })
            .catch(e => alert('Delete failed: ' + e.message));
    };

    // ══════════════════════════════════════════════════════
    // NAVIGATION
    // ══════════════════════════════════════════════════════

    window.labInvBackToList = function () {
        _editId = null;
        _renderList();
    };

    // ══════════════════════════════════════════════════════
    // PRINT
    // ══════════════════════════════════════════════════════

    window.labInvPrint = function (id) {
        const inv = _laborInvoices.find(i => i.id === id);
        if (!inv) { alert('Invoice not found.'); return; }
        _doPrint(inv, false);
    };

    window.labInvPreview = function (id) {
        const inv = _laborInvoices.find(i => i.id === id);
        if (!inv) { alert('Invoice not found.'); return; }
        _doPrint(inv, true);
    };

    function _buildLogoHtml(logos) {
        if (!logos || !logos.length) return '';
        const normLogos = logos.map(l => (typeof l === 'string' ? { src: l, enabled: true } : l));
        const enabled = normLogos.filter(l => l.enabled !== false);
        if (!enabled.length) return '';
        const imgs = enabled.map(l =>
            `<img src="${l.src}" style="height:64px;max-width:140px;width:auto;object-fit:contain;flex-shrink:0;mix-blend-mode:multiply;" onerror="this.style.display='none'">`
        ).join('');
        const justification = enabled.length === 1 ? 'center' : 'space-evenly';
        return `<div style="display:flex;align-items:center;justify-content:${justification};gap:24px;padding:12px 0 16px;border-bottom:2.5px solid #1e3a5f;margin-bottom:18px;flex-wrap:nowrap;overflow:hidden;">${imgs}</div>`;
    }

    function _doPrint(inv, previewOnly) {
        const pd      = Object.assign({}, _defaults.paymentDetails || {}, inv.paymentDetails || {});
        const bizName = inv.businessName    || _defaults.businessName    || 'Business Name';
        const bizTin  = inv.businessTin     || _defaults.businessTin     || '—';
        const bizAddr = inv.businessAddress || _defaults.businessAddress || '—';
        const logoHtml = _buildLogoHtml(_defaults.logos);

        const proj = _projects.find(p => p.id === inv.constructionProjectId);
        // Address included so the printed invoice names the site; no id suffix here —
        // this one is client-facing.
        const projLabel = proj
            ? `${proj.clientName || '—'} — ${proj.projectName || '—'}` + (proj.address ? ` · ${proj.address}` : '')
            : '—';

        const itemRows = (inv.items || []).map((item, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${_pEsc(item.description || '')}</td>
                <td style="text-align:center;">${item.qty}</td>
                <td style="text-align:right;">${_fmtPrint(item.unitPrice)}</td>
                <td style="text-align:center;">${item.discount || 0}%</td>
                <td style="text-align:right;font-weight:600;">${_fmtPrint(item.amount)}</td>
            </tr>`).join('');

        const w = window.open('', '_blank', 'width=870,height=1100');
        if (!w) { alert('Please allow pop-ups to print the invoice.'); return; }

        w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${previewOnly ? 'Preview' : 'Print'} — Labor Invoice ${_pEsc(inv.invoiceNo || '')}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111; background: #f5f5f5; }
.page { width: 210mm; min-height: 297mm; margin: 20px auto; padding: 18mm 16mm 14mm; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
.inv-header  { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:22px; }
.inv-biz h1  { font-size:20px; font-weight:800; color:#1a1a2e; }
.inv-biz p   { font-size:12px; color:#555; margin-top:4px; line-height:1.5; }
.inv-title-block { text-align:right; }
.inv-title-block h2 { font-size:26px; font-weight:800; color:#1e3a5f; letter-spacing:2px; }
.inv-title-block .inv-sub { font-size:13px; font-weight:700; color:#7c3aed; margin-top:4px; letter-spacing:.5px; }
.inv-meta    { margin-top:8px; font-size:12px; color:#444; line-height:1.8; }
.inv-meta strong { color:#111; }
.bill-row { display:flex; gap:32px; margin-bottom:18px; padding:14px 0;
            border-top:2.5px solid #1e3a5f; border-bottom:1px solid #e5e7eb; }
.bill-to h4 { font-size:10px; font-weight:700; color:#6b7280; letter-spacing:1.5px;
              text-transform:uppercase; margin-bottom:6px; }
.bill-to .name { font-size:15px; font-weight:700; color:#1a1a2e; margin-bottom:3px; }
.bill-to p { font-size:12px; color:#555; line-height:1.5; }
table.items { width:100%; border-collapse:collapse; margin-bottom:14px; }
table.items thead tr { background:#1e3a5f; color:#fff; }
table.items thead th { padding:9px 10px; font-size:11px; font-weight:700; text-align:left; letter-spacing:.4px; }
table.items tbody tr:nth-child(even) { background:#f8fafc; }
table.items tbody td { padding:8px 10px; border-bottom:1px solid #e9ecef; vertical-align:top; font-size:12px; }
.totals-wrap { display:flex; justify-content:flex-end; margin-bottom:20px; }
table.totals { width:280px; border-collapse:collapse; font-size:13px; }
table.totals td { padding:6px 10px; }
table.totals td:first-child { color:#555; }
table.totals td:last-child { text-align:right; font-weight:600; color:#111; }
table.totals tr.grand td { font-size:15px; font-weight:800; color:#fff; background:#1e3a5f; padding:10px 12px; }
.pay-box { background:#f1f5f9; border-radius:8px; padding:13px 16px; margin-bottom:18px; }
.pay-box h4 { font-size:10px; font-weight:700; color:#6b7280; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:10px; }
.pay-grid { display:grid; grid-template-columns:1fr 1fr; gap:5px 24px; font-size:12px; }
.pay-grid .lbl { color:#6b7280; }
.pay-grid .val { font-weight:600; color:#111; }
.notes-box { font-size:12px; color:#555; margin-bottom:20px; line-height:1.6; }
.notes-box strong { color:#374151; }
.sig-row { display:flex; justify-content:space-between; margin-top:36px; }
.sig-block { text-align:center; width:180px; }
.sig-line { border-top:1px solid #374151; padding-top:6px; font-size:11px; color:#6b7280; }
.footer { text-align:center; margin-top:24px; font-size:10px; color:#9ca3af;
          border-top:1px solid #e5e7eb; padding-top:10px; }
.preview-bar { display:flex; align-items:center; justify-content:space-between;
               background:#1e3a5f; color:#fff; padding:10px 20px;
               font-family:Arial,sans-serif; font-size:13px; }
.preview-bar button { background:#4AC84A; color:#fff; border:none; border-radius:6px;
                      padding:7px 18px; font-size:13px; font-weight:700; cursor:pointer; }
.preview-bar button:hover { background:#3ab53a; }
@media print {
  body { background:#fff; }
  .page { margin:0; box-shadow:none; padding:10mm 10mm; width:100%; }
  .preview-bar { display:none !important; }
  @page { size:A4 portrait; margin:8mm; }
}
</style>
</head>
<body>
${previewOnly ? `<div class="preview-bar"><span>Print Preview — Labor Invoice ${_pEsc(inv.invoiceNo || '')}</span><button onclick="window.print()">Print</button></div>` : ''}
<div class="page">

  ${logoHtml}

  <div class="inv-header">
    <div class="inv-biz">
      <h1>${_pEsc(bizName)}</h1>
      <p>Business Tax Id: ${_pEsc(bizTin)}<br>${_pEsc(bizAddr)}</p>
    </div>
    <div class="inv-title-block">
      <h2>LABOR INVOICE</h2>
      <div class="inv-sub">Labor &amp; Construction</div>
      <div class="inv-meta">
        Invoice No: <strong>${_pEsc(inv.invoiceNo || '—')}</strong><br>
        Date: <strong>${inv.date ? _fmtDate(inv.date) : '—'}</strong>
      </div>
    </div>
  </div>

  <div class="bill-row">
    <div class="bill-to">
      <h4>Bill To</h4>
      <div class="name">${_pEsc(inv.clientName || '—')}</div>
      <p>${_pEsc(inv.clientAddress || '—')}</p>
      ${inv.clientTin ? `<p>TIN: ${_pEsc(inv.clientTin)}</p>` : ''}
    </div>
    ${projLabel !== '—' ? `<div class="bill-to">
      <h4>Project</h4>
      <div class="name" style="font-size:13px;">${_pEsc(projLabel)}</div>
    </div>` : ''}
  </div>

  <table class="items">
    <thead>
      <tr>
        <th style="width:28px;">#</th>
        <th>Item Description / Service</th>
        <th style="width:55px;text-align:center;">Qty</th>
        <th style="width:105px;text-align:right;">Unit Price</th>
        <th style="width:70px;text-align:center;">Disc.(%)</th>
        <th style="width:110px;text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals-wrap">
    <table class="totals">
      <tr><td>Total Labor Cost</td><td>${_fmtPrint(inv.subtotal || 0)}</td></tr>
      <tr class="grand"><td>TOTAL AMOUNT DUE</td><td>${_fmtPrint(inv.totalAmount || 0)}</td></tr>
    </table>
  </div>

  <div class="pay-box">
    <h4>Payment Details</h4>
    <div class="pay-grid">
      ${pd.method === 'gcash'
        ? `<div><span class="lbl">Payment Via: </span><span class="val">GCash</span></div>
           <div><span class="lbl">GCash No.: </span><span class="val">${_pEsc(pd.gcashNumber || '—')}</span></div>
           <div><span class="lbl">Account Name: </span><span class="val">${_pEsc(pd.gcashName || '—')}</span></div>`
        : `<div><span class="lbl">Payment Via: </span><span class="val">Bank Transfer</span></div>
           <div><span class="lbl">Bank: </span><span class="val">${_pEsc(pd.bank || '—')}</span></div>
           <div><span class="lbl">Account No.: </span><span class="val">${_pEsc(pd.accountNo || '—')}</span></div>
           <div><span class="lbl">Account Name: </span><span class="val">${_pEsc(pd.accountName || '—')}</span></div>
           <div><span class="lbl">Branch: </span><span class="val">${_pEsc(pd.branch || '—')}</span></div>`
      }
    </div>
  </div>

  ${inv.notes ? `<div class="notes-box"><strong>Notes:</strong> ${_pEsc(inv.notes)}</div>` : ''}

  <div class="sig-row">
    <div class="sig-block"><div class="sig-line">Prepared by</div></div>
    <div class="sig-block"><div class="sig-line">Received by</div></div>
    <div class="sig-block"><div class="sig-line">Approved by</div></div>
  </div>

  <div class="footer">
    ${_pEsc(inv.businessName || '')} &bull; ${_pEsc(inv.businessAddress || '')}
  </div>

</div>
${previewOnly ? '' : '<script>window.onload=function(){window.print();};<\\/script>'}
</body>
</html>`);
        w.document.close();
    }

    // ══════════════════════════════════════════════════════
    // CSV EXPORT
    // ══════════════════════════════════════════════════════

    window.labInvExportCSV = function () {
        const header = 'Invoice No.,Date,Customer Name,Customer TIN,Customer Address,Total Amount (PHP),Status\n';
        const rows = _laborInvoices.map(inv => [
            inv.invoiceNo    || '',
            inv.date         || '',
            inv.clientName   || '',
            inv.clientTin    || '',
            inv.clientAddress|| '',
            (inv.totalAmount || 0).toFixed(2),
            inv.status       || ''
        ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');

        const dateStr = _todayStr();
        const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `labor-invoices-${dateStr}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    // ══════════════════════════════════════════════════════
    // AUTO-GENERATE INVOICE NUMBER
    // ══════════════════════════════════════════════════════

    async function _generateLaborInvoiceNo() {
        const now    = new Date();
        const prefix = `LINV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
        const same   = _laborInvoices.filter(i => (i.invoiceNo || '').startsWith(prefix));
        const maxSeq = same.reduce((max, i) => {
            const seq = parseInt((i.invoiceNo || '').slice(prefix.length)) || 0;
            return Math.max(max, seq);
        }, 0);
        return prefix + String(maxSeq + 1).padStart(3, '0');
    }

    // ══════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════

    function _showLoading(on) {
        const ld = document.getElementById('labInvLoading');
        const ct = document.getElementById('labInvContent');
        if (ld) ld.style.display = on ? 'flex' : 'none';
        if (ct) ct.style.display = on ? 'none' : 'block';
    }

    function _setContent(html) {
        const ct = document.getElementById('labInvContent');
        if (ct) ct.innerHTML = html;
    }

    function _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function _fmt(n) {
        return '₱ ' + (n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _fmtPeso(n) {
        return '₱' + (n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _fmtPrint(n) {
        return '₱ ' + (n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _pEsc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // One client can run several projects sharing a name — append the address, and a
    // short id if that still collides, so no two options read identically. Picking the
    // wrong one files the invoice against the wrong project.
    function _projLabel(p) {
        const base = `${p.clientName || '—'} — ${p.projectName || '—'}`;
        const full = p.address ? `${base} · ${p.address}` : base;
        const dup  = _projects.filter(q => {
            const b = `${q.clientName || '—'} — ${q.projectName || '—'}`;
            return (q.address ? `${b} · ${q.address}` : b) === full;
        }).length > 1;
        return dup ? `${full} · ID ${String(p.id).slice(0, 8)}` : full;
    }

    function _tsToMs(ts) {
        if (!ts) return 0;
        if (typeof ts.toDate === 'function') return ts.toDate().getTime();
        if (ts instanceof Date) return ts.getTime();
        if (typeof ts === 'number') return ts;
        return new Date(ts).getTime() || 0;
    }

    function _todayStr() {
        // Local date — toISOString is UTC, which in PH is still yesterday before 8AM
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function _fmtDate(str) {
        if (!str) return '—';
        try {
            return new Date(str + 'T00:00:00')
                .toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (e) { return str; }
    }

})();
