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
let _pmMilestones     = [];
let _pmReports        = [];
let _pmRevolvingData  = null;
let _pmExpenses       = [];
let _pmPayRequests    = [];
let _pmCompanyBuyItemData = null;
let _pmCompanyReceiptFile = null;
let _pmProcFilter     = 'all';   // materials status filter: all | pending | bought
// ── This-week inline bill builder ──
let _pmWeekBills      = [];       // all weeklyBills docs for the active project
let _pmWeekEntries    = [];       // current draft line entries {id,type,details,amount}
let _pmWeekDate       = null;     // selected Friday (YYYY-MM-DD)
let _pmWeekEditingId  = null;     // doc id when the selected week already has a saved bill

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
    if (btn) btn.classList.add('active');
    const panel = document.getElementById('ws-panel-' + tab);
    if (panel) { panel.classList.add('active'); _pmLoadWsPanel(panel.id); }
};

// The redesigned workspace groups the six functional areas under four tabs.
function _pmLoadWsPanel(panelId) {
    switch(panelId) {
        case 'ws-panel-week':      _pmLoadWeekBuilder();                  break;
        case 'ws-panel-materials': _pmLoadProcItems();                    break;
        case 'ws-panel-progress':  _pmLoadMilestones(); _pmLoadReports(); break;
        case 'ws-panel-money':     _pmLoadPayments();   _pmLoadRevolving(); break;
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
        // Enrich each card with real progress / balance / cadence before rendering.
        await Promise.all(_pmProjects.map(_pmComputeProjectMetrics));
        _pmRenderProjectCards(_pmProjects);
    } catch(e) {
        grid.innerHTML = `<div class="pm-cards-empty">Error loading projects: ${_esc(e.message)}</div>`;
    }
}

// Compute card metrics (progress %, balance due, this Friday, cadence) from the
// project's milestones + payment requests. Mutates the project object with `_m`.
// Any failure falls back to safe zeros so one bad project never blanks the grid.
async function _pmComputeProjectMetrics(p) {
    const m = { progressPct: 0, balanceDue: 0, thisFriday: 0, cadence: 'ontrack' };
    p._m = m;
    try {
        const [msSnap, paySnap] = await Promise.all([
            db.collection('constructionProjects').doc(p.id).collection('milestones').get(),
            db.collection('paymentRequests').where('constructionProjectId', '==', p.id).get()
        ]);

        // Progress: weighted by `percentage` of completed milestones; fall back to count.
        const ms = msSnap.docs.map(d => d.data());
        if (ms.length) {
            const hasPct = ms.some(x => x.percentage != null && x.percentage !== '' && !isNaN(x.percentage));
            if (hasPct) {
                m.progressPct = ms.filter(x => x.status === 'completed')
                    .reduce((s, x) => s + (Number(x.percentage) || 0), 0);
            } else {
                const done = ms.filter(x => x.status === 'completed').length;
                m.progressPct = Math.round(done / ms.length * 100);
            }
            m.progressPct = Math.max(0, Math.min(100, Math.round(m.progressPct)));
        }

        // Balance + this Friday + cadence from payment requests (mirrors _pmPayUpdateKPIs).
        const reqs = paySnap.docs.map(d => d.data());
        const open = reqs.filter(r => r.status === 'unpaid' || r.status === 'partial');
        m.balanceDue = open.reduce((s, r) => s + ((r.totalAmount || r.amount || 0) - (r.amountPaid || 0)), 0);
        const next = open.slice().sort((a, b) => (a.weekEndingDate || '').localeCompare(b.weekEndingDate || ''))[0];
        m.thisFriday = next ? (next.totalAmount || next.amount || 0) : 0;

        const today = new Date().toISOString().slice(0, 10);
        if (reqs.some(r => r.status === 'partial')) m.cadence = 'partial';
        else if (open.some(r => r.status === 'unpaid' && r.weekEndingDate && r.weekEndingDate < today)) m.cadence = 'overdue';
        else m.cadence = 'ontrack';
    } catch(e) {
        console.warn('PM: metrics failed for', p.id, e.message);
    }
    return p;
}

