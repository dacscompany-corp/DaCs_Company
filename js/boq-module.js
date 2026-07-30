// ============================================================
// BOQ ACCOMPLISHMENT REPORT MODULE — DAC's Building Design
// ============================================================

(function () {
    'use strict';

    // ── Helpers ───────────────────────────────────────────────
    function uid() { return window.currentDataUserId || (window.currentUser && window.currentUser.uid) || null; }

    // Compress image to base64 (max width px, quality 0-1) — keeps Firestore doc small
    function compressImage(file, maxWidth, quality) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = e => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    const scale  = Math.min(1, maxWidth / img.width);
                    const canvas = document.createElement('canvas');
                    canvas.width  = Math.round(img.width  * scale);
                    canvas.height = Math.round(img.height * scale);
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X',
                   'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
    const ALPHA  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    function toRoman(n) { return ROMAN[n] || String(n + 1); }
    function toAlpha(n)  { return ALPHA[n]  || String.fromCharCode(65 + n); }
    function genId()     { return '_' + Math.random().toString(36).slice(2, 10); }

    function fmt(n) {
        if (n === null || n === undefined || n === '') return '';
        if (typeof n === 'string' && isNaN(parseFloat(n.replace(/,/g,'')))) return n;
        return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function parseNum(s) {
        if (s === null || s === undefined || s === '') return 0;
        const n = parseFloat(String(s).replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function el(id)  { return document.getElementById(id); }
    function qs(sel) { return document.querySelector(sel); }

    // ── State ─────────────────────────────────────────────────
    const boq = {
        folders:         [],
        allDocs:         [],   // { id, folderId, projectName, updatedAt, costItems, discount }
        currentFolderId: null,
        doc:             null,
        header: { date: '', projectName: '', area: '', ownerName: '', location: '', subject: 'Accomplishment Report' },
        costItems:       [],
        discount:        0,
        clientEmail:     '',
        status:          'draft',   // 'draft' | 'submitted' | 'approved'
        terms: {
            payments:   '50% DOWNPAYMENT\n40% PROGRESS BILLING\n  15% Progress Billing No. 1\n  15% Progress Billing No. 2\n  10% Progress Billing No. 3\n10% UPON TURNOVER/COC',
            exclusions: 'Fire Protection Works (Sprinkler, Smoke Detectors, etc)\nMattress, Beddings and Pillows\nPanel Board and other electrical works not mentioned\nPlumbing works not mentioned\nAppliances (TV, Refrigerator, Stove, Range Hood, Water Heater, Filters and etc)\nA/C Supply and Install\nDecors and Accessories (Wall Paintings, Vases, Displays and etc)\nRetained Wall, Ceiling and Floor Finishes\nWindow Treatments (Blinds and Curtains)',
            duration:   '45 - 60 Days',
            // Sections the user adds themselves: [{ title, body, include }].
            // Rides inside the existing `terms` jsonb column on boq_documents
            // (REG json: ['costItems','terms']), so this needs no migration.
            custom:     [],
            // Which signature blocks print. Kept in `terms` for the same reason
            // as `custom` — it is the only jsonb column on the table, and a new
            // top-level field would mean a migration for two booleans.
            signOff:    { client: true, contractor: true }
        },
        isDirty:         false,
        unsub:           null,
        docsUnsub:       null,
        mobExpenses:     []     // mobilization expenses for the current folder (for the line-item picker)
    };

    // ── Init ──────────────────────────────────────────────────
    window.initBOQModule = function () {
        if (!uid()) return;
        loadBoqFolders();
        // Attach global handlers only once — initBOQModule runs on every
        // boqBuilder view switch, so without this guard Ctrl+S would fire
        // boqSave() N times and beforeunload guards would stack.
        if (!window._boqHandlersWired) {
            window._boqHandlersWired = true;
            window.addEventListener('beforeunload', e => {
                if (boq.isDirty) { e.preventDefault(); e.returnValue = ''; }
            });
            // Ctrl+S to save the current BOQ document
            document.addEventListener('keydown', function _boqCtrlS(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    const view = document.getElementById('boqBuilderView');
                    if (view && view.style.display !== 'none') {
                        e.preventDefault();
                        if (typeof boqSave === 'function') boqSave();
                    }
                }
            });
        }
    };

    // ── Load folders + BOQ docs ────────────────────────────────
    function loadBoqFolders() {
        if (boq.unsub) { boq.unsub(); boq.unsub = null; }
        boq.unsub = db.collection('folders')
            .where('userId', '==', uid())
            .onSnapshot(snap => {
                boq.folders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                // Only re-render the grid if we're on it. If a folder is open
                // (currentFolderId set — e.g., from the Project Control auto-
                // select hand-off), this snapshot would otherwise clobber the
                // folder's BOQ editor with the grid. Matches the docs-snapshot
                // guard below.
                if (!boq.currentFolderId) renderGridPage();
            }, err => console.error('BOQ folder load error:', err));

        if (boq.docsUnsub) { boq.docsUnsub(); boq.docsUnsub = null; }
        boq.docsUnsub = db.collection('boqDocuments')
            .where('userId', '==', uid())
            .onSnapshot(snap => {
                boq.allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                // Re-render grid if currently on grid view
                if (!boq.currentFolderId) renderGridPage();
            }, err => console.error('BOQ docs load error:', err));

        // Register both unsubs with the switchView cleanup hook so leaving
        // the Accomplishment Report (BOQ) view tears down the listeners
        // until the user returns.
        if (typeof window.registerViewCleanup === 'function') {
            window.registerViewCleanup(() => {
                if (boq.unsub)     { boq.unsub();     boq.unsub = null; }
                if (boq.docsUnsub) { boq.docsUnsub(); boq.docsUnsub = null; }
            });
        }
    }

    // ── Grid page (card layout matching Budget Overview) ───────
    function renderGridPage() {
        const root = el('boqBuilderView');
        if (!root) return;

        if (!boq.folders.length) {
            root.innerHTML = `
            <div class="boq-grid-header">
                <div>
                    <h2 class="boq-grid-title">Accomplishment Reports</h2>
                    <p class="boq-grid-sub">Accomplishment Reports per project</p>
                </div>
                <button class="ovhd-guide-btn" onclick="document.getElementById('boqGuideModal').style.display='flex'" title="Learn how Accomplishment Reports work">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    Guide me
                </button>
            </div>
            <div class="ov-empty-state" style="margin-top:1rem;">
                <div class="ov-empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="56" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
                <p class="ov-empty-title">No projects found</p>
                <p class="ov-empty-sub">Create a project folder in Expenses first, then come back to build its BOQ.</p>
            </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        const cards = boq.folders.map(f => {
            const doc       = boq.allDocs.find(d => d.folderId === f.id);
            const hasDoc    = !!doc;
            const grandTotal = hasDoc ? calcGrandTotalFromItems(doc.costItems || []) : 0;
            const totalAcc   = hasDoc ? calcTotalAccFromItems(doc.costItems || [], doc.discount) : 0;
            const updatedStr = hasDoc && doc.updatedAt
                ? (doc.updatedAt.toDate ? doc.updatedAt.toDate().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
                : '';
            const subject    = hasDoc ? (doc.subject || 'Accomplishment Report') : '—';
            const statusBadge = hasDoc
                ? `<span class="boq-status-badge boq-status-saved">BOQ Saved</span>`
                : `<span class="boq-status-badge boq-status-new">No Report Yet</span>`;

            return `
            <div class="ov-folder-card boq-proj-card" onclick="boqSelectFolder('${f.id}')" style="cursor:pointer;">
                <div class="ov-folder-card__title-row">
                    <div class="ov-folder-card__name">${escHtml(f.name || 'Unnamed')}</div>
                    ${statusBadge}
                </div>
                <div class="ov-folder-card__desc">${escHtml(f.description || '')}</div>
                <div class="ov-folder-card__stat-list" style="margin-top:0.9rem;">
                    <div class="ov-folder-card__stat-row">
                        <span class="ov-folder-card__stat-label">Subject</span>
                        <span class="ov-folder-card__stat-value">${escHtml(subject)}</span>
                    </div>
                    <div class="ov-folder-card__stat-row">
                        <span class="ov-folder-card__stat-label">Total Project Cost</span>
                        <span class="ov-folder-card__stat-value">${hasDoc ? '₱ ' + fmt(grandTotal) : '—'}</span>
                    </div>
                    <div class="ov-folder-card__stat-row">
                        <span class="ov-folder-card__stat-label">Total Accomplishment</span>
                        <span class="ov-folder-card__stat-value ov-folder-card__stat-value--positive">${hasDoc ? '₱ ' + fmt(totalAcc) : '—'}</span>
                    </div>
                    <div class="ov-folder-card__stat-row">
                        <span class="ov-folder-card__stat-label">Last Updated</span>
                        <span class="ov-folder-card__stat-value">${updatedStr || '—'}</span>
                    </div>
                </div>
                <button class="ov-folder-card__view-btn" style="margin-top:1.1rem;" onclick="event.stopPropagation();boqSelectFolder('${f.id}')">
                    ${hasDoc ? 'Open Report' : 'Create Report'} &rarr;
                </button>
            </div>`;
        }).join('');

        root.innerHTML = `
        <div class="boq-grid-header">
            <div>
                <h2 class="boq-grid-title">Accomplishment Reports</h2>
                <p class="boq-grid-sub">Accomplishment Reports per project</p>
            </div>
            <button class="ovhd-guide-btn" onclick="document.getElementById('boqGuideModal').style.display='flex'" title="Learn how Accomplishment Reports work">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Guide me
            </button>
        </div>
        <div class="ov-folder-grid">${cards}</div>`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ── Calc helpers for card display (stateless) ──────────────
    function calcLITotalStatic(li) {
        const qty = parseNum(li.qty);
        const mat = li.materialOverride ? 0 : parseNum(li.materialRate);
        const lab = li.laborOverride    ? 0 : parseNum(li.laborRate);
        return qty * (mat + lab);
    }
    function calcGrandTotalFromItems(costItems) {
        return (costItems || []).reduce((s, ci) =>
            s + (ci.subItems || []).reduce((s2, si) =>
                s2 + (si.lineItems || []).reduce((s3, li) => s3 + calcLITotalStatic(li), 0), 0), 0);
    }
    function calcTotalAccFromItems(costItems, discount) {
        const raw = (costItems || []).reduce((s, ci) =>
            s + (ci.subItems || []).reduce((s2, si) =>
                s2 + (si.lineItems || []).reduce((s3, li) =>
                    s3 + calcLITotalStatic(li) * (parseNum(li.percentCompletion) / 100), 0), 0), 0);
        return raw * discountRatio(calcGrandTotalFromItems(costItems), discount);
    }

    // ── Back to grid ───────────────────────────────────────────
    window.boqBackToProjects = function () {
        if (boq.isDirty && !confirm('You have unsaved changes. Leave without saving?')) return;
        boq.isDirty = false;
        boq.currentFolderId = null;
        boq.doc = null;
        renderGridPage();
    };

    function markDirty() {
        boq.isDirty = true;
        const badge = document.querySelector('.boq-badge');
        if (badge && !badge.classList.contains('boq-badge-dirty')) {
            badge.className = 'boq-badge boq-badge-dirty';
            badge.textContent = 'Unsaved';
        }
    }

    // ── Select folder → open builder ───────────────────────────
    window.boqSelectFolder = async function (folderId) {
        boq.currentFolderId = folderId;
        const root = el('boqBuilderView');
        if (root) root.innerHTML = '<div class="boq-loading" style="padding:3rem;text-align:center;">Loading report...</div>';

        try {
            // Some folders may have multiple boqDocuments due to past save bugs.
            // Pick the "best" one: most costItems → most recently updated.
            const matches = boq.allDocs.filter(x => x.folderId === folderId);
            let d = null;
            if (matches.length) {
                d = matches.slice().sort((a, b) => {
                    const ac = (a.costItems || []).length;
                    const bc = (b.costItems || []).length;
                    if (ac !== bc) return bc - ac;
                    const at = a.updatedAt && a.updatedAt.toMillis ? a.updatedAt.toMillis() : 0;
                    const bt = b.updatedAt && b.updatedAt.toMillis ? b.updatedAt.toMillis() : 0;
                    return bt - at;
                })[0];
                if (matches.length > 1) {
                    console.warn(`[BOQ] Found ${matches.length} duplicate docs for folder ${folderId}. Using ${d.id} (${(d.costItems||[]).length} items). Other ids:`, matches.filter(m => m.id !== d.id).map(m => `${m.id} (${(m.costItems||[]).length} items)`));
                }
            }
            if (!d) {
                const snap = await db.collection('boqDocuments')
                    .where('userId', '==', uid())
                    .where('folderId', '==', folderId)
                    .limit(1)
                    .get();
                if (!snap.empty) d = { id: snap.docs[0].id, ...snap.docs[0].data() };
            }

            if (d) {
                boq.doc = d;
                boq.header = {
                    date:        d.date        || '',
                    projectName: d.projectName || '',
                    area:        d.area        || '',
                    ownerName:   d.ownerName   || '',
                    location:    d.location    || '',
                    subject:     'Accomplishment Report'
                };
                boq.costItems   = d.costItems   || [];
                boq.discount    = d.discount    || 0;
                boq.clientEmail = d.clientEmail || '';
                boq.status      = d.status || 'draft';
                boq.terms       = d.terms  || boq.terms;
                // Documents saved before custom sections existed have no `custom`
                // key; normalise so every later read can assume an array.
                if (!Array.isArray(boq.terms.custom)) boq.terms.custom = [];
                // Same for the signature toggles — an older document has no
                // signOff, and both blocks printed, so default both to on.
                if (!boq.terms.signOff || typeof boq.terms.signOff !== 'object') {
                    boq.terms.signOff = { client: true, contractor: true };
                }
            } else {
                const folder = boq.folders.find(f => f.id === folderId);
                boq.doc = null;
                boq.header = {
                    date:        new Date().toISOString().split('T')[0],
                    projectName: folder?.name || '',
                    area:        '',
                    ownerName:   '',
                    location:    '',
                    subject:     'Accomplishment Report'
                };
                boq.costItems   = [];
                boq.discount    = 0;
                boq.clientEmail = '';
                boq.status      = 'draft';
                boq.terms       = {
                    payments:          '50% DOWNPAYMENT\n40% PROGRESS BILLING\n  15% Progress Billing No. 1\n  15% Progress Billing No. 2\n  10% Progress Billing No. 3\n10% UPON TURNOVER/COC',
                    exclusions:        'Fire Protection Works (Sprinkler, Smoke Detectors, etc)\nMattress, Beddings and Pillows\nPanel Board and other electrical works not mentioned\nPlumbing works not mentioned\nAppliances (TV, Refrigerator, Stove, Range Hood, Water Heater, Filters and etc)\nA/C Supply and Install\nDecors and Accessories (Wall Paintings, Vases, Displays and etc)\nRetained Wall, Ceiling and Floor Finishes\nWindow Treatments (Blinds and Curtains)',
                    duration:          '45 - 60 Days',
                    includePayments:   true,
                    includeExclusions: true,
                    includeDuration:   true,
                    custom:            [],
                    signOff:           { client: true, contractor: true }
                };
            }
            await loadMobilizationExpenses(folderId);
            renderBuilderArea();
        } catch (e) {
            console.error('BOQ load error:', e);
            const root = el('boqBuilderView');
            if (root) root.innerHTML = '<div class="boq-error" style="padding:3rem;text-align:center;color:#ef4444;">Error loading BOQ. Please try again.</div>';
        }
    };

    // ── Load mobilization expenses ────────────────────────────
    // Pulls every expense logged in the Expenses module whose name relates to
    // mobilization/demobilization, so they can be picked when editing a line
    // item in a Mobilization sub-item.
    async function loadMobilizationExpenses(folderId) {
        boq.mobExpenses = [];
        try {
            const expSnap = await db.collection('expenses')
                .where('userId', '==', uid())
                .get();
            const all = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            // "demobilization" also contains "mobiliz", so one test covers both.
            boq.mobExpenses = all
                .filter(e => (e.expenseName || '').toLowerCase().includes('mobiliz'))
                .sort((a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0));
            console.log(`[BOQ] Loaded ${boq.mobExpenses.length} mobilization expense(s) of ${all.length} total.`);
        } catch (e) {
            console.error('BOQ mobilization expenses load error:', e);
        }
    }

    // ── Render builder area ────────────────────────────────────
    function renderBuilderArea() {
        const root = el('boqBuilderView');
        if (!root) return;
        const folder = boq.folders.find(f => f.id === boq.currentFolderId);
        const hasDoc = !!boq.doc;

        root.innerHTML = `<div id="boqBuilderArea"><div class="boq-builder">
            <div class="boq-toolbar">
                <div class="boq-toolbar-left">
                    <button class="boq-back-btn" onclick="boqBackToProjects()">
                        <i data-lucide="arrow-left"></i> Project Folders
                    </button>
                    <span class="boq-breadcrumb-sep">/</span>
                    <h3 class="boq-project-title">${escHtml(folder?.name || 'Project')}</h3>
                    <span class="boq-badge ${hasDoc ? 'boq-badge-saved' : 'boq-badge-new'}">${hasDoc ? 'Saved' : 'New'}</span>
                </div>
                <div class="boq-toolbar-right">
                    ${boqStatusBadgeHtml(boq.status)}
                    <button class="ovhd-guide-btn" onclick="document.getElementById('boqGuideModal').style.display='flex'" title="Learn how to use the Report Editor">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        Guide me
                    </button>
                    <button class="boq-btn boq-btn-outline" onclick="boqPrintReport()">
                        <i data-lucide="printer"></i> Print
                    </button>
                    <button class="boq-btn boq-btn-outline" onclick="boqExportPDF()">
                        <i data-lucide="file-down"></i> Export PDF
                    </button>
                    <button class="boq-btn boq-btn-primary" id="boqSaveBtn" onclick="boqSave()">
                        <i data-lucide="save"></i> Save
                    </button>
                </div>
            </div>

            <div class="boq-header-form">
                <div class="boq-section-title">Document Info</div>
                <div class="boq-form-grid">
                    <div class="boq-form-group">
                        <label>Date</label>
                        <input type="date" id="boqDate" value="${boq.header.date}">
                    </div>
                    <div class="boq-form-group">
                        <label>Project Name</label>
                        <input type="text" id="boqProjectName" placeholder="Project name" value="${boq.header.projectName}">
                    </div>
                    <div class="boq-form-group">
                        <label>Area (sqm)</label>
                        <input type="text" id="boqArea" placeholder="e.g. 120" value="${boq.header.area}">
                    </div>
                    <div class="boq-form-group">
                        <label>Owner Name</label>
                        <input type="text" id="boqOwnerName" placeholder="Owner / Client name" value="${boq.header.ownerName}">
                    </div>
                    <div class="boq-form-group">
                        <label>Location</label>
                        <input type="text" id="boqLocation" placeholder="Project location" value="${boq.header.location}">
                    </div>
                </div>
            </div>

            <div class="boq-terms-panel">
                <div class="boq-section-title">Terms &amp; Conditions
                    <span class="boq-terms-note">(check each section to include in PDF &amp; Print)</span>
                </div>
                <div class="boq-terms-grid">
                    <div class="boq-terms-group">
                        <label class="boq-terms-label">
                            <input type="checkbox" id="boqIncludePayments" class="boq-terms-chk" ${boq.terms.includePayments !== false ? 'checked' : ''}>
                            I. Terms of Payment
                        </label>
                        <textarea id="boqTermsPayments" class="boq-terms-textarea" rows="7" placeholder="Enter payment terms...">${escHtml(boq.terms.payments)}</textarea>
                    </div>
                    <div class="boq-terms-group">
                        <label class="boq-terms-label">
                            <input type="checkbox" id="boqIncludeExclusions" class="boq-terms-chk" ${boq.terms.includeExclusions !== false ? 'checked' : ''}>
                            II. Exclusions
                        </label>
                        <textarea id="boqTermsExclusions" class="boq-terms-textarea" rows="7" placeholder="List exclusions (one per line)...">${escHtml(boq.terms.exclusions)}</textarea>
                    </div>
                    <div class="boq-terms-group boq-terms-wide">
                        <label class="boq-terms-label">
                            <input type="checkbox" id="boqIncludeDuration" class="boq-terms-chk" ${boq.terms.includeDuration !== false ? 'checked' : ''}>
                            III. Duration
                        </label>
                        <textarea id="boqTermsDuration" class="boq-terms-textarea" rows="2" placeholder="e.g. 45 - 60 Days">${escHtml(boq.terms.duration)}</textarea>
                    </div>
                    <div id="boqTermsCustom" class="boq-terms-contents">${boqCustomTermsHTML()}</div>
                </div>
                <button type="button" class="boq-terms-add" onclick="boqAddTermSection()">
                    <i data-lucide="plus"></i> Add section
                </button>
            </div>

            <div class="boq-terms-panel">
                <div class="boq-section-title">Signature Block
                    <span class="boq-terms-note">(uncheck to leave a signature line off the printed report)</span>
                </div>
                <div class="boq-sign-grid">
                    <label class="boq-terms-label">
                        <input type="checkbox" id="boqSignClient" class="boq-terms-chk" ${boq.terms.signOff.client !== false ? 'checked' : ''}>
                        <span>
                            <span class="boq-sign-name">${escHtml(boq.header.ownerName || 'Client name not set')}</span>
                            <span class="boq-sign-role">Client / Owner</span>
                        </span>
                    </label>
                    <label class="boq-terms-label">
                        <input type="checkbox" id="boqSignContractor" class="boq-terms-chk" ${boq.terms.signOff.contractor !== false ? 'checked' : ''}>
                        <span>
                            <span class="boq-sign-name">DAC&rsquo;S BUILDING DESIGN SERVICES</span>
                            <span class="boq-sign-role">Contractor / Prepared By</span>
                        </span>
                    </label>
                </div>
            </div>

            <div class="boq-client-panel">
                <div class="boq-section-title">Client Access</div>
                <div class="boq-client-form-row">
                    <div class="boq-form-group" style="flex:1;min-width:200px;">
                        <label>Client Email Address</label>
                        <input type="email" id="boqClientEmail" class="boq-input"
                               placeholder="client@email.com"
                               value="${escHtml(boq.clientEmail || '')}">
                    </div>
                </div>
                <p class="boq-client-hint">Add the client's email to give them access to view this report. Click Save to apply.</p>
            </div>

            <div class="boq-table-wrapper">
                <div class="boq-section-title">Bill of Quantities / Work Items</div>
                <div class="boq-table-scroll">
                    <table class="boq-table">
                        <thead>
                            <tr class="boq-thead-row">
                                <th class="boq-col-no">Item No.</th>
                                <th class="boq-col-desc">Descriptions</th>
                                <th class="boq-col-qty">QTY</th>
                                <th class="boq-col-unit">Unit</th>
                                <th class="boq-col-rate">Material &amp; Consumables</th>
                                <th class="boq-col-rate">Labor &amp; Equipment</th>
                                <th class="boq-col-amount">Total Amount</th>
                                <th class="boq-col-pct">% Complete</th>
                                <th class="boq-col-amount">Accomplishment</th>
                                <th class="boq-col-actions">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="boqTableBody">${renderTableBody()}</tbody>
                    </table>
                </div>
                <div class="boq-add-item-row">
                    <button class="boq-btn-add-cost" onclick="boqShowDivisionModal()">
                        <i data-lucide="plus-circle"></i> Add Cost Item
                    </button>
                </div>
            </div>

            <div class="boq-totals-card" id="boqTotalsCard"${window.currentUserRole === 'staff' ? ' style="display:none"' : ''}>
                ${renderTotals()}
            </div>
        </div></div>`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ── Render table body ──────────────────────────────────────
    function renderTableBody() {
        if (!boq.costItems.length) {
            return `<tr class="boq-empty-row"><td colspan="10">No items yet. Click "Add Cost Item" below to start building the BOQ.</td></tr>`;
        }
        let html = '';
        boq.costItems.forEach((ci, ciIdx) => {
            const ciNo = toRoman(ciIdx);
            html += `
            <tr class="boq-row-l1" id="row-ci-${ci.id}">
                <td class="boq-col-no boq-l1-no">${ciNo}.</td>
                <td class="boq-col-desc boq-l1-label" colspan="6" id="ci-label-${ci.id}">
                    <span class="boq-l1-text" ondblclick="boqEditCILabel('${ci.id}')">${escHtml(ci.label || 'UNTITLED SECTION')}</span>
                </td>
                <td class="boq-col-pct"></td>
                <td class="boq-col-amount"></td>
                <td class="boq-col-actions boq-l1-actions">
                    <button class="boq-icon-btn boq-icon-btn-edit" title="Edit label"   onclick="boqEditCILabel('${ci.id}')"><i data-lucide="pencil"></i></button>
                    <button class="boq-icon-btn boq-icon-btn-add"  title="Add Sub-item" onclick="boqAddSubItem('${ci.id}')"><i data-lucide="plus"></i></button>
                    <button class="boq-icon-btn" title="Move Up"   onclick="boqMoveCostItem('${ci.id}',-1)" style="color:#6b7280"><i data-lucide="chevron-up"></i></button>
                    <button class="boq-icon-btn" title="Move Down" onclick="boqMoveCostItem('${ci.id}',1)"  style="color:#6b7280"><i data-lucide="chevron-down"></i></button>
                    <button class="boq-icon-btn boq-icon-btn-del"  title="Delete section" onclick="boqDeleteCostItem('${ci.id}')"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>`;

            ci.subItems.forEach((si, siIdx) => {
                const siNo = toAlpha(siIdx);
                html += `
                <tr class="boq-row-l2" id="row-si-${si.id}">
                    <td class="boq-col-no boq-l2-no">${siNo}.</td>
                    <td class="boq-col-desc boq-l2-label" colspan="6" id="si-label-${si.id}">
                        <span class="boq-l2-text" ondblclick="boqEditSILabel('${ci.id}','${si.id}')">${escHtml(si.label || 'Sub-item')}</span>
                    </td>
                    <td class="boq-col-pct"></td>
                    <td class="boq-col-amount"></td>
                    <td class="boq-col-actions boq-l2-actions">
                        <button class="boq-icon-btn boq-icon-btn-edit" title="Edit label"  onclick="boqEditSILabel('${ci.id}','${si.id}')"><i data-lucide="pencil"></i></button>
                        <button class="boq-icon-btn boq-icon-btn-add"  title="Add Line Item" onclick="boqAddLineItem('${ci.id}','${si.id}')"><i data-lucide="plus"></i></button>
                        <button class="boq-icon-btn boq-icon-btn-group" title="Add Group Header" onclick="boqAddGroupHeader('${ci.id}','${si.id}')"><i data-lucide="layout-list"></i></button>
                        <button class="boq-icon-btn boq-icon-btn-photos" title="Photos" onclick="boqTogglePhotos('${ci.id}','${si.id}')" id="photos-btn-${si.id}">
                            <i data-lucide="image"></i>${(si.images||[]).length ? `<span class="boq-img-count">${si.images.length}</span>` : ''}
                        </button>
                        <button class="boq-icon-btn" title="Move Up"   onclick="boqMoveSubItem('${ci.id}','${si.id}',-1)" style="color:#6b7280"><i data-lucide="chevron-up"></i></button>
                        <button class="boq-icon-btn" title="Move Down" onclick="boqMoveSubItem('${ci.id}','${si.id}',1)"  style="color:#6b7280"><i data-lucide="chevron-down"></i></button>
                        <button class="boq-icon-btn boq-icon-btn-del"  title="Delete sub-item" onclick="boqDeleteSubItem('${ci.id}','${si.id}')"><i data-lucide="trash-2"></i></button>
                    </td>
                </tr>
                ${buildPhotosRow(ci.id, si)}`;

                let itemCount = 0;
                si.lineItems.forEach((li) => {
                    if (li.type !== 'group') itemCount++;
                    html += renderLineItemRow(ci.id, si.id, li, itemCount - 1, false);
                });
            });

            // Subtotal row
            html += `
            <tr class="boq-row-subtotal">
                <td colspan="6" class="boq-subtotal-label">Subtotal — ${ciNo}. ${escHtml(ci.label || '')}</td>
                <td class="boq-col-amount boq-subtotal-val" id="subtotal-${ci.id}">₱ ${fmt(calcCostItemSubtotal(ci))}</td>
                <td></td>
                <td class="boq-col-amount boq-subtotal-val" id="subtotal-acc-${ci.id}">₱ ${fmt(calcCostItemAccomplishment(ci))}</td>
                <td></td>
            </tr>`;
        });
        return html;
    }

    // Options for a rate-type <select> ("Enter value" / By owner / N/A).
    //
    // A rate override is stored as free text and rendered verbatim, so a row can
    // legitimately carry wording this dropdown never offered — 'by MadHouse',
    // 'included in Carpentry Works', 'existing', 'retained', or a blank cell
    // (see tools/boq-import/*, which import whole BOQs straight from a PDF).
    //
    // When such a row was opened for editing, NO option matched, so the browser
    // fell back to the first one ("Enter value") and boqSaveLineItem then wrote
    // materialOverride = null with a 0 rate — silently erasing the wording and
    // leaving a bare dash in the report. Editing a row's % complete was enough
    // to lose it. (Audited on PRADO RESIDENCE, 2026-07-30: 11 rows.)
    //
    // Fix: whatever the row already carries is offered as its own option and
    // pre-selected, so an edit round-trips it unchanged. `by owner` and N/A keep
    // working exactly as before.
    function rateTypeOptions(override) {
        const ov    = override == null ? '' : String(override);
        const known = ['', 'value', 'by owner', 'not applicable'];
        // A whitespace-only override is the "deliberately blank cell" convention:
        // truthy (so it counts as ₱0) but printing as nothing. Label it, or it
        // would show up in the dropdown as an unpickable empty row.
        const custom = (ov && known.indexOf(ov) === -1)
            ? `<option value="${escAttr(ov)}" selected>${escHtml(ov.trim() || '(blank)')}</option>`
            : '';
        return `<option value="value" ${ov ? '' : 'selected'}>Enter value</option>`
             + `<option value="by owner" ${ov === 'by owner' ? 'selected' : ''}>By owner</option>`
             + `<option value="not applicable" ${ov === 'not applicable' ? 'selected' : ''}>N/A</option>`
             + custom;
    }

    // Returns the 0-based display index of a line item, skipping group headers
    function itemDisplayIdx(lineItems, liId) {
        let count = 0;
        for (const item of lineItems) {
            if (item.type !== 'group') count++;
            if (item.id === liId) return count - 1;
        }
        return 0;
    }

    // ── Render single line item row ────────────────────────────
    function renderLineItemRow(ciId, siId, li, liIdx, editMode) {
        // ── Group header row (category label, no quantities) ──
        if (li.type === 'group') {
            if (editMode) {
                return `
                <tr class="boq-row-group boq-row-editing" id="row-li-${li.id}">
                    <td colspan="9" class="boq-group-label" id="group-label-${li.id}">
                        <input type="text" class="boq-label-input boq-group-input" id="group-inp-${li.id}"
                               value="${escAttr(li.label||'')}" placeholder="Group header (e.g. ENTRY/FOYER)"
                               onkeydown="if(event.key==='Enter')boqSaveGroupHeader('${ciId}','${siId}','${li.id}');else if(event.key==='Escape')boqCancelGroupHeader('${ciId}','${siId}','${li.id}')">
                        <span class="boq-label-actions">
                            <button class="boq-icon-btn boq-icon-btn-save" onclick="boqSaveGroupHeader('${ciId}','${siId}','${li.id}')"><i data-lucide="check"></i></button>
                            <button class="boq-icon-btn boq-icon-btn-cancel" onclick="boqCancelGroupHeader('${ciId}','${siId}','${li.id}')"><i data-lucide="x"></i></button>
                        </span>
                    </td>
                    <td class="boq-col-actions"></td>
                </tr>`;
            }
            return `
            <tr class="boq-row-group" id="row-li-${li.id}">
                <td colspan="9" class="boq-group-label" id="group-label-${li.id}">
                    <span class="boq-group-text" ondblclick="boqEditGroupHeader('${ciId}','${siId}','${li.id}')">${escHtml(li.label || 'GROUP HEADER')}</span>
                </td>
                <td class="boq-col-actions">
                    <button class="boq-icon-btn boq-icon-btn-edit" title="Edit"       onclick="boqEditGroupHeader('${ciId}','${siId}','${li.id}')"><i data-lucide="pencil"></i></button>
                    <button class="boq-icon-btn boq-icon-btn-add"  title="Add Line Item" onclick="boqInsertLineItemAfter('${ciId}','${siId}','${li.id}')"><i data-lucide="plus"></i></button>
                    <button class="boq-icon-btn" title="Move Up"   onclick="boqMoveLineItem('${ciId}','${siId}','${li.id}',-1)" style="color:#6b7280"><i data-lucide="chevron-up"></i></button>
                    <button class="boq-icon-btn" title="Move Down" onclick="boqMoveLineItem('${ciId}','${siId}','${li.id}',1)"  style="color:#6b7280"><i data-lucide="chevron-down"></i></button>
                    <button class="boq-icon-btn boq-icon-btn-del"  title="Delete" onclick="boqDeleteLineItem('${ciId}','${siId}','${li.id}')"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>`;
        }

        if (editMode) {
            const matSel = rateTypeOptions(li.materialOverride);
            const labSel = rateTypeOptions(li.laborOverride);

            const _liKeys = `onkeydown="if(event.key==='Enter')boqSaveLineItem('${ciId}','${siId}','${li.id}');else if(event.key==='Escape')boqCancelEditLI('${ciId}','${siId}','${li.id}')"`;

            // Show a "fill from mobilization expense" picker only inside a Mobilization sub-item.
            const _ci  = boq.costItems.find(c => c.id === ciId);
            const _si  = _ci?.subItems?.find(s => s.id === siId);
            const _isMobSub = (_si?.label || '').toLowerCase().includes('mobiliz');
            let _mobPicker = '';
            if (_isMobSub) {
                _mobPicker = boq.mobExpenses.length
                    ? `<select class="boq-cell-select boq-mob-picker" onchange="boqFillFromExpense('${li.id}', this)" title="Fill from a mobilization expense">
                            <option value="">+ Fill from mobilization expense…</option>
                            ${boq.mobExpenses.map(e => `<option value="${escAttr(e.id)}">${escHtml(e.expenseName || 'Expense')} — ₱${fmt(e.amount)}</option>`).join('')}
                       </select>`
                    : `<select class="boq-cell-select boq-mob-picker" disabled title="No mobilization expenses found in the Expenses module">
                            <option value="">No mobilization expenses found</option>
                       </select>`;
            }
            return `
            <tr class="boq-row-l3 boq-row-editing" id="row-li-${li.id}">
                <td class="boq-col-no">
                    <input type="text" class="boq-cell-input" id="li-no-${li.id}" value="${escAttr(li.itemNo||'')}" placeholder="#" ${_liKeys}>
                </td>
                <td class="boq-col-desc">
                    <div style="display:flex;align-items:center;gap:5px;">
                        <input type="text" class="boq-cell-input boq-input-desc" id="li-desc-${li.id}" value="${escAttr(li.description||'')}" placeholder="Description" ${_liKeys}>
                        <label class="boq-opt-check" title="Optional item">
                            <input type="checkbox" id="li-opt-${li.id}" ${li.isOptional?'checked':''}> Opt.
                        </label>
                    </div>
                    ${_mobPicker}
                </td>
                <td class="boq-col-qty">
                    <input type="text" class="boq-cell-input" id="li-qty-${li.id}" value="${li.qty||''}" oninput="boqCalcRow('${li.id}')" placeholder="0" ${_liKeys}>
                </td>
                <td class="boq-col-unit">
                    <input type="text" class="boq-cell-input" id="li-unit-${li.id}" value="${escAttr(li.unit||'')}" placeholder="unit" ${_liKeys}>
                </td>
                <td class="boq-col-rate">
                    <select class="boq-cell-select" id="li-mat-type-${li.id}" onchange="boqToggleRate('${li.id}','mat')">${matSel}</select>
                    <input type="text" class="boq-cell-input" id="li-mat-${li.id}"
                           value="${li.materialOverride?'':fmt(li.materialRate)}"
                           oninput="boqCalcRow('${li.id}')" placeholder="0.00"
                           style="${li.materialOverride?'display:none':''}" ${_liKeys}>
                </td>
                <td class="boq-col-rate">
                    <select class="boq-cell-select" id="li-lab-type-${li.id}" onchange="boqToggleRate('${li.id}','lab')">${labSel}</select>
                    <input type="text" class="boq-cell-input" id="li-lab-${li.id}"
                           value="${li.laborOverride?'':fmt(li.laborRate)}"
                           oninput="boqCalcRow('${li.id}')" placeholder="0.00"
                           style="${li.laborOverride?'display:none':''}" ${_liKeys}>
                </td>
                <td class="boq-col-amount boq-cell-calc" id="li-total-${li.id}">₱ ${fmt(li.totalAmount)}</td>
                <td class="boq-col-pct">
                    <input type="number" class="boq-cell-input" id="li-pct-${li.id}"
                           value="${li.percentCompletion||0}" min="0" max="100"
                           oninput="boqCalcRow('${li.id}')" placeholder="0" ${_liKeys}>
                </td>
                <td class="boq-col-amount boq-cell-calc" id="li-acc-${li.id}">₱ ${fmt(li.accomplishmentAmount)}</td>
                <td class="boq-col-actions">
                    <button class="boq-icon-btn boq-icon-btn-save"   title="Save"   onclick="boqSaveLineItem('${ciId}','${siId}','${li.id}')"><i data-lucide="check"></i></button>
                    <button class="boq-icon-btn boq-icon-btn-cancel" title="Cancel" onclick="boqCancelEditLI('${ciId}','${siId}','${li.id}')"><i data-lucide="x"></i></button>
                </td>
            </tr>`;
        }

        const matDisplay = li.materialOverride || fmt(li.materialRate) || '—';
        const labDisplay = li.laborOverride    || fmt(li.laborRate)    || '—';
        return `
        <tr class="boq-row-l3 ${li.isOptional?'boq-row-optional':''}" id="row-li-${li.id}">
            <td class="boq-col-no boq-l3-no">${escHtml(li.itemNo || String(liIdx + 1))}</td>
            <td class="boq-col-desc">${escHtml(li.description||'')}${li.isOptional?' <em class="boq-optional-tag">(optional)</em>':''}</td>
            <td class="boq-col-qty" style="text-align:center">${li.qty||''}</td>
            <td class="boq-col-unit" style="text-align:center">${escHtml(li.unit||'')}</td>
            <td class="boq-col-rate">${escHtml(matDisplay)}</td>
            <td class="boq-col-rate">${escHtml(labDisplay)}</td>
            <td class="boq-col-amount">₱ ${fmt(li.totalAmount)}</td>
            <td class="boq-col-pct" style="text-align:center">${li.percentCompletion||0}%</td>
            <td class="boq-col-amount">₱ ${fmt(li.accomplishmentAmount)}</td>
            <td class="boq-col-actions">
                <button class="boq-icon-btn boq-icon-btn-edit" title="Edit"        onclick="boqEditLineItem('${ciId}','${siId}','${li.id}')"><i data-lucide="pencil"></i></button>
                <button class="boq-icon-btn" title="Move Up"                       onclick="boqMoveLineItem('${ciId}','${siId}','${li.id}',-1)" style="color:#6b7280"><i data-lucide="chevron-up"></i></button>
                <button class="boq-icon-btn" title="Move Down"                     onclick="boqMoveLineItem('${ciId}','${siId}','${li.id}',1)"  style="color:#6b7280"><i data-lucide="chevron-down"></i></button>
                <button class="boq-icon-btn boq-icon-btn-del"  title="Delete"      onclick="boqDeleteLineItem('${ciId}','${siId}','${li.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>
        `;
    }

    // ── Render totals ──────────────────────────────────────────
    function renderTotals() {
        // Staff must not see project cost / accomplishment figures
        if (window.currentUserRole === 'staff') return '';
        const grand      = calcGrandTotal();
        const disc       = boq.discount || 0;
        const discounted = Math.max(0, grand - disc);
        const totalAcc   = calcTotalAccomplishment();
        return `
        <div class="boq-section-title">Summary</div>
        <div class="boq-totals-grid">
            <div class="boq-total-row">
                <span class="boq-total-label">Total Project Cost (VAT Exclusive):</span>
                <span class="boq-total-value" id="boqGrandTotal">₱ ${fmt(grand)}</span>
            </div>
            <div class="boq-total-row">
                <span class="boq-total-label">Discount:</span>
                <span class="boq-total-value">
                    ₱ <input type="text" class="boq-discount-input" id="boqDiscountInput"
                             value="${fmt(disc)}" oninput="boqUpdateDiscount(this)">
                </span>
            </div>
            <div class="boq-total-row boq-total-row-final">
                <span class="boq-total-label">Discounted Total Project Cost:</span>
                <span class="boq-total-value" id="boqDiscountedTotal">₱ ${fmt(discounted)}</span>
            </div>
            <div class="boq-total-row boq-total-acc">
                <span class="boq-total-label">Total Accomplishment:</span>
                <span class="boq-total-value" id="boqTotalAccomplishment">₱ ${fmt(totalAcc)}</span>
            </div>
        </div>`;
    }

    // ── Calculations ───────────────────────────────────────────
    function calcLITotal(li) {
        const qty = parseNum(li.qty);
        const mat = li.materialOverride ? 0 : parseNum(li.materialRate);
        const lab = li.laborOverride    ? 0 : parseNum(li.laborRate);
        return qty * (mat + lab);
    }
    function calcLIAcc(li) { return calcLITotal(li) * (parseNum(li.percentCompletion) / 100); }
    function calcCostItemSubtotal(ci) {
        return ci.subItems.reduce((s, si) => s + si.lineItems.reduce((s2, li) => s2 + calcLITotal(li), 0), 0);
    }
    function calcCostItemAccomplishment(ci) {
        return ci.subItems.reduce((s, si) => s + si.lineItems.reduce((s2, li) => s2 + calcLIAcc(li), 0), 0);
    }
    function calcGrandTotal()         { return boq.costItems.reduce((s, ci) => s + calcCostItemSubtotal(ci), 0); }

    // Accomplishment is claimed against the discounted contract, not the gross
    // cost, so the discount is spread across it in proportion to work done.
    // Section subtotal rows stay gross — they reconcile to Total Project Cost.
    function discountRatio(grand, discount) {
        if (!grand) return 1;
        return Math.max(0, grand - (parseNum(discount) || 0)) / grand;
    }
    // Raw = gross value of work done. Use it for % complete (raw/grand), never
    // for the peso figure shown to the client.
    function calcTotalAccomplishmentRaw() {
        return boq.costItems.reduce((s, ci) => s + calcCostItemAccomplishment(ci), 0);
    }
    function calcTotalAccomplishment() {
        return calcTotalAccomplishmentRaw() * discountRatio(calcGrandTotal(), boq.discount);
    }

    // ── Live calc while editing a row ──────────────────────────
    window.boqCalcRow = function (liId) {
        const qty    = parseNum((el(`li-qty-${liId}`)?.value || '').replace(/,/g,''));
        const matT   = el(`li-mat-type-${liId}`)?.value;
        const labT   = el(`li-lab-type-${liId}`)?.value;
        const mat    = matT === 'value' ? parseNum((el(`li-mat-${liId}`)?.value||'').replace(/,/g,'')) : 0;
        const lab    = labT === 'value' ? parseNum((el(`li-lab-${liId}`)?.value||'').replace(/,/g,'')) : 0;
        const total  = qty * (mat + lab);
        const pct    = parseNum(el(`li-pct-${liId}`)?.value || 0);
        const acc    = total * (pct / 100);
        const tEl    = el(`li-total-${liId}`);
        const aEl    = el(`li-acc-${liId}`);
        if (tEl) tEl.textContent = '₱ ' + fmt(total);
        if (aEl) aEl.textContent = '₱ ' + fmt(acc);
    };

    window.boqToggleRate = function (liId, type) {
        const sel    = el(`li-${type}-type-${liId}`)?.value;
        const input  = el(`li-${type}-${liId}`);
        if (input) { input.style.display = sel === 'value' ? '' : 'none'; if (sel !== 'value') input.value = ''; }
        boqCalcRow(liId);
    };

    // Fill a line item from a selected mobilization expense (description + amount).
    // Mobilization is booked under Labor & Equipment (material N/A), matching how
    // the existing Mobilization rows are recorded.
    window.boqFillFromExpense = function (liId, sel) {
        const exp = (boq.mobExpenses || []).find(e => e.id === sel.value);
        sel.value = '';                       // reset so the placeholder shows again
        if (!exp) return;

        const descInput = el(`li-desc-${liId}`);
        if (descInput) descInput.value = exp.expenseName || '';

        const matType = el(`li-mat-type-${liId}`);
        if (matType) { matType.value = 'not applicable'; boqToggleRate(liId, 'mat'); }

        const labType  = el(`li-lab-type-${liId}`);
        const labInput = el(`li-lab-${liId}`);
        if (labType)  { labType.value = 'value'; boqToggleRate(liId, 'lab'); }
        if (labInput)   labInput.value = fmt(exp.amount);

        const qtyInput = el(`li-qty-${liId}`);
        if (qtyInput && !parseNum(qtyInput.value)) qtyInput.value = 1;
        const unitInput = el(`li-unit-${liId}`);
        if (unitInput && !unitInput.value) unitInput.value = 'lot';

        boqCalcRow(liId);
    };

    // ── Refresh totals display ─────────────────────────────────
    function refreshTotals() {
        const grand = calcGrandTotal();
        const disc  = boq.discount || 0;
        function setEl(id, val) { const e = el(id); if (e) e.textContent = '₱ ' + fmt(val); }
        setEl('boqGrandTotal', grand);
        setEl('boqDiscountedTotal', Math.max(0, grand - disc));
        setEl('boqTotalAccomplishment', calcTotalAccomplishment());
        boq.costItems.forEach(ci => {
            setEl(`subtotal-${ci.id}`,     calcCostItemSubtotal(ci));
            setEl(`subtotal-acc-${ci.id}`, calcCostItemAccomplishment(ci));
        });
    }

    window.boqUpdateDiscount = function (input) {
        boq.discount = parseNum(input.value.replace(/,/g,''));
        const e = el('boqDiscountedTotal');
        if (e) e.textContent = '₱ ' + fmt(Math.max(0, calcGrandTotal() - boq.discount));
        const a = el('boqTotalAccomplishment');
        if (a) a.textContent = '₱ ' + fmt(calcTotalAccomplishment());
        markDirty();
    };

    // ── Division picker modal ──────────────────────────────────
    const BOQ_DIVISIONS = [
        { no: 1,  label: 'General Requirements' },
        { no: 2,  label: 'Sitework' },
        { no: 3,  label: 'Concrete' },
        { no: 4,  label: 'Masonry' },
        { no: 5,  label: 'Metals' },
        { no: 6,  label: 'Wood and Plastics' },
        { no: 7,  label: 'Thermal and Moisture Protection' },
        { no: 8,  label: 'Door and Windows' },
        { no: 9,  label: 'Finishes' },
        { no: 10, label: 'Specialties' },
        { no: 11, label: 'Equipment' },
        { no: 12, label: 'Furnishing' },
        { no: 13, label: 'Special Construction' },
        { no: 14, label: 'Conveying System' },
        { no: 15, label: 'Mechanical' },
        { no: 16, label: 'Electrical' },
    ];

    window.boqShowDivisionModal = function () {
        // Remove any existing modal
        const existing = document.getElementById('boqDivModal');
        if (existing) existing.remove();

        // Which division numbers are already added?
        const usedNos = new Set(boq.costItems.map(ci => ci.divisionNo).filter(Boolean));

        const rows = BOQ_DIVISIONS.map(d => {
            const already = usedNos.has(d.no);
            return `
            <label class="boq-div-row${already ? ' boq-div-row--added' : ''}">
                <input type="checkbox" class="boq-div-check" value="${d.no}" ${already ? 'disabled checked' : ''}>
                <span class="boq-div-num">Division ${d.no}</span>
                <span class="boq-div-name">${d.label}</span>
                ${already ? '<span class="boq-div-tag">Added</span>' : ''}
            </label>`;
        }).join('');

        const modal = document.createElement('div');
        modal.id = 'boqDivModal';
        modal.className = 'boq-modal-overlay';
        modal.innerHTML = `
        <div class="boq-modal-card boq-div-modal-card" onclick="event.stopPropagation()">
            <div class="boq-modal-header">
                <h3>Add Cost Item</h3>
                <button class="boq-icon-btn" onclick="document.getElementById('boqDivModal').remove()">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <p class="boq-modal-sub">Select one or more divisions to add as cost sections.</p>
            <div class="boq-div-select-all-row">
                <label class="boq-div-select-all-lbl">
                    <input type="checkbox" id="boqDivSelectAll"> Select all available
                </label>
            </div>
            <div class="boq-div-list">${rows}</div>
            <div class="boq-div-footer">
                <button class="boq-btn boq-btn-ghost" onclick="document.getElementById('boqDivModal').remove()">Cancel</button>
                <button class="boq-btn boq-btn-primary" onclick="boqConfirmDivisions()">
                    <i data-lucide="plus-circle"></i> Add Selected
                </button>
            </div>
        </div>`;

        modal.addEventListener('click', () => modal.remove());
        document.body.appendChild(modal);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Select-all logic
        const selectAll = document.getElementById('boqDivSelectAll');
        if (selectAll) {
            selectAll.addEventListener('change', function () {
                modal.querySelectorAll('.boq-div-check:not(:disabled)').forEach(cb => { cb.checked = this.checked; });
            });
            modal.querySelectorAll('.boq-div-check:not(:disabled)').forEach(cb => {
                cb.addEventListener('change', function () {
                    const available = modal.querySelectorAll('.boq-div-check:not(:disabled)');
                    const checked   = modal.querySelectorAll('.boq-div-check:not(:disabled):checked');
                    selectAll.indeterminate = checked.length > 0 && checked.length < available.length;
                    selectAll.checked = checked.length === available.length;
                });
            });
        }
    };

    window.boqConfirmDivisions = function () {
        const modal = document.getElementById('boqDivModal');
        if (!modal) return;
        const checked = [...modal.querySelectorAll('.boq-div-check:not(:disabled):checked')];
        if (!checked.length) { alert('Please select at least one division.'); return; }
        checked.forEach(cb => {
            const divNo  = parseInt(cb.value, 10);
            const divDef = BOQ_DIVISIONS.find(d => d.no === divNo);
            if (!divDef) return;
            const ci = { id: genId(), label: divDef.label.toUpperCase(), divisionNo: divNo, subItems: [] };
            boq.costItems.push(ci);
        });
        modal.remove();
        markDirty(); refreshTable();
    };

    // ── Add Cost Item (legacy — kept for any direct calls) ─────
    window.boqAddCostItem = function () {
        window.boqShowDivisionModal();
    };

    // ── Add Sub-item ───────────────────────────────────────────
    window.boqAddSubItem = function (ciId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        if (!ci) return;
        const si = { id: genId(), label: 'New Sub-item', lineItems: [] };
        ci.subItems.push(si);
        markDirty(); refreshTable();
        setTimeout(() => boqEditSILabel(ciId, si.id), 60);
    };

    // ── Add Line Item ──────────────────────────────────────────
    window.boqAddLineItem = function (ciId, siId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        if (!ci) return;
        const si = ci.subItems.find(s => s.id === siId);
        if (!si) return;
        const li = {
            id: genId(), itemNo: '', description: '', qty: '', unit: '',
            materialRate: 0, laborRate: 0, totalAmount: 0,
            percentCompletion: 0, accomplishmentAmount: 0,
            isOptional: false, materialOverride: null, laborOverride: null
        };
        si.lineItems.push(li);
        markDirty(); refreshTable();
        setTimeout(() => boqEditLineItem(ciId, siId, li.id), 60);
    };

    // ── Insert Line Item after a specific item (used by group header + button) ─
    window.boqInsertLineItemAfter = function (ciId, siId, afterId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        if (!ci) return;
        const si = ci.subItems.find(s => s.id === siId);
        if (!si) return;
        const li = {
            id: genId(), itemNo: '', description: '', qty: '', unit: '',
            materialRate: 0, laborRate: 0, totalAmount: 0,
            percentCompletion: 0, accomplishmentAmount: 0,
            isOptional: false, materialOverride: null, laborOverride: null
        };
        const idx = si.lineItems.findIndex(l => l.id === afterId);
        if (idx >= 0) si.lineItems.splice(idx + 1, 0, li);
        else si.lineItems.push(li);
        markDirty(); refreshTable();
        setTimeout(() => boqEditLineItem(ciId, siId, li.id), 60);
    };

    // ── Add / Edit / Save / Cancel Group Header ───────────────
    window.boqAddGroupHeader = function (ciId, siId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        if (!ci) return;
        const si = ci.subItems.find(s => s.id === siId);
        if (!si) return;
        const li = { id: genId(), type: 'group', label: '' };
        si.lineItems.push(li);
        markDirty(); refreshTable();
        setTimeout(() => boqEditGroupHeader(ciId, siId, li.id), 60);
    };

    window.boqEditGroupHeader = function (ciId, siId, liId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        const li = si?.lineItems.find(l => l.id === liId);
        if (!li) return;
        const row = el(`row-li-${liId}`);
        if (!row) return;
        row.outerHTML = renderLineItemRow(ciId, siId, li, si.lineItems.indexOf(li), true);
        el(`group-inp-${liId}`)?.focus();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.boqSaveGroupHeader = function (ciId, siId, liId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        const li = si?.lineItems.find(l => l.id === liId);
        if (!li) return;
        const inp = el(`group-inp-${liId}`);
        if (inp) li.label = inp.value.toUpperCase().trim() || 'GROUP HEADER';
        const row = el(`row-li-${liId}`);
        if (row) row.outerHTML = renderLineItemRow(ciId, siId, li, si.lineItems.indexOf(li), false);
        markDirty();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.boqCancelGroupHeader = function (ciId, siId, liId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        const li = si?.lineItems.find(l => l.id === liId);
        if (!li) return;
        // If label is still empty it was just created — remove it
        if (!li.label) {
            si.lineItems = si.lineItems.filter(l => l.id !== liId);
            markDirty(); refreshTable(); return;
        }
        const row = el(`row-li-${liId}`);
        if (row) row.outerHTML = renderLineItemRow(ciId, siId, li, si.lineItems.indexOf(li), false);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    // ── Confirm delete modal ───────────────────────────────────
    function boqConfirmDelete(title, message, onConfirm) {
        const existing = document.getElementById('boqDeleteModal');
        if (existing) existing.remove();
        const modal = document.createElement('div');
        modal.id = 'boqDeleteModal';
        modal.className = 'boq-modal-overlay';
        modal.innerHTML = `
        <div class="boq-modal-card boq-del-modal-card" onclick="event.stopPropagation()">
            <div class="boq-del-icon-wrap">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
            </div>
            <h3 class="boq-del-title">${title}</h3>
            <p class="boq-del-msg">${message}</p>
            <div class="boq-del-footer">
                <button class="boq-btn boq-btn-ghost" id="boqDelCancelBtn">Cancel</button>
                <button class="boq-btn boq-btn-danger" id="boqDelConfirmBtn">Delete</button>
            </div>
        </div>`;
        document.body.appendChild(modal);
        document.getElementById('boqDelCancelBtn').onclick  = () => modal.remove();
        document.getElementById('boqDelConfirmBtn').onclick = () => { modal.remove(); onConfirm(); };
        modal.addEventListener('click', () => modal.remove());
    }

    // ── Delete actions ─────────────────────────────────────────
    window.boqDeleteCostItem = function (ciId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        boqConfirmDelete(
            'Delete Section',
            `Are you sure you want to delete <strong>${escHtml(ci?.label || 'this section')}</strong> and all its sub-items and line items? This cannot be undone.`,
            () => { boq.costItems = boq.costItems.filter(c => c.id !== ciId); markDirty(); refreshTable(); }
        );
    };
    window.boqDeleteSubItem = function (ciId, siId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        boqConfirmDelete(
            'Delete Sub-item',
            `Are you sure you want to delete <strong>${escHtml(si?.label || 'this sub-item')}</strong> and all its line items? This cannot be undone.`,
            () => {
                const c = boq.costItems.find(c => c.id === ciId);
                if (!c) return;
                c.subItems = c.subItems.filter(s => s.id !== siId);
                markDirty(); refreshTable();
            }
        );
    };
    window.boqDeleteLineItem = function (ciId, siId, liId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        const li = si?.lineItems.find(l => l.id === liId);
        const isGroup = li?.type === 'group';
        boqConfirmDelete(
            isGroup ? 'Delete Group Header' : 'Delete Line Item',
            `Are you sure you want to delete <strong>${escHtml(isGroup ? (li.label || 'this group header') : (li?.description || 'this item'))}</strong>? This cannot be undone.`,
            () => {
                const c2 = boq.costItems.find(c => c.id === ciId);
                if (!c2) return;
                const s2 = c2.subItems.find(s => s.id === siId);
                if (!s2) return;
                s2.lineItems = s2.lineItems.filter(l => l.id !== liId);
                markDirty(); refreshTable();
            }
        );
    };

    // ── Reorder helpers ────────────────────────────────────────
    function moveInArray(arr, id, dir) {
        const i = arr.findIndex(x => x.id === id);
        if (i < 0) return;
        const j = i + dir;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    window.boqMoveCostItem = function (ciId, dir) {
        moveInArray(boq.costItems, ciId, dir);
        markDirty(); refreshTable();
    };
    window.boqMoveSubItem = function (ciId, siId, dir) {
        const ci = boq.costItems.find(c => c.id === ciId);
        if (ci) { moveInArray(ci.subItems, siId, dir); markDirty(); refreshTable(); }
    };
    window.boqMoveLineItem = function (ciId, siId, liId, dir) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        if (si) { moveInArray(si.lineItems, liId, dir); markDirty(); refreshTable(); }
    };

    // ── Status helpers ──────────────────────────────────────────
    function boqStatusBadgeHtml(status) {
        const cfg = {
            draft:     { cls: 'boq-status-draft',     label: 'Draft' },
            submitted: { cls: 'boq-status-submitted',  label: 'For Review' },
            approved:  { cls: 'boq-status-approved',   label: 'Approved' },
        };
        const s = cfg[status] || cfg.draft;
        const next = status === 'draft' ? 'submitted' : status === 'submitted' ? 'approved' : null;
        const nextLabel = next === 'submitted' ? 'Submit' : next === 'approved' ? 'Approve' : '';
        const nextBtn = next
            ? `<button class="boq-btn boq-btn-outline boq-btn-sm boq-btn-status" onclick="boqSetStatus('${next}')">
                   <i data-lucide="arrow-right-circle"></i> ${nextLabel}
               </button>`
            : '';
        return `<span class="boq-status-pill ${s.cls}">${s.label}</span>${nextBtn}`;
    }
    window.boqSetStatus = async function (status) {
        boq.status = status;
        markDirty();
        const statusDisplay = { draft: 'Draft', submitted: 'For Review', approved: 'Approved' };
        boqToast(`Status set to ${statusDisplay[status] || status}.`, 'success');
        // Re-render toolbar fully to be safe
        renderBuilderArea();
    };

    // ── Template management ─────────────────────────────────────
    window.boqToggleTemplateMenu = function () {
        const m = el('boqTemplateMenu');
        if (m) m.style.display = m.style.display === 'none' ? '' : 'none';
        document.addEventListener('click', function closeMenu(e) {
            if (!e.target.closest('.boq-dropdown')) {
                if (m) m.style.display = 'none';
                document.removeEventListener('click', closeMenu);
            }
        }, { once: false });
    };

    window.boqSaveAsTemplate = async function () {
        el('boqTemplateMenu') && (el('boqTemplateMenu').style.display = 'none');
        const name = prompt('Template name:', boq.header.projectName || 'My Template');
        if (!name) return;
        try {
            await db.collection('boqTemplates').add({
                userId:    uid(),
                name:      name.trim(),
                costItems: JSON.parse(JSON.stringify(boq.costItems)), // deep copy, reset IDs
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            boqToast('Template saved!', 'success');
        } catch (e) {
            boqToast('Error saving template: ' + e.message, 'error');
        }
    };

    window.boqLoadTemplateModal = async function () {
        el('boqTemplateMenu') && (el('boqTemplateMenu').style.display = 'none');
        try {
            const snap = await db.collection('boqTemplates')
                .where('userId', '==', uid())
                .orderBy('createdAt', 'desc')
                .get();
            if (snap.empty) { boqToast('No templates saved yet.', 'error'); return; }

            // Build a simple modal
            const templates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const items = templates.map(t =>
                `<div class="boq-tmpl-item" onclick="boqApplyTemplate('${t.id}')">
                    <span class="boq-tmpl-name">${escHtml(t.name)}</span>
                    <span class="boq-tmpl-count">${(t.costItems||[]).length} section(s)</span>
                    <button class="boq-icon-btn boq-icon-btn-del" title="Delete" onclick="event.stopPropagation();boqDeleteTemplate('${t.id}',this)"><i data-lucide="trash-2"></i></button>
                </div>`
            ).join('');

            let modal = el('boqTemplateModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'boqTemplateModal';
                modal.className = 'boq-modal-overlay';
                document.body.appendChild(modal);
            }
            modal.innerHTML = `
                <div class="boq-modal-card">
                    <div class="boq-modal-header">
                        <h3>Load Template</h3>
                        <button class="boq-icon-btn" onclick="el('boqTemplateModal').style.display='none'"><i data-lucide="x"></i></button>
                    </div>
                    <p class="boq-modal-sub">Selecting a template will <strong>replace</strong> current work items.</p>
                    <div class="boq-tmpl-list">${items}</div>
                </div>`;
            modal.style.display = 'flex';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        } catch (e) {
            boqToast('Error loading templates: ' + e.message, 'error');
        }
    };

    window.boqApplyTemplate = async function (templateId) {
        if (!confirm('Replace current work items with this template?')) return;
        try {
            const doc = await db.collection('boqTemplates').doc(templateId).get();
            if (!doc.exists) { boqToast('Template not found.', 'error'); return; }
            // Deep copy and assign new IDs to avoid conflicts
            boq.costItems = JSON.parse(JSON.stringify(doc.data().costItems || []));
            boq.costItems.forEach(ci => {
                ci.id = genId();
                (ci.subItems || []).forEach(si => {
                    si.id = genId();
                    (si.lineItems || []).forEach(li => { li.id = genId(); });
                });
            });
            markDirty();
            const modal = el('boqTemplateModal');
            if (modal) modal.style.display = 'none';
            refreshTable();
            boqToast('Template applied!', 'success');
        } catch (e) {
            boqToast('Error applying template: ' + e.message, 'error');
        }
    };

    window.boqDeleteTemplate = async function (templateId, btn) {
        if (!await window.showDeleteConfirm('Delete this template?')) return;
        try {
            await db.collection('boqTemplates').doc(templateId).delete();
            btn.closest('.boq-tmpl-item')?.remove();
            boqToast('Template deleted.', 'success');
        } catch (e) {
            boqToast('Error: ' + e.message, 'error');
        }
    };

    // ── Edit Cost Item label ───────────────────────────────────
    window.boqEditCILabel = function (ciId) {
        const ci   = boq.costItems.find(c => c.id === ciId);
        const cell = el(`ci-label-${ciId}`);
        if (!ci || !cell) return;
        cell.innerHTML = `
            <input type="text" class="boq-label-input" id="ci-inp-${ciId}"
                   value="${escAttr(ci.label)}" placeholder="Section name (e.g. GENERAL REQUIREMENTS)"
                   onkeydown="if(event.key==='Enter')boqSaveCILabel('${ciId}');else if(event.key==='Escape')boqCancelLabel('ci-label-${ciId}','${ciId}','ci')">
            <span class="boq-label-actions">
                <button class="boq-icon-btn boq-icon-btn-save"   onclick="boqSaveCILabel('${ciId}')"><i data-lucide="check"></i></button>
                <button class="boq-icon-btn boq-icon-btn-cancel" onclick="boqCancelLabel('ci-label-${ciId}','${ciId}','ci')"><i data-lucide="x"></i></button>
            </span>`;
        el(`ci-inp-${ciId}`)?.focus();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };
    window.boqSaveCILabel = function (ciId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        if (!ci) return;
        const inp = el(`ci-inp-${ciId}`);
        if (inp) ci.label = (inp.value.toUpperCase().trim()) || 'UNTITLED SECTION';
        const cell = el(`ci-label-${ciId}`);
        if (cell) cell.innerHTML = `<span class="boq-l1-text" ondblclick="boqEditCILabel('${ciId}')">${escHtml(ci.label)}</span>`;
        markDirty(); refreshTotals();
    };

    // ── Edit Sub-item label ────────────────────────────────────
    window.boqEditSILabel = function (ciId, siId) {
        const ci   = boq.costItems.find(c => c.id === ciId);
        const si   = ci?.subItems.find(s => s.id === siId);
        const cell = el(`si-label-${siId}`);
        if (!si || !cell) return;
        cell.innerHTML = `
            <input type="text" class="boq-label-input" id="si-inp-${siId}"
                   value="${escAttr(si.label)}" placeholder="Sub-item name"
                   onkeydown="if(event.key==='Enter')boqSaveSILabel('${ciId}','${siId}');else if(event.key==='Escape')boqCancelLabel('si-label-${siId}','${siId}','si','${ciId}')">
            <span class="boq-label-actions">
                <button class="boq-icon-btn boq-icon-btn-save"   onclick="boqSaveSILabel('${ciId}','${siId}')"><i data-lucide="check"></i></button>
                <button class="boq-icon-btn boq-icon-btn-cancel" onclick="boqCancelLabel('si-label-${siId}','${siId}','si','${ciId}')"><i data-lucide="x"></i></button>
            </span>`;
        el(`si-inp-${siId}`)?.focus();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };
    window.boqSaveSILabel = function (ciId, siId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        if (!si) return;
        const inp = el(`si-inp-${siId}`);
        if (inp) si.label = inp.value.trim() || 'Untitled';
        const cell = el(`si-label-${siId}`);
        if (cell) cell.innerHTML = `<span class="boq-l2-text" ondblclick="boqEditSILabel('${ciId}','${siId}')">${escHtml(si.label)}</span>`;
        markDirty();
    };

    // ── Cancel label edit (shared) ─────────────────────────────
    window.boqCancelLabel = function (cellId, itemId, type, parentId) {
        const cell = el(cellId);
        if (!cell) return;
        if (type === 'ci') {
            const ci = boq.costItems.find(c => c.id === itemId);
            if (ci) cell.innerHTML = `<span class="boq-l1-text" ondblclick="boqEditCILabel('${itemId}')">${escHtml(ci.label)}</span>`;
        } else {
            const ci = boq.costItems.find(c => c.id === parentId);
            const si = ci?.subItems.find(s => s.id === itemId);
            if (si) cell.innerHTML = `<span class="boq-l2-text" ondblclick="boqEditSILabel('${parentId}','${itemId}')">${escHtml(si.label)}</span>`;
        }
    };

    // ── Edit Line Item ─────────────────────────────────────────
    window.boqEditLineItem = function (ciId, siId, liId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        const li = si?.lineItems.find(l => l.id === liId);
        if (!li) return;
        const row = el(`row-li-${liId}`);
        if (!row) return;
        row.outerHTML = renderLineItemRow(ciId, siId, li, si.lineItems.indexOf(li), true);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    // ── Save Line Item from edit mode ──────────────────────────
    window.boqSaveLineItem = function (ciId, siId, liId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        const li = si?.lineItems.find(l => l.id === liId);
        if (!li) return;

        const matType = el(`li-mat-type-${liId}`)?.value;
        const labType = el(`li-lab-type-${liId}`)?.value;

        li.itemNo              = el(`li-no-${liId}`)?.value   || '';
        li.description         = el(`li-desc-${liId}`)?.value || '';
        const rawQty  = parseNum((el(`li-qty-${liId}`)?.value  || '').replace(/,/g,''));
        const rawMat  = matType === 'value' ? parseNum((el(`li-mat-${liId}`)?.value||'').replace(/,/g,'')) : 0;
        const rawLab  = labType === 'value' ? parseNum((el(`li-lab-${liId}`)?.value||'').replace(/,/g,'')) : 0;
        const rawPct  = Math.min(100, Math.max(0, parseNum(el(`li-pct-${liId}`)?.value || 0)));

        if (rawQty < 0)  { boqToast('Quantity cannot be negative.', 'error'); return; }
        if (rawMat < 0)  { boqToast('Material rate cannot be negative.', 'error'); return; }
        if (rawLab < 0)  { boqToast('Labor rate cannot be negative.', 'error'); return; }

        li.qty                 = rawQty;
        li.unit                = el(`li-unit-${liId}`)?.value || '';
        li.materialOverride    = matType !== 'value' ? matType : null;
        li.materialRate        = rawMat;
        li.laborOverride       = labType !== 'value' ? labType : null;
        li.laborRate           = rawLab;
        li.percentCompletion   = rawPct;
        li.isOptional          = el(`li-opt-${liId}`)?.checked || false;
        li.totalAmount         = calcLITotal(li);
        li.accomplishmentAmount = calcLIAcc(li);

        const row = el(`row-li-${liId}`);
        if (row) row.outerHTML = renderLineItemRow(ciId, siId, li, itemDisplayIdx(si.lineItems, liId), false);

        // Update this cost item's subtotal
        const subEl = el(`subtotal-${ciId}`);
        const accEl = el(`subtotal-acc-${ciId}`);
        if (subEl) subEl.textContent = '₱ ' + fmt(calcCostItemSubtotal(ci));
        if (accEl) accEl.textContent = '₱ ' + fmt(calcCostItemAccomplishment(ci));
        markDirty(); refreshTotals();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    // ── Cancel line item edit ──────────────────────────────────
    window.boqCancelEditLI = function (ciId, siId, liId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        const li = si?.lineItems.find(l => l.id === liId);
        if (!li) return;
        const row = el(`row-li-${liId}`);
        if (row) row.outerHTML = renderLineItemRow(ciId, siId, li, itemDisplayIdx(si.lineItems, liId), false);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    // ── Refresh full table ─────────────────────────────────────
    function refreshTable() {
        const tbody = el('boqTableBody');
        if (!tbody) return;
        tbody.innerHTML = renderTableBody();
        refreshTotals();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ── Collect header form ────────────────────────────────────
    function collectHeader() {
        boq.header.date        = el('boqDate')?.value        || '';
        boq.header.projectName = el('boqProjectName')?.value || '';
        boq.header.area        = el('boqArea')?.value        || '';
        boq.header.ownerName   = el('boqOwnerName')?.value   || '';
        boq.header.location    = el('boqLocation')?.value    || '';
        boq.header.subject     = 'Accomplishment Report';
        // Client email is saved alongside the document
        const emailEl = el('boqClientEmail');
        if (emailEl) boq.clientEmail = emailEl.value.trim();
        const tp = el('boqTermsPayments');
        const te = el('boqTermsExclusions');
        const td = el('boqTermsDuration');
        const chkP = el('boqIncludePayments');
        const chkE = el('boqIncludeExclusions');
        const chkD = el('boqIncludeDuration');
        const sgC  = el('boqSignClient');
        const sgK  = el('boqSignContractor');
        // Pull the custom rows out of the DOM before the object below is rebuilt.
        harvestCustomTerms();
        if (tp || te || td || sgC || sgK) {
            boq.terms = {
                payments:          tp ? tp.value : boq.terms.payments,
                exclusions:        te ? te.value : boq.terms.exclusions,
                duration:          td ? td.value : boq.terms.duration,
                includePayments:   chkP ? chkP.checked : (boq.terms.includePayments !== false),
                includeExclusions: chkE ? chkE.checked : (boq.terms.includeExclusions !== false),
                includeDuration:   chkD ? chkD.checked : (boq.terms.includeDuration !== false),
                // This assignment REPLACES boq.terms, so anything not listed here
                // is lost on save — custom sections and the signature toggles
                // both have to be carried across explicitly.
                custom:            Array.isArray(boq.terms.custom) ? boq.terms.custom : [],
                signOff: {
                    client:     sgC ? sgC.checked : (boq.terms.signOff || {}).client     !== false,
                    contractor: sgK ? sgK.checked : (boq.terms.signOff || {}).contractor !== false
                }
            };
        }
    }

    // ── Custom Terms & Conditions sections ─────────────────────
    // Terms of Payment / Exclusions / Duration are the three built-ins and stay
    // put. Anything else a report needs — Warranty, Site conditions, Variation
    // orders — is added here and can be removed again. Each carries its own
    // include checkbox, so a section can be kept on file but left off the
    // printout. Stored in boq.terms.custom, inside the existing `terms` jsonb
    // column, so no migration is involved.
    function boqCustomTermsHTML() {
        const list = Array.isArray(boq.terms.custom) ? boq.terms.custom : [];
        return list.map((s, i) => `
            <div class="boq-terms-group boq-terms-custom">
                <label class="boq-terms-label">
                    <input type="checkbox" class="boq-terms-chk boq-tc-inc" ${s.include !== false ? 'checked' : ''}>
                    <input type="text" class="boq-tc-title" value="${escHtml(s.title || '')}"
                           placeholder="Section title — e.g. Warranty">
                    <button type="button" class="boq-terms-del" title="Remove this section"
                            onclick="boqRemoveTermSection(${i})"><i data-lucide="trash-2"></i></button>
                </label>
                <textarea class="boq-terms-textarea boq-tc-body" rows="4"
                          placeholder="One line per item…">${escHtml(s.body || '')}</textarea>
            </div>`).join('');
    }

    // Read the custom rows back out of the DOM. Run before every add/remove so
    // half-typed edits survive the re-render, and again on save.
    function harvestCustomTerms() {
        const host = document.getElementById('boqTermsCustom');
        if (!host) return;
        boq.terms.custom = Array.from(host.querySelectorAll('.boq-terms-custom')).map(node => ({
            title:   (node.querySelector('.boq-tc-title') || {}).value ? node.querySelector('.boq-tc-title').value.trim() : '',
            body:    (node.querySelector('.boq-tc-body')  || {}).value || '',
            include: !node.querySelector('.boq-tc-inc') || node.querySelector('.boq-tc-inc').checked
        }));
    }

    // Repaint only the custom list — repainting the whole editor would throw
    // away unsaved edits in the header and the three built-in sections.
    function renderCustomTerms() {
        const host = document.getElementById('boqTermsCustom');
        if (!host) return;
        host.innerHTML = boqCustomTermsHTML();
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }

    window.boqAddTermSection = function () {
        harvestCustomTerms();
        if (!Array.isArray(boq.terms.custom)) boq.terms.custom = [];
        boq.terms.custom.push({ title: '', body: '', include: true });
        markDirty();
        renderCustomTerms();
        const rows = document.querySelectorAll('#boqTermsCustom .boq-tc-title');
        if (rows.length) rows[rows.length - 1].focus();
    };

    window.boqRemoveTermSection = function (i) {
        harvestCustomTerms();
        const s = (boq.terms.custom || [])[i];
        if (!s) return;
        const name = s.title ? '"' + s.title + '"' : 'this section';
        if (!confirm('Remove ' + name + ' from the Terms & Conditions?')) return;
        boq.terms.custom.splice(i, 1);
        markDirty();
        renderCustomTerms();
    };

    // Built-ins + custom, in print order, with blank/unchecked ones dropped.
    // Shared by the print sheet and the PDF export so the two can never
    // disagree about what the document contains.
    function boqTermSections() {
        const t = boq.terms || {};
        const out = [];
        if (t.includePayments   !== false) out.push({ title: 'Terms of Payment', body: t.payments   || '', lettered: false });
        if (t.includeExclusions !== false) out.push({ title: 'Exclusions',       body: t.exclusions || '', lettered: true  });
        if (t.includeDuration   !== false) out.push({ title: 'Duration',         body: t.duration   || '45 - 60 Days', lettered: false });
        (Array.isArray(t.custom) ? t.custom : []).forEach(s => {
            if (s && s.include !== false && (String(s.title || '').trim() || String(s.body || '').trim())) {
                out.push({ title: (s.title || 'Additional Terms').trim(), body: s.body || '', lettered: false });
            }
        });
        return out;
    }

    // Roman numeral for the section heading. The old code used a 5-entry lookup;
    // custom sections can push past that, so generate it properly.
    function boqRoman(n) {
        const map = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
        let v = Number(n) || 0, out = '';
        if (v < 1 || v > 39) return String(n);
        map.forEach(([val, sym]) => { while (v >= val) { out += sym; v -= val; } });
        return out;
    }

    // ── Save to Firestore ──────────────────────────────────────
    window.boqSave = async function () {
        if (!uid()) return;
        collectHeader();

        // Validate client email if provided
        if (boq.clientEmail) {
            const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRx.test(boq.clientEmail)) {
                boqToast('Invalid client email address.', 'error');
                return;
            }
        }

        // Capture BEFORE the save: was this a freshly-shared BOQ?
        // (No prior clientEmail, now has one → first-time share with client.)
        const _prevClientEmail = boq.doc?.clientEmail || '';
        const _isFirstShare    = !_prevClientEmail && !!boq.clientEmail;

        const btn = el('boqSaveBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2"></i> Saving...'; }
        if (typeof lucide !== 'undefined') lucide.createIcons();

        try {
            const data = {
                userId:      uid(),
                folderId:    boq.currentFolderId,
                date:        boq.header.date,
                projectName: boq.header.projectName,
                area:        boq.header.area,
                ownerName:   boq.header.ownerName,
                location:    boq.header.location,
                subject:     boq.header.subject,
                discount:    boq.discount,
                costItems:   boq.costItems,
                clientEmail: boq.clientEmail || '',
                status:      boq.status   || 'draft',
                terms:       boq.terms,
                updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
            };

            if (boq.doc) {
                await db.collection('boqDocuments').doc(boq.doc.id).update(data);
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                const ref  = await db.collection('boqDocuments').add(data);
                boq.doc    = { id: ref.id, ...data };
            }

            // Sync clientEmail to parent folder so client can access folder + project data
            if (boq.currentFolderId) {
                const folderUpdate = { clientEmail: boq.clientEmail || '' };
                await db.collection('folders').doc(boq.currentFolderId).update(folderUpdate);
            }

            boq.isDirty = false;
            const badge = qs('.boq-badge');
            if (badge) { badge.className = 'boq-badge boq-badge-saved'; badge.textContent = 'Saved'; }
            boqToast('Report saved successfully!', 'success');

            // Notify the client on every save (status-appropriate message)
            if (boq.clientEmail) {
                try {
                    const clientSnap = await db.collection('clientUsers')
                        .where('email', '==', boq.clientEmail)
                        .limit(1).get();
                    if (!clientSnap.empty) {
                        const clientUid = clientSnap.docs[0].id;
                        const reportName = boq.header.subject || 'Accomplishment Report';
                        const notifMap = {
                            approved:  { type: 'report_approved',  message: `Your report "${reportName}" has been approved.` },
                            submitted: { type: 'report_submitted', message: `Your report "${reportName}" has been submitted and is now awaiting approval.` },
                            draft:     { type: 'report_updated',   message: `Your report "${reportName}" has been updated.` },
                        };
                        // First time this BOQ is shared with the client → use
                        // a distinct welcoming notification instead of the
                        // generic "report updated" one. Status messages still
                        // apply for subsequent saves.
                        const n = _isFirstShare
                            ? { type: 'report_shared', message: `Your accomplishment report "${reportName}" is now available for you to view.` }
                            : (notifMap[boq.status] || notifMap.draft);
                        await db.collection('notifications').doc(clientUid).collection('items').add({
                            type:      n.type,
                            message:   n.message,
                            isRead:    false,
                            relatedId: boq.doc?.id || '',
                            createdAt: firebase.firestore.Timestamp.fromDate(new Date())
                        });
                    }
                } catch (e) { console.warn('BOQ: notification error', e); }
            }
        } catch (e) {
            console.error('BOQ save error:', e);
            boqToast('Error saving BOQ. Please try again.', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Save'; }
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    };

    // ── Toast ──────────────────────────────────────────────────
    function boqToast(msg, type) {
        let t = el('boqToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'boqToast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.className = `boq-toast boq-toast-${type} boq-toast-show`;
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove('boq-toast-show'), 3000);
    }

    // ── PDF Export ─────────────────────────────────────────────
    window.boqExportPDF = function () {
        if (typeof window.jspdf === 'undefined' && typeof window.jsPDF === 'undefined') {
            boqToast('Loading PDF library...', 'success');
            const s1 = document.createElement('script');
            s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            s1.onload = function () {
                const s2 = document.createElement('script');
                s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
                s2.onload = boqGeneratePDF;
                document.head.appendChild(s2);
            };
            document.head.appendChild(s1);
            return;
        }
        boqGeneratePDF();
    };

    async function boqGeneratePDF() {
        collectHeader();
        const _base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        const h = boq.header;
        const fmtDate = h.date ? new Date(h.date + 'T00:00:00').toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }) : '';
        const jsPDF = (window.jspdf || window).jsPDF;
        const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();   // 210mm
        const pageH = doc.internal.pageSize.getHeight();  // 297mm
        const M     = 10;
        const usableW = pageW - M * 2;  // 190mm
        let y = M;

        // ── Logo + Company title ───────────────────────────────
        const headerBottom = M + 48; // fixed bottom of header block
        const logoH = 40;
        try {
            const logoData = await new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    try {
                        const c = document.createElement('canvas');
                        c.width = img.naturalWidth; c.height = img.naturalHeight;
                        c.getContext('2d').drawImage(img, 0, 0);
                        resolve({ url: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
                    } catch(e) { resolve(null); }
                };
                img.onerror = () => resolve(null);
                img.src = _base + 'assets/images/DACS-TRANSPARENT.png';
            });
            if (logoData) {
                const logoW = logoH * (logoData.w / logoData.h);
                // logo bottom aligned to headerBottom
                doc.addImage(logoData.url, 'PNG', pageW - M - logoW, headerBottom - logoH, logoW, logoH);
            }
        } catch(e) {}
        // Business name & tagline — left aligned, bottom aligned to headerBottom
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text("DAC'S BUILDING DESIGN SERVICES", M, headerBottom - 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 100, 100);
        doc.text('Accomplishment Report', M, headerBottom - 4);
        doc.setTextColor(0, 0, 0);
        // Divider line below header
        y = headerBottom + 2;
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.5);
        doc.line(M, y, pageW - M, y);
        y += 4;

        // ── Header info box (50% width, left-aligned — matches print design) ──
        doc.setFontSize(7.5);
        const lblW   = 26;
        const boxW   = usableW / 2;           // 50% width
        const valW   = boxW - lblW;
        const locLines = doc.splitTextToSize(h.location || '', valW - 3);
        const baseH  = 6;
        const locH   = Math.max(baseH, locLines.length * 4 + 2);

        const rowDefs = [
            { label: 'DATE:',     value: fmtDate,          h: baseH },
            { label: 'PROJECT:',  value: h.projectName,    h: baseH },
            { label: 'AREA:',     value: (h.area || '') + ' sqm', h: baseH },
            { label: 'OWNER:',    value: h.ownerName,      h: baseH },
            { label: 'LOCATION:', value: h.location,       h: locH  },
            { label: 'SUBJECT:',  value: h.subject,        h: baseH },
        ];
        const boxH = rowDefs.reduce((s, r) => s + r.h, 0);
        const boxX = M;
        const boxY = y;

        doc.setDrawColor(0);
        doc.setLineWidth(0.3);
        doc.rect(boxX, boxY, boxW, boxH);

        let ry = boxY;
        rowDefs.forEach((row, i) => {
            // Row divider
            if (i > 0) {
                doc.setLineWidth(0.2);
                doc.line(boxX, ry, boxX + boxW, ry);
            }
            // Label background — black, matches print
            doc.setFillColor(17, 17, 17);
            doc.rect(boxX, ry, lblW, row.h, 'F');
            // Vertical divider after label
            doc.setLineWidth(0.2);
            doc.line(boxX + lblW, ry, boxX + lblW, ry + row.h);

            const midY = ry + row.h / 2 + 1.5;

            // Label text — white on black
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(255, 255, 255);
            doc.text(row.label, boxX + 2, midY);
            doc.setTextColor(0, 0, 0);

            if (false) {
                // (removed extra/split row — each field is its own row now)
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.5);
                if (row.label === 'LOCATION:') {
                    doc.text(locLines, boxX + lblW + 2, ry + 4);
                } else {
                    doc.text(row.value || '', boxX + lblW + 2, midY, { maxWidth: valW - 3 });
                }
            }
            ry += row.h;
        });

        y = boxY + boxH + 3;

        // ── Build table rows ──────────────────────────────────
        const rows   = [];
        const styles = [];

        boq.costItems.forEach((ci, ciIdx) => {
            const ciNo = toRoman(ciIdx);
            rows.push([`${ciNo}.`, ci.label || '', '', '', '', '', '', '', '']);
            styles.push('l1');

            ci.subItems.forEach((si, siIdx) => {
                rows.push([`${toAlpha(siIdx)}.`, si.label || '', '', '', '', '', '', '', '']);
                styles.push('l2');

                si.lineItems.forEach((li, liIdx) => {
                    if (li.type === 'group') {
                        rows.push(['', li.label || '', '', '', '', '', '', '', '']);
                        styles.push('group');
                        return;
                    }
                    const mat = li.materialOverride || (li.materialRate ? fmt(li.materialRate) : '-');
                    const lab = li.laborOverride    || (li.laborRate    ? fmt(li.laborRate)    : '-');
                    // Item no goes into description (blank item no column — matches reference)
                    const itemDesc = (li.itemNo ? li.itemNo + '  ' : '') + (li.description || '') + (li.isOptional ? ' (optional)' : '');
                    rows.push([
                        '',
                        itemDesc,
                        li.qty   || '',
                        li.unit  || '',
                        mat, lab,
                        fmt(li.totalAmount),
                        (li.percentCompletion !== undefined && li.percentCompletion !== null) ? (li.percentCompletion + '%') : '0%',
                        fmt(li.accomplishmentAmount)
                    ]);
                    styles.push('l3');
                });
            });

            rows.push(['', `SUBTOTAL - ${ci.label || ''}:`, '', '', '', '',
                fmt(calcCostItemSubtotal(ci)), '',
                fmt(calcCostItemAccomplishment(ci))]);
            styles.push('sub');
            rows.push(['', '', '', '', '', '', '', '', '']);
            styles.push('spacer');
        });

        const grand    = calcGrandTotal();
        const disc     = boq.discount || 0;
        const totalAcc = calcTotalAccomplishment();
        const grandPct = grand > 0 ? (calcTotalAccomplishmentRaw() / grand * 100).toFixed(0) + '%' : '';
        // Staff must not see the project cost / accomplishment totals (matches the on-screen Summary hide).
        if (window.currentUserRole !== 'staff') {
            rows.push(['', '', '', { content: 'TOTAL PROJECT COST (VAT EXCLUSIVE)', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } }, fmt(grand), grandPct, fmt(totalAcc)]);
            styles.push('grand');
            rows.push(['', '', '', { content: 'DISCOUNT', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } }, fmt(disc), '', '']);
            styles.push('discount');
            rows.push(['', '', '', { content: 'DISCOUNTED TOTAL PROJECT COST (VAT EXCLUSIVE)', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } }, fmt(Math.max(0, grand - disc)), '', '']);
            styles.push('grandFinal');
            rows.push(['', '', '', { content: 'TOTAL ACCOMPLISHMENT TO DATE', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } }, fmt(totalAcc)]);
            styles.push('acc');
        }

        // ── Draw table with two-row merged header ─────────────
        doc.autoTable({
            startY: y,
            head: [
                [
                    { content: 'ITEM\nNO.',             rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
                    { content: 'DESCRIPTIONS',          rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
                    { content: 'QTY',                   rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
                    { content: 'UNIT',                  rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
                    { content: 'UNIT RATES',            colSpan: 2, styles: { halign: 'center' } },
                    { content: 'TOTAL\nAMOUNT',         rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
                    { content: 'Accomplishment to Date',colSpan: 2, styles: { halign: 'center' } },
                ],
                [
                    { content: 'MATERIAL\n& CONSUMABLES', styles: { halign: 'center' } },
                    { content: 'LABOR &\nEQUIPMENT',      styles: { halign: 'center' } },
                    { content: '% of\nCompletion',         styles: { halign: 'center' } },
                    { content: 'Amount',                   styles: { halign: 'center' } },
                ]
            ],
            body: rows,
            margin: { left: M, right: M },
            styles: { fontSize: 6.5, cellPadding: 1.2, overflow: 'linebreak' },
            headStyles: {
                fillColor: [251, 191, 36],
                textColor: [0, 0, 0],
                fontStyle: 'bold',
                fontSize: 6,
                cellPadding: 1.5,
                valign: 'middle'
            },
            columnStyles: {
                0: { cellWidth: 10 },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 8,  halign: 'center' },
                3: { cellWidth: 10, halign: 'center' },
                4: { cellWidth: 22, halign: 'right' },
                5: { cellWidth: 22, halign: 'right' },
                6: { cellWidth: 22, halign: 'right' },
                7: { cellWidth: 18, halign: 'center' },
                8: { cellWidth: 22, halign: 'right' }
            },
            didParseCell: function (data) {
                if (data.section !== 'body') return;
                const s = styles[data.row.index];
                if (s === 'spacer') {
                    data.cell.styles.fillColor  = [255, 255, 255];
                    data.cell.styles.lineColor  = [255, 255, 255];
                    data.cell.styles.lineWidth  = 0;
                    data.cell.styles.cellPadding = { top: 0, bottom: 0, left: 0, right: 0 };
                    return;
                }
                const summaryRows = ['grand', 'discount', 'grandFinal', 'acc'];
                // First 3 cols of summary rows = transparent (no fill, no border)
                if (summaryRows.includes(s) && data.column.index < 3) {
                    data.cell.styles.fillColor   = false;
                    data.cell.styles.lineColor   = [255, 255, 255];
                    data.cell.styles.lineWidth   = 0;
                    return;
                }
                if (s === 'l1') {
                    // Red — matches print .pr-l1
                    data.cell.styles.fillColor = [200, 30, 30];
                    data.cell.styles.textColor = [255, 255, 255];
                    data.cell.styles.fontStyle = 'bold';
                } else if (s === 'l2') {
                    // White — matches print .pr-l2
                    data.cell.styles.fillColor = [255, 255, 255];
                    data.cell.styles.textColor = [0, 0, 0];
                    data.cell.styles.fontStyle = 'bold';
                } else if (s === 'group') {
                    // Light gray — group/category header
                    data.cell.styles.fillColor = [229, 231, 235];
                    data.cell.styles.textColor = [31, 41, 55];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize  = 6.5;
                } else if (s === 'sub') {
                    // Light amber — matches print .pr-sub #fde68a
                    data.cell.styles.fillColor = [253, 230, 138];
                    data.cell.styles.textColor = [0, 0, 0];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize  = 7;
                } else if (s === 'grand') {
                    // Amber — matches print .pr-grand #fbbf24
                    data.cell.styles.fillColor = [251, 191, 36];
                    data.cell.styles.textColor = [0, 0, 0];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize  = 7;
                } else if (s === 'discount') {
                    // Teal — matches print .pr-discount #17a2b8
                    data.cell.styles.fillColor = [23, 162, 184];
                    data.cell.styles.textColor = [0, 0, 0];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize  = 7;
                } else if (s === 'grandFinal') {
                    // Green — matches print .pr-grand-final #70ad47
                    data.cell.styles.fillColor = [112, 173, 71];
                    data.cell.styles.textColor = [0, 0, 0];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize  = 7.5;
                } else if (s === 'acc') {
                    // Dark navy — matches print .pr-acc #1a1a2e
                    data.cell.styles.fillColor = [26, 26, 46];
                    data.cell.styles.textColor = [255, 255, 255];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize  = 8;
                }
            }
        });

        // ── Footer sections ───────────────────────────────────
        let fy = doc.lastAutoTable.finalY + 7;
        if (pageH - fy < 72) { doc.addPage(); fy = M; }

        const fs = 7.5;

        // Same section list the print sheet uses, so a custom section added in
        // the editor shows up in both outputs. Sections can now run past the
        // bottom of the page, so break before one that would not fit.
        boqTermSections().forEach((s, i) => {
            if (pageH - fy < 24) { doc.addPage(); fy = M; }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(fs); doc.setTextColor(0, 0, 0);
            doc.text(`${boqRoman(i + 1)}.  ${String(s.title || '').toUpperCase()}`, M, fy); fy += 5;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
            String(s.body || '').split('\n').forEach((line, j) => {
                const text = s.lettered ? `${String.fromCharCode(97 + j)}. ${line}` : line;
                const wrapped = doc.splitTextToSize(text, usableW - (s.lettered ? 8 : 4));
                if (pageH - fy < 12) { doc.addPage(); fy = M; }
                doc.text(wrapped, M + 4, fy);
                fy += wrapped.length * 4;
            });
            fy += 3;
        });

        // ── Save ──────────────────────────────────────────────
        // Add disclaimer to footer on last page only
        const pageCount = doc.internal.getNumberOfPages();
        doc.setPage(pageCount); // Go to last page
        doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(100, 100, 100);
        const disclaimer = 'Disclaimer: This document does not constitute a formal contract and is not legally binding. ' +
            'A formal contract will be issued upon approval of the total project cost and the subsequent signing of the contract.\n' +
            'This document serves for reference purposes only.';
        const dLines = doc.splitTextToSize(disclaimer, usableW);
        const disclaimerHeight = dLines.length * 3.5;
        const footerY = pageH - M - disclaimerHeight;
        doc.text(dLines, pageW / 2, footerY, { align: 'center' });

        const fname = `AccomplishmentReport_${(boq.header.projectName || 'project').replace(/\s+/g,'_')}_${boq.header.date || 'draft'}.pdf`;
        doc.save(fname);
        boqToast('PDF exported!', 'success');
    }

    // ── Image / Photos ─────────────────────────────────────────

    function buildPhotosRow(ciId, si) {
        const images = si.images || [];
        const thumbsHtml = images.map((img, idx) => `
            <div class="boq-photo-thumb">
                <img src="${escHtml(img.url)}" alt="${escHtml(img.name||'photo')}" onclick="boqOpenPhoto('${escHtml(img.url)}')">
                <button class="boq-photo-del" onclick="boqDeleteImage('${escAttr(ciId)}','${escAttr(si.id)}',${idx})" title="Delete photo">×</button>
            </div>`).join('');
        return `<tr class="boq-photos-row" id="photos-row-${si.id}" style="display:none;">
            <td colspan="10" style="padding:0 0 0 36px;">
                <div class="boq-photos-panel">
                    <div class="boq-photos-grid" id="photos-grid-${si.id}">
                        ${thumbsHtml || '<p class="boq-photos-empty">No photos yet. Click "Add Photos" to upload.</p>'}
                    </div>
                    <label class="boq-upload-label">
                        <i data-lucide="upload"></i> Add Photos
                        <input type="file" multiple accept="image/*" style="display:none;"
                               onchange="boqUploadImages(event,'${escAttr(ciId)}','${escAttr(si.id)}')">
                    </label>
                </div>
            </td>
        </tr>`;
    }

    function refreshPhotosGrid(ciId, siId) {
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        if (!si) return;
        const grid = el('photos-grid-' + siId);
        if (!grid) return;
        const images = si.images || [];
        grid.innerHTML = images.length
            ? images.map((img, idx) => `
                <div class="boq-photo-thumb">
                    <img src="${escHtml(img.url)}" alt="${escHtml(img.name||'photo')}" onclick="boqOpenPhoto('${escHtml(img.url)}')">
                    <button class="boq-photo-del" onclick="boqDeleteImage('${escAttr(ciId)}','${escAttr(siId)}',${idx})" title="Delete photo">×</button>
                </div>`).join('')
            : '<p class="boq-photos-empty">No photos yet. Click "Add Photos" to upload.</p>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function updatePhotosBtn(siId, count) {
        const btn = el('photos-btn-' + siId);
        if (!btn) return;
        let badge = btn.querySelector('.boq-img-count');
        if (count > 0) {
            if (!badge) { badge = document.createElement('span'); badge.className = 'boq-img-count'; btn.appendChild(badge); }
            badge.textContent = count;
        } else {
            if (badge) badge.remove();
        }
    }

    window.boqTogglePhotos = function (ciId, siId) {
        const row = el('photos-row-' + siId);
        if (!row) return;
        const opening = row.style.display === 'none';
        row.style.display = opening ? '' : 'none';
        if (opening) refreshPhotosGrid(ciId, siId);
    };

    window.boqUploadImages = async function (event, ciId, siId) {
        const files = Array.from(event.target.files).filter(f => f.type.startsWith('image/'));
        if (!files.length) return;
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        if (!si) return;
        if (!si.images) si.images = [];

        const label = event.target.closest('.boq-upload-label');
        if (label) { label.classList.add('boq-uploading'); }

        try {
            for (const file of files) {
                const url = await compressImage(file, 800, 0.65);
                si.images.push({ url, name: file.name });
            }
            refreshPhotosGrid(ciId, siId);
            updatePhotosBtn(siId, si.images.length);
            markDirty();
            boqToast(files.length + ' photo(s) added.', 'success');
        } catch (e) {
            console.error('Upload error:', e);
            boqToast('Failed to add photos. Please try again.', 'error');
        } finally {
            if (label) label.classList.remove('boq-uploading');
            event.target.value = '';
        }
    };

    window.boqDeleteImage = async function (ciId, siId, imgIdx) {
        if (!await window.showDeleteConfirm('Delete this photo?')) return;
        const ci = boq.costItems.find(c => c.id === ciId);
        const si = ci?.subItems.find(s => s.id === siId);
        if (!si || !si.images) return;
        si.images.splice(imgIdx, 1);
        refreshPhotosGrid(ciId, siId);
        updatePhotosBtn(siId, si.images.length);
        markDirty();
        boqToast('Photo deleted.', 'success');
    };

    window.boqOpenPhoto = function (url) {
        const overlay = document.createElement('div');
        overlay.className = 'boq-lightbox';
        overlay.innerHTML = `<div class="boq-lightbox-inner" onclick="event.stopPropagation()">
            <img src="${escHtml(url)}" alt="Photo">
            <button class="boq-lightbox-close" onclick="this.closest('.boq-lightbox').remove()">×</button>
        </div>`;
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
    };

    // ── Print Report ───────────────────────────────────────────
    window.boqPrintReport = function () {
        collectHeader();
        const _base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        const h = boq.header;
        const fmtDate = h.date ? new Date(h.date + 'T00:00:00').toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }) : '';
        const printDate = new Date().toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
        const grand      = calcGrandTotal();
        const disc       = boq.discount || 0;
        const discounted = Math.max(0, grand - disc);
        const totalAcc   = calcTotalAccomplishment();
        const avgPct = grand > 0 ? (calcTotalAccomplishmentRaw() / grand * 100).toFixed(0) + '%' : '';

        // ── Build table rows HTML ────────────────────────────
        let tableRows = '';
        boq.costItems.forEach((ci, ciIdx) => {
            const ciNo = toRoman(ciIdx);
            // L1: 1 no-cell + colspan 8 = 9 cols total ✓
            tableRows += `
            <tr class="pr-l1">
                <td class="c-no">${ciNo}.</td>
                <td colspan="8">${escHtml(ci.label || 'UNTITLED SECTION')}</td>
            </tr>`;

            ci.subItems.forEach((si, siIdx) => {
                // L2: 1 no-cell + colspan 8 = 9 cols total ✓
                tableRows += `
                <tr class="pr-l2">
                    <td class="c-no">${toAlpha(siIdx)}.</td>
                    <td colspan="8">${escHtml(si.label || '')}</td>
                </tr>`;

                si.lineItems.forEach((li, liIdx) => {
                    if (li.type === 'group') {
                        tableRows += `
                        <tr class="pr-group">
                            <td class="c-no"></td>
                            <td colspan="8">${escHtml(li.label || '')}</td>
                        </tr>`;
                        return;
                    }
                    const mat = li.materialOverride || (li.materialRate ? fmt(li.materialRate) : '-');
                    const lab = li.laborOverride    || (li.laborRate    ? fmt(li.laborRate)    : '-');
                    // L3: 9 individual cells ✓
                    tableRows += `
                    <tr class="pr-l3${li.isOptional ? ' pr-opt' : ''}">
                        <td class="c-no">${escHtml(li.itemNo || String(liIdx + 1))}</td>
                        <td class="c-desc">${escHtml(li.description || '')}${li.isOptional ? ' <em>(optional)</em>' : ''}</td>
                        <td class="c-qty">${li.qty || ''}</td>
                        <td class="c-unit">${escHtml(li.unit || '')}</td>
                        <td class="c-rate">${escHtml(mat)}</td>
                        <td class="c-rate">${escHtml(lab)}</td>
                        <td class="c-amt">${fmt(li.totalAmount)}</td>
                        <td class="c-pct">${li.percentCompletion || 0}%</td>
                        <td class="c-amt">${fmt(li.accomplishmentAmount)}</td>
                    </tr>`;
                });
            });

            // Subtotal: 1 no-cell + colspan5 label + amt + pct-empty + acc = 1+5+1+1+1 = 9 ✓
            tableRows += `
            <tr class="pr-sub">
                <td class="c-no"></td>
                <td colspan="5" style="text-align:right">SUBTOTAL - ${escHtml(ci.label || '')}:</td>
                <td class="c-amt">${fmt(calcCostItemSubtotal(ci))}</td>
                <td></td>
                <td class="c-amt">${fmt(calcCostItemAccomplishment(ci))}</td>
            </tr>
            <tr class="pr-spacer"><td colspan="9"></td></tr>`;
        });

        // ── Terms ────────────────────────────────────────────
        // Signature blocks are opt-out; a document saved before the toggles
        // existed has no signOff and keeps both, as it always printed.
        const _sg = boq.terms.signOff || {};
        const sgClient     = _sg.client     !== false;
        const sgContractor = _sg.contractor !== false;

        // boqTermSections() is the single source of truth for what prints —
        // built-ins plus whatever custom sections the user added — so the sheet
        // and the PDF export can never fall out of step.
        const termsSectionsHTML = boqTermSections().map((s, i) => {
            const lines = String(s.body || '').split('\n').map((l, j) =>
                `<div class="pr-term-ln">${s.lettered ? String.fromCharCode(97 + j) + '. ' : ''}${escHtml(l)}</div>`
            ).join('');
            return `<div class="pr-term-sec">
              <div class="pr-term-hd">${boqRoman(i + 1)}.&nbsp; ${escHtml(s.title)}</div>
              ${lines}
            </div>`;
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Accomplishment Report — ${escHtml(h.projectName || 'Project')}</title>
<style>
  /* ── Reset ── */
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:8.5pt;color:#111;background:#e8e8e8;}

  /* ── A4 page shell ── */
  .page{
    width:210mm;min-height:297mm;
    background:#fff;
    margin:12px auto;
    padding:12mm 14mm 14mm;
    box-shadow:0 2px 16px rgba(0,0,0,.18);
  }

  /* ── Company header ── */
  .pr-co-hdr{ margin-bottom:7px; }

  /* ── Info box ── */
  .pr-info{width:50%;border-collapse:collapse;margin-bottom:9px;border:2px solid #111;}
  .pr-info td{padding:3px 7px;border:1px solid #111;font-size:8pt;vertical-align:middle;}
  .pr-lbl{background:#111;color:#fff;font-weight:800;white-space:nowrap;width:90px;text-transform:uppercase;}
  .pr-val{font-weight:700;color:#111;background:#fff;}

  /* ── Table ── */
  .pr-tbl{width:100%;border-collapse:collapse;font-size:7pt;margin-bottom:5px;table-layout:fixed;}
  .pr-tbl th{border:1px solid #888;padding:3px 4px;vertical-align:middle;overflow:visible;word-break:break-word;}
  .pr-tbl td{border:1px solid #888;padding:3px 4px;vertical-align:middle;overflow:hidden;}

  /* exact same colours as PDF export */
  .pr-th-top{background:#fbbf24;color:#000;font-weight:800;text-align:center;font-size:6pt;text-transform:uppercase;
             -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .pr-th-sub{background:#fbbf24;color:#000;font-weight:700;text-align:center;font-size:5.5pt;
             -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* section header — red #c81e1e */
  .pr-l1 td{background:#c81e1e;color:#fff;font-weight:800;font-size:7.5pt;text-transform:uppercase;border-color:#991b1b;
            -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* sub-item — white background, bold black */
  .pr-l2 td{background:#fff;color:#000;font-weight:700;font-size:7pt;
            -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* line item — white */
  .pr-l3 td{background:#fff;font-size:7pt;}
  .pr-l3.pr-opt td{color:#6b7280;font-style:italic;}
  /* subtotal — light amber #fde68a */
  .pr-sub td{background:#fde68a;color:#000;font-weight:800;font-size:7.5pt;text-transform:uppercase;
             -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* grand total — amber (TOTAL PROJECT COST) */
  .pr-grand td{background:#fbbf24;color:#000;font-weight:800;font-size:7.5pt;text-transform:uppercase;
               -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* discount — teal/cyan */
  .pr-discount td{background:#17a2b8;color:#000;font-weight:800;font-size:7.5pt;text-transform:uppercase;
                  -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* discounted/grand total — green */
  .pr-grand-final td{background:#70ad47;color:#000;font-weight:900;font-size:8pt;text-transform:uppercase;
                     -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* total accomplishment — dark navy */
  .pr-acc td{background:#1a1a2e;color:#fff;font-weight:900;font-size:8pt;text-transform:uppercase;
             -webkit-print-color-adjust:exact;print-color-adjust:exact;}

  /* group/category header row — light gray */
  .pr-group td{background:#e5e7eb;color:#111;font-weight:700;font-size:7pt;text-transform:uppercase;
               -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* spacer row after each subtotal */
  .pr-spacer td{height:5px;background:#fff;border:none;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* transparent cell — no bg, no border */
  .pr-transparent{background:transparent!important;border:none!important;}

  /* ── Col widths ── */
  .c-no  {width:32px;text-align:center;white-space:nowrap;}
  .c-desc{width:auto;}
  .c-qty {width:30px;text-align:center;}
  .c-unit{width:32px;text-align:center;}
  .c-rate{width:66px;text-align:right;white-space:nowrap;}
  .c-amt {width:90px;text-align:right;white-space:nowrap;}
  .c-pct {width:68px;text-align:center;}

  /* ── Terms ── */
  .pr-terms{margin-top:9px;font-size:7.5pt;border-top:1.5px solid #ccc;padding-top:7px;}
  .pr-term-sec{margin-bottom:7px;}
  .pr-term-hd{font-weight:800;font-size:8pt;margin-bottom:3px;text-transform:uppercase;color:#111;}
  .pr-term-ln{margin-left:10px;margin-bottom:1px;line-height:1.55;color:#222;}

  /* ── Signature ── */
  .pr-sig{margin-top:14px;display:flex;justify-content:space-between;gap:24px;}
  .pr-sig-col{flex:1;text-align:center;font-size:7.5pt;}
  .pr-sig-line{border-top:1.5px solid #111;margin-top:28px;padding-top:3px;font-weight:700;font-size:8pt;}
  /* The signature image fills the 28px the blank column leaves for a wet
     signature, so both rules stay on the same baseline. If the file fails to
     load, onerror drops .pr-sig-signed and the 28px gap comes back. */
  .pr-sig-img{display:block;height:28px;width:auto;max-width:70%;margin:0 auto;object-fit:contain;object-position:center bottom;}
  .pr-sig-signed .pr-sig-line{margin-top:0;}
  .pr-sig-role{color:#555;font-size:7pt;margin-top:2px;}

  /* ── Disclaimer ── */
  .pr-disc{margin-top:10px;font-size:6.5pt;color:#666;text-align:center;
           font-style:italic;border-top:1px solid #ddd;padding-top:6px;line-height:1.6;}

  /* ── Print overrides ── */
  @page{size:A4 portrait;margin:0;}
  @media print{
    body{background:#fff;}
    .page{width:100%;margin:0;padding:8mm 10mm 10mm;box-shadow:none;min-height:auto;}
  }
</style>
</head>
<body>
<div class="page">

  <!-- Company header -->
  <div class="pr-co-hdr">
    ${window.dacsPrintHeader('Accomplishment Report')}
  </div>

  <!-- Document info box -->
  <table class="pr-info">
    <tr><td class="pr-lbl">Date:</td><td class="pr-val">${fmtDate}</td></tr>
    <tr><td class="pr-lbl">Project:</td><td class="pr-val">${escHtml(h.projectName || '')}</td></tr>
    <tr><td class="pr-lbl">Area:</td><td class="pr-val">${escHtml(h.area ? h.area + ' sqm' : '')}</td></tr>
    <tr><td class="pr-lbl">Owner:</td><td class="pr-val">${escHtml(h.ownerName || '')}</td></tr>
    <tr><td class="pr-lbl">Location:</td><td class="pr-val">${escHtml(h.location || '')}</td></tr>
    <tr><td class="pr-lbl">Subject:</td><td class="pr-val">${escHtml(h.subject || 'Accomplishment Report')}</td></tr>
  </table>

  <!-- BOQ Table -->
  <table class="pr-tbl">
    <colgroup>
      <col class="c-no"><col class="c-desc">
      <col class="c-qty"><col class="c-unit">
      <col class="c-rate"><col class="c-rate">
      <col class="c-amt"><col class="c-pct"><col class="c-amt">
    </colgroup>
    <thead>
      <tr>
        <th class="pr-th-top" rowspan="2">ITEM<br>NO.</th>
        <th class="pr-th-top" rowspan="2">DESCRIPTIONS</th>
        <th class="pr-th-top" rowspan="2">QTY</th>
        <th class="pr-th-top" rowspan="2">UNIT</th>
        <th class="pr-th-top" colspan="2">UNIT RATES</th>
        <th class="pr-th-top" rowspan="2">TOTAL<br>AMOUNT</th>
        <th class="pr-th-top" colspan="2">ACCOMPLISHMENT TO DATE</th>
      </tr>
      <tr>
        <th class="pr-th-sub">MATERIAL &<br>CONSUMABLES</th>
        <th class="pr-th-sub">LABOR &<br>EQUIPMENT</th>
        <th class="pr-th-sub">%<br>COMPLETION</th>
        <th class="pr-th-sub">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
      ${window.currentUserRole === 'staff' ? '' : `
      <tr class="pr-grand">
        <td class="pr-transparent"></td>
        <td class="pr-transparent"></td>
        <td class="pr-transparent"></td>
        <td colspan="3" style="text-align:right;font-weight:800">TOTAL PROJECT COST (VAT EXCLUSIVE)</td>
        <td class="c-amt">${fmt(grand)}</td>
        <td class="c-pct">${avgPct}</td>
        <td class="c-amt">${fmt(totalAcc)}</td>
      </tr>
      <tr class="pr-discount">
        <td class="pr-transparent"></td>
        <td class="pr-transparent"></td>
        <td class="pr-transparent"></td>
        <td colspan="3" style="text-align:right;font-weight:800">DISCOUNT</td>
        <td class="c-amt">${fmt(disc)}</td>
        <td colspan="2"></td>
      </tr>
      <tr class="pr-grand-final">
        <td class="pr-transparent"></td>
        <td class="pr-transparent"></td>
        <td class="pr-transparent"></td>
        <td colspan="3" style="text-align:right;font-weight:900">DISCOUNTED TOTAL PROJECT COST (VAT EXCLUSIVE)</td>
        <td class="c-amt">${fmt(discounted)}</td>
        <td colspan="2"></td>
      </tr>
      <tr class="pr-acc">
        <td class="pr-transparent"></td>
        <td class="pr-transparent"></td>
        <td class="pr-transparent"></td>
        <td colspan="5" style="text-align:right;font-weight:900">TOTAL ACCOMPLISHMENT TO DATE</td>
        <td class="c-amt">${fmt(totalAcc)}</td>
      </tr>`}
    </tbody>
  </table>

  <!-- Terms -->
  ${termsSectionsHTML ? `<div class="pr-terms">${termsSectionsHTML}</div>` : ''}

  <!-- Signatures -->
  ${(sgClient || sgContractor) ? `
  <div class="pr-sig">
    ${sgClient ? `
    <div class="pr-sig-col">
      <div class="pr-sig-line">${escHtml(h.ownerName || '\u00a0')}</div>
      <div class="pr-sig-role">Client / Owner</div>
    </div>` : ''}
    ${sgContractor ? `
    <div class="pr-sig-col pr-sig-signed">
      <img class="pr-sig-img" src="${window.location.origin}/assets/images/dacs-signature.png" alt="" onerror="this.style.display='none';this.parentNode.classList.remove('pr-sig-signed');">
      <div class="pr-sig-line">DAC'S BUILDING DESIGN SERVICES</div>
      <div class="pr-sig-role">Contractor / Prepared By</div>
    </div>` : ''}
  </div>` : ''}

  <div class="pr-disc">
    Disclaimer: This document does not constitute a formal contract and is not legally binding.
    A formal contract will be issued upon approval of the total project cost and the subsequent signing of the contract.
    This document serves for reference purposes only.
    &nbsp;|&nbsp; Printed on ${printDate}
  </div>

</div>
</body>
</html>`;

        const win = window.open('', '_blank', 'width=1000,height=900');
        if (!win) { boqToast('Pop-up blocked. Please allow pop-ups for this site.', 'error'); return; }
        win.document.write(html);
        win.document.close();
        win.focus();
        win.onload = function () { win.print(); win.onafterprint = function () { win.close(); }; };
    };

    // ── HTML helpers ───────────────────────────────────────────
    function escHtml(s) {
        return String(s)
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
    }
    function escAttr(s) { return escHtml(s).replace(/'/g,'&#39;'); }

})();
