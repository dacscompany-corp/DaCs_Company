/* ══════════════════════════════════════════════════════════
   Project Management — Admin Module
   Handles: Weekly Summary, Procurement List, Revolving Fund, Payment
══════════════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────────────
let _pmCurrentView    = null;
let _pmProjects       = [];   // { id, clientName, projectName, ... }
let _pmActiveProject  = null;
let _pmWeeklyEntries  = [];
let _pmProcItems      = [];
let _pmRevolvingData  = null;
let _pmExpenses       = [];
let _pmPayRequests    = [];
let _pmCompanyBuyItemData = null;
let _pmCompanyReceiptFile = null;

// ── Init ────────────────────────────────────────────────
window.initPMModule = async function(view) {
    _pmCurrentView = view;
    await _pmLoadProjects();
    if (!_pmActiveProject) {
        const savedId = localStorage.getItem('pm_selected_project');
        if (savedId) {
            const found = _pmProjects.find(p => p.id === savedId);
            if (found) _pmActiveProject = found;
        }
    }
    _pmRenderCurrentView();
};

async function _pmLoadProjects() {
    if (_pmProjects.length) return; // already loaded
    if (typeof db === 'undefined') return;
    try {
        const snap = await db.collection('constructionProjects').orderBy('clientName').get();
        _pmProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.warn('PM: load projects', e.message);
    }
}

function _pmRenderCurrentView() {
    switch(_pmCurrentView) {
        case 'pmProjects':   _pmLoadProjectsList(); break;
        case 'pmWorkspace':  _pmInitWorkspace();    break;
    }
}

// ── Workspace init ────────────────────────────────────
function _pmInitWorkspace() {
    if (!_pmActiveProject) { switchView('pmProjects'); return; }
    const p = _pmActiveProject;
    _pmSet('ws-client-name', p.clientName || '—');
    _pmSet('ws-project-name', p.projectName || '');
    const statusBadge = { active:'pm-badge-paid', 'on-hold':'pm-badge-partial', completed:'pm-badge-client', terminated:'pm-badge-terminated' };
    const statusLabel = { active:'Active', 'on-hold':'On Hold', completed:'Completed', terminated:'Terminated' };
    const el = document.getElementById('ws-status-badge');
    if (el) el.innerHTML = `<span class="pm-badge ${statusBadge[p.status]||'pm-badge-paid'}">${statusLabel[p.status]||'Active'}</span>`;
    // Load the active tab's data
    const activePanel = document.querySelector('.pm-ws-panel.active');
    if (activePanel) _pmLoadWsPanel(activePanel.id);
    if (window.lucide) lucide.createIcons();
}

window.pmWsTab = function(tab, btn) {
    document.querySelectorAll('.pm-ws-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pm-ws-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('ws-panel-' + tab);
    if (panel) { panel.classList.add('active'); _pmLoadWsPanel(panel.id); }
};

function _pmLoadWsPanel(panelId) {
    switch(panelId) {
        case 'ws-panel-weekly':      _pmLoadWeeklyEntries(); break;
        case 'ws-panel-procurement': _pmLoadProcItems();     break;
        case 'ws-panel-revolving':   _pmLoadRevolving();     break;
        case 'ws-panel-payment':     _pmLoadPayments();      break;
    }
}



// ══════════════════════════════════════════════════════════
// 0. CONSTRUCTION PROJECTS (CRUD)
// ══════════════════════════════════════════════════════════

async function _pmLoadProjectsList() {
    const grid = document.getElementById('pm-cards-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="pm-cards-empty"><div class="pm-cards-empty-icon">⏳</div>Loading projects…</div>';
    try {
        const snap = await db.collection('constructionProjects').orderBy('clientName').get();
        _pmProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmRenderProjectCards(_pmProjects);
    } catch(e) {
        grid.innerHTML = `<div class="pm-cards-empty">Error loading projects: ${_esc(e.message)}</div>`;
    }
}

function _pmRenderProjectCards(projects) {
    const grid = document.getElementById('pm-cards-grid');
    if (!grid) return;
    if (!projects.length) {
        grid.innerHTML = '<div class="pm-cards-empty"><div class="pm-cards-empty-icon">🏗️</div>No projects yet. Click <strong>Add Project</strong> to create your first one.</div>';
        return;
    }
    const statusCls   = { active:'pm-badge-paid', 'on-hold':'pm-badge-partial', completed:'pm-badge-client', terminated:'pm-badge-terminated' };
    const statusLabel = { active:'Active', 'on-hold':'On Hold', completed:'Completed', terminated:'Terminated' };
    // Render uses data-pm-id on the card + data-pm-action on each button.
    // The previous version interpolated JSON.stringify(p) into inline onclick
    // handlers — that escaped " but NOT ' or backticks, so a client name like
    // "O'Brien" or a malicious "'); alert(1); //" would break out. Now the
    // full project object is fetched from _pmProjects at click-time via the
    // delegated handler below (attached once via _handlerAttached flag).
    grid.innerHTML = projects.map(p => {
        const badge     = `<span class="pm-badge ${statusCls[p.status]||'pm-badge-paid'}">${statusLabel[p.status]||'Active'}</span>`;
        const startStr  = p.startDate ? new Date(p.startDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
        return `<div class="pm-project-card" data-pm-id="${_esc(p.id)}">
          <div class="pm-card-top">
            <div class="pm-card-names">
              <div class="pm-card-client">${_esc(p.clientName||'Unnamed Client')}</div>
              <div class="pm-card-project">${_esc(p.projectName||'—')}</div>
            </div>
            <div class="pm-card-actions">
              <button class="pm-card-icon-btn" data-pm-action="edit" title="Edit"><i data-lucide="pencil" style="width:13px;height:13px;"></i></button>
              <button class="pm-card-icon-btn del" data-pm-action="delete" title="Delete"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            ${badge}
            <span style="font-size:12px;color:#9ca3af;">Started ${startStr}</span>
          </div>
          <div class="pm-card-stats">
            <div class="pm-card-stat">
              <div class="pm-card-stat-label">Client Email</div>
              <div class="pm-card-stat-value" style="font-size:12px;font-weight:500;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(p.clientEmail||'—')}</div>
            </div>
            <div class="pm-card-stat">
              <div class="pm-card-stat-label">Location</div>
              <div class="pm-card-stat-value" style="font-size:12px;font-weight:500;color:#6b7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(p.address||'—')}</div>
            </div>
          </div>
          <button class="pm-card-open-btn" data-pm-action="open">
            <i data-lucide="arrow-right" style="width:14px;height:14px;"></i> Open Project
          </button>
        </div>`;
    }).join('');
    if (!grid._handlerAttached) {
        grid._handlerAttached = true;
        grid.addEventListener('click', e => {
            const btn  = e.target.closest('[data-pm-action]');
            if (!btn) return;
            const card = btn.closest('[data-pm-id]');
            if (!card) return;
            const id   = card.getAttribute('data-pm-id');
            const p    = _pmProjects.find(x => x.id === id);
            if (!p) return;
            switch (btn.getAttribute('data-pm-action')) {
                case 'edit':   pmEditProject(p);     break;
                case 'delete': pmDeleteProject(p.id); break;
                case 'open':   pmOpenProject(p);     break;
            }
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmOpenProject = function(p) {
    _pmActiveProject = _pmProjects.find(pr => pr.id === p.id) || p;
    localStorage.setItem('pm_selected_project', p.id);
    // Reset workspace to weekly tab
    document.querySelectorAll('.pm-ws-tab').forEach((t,i)  => t.classList.toggle('active', i===0));
    document.querySelectorAll('.pm-ws-panel').forEach((pn,i) => pn.classList.toggle('active', i===0));
    switchView('pmWorkspace');
};

window.pmOpenProjectModal = function() {
    document.getElementById('pmProjectModalTitle').textContent = 'Add Construction Project';
    document.getElementById('pmProjectId').value        = '';
    document.getElementById('pmProjectClientName').value = '';
    document.getElementById('pmProjectName').value       = '';
    document.getElementById('pmProjectEmail').value      = '';
    document.getElementById('pmProjectStatus').value     = 'active';
    document.getElementById('pmProjectStartDate').value  = '';
    document.getElementById('pmProjectAddress').value    = '';
    ['err-pmProjectClientName','err-pmProjectName'].forEach(_pmClearErr);
    document.getElementById('pmProjectModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditProject = function(p) {
    document.getElementById('pmProjectModalTitle').textContent = 'Edit Construction Project';
    document.getElementById('pmProjectId').value        = p.id;
    document.getElementById('pmProjectClientName').value = p.clientName  || '';
    document.getElementById('pmProjectName').value       = p.projectName || '';
    document.getElementById('pmProjectEmail').value      = p.clientEmail || '';
    document.getElementById('pmProjectStatus').value     = p.status      || 'active';
    document.getElementById('pmProjectStartDate').value  = p.startDate   || '';
    document.getElementById('pmProjectAddress').value    = p.address     || '';
    ['err-pmProjectClientName','err-pmProjectName'].forEach(_pmClearErr);
    document.getElementById('pmProjectModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveProject = async function() {
    const projectId  = document.getElementById('pmProjectId').value;
    const clientName = document.getElementById('pmProjectClientName').value.trim();
    const projectName= document.getElementById('pmProjectName').value.trim();
    const clientEmail= document.getElementById('pmProjectEmail').value.trim();
    const status     = document.getElementById('pmProjectStatus').value;
    const startDate  = document.getElementById('pmProjectStartDate').value;
    const address    = document.getElementById('pmProjectAddress').value.trim();

    let valid = true;
    if (!clientName)  { _pmShowErr('err-pmProjectClientName','Client name is required.'); valid = false; }
    if (!projectName) { _pmShowErr('err-pmProjectName','Project name is required.');      valid = false; }
    if (!valid) return;

    const data = { clientName, projectName, clientEmail, status, startDate, address,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    const btn = document.querySelector('#pmProjectModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (projectId) {
            await db.collection('constructionProjects').doc(projectId).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('constructionProjects').add(data);
        }
        _pmProjects = [];
        pmCloseModal('pmProjectModal');
        _pmLoadProjectsList();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Project';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmDeleteProject = async function(id) {
    if (!confirm('Delete this project? This removes the project from the list but does NOT delete subcollection data (weekly bills, procurement, etc.).')) return;
    try {
        await db.collection('constructionProjects').doc(id).delete();
        if (_pmActiveProject?.id === id) {
            _pmActiveProject = null;
            localStorage.removeItem('pm_selected_project');
        }
        _pmProjects = [];
        _pmLoadProjectsList();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 1. WEEKLY SUMMARY
// ══════════════════════════════════════════════════════════

async function _pmLoadWeeklyEntries() {
    const tbody = document.getElementById('pm-weekly-tbody');
    if (!tbody) return;
    if (!_pmActiveProject) {
        tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row">Select a client project above.</td></tr>';
        _pmWeeklyUpdateKPIs([]);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row" style="color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('weeklyBills')
            .orderBy('weekEndingDate', 'desc')
            .get();
        _pmWeeklyEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmWeeklyRenderTable(_pmWeeklyEntries);
        _pmWeeklyUpdateKPIs(_pmWeeklyEntries);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-row">Error: ${_esc(e.message)}</td></tr>`;
    }
}

function _pmWeeklyUpdateKPIs(entries) {
    const labor     = entries.reduce((s,e) => s + (e.labor     || 0), 0);
    const materials = entries.reduce((s,e) => s + (e.materials || 0), 0);
    const fee       = entries.reduce((s,e) => s + (e.managementFee || 0), 0);
    const grand     = entries.reduce((s,e) => s + (e.grandTotal    || 0), 0);
    _pmSet('pm-kpi-labor',     _fmt(labor));
    _pmSet('pm-kpi-materials', _fmt(materials));
    _pmSet('pm-kpi-fee',       _fmt(fee));
    _pmSet('pm-kpi-grand',     _fmt(grand));
}

function _pmWeeklyRenderTable(entries) {
    const tbody = document.getElementById('pm-weekly-tbody');
    if (!tbody) return;
    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="pm-empty-row">No weekly entries yet. Click "New Entry" to add one.</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(e => {
        const dateStr = e.weekEndingDate ? new Date(e.weekEndingDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
        const statusBadge = e.status === 'Paid'
            ? '<span class="pm-badge pm-badge-paid">Paid</span>'
            : e.status === 'Partial'
            ? '<span class="pm-badge pm-badge-partial">Partial</span>'
            : '<span class="pm-badge pm-badge-unpaid">Submitted</span>';
        return `<tr data-pm-id="${_esc(e.id)}">
            <td><strong>${_esc(dateStr)}</strong></td>
            <td>${_fmt(e.labor)}</td>
            <td>${_fmt(e.materials)}</td>
            <td>${_fmt(e.managementFee)}</td>
            <td><strong>${_fmt(e.grandTotal)}</strong></td>
            <td>${statusBadge}</td>
            <td>
              <button class="pm-tbl-btn pm-tbl-btn-invoice" data-pm-action="invoice"><i data-lucide="file-text" style="width:12px;height:12px;"></i> Invoice</button>
            </td>
            <td>
              <button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i> Edit</button>
              <button class="pm-tbl-btn pm-tbl-btn-delete" data-pm-action="delete"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
            </td>
        </tr>`;
    }).join('');
    if (!tbody._handlerAttached) {
        tbody._handlerAttached = true;
        tbody.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-pm-action]');
            if (!btn) return;
            const tr  = btn.closest('[data-pm-id]');
            if (!tr) return;
            const id  = tr.getAttribute('data-pm-id');
            const entry = _pmWeeklyEntries.find(x => x.id === id);
            if (!entry) return;
            if (btn.getAttribute('data-pm-action') === 'edit')    pmEditWeeklyEntry(entry);
            if (btn.getAttribute('data-pm-action') === 'delete')  pmDeleteWeeklyEntry(entry.id);
            if (btn.getAttribute('data-pm-action') === 'invoice') _pmOpenLaborInvoiceForEntry(entry);
        });
    }
    if (window.lucide) lucide.createIcons();
}

function _pmOpenLaborInvoiceForEntry(entry) {
    if (typeof switchView !== 'function' || typeof initLaborInvoiceModule !== 'function') {
        alert('Labor Invoice module is not available.');
        return;
    }
    switchView('laborInvoices');
    // Wait for the module to initialise then open a pre-filled new form
    setTimeout(async function () {
        const proj = _pmActiveProject;
        if (!proj) return;
        // Pre-load weekly entries for this project inside the labor invoice module
        if (typeof window._labInvPreFill === 'function') {
            window._labInvPreFill(proj, entry);
        }
    }, 300);
}

window.pmOpenWeeklyModal = function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    document.getElementById('pmWeeklyModalTitle').textContent = 'New Weekly Entry';
    document.getElementById('pmWeeklyEntryId').value = '';
    document.getElementById('pmWeeklyDate').value     = _nextFriday();
    document.getElementById('pmWeeklyLabor').value    = '';
    document.getElementById('pmWeeklyMaterials').value = '';
    document.getElementById('pmWeeklyNotes').value    = '';
    document.getElementById('pm-calc-fee').textContent   = '₱0.00';
    document.getElementById('pm-calc-total').textContent = '₱0.00';
    ['err-pmWeeklyDate','err-pmWeeklyLabor','err-pmWeeklyMaterials'].forEach(_pmClearErr);
    document.getElementById('pmWeeklyModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditWeeklyEntry = function(entry) {
    document.getElementById('pmWeeklyModalTitle').textContent = 'Edit Weekly Entry';
    document.getElementById('pmWeeklyEntryId').value       = entry.id;
    document.getElementById('pmWeeklyDate').value          = entry.weekEndingDate || '';
    document.getElementById('pmWeeklyLabor').value         = entry.labor    || '';
    document.getElementById('pmWeeklyMaterials').value     = entry.materials || '';
    document.getElementById('pmWeeklyNotes').value         = entry.notes   || '';
    pmWeeklyCompute();
    ['err-pmWeeklyDate','err-pmWeeklyLabor','err-pmWeeklyMaterials'].forEach(_pmClearErr);
    document.getElementById('pmWeeklyModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmWeeklyCompute = function() {
    const labor     = parseFloat(document.getElementById('pmWeeklyLabor')?.value)     || 0;
    const materials = parseFloat(document.getElementById('pmWeeklyMaterials')?.value) || 0;
    const fee   = (labor + materials) * 0.15;
    const total = labor + materials + fee;
    document.getElementById('pm-calc-fee').textContent   = '₱' + fee.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('pm-calc-total').textContent = '₱' + total.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
};

window.pmSaveWeeklyEntry = async function() {
    const entryId   = document.getElementById('pmWeeklyEntryId').value;
    const weekEndingDate = document.getElementById('pmWeeklyDate').value;
    const labor     = parseFloat(document.getElementById('pmWeeklyLabor').value)     || 0;
    const materials = parseFloat(document.getElementById('pmWeeklyMaterials').value) || 0;
    const notes     = document.getElementById('pmWeeklyNotes').value.trim();

    let valid = true;
    if (!weekEndingDate) { _pmShowErr('err-pmWeeklyDate','Please select the week date.'); valid = false; }
    if (labor <= 0 && materials <= 0) { _pmShowErr('err-pmWeeklyLabor','Enter labor or materials amount.'); valid = false; }
    if (!valid) return;

    const managementFee = (labor + materials) * 0.15;
    const grandTotal    = labor + materials + managementFee;
    const data = { weekEndingDate, labor, materials, managementFee, grandTotal, notes,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    const btn = document.querySelector('#pmWeeklyModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('weeklyBills');
        if (entryId) {
            await col.doc(entryId).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            data.status = 'Submitted';
            await col.add(data);
        }
        pmCloseModal('pmWeeklyModal');
        _pmLoadWeeklyEntries();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Entry';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmDeleteWeeklyEntry = async function(id) {
    if (!confirm('Delete this weekly entry? This cannot be undone.')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id).collection('weeklyBills').doc(id).delete();
        _pmLoadWeeklyEntries();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 2. MATERIALS PROCUREMENT LIST
// ══════════════════════════════════════════════════════════

async function _pmLoadProcItems() {
    const tbody = document.getElementById('pm-proc-tbody');
    if (!tbody) return;
    if (!_pmActiveProject) {
        tbody.innerHTML = '<tr><td colspan="8" class="pm-empty-row">Select a client project above.</td></tr>';
        _pmProcUpdateStats([]);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="8" class="pm-empty-row" style="color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('procurementList')
            .orderBy('createdAt','desc')
            .get();
        _pmProcItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmProcRenderTable(_pmProcItems);
        _pmProcUpdateStats(_pmProcItems);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="8" class="pm-empty-row">Error: ${_esc(e.message)}</td></tr>`;
    }
}

function _pmProcUpdateStats(items) {
    const unresolved = items.filter(i => ['Pending','Assigned to Client','Assigned to Admin'].includes(i.status)).length;
    _pmSet('pm-proc-total',   items.length);
    _pmSet('pm-proc-pending', unresolved);
    _pmSet('pm-proc-company', items.filter(i => i.boughtBy === 'company').length);
    _pmSet('pm-proc-client',  items.filter(i => i.boughtBy === 'client').length);
    const badge = document.getElementById('pm-proc-badge');
    if (badge) { badge.textContent = unresolved; badge.style.display = unresolved ? '' : 'none'; }
}

function _pmProcRenderTable(items) {
    const tbody = document.getElementById('pm-proc-tbody');
    if (!tbody) return;
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="pm-empty-row">No items yet. Click "Add Item" to create the procurement list.</td></tr>';
        return;
    }
    const rowClass = {
        'Pending'           : 'pm-row-pending',
        'Assigned to Client': 'pm-row-pending',
        'Assigned to Admin' : 'pm-row-pending',
        'Bought by Company' : 'pm-row-company',
        'Bought by Client'  : 'pm-row-client'
    };
    const badgeClass = {
        'Pending'           : 'pm-badge pm-badge-pending',
        'Assigned to Client': 'pm-badge pm-badge-partial',
        'Assigned to Admin' : 'pm-badge pm-badge-partial',
        'Bought by Company' : 'pm-badge pm-badge-company',
        'Bought by Client'  : 'pm-badge pm-badge-client'
    };

    tbody.innerHTML = items.map(it => {
        const rc  = rowClass[it.status]  || '';
        const bc  = badgeClass[it.status] || 'pm-badge';
        const est = it.estPrice    ? _fmt(it.estPrice)    : '—';
        const act = it.actualAmount ? _fmt(it.actualAmount) : '—';
        const buyer = it.boughtBy === 'client'         ? 'Client'
                    : it.boughtBy === 'company'        ? 'Company (Admin)'
                    : it.status === 'Assigned to Client' ? 'Client (pending)'
                    : it.status === 'Assigned to Admin'  ? 'Admin (pending)'
                    : '—';

        const receiptBtn = it.receiptUrl
            ? `<button class="pm-tbl-btn pm-tbl-btn-view" data-pm-action="receipt"><i data-lucide="eye" style="width:12px;height:12px;"></i> View</button>`
            : '<span style="color:#d1d5db;font-size:12px;">—</span>';

        const isUnresolved = ['Pending','Assigned to Client','Assigned to Admin'].includes(it.status);
        const actionBtn = isUnresolved
            ? `<button class="pm-tbl-btn pm-tbl-btn-buy" data-pm-action="buy"><i data-lucide="check" style="width:12px;height:12px;"></i> Mark Bought</button>
               <button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i></button>
               <button class="pm-tbl-btn pm-tbl-btn-delete" data-pm-action="delete"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>`
            : `<span style="color:#9ca3af;font-size:12px;font-style:italic;">Done</span>`;

        return `<tr class="${rc}" data-pm-id="${_esc(it.id)}">
            <td><strong>${_esc(it.item||'—')}</strong>${it.notes ? `<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">${_esc(it.notes)}</div>`:''}</td>
            <td style="color:#6b7280;">${_esc(it.qty||'—')}</td>
            <td>${est}</td>
            <td><span class="${bc}">${_esc(it.status||'—')}</span></td>
            <td style="font-weight:600;">${act}</td>
            <td>${_esc(buyer)}</td>
            <td>${receiptBtn}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }).join('');
    if (!tbody._handlerAttached) {
        tbody._handlerAttached = true;
        tbody.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-pm-action]');
            if (!btn) return;
            const tr  = btn.closest('[data-pm-id]');
            if (!tr) return;
            const it  = _pmProcItems.find(x => x.id === tr.getAttribute('data-pm-id'));
            if (!it) return;
            switch (btn.getAttribute('data-pm-action')) {
                case 'receipt': pmViewReceipt(it.receiptUrl, it.item); break;
                case 'buy':     pmOpenCompanyBuyModal(it); break;
                case 'edit':    pmEditProcItem(it); break;
                case 'delete':  pmDeleteProcItem(it.id); break;
            }
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmProcFilter = function() {
    const q = (document.getElementById('pm-proc-search')?.value || '').toLowerCase();
    _pmProcRenderTable(_pmProcItems.filter(i => (i.item||'').toLowerCase().includes(q)));
};

window.pmOpenAddItemModal = function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    document.getElementById('pmAddItemTitle').textContent = 'Add Procurement Item';
    document.getElementById('pmAddItemId').value    = '';
    document.getElementById('pmAddItemName').value  = '';
    document.getElementById('pmAddItemQty').value   = '';
    document.getElementById('pmAddItemEst').value   = '';
    document.getElementById('pmAddItemNotes').value = '';
    ['err-pmAddItemName','err-pmAddItemQty'].forEach(_pmClearErr);
    document.getElementById('pmAddItemModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditProcItem = function(item) {
    document.getElementById('pmAddItemTitle').textContent   = 'Edit Item';
    document.getElementById('pmAddItemId').value    = item.id;
    document.getElementById('pmAddItemName').value  = item.item  || '';
    document.getElementById('pmAddItemQty').value   = item.qty   || '';
    document.getElementById('pmAddItemEst').value   = item.estPrice || '';
    document.getElementById('pmAddItemNotes').value = item.notes || '';
    ['err-pmAddItemName','err-pmAddItemQty'].forEach(_pmClearErr);
    document.getElementById('pmAddItemModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveProcItem = async function() {
    const itemId = document.getElementById('pmAddItemId').value;
    const name   = document.getElementById('pmAddItemName').value.trim();
    const qty    = document.getElementById('pmAddItemQty').value.trim();
    const est    = parseFloat(document.getElementById('pmAddItemEst').value) || null;
    const notes  = document.getElementById('pmAddItemNotes').value.trim();

    let valid = true;
    if (!name) { _pmShowErr('err-pmAddItemName','Item name is required.'); valid = false; }
    if (!qty)  { _pmShowErr('err-pmAddItemQty','Quantity is required.'); valid = false; }
    if (!valid) return;

    const data = { item: name, qty, estPrice: est, notes,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    const btn = document.querySelector('#pmAddItemModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('procurementList');
        if (itemId) {
            await col.doc(itemId).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            data.status    = 'Pending';
            data.boughtBy  = null;
            data.actualAmount = null;
            data.receiptUrl   = null;
            await col.add(data);
        }
        pmCloseModal('pmAddItemModal');
        _pmLoadProcItems();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Item';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmDeleteProcItem = async function(id) {
    if (!confirm('Delete this procurement item?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id).collection('procurementList').doc(id).delete();
        _pmLoadProcItems();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ── Company Buy Modal ─────────────────────────────────────
window.pmOpenCompanyBuyModal = function(item) {
    _pmCompanyBuyItemData = item;
    _pmCompanyReceiptFile = null;
    document.getElementById('pmCompanyBuyItemId').value        = item.id;
    document.getElementById('pmCompanyBuyItemName').textContent = item.item || '—';
    document.getElementById('pmCompanyBuyItemQty').textContent  = item.qty  || '—';
    document.getElementById('pmCompanyBuyItemEst').textContent  = item.estPrice ? _fmt(item.estPrice) : '—';
    document.getElementById('pmCompanyBuyAmount').value         = '';
    document.getElementById('pmCompanyBuyNotes').value          = '';
    document.getElementById('pmCompanyReceiptFile').value       = '';
    document.getElementById('pmCompanyReceiptPreview').style.display = 'none';
    document.getElementById('pmCompanyReceiptPreview').innerHTML = '';
    ['err-pmCompanyBuyAmount','err-pmCompanyReceipt'].forEach(_pmClearErr);
    document.getElementById('pmCompanyBuyModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmCompanyHandleDrop = function(e) {
    e.preventDefault();
    document.getElementById('pmCompanyUploadZone').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) { _pmCompanyReceiptFile = file; _pmCompanyPreviewFile_direct(file); }
};

window.pmCompanyPreviewFile = function(input) {
    if (input.files[0]) { _pmCompanyReceiptFile = input.files[0]; _pmCompanyPreviewFile_direct(input.files[0]); }
};

function _pmCompanyPreviewFile_direct(file) {
    const preview = document.getElementById('pmCompanyReceiptPreview');
    preview.style.display = 'block';
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = e => { preview.innerHTML = `<img src="${e.target.result}" class="pm-receipt-preview-img" alt="receipt">`; };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = `<div class="pm-file-chip"><i data-lucide="file-text" style="width:16px;height:16px;"></i> ${_esc(file.name)}</div>`;
        if (window.lucide) lucide.createIcons();
    }
}

window.pmSubmitCompanyBuy = async function() {
    const amount = parseFloat(document.getElementById('pmCompanyBuyAmount').value) || 0;
    const notes  = document.getElementById('pmCompanyBuyNotes').value.trim();
    const itemId = document.getElementById('pmCompanyBuyItemId').value;

    let valid = true;
    if (amount <= 0) { _pmShowErr('err-pmCompanyBuyAmount','Enter the actual amount paid.'); valid = false; }
    if (!_pmCompanyReceiptFile) { _pmShowErr('err-pmCompanyReceipt','Please upload a proof of receipt.'); valid = false; }
    if (!valid) return;

    const btn = document.getElementById('pmCompanyBuySubmitBtn');
    btn.disabled = true; btn.textContent = 'Uploading…';

    try {
        let receiptUrl = null;
        if (_pmCompanyReceiptFile && typeof storage !== 'undefined') {
            const ext = _pmCompanyReceiptFile.name.split('.').pop();
            const path = `procurementReceipts/${_pmActiveProject.id}/${itemId}_company_${Date.now()}.${ext}`;
            const ref = storage.ref(path);
            await ref.put(_pmCompanyReceiptFile);
            receiptUrl = await ref.getDownloadURL();
        }

        await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('procurementList')
            .doc(itemId)
            .update({
                status: 'Bought by Company',
                boughtBy: 'company',
                actualAmount: amount,
                receiptUrl: receiptUrl,
                notes: notes,
                boughtAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

        pmCloseModal('pmCompanyBuyModal');
        _pmLoadProcItems();
    } catch(e) {
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;"></i> Confirm Purchase';
        if (window.lucide) lucide.createIcons();
    }
};

// ── Receipt Viewer ────────────────────────────────────────
window.pmViewReceipt = function(url, itemName) {
    document.getElementById('pmReceiptViewTitle').textContent = (itemName || 'Receipt') + ' — Receipt';
    const content = document.getElementById('pmReceiptViewContent');
    const dl = document.getElementById('pmReceiptDownloadLink');
    dl.href = url;
    if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url) || url.includes('image')) {
        content.innerHTML = `<img src="${_esc(url)}" class="pm-receipt-preview-img" style="max-height:400px;" alt="receipt">`;
    } else {
        content.innerHTML = `<div class="pm-file-chip" style="display:inline-flex;"><i data-lucide="file-text" style="width:18px;height:18px;"></i> PDF Receipt — use "Open in New Tab" to view</div>`;
    }
    document.getElementById('pmReceiptViewModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

// ══════════════════════════════════════════════════════════
// 3. REVOLVING FUND
// ══════════════════════════════════════════════════════════

async function _pmLoadRevolving() {
    if (!_pmActiveProject) {
        _pmRevolvingData = null;
        _pmExpenses = [];
        _pmRevUpdateKPIs();
        _pmRevRenderTable([]);
        return;
    }
    try {
        const [fundSnap, expSnap] = await Promise.all([
            db.collection('constructionProjects').doc(_pmActiveProject.id)
              .collection('revolvingFund').doc('summary').get(),
            db.collection('constructionProjects').doc(_pmActiveProject.id)
              .collection('revolvingFundExpenses').orderBy('date','desc').get()
        ]);
        _pmRevolvingData = fundSnap.exists ? fundSnap.data() : { initialFund: 0, totalReplenished: 0 };
        _pmExpenses = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmRevUpdateKPIs();
        _pmRevRenderTable(_pmExpenses);
    } catch(e) {
        console.warn('PM revolving load:', e.message);
    }
}

function _pmRevUpdateKPIs() {
    const initial    = _pmRevolvingData?.initialFund || 0;
    const replenished = _pmRevolvingData?.totalReplenished || 0;
    const totalFund  = initial + replenished;
    const spent      = _pmExpenses.reduce((s,e) => s + (e.amount||0), 0);
    const balance    = totalFund - spent;
    _pmSet('pm-rev-initial',    _fmt(initial));
    _pmSet('pm-rev-spent',      _fmt(spent));
    _pmSet('pm-rev-balance',    _fmt(Math.max(0, balance)));
    _pmSet('pm-rev-replenish',  _fmt(Math.max(0, spent)));
}

function _pmRevRenderTable(expenses) {
    const tbody = document.getElementById('pm-rev-tbody');
    if (!tbody) return;
    if (!expenses.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="pm-empty-row">No expenses recorded yet.</td></tr>';
        return;
    }
    tbody.innerHTML = expenses.map(e => {
        const dateStr = e.date ? new Date(e.date+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
        return `<tr>
            <td>${_esc(dateStr)}</td>
            <td><strong>${_esc(e.description||'—')}</strong></td>
            <td style="font-weight:600;color:#dc2626;">${_fmt(e.amount)}</td>
            <td style="color:#6b7280;">${_esc(e.notes||'—')}</td>
            <td>
              <button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmDeleteExpense('${_esc(e.id)}')"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
            </td>
        </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

window.pmOpenSetFundModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    document.getElementById('pmSetFundAmount').value = _pmRevolvingData?.initialFund || '';
    document.getElementById('pmSetFundNotes').value  = '';
    _pmClearErr('err-pmSetFundAmount');
    document.getElementById('pmSetFundModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveInitialFund = async function() {
    const amount = parseFloat(document.getElementById('pmSetFundAmount').value) || 0;
    const notes  = document.getElementById('pmSetFundNotes').value.trim();
    if (amount <= 0) { _pmShowErr('err-pmSetFundAmount','Enter a valid amount.'); return; }
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFund').doc('summary')
          .set({ initialFund: amount, notes, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        pmCloseModal('pmSetFundModal');
        _pmLoadRevolving();
    } catch(e) { alert('Error: ' + e.message); }
};

window.pmOpenExpenseModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    document.getElementById('pmExpenseDate').value   = new Date().toISOString().slice(0,10);
    document.getElementById('pmExpenseAmount').value = '';
    document.getElementById('pmExpenseDesc').value   = '';
    document.getElementById('pmExpenseNotes').value  = '';
    ['err-pmExpenseDate','err-pmExpenseAmount','err-pmExpenseDesc'].forEach(_pmClearErr);
    document.getElementById('pmExpenseModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveExpense = async function() {
    const date   = document.getElementById('pmExpenseDate').value;
    const amount = parseFloat(document.getElementById('pmExpenseAmount').value) || 0;
    const desc   = document.getElementById('pmExpenseDesc').value.trim();
    const notes  = document.getElementById('pmExpenseNotes').value.trim();
    let valid = true;
    if (!date)    { _pmShowErr('err-pmExpenseDate','Select a date.'); valid = false; }
    if (amount<=0){ _pmShowErr('err-pmExpenseAmount','Enter amount.'); valid = false; }
    if (!desc)    { _pmShowErr('err-pmExpenseDesc','Enter description.'); valid = false; }
    if (!valid) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFundExpenses')
          .add({ date, amount, description: desc, notes, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        pmCloseModal('pmExpenseModal');
        _pmLoadRevolving();
    } catch(e) { alert('Error: ' + e.message); }
};

window.pmDeleteExpense = async function(id) {
    if (!confirm('Delete this expense?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFundExpenses').doc(id).delete();
        _pmLoadRevolving();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

window.pmOpenReplenishModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    document.getElementById('pmReplenishDate').value   = _nextFriday();
    document.getElementById('pmReplenishAmount').value = '';
    document.getElementById('pmReplenishNotes').value  = '';
    ['err-pmReplenishDate','err-pmReplenishAmount'].forEach(_pmClearErr);
    document.getElementById('pmReplenishModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveReplenishment = async function() {
    const date   = document.getElementById('pmReplenishDate').value;
    const amount = parseFloat(document.getElementById('pmReplenishAmount').value) || 0;
    const notes  = document.getElementById('pmReplenishNotes').value.trim();
    let valid = true;
    if (!date)    { _pmShowErr('err-pmReplenishDate','Select a date.'); valid = false; }
    if (amount<=0){ _pmShowErr('err-pmReplenishAmount','Enter amount.'); valid = false; }
    if (!valid) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFundReplenishments')
          .add({ date, amount, notes, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        // Update totalReplenished in summary
        const prev = _pmRevolvingData?.totalReplenished || 0;
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFund').doc('summary')
          .set({ totalReplenished: prev + amount, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        pmCloseModal('pmReplenishModal');
        _pmLoadRevolving();
    } catch(e) { alert('Error: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 4. PAYMENT
// ══════════════════════════════════════════════════════════

async function _pmLoadPayments() {
    const tbody = document.getElementById('pm-pay-tbody');
    if (!tbody) return;
    if (!_pmActiveProject) {
        tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row">Select a client project above.</td></tr>';
        _pmPayUpdateKPIs([]);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row" style="color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('paymentRequests')
            .where('constructionProjectId', '==', _pmActiveProject.id)
            .orderBy('weekEndingDate','desc')
            .get();
        _pmPayRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmPayRenderTable(_pmPayRequests);
        _pmPayUpdateKPIs(_pmPayRequests);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-row">Error: ${_esc(e.message)}</td></tr>`;
    }
}

function _pmPayUpdateKPIs(reqs) {
    const outstanding = reqs.filter(r => r.status === 'unpaid' || r.status === 'partial')
        .reduce((s,r) => s + ((r.totalAmount || 0) - (r.amountPaid || 0)), 0);
    const paid = reqs.reduce((s,r) => s + (r.amountPaid || 0), 0);
    const strictCount = reqs.filter(r => r.strict).length;
    const nextUnpaid = reqs.find(r => r.status === 'unpaid' || r.status === 'partial');
    _pmSet('pm-pay-outstanding', _fmt(outstanding));
    _pmSet('pm-pay-total-paid',  _fmt(paid));
    _pmSet('pm-pay-strict-count', strictCount);
    _pmSet('pm-pay-next-due', nextUnpaid?.weekEndingDate
        ? new Date(nextUnpaid.weekEndingDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
        : '—');
}

function _pmPayRenderTable(reqs) {
    const tbody = document.getElementById('pm-pay-tbody');
    if (!tbody) return;
    if (!reqs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row">No payment requests yet.</td></tr>';
        return;
    }
    const statusBadge = {
        paid:    '<span class="pm-badge pm-badge-paid">Paid</span>',
        partial: '<span class="pm-badge pm-badge-partial">Partial</span>',
        unpaid:  '<span class="pm-badge pm-badge-unpaid">Unpaid</span>',
    };
    tbody.innerHTML = reqs.map(r => {
        const dateStr = r.weekEndingDate ? new Date(r.weekEndingDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
        const carry   = r.carryover ? _fmt(r.carryover) : '₱0';
        const total   = _fmt(r.totalAmount || ((r.amount||0)+(r.carryover||0)));
        const badge   = statusBadge[r.status] || `<span class="pm-badge pm-badge-unpaid">${_esc(r.status||'—')}</span>`;
        const strictBadge = r.strict
            ? '<span class="pm-badge pm-badge-strict">Strict</span>'
            : '<span style="color:#9ca3af;font-size:12px;">—</span>';

        return `<tr data-pm-id="${_esc(r.id)}">
            <td><strong>${_esc(dateStr)}</strong></td>
            <td>${_fmt(r.amount)}</td>
            <td>${carry}</td>
            <td><strong>${total}</strong></td>
            <td>${strictBadge}</td>
            <td>${badge}</td>
            <td>
              <button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i> Edit</button>
              <button class="pm-tbl-btn ${r.strict ? 'pm-tbl-btn-delete' : 'pm-tbl-btn-strict'}" data-pm-action="toggle-strict">
                <i data-lucide="${r.strict ? 'unlock' : 'lock'}" style="width:12px;height:12px;"></i> ${r.strict ? 'Unstrict' : 'Strict'}
              </button>
            </td>
        </tr>`;
    }).join('');
    if (!tbody._handlerAttached) {
        tbody._handlerAttached = true;
        tbody.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-pm-action]');
            if (!btn) return;
            const tr  = btn.closest('[data-pm-id]');
            if (!tr) return;
            const r   = _pmPayRequests.find(x => x.id === tr.getAttribute('data-pm-id'));
            if (!r) return;
            if (btn.getAttribute('data-pm-action') === 'edit')          pmEditPayReq(r);
            if (btn.getAttribute('data-pm-action') === 'toggle-strict') pmToggleStrict(r.id, !r.strict);
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmOpenPaymentRequestModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    document.getElementById('pmPayReqId').value        = '';
    document.getElementById('pmPayReqDate').value      = _nextFriday();
    document.getElementById('pmPayReqAmount').value    = '';
    document.getElementById('pmPayReqCarryover').value = '0';
    document.getElementById('pmPayReqStrict').checked  = false;
    document.getElementById('pmPayReqNotes').value     = '';
    ['err-pmPayReqDate','err-pmPayReqAmount'].forEach(_pmClearErr);
    document.getElementById('pmPaymentRequestModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditPayReq = function(req) {
    document.getElementById('pmPayReqId').value        = req.id;
    document.getElementById('pmPayReqDate').value      = req.weekEndingDate || '';
    document.getElementById('pmPayReqAmount').value    = req.amount   || '';
    document.getElementById('pmPayReqCarryover').value = req.carryover || '0';
    document.getElementById('pmPayReqStrict').checked  = !!req.strict;
    document.getElementById('pmPayReqNotes').value     = req.notes   || '';
    ['err-pmPayReqDate','err-pmPayReqAmount'].forEach(_pmClearErr);
    document.getElementById('pmPaymentRequestModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSavePaymentRequest = async function() {
    const reqId    = document.getElementById('pmPayReqId').value;
    const weekEndingDate = document.getElementById('pmPayReqDate').value;
    const amount   = parseFloat(document.getElementById('pmPayReqAmount').value)    || 0;
    const carryover= parseFloat(document.getElementById('pmPayReqCarryover').value) || 0;
    const strict   = document.getElementById('pmPayReqStrict').checked;
    const notes    = document.getElementById('pmPayReqNotes').value.trim();
    let valid = true;
    if (!weekEndingDate) { _pmShowErr('err-pmPayReqDate','Select the week date.'); valid = false; }
    if (amount<=0) { _pmShowErr('err-pmPayReqAmount','Enter the amount due.'); valid = false; }
    if (!valid) return;
    const totalAmount = amount + carryover;
    const data = { weekEndingDate, amount, carryover, totalAmount, strict, notes,
                   billingPeriod: 'Week of ' + weekEndingDate,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    const btn = document.querySelector('#pmPaymentRequestModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const col = db.collection('paymentRequests');
        if (reqId) {
            await col.doc(reqId).update(data);
        } else {
            data.createdAt           = firebase.firestore.FieldValue.serverTimestamp();
            data.kind                = 'construction';
            data.status              = 'unpaid';
            data.amountPaid          = 0;
            data.source              = 'pm-admin';
            data.clientEmail         = _pmActiveProject.clientEmail || '';
            data.clientName          = _pmActiveProject.clientName  || '';
            data.projectName         = _pmActiveProject.projectName || '';
            data.constructionProjectId = _pmActiveProject.id;
            await col.add(data);
        }
        pmCloseModal('pmPaymentRequestModal');
        _pmLoadPayments();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" style="width:14px;height:14px;"></i> Send Request';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmToggleStrict = async function(id, makeStrict) {
    try {
        await db.collection('paymentRequests').doc(id)
          .update({ strict: makeStrict, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        _pmLoadPayments();
    } catch(e) { alert('Error: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// Utilities
// ══════════════════════════════════════════════════════════
window.pmCloseModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
};

function _pmSet(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function _pmShowErr(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('visible'); el.style.display = 'block'; }
}
function _pmClearErr(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.remove('visible'); el.style.display = 'none'; }
}
function _esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function _fmt(val) {
    if (val == null || val === '') return '—';
    return '₱' + Number(val).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function _nextFriday() {
    const d = new Date();
    const day = d.getDay(); // 0=Sun,5=Fri
    const diff = (5 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0,10);
}