function _pmRenderProjectCards(projects) {
    const grid = document.getElementById('pm-cards-grid');
    if (!grid) return;
    if (!projects.length) {
        grid.innerHTML = '<div class="pm-cards-empty"><div class="pm-cards-empty-icon">🏗️</div>No projects yet. Click <strong>Add Project</strong> to create your first one.</div>';
        return;
    }
    // Render uses data-pm-id on the card + data-pm-action on each button.
    // The previous version interpolated JSON.stringify(p) into inline onclick
    // handlers — that escaped " but NOT ' or backticks, so a client name like
    // "O'Brien" or a malicious "'); alert(1); //" would break out. Now the
    // full project object is fetched from _pmProjects at click-time via the
    // delegated handler below (attached once via _handlerAttached flag).
    const cadenceBadge = {
        ontrack:  '<span class="pm-badge pm-badge-paid">On track</span>',
        partial:  '<span class="pm-badge pm-badge-partial">Partial last week</span>',
        overdue:  '<span class="pm-badge pm-badge-strict">Overdue</span>',
    };
    grid.innerHTML = projects.map(p => {
        const m       = p._m || { progressPct: 0, balanceDue: 0, thisFriday: 0, cadence: 'ontrack' };
        const balCls  = m.balanceDue > 0 ? 'color:var(--pm-danger);' : '';
        return `<div class="pm-project-card" data-pm-id="${_esc(p.id)}">
          <div class="pm-card-top">
            <div class="pm-card-names">
              <div class="pm-card-client">${_esc(p.clientName||'Unnamed Client')}</div>
              <div class="pm-card-project">${_esc(p.projectName||'—')}${p.address ? ' · ' + _esc(p.address) : ''}</div>
            </div>
            <div class="pm-card-actions">
              <button class="pm-card-icon-btn" data-pm-action="edit" title="Edit"><i data-lucide="pencil" style="width:13px;height:13px;"></i></button>
              <button class="pm-card-icon-btn del" data-pm-action="delete" title="Delete"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
            </div>
          </div>
          <div class="pm-card-progress"><div class="pm-card-progress-fill" style="width:${m.progressPct}%;"></div></div>
          <div class="pm-card-progress-pct">${m.progressPct}% complete</div>
          <div class="pm-card-stats">
            <div class="pm-card-stat">
              <div class="pm-card-stat-label">Balance due</div>
              <div class="pm-card-stat-value num" style="${balCls}">${_fmt(m.balanceDue)}</div>
            </div>
            <div class="pm-card-stat">
              <div class="pm-card-stat-label">This Friday</div>
              <div class="pm-card-stat-value num">${_fmt(m.thisFriday)}</div>
            </div>
          </div>
          <div style="margin-top:13px;">${cadenceBadge[m.cadence] || cadenceBadge.ontrack}</div>
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
    // Fresh "This Week" draft for the newly opened project.
    _pmWeekDate = null; _pmWeekBills = []; _pmWeekEntries = []; _pmWeekEditingId = null;
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
    document.getElementById('pmProjectBudget').value     = '';
    document.getElementById('pmProjectEndDate').value    = '';
    document.getElementById('pmProjectFeePct').value     = '15';
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
    document.getElementById('pmProjectBudget').value     = (p.budget != null ? p.budget : '');
    document.getElementById('pmProjectEndDate').value    = p.plannedEndDate || '';
    document.getElementById('pmProjectFeePct').value     = (p.managementFeePct != null ? p.managementFeePct : 15);
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
    const budgetRaw  = document.getElementById('pmProjectBudget').value.trim();
    const budget     = budgetRaw === '' ? 0 : Number(budgetRaw);
    const plannedEndDate = document.getElementById('pmProjectEndDate').value || null;
    const feePctRaw  = document.getElementById('pmProjectFeePct').value.trim();
    let   managementFeePct = feePctRaw === '' ? 15 : Number(feePctRaw);
    if (isNaN(managementFeePct) || managementFeePct < 0) managementFeePct = 15;
    if (managementFeePct > 100) managementFeePct = 100;

    let valid = true;
    if (!clientName)  { _pmShowErr('err-pmProjectClientName','Client name is required.'); valid = false; }
    if (!projectName) { _pmShowErr('err-pmProjectName','Project name is required.');      valid = false; }
    if (!valid) return;

    const data = { clientName, projectName, clientEmail, status, startDate, address, budget, plannedEndDate, managementFeePct,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    // Detect a fee-rate change so we can re-bill unpaid weeks at the new rate.
    const existing  = projectId ? _pmProjects.find(p => p.id === projectId) : null;
    const oldFeePct = existing ? (existing.managementFeePct != null ? Number(existing.managementFeePct) : 15) : null;
    const feeChanged = projectId && oldFeePct !== managementFeePct;

    const btn = document.querySelector('#pmProjectModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (projectId) {
            await db.collection('constructionProjects').doc(projectId).update(data);
            // Keep the active-project copy in sync so This Week uses the new rate.
            if (_pmActiveProject && _pmActiveProject.id === projectId) _pmActiveProject.managementFeePct = managementFeePct;
            let reBilled = 0;
            if (feeChanged) {
                try { reBilled = await _pmRecomputeUnpaidBills(projectId, managementFeePct); }
                catch(e) { console.warn('PM: re-bill unpaid weeks failed', e.message); }
            }
            if (feeChanged && reBilled > 0) _pmToast(`Fee set to ${managementFeePct}% · re-billed ${reBilled} unpaid week${reBilled > 1 ? 's' : ''}`);
            else _pmToast('Project saved');
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('constructionProjects').add(data);
            _pmToast('Project created');
        }
        _pmProjects = [];
        pmCloseModal('pmProjectModal');
        _pmLoadProjectsList();
    } catch(e) {
        _pmToast('Save failed: ' + e.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Project';
        if (window.lucide) lucide.createIcons();
    }
};

// Re-bill a project's UNPAID weekly bills at a new management-fee rate.
// Skips anything already paid or partially paid (status Paid / Partial) so money
// already collected is never altered. Only writes columns that exist on weekly_bills
// (management_fee, grand_total). Returns the number of bills updated.
async function _pmRecomputeUnpaidBills(projectId, ratePct) {
    const rate = (Number(ratePct) || 0) / 100;
    const col  = db.collection('constructionProjects').doc(projectId).collection('weeklyBills');
    const snap = await col.get();
    const writes = [];
    snap.docs.forEach(d => {
        const b = d.data();
        if (b.status === 'Paid' || b.status === 'Partial') return;   // leave settled money alone
        const direct = (b.labor || 0) + (b.materials || 0);
        const fee    = direct * rate;
        const grand  = direct + fee;
        if (Math.round(b.managementFee || 0) === Math.round(fee) &&
            Math.round(b.grandTotal   || 0) === Math.round(grand)) return;   // already current
        writes.push(col.doc(d.id).update({
            managementFee: fee,
            grandTotal:    grand,
            updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
        }));
    });
    await Promise.all(writes);
    return writes.length;
}

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
    const fee   = (labor + materials) * (_pmFeePct()/100);
    const total = labor + materials + fee;
    const feeLabel = document.getElementById('pm-calc-fee-label');
    if (feeLabel) feeLabel.textContent = `Management Fee (${_pmFeePct()}%)`;
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

    const managementFee = (labor + materials) * (_pmFeePct()/100);
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
        _pmLoadWeekBuilder();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 1b. THIS WEEK — inline bill builder
//   Builds one weeklyBills doc per Friday from labor/materials
//   line entries. Sums into the existing labor/materials/fee/
//   grandTotal schema (+ a new `entries` array) so the partner
//   portal KPIs, Money tab and labor-invoice prefill keep
//   reading exactly what they read before.
// ══════════════════════════════════════════════════════════
const PM_FEE_PCT = 15;   // management fee — default; editable per project

// Active project's management fee %, falling back to the 15% default.
function _pmFeePct() {
    const v = _pmActiveProject && _pmActiveProject.managementFeePct;
    return (v == null || v === '' || isNaN(v)) ? PM_FEE_PCT : Number(v);
}

function _pmPeso(n) { return '₱' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
function _pmFriLabel(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-PH', { weekday:'short', month:'short', day:'numeric' });
}
function _pmShortDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-PH', { month:'short', day:'numeric' });
}
function _pmShiftDateStr(dateStr, days) {
    const d = new Date((dateStr || _nextFriday()) + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0,10);
}

async function _pmLoadWeekBuilder() {
    if (!_pmActiveProject) {
        _pmWeekBills = []; _pmWeekEntries = []; _pmWeekEditingId = null;
        _pmSet('pm-week-date', '—');
        _pmWeekRenderEntries(); _pmWeekRecompute();
        const hist = document.getElementById('pm-week-history');
        if (hist) hist.innerHTML = '<div class="pm-week-empty">Select a project first.</div>';
        return;
    }
    if (!_pmWeekDate) _pmWeekDate = _nextFriday();
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('weeklyBills')
            .orderBy('weekEndingDate', 'desc')
            .get();
        _pmWeekBills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.warn('PM week load:', e.message);
        _pmWeekBills = [];
    }
    _pmWeekSyncDraft();
    _pmWeekRenderHistory();
}

// Load the saved bill for the selected Friday into the draft (or start empty).
function _pmWeekSyncDraft() {
    const bill = _pmWeekBills.find(b => b.weekEndingDate === _pmWeekDate);
    if (bill) {
        _pmWeekEditingId = bill.id;
        if (Array.isArray(bill.entries) && bill.entries.length) {
            _pmWeekEntries = bill.entries.map(e => ({
                id: _pmUid('we_'),
                type: e.type === 'materials' ? 'materials' : 'labor',
                details: e.details || '',
                amount: Number(e.amount) || 0
            }));
        } else {
            // Legacy doc with only labor/materials totals — synthesize two lines.
            _pmWeekEntries = [];
            if (bill.labor)     _pmWeekEntries.push({ id:_pmUid('we_'), type:'labor',     details:'Labor total',     amount:Number(bill.labor)     });
            if (bill.materials) _pmWeekEntries.push({ id:_pmUid('we_'), type:'materials', details:'Materials total', amount:Number(bill.materials) });
        }
    } else {
        _pmWeekEditingId = null;
        _pmWeekEntries = [];
    }
    _pmSet('pm-week-date', _pmFriLabel(_pmWeekDate));
    const saveBtn = document.getElementById('pm-week-save-btn');
    if (saveBtn) saveBtn.textContent = _pmWeekEditingId ? "Update this week's bill" : 'Save & send to client →';
    _pmWeekRenderEntries();
    _pmWeekRecompute();
}

window.pmWeekShift = function(delta) {
    _pmWeekDate = _pmShiftDateStr(_pmWeekDate, delta * 7);
    _pmWeekSyncDraft();
};

window.pmWeekLoadBill = function(id) {
    const bill = _pmWeekBills.find(b => b.id === id);
    if (!bill) return;
    _pmWeekDate = bill.weekEndingDate || _pmWeekDate;
    _pmWeekSyncDraft();
};

window.pmWeekAddEntry = function() {
    const typeEl = document.getElementById('pm-week-type');
    const detEl  = document.getElementById('pm-week-details');
    const amtEl  = document.getElementById('pm-week-amount');
    const type   = typeEl && typeEl.value === 'materials' ? 'materials' : 'labor';
    const details= (detEl ? detEl.value : '').trim();
    const amount = amtEl ? (parseInt(String(amtEl.value).replace(/[^0-9]/g,''), 10) || 0) : 0;
    if (amount <= 0) { if (amtEl) amtEl.focus(); return; }
    _pmWeekEntries.push({ id:_pmUid('we_'), type, details: details || (type==='labor' ? 'Labor cost' : 'Materials'), amount });
    if (detEl) detEl.value = '';
    if (amtEl) amtEl.value = '';
    _pmWeekRenderEntries();
    _pmWeekRecompute();
    if (detEl) detEl.focus();
};

window.pmWeekRemoveEntry = function(id) {
    _pmWeekEntries = _pmWeekEntries.filter(e => e.id !== id);
    _pmWeekRenderEntries();
    _pmWeekRecompute();
};

function _pmWeekRenderEntries() {
    const host = document.getElementById('pm-week-entries');
    if (!host) return;
    if (!_pmWeekEntries.length) {
        host.innerHTML = '<div class="pm-week-empty">No entries yet — add labor or materials above.</div>';
        return;
    }
    host.innerHTML = _pmWeekEntries.map(e => {
        const tag = e.type === 'materials'
            ? '<span class="pm-week-entry-tag mat">Material</span>'
            : '<span class="pm-week-entry-tag labor">Labor</span>';
        return `<div class="pm-week-entry">
            ${tag}
            <span class="pm-week-entry-details">${_esc(e.details)}</span>
            <span class="pm-week-entry-amt num">${_pmPeso(e.amount)}</span>
            <button class="pm-week-entry-del" aria-label="Remove" onclick="pmWeekRemoveEntry('${e.id}')">×</button>
        </div>`;
    }).join('');
}

function _pmWeekTotals() {
    const labor = _pmWeekEntries.filter(e=>e.type==='labor').reduce((s,e)=>s+e.amount,0);
    const mats  = _pmWeekEntries.filter(e=>e.type==='materials').reduce((s,e)=>s+e.amount,0);
    const direct = labor + mats;
    const fee = direct * (_pmFeePct()/100);
    return { labor, mats, direct, fee, grand: direct + fee };
}

function _pmWeekRecompute() {
    const t = _pmWeekTotals();
    _pmSet('pm-week-labor',     _pmPeso(t.labor));
    _pmSet('pm-week-materials', _pmPeso(t.mats));
    _pmSet('pm-week-direct',    _pmPeso(t.direct));
    _pmSet('pm-week-fee-amt',   _pmPeso(t.fee));
    _pmSet('pm-week-grand',     _pmPeso(t.grand));
    // Show the active project's fee rate (read-only — set in Add/Edit Project).
    _pmSet('pm-week-fee-pct', _pmFeePct());
}

function _pmWeekRenderHistory() {
    const host = document.getElementById('pm-week-history');
    if (!host) return;
    const bills = _pmWeekBills.slice().sort((a,b) => (b.weekEndingDate||'').localeCompare(a.weekEndingDate||''));
    if (!bills.length) {
        host.innerHTML = '<div class="pm-week-empty">No past weeks yet.</div>';
        return;
    }
    const badge = (st) => st === 'Paid'
        ? '<span class="pm-badge pm-badge-paid">Paid</span>'
        : st === 'Partial'
        ? '<span class="pm-badge pm-badge-partial">Partial</span>'
        : '<span class="pm-badge pm-badge-unpaid">Submitted</span>';
    host.innerHTML = bills.map(b => `
        <div class="pm-past-row" onclick="pmWeekLoadBill('${_esc(b.id)}')">
          <div>
            <div class="pm-past-date">${_pmShortDate(b.weekEndingDate)}</div>
            <div class="pm-past-amt num">${_pmPeso(b.grandTotal || 0)}</div>
          </div>
          ${badge(b.status)}
        </div>`).join('');
}

window.pmWeekSave = async function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    if (!_pmWeekEntries.length) { alert('Add at least one labor or materials line first.'); return; }
    const t = _pmWeekTotals();
    const data = {
        weekEndingDate: _pmWeekDate,
        labor: t.labor,
        materials: t.mats,
        managementFee: t.fee,
        grandTotal: t.grand,
        entries: _pmWeekEntries.map(e => ({ type:e.type, details:e.details, amount:e.amount })),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const btn = document.getElementById('pm-week-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('weeklyBills');
        if (_pmWeekEditingId) {
            await col.doc(_pmWeekEditingId).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            data.status = 'Submitted';
            await col.add(data);
        }
        const wasEdit = !!_pmWeekEditingId;
        await _pmLoadWeekBuilder();
        _pmToast(wasEdit ? 'Weekly bill updated' : 'Weekly bill saved & sent to client');
    } catch(e) {
        _pmToast('Save failed: ' + e.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
};

// Minimalist toast — white card, thin accent, soft shadow (matches the PM design).
function _pmToast(msg, isError = false) {
    const color = isError ? 'var(--pm-danger, #b4453a)' : 'var(--pm-green, #157a52)';
    const t = document.createElement('div');
    t.className = 'pm-toast';
    t.innerHTML = `<span style="color:${color};font-weight:700;">${isError ? '✕' : '✓'}</span><span>${_esc(msg)}</span>`;
    t.style.borderLeftColor = isError ? '#b4453a' : '#157a52';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 220); }, 2400);
}

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
        _pmProcApplyFilters();
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

// Combine the status pill (all/pending/bought) with the free-text search.
function _pmProcApplyFilters() {
    const q = (document.getElementById('pm-proc-search')?.value || '').toLowerCase();
    const pendingSet = ['Pending','Assigned to Client','Assigned to Admin'];
    const boughtSet  = ['Bought by Company','Bought by Client'];
    const rows = _pmProcItems.filter(it => {
        if (_pmProcFilter === 'pending' && !pendingSet.includes(it.status)) return false;
        if (_pmProcFilter === 'bought'  && !boughtSet.includes(it.status))  return false;
        return (it.item || '').toLowerCase().includes(q);
    });
    _pmProcRenderTable(rows);
}
window.pmProcFilter = function() { _pmProcApplyFilters(); };
window.pmProcSetFilter = function(f, btn) {
    _pmProcFilter = f;
    document.querySelectorAll('#ws-panel-materials .pm-filter-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _pmProcApplyFilters();
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
// 2b. MILESTONES
//   Writes constructionProjects/{id}/milestones — the exact
//   subcollection the partner portal reads for its Project
//   Completion KPI (status==='completed' ÷ total).
// ══════════════════════════════════════════════════════════

async function _pmLoadMilestones() {
    const tbody = document.getElementById('pm-ms-tbody');
    if (!tbody) return;
    if (!_pmActiveProject) {
        tbody.innerHTML = '<tr><td colspan="6" class="pm-empty-row">Select a client project above.</td></tr>';
        _pmMsUpdateStats([]);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="6" class="pm-empty-row" style="color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('milestones')
            .orderBy('order','asc')
            .get();
        _pmMilestones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmMsRenderTable(_pmMilestones);
        _pmMsUpdateStats(_pmMilestones);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-row">Error: ${_esc(e.message)}</td></tr>`;
    }
}

function _pmMsUpdateStats(items) {
    _pmSet('pm-ms-completed', items.filter(m => m.status === 'completed').length);
    _pmSet('pm-ms-progress',  items.filter(m => m.status === 'in_progress').length);
    _pmSet('pm-ms-pending',   items.filter(m => !m.status || m.status === 'pending').length);
    _pmSet('pm-ms-total',     items.length);
}

function _pmMsRenderTable(items) {
    const tbody = document.getElementById('pm-ms-tbody');
    if (!tbody) return;
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="pm-empty-row">No milestones yet. Click "Add Milestone" to define the project phases.</td></tr>';
        return;
    }
    const badgeClass = {
        completed:   'pm-badge pm-badge-paid',
        in_progress: 'pm-badge pm-badge-partial',
        pending:     'pm-badge pm-badge-pending'
    };
    const statusLabel = { completed:'Completed', in_progress:'In Progress', pending:'Pending' };

    tbody.innerHTML = items.map(m => {
        const st = m.status || 'pending';
        const bc = badgeClass[st] || 'pm-badge pm-badge-pending';
        const completeBtn = st !== 'completed'
            ? `<button class="pm-tbl-btn pm-tbl-btn-buy" data-pm-action="complete"><i data-lucide="check" style="width:12px;height:12px;"></i> Mark Done</button>`
            : '';
        return `<tr data-pm-id="${_esc(m.id)}">
            <td style="color:#6b7280;white-space:nowrap;">Phase ${_esc(String(m.order || '—'))}</td>
            <td><strong>${_esc(m.name||'—')}</strong>${m.description ? `<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">${_esc(m.description)}</div>`:''}</td>
            <td style="color:#374151;white-space:nowrap;">${_esc(m.plannedDate||'—')}</td>
            <td style="font-weight:600;">${m.percentage != null && m.percentage !== '' ? _esc(String(m.percentage)) + '%' : '—'}</td>
            <td><span class="${bc}">${_esc(statusLabel[st]||'Pending')}</span></td>
            <td>
                ${completeBtn}
                <button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i></button>
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
            const m   = _pmMilestones.find(x => x.id === tr.getAttribute('data-pm-id'));
            if (!m) return;
            switch (btn.getAttribute('data-pm-action')) {
                case 'complete': pmCompleteMilestone(m.id); break;
                case 'edit':     pmEditMilestone(m); break;
                case 'delete':   pmDeleteMilestone(m.id); break;
            }
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmOpenMilestoneModal = function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    document.getElementById('pmMilestoneTitle').textContent = 'Add Milestone';
    document.getElementById('pmMilestoneId').value     = '';
    document.getElementById('pmMilestoneName').value   = '';
    document.getElementById('pmMilestoneOrder').value  = (_pmMilestones.length + 1);
    document.getElementById('pmMilestonePct').value    = '';
    document.getElementById('pmMilestoneStatus').value = 'pending';
    document.getElementById('pmMilestoneDate').value   = '';
    document.getElementById('pmMilestoneDesc').value   = '';
    ['err-pmMilestoneName','err-pmMilestoneOrder'].forEach(_pmClearErr);
    document.getElementById('pmMilestoneModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditMilestone = function(m) {
    document.getElementById('pmMilestoneTitle').textContent = 'Edit Milestone';
    document.getElementById('pmMilestoneId').value     = m.id;
    document.getElementById('pmMilestoneName').value   = m.name || '';
    document.getElementById('pmMilestoneOrder').value  = (m.order != null ? m.order : '');
    document.getElementById('pmMilestonePct').value    = (m.percentage != null ? m.percentage : '');
    document.getElementById('pmMilestoneStatus').value = m.status || 'pending';
    document.getElementById('pmMilestoneDate').value   = m.plannedDate || '';
    document.getElementById('pmMilestoneDesc').value   = m.description || '';
    ['err-pmMilestoneName','err-pmMilestoneOrder'].forEach(_pmClearErr);
    document.getElementById('pmMilestoneModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveMilestone = async function() {
    const id     = document.getElementById('pmMilestoneId').value;
    const name   = document.getElementById('pmMilestoneName').value.trim();
    const orderV = document.getElementById('pmMilestoneOrder').value.trim();
    const pctRaw = document.getElementById('pmMilestonePct').value.trim();
    const status = document.getElementById('pmMilestoneStatus').value;
    const date   = document.getElementById('pmMilestoneDate').value;
    const desc   = document.getElementById('pmMilestoneDesc').value.trim();

    let valid = true;
    if (!name)   { _pmShowErr('err-pmMilestoneName','Milestone name is required.'); valid = false; }
    if (!orderV) { _pmShowErr('err-pmMilestoneOrder','Phase / order is required.'); valid = false; }
    if (!valid) return;

    const data = {
        name,
        order: Number(orderV),
        percentage: pctRaw === '' ? 0 : Number(pctRaw),
        status,
        plannedDate: date || null,
        description: desc,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const btn = document.querySelector('#pmMilestoneModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('milestones');
        if (id) {
            await col.doc(id).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await col.add(data);
        }
        pmCloseModal('pmMilestoneModal');
        _pmLoadMilestones();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Milestone';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmCompleteMilestone = async function(id) {
    if (!_pmActiveProject) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('milestones').doc(id)
            .update({ status: 'completed', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        _pmLoadMilestones();
    } catch(e) { alert('Update failed: ' + e.message); }
};

window.pmDeleteMilestone = async function(id) {
    if (!confirm('Delete this milestone?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('milestones').doc(id).delete();
        _pmLoadMilestones();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 2c. ACCOMPLISHMENT REPORTS — self-contained BOQ-style builder
//   A copy of the BOQ's design + workflow (cost items → sub-items
//   → line items, each with % completion + live totals), but its
//   own feature with its own data stored under the construction
//   project (constructionProjects/{id}/accomplishmentReports).
//   A report's overall % (accomplishment ÷ grand total) feeds the
//   partner portal's Schedule Performance KPI.
// ══════════════════════════════════════════════════════════

let _pmRpDoc = null;   // the report currently open in the builder

// ── BOQ progress math (mirrors boq-module's stateless helpers) ──
function _pmNum(v) { return Number(String(v == null ? '' : v).replace(/,/g,'')) || 0; }
function _pmLiTotal(li) { return _pmNum(li.qty) * (_pmNum(li.materialRate) + _pmNum(li.laborRate)); }
function _pmLiAcc(li)   { return _pmLiTotal(li) * (_pmNum(li.percentCompletion) / 100); }
function _pmBoqGrand(costItems) {
    return (costItems || []).reduce((s, ci) =>
        s + (ci.subItems || []).reduce((s2, si) =>
            s2 + (si.lineItems || []).reduce((s3, li) => s3 + _pmLiTotal(li), 0), 0), 0);
}
function _pmBoqAcc(costItems) {
    return (costItems || []).reduce((s, ci) =>
        s + (ci.subItems || []).reduce((s2, si) =>
            s2 + (si.lineItems || []).reduce((s3, li) => s3 + _pmLiAcc(li), 0), 0), 0);
}
function _pmBoqPct(doc) {
    const grand = _pmBoqGrand(doc.costItems);
    if (grand <= 0) return 0;
    return Math.round((_pmBoqAcc(doc.costItems) / grand) * 100);
}
function _pmCiSub(ci) { return (ci.subItems || []).reduce((s, si) => s + (si.lineItems || []).reduce((s2, li) => s2 + _pmLiTotal(li), 0), 0); }
function _pmCiAcc(ci) { return (ci.subItems || []).reduce((s, si) => s + (si.lineItems || []).reduce((s2, li) => s2 + _pmLiAcc(li), 0), 0); }

function _pmTsDateStr(ts) {
    const ms = ts && ts.toMillis ? ts.toMillis() : (ts ? new Date(ts).getTime() : 0);
    if (!ms || isNaN(ms)) return '—';
    return new Date(ms).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
}
function _pmUid(p) { return p + Math.random().toString(36).slice(2, 9); }

// ── List view ──────────────────────────────────────────────
function _pmRpShowList()    { const l=document.getElementById('pm-rp-list'), b=document.getElementById('pm-rp-builder'); if(l)l.style.display=''; if(b){b.style.display='none'; b.innerHTML='';} }
function _pmRpShowBuilder() { const l=document.getElementById('pm-rp-list'), b=document.getElementById('pm-rp-builder'); if(l)l.style.display='none'; if(b)b.style.display=''; }

async function _pmLoadReports() {
    _pmRpShowList();
    const wrap = document.getElementById('pm-rp-cards');
    if (!wrap) return;
    if (!_pmActiveProject) {
        wrap.innerHTML = '<div class="pm-empty-row" style="color:#9ca3af;">Select a client project above.</div>';
        _pmSet('pm-rp-count', 0); _pmSet('pm-rp-latest', '0%');
        return;
    }
    wrap.innerHTML = '<div class="pm-empty-row" style="color:#9ca3af;">Loading…</div>';
    try {
        const snap = await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('accomplishmentReports').orderBy('updatedAt','desc').get();
        _pmReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmRpRenderCards(_pmReports);
        _pmRpStats(_pmReports);
    } catch(e) {
        wrap.innerHTML = `<div class="pm-empty-row">Error: ${_esc(e.message)}</div>`;
    }
}

function _pmRpStats(items) {
    _pmSet('pm-rp-count', items.length);
    _pmSet('pm-rp-approved', items.filter(r => r.status === 'approved').length);
    const latest = items[0]; // newest-first
    _pmSet('pm-rp-latest', (latest ? _pmBoqPct(latest) : 0) + '%');
    _pmSet('pm-rp-cost',   _fmt(latest ? _pmBoqGrand(latest.costItems) : 0));
}

function _pmRpRenderCards(items) {
    const wrap = document.getElementById('pm-rp-cards');
    if (!wrap) return;
    if (!items.length) {
        wrap.innerHTML = '<div class="pm-empty-row" style="grid-column:1/-1;text-align:center;color:#9ca3af;">No accomplishment report yet. Click "New Report" to create one.</div>';
        return;
    }
    wrap.innerHTML = items.map(d => {
        const grand = _pmBoqGrand(d.costItems);
        const acc   = _pmBoqAcc(d.costItems);
        const pct   = _pmBoqPct(d);
        const subject = d.subject || d.projectName || 'Accomplishment Report';
        const statusBadge = d.status === 'approved'
            ? '<span class="boq-status-badge boq-status-saved">Approved</span>'
            : '<span class="boq-status-badge boq-status-new">Draft</span>';
        return `
        <div class="ov-folder-card boq-proj-card" data-pm-id="${_esc(d.id)}" style="cursor:pointer;">
            <div class="ov-folder-card__title-row">
                <div class="ov-folder-card__name">${_esc(subject)}</div>
                ${statusBadge}
            </div>
            <div class="ov-folder-card__desc">${_esc(d.date || '')}</div>
            <div class="ov-folder-card__stat-list" style="margin-top:0.9rem;">
                <div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Total Project Cost</span><span class="ov-folder-card__stat-value">${_fmt(grand)}</span></div>
                <div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Total Accomplishment</span><span class="ov-folder-card__stat-value ov-folder-card__stat-value--positive">${_fmt(acc)}</span></div>
                <div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Progress</span><span class="ov-folder-card__stat-value">${pct}%</span></div>
                <div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Last Updated</span><span class="ov-folder-card__stat-value">${_pmTsDateStr(d.updatedAt)}</span></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:1.1rem;">
                <button class="ov-folder-card__view-btn" data-pm-action="open" style="flex:1;">Open Report &rarr;</button>
                <button class="pm-tbl-btn pm-tbl-btn-delete" data-pm-action="delete" title="Delete"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
            </div>
        </div>`;
    }).join('');
    if (!wrap._handlerAttached) {
        wrap._handlerAttached = true;
        wrap.addEventListener('click', ev => {
            const btn  = ev.target.closest('[data-pm-action]');
            const card = ev.target.closest('[data-pm-id]');
            if (!card) return;
            const id = card.getAttribute('data-pm-id');
            const action = btn ? btn.getAttribute('data-pm-action') : 'open';
            if (action === 'delete') pmRpDelete(id);
            else pmRpOpen(id);
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmRpDelete = async function(id) {
    if (!confirm('Delete this accomplishment report?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('accomplishmentReports').doc(id).delete();
        _pmLoadReports();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ── Builder ────────────────────────────────────────────────
window.pmRpNew = function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    _pmRpDoc = {
        id: null,
        date: new Date().toISOString().slice(0,10),
        projectName: _pmActiveProject.projectName || '',
        area: '', ownerName: _pmActiveProject.clientName || '', location: _pmActiveProject.address || '',
        subject: 'Accomplishment Report',
        status: 'draft',
        costItems: []
    };
    _pmRpRenderBuilder();
};

window.pmRpOpen = function(id) {
    const d = _pmReports.find(r => r.id === id);
    if (!d) return;
    // Deep clone so edits aren't applied to the list copy until saved.
    _pmRpDoc = JSON.parse(JSON.stringify({
        id: d.id,
        date: d.date || '', projectName: d.projectName || '', area: d.area || '',
        ownerName: d.ownerName || '', location: d.location || '', subject: d.subject || 'Accomplishment Report',
        status: d.status || 'draft',
        costItems: d.costItems || []
    }));
    _pmRpRenderBuilder();
};

function _pmRpRenderBuilder() {
    const root = document.getElementById('pm-rp-builder');
    if (!root || !_pmRpDoc) return;
    _pmRpShowBuilder();
    const d = _pmRpDoc;
    const isSaved = !!d.id;
    root.innerHTML = `
    <div class="boq-builder">
      <div class="boq-toolbar">
        <div class="boq-toolbar-left">
          <button class="boq-back-btn" onclick="pmRpBack()"><i data-lucide="arrow-left"></i> Reports</button>
          <span class="boq-breadcrumb-sep">/</span>
          <h3 class="boq-project-title">${_esc(d.projectName || 'Accomplishment Report')}</h3>
          <span class="boq-badge ${isSaved ? 'boq-badge-saved' : 'boq-badge-new'}">${isSaved ? 'Saved' : 'New'}</span>
        </div>
        <div class="boq-toolbar-right">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;">
            Status
            <select id="rp-status" class="pm-select" style="width:auto;">
              <option value="draft" ${d.status!=='approved'?'selected':''}>Draft</option>
              <option value="approved" ${d.status==='approved'?'selected':''}>Approved (visible to partner)</option>
            </select>
          </label>
          <button class="pm-btn pm-btn-primary" onclick="pmRpSave()"><i data-lucide="save" style="width:14px;height:14px;"></i> Save Report</button>
        </div>
      </div>

      <div class="boq-header-form">
        <div class="boq-section-title">Document Info</div>
        <div class="boq-form-grid">
          <div class="boq-form-group"><label>Date</label><input type="date" id="rp-date" value="${_esc(d.date)}"></div>
          <div class="boq-form-group"><label>Project Name</label><input type="text" id="rp-projectName" value="${_esc(d.projectName)}" placeholder="Project name"></div>
          <div class="boq-form-group"><label>Area (sqm)</label><input type="text" id="rp-area" value="${_esc(d.area)}" placeholder="e.g. 120"></div>
          <div class="boq-form-group"><label>Owner Name</label><input type="text" id="rp-ownerName" value="${_esc(d.ownerName)}" placeholder="Owner / client"></div>
          <div class="boq-form-group"><label>Location</label><input type="text" id="rp-location" value="${_esc(d.location)}" placeholder="Project location"></div>
          <div class="boq-form-group"><label>Subject</label><input type="text" id="rp-subject" value="${_esc(d.subject)}" placeholder="Subject"></div>
        </div>
      </div>

      <div id="rp-costitems">${_pmRpCostItemsHtml(d)}</div>

      <div style="margin-top:14px;">
        <button class="pm-btn pm-btn-secondary" onclick="pmRpAddCost()"><i data-lucide="plus" style="width:14px;height:14px;"></i> Add Cost Item</button>
      </div>

      <div class="pm-kpi-row" style="margin-top:18px;">
        <div class="pm-kpi-card"><div class="pm-kpi-body"><div class="pm-kpi-label">Total Project Cost</div><div class="pm-kpi-value" id="rp-grand">₱0.00</div></div></div>
        <div class="pm-kpi-card"><div class="pm-kpi-body"><div class="pm-kpi-label">Total Accomplishment</div><div class="pm-kpi-value" id="rp-acc">₱0.00</div></div></div>
        <div class="pm-kpi-card pm-kpi-total"><div class="pm-kpi-body"><div class="pm-kpi-label">Overall Progress</div><div class="pm-kpi-value" id="rp-pct">0%</div></div></div>
      </div>
    </div>`;
    _pmRpRefreshTotals();
    if (window.lucide) lucide.createIcons();
}

function _pmRpCostItemsHtml(d) {
    if (!d.costItems.length) {
        return '<div class="pm-empty-row" style="color:#9ca3af;border:1px dashed #e5e7eb;border-radius:10px;margin-top:14px;">No cost items yet. Click "Add Cost Item" to start building the report.</div>';
    }
    return d.costItems.map((ci, ciIdx) => `
      <div class="boq-cost-item" style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin-top:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <strong style="color:#6b7280;white-space:nowrap;">${ciIdx + 1}.</strong>
          <input type="text" class="pm-input" style="font-weight:600;" placeholder="Cost item name (e.g. Civil Works)" value="${_esc(ci.name || '')}" oninput="pmRpSet('ci','${ci.id}','name',this.value)">
          <button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmRpDelCost('${ci.id}')" title="Remove cost item"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
        </div>
        ${(ci.subItems || []).map(si => `
          <div style="margin:8px 0 8px 18px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <input type="text" class="pm-input" style="font-size:13px;" placeholder="Sub-item name (e.g. Earthworks)" value="${_esc(si.name || '')}" oninput="pmRpSet('si','${si.id}','name',this.value)">
              <button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmRpDelSub('${ci.id}','${si.id}')" title="Remove sub-item"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
            </div>
            <div class="pm-table-wrap">
              <table class="pm-table">
                <thead><tr><th>Description</th><th>Unit</th><th>Qty</th><th>Material Rate</th><th>Labor Rate</th><th>Total</th><th>% Done</th><th>Accomplishment</th><th></th></tr></thead>
                <tbody>
                  ${(si.lineItems || []).map(li => `
                    <tr>
                      <td><input type="text" class="pm-input" value="${_esc(li.description || '')}" placeholder="Description" oninput="pmRpSet('li','${li.id}','description',this.value)"></td>
                      <td><input type="text" class="pm-input" style="width:64px;" value="${_esc(li.unit || '')}" placeholder="unit" oninput="pmRpSet('li','${li.id}','unit',this.value)"></td>
                      <td><input type="number" class="pm-input" style="width:72px;" value="${_esc(li.qty != null ? li.qty : '')}" min="0" step="any" oninput="pmRpSet('li','${li.id}','qty',this.value)"></td>
                      <td><input type="number" class="pm-input" style="width:96px;" value="${_esc(li.materialRate != null ? li.materialRate : '')}" min="0" step="any" oninput="pmRpSet('li','${li.id}','materialRate',this.value)"></td>
                      <td><input type="number" class="pm-input" style="width:96px;" value="${_esc(li.laborRate != null ? li.laborRate : '')}" min="0" step="any" oninput="pmRpSet('li','${li.id}','laborRate',this.value)"></td>
                      <td style="white-space:nowrap;font-weight:600;" id="rp-li-total-${li.id}">₱0.00</td>
                      <td><input type="number" class="pm-input" style="width:64px;" value="${_esc(li.percentCompletion != null ? li.percentCompletion : '')}" min="0" max="100" step="any" oninput="pmRpSet('li','${li.id}','percentCompletion',this.value)"></td>
                      <td style="white-space:nowrap;font-weight:600;color:#059669;" id="rp-li-acc-${li.id}">₱0.00</td>
                      <td><button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmRpDelLine('${ci.id}','${si.id}','${li.id}')"><i data-lucide="x" style="width:12px;height:12px;"></i></button></td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <button class="pm-btn pm-btn-secondary" style="margin-top:6px;" onclick="pmRpAddLine('${ci.id}','${si.id}')"><i data-lucide="plus" style="width:13px;height:13px;"></i> Add Line</button>
          </div>
        `).join('')}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;margin-left:18px;">
          <button class="pm-btn pm-btn-secondary" onclick="pmRpAddSub('${ci.id}')"><i data-lucide="plus" style="width:13px;height:13px;"></i> Add Sub-item</button>
          <div style="font-size:13px;color:#374151;">Subtotal: <strong id="rp-ci-sub-${ci.id}">₱0.00</strong> · Accomplished: <strong id="rp-ci-acc-${ci.id}" style="color:#059669;">₱0.00</strong></div>
        </div>
      </div>`).join('');
}

// ── Model lookups + mutations ──────────────────────────────
function _pmRpFindCost(id) { return _pmRpDoc.costItems.find(ci => ci.id === id); }
function _pmRpFindSub(id)  { for (const ci of _pmRpDoc.costItems) { const si = (ci.subItems||[]).find(s => s.id === id); if (si) return si; } return null; }
function _pmRpFindLine(id) { for (const ci of _pmRpDoc.costItems) for (const si of (ci.subItems||[])) { const li = (si.lineItems||[]).find(l => l.id === id); if (li) return li; } return null; }

window.pmRpSet = function(kind, id, field, value) {
    const obj = kind === 'ci' ? _pmRpFindCost(id) : kind === 'si' ? _pmRpFindSub(id) : _pmRpFindLine(id);
    if (!obj) return;
    obj[field] = value;
    // Numeric fields affect totals — refresh without re-rendering (keeps focus).
    if (kind === 'li' && ['qty','materialRate','laborRate','percentCompletion'].includes(field)) _pmRpRefreshTotals();
};

window.pmRpAddCost = function() { _pmRpDoc.costItems.push({ id: _pmUid('ci_'), name: '', subItems: [] }); _pmRpRerenderItems(); };
window.pmRpDelCost = function(id) { _pmRpDoc.costItems = _pmRpDoc.costItems.filter(ci => ci.id !== id); _pmRpRerenderItems(); };
window.pmRpAddSub = function(ciId) { const ci = _pmRpFindCost(ciId); if (!ci) return; (ci.subItems = ci.subItems || []).push({ id: _pmUid('si_'), name: '', lineItems: [] }); _pmRpRerenderItems(); };
window.pmRpDelSub = function(ciId, siId) { const ci = _pmRpFindCost(ciId); if (!ci) return; ci.subItems = (ci.subItems||[]).filter(si => si.id !== siId); _pmRpRerenderItems(); };
window.pmRpAddLine = function(ciId, siId) { const si = _pmRpFindSub(siId); if (!si) return; (si.lineItems = si.lineItems || []).push({ id: _pmUid('li_'), description: '', unit: '', qty: '', materialRate: '', laborRate: '', percentCompletion: '' }); _pmRpRerenderItems(); };
window.pmRpDelLine = function(ciId, siId, liId) { const si = _pmRpFindSub(siId); if (!si) return; si.lineItems = (si.lineItems||[]).filter(li => li.id !== liId); _pmRpRerenderItems(); };

// Re-render just the cost-items area (preserves header input values in the DOM).
function _pmRpRerenderItems() {
    _pmRpSyncHeaderFromDom();
    const host = document.getElementById('rp-costitems');
    if (host) host.innerHTML = _pmRpCostItemsHtml(_pmRpDoc);
    _pmRpRefreshTotals();
    if (window.lucide) lucide.createIcons();
}

function _pmRpRefreshTotals() {
    const d = _pmRpDoc;
    d.costItems.forEach(ci => {
        (ci.subItems||[]).forEach(si => (si.lineItems||[]).forEach(li => {
            _pmSet('rp-li-total-' + li.id, _fmt(_pmLiTotal(li)));
            _pmSet('rp-li-acc-' + li.id,   _fmt(_pmLiAcc(li)));
        }));
        _pmSet('rp-ci-sub-' + ci.id, _fmt(_pmCiSub(ci)));
        _pmSet('rp-ci-acc-' + ci.id, _fmt(_pmCiAcc(ci)));
    });
    _pmSet('rp-grand', _fmt(_pmBoqGrand(d.costItems)));
    _pmSet('rp-acc',   _fmt(_pmBoqAcc(d.costItems)));
    _pmSet('rp-pct',   _pmBoqPct(d) + '%');
}

function _pmRpSyncHeaderFromDom() {
    const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    const d = _pmRpDoc;
    if (g('rp-date')        !== undefined) d.date        = g('rp-date');
    if (g('rp-projectName') !== undefined) d.projectName = g('rp-projectName');
    if (g('rp-area')        !== undefined) d.area        = g('rp-area');
    if (g('rp-ownerName')   !== undefined) d.ownerName   = g('rp-ownerName');
    if (g('rp-location')    !== undefined) d.location    = g('rp-location');
    if (g('rp-subject')     !== undefined) d.subject     = g('rp-subject');
    if (g('rp-status')      !== undefined) d.status      = g('rp-status');
}

window.pmRpBack = function() {
    if (_pmRpDoc) { _pmRpSyncHeaderFromDom(); }
    _pmRpDoc = null;
    _pmLoadReports();
};

window.pmRpSave = async function() {
    if (!_pmActiveProject || !_pmRpDoc) return;
    _pmRpSyncHeaderFromDom();
    const d = _pmRpDoc;
    const adminEmail = (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'DACS Admin';
    const payload = {
        date: d.date || '', projectName: d.projectName || '', area: d.area || '',
        ownerName: d.ownerName || '', location: d.location || '', subject: d.subject || 'Accomplishment Report',
        status: d.status || 'draft',
        costItems: d.costItems || [],
        // Cached overall progress so the partner KPI / list don't have to recompute.
        progressPercentage: _pmBoqPct(d),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (d.status === 'approved') { payload.approvedBy = adminEmail; payload.approvedAt = firebase.firestore.FieldValue.serverTimestamp(); }

    const btn = document.querySelector('#pm-rp-builder .pm-btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('accomplishmentReports');
        if (d.id) {
            await col.doc(d.id).update(payload);
        } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await col.add(payload);
            d.id = ref.id;
        }
        _pmRpDoc = null;
        _pmLoadReports();
    } catch(e) {
        alert('Save failed: ' + e.message);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Report'; if (window.lucide) lucide.createIcons(); }
    }
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
    // Approved client self-payments ('verified') count toward Total Paid even if
    // amount_paid wasn't backfilled, using the client-entered paidAmount/totalAmount.
    const paid = reqs.reduce((s,r) => {
        if (r.status === 'verified') return s + (r.amountPaid || r.paidAmount || r.totalAmount || 0);
        return s + (r.amountPaid || 0);
    }, 0);
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
        paid:     '<span class="pm-badge pm-badge-paid">Paid</span>',
        verified: '<span class="pm-badge pm-badge-paid">Paid</span>',
        partial:  '<span class="pm-badge pm-badge-partial">Partial</span>',
        unpaid:   '<span class="pm-badge pm-badge-unpaid">Unpaid</span>',
        submitted:'<span class="pm-badge pm-badge-partial">Pending review</span>',
        rejected: '<span class="pm-badge pm-badge-unpaid">Rejected</span>',
    };
    tbody.innerHTML = reqs.map(r => {
        const isSelfPay = r.source === 'self_payment';
        const dateStr = r.weekEndingDate ? new Date(r.weekEndingDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
        const carry   = r.carryover ? _fmt(r.carryover) : '₱0';
        const total   = _fmt(r.totalAmount || ((r.amount||0)+(r.carryover||0)));
        const badge   = statusBadge[r.status] || `<span class="pm-badge pm-badge-unpaid">${_esc(r.status||'—')}</span>`;
        // Self-payments are client-initiated and stand-alone — the "Strict" concept
        // (admin-issued weekly bills) doesn't apply, so flag them instead.
        const strictBadge = isSelfPay
            ? '<span class="pm-badge pm-badge-partial">Client paid</span>'
            : (r.strict
                ? '<span class="pm-badge pm-badge-strict">Strict</span>'
                : '<span style="color:#9ca3af;font-size:12px;">—</span>');
        // Self-pay rows get a Review action (see receipt → approve/reject); admin-issued
        // bills keep Edit + Strict.
        const actions = isSelfPay
            ? `<button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="review"><i data-lucide="receipt" style="width:12px;height:12px;"></i> ${r.status === 'submitted' ? 'Review' : 'View'}</button>`
            : `<button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i> Edit</button>
               <button class="pm-tbl-btn ${r.strict ? 'pm-tbl-btn-delete' : 'pm-tbl-btn-strict'}" data-pm-action="toggle-strict">
                 <i data-lucide="${r.strict ? 'unlock' : 'lock'}" style="width:12px;height:12px;"></i> ${r.strict ? 'Unstrict' : 'Strict'}
               </button>`;

        return `<tr data-pm-id="${_esc(r.id)}">
            <td><strong>${_esc(dateStr)}</strong>${isSelfPay ? '<div style="font-size:11px;color:#6b7280;">Self payment</div>' : ''}</td>
            <td>${_fmt(r.amount)}</td>
            <td>${carry}</td>
            <td><strong>${total}</strong></td>
            <td>${strictBadge}</td>
            <td>${badge}</td>
            <td>${actions}</td>
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
            if (btn.getAttribute('data-pm-action') === 'review')        pmReviewSelfPay(r);
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

// ── Client self-payment review (receipt verify) ───────────────────────────
let _pmReviewReq = null;

window.pmReviewSelfPay = function(r) {
    _pmReviewReq = r;
    const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setTxt('pmSelfPayClient', r.clientName || r.clientEmail || '—');
    setTxt('pmSelfPayAmount', _fmt(r.paidAmount || r.amount || r.totalAmount || 0));
    setTxt('pmSelfPayRef',    r.referenceNumber || '—');
    setTxt('pmSelfPayPeriod', r.billingPeriod || '—');
    const dt = r.submittedAt?.toDate?.() || (r.weekEndingDate ? new Date(r.weekEndingDate + 'T00:00:00') : null);
    setTxt('pmSelfPayDate', dt ? dt.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' }) : '—');

    const img = document.getElementById('pmSelfPayImg');
    if (img) { img.src = r.proofBase64 || ''; img.style.display = r.proofBase64 ? 'block' : 'none'; }
    const noImg = document.getElementById('pmSelfPayNoImg');
    if (noImg) noImg.style.display = r.proofBase64 ? 'none' : 'block';

    const pending = r.status === 'submitted';
    const actions = document.getElementById('pmSelfPayActions');
    if (actions) actions.style.display = pending ? 'flex' : 'none';
    const note = document.getElementById('pmSelfPayStatusNote');
    if (note) {
        if (pending) { note.style.display = 'none'; }
        else {
            note.style.display = 'block';
            note.textContent = r.status === 'verified'
                ? '✓ Approved — recorded as paid.'
                : (r.status === 'rejected'
                    ? ('✕ Rejected' + (r.rejectedReason ? ': ' + r.rejectedReason : ''))
                    : '');
            note.style.color = r.status === 'verified' ? '#15803d' : '#dc2626';
        }
    }
    const rw = document.getElementById('pmSelfPayRejectWrap'); if (rw) rw.style.display = 'none';
    const rt = document.getElementById('pmSelfPayRejectReason'); if (rt) rt.value = '';

    document.getElementById('pmSelfPayReviewModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmApproveSelfPay = async function() {
    if (!_pmReviewReq) return;
    const r = _pmReviewReq;
    const btn = document.getElementById('pmSelfPayApproveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
    try {
        const amt = r.paidAmount || r.amount || r.totalAmount || 0;
        await db.collection('paymentRequests').doc(r.id).update({
            status:      'verified',
            amountPaid:  amt,
            totalAmount: r.totalAmount || amt,
            verifiedAt:  firebase.firestore.FieldValue.serverTimestamp(),
            verifiedBy:  (firebase.auth().currentUser && firebase.auth().currentUser.email) || '',
            updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
        });
        _pmNotifyClientSelfPay(r, true, '');
        pmCloseModal('pmSelfPayReviewModal');
        _pmLoadPayments();
    } catch(e) { alert('Approve failed: ' + e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Approve & Mark Paid'; } }
};

window.pmShowRejectSelfPay = function() {
    const w = document.getElementById('pmSelfPayRejectWrap');
    if (w) w.style.display = 'block';
    document.getElementById('pmSelfPayRejectReason')?.focus();
};

window.pmRejectSelfPay = async function() {
    if (!_pmReviewReq) return;
    const r = _pmReviewReq;
    const reason = (document.getElementById('pmSelfPayRejectReason')?.value || '').trim();
    if (!reason) { alert('Please enter a reason for rejection.'); return; }
    const btn = document.getElementById('pmSelfPayRejectConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Rejecting…'; }
    try {
        await db.collection('paymentRequests').doc(r.id).update({
            status:         'rejected',
            rejectedReason: reason,
            rejectedAt:     firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt:      firebase.firestore.FieldValue.serverTimestamp()
        });
        _pmNotifyClientSelfPay(r, false, reason);
        pmCloseModal('pmSelfPayReviewModal');
        _pmLoadPayments();
    } catch(e) { alert('Reject failed: ' + e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Confirm Reject'; } }
};

async function _pmNotifyClientSelfPay(r, approved, reason) {
    try {
        if (!r.clientUid) return;
        const amt = (r.paidAmount || r.amount || 0).toLocaleString('en-PH');
        await db.collection('notifications').doc(r.clientUid).collection('items').add({
            type:      approved ? 'payment_verified' : 'payment_rejected',
            message:   approved
                ? `Your payment${r.billingPeriod ? ' for "' + r.billingPeriod + '"' : ''} of ₱${amt} has been verified.`
                : `Your payment${r.billingPeriod ? ' for "' + r.billingPeriod + '"' : ''} was rejected${reason ? ': ' + reason : ''}.`,
            isRead:    false,
            relatedId: r.id || '',
            createdAt: firebase.firestore.Timestamp.fromDate(new Date())
        });
    } catch(e) { console.warn('PM: client notify failed', e); }
}

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
