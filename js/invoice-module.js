// ════════════════════════════════════════════════════════════
// INVOICE RECEIPT GENERATOR MODULE (Admin)
// Create, manage, and print sales invoices.
// ════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── State ──────────────────────────────────────────────────────────
    let _invoices  = [];
    let _loading   = false;
    let _ownerUid  = null;
    let _defaults  = {};   // cached from settings/invoiceDefaults
    let _editId    = null; // null = new invoice
    let _itemCount = 0;    // running index for line item rows

    // ══════════════════════════════════════════════════════
    // PUBLIC ENTRY POINT
    // ══════════════════════════════════════════════════════

    window.initInvoiceModule = function () {
        if (_loading) return;
        const main = document.querySelector('.main-content') || document.documentElement;
        if (main) main.scrollTop = 0;
        // Re-render list if data is already loaded
        if (_invoices.length > 0 || _ownerUid) {
            _renderList();
            return;
        }
        _boot();
    };

    async function _boot() {
        await _resolveOwnerUid();
        _loadDefaults(); // fire-and-forget (pre-fills form later)
        _loadInvoices();
    }

    // ══════════════════════════════════════════════════════
    // OWNER UID — handles staff-as-owner context
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
            _ownerUid = user.uid;
        }
    }

    // ══════════════════════════════════════════════════════
    // LOAD BUSINESS DEFAULTS (from settings/invoiceDefaults)
    // ══════════════════════════════════════════════════════

    async function _loadDefaults() {
        try {
            const doc = await db.collection('settings').doc('invoiceDefaults').get();
            if (doc.exists) _defaults = doc.data() || {};
        } catch (e) { /* non-critical */ }
    }

    // ══════════════════════════════════════════════════════
    // DATA — Load invoices
    // ══════════════════════════════════════════════════════

    async function _loadInvoices() {
        _loading = true;
        _showLoading(true);
        try {
            const snap = await db.collection('invoices')
                .where('userId', '==', _ownerUid)
                .get();
            _invoices = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));
        } catch (e) {
            console.error('InvoiceModule: load error', e);
            _invoices = [];
            const el = document.getElementById('invLoading');
            if (el) el.innerHTML = `<p style="color:#b91c1c;font-weight:600;">Could not load invoices.</p>
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

    // Track which client groups are expanded
    const _expandedGroups = new Set();

    // Delegated click handler — set up once, survives re-renders
    document.addEventListener('click', function (e) {
        const row = e.target.closest('.inv-group-toggle');
        if (!row) return;
        const key = row.getAttribute('data-group-key');
        if (!key) return;
        if (_expandedGroups.has(key)) {
            _expandedGroups.delete(key);
        } else {
            _expandedGroups.add(key);
        }
        _renderList();
    });

    // Search state + avatar palette (PM Invoice Receipt.dc.html)
    let _invSearch = '';
    let _invSearchFocused = false;
    function _invAvatar(i) {
        const p = [['#eaf4ef','#157a52'],['#eef0f3','#5b6b7e'],['#f6efe0','#9a6b1f'],['#f2eef5','#7a5b95']];
        return p[((i % p.length) + p.length) % p.length];
    }
    window.invFilter = function () {
        const el = document.getElementById('invSearch');
        _invSearch = el ? el.value : '';
        _invSearchFocused = true;
        _renderList();
    };

    // Inner invoice row inside an expanded client card (grid layout).
    function _invoiceRow(inv) {
        const issued = inv.status === 'issued';
        const pill = issued
            ? `<span class="inv-pill inv-pill-issued"><span class="inv-pill-dot"></span>Issued</span>`
            : `<span class="inv-pill inv-pill-draft"><span class="inv-pill-dot"></span>Draft</span>`;
        return `
        <div class="inv-irow">
            <div class="inv-ino num">${_esc(inv.invoiceNo || '—')}</div>
            <div class="inv-idate num">${inv.date ? _fmtDate(inv.date) : '—'}</div>
            <div class="inv-iamt num">${_fmt(inv.totalAmount || 0)}</div>
            <div class="inv-ipill">${pill}</div>
            <div class="inv-iactions">
                <button class="inv-icon-btn" title="View receipt" onclick="window.invPreview('${inv.id}')"><i data-lucide="eye"></i></button>
                <button class="inv-icon-btn" title="Print" onclick="window.invPrint('${inv.id}')"><i data-lucide="printer"></i></button>
                <button class="inv-icon-btn" title="Export PDF" onclick="window.invExportPDF('${inv.id}')"><i data-lucide="file-down"></i></button>
                <button class="inv-icon-btn" title="Edit" onclick="window.invShowForm('${inv.id}')"><i data-lucide="pencil"></i></button>
                <button class="inv-icon-btn inv-icon-danger" title="Delete" onclick="window.invDelete('${inv.id}')"><i data-lucide="trash-2"></i></button>
            </div>
        </div>`;
    }

    function _renderList() {
        _editId = null;
        const startOfMonth = new Date();
        startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

        let totalAmt = 0, monthAmt = 0, issuedCount = 0;
        _invoices.forEach(inv => {
            const amt = inv.totalAmount || 0;
            totalAmt   += amt;
            issuedCount += inv.status === 'issued' ? 1 : 0;
            if (_tsToMs(inv.createdAt) >= startOfMonth.getTime()) monthAmt += amt;
        });

        // Group invoices by clientName
        const groups = {};
        _invoices.forEach(inv => {
            const key = (inv.clientName || '—').trim();
            if (!groups[key]) groups[key] = [];
            groups[key].push(inv);
        });

        const q = (_invSearch || '').trim().toLowerCase();
        const entries = Object.entries(groups).filter(([name, list]) =>
            !q || name.toLowerCase().includes(q) || list.some(i => (i.invoiceNo || '').toLowerCase().includes(q)));

        let cards = '';
        if (_invoices.length === 0) {
            cards = `<div class="inv-empty-card"><div class="inv-empty-title">No invoices yet</div><div class="inv-empty-sub">Click <strong>New invoice</strong> to create one.</div></div>`;
        } else if (entries.length === 0) {
            cards = `<div class="inv-empty-card"><div class="inv-empty-title">No invoices found</div><div class="inv-empty-sub">Try a different search.</div></div>`;
        } else {
            entries.forEach(([clientName, list], idx) => {
                const key      = _esc(clientName);
                const expanded = _expandedGroups.has(clientName);
                const total    = list.reduce((s, i) => s + (i.totalAmount || 0), 0);
                const drafts   = list.filter(i => i.status !== 'issued').length;
                const [aBg, aCol] = _invAvatar(idx);
                const initial  = (clientName[0] || 'C').toUpperCase();
                const chip = drafts > 0
                    ? `<span class="inv-chip inv-chip-draft">${drafts} draft</span>`
                    : `<span class="inv-chip inv-chip-issued">All issued</span>`;
                const inner = expanded ? `
                    <div class="inv-inner">
                        <div class="inv-ihead">
                            <div>Invoice no.</div><div>Date</div><div class="ta-r">Amount</div><div class="ta-c">Status</div><div class="ta-r">View</div>
                        </div>
                        ${list.map(_invoiceRow).join('')}
                    </div>` : '';
                cards += `
                <div class="inv-gcard">
                    <div class="inv-ghead inv-group-toggle" data-group-key="${key}">
                        <div class="inv-gavatar" style="background:${aBg};color:${aCol};box-shadow:0 0 0 2px #fff,0 0 0 3px ${aCol}40;">${initial}</div>
                        <div class="inv-gmeta">
                            <div class="inv-gname">${key}</div>
                            <div class="inv-gsub">${list.length} ${list.length === 1 ? 'invoice' : 'invoices'} · ${_fmt(total)} billed</div>
                        </div>
                        ${chip}
                        <span class="inv-gcaret${expanded ? ' open' : ''}">⌄</span>
                    </div>
                    ${inner}
                </div>`;
            });
        }

        _setContent(`
        <div class="inv-topbar">
            <div>
                <div class="inv-title">Invoice receipt</div>
                <div class="inv-subtitle">Official receipts issued to clients, grouped by client.</div>
            </div>
            <div class="inv-topbar-actions">
                <button class="inv-btn inv-btn-outline" onclick="window.invExportCSV()"><i data-lucide="download"></i> Export CSV</button>
                <button class="inv-btn inv-btn-outline" onclick="window.invOpenSettings()"><i data-lucide="settings"></i> Business settings</button>
                <button class="inv-btn inv-btn-outline" onclick="document.getElementById('invGuideModal').style.display='flex'" title="Learn how Invoice Receipt works"><i data-lucide="help-circle"></i> Guide</button>
                <button class="inv-btn inv-btn-primary" onclick="window.invShowForm(null)"><i data-lucide="plus"></i> New invoice</button>
            </div>
        </div>

        <div class="inv-stats-grid">
            <div class="inv-stat-card"><div class="inv-stat-label">Total invoices</div><div class="inv-stat-value">${_invoices.length}</div></div>
            <div class="inv-stat-card"><div class="inv-stat-label">Total billed</div><div class="inv-stat-value num">${_fmt(totalAmt)}</div></div>
            <div class="inv-stat-card"><div class="inv-stat-label">This month</div><div class="inv-stat-value num">${_fmt(monthAmt)}</div></div>
            <div class="inv-stat-card"><div class="inv-stat-label">Issued</div><div class="inv-stat-value">${issuedCount}</div></div>
        </div>

        <div class="inv-search">
            <i data-lucide="search"></i>
            <input id="invSearch" type="text" value="${_esc(_invSearch || '')}" placeholder="Search client or invoice no…" oninput="window.invFilter()">
        </div>

        <div class="inv-list">${cards}</div>`);

        if (_invSearchFocused) {
            const el = document.getElementById('invSearch');
            if (el) { el.focus(); const v = el.value; el.setSelectionRange(v.length, v.length); }
            _invSearchFocused = false;
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ══════════════════════════════════════════════════════
    // BUSINESS SETTINGS MODAL
    // ══════════════════════════════════════════════════════

    // ── Logo helpers ───────────────────────────────────────────────────
    function _logoToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Normalize logos array: old format (string[]) → new format ({src, enabled}[])
    function _normLogos(logos) {
        if (!logos) return [];
        return logos.map(l => (typeof l === 'string' ? { src: l, enabled: true } : l));
    }

    function _renderLogoSettingsGrid() {
        const logos = _normLogos(_defaults.logos);
        _defaults.logos = logos; // ensure normalized in memory
        const grid = document.getElementById('isLogoGrid');
        if (!grid) return;
        if (!logos.length) {
            grid.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:8px 0;">No logos uploaded yet.</div>';
            return;
        }
        grid.innerHTML = logos.map((logo, i) => `
            <div style="position:relative;display:inline-flex;flex-direction:column;align-items:center;margin:4px;gap:4px;">
                <div style="position:relative;">
                    <img src="${logo.src}"
                        style="height:56px;max-width:120px;object-fit:contain;border:1.5px solid ${logo.enabled ? '#059669' : '#e5e7eb'};border-radius:8px;background:repeating-conic-gradient(#e5e7eb 0% 25%,#fff 0% 50%) 0 0/12px 12px;padding:4px;opacity:${logo.enabled ? '1' : '0.45'};"
                        onerror="this.style.display='none'">
                    <button onclick="window._invRemoveLogo(${i})" title="Remove"
                        style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#ef4444;color:#fff;border:none;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;">✕</button>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                    ${i > 0 ? `<button onclick="window._invMoveLogo(${i},-1)" title="Move left"
                        style="width:20px;height:20px;border-radius:50%;background:#1e3a5f;color:#fff;border:none;cursor:pointer;font-size:11px;">◀</button>` : '<span style="width:20px;"></span>'}
                    <label title="Show in print" style="cursor:pointer;display:flex;align-items:center;">
                        <input type="checkbox" ${logo.enabled ? 'checked' : ''} onchange="window._invToggleLogo(${i},this.checked)"
                            style="width:13px;height:13px;cursor:pointer;">
                    </label>
                    ${i < logos.length - 1 ? `<button onclick="window._invMoveLogo(${i},1)" title="Move right"
                        style="width:20px;height:20px;border-radius:50%;background:#1e3a5f;color:#fff;border:none;cursor:pointer;font-size:11px;">▶</button>` : '<span style="width:20px;"></span>'}
                </div>
            </div>`).join('');
    }

    window._invRemoveLogo = function (i) {
        if (!_defaults.logos) return;
        _defaults.logos.splice(i, 1);
        _renderLogoSettingsGrid();
    };

    window._invMoveLogo = function (i, dir) {
        const logos = _defaults.logos || [];
        const j = i + dir;
        if (j < 0 || j >= logos.length) return;
        [logos[i], logos[j]] = [logos[j], logos[i]];
        _renderLogoSettingsGrid();
    };

    window._invToggleLogo = function (i, enabled) {
        const logos = _defaults.logos || [];
        if (logos[i]) logos[i].enabled = enabled;
        _renderLogoSettingsGrid();
    };

    window.invOpenSettings = function () {
        const d = _defaults;
        const pm = (d.paymentDetails && d.paymentDetails.method) || 'bank';
        const pd = d.paymentDetails || {};
        if (!_defaults.logos) _defaults.logos = [];

        const PH_BANKS = ['BDO Unibank','Bank of the Philippine Islands (BPI)','Metrobank','PNB (Philippine National Bank)',
            'Landbank of the Philippines','DBP (Development Bank of the Philippines)','UnionBank','Chinabank',
            'Robinsons Bank','EastWest Bank','Security Bank','RCBC','UCPB','Asia United Bank (AUB)',
            'Philippine Savings Bank (PSBank)','Maybank Philippines','Sterling Bank of Asia','CTBC Bank Philippines',
            'Bank of Commerce','PBB (Philippine Business Bank)'];
        const bankOptions = PH_BANKS.map(b => `<option value="${_esc(b)}" ${pd.bank === b ? 'selected' : ''}>${_esc(b)}</option>`).join('');

        const modal = document.createElement('div');
        modal.id = 'invSettingsModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
        modal.innerHTML = `
        <div style="background:#fff;border-radius:14px;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.18);">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f3f4f6;">
                <div>
                    <div style="font-size:15px;font-weight:700;color:#1a1a2e;">Business Settings</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:2px;">These details appear on all printed invoices</div>
                </div>
                <button onclick="document.getElementById('invSettingsModal').remove()"
                    style="background:none;border:none;cursor:pointer;color:#6b7280;padding:4px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div style="padding:20px 22px;display:flex;flex-direction:column;gap:14px;">

                <div class="inv-section-title">Company Information</div>
                <div class="inv-form-grid inv-form-grid--2">
                    <div class="inv-field inv-field--wide">
                        <label>Business Name</label>
                        <input class="inv-input" id="isBizName" value="${_esc(d.businessName || '')}">
                    </div>
                    <div class="inv-field">
                        <label>TIN No. <span style="font-weight:400;color:#9ca3af;">(optional)</span></label>
                        <input class="inv-input" id="isBizTin" value="${_esc(d.businessTin || '')}">
                    </div>
                    <div class="inv-field inv-field--wide">
                        <label>Business Address</label>
                        <input class="inv-input" id="isBizAddr" value="${_esc(d.businessAddress || '')}">
                    </div>
                </div>

                <!-- ── LOGO SECTION ── -->
                <div class="inv-section-title" style="margin-top:4px;">Invoice Logos</div>
                <div style="font-size:12px;color:#6b7280;margin-top:-8px;">Logos appear side-by-side in the invoice header. PNG with transparent background recommended.</div>

                <!-- Current logos -->
                <div id="isLogoGrid" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:32px;"></div>

                <!-- Upload button -->
                <div style="display:flex;align-items:center;gap:10px;">
                    <label for="isLogoUpload" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:#f0fdf4;border:1.5px dashed #059669;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;color:#059669;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Upload Logo
                    </label>
                    <input type="file" id="isLogoUpload" accept="image/png,image/jpeg,image/svg+xml,image/webp" multiple style="display:none;"
                        onchange="window._invHandleLogoUpload(this)">
                    <span style="font-size:11px;color:#9ca3af;">PNG, JPG, SVG · max 3 logos</span>
                </div>

                <div class="inv-section-title" style="margin-top:4px;">Payment Receiving Details</div>
                <div style="display:flex;gap:10px;margin-bottom:4px;">
                    <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
                        <input type="radio" name="isPayMethod" value="bank" ${pm === 'bank' ? 'checked' : ''} onchange="window._isTogglePay(this.value)"> Bank Transfer
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">
                        <input type="radio" name="isPayMethod" value="gcash" ${pm === 'gcash' ? 'checked' : ''} onchange="window._isTogglePay(this.value)"> GCash
                    </label>
                </div>

                <div id="isPayBank" style="display:${pm === 'bank' ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:10px;">
                    <div class="inv-field inv-field--wide">
                        <label>Bank Name</label>
                        <select class="inv-input" id="isBankName"><option value="">— Select Bank —</option>${bankOptions}</select>
                    </div>
                    <div class="inv-field">
                        <label>Account No.</label>
                        <input class="inv-input" id="isBankAccNo" value="${_esc(pd.accountNo || '')}">
                    </div>
                    <div class="inv-field">
                        <label>Account Name</label>
                        <input class="inv-input" id="isBankAccName" value="${_esc(pd.accountName || '')}">
                    </div>
                    <div class="inv-field">
                        <label>Branch</label>
                        <input class="inv-input" id="isBankBranch" value="${_esc(pd.branch || '')}">
                    </div>
                </div>

                <div id="isPayGcash" style="display:${pm === 'gcash' ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:10px;">
                    <div class="inv-field">
                        <label>GCash Number</label>
                        <input class="inv-input" id="isGcashNum" placeholder="09XXXXXXXXX" value="${_esc(pd.gcashNumber || '')}">
                    </div>
                    <div class="inv-field">
                        <label>Account Name</label>
                        <input class="inv-input" id="isGcashName" value="${_esc(pd.gcashName || '')}">
                    </div>
                </div>

                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
                    <button class="inv-btn inv-btn-outline" onclick="document.getElementById('invSettingsModal').remove()">Cancel</button>
                    <button class="inv-btn inv-btn-primary" onclick="window.invSaveSettings()">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                        Save Settings
                    </button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
        // Render existing logos after modal is in DOM
        _renderLogoSettingsGrid();
    };

    window._invHandleLogoUpload = async function (input) {
        const files = Array.from(input.files);
        if (!_defaults.logos) _defaults.logos = [];
        _defaults.logos = _normLogos(_defaults.logos); // ensure normalized
        for (const file of files) {
            if (_defaults.logos.length >= 3) { alert('Maximum 3 logos allowed.'); break; }
            if (file.size > 2 * 1024 * 1024) { alert(`"${file.name}" exceeds 2 MB and was skipped.`); continue; }
            const b64 = await _logoToBase64(file);
            _defaults.logos.push({ src: b64, enabled: true });
        }
        input.value = '';
        _renderLogoSettingsGrid();
    };

    window._isTogglePay = function (method) {
        const bank  = document.getElementById('isPayBank');
        const gcash = document.getElementById('isPayGcash');
        if (!bank || !gcash) return;
        bank.style.display  = method === 'bank'  ? 'grid' : 'none';
        gcash.style.display = method === 'gcash' ? 'grid' : 'none';
    };

    window.invSaveSettings = async function () {
        const method = document.querySelector('input[name="isPayMethod"]:checked')?.value || 'bank';
        let pd;
        if (method === 'gcash') {
            pd = {
                method: 'gcash',
                gcashNumber: document.getElementById('isGcashNum')?.value.trim() || '',
                gcashName:   document.getElementById('isGcashName')?.value.trim() || ''
            };
        } else {
            pd = {
                method: 'bank',
                bank:        document.getElementById('isBankName')?.value || '',
                accountNo:   document.getElementById('isBankAccNo')?.value.trim() || '',
                accountName: document.getElementById('isBankAccName')?.value.trim() || '',
                branch:      document.getElementById('isBankBranch')?.value.trim() || ''
            };
        }
        const newDefaults = {
            businessName:    document.getElementById('isBizName')?.value.trim() || '',
            businessTin:     document.getElementById('isBizTin')?.value.trim()  || '',
            businessAddress: document.getElementById('isBizAddr')?.value.trim() || '',
            paymentDetails:  pd,
            logos:           _normLogos(_defaults.logos)
        };
        try {
            await db.collection('settings').doc('invoiceDefaults').set(newDefaults, { merge: true });
            _defaults = newDefaults;
            document.getElementById('invSettingsModal')?.remove();
            _showToast('Business settings saved successfully.');
        } catch (e) {
            alert('Failed to save settings: ' + e.message);
        }
    };

    function _showToast(msg) {
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e3a5f;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    // ══════════════════════════════════════════════════════
    // FORM VIEW — New / Edit
    // ══════════════════════════════════════════════════════

    window.invTogglePayMethod = function () {
        const method = document.querySelector('input[name="invPayMethod"]:checked')?.value || 'bank';
        document.getElementById('invBankFields').style.display  = method === 'bank'  ? '' : 'none';
        document.getElementById('invGcashFields').style.display = method === 'gcash' ? '' : 'none';
    };

    // Hide/unhide one signature block. The name field is greyed out rather than
    // removed so the typed name survives an accidental untick — it is still
    // saved, and reappears the moment the block is switched back on.
    window.invToggleSig = function (key) {
        const id  = key.charAt(0).toUpperCase() + key.slice(1);
        const box = document.getElementById('invSigShow' + id);
        if (!box) return;
        ['invSigName', 'invSigOrg', 'invSigEsign'].forEach(prefix => {
            const el = document.getElementById(prefix + id);
            if (el) el.disabled = !box.checked;
        });
    };

    // Dim the header thumbnails when the logo is switched off, so the form
    // shows the same thing the printed sheet will.
    window.invToggleLogoPreview = function () {
        const on  = document.getElementById('invShowLogo')?.checked !== false;
        const pre = document.getElementById('invLogoPreview');
        if (pre) pre.classList.toggle('is-off', !on);
    };

    // Re-head the client block live (migration 0056), so the section title and
    // the three field labels say the same thing the sheet will print. Labels
    // only — no value is touched, so switching back and forth costs nothing.
    window.invSyncPartyLabel = function () {
        const label  = (document.getElementById('invPartyLabel')?.value || '').trim() || _PARTY_LABEL;
        const fields = _partyFields(label);
        const set = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };
        set('invPartyTitle',    label);
        set('invPartyNameLbl',  fields.name);
        set('invPartyTinLbl',   fields.tin);
        set('invPartyAddrLbl',  fields.address);
    };

    window.invShowForm = function (id) {
        _editId = id;
        const inv = id ? _invoices.find(i => i.id === id) : null;
        _renderForm(inv);
    };

    function _renderForm(inv) {
        const isEdit = !!inv;
        const d      = inv || {};
        const pd     = d.paymentDetails || _defaults.paymentDetails || {};
        // Saved defaults pre-fill NEW invoices only. An invoice written before
        // 0053 stores `{}`, and inheriting the current defaults into it would
        // silently re-sign a document that has already gone out — so on edit an
        // empty blob stays empty and prints the blank lines it always did.
        const sigs   = (d.signatories && Object.keys(d.signatories).length)
                        ? d.signatories
                        : (isEdit ? {} : (_defaults.signatories || {}));
        // Invoices written before 0054 have no showLogo, and they have always
        // printed the logo — so an existing one reads as ON rather than picking
        // up a default that would change how it reprints.
        const showLogo = d.showLogo != null
                        ? d.showLogo !== false
                        : (isEdit ? true : _defaults.showLogo !== false);
        // Same rule for the heading (0055): a saved default seeds a NEW invoice,
        // but an existing one keeps whatever it was titled — including the blank
        // that pre-0055 rows carry, which prints the house default.
        const docTitle = d.docTitle != null
                        ? d.docTitle
                        : (isEdit ? '' : (_defaults.docTitle || ''));
        // Same rule again for the client-block heading (0056). Resolved to a
        // concrete label rather than left blank, because a <select> has to have
        // one of its options marked selected — '' is a storage convention, not
        // a choice the dropdown can show.
        const partyLabel = _partyLabel(
            d.partyLabel != null ? d
                                 : (isEdit ? {} : { partyLabel: _defaults.partyLabel || '' })
        );
        const partyFields = _partyFields(partyLabel);
        // Thumbnails of the logos that would actually print, so the checkbox
        // says what it is switching off rather than making you guess.
        const logoThumbs = _normLogos(_defaults.logos)
            .filter(l => l.enabled !== false)
            .map(l => `<img src="${_esc(l.src)}" alt="" onerror="this.style.display='none'">`)
            .join('');
        const vatRate = d.vatRate != null ? d.vatRate
                       : (_defaults.vatRate != null ? _defaults.vatRate : 12);
        const items  = (d.items && d.items.length) ? d.items
                       : [{ description: '', qty: 1, unitPrice: 0, discount: 0, amount: 0 }];
        _itemCount = items.length;

        const itemRowsHtml = items.map((item, i) => _itemRowHtml(i, item)).join('');

        _setContent(`
        <div class="inv-form-header">
            <button class="inv-btn inv-btn-ghost" onclick="window.invBackToList()">
                <i data-lucide="arrow-left" style="width:15px;height:15px;"></i> Back
            </button>
            <h2 class="inv-page-title" style="margin:0;">${isEdit ? 'Edit Invoice' : 'New Invoice'}</h2>
            <div class="inv-header-actions">
                ${isEdit ? `<button class="inv-btn inv-btn-outline" onclick="window.invPrint('${inv.id}')">
                    <i data-lucide="printer" style="width:15px;height:15px;"></i> Print
                </button>
                <button class="inv-btn inv-btn-outline" onclick="window.invExportPDF('${inv.id}')">
                    <i data-lucide="file-down" style="width:15px;height:15px;"></i> Export PDF
                </button>` : ''}
                <button class="inv-btn inv-btn-secondary" onclick="window.invSaveDraft()">Save Draft</button>
                <button class="inv-btn inv-btn-primary" onclick="window.invIssue()">
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
                    <input type="text" id="invBusinessName" class="inv-input"
                           placeholder="e.g. DAC's Building Design"
                           value="${_esc(d.businessName || _defaults.businessName || '')}">
                </div>
                <div class="inv-field">
                    <label>Business TIN</label>
                    <input type="text" id="invBusinessTin" class="inv-input"
                           placeholder="000-000-000-000"
                           value="${_esc(d.businessTin || _defaults.businessTin || '')}">
                </div>
                <div class="inv-field inv-field--wide">
                    <label>Business Address</label>
                    <input type="text" id="invBusinessAddress" class="inv-input"
                           placeholder="Full business address"
                           value="${_esc(d.businessAddress || _defaults.businessAddress || '')}">
                </div>
            </div>

            <div class="inv-logo-toggle">
                <label class="inv-check" for="invShowLogo">
                    <input type="checkbox" id="invShowLogo" ${showLogo ? 'checked' : ''}
                           onchange="window.invToggleLogoPreview()">Print the logo in this invoice's header
                </label>
                ${logoThumbs
                    ? `<div class="inv-logo-preview${showLogo ? '' : ' is-off'}" id="invLogoPreview">${logoThumbs}</div>`
                    : `<span class="inv-logo-none">No logo uploaded —
                        <a href="#" onclick="window.invOpenSettings();return false;">add one in Business Settings</a>.</span>`}
            </div>

            <div class="inv-section-title" style="margin-top:20px;">Invoice Details</div>
            <div class="inv-form-grid inv-form-grid--3">
                <div class="inv-field">
                    <label>Invoice No.</label>
                    <input type="text" id="invNo" class="inv-input"
                           placeholder="Auto-generated"
                           value="${_esc(d.invoiceNo || '')}"
                           ${isEdit ? '' : 'readonly'}>
                </div>
                <div class="inv-field">
                    <label>Date</label>
                    <input type="date" id="invDate" class="inv-input"
                           value="${d.date || _todayStr()}">
                </div>
                <div class="inv-field">
                    <label for="invDocTitle">Document Title</label>
                    <input type="text" id="invDocTitle" class="inv-input"
                           placeholder="${_DOC_TITLE}" value="${_esc(docTitle)}">
                </div>
            </div>
            <p class="inv-sig-hint" style="margin-top:8px;">
                The heading opposite the logo — leave it blank for
                <em>${_DOC_TITLE}</em>, or set it to <em>Progress Billing</em>,
                <em>Billing Statement</em>, <em>Proforma Invoice</em>… It prints in
                capitals to match the letterhead.
            </p>

            <div class="inv-section-title" style="margin-top:20px;"
                 id="invPartyTitle">${_esc(partyLabel)}</div>
            <div class="inv-form-grid inv-form-grid--3">
                <div class="inv-field">
                    <label for="invPartyLabel">Heading</label>
                    <select id="invPartyLabel" class="inv-input"
                            onchange="window.invSyncPartyLabel()">
                        ${_PARTY_LABELS.map(l => `<option value="${_esc(l)}"${
                            l === partyLabel ? ' selected' : ''}>${_esc(l)}</option>`).join('')}
                    </select>
                </div>
                <div class="inv-field">
                    <label id="invPartyNameLbl" for="invClientName">${_esc(partyFields.name)}</label>
                    <input type="text" id="invClientName" class="inv-input"
                           placeholder="Full name"
                           value="${_esc(d.clientName || '')}">
                </div>
                <div class="inv-field">
                    <label id="invPartyTinLbl" for="invClientTin">${_esc(partyFields.tin)}</label>
                    <input type="text" id="invClientTin" class="inv-input"
                           placeholder="000-000-000-000"
                           value="${_esc(d.clientTin || '')}">
                </div>
                <div class="inv-field inv-field--wide">
                    <label id="invPartyAddrLbl" for="invClientAddress">${_esc(partyFields.address)}</label>
                    <input type="text" id="invClientAddress" class="inv-input"
                           placeholder="Full address"
                           value="${_esc(d.clientAddress || '')}">
                </div>
            </div>
            <p class="inv-sig-hint" style="margin-top:8px;">
                What this block is called on the printed sheet. Leave it on
                <em>${_esc(_PARTY_LABEL)}</em> for an invoice; switch it to
                <em>Received From</em> when the document is a receipt — it pairs
                with an <em>Acknowledgement Receipt</em> title above.
            </p>

            <div class="inv-section-title" style="margin-top:20px;">Items / Services</div>
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
                    <tbody id="invItemsBody">${itemRowsHtml}</tbody>
                </table>
                <button class="inv-add-item-btn" onclick="window.invAddItem()">
                    <i data-lucide="plus-circle" style="width:14px;height:14px;"></i> Add Item
                </button>
            </div>

            <div class="inv-totals-wrap">
                <div class="inv-totals-row">
                    <span>Total Sales</span>
                    <span id="invSubtotal">₱ 0.00</span>
                </div>
                <div class="inv-totals-row inv-totals-row--total">
                    <span>TOTAL AMOUNT DUE</span>
                    <span id="invTotal">₱ 0.00</span>
                </div>
            </div>

            <div class="inv-section-title" style="margin-top:24px;">Payment Details</div>

            <!-- Payment Method Toggle -->
            <div style="display:flex;gap:10px;margin-bottom:16px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px;font-weight:500;color:#374151;">
                    <input type="radio" name="invPayMethod" value="bank" id="invPayMethodBank"
                        ${(!pd.method || pd.method === 'bank') ? 'checked' : ''}
                        onchange="invTogglePayMethod()"> Bank Transfer
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px;font-weight:500;color:#374151;">
                    <input type="radio" name="invPayMethod" value="gcash" id="invPayMethodGcash"
                        ${pd.method === 'gcash' ? 'checked' : ''}
                        onchange="invTogglePayMethod()"> GCash
                </label>
            </div>

            <!-- Bank Fields -->
            <div id="invBankFields" class="inv-form-grid inv-form-grid--2" style="${pd.method === 'gcash' ? 'display:none;' : ''}">
                <div class="inv-field">
                    <label>Bank Name</label>
                    <select id="invBank" class="inv-input">
                        <option value="">— Select Bank —</option>
                        ${['BDO','BPI','Metrobank','PNB','UnionBank','Landbank','DBP','Chinabank','Security Bank','RCBC','EastWest Bank','PBCom','Asia United Bank','Robinsons Bank','Sterling Bank','CTBC Bank','Maybank','HSBC','Citibank','Other'].map(b =>
                            `<option value="${b}" ${pd.bank === b ? 'selected' : ''}>${b}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="inv-field">
                    <label>Account No.</label>
                    <input type="text" id="invAccountNo" class="inv-input"
                           placeholder="Account number" value="${_esc(pd.accountNo || '')}">
                </div>
                <div class="inv-field">
                    <label>Account Name</label>
                    <input type="text" id="invAccountName" class="inv-input"
                           placeholder="Account holder name" value="${_esc(pd.accountName || '')}">
                </div>
                <div class="inv-field">
                    <label>Branch</label>
                    <input type="text" id="invBranch" class="inv-input"
                           placeholder="Branch (optional)" value="${_esc(pd.branch || '')}">
                </div>
            </div>

            <!-- GCash Fields -->
            <div id="invGcashFields" class="inv-form-grid inv-form-grid--2" style="${pd.method !== 'gcash' ? 'display:none;' : ''}">
                <div class="inv-field">
                    <label>GCash Number</label>
                    <input type="text" id="invGcashNumber" class="inv-input"
                           placeholder="09XX XXX XXXX" value="${_esc(pd.gcashNumber || '')}">
                </div>
                <div class="inv-field">
                    <label>Account Name</label>
                    <input type="text" id="invGcashName" class="inv-input"
                           placeholder="GCash account name" value="${_esc(pd.gcashName || '')}">
                </div>
            </div>

            <div class="inv-section-title" style="margin-top:24px;">Signatories</div>
            <p class="inv-sig-hint">
                Printed above each signature line: the name, then the company or
                position under it. Untick <em>Show</em> to leave that block off the
                invoice, or leave the fields blank for a line that gets signed by hand.
                <em>E-sign</em> stamps the DAC'S signature above the rule — use it on
                your own blocks, not on the client's.
            </p>
            <div class="inv-form-grid inv-form-grid--3">
                ${_SIG_KEYS.map(({ key, label }) => {
                    const s  = _sig(sigs, key);
                    const id = key.charAt(0).toUpperCase() + key.slice(1);
                    const off = s.show ? '' : 'disabled';
                    return `<div class="inv-field">
                        <div class="inv-sig-head">
                            <label for="invSigName${id}">${label}</label>
                            <span class="inv-sig-switches">
                                <label class="inv-check" for="invSigShow${id}">
                                    <input type="checkbox" id="invSigShow${id}" ${s.show ? 'checked' : ''}
                                           onchange="window.invToggleSig('${key}')">Show
                                </label>
                                <label class="inv-check" for="invSigEsign${id}">
                                    <input type="checkbox" id="invSigEsign${id}" ${s.esign ? 'checked' : ''}
                                           ${off}>E-sign
                                </label>
                            </span>
                        </div>
                        <input type="text" id="invSigName${id}" class="inv-input"
                               placeholder="Name (optional)" value="${_esc(s.name)}" ${off}>
                        <input type="text" id="invSigOrg${id}" class="inv-input inv-input--sub"
                               placeholder="Company or position (optional)" value="${_esc(s.org)}" ${off}>
                    </div>`;
                }).join('')}
            </div>

            <div class="inv-section-title" style="margin-top:20px;">Notes / Memo</div>
            <textarea id="invNotes" class="inv-textarea" rows="3"
                      placeholder="Additional notes or instructions...">${_esc(d.notes || '')}</textarea>

            <label class="inv-save-defaults-label">
                <input type="checkbox" id="invSaveDefaults">
                Save business info, payment details, signatories &amp; document title as defaults for future invoices
            </label>

        </div>
        </div>`);

        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Auto-generate invoice number for new invoices
        if (!isEdit) {
            _generateInvoiceNo().then(no => {
                const el = document.getElementById('invNo');
                if (el) el.value = no;
            });
        }

        window.invRecalc();
    }

    // ── Line Item Row HTML ─────────────────────────────────────────────
    function _itemRowHtml(i, item) {
        return `<tr id="invRow_${i}">
            <td><input type="text" class="inv-input inv-input--sm" id="invDesc_${i}"
                value="${_esc(item.description || '')}" placeholder="Description or service"></td>
            <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="invQty_${i}"
                value="${item.qty != null ? item.qty : 1}" min="0" step="any"
                oninput="window.invRecalc()"></td>
            <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="invPrice_${i}"
                value="${item.unitPrice != null ? item.unitPrice : 0}" min="0" step="any"
                oninput="window.invRecalc()"></td>
            <td><input type="number" class="inv-input inv-input--sm inv-input--num" id="invDisc_${i}"
                value="${item.discount != null ? item.discount : 0}" min="0" max="100" step="any"
                oninput="window.invRecalc()"></td>
            <td><span class="inv-item-amt" id="invAmt_${i}">${_fmt(item.amount || 0)}</span></td>
            <td><button class="inv-del-row-btn" title="Remove row"
                onclick="window.invRemoveItem(${i})">
                <i data-lucide="x" style="width:12px;height:12px;"></i>
            </button></td>
        </tr>`;
    }

    // ── Add / Remove line items ────────────────────────────────────────
    window.invAddItem = function () {
        const tbody = document.getElementById('invItemsBody');
        if (!tbody) return;
        const i = _itemCount++;
        const tmp = document.createElement('table');
        tmp.innerHTML = '<tbody>' + _itemRowHtml(i, { description: '', qty: 1, unitPrice: 0, discount: 0, amount: 0 }) + '</tbody>';
        tbody.appendChild(tmp.querySelector('tbody tr'));
        if (typeof lucide !== 'undefined') lucide.createIcons();
        window.invRecalc();
    };

    window.invRemoveItem = function (i) {
        const row = document.getElementById('invRow_' + i);
        if (row) row.remove();
        window.invRecalc();
    };

    // ── Recalculate totals ─────────────────────────────────────────────
    window.invRecalc = function () {
        let subtotal = 0;
        document.querySelectorAll('#invItemsBody tr').forEach(row => {
            const id    = row.id.replace('invRow_', '');
            const qty   = parseFloat(document.getElementById('invQty_'   + id)?.value)   || 0;
            const price = parseFloat(document.getElementById('invPrice_' + id)?.value)   || 0;
            const disc  = parseFloat(document.getElementById('invDisc_'  + id)?.value)   || 0;
            const amt   = qty * price * (1 - disc / 100);
            subtotal += amt;
            const amtEl = document.getElementById('invAmt_' + id);
            if (amtEl) amtEl.textContent = _fmt(amt);
        });

        _setText('invSubtotal', _fmt(subtotal));
        _setText('invTotal',    _fmt(subtotal));
    };

    // ══════════════════════════════════════════════════════
    // COLLECT FORM DATA
    // ══════════════════════════════════════════════════════

    function _collectForm(status) {
        const items = [];
        document.querySelectorAll('#invItemsBody tr').forEach(row => {
            const id    = row.id.replace('invRow_', '');
            const desc  = (document.getElementById('invDesc_'  + id)?.value  || '').trim();
            const qty   = parseFloat(document.getElementById('invQty_'   + id)?.value) || 0;
            const price = parseFloat(document.getElementById('invPrice_' + id)?.value) || 0;
            const disc  = parseFloat(document.getElementById('invDisc_'  + id)?.value) || 0;
            const amt   = qty * price * (1 - disc / 100);
            if (desc || qty || price) {
                items.push({ description: desc, qty, unitPrice: price, discount: disc, amount: amt });
            }
        });

        const subtotal = items.reduce((s, it) => s + it.amount, 0);

        return {
            userId:          _ownerUid,
            invoiceNo:       (document.getElementById('invNo')?.value              || '').trim(),
            date:            document.getElementById('invDate')?.value             || _todayStr(),
            businessName:    (document.getElementById('invBusinessName')?.value    || '').trim(),
            businessTin:     (document.getElementById('invBusinessTin')?.value     || '').trim(),
            businessAddress: (document.getElementById('invBusinessAddress')?.value || '').trim(),
            clientName:      (document.getElementById('invClientName')?.value      || '').trim(),
            clientTin:       (document.getElementById('invClientTin')?.value       || '').trim(),
            clientAddress:   (document.getElementById('invClientAddress')?.value   || '').trim(),
            items,
            subtotal,
            totalAmount: subtotal,
            paymentDetails: (function() {
                const method = document.querySelector('input[name="invPayMethod"]:checked')?.value || 'bank';
                if (method === 'gcash') {
                    return {
                        method:      'gcash',
                        gcashNumber: (document.getElementById('invGcashNumber')?.value || '').trim(),
                        gcashName:   (document.getElementById('invGcashName')?.value   || '').trim(),
                    };
                }
                return {
                    method:      'bank',
                    bank:        (document.getElementById('invBank')?.value        || '').trim(),
                    accountNo:   (document.getElementById('invAccountNo')?.value   || '').trim(),
                    accountName: (document.getElementById('invAccountName')?.value || '').trim(),
                    branch:      (document.getElementById('invBranch')?.value      || '').trim(),
                };
            })(),
            docTitle: (document.getElementById('invDocTitle')?.value || '').trim(),
            // The house default is stored as '' (see 0056), never as the literal
            // words — so re-heading every invoice that never overrode it stays a
            // one-line change to _PARTY_LABEL.
            partyLabel: (function () {
                const v = (document.getElementById('invPartyLabel')?.value || '').trim();
                return v === _PARTY_LABEL ? '' : v;
            })(),
            showLogo: document.getElementById('invShowLogo')?.checked !== false,
            signatories: (function () {
                const out = {};
                _SIG_KEYS.forEach(({ key }) => {
                    const id = key.charAt(0).toUpperCase() + key.slice(1);
                    out[key] = {
                        name:  (document.getElementById('invSigName' + id)?.value || '').trim(),
                        org:   (document.getElementById('invSigOrg'  + id)?.value || '').trim(),
                        esign: document.getElementById('invSigEsign' + id)?.checked === true,
                        show:  document.getElementById('invSigShow'  + id)?.checked !== false
                    };
                });
                return out;
            })(),
            notes:  (document.getElementById('invNotes')?.value || '').trim(),
            status: status || 'draft'
        };
    }

    // ══════════════════════════════════════════════════════
    // SAVE (Draft or Issue)
    // ══════════════════════════════════════════════════════

    async function _save(status) {
        const data = _collectForm(status);
        if (!data.clientName)   { alert('Please enter a customer name.');     return; }
        if (!data.items.length) { alert('Please add at least one line item.'); return; }

        // Persist defaults if checkbox is checked
        if (document.getElementById('invSaveDefaults')?.checked) {
            try {
                await db.collection('settings').doc('invoiceDefaults').set({
                    businessName:    data.businessName,
                    businessTin:     data.businessTin,
                    businessAddress: data.businessAddress,
                    vatRate:         data.vatRate,
                    paymentDetails:  data.paymentDetails,
                    signatories:     data.signatories,
                    showLogo:        data.showLogo,
                    docTitle:        data.docTitle,
                    partyLabel:      data.partyLabel
                }, { merge: true });
                _defaults = {
                    ..._defaults,   // keep `logos`, which this form never edits
                    businessName: data.businessName, businessTin: data.businessTin,
                    businessAddress: data.businessAddress, vatRate: data.vatRate,
                    paymentDetails: data.paymentDetails,
                    signatories: data.signatories,
                    showLogo: data.showLogo,
                    docTitle: data.docTitle,
                    partyLabel: data.partyLabel
                };
            } catch (e) { console.warn('InvoiceModule: could not save defaults', e); }
        }

        const now = firebase.firestore.FieldValue.serverTimestamp();
        try {
            if (_editId) {
                await db.collection('invoices').doc(_editId).update({ ...data, updatedAt: now });
                const idx = _invoices.findIndex(i => i.id === _editId);
                if (idx >= 0) _invoices[idx] = { id: _editId, ...data };
            } else {
                const ref = await db.collection('invoices').add({
                    ...data,
                    createdAt: now,
                    updatedAt: now,
                    createdBy: firebase.auth().currentUser?.uid || ''
                });
                _editId = ref.id;
                _invoices.unshift({ id: ref.id, ...data });
            }
            if (status === 'issued') {
                _doPrint({ id: _editId, ...data });
                // Notify the client IF the invoice carries a clientUid.
                // The manual `_collectForm` doesn't capture clientUid, so this
                // only fires when re-issuing an existing invoice that was
                // originally generated from a payment request (which has it).
                // For purely manual invoices the client isn't in the portal
                // anyway — the printed copy is the delivery medium.
                const cached = _invoices.find(i => i.id === _editId);
                const clientUid = (cached && cached.clientUid) || data.clientUid || '';
                if (clientUid) {
                    db.collection('notifications').doc(clientUid).collection('items').add({
                        type:      'invoice_issued',
                        message:   `Invoice ${data.invoiceNo} (₱${(Number(data.totalAmount) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) has been issued.`,
                        isRead:    false,
                        relatedId: _editId,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    }).catch(e => console.warn('invoice notify error:', e));
                }
            }
            _renderList();
        } catch (e) {
            console.error('InvoiceModule: save error', e);
            alert('Error saving invoice: ' + e.message);
        }
    }

    window.invSaveDraft = function () { _save('draft'); };
    window.invIssue     = function () { _save('issued'); };

    // ══════════════════════════════════════════════════════
    // AUTO-GENERATE INVOICE FROM VERIFIED PAYMENT REQUEST
    // ══════════════════════════════════════════════════════

    window.invGenerateFromPaymentRequest = async function (req) {
        try {
            // Ensure owner uid and defaults are ready
            if (!_ownerUid) await _resolveOwnerUid();
            if (!_defaults || !Object.keys(_defaults).length) await _loadDefaults();

            const invoiceNo = await _generateInvoiceNo();
            const amount    = parseFloat(req.paidAmount ?? req.amount) || 0;
            const desc      = [req.projectName, req.billingPeriod].filter(Boolean).join(' – ');
            const pd        = _defaults.paymentDetails || {};

            const data = {
                userId:          _ownerUid,
                invoiceNo,
                date:            _todayStr(),
                businessName:    _defaults.businessName    || '',
                businessTin:     _defaults.businessTin     || '',
                businessAddress: _defaults.businessAddress || '',
                clientName:      req.clientName || req.clientEmail || '',
                clientTin:       req.clientTin  || '',
                clientAddress:   req.clientAddress || '',
                items: [{ description: desc || 'Payment', qty: 1, unitPrice: amount, discount: 0, amount }],
                subtotal:        amount,
                totalAmount:     amount,
                paymentDetails:  { ...pd },
                showLogo:        _defaults.showLogo !== false,
                docTitle:        _defaults.docTitle || '',
                partyLabel:      _defaults.partyLabel || '',
                // Auto-generated invoices carry the saved signatories, so a
                // system-issued invoice signs the same way a hand-written one does.
                signatories:     { ..._defaults.signatories },
                notes:           req.referenceNumber ? 'Ref. No.: ' + req.referenceNumber : '',
                status:          'issued',
                paymentRequestId: req.id   || '',
                clientEmail:     req.clientEmail || '',
                clientUid:       req.clientUid   || ''
            };

            const now = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await db.collection('invoices').add({
                ...data,
                createdAt: now,
                updatedAt: now,
                createdBy: firebase.auth().currentUser?.uid || ''
            });

            // Keep local cache in sync
            _invoices.unshift({ id: ref.id, ...data });

            // Notify the client that an invoice is available. Auto-generated
            // invoices follow a verified payment request, so we already have
            // the client's uid — direct write to their notification inbox.
            // The client also receives a `payment_verified` notification from
            // payment-requests.js; the two are intentionally distinct events.
            if (req.clientUid) {
                db.collection('notifications').doc(req.clientUid).collection('items').add({
                    type:      'invoice_issued',
                    message:   `Invoice ${data.invoiceNo} for ${desc || 'your payment'} (₱${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) is now available.`,
                    isRead:    false,
                    relatedId: ref.id,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(e => console.warn('invoice notify error:', e));
            }

            return ref.id;
        } catch (e) {
            console.error('InvoiceModule: auto-generate error', e);
            return null;
        }
    };

    // ══════════════════════════════════════════════════════
    // AUTO-GENERATE INVOICE FROM APPROVED TERMINATION REQUEST
    // ══════════════════════════════════════════════════════
    // Called from termination-requests.js when an admin closes a project
    // out — either COMPLETED (finished properly) or TERMINATED (cut short).
    // Mirrors invGenerateFromPaymentRequest, but the line item describes the
    // balance still owed at closeout. Carries `terminationRequestId` for the
    // audit trail.
    //
    // The amount is identical for both endings — this is a cost-plus system,
    // so the client owes actual direct costs + management fee either way and
    // `budget` is an estimate, never a price. Only the wording differs, and
    // it matters: a client who finished a project should not receive a
    // document that says their project was terminated.

    window.invGenerateFromCloseout = async function (req) {
        try {
            if (!_ownerUid) await _resolveOwnerUid();
            if (!_defaults || !Object.keys(_defaults).length) await _loadDefaults();

            const invoiceNo = await _generateInvoiceNo();
            const amount    = Number(req.remainingBalance) || 0;
            if (amount <= 0) return null;
            const pd        = _defaults.paymentDetails || {};
            const done      = req.outcome === 'completed';
            const proj      = req.projectName || 'Untitled';
            const desc      = done
                ? `Final balance — Project completed: ${proj}`
                : `Final balance — Project terminated: ${proj}`;
            const noteText  = done
                ? 'Final invoice issued upon completion of construction project. Please settle the remaining balance to close out the project.'
                : 'Final invoice issued upon termination of construction project. Please settle the remaining balance.';

            const data = {
                userId:          _ownerUid,
                invoiceNo,
                date:            _todayStr(),
                businessName:    _defaults.businessName    || '',
                businessTin:     _defaults.businessTin     || '',
                businessAddress: _defaults.businessAddress || '',
                clientName:      req.clientName || req.clientEmail || '',
                clientTin:       '',
                clientAddress:   '',
                items: [{ description: desc, qty: 1, unitPrice: amount, discount: 0, amount }],
                subtotal:        amount,
                totalAmount:     amount,
                paymentDetails:  { ...pd },
                showLogo:        _defaults.showLogo !== false,
                docTitle:        _defaults.docTitle || '',
                partyLabel:      _defaults.partyLabel || '',
                signatories:     { ..._defaults.signatories },
                notes:           noteText,
                status:          'issued',
                terminationRequestId: req.id || '',
                clientEmail:     req.clientEmail || '',
                clientUid:       req.clientUid   || ''
            };

            const now = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await db.collection('invoices').add({
                ...data,
                createdAt: now,
                updatedAt: now,
                createdBy: firebase.auth().currentUser?.uid || ''
            });

            _invoices.unshift({ id: ref.id, ...data });

            // Notify the client. They're already getting the closeout
            // notification from termination-requests.js; this is the matching
            // "and here's what you owe" message. Two distinct events, two
            // notifications, both navigate to different sections.
            if (req.clientUid) {
                const peso = '₱' + amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                db.collection('notifications').doc(req.clientUid).collection('items').add({
                    type:      'invoice_issued',
                    message:   `Final invoice ${data.invoiceNo} (${peso}) has been issued for the ${done ? 'completed' : 'terminated'} project "${proj}".`,
                    isRead:    false,
                    relatedId: ref.id,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(e => console.warn('closeout invoice notify error:', e));
            }

            return ref.id;
        } catch (e) {
            console.error('InvoiceModule: closeout auto-generate error', e);
            return null;
        }
    };

    // Back-compat alias — the old name meant "terminated" only.
    window.invGenerateFromTermination = window.invGenerateFromCloseout;

    window.invPrintById = function (inv) { _doPrint(inv); };

    // ══════════════════════════════════════════════════════
    // DELETE
    // ══════════════════════════════════════════════════════

    window.invDelete = async function (id) {
        if (!await window.showDeleteConfirm('Delete this invoice? This cannot be undone.')) return;
        db.collection('invoices').doc(id).delete()
            .then(() => {
                _invoices = _invoices.filter(i => i.id !== id);
                _renderList();
            })
            .catch(e => alert('Delete failed: ' + e.message));
    };

    // ══════════════════════════════════════════════════════
    // NAVIGATION
    // ══════════════════════════════════════════════════════

    window.invBackToList = function () {
        _editId = null;
        _renderList();
    };

    // ══════════════════════════════════════════════════════
    // PRINT — opens a formatted invoice in a new window
    // ══════════════════════════════════════════════════════

    window.invPrint = function (id) {
        const inv = _invoices.find(i => i.id === id);
        if (!inv) { alert('Invoice not found.'); return; }
        _doPrint(inv, false);
    };

    window.invPreview = function (id) {
        const inv = _invoices.find(i => i.id === id);
        if (!inv) { alert('Invoice not found.'); return; }
        _doPrint(inv, true);
    };

    // Letterhead mark for the SALES INVOICE — left-aligned, sitting directly
    // above the business name, which is the arrangement every DAC'S statement
    // already uses (print-utils.js §ws-hd). The old centred strip above a rule
    // read as a second, competing letterhead.
    //
    // Falls back to DACS-LETTERHEAD.png when nothing has been uploaded in
    // Business Settings. That file is the artwork trimmed to its ink bounds;
    // DACS-TRANSPARENT.png is a 2048² square whose mark fills only the middle
    // 62.5% of the canvas, so at the same CSS height it renders a third smaller
    // — the reason the statements switched files. Same logic here.
    // The marks that belong in the letterhead, in print order. Shared by the
    // print sheet and the PDF export so the two can never disagree about which
    // logo an invoice carries.
    function _letterheadSrcs(logos) {
        const list = _normLogos(logos);
        // Nothing uploaded at all → the built-in letterhead. Uploading logos and
        // then unticking them is a deliberate "no mark", so that stays empty;
        // the fallback only fills a blank, it never overrides a choice.
        return list.length
            ? list.filter(l => l.enabled !== false).map(l => l.src)
            : [window.location.origin + '/assets/images/DACS-LETTERHEAD.png'];
    }

    function _buildLetterheadLogos(logos) {
        const srcs = _letterheadSrcs(logos);
        if (!srcs.length) return '';
        return `<div class="inv-logo-row">${srcs.map(src =>
            `<img class="inv-logo" src="${_pEsc(src)}" alt="" onerror="this.style.display='none'">`
        ).join('')}</div>`;
    }

    // Centred strip used by the Receipt of Payment sheet, which has no business
    // block under its mark and so still wants the logo across the top.
    function _buildLogoHtml(logos) {
        if (!logos || !logos.length) return '';
        // Normalize and filter to only enabled logos
        const enabled = _normLogos(logos).filter(l => l.enabled !== false);
        if (!enabled.length) return '';
        const imgs = enabled.map(l =>
            `<img src="${l.src}"
                  style="height:64px;max-width:140px;width:auto;object-fit:contain;flex-shrink:0;mix-blend-mode:multiply;"
                  onerror="this.style.display='none'">`
        ).join('');
        const justification = enabled.length === 1 ? 'center' : 'space-evenly';
        return `
  <div style="display:flex;align-items:center;justify-content:${justification};gap:24px;
              padding:12px 0 16px;border-bottom:2.5px solid #1e3a5f;margin-bottom:18px;
              flex-wrap:nowrap;overflow:hidden;">
    ${imgs}
  </div>`;
    }

    function _doPrint(inv, previewOnly) {
        // Fall back to saved defaults for fields the invoice may not have
        const pd       = Object.assign({}, _defaults.paymentDetails || {}, inv.paymentDetails || {});
        const bizName  = inv.businessName    || _defaults.businessName    || 'Business Name';
        const bizTin   = inv.businessTin     || _defaults.businessTin     || '—';
        const bizAddr  = inv.businessAddress || _defaults.businessAddress || '—';
        const vatLabel = (inv.vatRate != null ? inv.vatRate : (_defaults.vatRate != null ? _defaults.vatRate : 12)) + '%';
        // WHICH logos exist is a global setting; whether THIS invoice prints
        // them is on the row (0054). An invoice written before 0054 has no flag
        // and prints the logo, exactly as it always did.
        const logoHtml = inv.showLogo === false ? '' : _buildLetterheadLogos(_defaults.logos);

        const itemRows = (inv.items || []).map((item, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${_pEsc(item.description || '')}</td>
                <td style="text-align:center;">${item.qty}</td>
                <td style="text-align:right;">${_fmt(item.unitPrice)}</td>
                <td style="text-align:center;">${item.discount || 0}%</td>
                <td style="text-align:right;font-weight:600;">${_fmt(item.amount)}</td>
            </tr>`).join('');

        // Signature blocks. Hidden blocks drop out entirely; if the invoice
        // hides all three, the whole row goes rather than leaving a gap above
        // the footer. `space-between` on one or two blocks would push them to
        // the page edges, so the row switches to `space-around` when it isn't
        // carrying the full set of three.
        const sigBlocks = _SIG_KEYS
            .map(({ key, label }) => ({ label, ...(_sig(inv.signatories, key)) }))
            .filter(s => s.show);
        const eSignSrc = window.location.origin + '/assets/images/dacs-signature.png';
        const sigRow = !sigBlocks.length ? '' : `
  <div class="sig-row"${sigBlocks.length < 3 ? ' style="justify-content:space-around;"' : ''}>
    ${sigBlocks.map(s => `<div class="sig-block">
      <div class="sig-mark">
        ${s.esign ? `<img class="sig-img" src="${eSignSrc}" alt=""
             onerror="this.style.display='none'">` : ''}
        ${s.name ? `<div class="sig-name">${_pEsc(s.name)}</div>` : ''}
        ${s.org  ? `<div class="sig-org">${_pEsc(s.org)}</div>`   : ''}
      </div>
      <div class="sig-line">${_pEsc(s.label)}</div>
    </div>`).join('')}
  </div>`;

        const w = window.open('', '_blank', 'width=870,height=1100');
        if (!w) { alert('Please allow pop-ups to print the invoice.'); return; }

        w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${previewOnly ? 'Preview' : 'Print'} — ${_pEsc(_docTitle(inv))} ${_pEsc(inv.invoiceNo || '')}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'IBM Plex Sans', Arial, Helvetica, sans-serif; font-size: 13px; color: #1c1c1a; background: #f1f0ed; }
/* A column flex box so the footer can claim the leftover height with
   margin-top:auto and sit on the bottom edge of the sheet — a short invoice
   used to leave it floating directly under the signatures, halfway up the
   page. min-height (not height) means a long invoice still grows normally,
   and flex-shrink:0 on the children stops the items table being squeezed if
   it ever does outgrow one sheet. */
.page { width: 210mm; min-height: 297mm; margin: 20px auto; padding: 18mm 16mm 14mm;
        background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.12);
        display: flex; flex-direction: column; }
.page > * { flex-shrink: 0; }

/* Letterhead — the 2px rule that used to sit under a centred logo strip now
   closes the whole header, so the mark, the business block and the document
   title read as one letterhead instead of two stacked ones. */
.inv-header  { display:flex; justify-content:space-between; align-items:flex-start;
               gap:32px; border-bottom:2px solid #1c1c1a; padding-bottom:14px; }
.inv-logo-row { display:flex; align-items:center; gap:20px; margin-bottom:10px; }
/* object-position:left keeps a wide mark flush to the text column below it.
   mix-blend-mode:multiply drops the white plate on logos exported without
   transparency, so they don't sit in a visible box. */
.inv-logo    { height:82px; width:auto; max-width:240px; object-fit:contain;
               object-position:left center; display:block; mix-blend-mode:multiply; }
.inv-biz h1  { font-size:19px; font-weight:700; color:#1c1c1a; letter-spacing:.04em; line-height:1.25; }
.inv-biz p   { font-size:11.5px; color:#6f6e69; margin-top:5px; line-height:1.6; }
/* max-width, not flex-shrink:0 — an editable title (0055) can be longer than
   "SALES INVOICE", and it has to wrap inside the right margin rather than run
   off the sheet or crush the business block beside it. */
.inv-title-block { text-align:right; flex-shrink:0; max-width:44%; }
.inv-title-block h2 { font-size:22px; font-weight:700; color:#157a52; letter-spacing:2px;
                      text-transform:uppercase; line-height:1.15; }
.inv-meta    { margin-top:10px; font-size:12px; color:#444; line-height:1.8; }
.inv-meta strong { color:#111; }

/* Bill To — the header already carries the heavy rule above it. */
.bill-row { display:flex; gap:32px; margin-bottom:18px; padding:14px 0;
            border-bottom:1px solid #ededea; }
.bill-to h4 { font-size:10px; font-weight:600; color:#9b9a94; letter-spacing:1.5px;
              text-transform:uppercase; margin-bottom:6px; }
.bill-to .name { font-size:15px; font-weight:700; color:#1c1c1a; margin-bottom:3px; }
.bill-to p { font-size:12px; color:#6f6e69; line-height:1.5; }

/* Items Table */
table.items { width:100%; border-collapse:collapse; margin-bottom:14px;
              border:1px solid #ededea; border-radius:10px; overflow:hidden; }
table.items thead tr { background:#fafaf8; color:#9b9a94; }
table.items thead th { padding:10px; font-size:10px; font-weight:600;
                       text-align:left; letter-spacing:.5px; text-transform:uppercase;
                       border-bottom:1px solid #ededea; }
table.items tbody td { padding:9px 10px; border-bottom:1px solid #f3f2ef;
                       vertical-align:top; font-size:12px; }

/* Totals */
.totals-wrap { display:flex; justify-content:flex-end; margin-bottom:20px; }
table.totals { width:280px; border-collapse:collapse; font-size:13px; }
table.totals td { padding:6px 10px; }
table.totals td:first-child { color:#555; }
table.totals td:last-child { text-align:right; font-weight:600; color:#111; }
table.totals tr.grand td { font-size:15px; font-weight:700; color:#0f6342;
                            background:#eaf4ef; padding:11px 13px; }
table.totals tr.grand td:first-child { color:#0f6342; border-radius:9px 0 0 9px; }
table.totals tr.grand td:last-child { border-radius:0 9px 9px 0; }

/* Payment Details */
.pay-box { background:#fafaf8; border:1px solid #ededea; border-radius:10px; padding:13px 16px; margin-bottom:18px; }
.pay-box h4 { font-size:10px; font-weight:600; color:#9b9a94; letter-spacing:1.5px;
              text-transform:uppercase; margin-bottom:10px; }
.pay-grid { display:grid; grid-template-columns:1fr 1fr; gap:5px 24px; font-size:12px; }
.pay-grid .lbl { color:#6b7280; }
.pay-grid .val { font-weight:600; color:#111; }

/* Notes */
.notes-box { font-size:12px; color:#555; margin-bottom:20px; line-height:1.6; }
.notes-box strong { color:#374151; }

/* Signature — e-sign, name and company all stack ABOVE the rule; only the role
   label sits under it. */
/* margin-bottom is the minimum gap before the footer once the footer stops
   floating and the page is full — see §Footer. */
.sig-row { display:flex; justify-content:space-between; align-items:flex-end;
           margin:36px 0 24px; }
.sig-block { text-align:center; width:200px; max-width:32%; }
/* min-height (not a fixed height) reserves room to sign an empty block by hand,
   while a filled one grows DOWNWARD and pushes its own rule instead of
   overflowing up into the payment box. justify-content:flex-end keeps the
   contents sitting on the rule; align-items:flex-end on the row above then
   keeps every rule level however many lines each block takes. */
.sig-mark { min-height:52px; display:flex; flex-direction:column;
            justify-content:flex-end; align-items:center; padding-bottom:3px; }
/* The negative margin tucks the ink onto the name below it, the way a real
   signature overlaps the printed name. multiply drops the PNG's white plate. */
.sig-img  { height:34px; width:auto; max-width:85%; object-fit:contain;
            display:block; margin-bottom:-5px; mix-blend-mode:multiply; }
.sig-name { font-size:11.5px; font-weight:600; color:#1c1c1a; line-height:1.3; word-break:break-word; }
.sig-org  { font-size:10px; color:#6f6e69; line-height:1.35; margin-top:1px; word-break:break-word; }
.sig-line { border-top:1px solid #374151; padding-top:6px; font-size:11px; color:#6b7280; }

/* Footer — margin-top:auto eats whatever column height is left over, pinning it
   to the bottom edge of the sheet. On a page whose content already reaches the
   bottom, auto resolves to 0 and the preceding block's own margin-bottom
   supplies the gap. */
.footer { text-align:center; margin-top:auto; padding-top:10px; font-size:10px;
          color:#9ca3af; border-top:1px solid #e5e7eb; }

/* Preview toolbar — hidden when printing */
.preview-bar { display:flex; align-items:center; justify-content:space-between;
               background:#fff; color:#1c1c1a; padding:11px 20px;
               border-bottom:1px solid #ededea;
               font-family:'IBM Plex Sans',Arial,sans-serif; font-size:13px; font-weight:600; }
.preview-bar button { background:#157a52; color:#fff; border:none; border-radius:8px;
                      padding:8px 18px; font-size:12.5px; font-weight:600; cursor:pointer; }
.preview-bar button:hover { background:#11653f; }

@media print {
  body { background:#fff; }
  /* @page margin 0 + the sheet's own padding means .page is EXACTLY one A4
     sheet. With a page margin, min-height:297mm plus that margin overflows the
     printable area and throws a blank second page — and the footer's
     margin-top:auto would push against the wrong bottom edge. The white space
     around the content is the padding below, not a page margin. */
  @page { size:A4 portrait; margin:0; }
  .page { margin:0; box-shadow:none; width:100%; padding:14mm 14mm 12mm; }
  .preview-bar { display:none !important; }
}
</style>
</head>
<body>
${previewOnly ? `
<div class="preview-bar">
  <span>Print Preview — ${_pEsc(_docTitle(inv))} ${_pEsc(inv.invoiceNo || '')}</span>
  <button onclick="window.print()">Print</button>
</div>` : ''}
<div class="page">

  <!-- Letterhead: mark over the business block on the left, document title on
       the right — same arrangement as the SOA / payroll statements. -->
  <div class="inv-header">
    <div class="inv-biz">
      ${logoHtml}
      <h1>${_pEsc(bizName)}</h1>
      <p>${_pEsc(bizAddr)}${bizTin && bizTin !== '—' ? `<br>Business Tax Id: ${_pEsc(bizTin)}` : ''}</p>
    </div>
    <div class="inv-title-block">
      <h2>${_pEsc(_docTitle(inv))}</h2>
      <div class="inv-meta">
        Invoice No: <strong>${_pEsc(inv.invoiceNo || '—')}</strong><br>
        Date: <strong>${inv.date ? _fmtDate(inv.date) : '—'}</strong>
      </div>
    </div>
  </div>

  <!-- Bill To / Received From (0056) -->
  <div class="bill-row">
    <div class="bill-to">
      <h4>${_pEsc(_partyLabel(inv))}</h4>
      <div class="name">${_pEsc(inv.clientName || '—')}</div>
      <p>${_pEsc(inv.clientAddress || '—')}</p>
      ${inv.clientTin ? `<p>TIN: ${_pEsc(inv.clientTin)}</p>` : ''}
    </div>
  </div>

  <!-- Items -->
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

  <!-- Totals -->
  <div class="totals-wrap">
    <table class="totals">
      <tr><td>Total Sales</td><td>${_fmt(inv.subtotal || 0)}</td></tr>
      <tr class="grand"><td>TOTAL AMOUNT DUE</td><td>${_fmt(inv.totalAmount || 0)}</td></tr>
    </table>
  </div>

  <!-- Payment Details -->
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

  <!-- Signatures -->${sigRow}

  <!-- Footer -->
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
    // PDF EXPORT
    // ══════════════════════════════════════════════════════
    // A real downloaded file, as opposed to invPrint()'s "print to PDF", which
    // depends on the browser's dialog and loses the exact page geometry.
    //
    // jsPDF + autotable come off the CDN on FIRST USE ONLY — they are ~300KB
    // and most sessions never export. Same lazy-load pattern as boq-module.js
    // and quotation-print.js.
    let _pdfReady = false;

    window.invExportPDF = function (id) {
        const inv = _invoices.find(i => i.id === id);
        if (!inv) { alert('Invoice not found.'); return; }
        if (_pdfReady) { _generatePDF(inv); return; }
        _showToast('Loading PDF library…');
        _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
            .then(() => _loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
            .then(() => { _pdfReady = true; _generatePDF(inv); })
            .catch(() => alert('Could not load the PDF library.\nCheck your internet connection and try again.'));
    };

    function _loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload  = resolve;
            s.onerror = () => reject(new Error('failed to load ' + src));
            document.head.appendChild(s);
        });
    }

    // Reads an image through a canvas so jsPDF gets raw pixel data. Resolves
    // null on ANY failure — a missing logo or e-signature must never cost the
    // client their invoice.
    function _pdfImg(src) {
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth; c.height = img.naturalHeight;
                    c.getContext('2d').drawImage(img, 0, 0);
                    resolve({ url: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
                } catch (e) { resolve(null); }       // tainted canvas
            };
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    // ── Embedded font, so the PDF can print ₱ ─────────────────────────
    // jsPDF's built-in faces are WinAnsi-encoded and have no ₱ (U+20B1) — it
    // comes out as a blank box, which is why the quotation PDF gave up and
    // prints bare numbers. Roboto carries the glyph, so it is embedded and used
    // for the whole document rather than mixing two typefaces on one page.
    //
    // ~330KB for the two faces, fetched ONCE per session and cached here, on
    // top of jsPDF's own lazy load. If the fetch fails the export still runs —
    // it falls back to Helvetica and the "PHP" spelling. A missing font must
    // never cost the client their invoice.
    const _PDF_FONT_BASE = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/';
    let _pdfFont = null;        // null = untried, false = tried and failed

    async function _ensurePdfFont() {
        if (_pdfFont !== null) return _pdfFont;
        try {
            const [regular, bold] = await Promise.all([
                _fetchB64(_PDF_FONT_BASE + 'Roboto_400Regular.ttf'),
                _fetchB64(_PDF_FONT_BASE + 'Roboto_700Bold.ttf')
            ]);
            _pdfFont = { regular, bold };
        } catch (e) {
            console.warn('InvoiceModule: peso font unavailable, falling back to "PHP"', e);
            _pdfFont = false;
        }
        return _pdfFont;
    }

    function _fetchB64(url) {
        return fetch(url)
            .then(r => { if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status); return r.arrayBuffer(); })
            .then(buf => {
                // btoa wants a binary string. Chunked, because
                // String.fromCharCode.apply on 160KB of bytes at once blows the
                // engine's argument limit.
                const bytes = new Uint8Array(buf);
                let s = '';
                for (let i = 0; i < bytes.length; i += 0x8000) {
                    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                }
                return btoa(s);
            });
    }

    // `peso` is false only when the font failed to load, in which case ₱ would
    // render as an empty box and the ISO code is the honest substitute.
    function _pdfAmt(n, peso) {
        return (peso ? '₱ ' : 'PHP ') + (Number(n) || 0).toLocaleString('en-PH',
            { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    async function _generatePDF(inv) {
        try {
            const jsPDF = (window.jspdf || window).jsPDF;
            const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pageW = doc.internal.pageSize.getWidth();    // 210mm
            const pageH = doc.internal.pageSize.getHeight();   // 297mm
            const M     = 15;
            const usable = pageW - M * 2;

            // Roboto if it loaded (gives us ₱), Helvetica + "PHP" if it didn't.
            // FAM is threaded through every setFont call and the autotable
            // styles so the document never mixes the two.
            // Only the first export of a session waits on the font; say so,
            // otherwise a slow connection looks like the button did nothing.
            if (_pdfFont === null) _showToast('Preparing the PDF…');
            const font = await _ensurePdfFont();
            const FAM  = font ? 'Roboto' : 'helvetica';
            if (font) {
                doc.addFileToVFS('Roboto-Regular.ttf', font.regular);
                doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
                doc.addFileToVFS('Roboto-Bold.ttf', font.bold);
                doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
            }
            const amt = n => _pdfAmt(n, !!font);

            // Same fallbacks as the print sheet, so the two documents can't
            // disagree about the seller's details.
            const pd      = Object.assign({}, _defaults.paymentDetails || {}, inv.paymentDetails || {});
            const bizName = inv.businessName    || _defaults.businessName    || 'Business Name';
            const bizTin  = inv.businessTin     || _defaults.businessTin     || '';
            const bizAddr = inv.businessAddress || _defaults.businessAddress || '';

            let y = M;

            // ── Letterhead: mark over the business block on the left, the
            // document title on the right — the print sheet's §inv-header.
            const srcs  = inv.showLogo === false ? [] : _letterheadSrcs(_defaults.logos);
            const marks = (await Promise.all(srcs.map(_pdfImg))).filter(Boolean);
            let bizY = y;
            if (marks.length) {
                const H = 20;                       // 82px on the sheet ≈ 21mm
                let x = M;
                // Width comes from each image's own aspect ratio, never fixed,
                // so a mark can't come out stretched.
                marks.forEach(m => {
                    const w = H * (m.w / m.h);
                    doc.addImage(m.url, 'PNG', x, y, w, H);
                    x += w + 6;
                });
                bizY = y + H + 5;
            }

            const leftW = usable * 0.58;            // leaves room for the title
            doc.setFont(FAM, 'bold').setFontSize(13).setTextColor(28, 28, 26);
            const nameLines = doc.splitTextToSize(bizName, leftW);
            doc.text(nameLines, M, bizY + 4);
            let leftY = bizY + 4 + (nameLines.length - 1) * 5.2;

            doc.setFont(FAM, 'normal').setFontSize(8).setTextColor(111, 110, 105);
            const subLines = doc.splitTextToSize(
                bizAddr + (bizTin && bizTin !== '—' ? '\nBusiness Tax Id: ' + bizTin : ''), leftW);
            doc.text(subLines, M, leftY + 5);
            leftY += 5 + (subLines.length - 1) * 3.6;

            // Wrapped, not clipped: a longer title than the default (0055) has
            // to stay inside the right margin instead of running off the sheet.
            doc.setFont(FAM, 'bold').setFontSize(15).setTextColor(21, 122, 82);
            const titleLines = doc.splitTextToSize(_docTitle(inv), usable * 0.4);
            doc.text(titleLines, pageW - M, y + 5, { align: 'right' });
            const titleH = (titleLines.length - 1) * 6.5;

            // Right-aligned "label value" pairs with the value in bold. jsPDF
            // can't mix weights inside one text call, so the value is placed
            // first and the label backed off by its measured width.
            const kv = (label, value, ry) => {
                doc.setFont(FAM, 'bold').setFontSize(8.5).setTextColor(17, 17, 17);
                const vw = doc.getTextWidth(value);
                doc.text(value, pageW - M, ry, { align: 'right' });
                doc.setFont(FAM, 'normal').setTextColor(68, 68, 68);
                doc.text(label, pageW - M - vw - 1.2, ry, { align: 'right' });
            };
            kv('Invoice No: ', inv.invoiceNo || '—', y + 12 + titleH);
            kv('Date: ', inv.date ? _fmtDate(inv.date) : '—', y + 17 + titleH);

            y = Math.max(leftY, y + 20 + titleH) + 5;
            doc.setDrawColor(28, 28, 26).setLineWidth(0.6);
            doc.line(M, y, pageW - M, y);

            // ── Bill To / Received From (0056) ───────────────────────────
            y += 7;
            doc.setFont(FAM, 'bold').setFontSize(7).setTextColor(155, 154, 148);
            doc.text(_partyLabel(inv).toUpperCase(), M, y);
            doc.setFont(FAM, 'bold').setFontSize(11.5).setTextColor(28, 28, 26);
            doc.text(inv.clientName || '—', M, y + 6);
            let billY = y + 6;
            const billSub = [inv.clientAddress || '', inv.clientTin ? 'TIN: ' + inv.clientTin : '']
                .filter(Boolean).join('\n');
            if (billSub) {
                doc.setFont(FAM, 'normal').setFontSize(8.5).setTextColor(111, 110, 105);
                const lines = doc.splitTextToSize(billSub, usable * 0.6);
                doc.text(lines, M, billY + 5);
                billY += 5 + (lines.length - 1) * 3.8;
            }
            y = billY + 5;
            doc.setDrawColor(237, 237, 234).setLineWidth(0.2);
            doc.line(M, y, pageW - M, y);
            y += 5;

            // ── Items ────────────────────────────────────────────────────
            doc.autoTable({
                startY: y, margin: { left: M, right: M },
                head: [['#', 'ITEM DESCRIPTION / SERVICE', 'QTY', 'UNIT PRICE', 'DISC.(%)', 'AMOUNT']],
                body: (inv.items || []).map((it, i) => [
                    i + 1,
                    it.description || '',
                    it.qty != null ? String(it.qty) : '',
                    amt(it.unitPrice),
                    (it.discount || 0) + '%',
                    amt(it.amount)
                ]),
                // `font: FAM` is what keeps the table in Roboto — autotable does
                // not inherit the doc's current face, it resets to helvetica.
                styles:     { font: FAM, fontSize: 8, cellPadding: 2, lineColor: [237, 237, 234],
                              lineWidth: 0.1, textColor: [28, 28, 26] },
                headStyles: { font: FAM, fillColor: [250, 250, 248], textColor: [140, 139, 133],
                              fontStyle: 'bold', fontSize: 7, lineColor: [237, 237, 234] },
                columnStyles: { 0: { cellWidth: 8,  halign: 'center' },
                                1: { cellWidth: 'auto' },
                                2: { cellWidth: 14, halign: 'center' },
                                3: { cellWidth: 27, halign: 'right' },
                                4: { cellWidth: 17, halign: 'center' },
                                5: { cellWidth: 29, halign: 'right', fontStyle: 'bold' } }
            });
            y = doc.lastAutoTable.finalY + 5;

            // ── Totals — right-aligned, the grand total on its green plate ──
            const totW = 74;
            const totX = pageW - M - totW;
            doc.setFont(FAM, 'normal').setFontSize(9).setTextColor(85, 85, 85);
            doc.text('Total Sales', totX + 2, y + 4);
            doc.setFont(FAM, 'bold').setTextColor(17, 17, 17);
            doc.text(amt(inv.subtotal || 0), pageW - M - 2, y + 4, { align: 'right' });
            y += 8;

            doc.setFillColor(234, 244, 239);
            doc.roundedRect(totX, y, totW, 13, 2, 2, 'F');
            doc.setFont(FAM, 'bold').setFontSize(9).setTextColor(15, 99, 66);
            doc.text('TOTAL AMOUNT DUE', totX + 4, y + 8);
            doc.setFontSize(11);
            doc.text(amt(inv.totalAmount || 0), pageW - M - 4, y + 8.4, { align: 'right' });
            y += 19;

            // ── Payment details ──────────────────────────────────────────
            const payRows = pd.method === 'gcash'
                ? [['Payment Via', 'GCash'], ['GCash No.', pd.gcashNumber || '—'],
                   ['Account Name', pd.gcashName || '—']]
                : [['Payment Via', 'Bank Transfer'], ['Bank', pd.bank || '—'],
                   ['Account No.', pd.accountNo || '—'], ['Account Name', pd.accountName || '—'],
                   ['Branch', pd.branch || '—']];
            const payLines = Math.ceil(payRows.length / 2);
            const payH = 12 + payLines * 5;
            doc.setFillColor(250, 250, 248).setDrawColor(237, 237, 234).setLineWidth(0.2);
            doc.roundedRect(M, y, usable, payH, 2, 2, 'FD');
            doc.setFont(FAM, 'bold').setFontSize(7).setTextColor(155, 154, 148);
            doc.text('PAYMENT DETAILS', M + 4, y + 5.5);
            payRows.forEach(([k, v], i) => {
                const cx = M + 4 + (i % 2) * (usable / 2 - 2);
                const cy = y + 11.5 + Math.floor(i / 2) * 5;
                doc.setFont(FAM, 'normal').setFontSize(8).setTextColor(107, 114, 128);
                doc.text(k + ': ', cx, cy);
                doc.setFont(FAM, 'bold').setTextColor(17, 17, 17);
                doc.text(String(v), cx + doc.getTextWidth(k + ': '), cy);
            });
            y += payH + 6;

            if (inv.notes) {
                doc.setFont(FAM, 'normal').setFontSize(8.5).setTextColor(85, 85, 85);
                const nl = doc.splitTextToSize('Notes: ' + inv.notes, usable);
                doc.text(nl, M, y + 3);
                y += 3 + nl.length * 4;
            }

            // ── Signatures — e-sign, name and company above the rule, the
            // role label under it. Same stacking as the print sheet. ───────
            const blocks = _SIG_KEYS
                .map(({ key, label }) => ({ label, ...(_sig(inv.signatories, key)) }))
                .filter(s => s.show);
            if (blocks.length) {
                const stamps = await Promise.all(blocks.map(s =>
                    s.esign ? _pdfImg(window.location.origin + '/assets/images/dacs-signature.png')
                            : Promise.resolve(null)));

                const blockW = Math.min(58, usable / blocks.length - 6);
                // A signature row split across a page break is worse than a
                // short page, so move the whole row down if it won't fit.
                if (y + 34 > pageH - 22) { doc.addPage(); y = M; }
                y += 12;

                // Mirrors the sheet's .sig-row: a full set of three spreads
                // edge to edge (space-between), while one or two sit centred in
                // their share of the row (space-around) rather than hugging the
                // left margin.
                const spread = blocks.length >= 3;
                const step   = usable / blocks.length;
                const xOf = i => spread
                    ? M + i * (blockW + (usable - blockW * blocks.length) / (blocks.length - 1))
                    : M + step * i + (step - blockW) / 2;

                const ruleY = y + 20;
                blocks.forEach((s, i) => {
                    const x  = xOf(i);
                    const cx = x + blockW / 2;
                    let ty = ruleY - 1.5;

                    if (s.org) {
                        doc.setFont(FAM, 'normal').setFontSize(7.5).setTextColor(111, 110, 105);
                        const ol = doc.splitTextToSize(s.org, blockW);
                        doc.text(ol, cx, ty, { align: 'center' });
                        ty -= 3.2 + (ol.length - 1) * 3.2;
                    }
                    if (s.name) {
                        doc.setFont(FAM, 'bold').setFontSize(8.5).setTextColor(28, 28, 26);
                        const nl = doc.splitTextToSize(s.name, blockW);
                        doc.text(nl, cx, ty, { align: 'center' });
                        ty -= 3.6 + (nl.length - 1) * 3.6;
                    }
                    const stamp = stamps[i];
                    if (stamp) {
                        const h = 10, w = Math.min(blockW * 0.85, h * (stamp.w / stamp.h));
                        doc.addImage(stamp.url, 'PNG', cx - w / 2, ty - h + 1.5, w, h);
                    }

                    doc.setDrawColor(55, 65, 81).setLineWidth(0.25);
                    doc.line(x, ruleY, x + blockW, ruleY);
                    doc.setFont(FAM, 'normal').setFontSize(8).setTextColor(107, 114, 128);
                    doc.text(s.label, cx, ruleY + 4, { align: 'center' });
                });
                y = ruleY + 8;
            }

            // ── Footer on every page ─────────────────────────────────────
            const foot = [bizName, bizAddr].filter(Boolean).join('  •  ');
            const pages = doc.internal.getNumberOfPages();
            for (let p = 1; p <= pages; p++) {
                doc.setPage(p);
                doc.setDrawColor(229, 231, 235).setLineWidth(0.2);
                doc.line(M, pageH - 16, pageW - M, pageH - 16);
                doc.setFont(FAM, 'normal').setFontSize(7).setTextColor(156, 163, 175);
                doc.text(foot, pageW / 2, pageH - 11.5, { align: 'center', maxWidth: usable });
                if (pages > 1) doc.text(`Page ${p} / ${pages}`, pageW - M, pageH - 11.5, { align: 'right' });
            }

            doc.save(String(inv.invoiceNo || 'invoice').replace(/[^\w.\-]/g, '_') + '.pdf');
        } catch (e) {
            console.error('InvoiceModule: PDF export failed', e);
            alert('Could not build the PDF: ' + e.message);
        }
    }

    // ══════════════════════════════════════════════════════
    // CSV EXPORT
    // ══════════════════════════════════════════════════════

    window.invExportCSV = function () {
        const header = 'Invoice No.,Date,Customer Name,Customer TIN,Customer Address,Subtotal (PHP),VAT (PHP),Total Amount (PHP),Status\n';
        const rows = _invoices.map(inv => [
            inv.invoiceNo    || '',
            inv.date         || '',
            inv.clientName   || '',
            inv.clientTin    || '',
            inv.clientAddress|| '',
            (inv.subtotal    || 0).toFixed(2),
            (inv.vatAmount   || 0).toFixed(2),
            (inv.totalAmount || 0).toFixed(2),
            inv.status       || ''
        ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');

        const dateStr = _todayStr();
        const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `invoices-${dateStr}.csv`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    // ══════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════

    function _showLoading(on) {
        const ld = document.getElementById('invLoading');
        const ct = document.getElementById('invContent');
        if (ld) ld.style.display = on ? 'flex' : 'none';
        if (ct) ct.style.display = on ? 'none' : 'block';
    }

    function _setContent(html) {
        const ct = document.getElementById('invContent');
        if (ct) ct.innerHTML = html;
    }

    function _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function _fmt(n) {
        return '₱ ' + (n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // HTML-escape for innerHTML strings
    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Plain-text escape for the print window (uses document.write)
    function _pEsc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ── Document title (migration 0055) ───────────────────────────────
    // The heading opposite the letterhead. The house default lives HERE and
    // nowhere else — an invoice stores '' rather than the literal words, so
    // changing this one line re-titles every document that never overrode it.
    const _DOC_TITLE = 'SALES INVOICE';

    function _docTitle(inv) {
        return String((inv && inv.docTitle) || '').trim().toUpperCase() || _DOC_TITLE;
    }

    // ── Client-block heading (migration 0056) ─────────────────────────
    // What the name / TIN / address block under the letterhead is called.
    // 'Bill To' on an invoice; 'Received From' when the same sheet goes out
    // as an acknowledgement receipt — a receipt records money taken in, it
    // doesn't bill anyone. Same storage rule as _DOC_TITLE: the house
    // default lives HERE and nowhere else, and an invoice stores '' rather
    // than the words, so changing this one line re-heads every document
    // that never overrode it.
    const _PARTY_LABEL  = 'Bill To';
    // The dropdown, in the order it lists. Stored free-form (0056), so
    // adding a third heading is this line and nothing else — no migration.
    const _PARTY_LABELS = ['Bill To', 'Received From'];

    // Screen labels for the three fields under the heading, per heading, so
    // the form reads as one sentence instead of asking for a "client" on a
    // receipt. Editor only: the columns, and what the sheet prints, are the
    // same whichever heading is picked.
    const _PARTY_FIELDS_DEFAULT = { name: 'Client Name', tin: 'Customer TIN', address: 'Customer Address' };
    const _PARTY_FIELDS = {
        'Received From': { name: 'Payer Name', tin: 'Payer TIN', address: 'Payer Address' }
    };

    function _partyLabel(inv) {
        return String((inv && inv.partyLabel) || '').trim() || _PARTY_LABEL;
    }
    function _partyFields(label) {
        return _PARTY_FIELDS[String(label || '').trim()] || _PARTY_FIELDS_DEFAULT;
    }

    // ── Signature blocks (migration 0053) ─────────────────────────────
    // The three lines at the foot of the printed invoice. Order here is the
    // order they print in, left to right.
    const _SIG_KEYS = [
        { key: 'preparedBy', label: 'Prepared by' },
        { key: 'receivedBy', label: 'Received by' },
        { key: 'approvedBy', label: 'Approved by' }
    ];

    // Read one block out of a stored `signatories` object. Anything missing —
    // the whole column, the key, or just `show` — reads as an unnamed line that
    // prints, which is exactly how invoices behaved before 0053. That fallback
    // is why no backfill was needed.
    function _sig(signatories, key) {
        const s = (signatories && signatories[key]) || {};
        return {
            name:  String(s.name || '').trim(),
            org:   String(s.org  || '').trim(),   // company or position, printed under the name
            esign: s.esign === true,              // stamp assets/images/dacs-signature.png
            show:  s.show !== false
        };
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

    // ══════════════════════════════════════════════════════
    // ACKNOWLEDGE INVOICE — Single payroll entry
    // ══════════════════════════════════════════════════════

    window.printSinglePayrollInvoice = async function (payrollId) {
        if (!_ownerUid) await _resolveOwnerUid();
        if (!_defaults || !Object.keys(_defaults).length) await _loadDefaults();

        const _allPay = (typeof _ovAllPayroll !== 'undefined' && _ovAllPayroll.length)
                        ? _ovAllPayroll
                        : (typeof expPayroll !== 'undefined' ? expPayroll : []);

        const p = _allPay.find(e => e.id === payrollId);
        if (!p) { alert('Payroll entry not found.'); return; }

        const _projs   = (typeof expProjects !== 'undefined' ? expProjects : []);
        const _folders = (typeof expFolders  !== 'undefined' ? expFolders  : []);
        const proj     = _projs.find(pr => pr.id === p.projectId) || null;
        const folder   = proj && proj.folderId ? _folders.find(f => f.id === proj.folderId) || null : null;
        const projectName = folder ? folder.name : (proj ? (proj.month + ' ' + proj.year) : 'Labor & Payroll');

        // Blank, not '—': the letterhead omits an address/TIN line it doesn't have.
        const bizName = _defaults.businessName    || "DAC's Building Design Services";
        const bizTin  = _defaults.businessTin     || '';
        const bizAddr = _defaults.businessAddress || '';

        const esc     = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const fmt     = n => '&#8369;&nbsp;' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtDate = d => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}); } catch(e){ return d; } };

        const invoiceNo = await _generateInvoiceNo();
        const today     = new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});
        const totalSalary = p.totalSalary || (Number(p.dailyRate||0) * Number(p.daysWorked||0));

        // "Paraan ng Bayad" prints the four channels form-style with the one this
        // entry actually used underlined — how a paper voucher ticks a box.
        // Cheque is on the form but not (yet) a saved value, so it never matches.
        const _method = p.paymentMethod || '';
        const _modes  = [['cash','Cash'], ['gcash','GCash'], ['bank_transfer','Bank Transfer'], ['cheque','Cheque']];
        const modeRow = '<div class="ws-modes">' + _modes.map(([k, lbl]) =>
            k === _method ? '<strong class="on">' + lbl + '</strong>' : lbl
        ).join(' <span class="sep">/</span> ') + '</div>';

        const w = window.open('','_blank','width=720,height=960');
        if (!w) { alert('Please allow pop-ups to print the invoice.'); return; }

        w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Acknowledge Invoice — ${esc(p.workerName||'Worker')}</title>
<style>${window.dacsStatementCSS()}</style>
</head>
<body>
<div class="page">
${window.dacsStatementHead({
    title: 'Acknowledge<br>Invoice',
    kicker: 'Resibo ng Bayad',
    bizName, bizAddr, bizTin,
    meta: [{ k: 'Invoice No.', v: invoiceNo }, { k: 'Petsa / Date', v: today }]
})}
  <div class="ws-band" style="grid-template-columns:1.5fr 1fr 1.4fr 1fr;">
    <div>
      <div class="ws-lbl">Manggagawa</div>
      <div class="ws-band-v">${esc(p.workerName||'—')}</div>
    </div>
    <div>
      <div class="ws-lbl">Trabaho / Role</div>
      <div class="ws-band-v sm">${esc(p.role||'—')}</div>
    </div>
    <div>
      <div class="ws-lbl">Proyekto</div>
      <div class="ws-band-v sm">${esc(projectName)}</div>
    </div>
    <div>
      <div class="ws-lbl">Petsa ng Bayad</div>
      <div class="ws-band-v sm">${fmtDate(p.paymentDate)}</div>
    </div>
  </div>
  <div class="ws-body">
    <div class="ws-lbl ws-sec">Salary breakdown</div>
    <table class="ws-tbl">
      <thead>
        <tr>
          <th>Deskripsyon / Description</th>
          <th style="width:78px;" class="ws-c">Araw</th>
          <th style="width:112px;" class="ws-r">Daily Rate</th>
          <th style="width:126px;" class="ws-r">Kabuuan</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${esc(p.role||'Labor')} — ${esc(p.workerName||'—')}</td>
          <td class="ws-c">${p.daysWorked||0}</td>
          <td class="ws-r">${Number(p.dailyRate)||0 ? fmt(p.dailyRate) : '<span class="ws-muted">Lump sum</span>'}</td>
          <td class="ws-amt">${fmt(totalSalary)}</td>
        </tr>
      </tbody>
    </table>
    <div class="ws-tot-wrap">
      <div class="ws-tot">
        <div class="ws-grand" style="margin-top:0;"><span class="l">Kabuuang Babayaran</span><span class="v">${fmt(totalSalary)}</span></div>
      </div>
    </div>
    ${p.notes ? `<div class="ws-note"><div class="ws-lbl" style="margin-bottom:6px;">Tala / Notes</div><div class="ws-note-t">${esc(p.notes)}</div></div>` : ''}
    <div class="ws-panel">
      <div>
        <div class="ws-lbl">Paraan ng Bayad</div>
        ${modeRow}
      </div>
      <div>
        <div class="ws-lbl">Detalye</div>
        <div class="ws-kv">
          <span class="k">Naitala</span><span class="v">${esc(window.dacsPayMethodLabel(p.paymentMethod))}</span>
          <span class="k">Tatanggap</span><span class="v">${esc(p.workerName||'—')}</span>
        </div>
      </div>
    </div>
    <div class="ws-box">
      <div class="ws-lbl" style="margin-bottom:10px;">Pagkilala / Acknowledgement</div>
      <p>Ako, si <strong>${esc(p.workerName||'ang nakalagda sa ibaba')}</strong>, ay kinikilalang natanggap ko ang halagang
      <strong>${fmt(totalSalary)}</strong> bilang buong bayad sa trabahong naibigay sa proyektong nakasaad sa itaas.
      Wala na akong iba pang hinihinging bayad para sa mga araw na ito.</p>
    </div>
  </div>
${window.dacsStatementSigns([
    { label: 'Pirma ng Manggagawa', name: p.workerName || '' },
    { label: 'Inihanda ni / Prepared by' },
    { label: 'Inaprubahan ni / Approved by' }
])}
${window.dacsStatementFoot([bizName, bizAddr].filter(Boolean).join(' · '), invoiceNo + ' · Pahina 1 / 1')}
</div>
${window.dacsStatementPrintScript()}
</body>
</html>`);
        w.document.close();
    };

    // ══════════════════════════════════════════════════════
    // WORKER STATEMENT OF ACCOUNT — all of ONE worker's labor
    // entries within a single project folder (all-time).
    // ══════════════════════════════════════════════════════

    window.printWorkerLaborSOA = async function (workerName, folderId) {
        if (!_ownerUid) await _resolveOwnerUid();
        if (!_defaults || !Object.keys(_defaults).length) await _loadDefaults();

        const _allPay  = (typeof _ovAllPayroll !== 'undefined' && _ovAllPayroll.length)
                         ? _ovAllPayroll
                         : (typeof expPayroll !== 'undefined' ? expPayroll : []);
        const _projs   = (typeof expProjects !== 'undefined' ? expProjects : []);
        const _folders = (typeof expFolders  !== 'undefined' ? expFolders  : []);

        const folder      = _folders.find(f => f.id === folderId) || null;
        const projectName = folder ? folder.name : 'Labor & Payroll';
        const periodIds   = new Set(_projs.filter(p => p.folderId === folderId).map(p => p.id));

        // Include payments by typed name OR linked to a contract owned by this worker,
        // so a name mismatch (payment "Mark Frias" vs contract "Mark Frias (Demolition)")
        // still gathers the right entries.
        const _wcIds = new Set(
            (typeof expLaborContracts !== 'undefined' ? expLaborContracts : [])
                .filter(c => (c.workerName || '') === workerName)
                .map(c => c.id)
        );
        let entries = _allPay
            .filter(p => periodIds.has(p.projectId) &&
                ((p.workerName || '') === workerName || (p.contractId && _wcIds.has(p.contractId))))
            .sort((a, b) => new Date(a.paymentDate || 0) - new Date(b.paymentDate || 0));
        if (!entries.length) { alert('No labor entries found for ' + workerName + ' in this project.'); return; }

        const role    = (entries.find(e => e.role) || {}).role || '—';
        // Blank, not '—': the letterhead omits an address/TIN line it doesn't have.
        const bizName = _defaults.businessName    || "DAC's Building Design Services";
        const bizTin  = _defaults.businessTin     || '';
        const bizAddr = _defaults.businessAddress || '';

        const fmt     = n => '&#8369;&nbsp;' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const esc     = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const fmtDate = d => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}); } catch(e){ return d; } };
        const cap     = s => { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; };

        // One row per payment. The category cell carries the labour class and
        // the role, with the days × rate breakdown trailing in grey — a lump-sum
        // (pakyaw) row has no daily rate to show, so it just reads "Lump sum".
        let itemRows = '', rowNum = 0, grandTotal = 0, totalDays = 0;
        entries.forEach(p => {
            rowNum++;
            grandTotal += (p.totalSalary || 0);
            totalDays  += Number(p.daysWorked) || 0;
            const days = Number(p.daysWorked) || 0;
            const rate = Number(p.dailyRate)  || 0;
            const detail = (days && rate)
                ? ' <span class="ws-muted">· ' + days + ' araw × ' + fmt(rate) + '</span>'
                : ' <span class="ws-muted">· Lump sum</span>';
            itemRows += `<tr>
                <td class="ws-muted">${rowNum}</td>
                <td>${fmtDate(p.paymentDate)}</td>
                <td>${esc(cap(p.laborType || 'direct'))}${p.role ? ' — ' + esc(p.role) : ''}${detail}</td>
                <td>${esc(window.dacsPayMethodLabel(p.paymentMethod))}</td>
                <td class="ws-amt">${fmt(p.totalSalary)}</td>
            </tr>`;
        });

        // Left half of the grey panel: what was ACTUALLY paid and how, tallied
        // from the entries (payroll.payment_method, migration 0037).
        const splitBlock = window.dacsPayMethodSplit(entries, fmt);

        const invoiceNo = await _generateInvoiceNo();
        const today     = new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});

        // Contract status (Completed / Over cap / Ongoing) from this worker's contract(s).
        const _allC      = (typeof expLaborContracts !== 'undefined' ? expLaborContracts : []);
        const _entryCids = new Set(entries.map(p => p.contractId).filter(Boolean));
        const _wContracts = _allC.filter(c => (c.workerName || '') === workerName || _entryCids.has(c.id));

        // Contract position — hoisted out of the status-pill branch below because
        // the Contract band also needs it. Same arithmetic the Worker Tracker row
        // uses in portal-app.compiled.js (agreed = Σ agreedAmount, paid = Σ of the
        // entries drawn against those contracts) so the two never disagree.
        let _stLabel = '', _agreed = 0, _paid = 0, _remaining = 0, _pct = 0;
        const _jobs = _wContracts.length;
        if (_jobs) {
            _agreed = _wContracts.reduce((s, c) => s + (parseFloat(c.agreedAmount) || 0), 0);
            const _wcSet = new Set(_wContracts.map(c => c.id));
            _paid = entries.filter(p => p.contractId && _wcSet.has(p.contractId)).reduce((s, p) => s + (parseFloat(p.totalSalary) || 0), 0);
            _remaining = _agreed - _paid;
            _pct = _agreed > 0 ? Math.min(100, Math.max(0, _paid / _agreed * 100)) : 0;
            if (_agreed > 0 && _paid >= _agreed) {
                _stLabel = _paid > _agreed ? 'Over cap' : 'Completed';
            } else {
                _stLabel = 'Ongoing · ' + Math.round(_pct) + '%';
            }
        }

        // The Contract band. Only meaningful with a capped contract — a plain
        // payroll worker has no agreed total, so there is no balance to state and
        // the band is omitted rather than printed with zeros.
        const _over = _remaining < 0;
        const _done = !_over && _agreed > 0 && _paid >= _agreed;
        // Colour state, keyed off the SAME label the status pill uses, so the
        // band and the pill above it can never show two colours for one status.
        //   (default) blue = running · st-done green = finished · st-over red
        const _bandState = _over ? ' st-over' : (_done ? ' st-done' : '');
        const _dueLabel  = _over ? 'Lumampas / Over cap'
                         : _done ? 'Wala nang bayarin / Nothing left'
                         : 'Natitira / Still to pay';
        const _bandNote  = _over ? 'lumampas / over cap' : 'nabayaran / paid';
        const _contractBand = (_jobs && _agreed > 0) ? `
  <div class="ws-contract${_bandState}">
    <div class="ws-contract-top">
      <div class="ws-lbl">Kontrata / Contract</div>
      <div class="ws-contract-jobs">${_jobs} ${_jobs === 1 ? 'trabaho / job' : 'trabaho / jobs'} · ${Math.round(_pct)}% ${_bandNote}</div>
    </div>
    <div class="ws-contract-bar"><div class="ws-contract-fill" style="width:${_pct.toFixed(1)}%;"></div></div>
    <div class="ws-contract-grid">
      <div class="ws-contract-cell"><span class="k">Kabuuang kontrata / Contract</span><span class="v">${fmt(_agreed)}</span></div>
      <div class="ws-contract-cell"><span class="k">Nabayaran na / Paid to date</span><span class="v">${fmt(_paid)}</span></div>
      <div class="ws-contract-cell due"><span class="k">${_dueLabel}</span><span class="v">${fmt(Math.abs(_remaining))}</span></div>
    </div>
  </div>` : '';
        const _stPill = _stLabel
            ? `<div class="${window.dacsStatusPillClass(_stLabel)}">${esc(_stLabel)}</div>`
            : '<div class="ws-band-v sm">—</div>';

        // Contract type for this worker (shown under the name): Pakyaw / In-house.
        // If they have contracts of one type, show it; mixed → "Pakyaw & In-house";
        // no contract on record → "Payroll (no contract)".
        let _contractType = 'Payroll (no contract)';
        if (_wContracts.length) {
            const _types = new Set(_wContracts.map(c => c.payType === 'inhouse' ? 'In-house' : 'Pakyaw'));
            _contractType = [..._types].join(' & ');
        }

        const w = window.open('','_blank','width=870,height=1100');
        if (!w) { alert('Please allow pop-ups to print the statement.'); return; }

        w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Statement of Account — ${esc(workerName)}</title>
<style>${window.dacsStatementCSS()}</style>
</head>
<body>
<div class="page">
${window.dacsStatementHead({
    title: 'Statement<br>of Account',
    kicker: 'Labor & Payroll',
    bizName, bizAddr, bizTin,
    meta: [{ k: 'SOA No.', v: invoiceNo }, { k: 'Petsa / Date', v: today }]
})}
  <div class="ws-band" style="grid-template-columns:1.6fr 1.4fr 1fr;">
    <div>
      <div class="ws-lbl">Manggagawa / Worker</div>
      <div class="ws-band-v">${esc(workerName)}</div>
      <div class="ws-band-s">${esc(_contractType)}${role !== '—' ? ' · ' + esc(role) : ''}</div>
    </div>
    <div>
      <div class="ws-lbl">Proyekto / Project</div>
      <div class="ws-band-v sm">${esc(projectName)}</div>
    </div>
    <div>
      <div class="ws-lbl">Kalagayan / Status</div>
      ${_stPill}
    </div>
  </div>
${_contractBand}
  <div class="ws-body">
    <div class="ws-lbl ws-sec">Mga Naibayad / Labor entries</div>
    <table class="ws-tbl">
      <thead>
        <tr>
          <th style="width:28px;">#</th>
          <th style="width:92px;">Petsa</th>
          <th>Kategorya / Category</th>
          <th style="width:132px;">Bayad sa / Paid via</th>
          <th style="width:116px;" class="ws-r">Halaga</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="ws-tot-wrap">
      <div class="ws-tot">
        <div class="ws-tot-row${totalDays ? '' : ' rule'}"><span>Bilang ng entry / Entries</span><b>${entries.length}</b></div>
        ${totalDays ? `<div class="ws-tot-row rule"><span>Kabuuang araw / Total days</span><b>${totalDays}</b></div>` : ''}
        <div class="ws-grand"><span class="l">Kabuuan / Total</span><span class="v">${fmt(grandTotal)}</span></div>
      </div>
    </div>
  </div>
  <div class="ws-panel">
    <div>
      <div class="ws-lbl">Paraan ng Bayad / Paid via</div>
      ${splitBlock || '<div class="ws-modes">Hindi nakatala / Not recorded</div>'}
    </div>
    <div>
      <div class="ws-lbl">Tatanggap / Payee</div>
      <div class="ws-kv">
        <span class="k">Pangalan</span><span class="v">${esc(workerName)}</span>
        <span class="k">Trabaho</span><span class="v">${esc(role)}</span>
        <span class="k">Kontrata</span><span class="v">${esc(_contractType)}</span>
      </div>
    </div>
  </div>
${window.dacsStatementSigns([
    { label: 'Inihanda ni / Prepared by' },
    { label: 'Tinanggap ni / Received by', name: workerName },
    { label: 'Inaprubahan ni / Approved by' }
])}
${window.dacsStatementFoot([bizName, bizAddr].filter(Boolean).join(' · '), invoiceNo + ' · Pahina 1 / 1')}
</div>
${window.dacsStatementPrintScript()}
</body>
</html>`);
        w.document.close();
    };

    // ══════════════════════════════════════════════════════
    // PAYROLL INVOICE — Print from Labor/Payroll tab
    // ══════════════════════════════════════════════════════

    window.printPayrollInvoice = async function () {
        if (!_ownerUid) await _resolveOwnerUid();
        if (!_defaults || !Object.keys(_defaults).length) await _loadDefaults();

        // Pull payroll entries — use globals from expenses-module.js
        /* globals: expCurrentProject, expCurrentFolder, expPayroll, expProjects, expFolders, _ovAllPayroll */
        const _proj   = (typeof expCurrentProject !== 'undefined' ? expCurrentProject : null);
        const _folder = (typeof expCurrentFolder  !== 'undefined' ? expCurrentFolder  : null);
        const _allPay = (typeof _ovAllPayroll !== 'undefined' && _ovAllPayroll.length)
                        ? _ovAllPayroll
                        : (typeof expPayroll !== 'undefined' ? expPayroll : []);
        const _projs  = (typeof expProjects !== 'undefined' ? expProjects : []);
        const _folders= (typeof expFolders  !== 'undefined' ? expFolders  : []);

        let entries = [];
        if (_proj) {
            entries = _allPay.filter(p => p.projectId === _proj.id);
            if (!entries.length && _proj.folderId) {
                const mn = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                entries = _allPay.filter(p => {
                    if (!p.paymentDate) return false;
                    const d = new Date(p.paymentDate);
                    return mn[d.getMonth()] === _proj.month && d.getFullYear() === Number(_proj.year);
                });
            }
        } else if (_folder) {
            const folderProjIds = new Set(_projs.filter(p => p.folderId === _folder.id).map(p => p.id));
            entries = _allPay.filter(p => folderProjIds.has(p.projectId));
        } else {
            entries = _allPay.slice();
        }

        if (!entries.length) {
            alert('No payroll entries found. Please select a project or folder with payroll data.');
            return;
        }

        const project = _proj;
        const folder  = project && project.folderId
            ? _folders.find(f => f.id === project.folderId) || null
            : (_folder || null);
        const periodLabel = project ? (project.month + ' ' + project.year) : 'All Periods';
        const projectName = folder ? folder.name : (project ? (project.month + ' ' + project.year) : 'Labor & Payroll');

        const bizName = _defaults.businessName    || "DAC's Building Design Services";
        const bizTin  = _defaults.businessTin     || '—';
        const bizAddr = _defaults.businessAddress || '—';
        const pd      = _defaults.paymentDetails  || {};

        const fmt = n => '&#8369;&nbsp;' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const fmtDate = d => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}); } catch(e){ return d; } };

        // Group by role
        const roleGroups = {};
        entries.forEach(p => {
            const r = p.role || 'General';
            if (!roleGroups[r]) roleGroups[r] = [];
            roleGroups[r].push(p);
        });

        let itemRows = '', rowNum = 0;
        let grandTotal = 0;
        Object.entries(roleGroups).forEach(([role, workers]) => {
            itemRows += `<tr style="background:#f1f5f9;"><td colspan="6" style="padding:7px 10px;font-size:11px;font-weight:700;color:#1e3a5f;letter-spacing:.5px;text-transform:uppercase;">${esc(role)}</td></tr>`;
            workers.forEach(p => {
                rowNum++;
                grandTotal += (p.totalSalary || 0);
                itemRows += `<tr>
                    <td style="text-align:center;">${rowNum}</td>
                    <td>${esc(p.workerName || '—')}</td>
                    <td style="text-align:center;">${fmtDate(p.paymentDate)}</td>
                    <td style="text-align:center;">${p.daysWorked || 0}</td>
                    <td style="text-align:right;">${fmt(p.dailyRate)}</td>
                    <td style="text-align:right;font-weight:600;">${fmt(p.totalSalary)}</td>
                </tr>`;
            });
        });

        // Payment mode: Cash · E-wallet · Bank · Check. Reads _defaults.paymentDetails.
        // Existing data used method 'gcash' → treated as an E-wallet (provider GCash).
        // (Original rendering — the form-style mode line is WORKER STATEMENT only.)
        const _pdRow = (l, v) => `<div><span class="lbl">${l}: </span><span class="val">${esc(v || '—')}</span></div>`;
        const payBlock = (function () {
            const m = (pd.method || 'bank').toLowerCase();
            if (m === 'cash') {
                return _pdRow('Mode of Payment', 'Cash');
            }
            if (m === 'ewallet' || m === 'gcash' || m === 'e-wallet') {
                const provider = pd.ewalletProvider || (m === 'gcash' ? 'GCash' : '');
                return _pdRow('Mode of Payment', 'E-wallet')
                     + _pdRow('Provider', provider)
                     + _pdRow('Number', pd.ewalletNumber || pd.gcashNumber)
                     + _pdRow('Account Name', pd.ewalletName || pd.gcashName);
            }
            if (m === 'check' || m === 'cheque') {
                return _pdRow('Mode of Payment', 'Check')
                     + _pdRow('Bank', pd.checkBank || pd.bank)
                     + _pdRow('Check No.', pd.checkNumber)
                     + _pdRow('Payee', pd.checkPayee || pd.accountName);
            }
            // default: bank
            return _pdRow('Mode of Payment', 'Bank Transfer')
                 + _pdRow('Bank', pd.bank)
                 + _pdRow('Account No.', pd.accountNo)
                 + _pdRow('Account Name', pd.accountName)
                 + (pd.branch ? _pdRow('Branch', pd.branch) : '');
        })();

        const invoiceNo = await _generateInvoiceNo();
        const today = new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});
        const logoHtml = _buildLogoHtml(_defaults.logos);

        const w = window.open('','_blank','width=870,height=1100');
        if (!w) { alert('Please allow pop-ups to print the invoice.'); return; }

        w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Receipt of Payment — ${esc(projectName)}</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#111; background:#f5f5f5; }
/* Column flex + margin-top:auto on .footer — same footer pinning as the sales
   invoice sheet above; see the comment there. */
.page { width:210mm; min-height:297mm; margin:20px auto; padding:18mm 16mm 14mm; background:#fff; box-shadow:0 2px 12px rgba(0,0,0,.12);
        display:flex; flex-direction:column; }
.page > * { flex-shrink:0; }
.inv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:22px; }
.inv-biz h1 { font-size:20px; font-weight:800; color:#1a1a2e; }
.inv-biz p  { font-size:12px; color:#555; margin-top:4px; line-height:1.5; }
.inv-title-block { text-align:right; }
.inv-title-block h2 { font-size:22px; font-weight:800; color:#1e3a5f; letter-spacing:2px; }
.inv-title-block .inv-sub { font-size:13px; font-weight:600; color:#7c3aed; margin-top:4px; }
.inv-meta { margin-top:8px; font-size:12px; color:#444; line-height:1.8; }
.inv-meta strong { color:#111; }
.bill-row { display:flex; gap:32px; margin-bottom:18px; padding:14px 0; border-top:2.5px solid #1e3a5f; border-bottom:1px solid #e5e7eb; }
.bill-to h4 { font-size:10px; font-weight:700; color:#6b7280; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:6px; }
.bill-to .name { font-size:15px; font-weight:700; color:#1a1a2e; margin-bottom:3px; }
.bill-to p { font-size:12px; color:#555; line-height:1.5; }
table.items { width:100%; border-collapse:collapse; margin-bottom:14px; }
table.items thead tr { background:#fff; color:#111; border-bottom:2px solid #111; }
table.items thead th { padding:9px 10px; font-size:11px; font-weight:700; text-align:left; letter-spacing:.4px; }
table.items tbody tr:nth-child(even):not(.role-header) { background:#f8fafc; }
table.items tbody td { padding:8px 10px; border-bottom:1px solid #e9ecef; vertical-align:top; font-size:12px; }
.totals-wrap { display:flex; justify-content:flex-end; margin-bottom:20px; }
table.totals { width:280px; border-collapse:collapse; font-size:13px; }
table.totals td { padding:6px 10px; }
table.totals td:first-child { color:#555; }
table.totals td:last-child { text-align:right; font-weight:600; color:#111; }
table.totals tr.grand td { font-size:15px; font-weight:800; color:#111; background:#fff; border-top:2px solid #111; border-bottom:2px solid #111; padding:10px 12px; }
.pay-box { background:#f1f5f9; border-radius:8px; padding:13px 16px; margin-bottom:18px; }
.pay-box h4 { font-size:10px; font-weight:700; color:#6b7280; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:10px; }
.pay-grid { display:grid; grid-template-columns:1fr 1fr; gap:5px 24px; font-size:12px; }
.pay-grid .lbl { color:#6b7280; }
.pay-grid .val { font-weight:600; color:#111; }
.sig-row { display:flex; justify-content:space-between; margin-top:36px; }
.sig-block { text-align:center; width:180px; }
.sig-line { border-top:1px solid #374151; padding-top:6px; font-size:11px; color:#6b7280; }
.footer { text-align:center; margin-top:auto; font-size:10px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:10px; }
.sig-row { margin-bottom:24px; }
@media print { body{background:#fff;} .page{margin:0;box-shadow:none;width:100%;padding:14mm 14mm 12mm;} @page{size:A4 portrait;margin:0;} input{border:none!important;outline:none!important;-webkit-appearance:none;} }
</style>
</head>
<body>
<div class="page">
  ${logoHtml}
  <div class="inv-header">
    <div class="inv-biz">
      <h1>${esc(bizName)}</h1>
      <p>${esc(bizAddr)}</p>
    </div>
    <div class="inv-title-block">
      <h2>RECEIPT OF PAYMENT</h2>
      <div class="inv-sub">Labor &amp; Payroll</div>
      <div class="inv-meta">
        Invoice No: <strong>${esc(invoiceNo)}</strong><br>
        Date: <strong>${esc(today)}</strong>
      </div>
    </div>
  </div>
  <div class="bill-row">
    <div class="bill-to">
      <h4>Project</h4>
      <div class="name">${esc(projectName)}</div>
      <p>Billing Period: ${esc(periodLabel)}</p>
    </div>

  </div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:28px;">#</th>
        <th>Worker Name</th>
        <th style="width:110px;text-align:center;">Payment Date</th>
        <th style="width:55px;text-align:center;">Days</th>
        <th style="width:110px;text-align:right;">Daily Rate</th>
        <th style="width:120px;text-align:right;">Total Salary</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  <div class="totals-wrap">
    <table class="totals">
      <tr><td>Total Workers</td><td>${entries.length}</td></tr>
      <tr class="grand"><td>TOTAL LABOR COST</td><td>${fmt(grandTotal)}</td></tr>
    </table>
  </div>
  <div class="pay-box">
    <h4>Payment Details</h4>
    <div class="pay-grid">${payBlock}</div>
  </div>
  <div class="sig-row">
    <div class="sig-block"><div class="sig-line">Prepared by</div></div>
    <div class="sig-block"><div class="sig-line">Received by</div></div>
    <div class="sig-block"><div class="sig-line">Approved by</div></div>
  </div>
  <div class="footer">${esc(bizName)} &bull; ${esc(bizAddr)}</div>
</div>
${window.dacsStatementPrintScript()}
</body>
</html>`);
        w.document.close();
    };

    async function _generateInvoiceNo() {
        const now    = new Date();
        const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
        const same   = _invoices.filter(i => (i.invoiceNo || '').startsWith(prefix));
        const maxSeq = same.reduce((max, i) => {
            const seq = parseInt((i.invoiceNo || '').slice(prefix.length)) || 0;
            return Math.max(max, seq);
        }, 0);
        return prefix + String(maxSeq + 1).padStart(3, '0');
    }

})();
