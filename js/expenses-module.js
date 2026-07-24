// ============================================================
// EXPENSES TRACKER MODULE — DAC's Building Design Services
// ============================================================

// ── Data UID helper — returns owner UID when staff is logged in ──
function _uid() {
    return window.currentDataUserId || (currentUser && currentUser.uid) || null;
}

// ── Custom delete confirmation modal (replaces browser confirm()) ──
window._deleteConfirmResolve = null;
window._deleteConfirmReject  = null;
function showDeleteConfirm(message) {
    return new Promise((resolve) => {
        document.getElementById('deleteConfirmMsg').textContent = message;
        openExpModal('deleteConfirmModal');
        window._deleteConfirmResolve = () => { closeExpModal('deleteConfirmModal'); resolve(true);  };
        window._deleteConfirmReject  = () => { closeExpModal('deleteConfirmModal'); resolve(false); };
    });
}
window.showDeleteConfirm = showDeleteConfirm;


// ── Formats a number value as a comma-separated string ──
function fmtBudgetVal(num) {
    if (num === null || num === undefined || isNaN(num)) return '0';
    var parts = parseFloat(num).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    // Strip trailing .00 for cleaner display
    return parts[1] === '00' ? parts[0] : parts.join('.');
}

// ── Global State ─────────────────────────────────────────────
let expProjects       = [];
let expFolders        = [];   // { id, name, description, totalBudget }
// Confidential financials live in separate owner-only collections
// (folderBudgets / projectBudgets) so staff cannot read them. These maps
// hold the merged values for owner sessions; for staff they stay empty,
// so totalBudget / monthlyBudget resolve to 0 everywhere.
let _folderBudgetMap  = {};   // folderId  -> totalBudget
let _projectBudgetMap = {};   // projectId -> monthlyBudget
let _folderBudgetsUnsub  = null;
let _projectBudgetsUnsub = null;
let _foldersUnsub     = null;
let _expandedFolders  = new Set(); // folder ids currently expanded
let expCurrentProject = null;
let expCurrentFolder  = null; // folder-level view
let expExpenses       = [];
let expPayroll        = [];
let expCharts         = {};
let expUnsubscribers  = [];
let expCategories     = []; // { id, name, color } stored in Firestore

// ── Search / filter state ─────────────────────────────────
let _expCoverExpensesMode = false; // true when no remaining budget — next expense flagged as cover
let _expSearch = { name: '', category: '', amtMin: '', amtMax: '', month: '' };
let _paySearch = { name: '' };
let _projectsUnsub = null;


// Formats a budget text input with commas as the user types
function fmtBudgetInput(el) {
    var pos   = el.selectionStart;
    var raw   = el.value.replace(/[^0-9.]/g, '');
    // Allow only one decimal point
    var parts = raw.split('.');
    var int   = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var fmt   = parts.length > 1 ? int + '.' + parts[1] : int;
    var diff  = fmt.length - el.value.length;
    el.value  = fmt;
    try { el.setSelectionRange(pos + diff, pos + diff); } catch(e) {}
}

// ── Overview: global all-expenses/payroll cache (keeps folder grid live) ──
let _ovAllExpenses  = [];
let _ovAllPayroll   = [];
let _ovExpUnsub     = null;
let _ovPayUnsub     = null;

// ── Bootstrap ────────────────────────────────────────────────
function initExpensesModule() {
    setupExpenseFormListeners();
    setupPayrollFormListeners();
    setupEditExpenseFormListeners();
    setupEditPayrollFormListeners();
    loadCategories();
    setupDocUploadListeners();
    setupLaborContractFormListeners();
}

// Wire all .doc-upload inputs (Add + Edit expense modals) so the state label
// reflects the selected filename. Also adds the `attached` class for styling.
function setupDocUploadListeners() {
    document.querySelectorAll('.doc-upload input[type="file"][data-state-id]').forEach(input => {
        if (input.dataset.docWired === '1') return;
        input.dataset.docWired = '1';
        input.addEventListener('change', () => {
            const stateEl = document.getElementById(input.dataset.stateId);
            const file = input.files?.[0];
            if (!stateEl) return;
            if (file) {
                const niceName = file.name.length > 24 ? file.name.slice(0, 21) + '…' : file.name;
                stateEl.textContent = '✓ ' + niceName;
                input.parentElement?.classList.add('attached');
            } else {
                stateEl.textContent = 'Tap to attach';
                input.parentElement?.classList.remove('attached');
            }
        });
    });
}

// ════════════════════════════════════════════════════════════
// CATEGORY MANAGEMENT
// ════════════════════════════════════════════════════════════
async function loadCategories() {
    if (!currentUser) return;
    try {
        const snap = await db.collection('categories')
            .where('userId', '==', _uid())
            .orderBy('createdAt', 'asc')
            .get();
        expCategories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        populateExpSearchCategories();
        refreshCategoryDropdown();
        renderCategoryManager();
    } catch (e) {
        // If index not ready, fallback without orderBy
        try {
            const snap = await db.collection('categories')
                .where('userId', '==', _uid())
                .get();
            expCategories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        populateExpSearchCategories();
            refreshCategoryDropdown();
            renderCategoryManager();
        } catch(e2) { console.error('loadCategories:', e2); }
    }
}

// ── Category options: labor-contract roles + the manual list ──────────
// A material is tagged with the JOB it was bought for, so the primary source is
// the active folder's labor contracts (`scope` = "the job, e.g. Tiling & masonry").
// The hand-managed `categories` list stays below it, so nothing that was already
// in use disappears and ⚙ Manage keeps working.
//
// `current` is ALWAYS included, even when it matches neither group. That is not
// cosmetic: the save paths read the <select>'s .value straight back, so an option
// that isn't rendered would be saved as "" and silently wipe the category of an
// older expense. Never drop this.
function _expCatEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _expContractRoles() {
    const set = new Set();
    (expLaborContracts || []).forEach(c => {
        const s = (c && c.scope != null ? String(c.scope) : '').trim();
        if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}
function _expCategoryOptionsHtml(current, placeholder) {
    const cur   = (current == null ? '' : String(current)).trim();
    const roles = _expContractRoles();
    const opt = name =>
        '<option value="' + _expCatEsc(name) + '"' + (name === cur ? ' selected' : '') + '>'
        + _expCatEsc(name) + '</option>';

    let html = '<option value="">' + _expCatEsc(placeholder || 'Select category…') + '</option>';
    if (roles.length) {
        html += '<optgroup label="Labor contract roles">' + roles.map(opt).join('') + '</optgroup>';
    }
    // The old hand-managed `categories` list is deliberately NOT offered here: it had
    // filled up with payment methods (Cash, Gcash, Lalamove, Downpayment…) rather than
    // material categories. Expenses are tagged by the JOB the material was bought for.
    //
    // Whatever this row already had is still rendered and selected, so opening an old
    // expense cannot blank a category recorded before this change — the save paths read
    // .value straight back, so an unrendered option would be written as "". Keep this.
    if (cur && roles.indexOf(cur) === -1) {
        html += '<optgroup label="Currently set">' + opt(cur) + '</optgroup>';
    }
    return html;
}

function refreshCategoryDropdown() {
    const sel = document.getElementById('expCategory');
    if (!sel) return;
    sel.innerHTML = _expCategoryOptionsHtml(sel.value);
}

function renderCategoryManager() {
    const container = document.getElementById('expCategoryList');
    if (!container) return;
    if (!expCategories.length) {
        container.innerHTML = '<span style="color:#aaa;font-size:0.8rem;">No categories yet. Add one above.</span>';
        return;
    }
    container.innerHTML = expCategories.map(cat => `
        <div class="exp-cat-chip" style="--cat-color:${cat.color}">
            <span class="exp-cat-dot" style="background:${cat.color}"></span>
            <span>${cat.name}</span>
            <button type="button" class="exp-cat-del" onclick="deleteCategory('${cat.id}')" title="Delete">✕</button>
        </div>`).join('');
}

async function addCategory() {
    const nameInput  = document.getElementById('catNameInput');
    const colorInput = document.getElementById('catColorInput');
    const name  = nameInput?.value.trim();
    const color = colorInput?.value || '#059669';
    if (!name) { showExpNotif('Enter a category name.', 'error'); return; }
    if (expCategories.find(c => c.name.toLowerCase() === name.toLowerCase())) {
        showExpNotif('Category already exists.', 'error'); return;
    }
    try {
        const ref = await db.collection('categories').add({
            userId: _uid(),
            name, color,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        expCategories.push({ id: ref.id, name, color });
        refreshCategoryDropdown();
        renderCategoryManager();
        if (nameInput) nameInput.value = '';
        showExpNotif(`"${name}" added!`, 'success');
    } catch (e) { showExpNotif('Error: ' + e.message, 'error'); }
}

function toggleCatManager() {
    const panel = document.getElementById('catManagerPanel');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
}

async function deleteCategory(id) {
    if (!await showDeleteConfirm('Delete this category?')) return;
    try {
        await db.collection('categories').doc(id).delete();
        expCategories = expCategories.filter(c => c.id !== id);
        refreshCategoryDropdown();
        renderCategoryManager();
        showExpNotif('Category deleted.', 'success');
    } catch (e) { showExpNotif('Error: ' + e.message, 'error'); }
}

// ════════════════════════════════════════════════════════════
// LOAD PROJECTS
// ════════════════════════════════════════════════════════════
function loadProjects() {
    // Cancel previous listeners
    if (_projectsUnsub) { _projectsUnsub(); _projectsUnsub = null; }
    if (_foldersUnsub)  { _foldersUnsub();  _foldersUnsub  = null; }
    if (_folderBudgetsUnsub)  { _folderBudgetsUnsub();  _folderBudgetsUnsub  = null; }
    if (_projectBudgetsUnsub) { _projectBudgetsUnsub(); _projectBudgetsUnsub = null; }
    // Start global overview subscription
    subscribeOvAllData();

    // Confidential financials are owner-only. Subscribe to them only when the
    // current user is NOT staff; staff sessions keep empty maps so contract
    // value / fund allocated read as 0 (and are hidden in the UI).
    if (window.currentUserRole !== 'staff') {
        _folderBudgetsUnsub = db.collection('folderBudgets')
            .where('userId', '==', _uid())
            .onSnapshot(snap => {
                _folderBudgetMap = {};
                snap.docs.forEach(d => { _folderBudgetMap[d.id] = d.data().totalBudget || 0; });
                expFolders.forEach(f => { f.totalBudget = _folderBudgetMap[f.id] || 0; });
                _renderAllPanels();
            }, err => console.error('folderBudgets listener:', err));

        _projectBudgetsUnsub = db.collection('projectBudgets')
            .where('userId', '==', _uid())
            .onSnapshot(snap => {
                _projectBudgetMap = {};
                snap.docs.forEach(d => { _projectBudgetMap[d.id] = d.data().monthlyBudget || 0; });
                expProjects.forEach(p => { p.monthlyBudget = _projectBudgetMap[p.id] || 0; });
                _renderAllPanels();
            }, err => console.error('projectBudgets listener:', err));
    }

    // Listen to folders
    _foldersUnsub = db.collection('folders')
        .where('userId', '==', _uid())
        .onSnapshot(snap => {
            expFolders = snap.docs
                .map(d => ({ id: d.id, ...d.data(), totalBudget: _folderBudgetMap[d.id] || 0 }))
                .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
            _renderAllPanels();
        }, err => console.error('folders listener:', err));

    // Listen to projects
    _projectsUnsub = db.collection('projects')
        .where('userId', '==', _uid())
        .onSnapshot(snap => {
            expProjects = snap.docs
                .map(d => ({ id: d.id, ...d.data(), monthlyBudget: _projectBudgetMap[d.id] || 0 }))
                .sort((a, b) => {
                    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                    if (b.year !== a.year) return (b.year||0) - (a.year||0);
                    return months.indexOf(b.month) - months.indexOf(a.month);
                });

            if (expCurrentProject) {
                const updated = expProjects.find(p => p.id === expCurrentProject.id);
                if (updated) expCurrentProject = updated;
            }

            _renderAllPanels();

            if (expProjects.length > 0 && !expCurrentProject && !expCurrentFolder) {
                selectProject(expProjects[0].id);
            } else if (expCurrentFolder) {
                _updateBudgetOverviewFolder();
            } else if (expCurrentProject) {
                updateBudgetOverview();
                updateExpCharts();
            } else {
                _setOverviewEmpty(true);
                updateBudgetOverview();
            }
        }, err => console.error('projects listener:', err));
}

// One-time fetch of ALL expenses + payroll for folder grid totals.
// Called once on init and manually after any write — no permanent listener.
function subscribeOvAllData() {
    if (!currentUser) return;
    // Tear down any old listeners (legacy cleanup)
    if (_ovExpUnsub) { _ovExpUnsub(); _ovExpUnsub = null; }
    if (_ovPayUnsub) { _ovPayUnsub(); _ovPayUnsub = null; }

    function _updateSpent() {
        expProjects.forEach(function(p) {
            var e = _ovAllExpenses.filter(function(x) { return x.projectId === p.id; })
                       .reduce(function(s, x) { return s + (parseFloat(x.amount) || 0); }, 0);
            var l = _ovAllPayroll.filter(function(x) { return x.projectId === p.id; })
                       .reduce(function(s, x) { return s + (parseFloat(x.totalSalary) || 0); }, 0);
            p._spent = e + l;
        });
        if (typeof mvpRenderOverviewFolderGrid === 'function') mvpRenderOverviewFolderGrid();
        if (typeof mvpPayRenderFolderGrid === 'function') mvpPayRenderFolderGrid();
        var payDetail = document.getElementById('mvpPayDetailState');
        if (payDetail && payDetail.style.display !== 'none' && typeof mvpPayRenderTable === 'function') mvpPayRenderTable();
        updateDashboardBudget();
    }

    // Single fetch — no live listener
    db.collection('expenses')
        .where('userId', '==', _uid())
        .get()
        .then(function(snap) {
            _ovAllExpenses = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
            _updateSpent();
        })
        .catch(function(err) { console.error('ov expenses fetch:', err); });

    db.collection('payroll')
        .where('userId', '==', _uid())
        .get()
        .then(function(snap) {
            _ovAllPayroll = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
            _updateSpent();
        })
        .catch(function(err) { console.error('ov payroll fetch:', err); });
}

// Call this after any expense/payroll write to keep folder grid totals fresh.
function refreshOvAllData() {
    subscribeOvAllData();
}

function _renderAllPanels() {
    renderProjectPanel('expOverviewList');
    renderProjectPanel('expExpensesList');
    renderProjectPanel('expPayrollList');
    updateDashboardBudget();
    // MVP: refresh folder grids
    if (typeof mvpRenderFolderGrid === 'function') mvpRenderFolderGrid();
    if (typeof mvpRenderOverviewFolderGrid === 'function') mvpRenderOverviewFolderGrid();
    if (typeof mvpRenderAllProjectsTable === 'function') mvpRenderAllProjectsTable();
    if (typeof mvpPayRenderFolderGrid === 'function') mvpPayRenderFolderGrid();
}

function updateDashboardBudget() {
    const totalContract  = expFolders.reduce((s, f) => s + (f.totalBudget || 0), 0);
    const totalAllocated = expProjects.reduce((s, p) => s + (p.monthlyBudget || 0), 0);
    const totalSpent     = expProjects.reduce((s, p) => s + (p._spent || 0), 0);
    const remaining      = totalAllocated - totalSpent;
    const spentPct       = totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0;
    const remPct         = totalAllocated > 0 ? Math.max(0, 100 - spentPct) : 0;

    const el = id => document.getElementById(id);
    if (!el('dashTotalContract')) return;

    el('dashTotalContract').textContent  = '₱' + formatNum(totalContract);
    el('dashFolderCount').textContent    = expFolders.length + ' project folder' + (expFolders.length !== 1 ? 's' : '');
    el('dashTotalAllocated').textContent = '₱' + formatNum(totalAllocated);
    el('dashMonthCount').textContent     = expProjects.length + ' month' + (expProjects.length !== 1 ? 's' : '') + ' across all projects';
    el('dashTotalSpent').textContent     = '₱' + formatNum(totalSpent);
    el('dashSpentPct').textContent       = spentPct.toFixed(1) + '% of allocated';
    el('dashRemaining').textContent      = '₱' + formatNum(Math.abs(remaining));
    el('dashRemainingPct').textContent   = remaining >= 0
        ? remPct.toFixed(1) + '% remaining'
        : 'Over budget by ₱' + formatNum(Math.abs(remaining));

    // ── MVP Overview Summary Cards ──────────────────────────
    const _mvpFolders  = el('mvpTotalFolders');
    const _mvpMonths   = el('mvpTotalMonths');
    const _mvpBudget   = el('mvpTotalBudget');
    const _mvpBudgSub  = el('mvpBudgetSub');
    const _mvpSpent    = el('mvpTotalSpent');
    const _mvpSpentSub = el('mvpSpentSub');
    const _mvpPct      = el('mvpHealthPct');
    const _mvpBadge    = el('mvpHealthBadge');

    if (_mvpFolders) _mvpFolders.textContent = expFolders.length;
    if (_mvpMonths)  _mvpMonths.textContent  = expProjects.length + ' billing period' + (expProjects.length !== 1 ? 's' : '');
    if (_mvpBudget)  _mvpBudget.textContent  = '₱' + formatNum(totalContract);
    if (_mvpBudgSub) _mvpBudgSub.textContent = 'allocated: ₱' + formatNum(totalAllocated);
    if (_mvpSpent)   _mvpSpent.textContent   = '₱' + formatNum(totalSpent);
    if (_mvpSpentSub) _mvpSpentSub.textContent = spentPct.toFixed(1) + '% of allocated';
    if (_mvpPct)     _mvpPct.textContent     = spentPct.toFixed(1) + '%';

    if (_mvpBadge) {
        _mvpBadge.className = 'mvp-health-badge ';
        const remPctDash = 100 - spentPct;
        if (remPctDash < 0) {
            _mvpBadge.className += 'mvp-health-danger';
            _mvpBadge.textContent = 'OVER BUDGET';
        } else if (remPctDash < 10) {
            _mvpBadge.className += 'mvp-health-critical';
            _mvpBadge.textContent = 'CRITICAL';
        } else if (remPctDash < 20) {
            _mvpBadge.className += 'mvp-health-warning';
            _mvpBadge.textContent = 'WARNING';
        } else {
            _mvpBadge.className += 'mvp-health-healthy';
            _mvpBadge.textContent = 'HEALTHY';
        }
    }

    // ── MVP Dashboard Stacked Bar ────────────────────────────
    // We need mat/lab breakdown; use totals from expProjects
    const _totalMat = expProjects.reduce((s, p) => s + (p._matSpent || 0), 0);
    const _totalLab = expProjects.reduce((s, p) => s + (p._labSpent || 0), 0);
    const _base = totalAllocated > 0 ? totalAllocated : 1;
    const _matP = Math.min((_totalMat / _base) * 100, 100);
    const _labP = Math.min((_totalLab / _base) * 100, Math.max(0, 100 - _matP));
    const _remP = Math.max(0, 100 - _matP - _labP);
    const _setW = (id, w) => { const e = el(id); if (e) e.style.width = w.toFixed(1) + '%'; };
    _setW('mvpDashStackMat', _matP);
    _setW('mvpDashStackLab', _labP);
    _setW('mvpDashStackRem', _remP);
    const _setTxt = (id, v) => { const e = el(id); if (e) e.textContent = v; };
    _setTxt('mvpDashPctMat', _matP.toFixed(1) + '%');
    _setTxt('mvpDashPctLab', _labP.toFixed(1) + '%');
    _setTxt('mvpDashPctRem',  (100 - spentPct > 0 ? (100 - spentPct) : 0).toFixed(1) + '% remaining');
    _setTxt('mvpDashPctRemLeg', _remP.toFixed(1) + '%');

    // ── MVP All Projects Table ───────────────────────────────
    if (typeof mvpRenderAllProjectsTable === 'function') mvpRenderAllProjectsTable();
}

// ── Render one panel's project list (folder-aware) ───────────
function renderProjectPanel(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var isOverview = containerId === 'expOverviewList';
    var unfiledProjects = expProjects.filter(function(p){ return !p.folderId; });

    if (expFolders.length === 0 && unfiledProjects.length === 0) {
        el.innerHTML = '<p class="exp-empty">No folders yet.<br>Click <strong>+ New Folder</strong> above.</p>';
        return;
    }

    var html = '';

    expFolders.forEach(function(folder) {
        var fid          = folder.id;
        var fname        = (folder.name || 'Unnamed').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var fdesc        = (folder.description || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        var folderBudget = folder.totalBudget || 0;
        var isExpanded   = _expandedFolders.has(fid);
        var folderProjs        = expProjects.filter(function(p){ return p.folderId === fid; });
        var totalMonthlyBudget = folderProjs.reduce(function(s,p){ return s+(p.monthlyBudget||0); }, 0);
        var totalSpent   = folderProjs.reduce(function(s,p){ return s+(p._spent||0); }, 0);
        var usedPct      = folderBudget > 0 ? Math.min((totalSpent/folderBudget)*100, 100) : 0;
        var barColor     = usedPct>90?'#ef4444':usedPct>70?'#f59e0b':'#059669';
        var chevCls      = isExpanded ? 'exp-folder-chevron expanded' : 'exp-folder-chevron';
        var emoji        = isExpanded ? '📂' : '📁';

        html += '<div class="exp-folder-block">'
            + '<div class="exp-folder-header" onclick="' + (isOverview ? 'toggleFolder(\'' + fid + '\')' : 'selectFolderAutoProject(\'' + fid + '\')') + '">'
                + '<div class="exp-folder-header-left">'
                +   (isOverview ? '<span class="' + chevCls + '">&#9654;</span>' : '')

                +   '<div class="exp-folder-info exp-folder-tooltip" data-tip="' + fname + (fdesc ? '\n' + fdesc : '') + '\n\nContract: \u20b1' + formatNum(folderBudget) + '\nMonths: ' + folderProjs.length + '">'
                +     '<strong>' + fname + '</strong>'
                +     (fdesc ? '<span>' + fdesc + '</span>' : '')
                +   '</div>'
                + '</div>'
                + '<div class="exp-folder-header-right">'
                +   '<div class="exp-folder-budget-wrap">'
                +     '<span class="exp-folder-budget">&#8369;' + formatNum(folderBudget) + '</span>'
                +     (totalMonthlyBudget > 0 ? '<span class="exp-folder-monthly-total"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#047857" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>&#8369;' + formatNum(totalMonthlyBudget) + ' &middot; ' + folderProjs.length + ' mos</span>' : '')
                +   '</div>'
                +   '<div class="exp-folder-actions">'
                +     '<button class="exp-icon-btn exp-icon-btn-add" title="Add Month" onclick="event.stopPropagation();openCreateMonthModal(\'' + fid + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>'
                +     (isOverview ? '<button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="event.stopPropagation();openEditFolderModal(\'' + fid + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
                +     '<button class="exp-icon-btn exp-icon-btn-danger" title="Delete" onclick="event.stopPropagation();deleteFolder(\'' + fid + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' : '')
                +   '</div>'
                + '</div>'
            + '</div>';

        if (folderBudget > 0) {
            html += '<div class="exp-folder-progress-bar">'
                  + '<div class="exp-folder-progress-fill" style="width:' + usedPct.toFixed(1) + '%;background:' + barColor + '"></div>'
                  + '</div>';
        }

        if (isExpanded && isOverview) {
            if (folderProjs.length === 0) {
                html += '<div class="exp-folder-empty">No months yet — click <strong>+</strong> to add one.</div>';
            } else {
                folderProjs.forEach(function(p) {
                    var active = (expCurrentProject && expCurrentProject.id === p.id) ? 'active' : '';
                    var isPresCover = p.fundingType === 'president';
                    var _ft = p.fundingType;
                    var fundingTag = _ft === 'president'
                        ? '<span class="exp-funding-tag exp-funding-president">🏦 Cover Expenses</span>'
                        : _ft === 'progress'
                            ? '<span class="exp-funding-tag exp-funding-progress">📋 Progress Billing #' + (p.billingNumber || '?') + '</span>'
                            : _ft === 'final'
                                ? '<span class="exp-funding-tag exp-funding-final">🏁 Final Payment</span>'
                                : _ft === 'mobilization'
                                    ? '<span class="exp-funding-tag exp-funding-mobilization">🚧 Mobilization</span>'
                                    : '<span class="exp-funding-tag exp-funding-client">💰 Downpayment</span>';
                    var budgetDisplay = isPresCover
                        ? (p._spent > 0
                            ? '<span class="exp-proj-cover-amount">&#8369;' + formatNum(p._spent) + '</span>'
                            : '<span class="exp-proj-cover-label">covers expenses</span>')
                        : '<span class="exp-proj-meta-amount">&#8369;' + formatNum(p.monthlyBudget) + '</span>';
                    if (isOverview) {
                        html += '<div class="exp-proj-row exp-proj-row-selectable exp-proj-row-child ' + active + '" onclick="selectProject(\'' + p.id + '\')">'
                              +   '<div class="exp-proj-row-info">'
                              +     '<div class="exp-proj-row-name-wrap">'
                              +       '<span class="exp-proj-select-dot"></span>'
                              +       '<strong>' + p.month + ' ' + p.year + '</strong>'
                              +     '</div>'
                              +     '<div class="exp-proj-row-meta">' + fundingTag + budgetDisplay + '</div>'
                              +   '</div>'
                              +   '<div class="exp-proj-row-actions">'
                              +     '<button class="exp-icon-btn exp-icon-btn-view" title="View this month" onclick="event.stopPropagation();selectProject(\'' + p.id + '\');openProjectModal(\'' + p.id + '\')"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></svg></button>'
                              +     '<button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="event.stopPropagation();openEditProjectModal(\'' + p.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
                              +   '</div>'
                              + '</div>';
                    } else {
                        html += '<div class="exp-proj-row exp-proj-row-child ' + active + '" onclick="selectProject(\'' + p.id + '\')">'
                              +   '<div class="exp-proj-row-info">'
                              +     '<strong>' + p.month + ' ' + p.year + '</strong>'
                              +     '<span>&#8369;' + formatNum(p.monthlyBudget) + '</span>'
                              +   '</div>'
                              +   '<div class="exp-proj-row-actions">'
                              +     '<button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="event.stopPropagation();openEditProjectModal(\'' + p.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
                              +   '</div>'
                              + '</div>';
                    }
                });
            }
        }

        html += '</div>';
    });

    if (unfiledProjects.length > 0) {
        html += '<div class="exp-unfiled-label">Unfiled Months</div>';
        unfiledProjects.forEach(function(p) {
            var active = (expCurrentProject && expCurrentProject.id === p.id) ? 'active' : '';
            if (isOverview) {
                html += '<div class="exp-proj-row exp-proj-row-selectable ' + active + '" onclick="selectProject(\'' + p.id + '\')">'
                      +   '<div class="exp-proj-row-info">'
                      +     '<div class="exp-proj-row-name-wrap">'
                      +       '<span class="exp-proj-select-dot"></span>'
                      +       '<strong>' + p.month + ' ' + p.year + '</strong>'
                      +     '</div>'
                      +     '<span>&#8369;' + formatNum(p.monthlyBudget) + '</span>'
                      +   '</div>'
                      +   '<div class="exp-proj-row-actions">'
                      +     '<button class="exp-icon-btn exp-icon-btn-view" title="View this month" onclick="event.stopPropagation();selectProject(\'' + p.id + '\');openProjectModal(\'' + p.id + '\')"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></svg></button>'
                      +     '<button class="exp-icon-btn exp-icon-btn-add" title="Move to Folder" onclick="event.stopPropagation();openMoveToFolderModal(\'' + p.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>'
                      +     '<button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="event.stopPropagation();openEditProjectModal(\'' + p.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
                      +   '</div>'
                      + '</div>';
            } else {
                html += '<div class="exp-proj-row ' + active + '" onclick="selectProject(\'' + p.id + '\')">'
                      +   '<div class="exp-proj-row-info">'
                      +     '<strong>' + p.month + ' ' + p.year + '</strong>'
                      +     '<span>&#8369;' + formatNum(p.monthlyBudget) + '</span>'
                      +   '</div>'
                      +   '<div class="exp-proj-row-actions">'
                      +     '<button class="exp-icon-btn exp-icon-btn-add" title="Move to Folder" onclick="event.stopPropagation();openMoveToFolderModal(\'' + p.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>'
                      +     '<button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="event.stopPropagation();openEditProjectModal(\'' + p.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
                      +   '</div>'
                      + '</div>';
            }
        });
    }

    el.innerHTML = html;
}

function toggleFolder(folderId) {
    if (_expandedFolders.has(folderId)) {
        _expandedFolders.delete(folderId);
        _renderAllPanels();
    } else {
        _expandedFolders.add(folderId);
        selectFolder(folderId);
    }
}

function selectFolder(folderId) {
    expCurrentFolder  = expFolders.find(f => f.id === folderId) || null;
    expCurrentProject = null;
    _setOverviewEmpty(false);

    // Show Billing Summary + folder KPIs; hide Total Fund Allocated Remaining + Budget Status cards — folder view
    const _bsCardSF = document.getElementById('expBillingSummaryCard');
    if (_bsCardSF) _bsCardSF.style.display = '';
    const _folderKpis = document.getElementById('expKpiFolderCards');
    if (_folderKpis) _folderKpis.style.display = 'contents';
    const _varCardSF = document.getElementById('expVarianceCard');
    if (_varCardSF) _varCardSF.style.display = 'none';
    const _statusCardSF = document.getElementById('expKpiStatusCard');
    if (_statusCardSF) _statusCardSF.style.display = 'none';

    // Unsubscribe from any month-level listeners
    expUnsubscribers.forEach(u => u());
    expUnsubscribers = [];
    expExpenses = [];
    expPayroll  = [];

    const label = expCurrentFolder ? expCurrentFolder.name : 'No project selected';
    ['expBadgeOverview','expBadgeExpenses','expBadgePayroll','expBadgeReports']
        .forEach(bid => setText(bid, label));

    renderProjectPanel('expOverviewList');
    renderProjectPanel('expExpensesList');
    renderProjectPanel('expPayrollList');
    populateMonthDropdown();
    renderExpensesTable();
    renderPayrollTable();
    subscribeFolderData(folderId);
}

// ════════════════════════════════════════════════════════════
// EDIT PROJECT
// ════════════════════════════════════════════════════════════
function openEditProjectModal(projectId) {
    const p = expProjects.find(p => p.id === projectId);
    if (!p) return;
    document.getElementById('editProjectId').value  = p.id;
    document.getElementById('editProjMonth').value  = p.month;
    document.getElementById('editProjYear').value   = p.year;
    // Funding source
    const funding = p.fundingType || 'mobilization';
    const radio = document.querySelector(`input[name="editFundingType"][value="${funding}"]`);
    if (radio) radio.checked = true;
    onEditFundingTypeChange();
    // Budget — formatted with commas
    const isPresident = funding === 'president';
    const budgetEl = document.getElementById('editProjBudget');
    if (budgetEl) budgetEl.value = isPresident ? '' : (p.monthlyBudget ? Number(p.monthlyBudget).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2}) : '');
    openExpModal('editProjectModal');
}

function onEditFundingTypeChange() {
    const sel = document.querySelector('input[name="editFundingType"]:checked');
    const type = sel ? sel.value : 'mobilization';
    const isPresident = type === 'president';
    const grp   = document.getElementById('editProjBudgetGroup');
    const label = document.getElementById('editProjBudgetLabel');
    const input = document.getElementById('editProjBudget');
    if (grp)   grp.style.display   = isPresident ? 'none' : '';
    if (input) input.required      = !isPresident;
    const labels = { mobilization:'Mobilization Amount (₱)', downpayment:'Downpayment Amount (₱)',
                     progress:'Progress Billing Amount (₱)', final:'Final Payment Amount (₱)' };
    if (label) label.textContent = labels[type] || 'Total Monthly Budget (₱)';
}

async function handleEditProject(e) {
    e.preventDefault();
    const id      = document.getElementById('editProjectId').value;
    const month   = document.getElementById('editProjMonth').value;
    const year    = parseInt(document.getElementById('editProjYear').value);
    const sel     = document.querySelector('input[name="editFundingType"]:checked');
    const funding = sel ? sel.value : 'mobilization';
    const isPresident = funding === 'president';
    const budget  = isPresident ? 0 : parseFloat((document.getElementById('editProjBudget').value||'').replace(/,/g,'')) || 0;
    if (!id || !month || !year) return;

    try {
        showExpLoading('editProjectBtn', true);
        await db.collection('projects').doc(id).update({
            month, year, fundingType: funding,
            isPresident: isPresident
        });
        // Update confidential fund allocated in the owner-only collection.
        if (window.currentUserRole !== 'staff') {
            await db.collection('projectBudgets').doc(id)
                .set({ userId: _uid(), monthlyBudget: budget }, { merge: true });
        }
        showExpNotif('Project updated! ✓', 'success');
        closeExpModal('editProjectModal');
    } catch(err) {
        console.error('handleEditProject:', err);
        showExpNotif('Failed to update project.', 'error');
    } finally {
        showExpLoading('editProjectBtn', false);
    }
}

// ════════════════════════════════════════════════════════════
// SELECT PROJECT
// ════════════════════════════════════════════════════════════
function selectProject(id) {
    expCurrentFolder  = null;
    expCurrentProject = expProjects.find(p => p.id === id) || null;
    _setOverviewEmpty(false);

    // Hide Billing Summary + folder KPIs; show Total Fund Allocated Remaining + Budget Status cards — month view
    const _bsCardSP = document.getElementById('expBillingSummaryCard');
    if (_bsCardSP) _bsCardSP.style.display = 'none';
    const _folderKpisSP = document.getElementById('expKpiFolderCards');
    if (_folderKpisSP) _folderKpisSP.style.display = 'none';
    const _varCardSP = document.getElementById('expVarianceCard');
    if (_varCardSP) _varCardSP.style.display = '';
    const _statusCardSP = document.getElementById('expKpiStatusCard');
    if (_statusCardSP) _statusCardSP.style.display = '';

    renderProjectPanel('expOverviewList');
    renderProjectPanel('expExpensesList');
    renderProjectPanel('expPayrollList');

    const label = expCurrentProject
        ? `Active: ${expCurrentProject.month} ${expCurrentProject.year}`
        : 'No project selected';
    ['expBadgeOverview','expBadgeExpenses','expBadgePayroll','expBadgeReports']
        .forEach(bid => setText(bid, label));

    expUnsubscribers.forEach(u => u());
    expUnsubscribers = [];

    if (!expCurrentProject) {
        expExpenses = [];
        expPayroll  = [];
        renderExpensesTable();
        renderPayrollTable();
        updateBudgetOverview();
        return;
    }

    const _folderId = expCurrentProject?.folderId;
    if (_folderId) {
        subscribeFolderData(_folderId);
    } else {
        subscribeExpenses();
        subscribePayroll();
    }
}

function subscribeFolderData(folderId) {
    if (!currentUser) return;
    subscribeLaborContracts(folderId);   // pakyaw / capped labor contracts (folder-level)
    const projectIds = expProjects
        .filter(p => p.folderId === folderId)
        .map(p => p.id);
    if (projectIds.length === 0) { updateBudgetOverview(); return; }

    // Firestore 'in' supports up to 30 values; chunk if needed
    const chunks = [];
    for (let i = 0; i < projectIds.length; i += 30)
        chunks.push(projectIds.slice(i, i + 30));

    let allExpenses = [];
    let allPayroll  = [];
    let expDone = 0, payDone = 0;
    const total = chunks.length;

    chunks.forEach(chunk => {
        const unsubExp = db.collection('expenses')
            .where('projectId', 'in', chunk)
            .where('userId', '==', _uid())
            .onSnapshot(snap => {
                const ids = new Set(chunk);
                allExpenses = allExpenses.filter(e => !ids.has(e.projectId));
                snap.docs.forEach(d => allExpenses.push({ id: d.id, ...d.data() }));
                expExpenses = allExpenses;
                expDone++;
                if (expDone >= total) { updateBudgetOverview(); populateMonthDropdown(); renderExpensesTable(); }
            });
        expUnsubscribers.push(unsubExp);

        const unsubPay = db.collection('payroll')
            .where('projectId', 'in', chunk)
            .where('userId', '==', _uid())
            .onSnapshot(snap => {
                const ids = new Set(chunk);
                allPayroll = allPayroll.filter(p => !ids.has(p.projectId));
                snap.docs.forEach(d => allPayroll.push({ id: d.id, ...d.data() }));
                expPayroll = allPayroll;
                payDone++;
                if (payDone >= total) { updateBudgetOverview(); renderPayrollTable(); }
            });
        expUnsubscribers.push(unsubPay);
    });
}

// ════════════════════════════════════════════════════════════
// REAL-TIME FIRESTORE LISTENERS
// ════════════════════════════════════════════════════════════
function subscribeExpenses() {
    if (!expCurrentProject || !currentUser) return;
    const unsub = db.collection('expenses')
        .where('projectId', '==', expCurrentProject.id)
        .where('userId', '==', _uid())
        .onSnapshot(snap => {
            expExpenses = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0));
            populateMonthDropdown();
            renderExpensesTable();
            updateBudgetOverview();
            updateExpCharts();
        }, err => console.error('expenses listener:', err));
    expUnsubscribers.push(unsub);
}

function subscribePayroll() {
    if (!expCurrentProject || !currentUser) return;
    const unsub = db.collection('payroll')
        .where('projectId', '==', expCurrentProject.id)
        .where('userId', '==', _uid())
        .onSnapshot(snap => {
            expPayroll = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => new Date(b.paymentDate || 0) - new Date(a.paymentDate || 0));
            renderPayrollTable();
            updateBudgetOverview();
            updateExpCharts();
        }, err => console.error('payroll listener:', err));
    expUnsubscribers.push(unsub);
}

// ════════════════════════════════════════════════════════════
// BUDGET OVERVIEW STATS
// ════════════════════════════════════════════════════════════
function _setPeriodVisibility(showCard, showVarianceRow, showAllocated, cardLabel, showPresident) {
    const periodCard     = document.getElementById('expKpiPeriodCard');
    const periodRow      = document.getElementById('expVariancePeriodRow');
    const allocatedCard  = document.getElementById('expKpiAllocatedCard');
    const presidentCard  = document.getElementById('expKpiPresidentCard');
    const periodLabel    = document.getElementById('expPeriodCardLabel');
    if (periodCard)    periodCard.style.display    = showCard                  ? '' : 'none';
    if (periodRow)     periodRow.style.display     = showVarianceRow           ? '' : 'none';
    if (allocatedCard) allocatedCard.style.display = (showAllocated !== false) ? '' : 'none';
    if (presidentCard) presidentCard.style.display = (showPresident !== false) ? '' : 'none';
    if (periodLabel)   periodLabel.textContent     = cardLabel || 'Period Budget';
}

function _updateBillingSummary(projects) {
    const statsEl     = document.getElementById('expBsStats');
    const listEl      = document.getElementById('expBillingSummaryList');
    const totalBlock  = document.getElementById('expBsTotalBlock');
    if (!listEl) return;

    const typeOrder = ['mobilization','downpayment','progress','final','president'];
    const typeInfo  = {
        mobilization: { icon: '🚧', label: 'Mobilization' },
        downpayment:  { icon: '💰', label: 'Downpayment' },
        progress:     { icon: '📋', label: 'Progress Billing' },
        final:        { icon: '🏁', label: 'Final Payment' },
        president:    { icon: '🏦', label: 'Cover Expenses' },
    };

    const sorted = [...projects].sort((a, b) => {
        const ai = typeOrder.indexOf(a.fundingType || 'downpayment');
        const bi = typeOrder.indexOf(b.fundingType || 'downpayment');
        if (ai !== bi) return ai - bi;
        return (a.billingNumber || 0) - (b.billingNumber || 0);
    });

    // Helper: sum expenses/payroll for a project's month+year (by dateTime, not projectId)
    const _bsMonthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const _bsSpentForPeriod = (p) => {
        const m = p.month, y = Number(p.year);
        const exps = expExpenses.filter(e => {
            if (!e.dateTime) return false;
            const d = new Date(e.dateTime);
            return _bsMonthNames[d.getMonth()] === m && d.getFullYear() === y;
        }).reduce((s, e) => s + (e.amount || 0), 0);
        const pays = expPayroll.filter(pr => {
            if (!pr.paymentDate) return false;
            const d = new Date(pr.paymentDate);
            return _bsMonthNames[d.getMonth()] === m && d.getFullYear() === y;
        }).reduce((s, pr) => s + (pr.totalSalary || 0), 0);
        return exps + pays;
    };

    // Totals for summary stats
    const totalReceived = sorted.filter(p => p.fundingType !== 'president')
                                .reduce((s, p) => s + (p.monthlyBudget || 0), 0);
    const totalSpent    = expExpenses.reduce((s, e) => s + (e.amount || 0), 0)
                        + expPayroll.reduce((s, pr) => s + (pr.totalSalary || 0), 0);
    // Contract value from the current folder for overall P&L
    const _bsFolder      = expCurrentFolder || (expCurrentProject?.folderId ? expFolders.find(f => f.id === expCurrentProject.folderId) : null);
    const _bsContractVal = _bsFolder?.totalBudget || 0;
    const _bsOverallPL   = _bsContractVal - totalSpent;   // Total Contract − Total Cost = true P&L
    let   grandBalance   = 0;

    // ── Summary stats row ──────────────────────────────────────
    if (statsEl) {
        const plCls  = _bsOverallPL > 0 ? 'pos' : _bsOverallPL < 0 ? 'neg' : '';
        const plSign = _bsOverallPL > 0 ? '+' : _bsOverallPL < 0 ? '-' : '';
        const plLabel = _bsOverallPL > 0 ? 'Overall Profit' : _bsOverallPL < 0 ? 'Overall Loss' : 'Break-even';
        statsEl.innerHTML =
            '<div class="exp-bs-stat">'
            +   '<div class="exp-bs-stat-val">&#8369;' + formatNum(_bsContractVal || totalReceived) + '</div>'
            +   '<div class="exp-bs-stat-label">' + (_bsContractVal > 0 ? 'Total Contract' : 'Total Billed') + '</div>'
            + '</div>'
            + '<div class="exp-bs-stat">'
            +   '<div class="exp-bs-stat-val spent">&#8369;' + formatNum(totalSpent) + '</div>'
            +   '<div class="exp-bs-stat-label">Current Fund Spent</div>'
            + '</div>'
            + '<div class="exp-bs-stat">'
            +   '<div class="exp-bs-stat-val ' + plCls + '">' + plSign + '&#8369;' + formatNum(Math.abs(_bsOverallPL)) + '</div>'
            +   '<div class="exp-bs-stat-label">' + plLabel + '</div>'
            + '</div>';
    }

    // ── Entry rows ─────────────────────────────────────────────
    let listHtml = '';
    const bdItems = [];

    sorted.forEach(p => {
        const ft      = p.fundingType || 'downpayment';
        const info    = typeInfo[ft] || { icon: '💸', label: ft };
        const isCover = ft === 'president';
        const recv    = isCover ? 0 : (p.monthlyBudget || 0);
        const spent   = _bsSpentForPeriod(p);
        const bal     = isCover ? -spent : recv - spent;
        grandBalance += bal;

        const label   = ft === 'progress'
            ? info.icon + ' ' + info.label + ' #' + (p.billingNumber || '?')
            : info.icon + ' ' + info.label;
        const balCls  = bal > 0 ? 'pos' : bal < 0 ? 'neg' : 'zero';
        const balSign = bal > 0 ? '+' : bal < 0 ? '-' : '';
        const balStr  = balSign + '&#8369;' + formatNum(Math.abs(bal));

        // Bar: received width + spent width (relative to the larger)
        const maxRef  = Math.max(recv, spent, 1);
        const recW    = Math.min((recv  / maxRef) * 100, 100).toFixed(1);
        const sptW    = Math.min((spent / maxRef) * 100, 100).toFixed(1);

        listHtml +=
            '<div class="exp-bs-entry' + (isCover ? ' exp-bs-entry-cover' : '') + '">'
            +   '<div class="exp-bs-entry-top">'
            +     '<div class="exp-bs-entry-info">'
            +       '<span class="exp-bs-entry-label">' + label + '</span>'
            +       '<span class="exp-bs-entry-period">' + p.month + ' ' + p.year + '</span>'
            +     '</div>'
            +     '<div class="exp-bs-entry-amounts">'
            +       '<span class="exp-bs-entry-received">&#8369;' + formatNum(isCover ? spent : recv) + '</span>'
            +       '<span class="exp-bs-entry-bal ' + balCls + '">' + balStr + '</span>'
            +     '</div>'
            +   '</div>'
            +   '<div class="exp-bs-bar-track">'
            +     (isCover
                    ? '<div class="exp-bs-bar-cover" style="width:' + sptW + '%"></div>'
                    : '<div class="exp-bs-bar-rec" style="width:' + recW + '%"></div>'
                    +  '<div class="exp-bs-bar-spent" style="width:' + sptW + '%"></div>')
            +   '</div>'
            +   '<div class="exp-bs-bar-labels">'
            +     (isCover
                    ? '<span>Covers &#8369;' + formatNum(spent) + ' expenses</span>'
                    : '<span style="color:#3b82f6">&#8369;' + formatNum(recv) + ' received</span>'
                    +  '<span style="color:#f59e0b">&#8369;' + formatNum(spent) + ' spent</span>')
            +   '</div>'
            + '</div>';

        bdItems.push({ label, bal, balCls, balStr });
    });

    listEl.innerHTML = listHtml || '<p class="exp-empty" style="padding:1rem 0">No billing data yet.</p>';

    // ── Grand total block ──────────────────────────────────────
    if (totalBlock) {
        const plSign  = _bsOverallPL > 0 ? '+' : _bsOverallPL < 0 ? '-' : '';
        const plColor = _bsOverallPL > 0 ? '#059669' : _bsOverallPL < 0 ? '#ef4444' : '#6b7280';
        const plTitle = _bsOverallPL > 0 ? 'Profit' : _bsOverallPL < 0 ? 'Loss' : 'Break-even';

        // Per-period P&L breakdown (billing received - period spent)
        let bdHtml = bdItems.map(item =>
            '<div class="exp-bs-bd-item">'
            +   '<span class="exp-bs-bd-name">' + item.label + '</span>'
            +   '<span class="exp-bs-bd-amt ' + item.balCls + '">' + item.balStr + '</span>'
            + '</div>'
        ).join('');

        // Remaining contract (not yet billed)
        const remaining = _bsContractVal - totalReceived;
        const remHtml = _bsContractVal > 0
            ? '<div class="exp-bs-bd-item" style="border-top:1px dashed #e5e7eb;margin-top:0.4rem;padding-top:0.4rem">'
              + '<span class="exp-bs-bd-name" style="opacity:0.6">Remaining unbilled</span>'
              + '<span class="exp-bs-bd-amt" style="color:#6b7280">&#8369;' + formatNum(Math.max(remaining, 0)) + '</span>'
              + '</div>'
            : '';

        totalBlock.innerHTML =
            '<div class="exp-bs-total-row">'
            +   '<div class="exp-bs-total-label"><i data-lucide="sigma" class="inline-icon"></i> Overall ' + plTitle + ' / Loss</div>'
            +   '<div class="exp-bs-total-val" style="color:' + plColor + '">' + plSign + '&#8369;' + formatNum(Math.abs(_bsOverallPL)) + '</div>'
            + '</div>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function _updateBudgetOverviewFolder() {
    const folder      = expCurrentFolder;
    const folderProjs = expProjects.filter(p => p.folderId === folder.id);
    const hasPresident = folderProjs.some(p => p.fundingType === 'president');
    const hasClient    = folderProjs.some(p => p.fundingType !== 'president');
    // folder view: hide period card + row; show president/allocated cards only if relevant months exist
    _setPeriodVisibility(false, false, hasClient, 'Period Budget', hasPresident);
    const contractVal = folder.totalBudget || 0;
    const totalAlloc  = folderProjs.reduce((s, p) => s + (p.monthlyBudget || 0), 0);
    const mCount      = folderProjs.length;

    // Badge
    ['expBadgeOverview','expBadgeExpenses','expBadgePayroll','expBadgeReports']
        .forEach(bid => setText(bid, folder.name + ' — All Months'));

    // KPI top row
    const clientProjs  = folderProjs.filter(p => p.fundingType !== 'president');
    const presProjs    = folderProjs.filter(p => p.fundingType === 'president');
    const clientAlloc  = clientProjs.reduce((s, p) => s + (p.monthlyBudget || 0), 0);
    // Cover expenses: sum all expenses flagged as coverExpense or charged to a president-type project
    const _presProjIds = new Set(presProjs.map(p => p.id));
    const presSpent    = expExpenses.filter(e => e.coverExpense || _presProjIds.has(e.projectId))
                                    .reduce((s, e) => s + (e.amount || 0), 0)
                       + expPayroll.filter(pr => _presProjIds.has(pr.projectId))
                                   .reduce((s, pr) => s + (pr.totalSalary || 0), 0);

    setText('expFolderBudget',  contractVal > 0 ? '₱' + formatNum(contractVal) : '—');
    setText('expTotalMonthlyAllocations', clientAlloc > 0 ? '₱' + formatNum(clientAlloc) : '—');
    setText('expAllocatedMonthCount', clientProjs.length + ' billing month' + (clientProjs.length !== 1 ? 's' : ''));

    // ── Delta: Total Contract − Total Fund Allocated ──────────
    const _totalCost = expExpenses.reduce((s, e) => s + (e.amount || 0), 0)
                     + expPayroll.reduce((s, p) => s + (p.totalSalary || 0), 0);

    const _setDelta = (valId, badgeId, delta, labels) => {
        const el = document.getElementById(valId);
        const be = document.getElementById(badgeId);
        if (el) { el.textContent = (delta < 0 ? '-' : '+') + '₱' + formatNum(Math.abs(delta)); el.style.color = delta >= 0 ? '#059669' : '#ef4444'; }
        if (be) { const s = delta > 0 ? labels[0] : delta < 0 ? labels[1] : labels[2];
            be.textContent = s.text; be.style.background = s.bg; be.style.color = s.col; }
    };

    _setDelta('expContractDeltaVal', 'expContractDeltaBadge', contractVal - clientAlloc, [
        { text: 'Profitable', bg: '#d1fae5', col: '#065f46' },
        { text: 'Loss',       bg: '#fee2e2', col: '#991b1b' },
        { text: 'Break-even', bg: '#e5e7eb', col: '#374151' }
    ]);

    // ── Delta: Total Contract − Total Cost (contract variance) ──
    _setDelta('expContractVsSpentVal', 'expContractVsSpentBadge', contractVal - _totalCost, [
        { text: 'Under Budget', bg: '#d1fae5', col: '#065f46' },
        { text: 'Over Budget',  bg: '#fee2e2', col: '#991b1b' },
        { text: 'On Budget',    bg: '#e5e7eb', col: '#374151' }
    ]);

    // ── Delta: Total Fund Allocated − Total Cost ───────────────
    {
        const delta2   = clientAlloc - _totalCost;
        const pct2     = clientAlloc > 0 ? (_totalCost / clientAlloc) * 100 : 0;
        const deltaEl2 = document.getElementById('expReceivedDeltaVal');
        const badgeEl2 = document.getElementById('expReceivedDeltaBadge');
        if (deltaEl2) { deltaEl2.textContent = (delta2 < 0 ? '-' : '+') + '₱' + formatNum(Math.abs(delta2)); deltaEl2.style.color = delta2 >= 0 ? '#059669' : '#ef4444'; }
        if (badgeEl2) {
            if (pct2 > 100)     { badgeEl2.textContent = 'Negative'; badgeEl2.style.background = '#fee2e2'; badgeEl2.style.color = '#991b1b'; }
            else if (pct2 > 80) { badgeEl2.textContent = 'Warning';  badgeEl2.style.background = '#fef3c7'; badgeEl2.style.color = '#92400e'; }
            else                { badgeEl2.textContent = 'Good';     badgeEl2.style.background = '#d1fae5'; badgeEl2.style.color = '#065f46'; }
        }
    }

    // ── Inline Budget Status: Total Contract ────────────────────
    {
        const pct    = contractVal > 0 ? (_totalCost / contractVal) * 100 : 0;
        const isOver = pct > 100, isWarn = pct > 80;
        const label  = isOver ? 'BAD' : isWarn ? 'WARNING' : 'HEALTHY';
        const col    = isOver ? { bg:'#fee2e2', c:'#991b1b' } : isWarn ? { bg:'#fef3c7', c:'#92400e' } : { bg:'#d1fae5', c:'#065f46' };
        const pctEl  = document.getElementById('expFolderContractStatusPct');
        const badEl  = document.getElementById('expFolderContractStatusBadge');
        const subEl  = document.getElementById('expFolderContractStatusSub');
        if (pctEl)  pctEl.textContent  = pct.toFixed(1) + '%';
        if (badEl)  { badEl.textContent = label; badEl.style.background = col.bg; badEl.style.color = col.c; }
        if (subEl)  subEl.textContent  = 'utilized of contract';
    }

    // ── Inline Budget Status: Cover Expenses (0-4%=NONE, 5-9%=WARNING, ≥10%=CRITICAL) ──
    {
        const coverPct = contractVal > 0 ? (presSpent / contractVal) * 100 : 0;
        const label    = coverPct >= 10 ? 'CRITICAL' : coverPct >= 5 ? 'WARNING' : 'NONE';
        const col      = coverPct >= 10 ? { bg:'#fee2e2', c:'#991b1b' }
                       : coverPct >= 5  ? { bg:'#fef3c7', c:'#92400e' }
                       :                  { bg:'#e5e7eb', c:'#374151' };
        const pctEl = document.getElementById('expFolderCoverStatusPct');
        const badEl = document.getElementById('expFolderCoverStatusBadge');
        if (pctEl) pctEl.textContent = coverPct.toFixed(1) + '%';
        if (badEl) { badEl.textContent = label; badEl.style.background = col.bg; badEl.style.color = col.c; }
    }

    // ── Inline Budget Status: Total Fund Allocated ─────────────
    {
        const pct2   = clientAlloc > 0 ? (_totalCost / clientAlloc) * 100 : 0;
        const isOver = pct2 > 100, isWarn = pct2 > 80;
        const label  = isOver ? 'BAD' : isWarn ? 'WARNING' : 'HEALTHY';
        const col    = isOver ? { bg:'#fee2e2', c:'#991b1b' } : isWarn ? { bg:'#fef3c7', c:'#92400e' } : { bg:'#d1fae5', c:'#065f46' };
        const pctEl  = document.getElementById('expFolderReceivedStatusPct');
        const badEl  = document.getElementById('expFolderReceivedStatusBadge');
        const subEl  = document.getElementById('expFolderReceivedStatusSub');
        if (pctEl)  pctEl.textContent  = pct2.toFixed(1) + '%';
        if (badEl)  { badEl.textContent = label; badEl.style.background = col.bg; badEl.style.color = col.c; }
        if (subEl)  subEl.textContent  = 'utilized of budget received';
    }
    setText('expTotalPresidentCover',       presSpent > 0 ? '₱' + formatNum(presSpent) : '—');
    setText('expPresidentCoverCount',       presProjs.length + ' month' + (presProjs.length !== 1 ? 's' : '') + ' covered');
    setText('expFolderTotalPresidentCover', presSpent > 0 ? '₱' + formatNum(presSpent) : (presProjs.length > 0 ? '₱0.00' : '—'));
    setText('expFolderPresidentCoverCount', presProjs.length + ' month' + (presProjs.length !== 1 ? 's' : '') + ' covered');
    setText('expTotalBudget',   '₱' + formatNum(totalAlloc));
    setText('expPeriodLabel',   mCount + ' months · all periods');

    // Update _spent per project so president-month rows show actual totals in sidebar
    folderProjs.forEach(p => {
        const projExp = expExpenses.filter(e => e.projectId === p.id).reduce((s, e) => s + (e.amount || 0), 0);
        const projPay = expPayroll.filter(r => r.projectId === p.id).reduce((s, r) => s + (r.totalSalary || 0), 0);
        p._spent = projExp + projPay;
    });
    renderProjectPanel('expOverviewList');

    // Cost breakdown — use real aggregated expenses & payroll
    const exps    = expExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const pay     = expPayroll.reduce((s, p) => s + (p.totalSalary || 0), 0);
    const spent   = exps + pay;
    // When all months are president-covered, totalAlloc=0 — fall back to contractVal
    const budgetRef = totalAlloc > 0 ? totalAlloc : contractVal;
    const expPct  = budgetRef > 0 ? (exps / budgetRef) * 100 : 0;
    const payPct  = budgetRef > 0 ? (pay  / budgetRef) * 100 : 0;

    setText('expTotalExpenses', '₱' + formatNum(exps));
    setText('expExpenseCount',  expExpenses.length + ' transaction' + (expExpenses.length !== 1 ? 's' : ''));
    const pctLabel = totalAlloc > 0 ? '% of budget' : '% of contract';
    setText('expExpPct',        expPct.toFixed(1) + pctLabel);
    setBar('expExpBar', expPct);

    setText('expTotalPayroll',  '₱' + formatNum(pay));
    const workerSet = new Set(expPayroll.map(p => p.workerName || p.id));
    setText('expPayrollCount',  workerSet.size + ' worker' + (workerSet.size !== 1 ? 's' : ''));
    setText('expPayPct',        payPct.toFixed(1) + pctLabel);
    setBar('expPayBar', payPct);

    setText('expTotalSpent',    '₱' + formatNum(spent));
    setText('expSpentOfContract', contractVal > 0 ? (spent / contractVal * 100).toFixed(1) + '% of contract value' : '');
    setBar('expSpentBar', contractVal > 0 ? Math.min((spent / contractVal) * 100, 100) : 0);

    // Budget Status card (uses real spent data)
    const folderRemain  = budgetRef - spent;
    const folderUsedPct = budgetRef > 0 ? (spent / budgetRef) * 100 : 0;
    setText('expUsedPct', folderUsedPct.toFixed(1) + '%');
    const statusCard  = document.getElementById('expKpiStatusCard');
    const healthBadge = document.getElementById('expHealthBadge');
    const healthSub   = document.getElementById('expHealthSub');
    const healthIco   = document.getElementById('expHealthIcon');
    if (statusCard && healthBadge && healthSub && healthIco) {
        statusCard.classList.remove('status-warning','status-danger');
        if (folderUsedPct > 100) {
            statusCard.classList.add('status-danger');
            healthBadge.textContent = 'OVER BUDGET';
            healthSub.textContent   = 'utilized — OVER BUDGET';
            healthIco.setAttribute('data-lucide', 'shield-x');
        } else if (folderUsedPct > 85) {
            statusCard.classList.add('status-warning');
            healthBadge.textContent = 'NEAR LIMIT';
            healthSub.textContent   = 'utilized — NEAR LIMIT';
            healthIco.setAttribute('data-lucide', 'shield-alert');
        } else {
            healthBadge.textContent = folderUsedPct > 60 ? 'ON TRACK' : 'HEALTHY';
            healthSub.textContent   = 'utilized — ' + (folderUsedPct > 60 ? 'ON TRACK' : 'HEALTHY');
            healthIco.setAttribute('data-lucide', 'shield-check');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // Variance
    setText('expRemaining', '₱' + formatNum(Math.abs(folderRemain)));

    const varianceCard = document.getElementById('expVarianceCard');
    const varianceIcon = document.getElementById('expVarianceIcon');
    const varianceMeta = document.getElementById('expVarianceMeta');
    if (varianceCard) {
        if (folderRemain < 0) {
            varianceCard.classList.add('is-over');
            if (varianceIcon) varianceIcon.setAttribute('data-lucide', 'trending-down');
            if (varianceMeta) varianceMeta.textContent = 'Over budget — immediate review needed';
            setBar('expRemBar', 100);
        } else {
            varianceCard.classList.remove('is-over');
            if (varianceIcon) varianceIcon.setAttribute('data-lucide', 'trending-up');
            if (varianceMeta) varianceMeta.textContent = 'Remaining available';
            setBar('expRemBar', Math.max(0, 100 - folderUsedPct));
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    const contractVarEl  = document.getElementById('expContractVariance');
    const contractVarBar = document.getElementById('expContractVarBar');
    if (contractVarEl && contractVal > 0) {
        const cRemain = contractVal - spent;
        contractVarEl.textContent = (cRemain < 0 ? '-' : '') + '₱' + formatNum(Math.abs(cRemain));
        contractVarEl.style.color = cRemain < 0 ? '#ef4444' : '#059669';
        if (contractVarBar) {
            contractVarBar.style.width      = Math.max(Math.min((cRemain / contractVal) * 100, 100), 2).toFixed(1) + '%';
            contractVarBar.style.background = cRemain < 0 ? '#ef4444' : '#059669';
        }
    }

    // Net Balance: Total Fund Allocated (clientAlloc) − President Covers (presSpent)
    const netBal    = clientAlloc - presSpent;
    const netBalEl  = document.getElementById('expNetBalance');
    const netBarEl  = document.getElementById('expNetBalanceBar');
    const netMetaEl = document.getElementById('expNetBalanceMeta');
    if (netBalEl) {
        netBalEl.textContent = (netBal < 0 ? '-' : '') + '₱' + formatNum(Math.abs(netBal));
        netBalEl.style.color = netBal < 0 ? '#ef4444' : '#8b5cf6';
    }
    if (netBarEl && clientAlloc > 0) {
        netBarEl.style.width      = Math.max(Math.min((Math.abs(netBal) / clientAlloc) * 100, 100), 2).toFixed(1) + '%';
        netBarEl.style.background = netBal < 0 ? '#ef4444' : '#8b5cf6';
    }
    if (netMetaEl) netMetaEl.textContent = netBal < 0 ? 'Cover expenses exceeded billing received' : 'net available from client';

    // Utilization bar
    const matW = Math.min(expPct, 100);
    const payW = Math.min(payPct, Math.max(0, 100 - matW));
    const remW = Math.max(0, 100 - matW - payW);
    setBarWidth('expStackMaterials', matW);
    setBarWidth('expStackPayroll',   payW);
    setBarWidth('expStackRemaining', remW);
    setText('expRemPct',    remW.toFixed(1) + '% remaining');
    setText('expLegMatPct', expPct.toFixed(1) + '%');
    setText('expLegPayPct', payPct.toFixed(1) + '%');
    setText('expLegRemPct', remW.toFixed(1) + '%');

    // Show Billing Summary in folder view
    const _bsCard = document.getElementById('expBillingSummaryCard');
    if (_bsCard) _bsCard.style.display = '';
    _updateBillingSummary(folderProjs);

    // ── MVP Overview: refresh folder detail if currently visible ─
    if (typeof mvpRenderOvFolderDetail === 'function') {
        var _ovDetail = document.getElementById('mvpOvDetailState');
        if (_ovDetail && _ovDetail.style.display !== 'none') {
            mvpRenderOvFolderDetail(folder.id);
        }
    }
    // ── MVP Expenses: refresh detail KPIs + tables if visible ───
    var _expDetail = document.getElementById('mvpDetailState');
    if (_expDetail && _expDetail.style.display !== 'none') {
        if (typeof mvpUpdateDetail === 'function') mvpUpdateDetail();
    }
}

// ════════════════════════════════════════════════════════════
function updateBudgetOverview() {
    if (expCurrentFolder) { _updateBudgetOverviewFolder(); return; }
    const _isPresMonth  = expCurrentProject?.fundingType === 'president';
    const _fid          = expCurrentProject?.folderId;
    const _folderMonths = _fid ? expProjects.filter(p => p.folderId === _fid) : (expCurrentProject ? [expCurrentProject] : []);
    const _hasPresident = _folderMonths.some(p => p.fundingType === 'president');
    const _hasClient    = _folderMonths.some(p => p.fundingType !== 'president');
    // Show president/cover card always for folder months; only based on data for standalone
    const _showCoverCard = _fid ? true : _hasPresident;
    _setPeriodVisibility(true, !_isPresMonth, _hasClient,
        _isPresMonth ? 'Total Month Expenses' : 'Period Budget', _showCoverCard);
    const budget       = expCurrentProject?.monthlyBudget || 0;
    const _periodMonth = expCurrentProject?.month;
    const _periodYear  = expCurrentProject?.year;
    const _monthNames  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    let periodExpenses = expExpenses;
    let periodPayroll  = expPayroll;
    if (_fid && _periodMonth && _periodYear) {
        periodExpenses = expExpenses.filter(e => {
            if (!e.dateTime) return false;
            const d = new Date(e.dateTime);
            return _monthNames[d.getMonth()] === _periodMonth && d.getFullYear() === Number(_periodYear);
        });
        periodPayroll = expPayroll.filter(pr => {
            if (!pr.paymentDate) return false;
            const d = new Date(pr.paymentDate);
            return _monthNames[d.getMonth()] === _periodMonth && d.getFullYear() === Number(_periodYear);
        });
    }
    const exps    = periodExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const pay     = periodPayroll.reduce((s, p) => s + (p.totalSalary || 0), 0);
    const spent   = exps + pay;

    // Update _spent locally so president-covered months show the total in the list
    if (expCurrentProject) {
        const proj = expProjects.find(p => p.id === expCurrentProject.id);
        if (proj) proj._spent = spent;
        renderProjectPanel('expOverviewList');
    }
    const isPresidentMonth = expCurrentProject?.fundingType === 'president';
    // For president months: treat actual spent as the effective budget
    const effectiveBudget = isPresidentMonth ? spent : budget;
    const usedPct = effectiveBudget > 0 ? (spent / effectiveBudget) * 100 : 0;
    const expPct  = effectiveBudget > 0 ? (exps  / effectiveBudget) * 100 : 0;
    const payPct  = effectiveBudget > 0 ? (pay   / effectiveBudget) * 100 : 0;
    const remPct  = Math.max(0, 100 - expPct - payPct);

    if (isPresidentMonth) {
        setText('expTotalBudget', spent > 0 ? '₱' + formatNum(spent) : '₱0.00');
        setText('expPeriodLabel', '🏦 Cover Expenses · ' + (expCurrentProject?.month || '') + ' ' + (expCurrentProject?.year || ''));
    } else {
        setText('expTotalBudget', '₱' + formatNum(budget));
        if (expCurrentProject?.month && expCurrentProject?.year) {
            setText('expPeriodLabel', expCurrentProject.month + ' ' + expCurrentProject.year + ' allocation');
        }
    }

    // Total Fund Allocated (client downpayments) + President Covers cards
    const fid = expCurrentProject?.folderId;
    const folderProjs       = fid ? expProjects.filter(p => p.folderId === fid) : [];
    const clientMonthsTotal = folderProjs.filter(p => p.fundingType !== 'president')
                                         .reduce((s, p) => s + (p.monthlyBudget || 0), 0);
    const clientMonthCount  = folderProjs.filter(p => p.fundingType !== 'president').length;
    const presMonths        = folderProjs.filter(p => p.fundingType === 'president');
    const presTotal         = presMonths.reduce((s, p) => s + (p._spent || 0), 0);
    const totalMonthlyEl    = document.getElementById('expTotalMonthlyAllocations');
    const allocCountEl      = document.getElementById('expAllocatedMonthCount');
    if (totalMonthlyEl) {
        totalMonthlyEl.textContent = clientMonthsTotal > 0 ? '₱' + formatNum(clientMonthsTotal) : '—';
        if (allocCountEl) allocCountEl.textContent = clientMonthCount + ' billing month' + (clientMonthCount !== 1 ? 's' : '');
    }
    setText('expTotalPresidentCover', presTotal > 0 ? '₱' + formatNum(presTotal) : (presMonths.length > 0 ? '₱0.00' : '—'));
    setText('expPresidentCoverCount', presMonths.length + ' month' + (presMonths.length !== 1 ? 's' : '') + ' covered');
    setText('expUsedPct', usedPct.toFixed(1) + '%');
    const statusCard  = document.getElementById('expKpiStatusCard');
    const healthBadge = document.getElementById('expHealthBadge');
    const healthSub   = document.getElementById('expHealthSub');
    const healthIco   = document.getElementById('expHealthIcon');
    if (statusCard && healthBadge && healthSub && healthIco) {
        statusCard.classList.remove('status-warning', 'status-danger');
        if (usedPct > 100) {
            statusCard.classList.add('status-danger');
            healthBadge.textContent = 'OVER BUDGET';
            healthSub.textContent   = 'utilized — OVER BUDGET';
            healthIco.setAttribute('data-lucide', 'shield-x');
        } else if (usedPct > 85) {
            statusCard.classList.add('status-warning');
            healthBadge.textContent = 'NEAR LIMIT';
            healthSub.textContent   = 'utilized — NEAR LIMIT';
            healthIco.setAttribute('data-lucide', 'shield-alert');
        } else if (usedPct > 60) {
            healthBadge.textContent = 'ON TRACK';
            healthSub.textContent   = 'utilized — ON TRACK';
            healthIco.setAttribute('data-lucide', 'shield-check');
        } else {
            healthBadge.textContent = 'HEALTHY';
            healthSub.textContent   = 'utilized — HEALTHY';
            healthIco.setAttribute('data-lucide', 'shield-check');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    const folderBudgetEl = document.getElementById('expFolderBudget');
    if (folderBudgetEl) {
        const folderId = expCurrentProject?.folderId;
        const folder   = folderId ? expFolders.find(f => f.id === folderId) : null;
        folderBudgetEl.textContent = folder ? '₱' + formatNum(folder.totalBudget) : '—';

        const totalMonthlyEl   = document.getElementById('expTotalMonthlyAllocations');
        const allocatedCountEl = document.getElementById('expAllocatedMonthCount');
        if (totalMonthlyEl) {
            if (folderId) {
                const folderProjs  = expProjects.filter(p => p.folderId === folderId);
                const totalMonthly = folderProjs.reduce((s, p) => s + (p.monthlyBudget || 0), 0);
                const monthCount   = folderProjs.length;
                totalMonthlyEl.textContent = totalMonthly > 0 ? '₱' + formatNum(totalMonthly) : '—';
                if (allocatedCountEl) allocatedCountEl.textContent = monthCount + ' month' + (monthCount !== 1 ? 's' : '') + ' allocated';
            } else {
                totalMonthlyEl.textContent = '—';
                if (allocatedCountEl) allocatedCountEl.textContent = 'across all months';
            }
        }
    }

    setText('expTotalExpenses', '₱' + formatNum(exps));
    setText('expExpenseCount',  periodExpenses.length + ' transaction' + (periodExpenses.length !== 1 ? 's' : ''));
    setText('expExpPct',        expPct.toFixed(1) + '% of budget');
    setBar('expExpBar', expPct);

    setText('expTotalPayroll', '₱' + formatNum(pay));
    const workerSet = new Set(periodPayroll.map(p => p.workerName || p.id));
    setText('expPayrollCount', workerSet.size + ' worker' + (workerSet.size !== 1 ? 's' : ''));
    setText('expPayPct', payPct.toFixed(1) + '% of budget');
    setBar('expPayBar', payPct);

    // Total Cost = current period spending only
    const folderId2   = expCurrentProject?.folderId;
    const folder2     = folderId2 ? expFolders.find(f => f.id === folderId2) : null;
    const contractVal = folder2?.totalBudget || 0;
    setText('expTotalSpent', '₱' + formatNum(spent));
    const spentOfContract = contractVal > 0 ? (spent / contractVal) * 100 : 0;
    setText('expSpentOfContract', spentOfContract.toFixed(1) + '% of contract value');
    setBar('expSpentBar', Math.min(spentOfContract, 100));

    // ── Total Fund Allocated Remaining: Period Budget − Cover Expenses & Period Budget − Total Cost ──
    const _presProjIds = new Set(expProjects.filter(p => p.fundingType === 'president').map(p => p.id));
    const coverAmt     = periodExpenses.filter(e => _presProjIds.has(e.projectId) || e.coverExpense)
                                       .reduce((s, e) => s + (e.amount || 0), 0);

    // Populate Cover Expenses KPI card with period-specific cover amount
    setText('expTotalPresidentCover', '₱' + formatNum(coverAmt));
    setText('expPresidentCoverCount', coverAmt > 0 ? 'this period' : 'no cover expenses this period');

    const periodMinusCover = budget - coverAmt;   // Row 1
    const periodMinusTotal = budget - spent;       // Row 2

    // Row 1: Period Budget − Cover Expenses
    setText('expRemaining', (periodMinusCover < 0 ? '-' : '') + '₱' + formatNum(Math.abs(periodMinusCover)));
    const remBarPct = budget > 0 ? Math.min(Math.max((Math.abs(periodMinusCover) / budget) * 100, 0), 100) : 100;
    setBar('expRemBar', remBarPct);

    // Row 2: Period Budget − Total Cost
    const contractVarEl  = document.getElementById('expContractVariance');
    const contractVarBar = document.getElementById('expContractVarBar');
    if (contractVarEl) {
        contractVarEl.textContent = (periodMinusTotal < 0 ? '-' : '') + '₱' + formatNum(Math.abs(periodMinusTotal));
        contractVarEl.style.color = periodMinusTotal < 0 ? '#ef4444' : '#059669';
    }
    if (contractVarBar) {
        const pct = budget > 0 ? Math.min(Math.max((Math.abs(periodMinusTotal) / budget) * 100, 0), 100) : 0;
        contractVarBar.style.width      = pct.toFixed(1) + '%';
        contractVarBar.style.background = periodMinusTotal < 0 ? '#ef4444' : '#059669';
    }

    // Variance card status (driven by total cost)
    const varianceCard = document.getElementById('expVarianceCard');
    const varianceIcon = document.getElementById('expVarianceIcon');
    const varianceMeta = document.getElementById('expVarianceMeta');
    if (varianceCard) {
        if (periodMinusTotal < 0) {
            varianceCard.classList.add('is-over');
            if (varianceIcon) varianceIcon.setAttribute('data-lucide', 'trending-down');
            if (varianceMeta) varianceMeta.textContent = 'Over budget — immediate review needed';
        } else {
            varianceCard.classList.remove('is-over');
            if (varianceIcon) varianceIcon.setAttribute('data-lucide', 'trending-up');
            if (varianceMeta) varianceMeta.textContent = 'Remaining available';
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    const matW = Math.min(expPct, 100);
    const payW = Math.min(payPct, Math.max(0, 100 - matW));
    const remW = Math.max(0, 100 - matW - payW);
    setBarWidth('expStackMaterials', matW);
    setBarWidth('expStackPayroll',   payW);
    setBarWidth('expStackRemaining', remW);
    setText('expRemPct',    remPct.toFixed(1) + '% remaining');
    setText('expLegMatPct', expPct.toFixed(1) + '%');
    setText('expLegPayPct', payPct.toFixed(1) + '%');
    setText('expLegRemPct', remPct.toFixed(1) + '%');

    // Hide Billing Summary in month view
    const _bsCard = document.getElementById('expBillingSummaryCard');
    if (_bsCard) _bsCard.style.display = 'none';

    // ── MVP: Update detail cards and payroll tab ─────────────
    if (typeof mvpUpdateDetail === 'function') mvpUpdateDetail();
    // ── MVP Overview: refresh folder detail if it is currently visible ──
    if (typeof mvpRenderOvFolderDetail === 'function') {
        var ovDetail = document.getElementById('mvpOvDetailState');
        if (ovDetail && ovDetail.style.display !== 'none') {
            mvpRenderOvFolderDetail(_mvpOvCurrentFolderId);
        }
    }
}

function setBar(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.min(Math.max(pct, 0), 100).toFixed(1) + '%';
}
function setBarWidth(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.min(Math.max(pct, 0), 100).toFixed(1) + '%';
}

// ════════════════════════════════════════════════════════════
// EXPENSE TABLE
// ════════════════════════════════════════════════════════════
function renderExpensesTable() {
    const tbody = document.getElementById('expensesTbody');
    if (!tbody) return;
    if (!expCurrentProject && !expCurrentFolder) {
        tbody.innerHTML = '<tr><td colspan="7" class="exp-empty-row">👈 Select a project from the list.</td></tr>';
        return;
    }
    if (!expExpenses.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="exp-empty-row">No expenses yet. Click ＋ Add Expense.</td></tr>';
        return;
    }

    // When a specific month/project is selected (not folder view), restrict to that period's expenses.
    // For split expenses, also show sibling records charged to other billing periods in the same split.
    const _tblPeriodSource = expCurrentProject && !expCurrentFolder ? (() => {
        if (!expCurrentProject.folderId) return expExpenses; // standalone project — show all
        const myExpenses  = expExpenses.filter(e => e.projectId === expCurrentProject.id);
        const splitGroups = new Set(myExpenses.filter(e => e.splitGroup).map(e => e.splitGroup));
        return expExpenses.filter(e =>
            e.projectId === expCurrentProject.id ||
            (e.splitGroup && splitGroups.has(e.splitGroup))
        );
    })() : expExpenses;

    const { name, category, amtMin, amtMax, month } = _expSearch;
    const filtered = _tblPeriodSource.filter(e => {
        if (name && !(e.expenseName || '').toLowerCase().includes(name.toLowerCase())) return false;
        if (category && e.category !== category) return false;
        if (amtMin !== '' && (e.amount || 0) < parseFloat(amtMin)) return false;
        if (amtMax !== '' && (e.amount || 0) > parseFloat(amtMax)) return false;
        if (month && e.dateTime) {
            const d = new Date(e.dateTime);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
            if (key !== month) return false;
        }
        return true;
    });

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="exp-empty-row">🔍 No expenses match your filters.</td></tr>';
        _updateExpSearchCount(0, expExpenses.length);
        return;
    }

    // Retroactively detect cover expenses: sort each project's expenses by date,
    // accumulate spend, and flag any expense that pushed the project over budget.
    const _projExpMap = {};
    expExpenses.forEach(e => {
        if (!_projExpMap[e.projectId]) _projExpMap[e.projectId] = [];
        _projExpMap[e.projectId].push(e);
    });
    const _coverSet = new Set();
    Object.keys(_projExpMap).forEach(pid => {
        const proj = expProjects.find(p => p.id === pid);
        if (!proj || proj.fundingType === 'president') return;
        const budget = proj.monthlyBudget || 0;
        const sorted = _projExpMap[pid].slice().sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
        let cum = 0;
        sorted.forEach(e => {
            cum += (e.amount || 0);
            if (e.coverExpense || cum > budget) _coverSet.add(e.id);
        });
    });

    // Render a single expense row. In flat (All Categories) mode we prepend a
    // small category badge next to the name so mixed categories stay readable.
    const _renderExpRow = (e, showCategoryBadge) => {
        const srcProj = expProjects.find(p => p.id === e.projectId);
        const fundingBadge = (_coverSet.has(e.id) || e.coverExpense) ? _fundingBadgeHTML(null, true) : (srcProj ? _fundingBadgeHTML(srcProj, false) : '');
        const catBadge = showCategoryBadge ? getCategoryPillHTML(e.category) : '';
        const invBadge = e.inInventory ? '<span style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;padding:1px 7px;border-radius:999px;background:#ecfdf5;color:#15803d;font-size:10.5px;font-weight:700;border:1px solid #a7f3d0;">📦 In Inventory</span>' : '';
        return `
        <tr class="exp-group-row">
            <td>${formatDate(e.dateTime)}</td>
            <td><strong>${_highlightMatch(e.expenseName || '—', name)}</strong>${catBadge}${fundingBadge}${invBadge}</td>
            <td class="exp-notes-cell">${e.notes ? '<span class="exp-notes-text">' + e.notes + '</span>' : '<span class="exp-notes-empty">—</span>'}</td>
            <td>${e.quantity || 1}</td>
            <td>₱${formatNum(e.amount)}</td>
            <td>${getReceiptThumbsHTML(e)}</td>
            <td class="exp-action-cell">
                <button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="openEditExpenseModal('${e.id}')"><i data-lucide="pencil"></i></button>
                <button class="exp-icon-btn exp-icon-btn-danger" title="Delete" onclick="deleteExpense('${e.id}')"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`;
    };

    let html = '';
    if (!category) {
        // "All Categories" → flat list, latest first, all categories mixed.
        const flat = filtered.slice().sort((a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0));
        flat.forEach(e => { html += _renderExpRow(e, true); });
    } else {
        // A specific category is selected → keep the grouped view.
        const groups = {};
        filtered.forEach(e => {
            const key = e.category || 'Uncategorized';
            if (!groups[key]) groups[key] = [];
            groups[key].push(e);
        });
        Object.entries(groups).forEach(([category, items]) => {
            const cat = expCategories.find(c => c.name === category);
            const color = cat ? cat.color : '#9ca3af';
            const subtotal = items.reduce((s, e) => s + (e.amount || 0), 0);
            const r = parseInt((color.replace('#','')).substring(0,2),16);
            const g = parseInt((color.replace('#','')).substring(2,4),16);
            const b = parseInt((color.replace('#','')).substring(4,6),16);
            html += `
        <tr class="exp-group-header">
            <td colspan="7">
                <div class="exp-group-header-inner" style="--cat-color:${color};--cat-bg:rgba(${r},${g},${b},0.08);border-left-color:${color}">
                    <span class="exp-group-dot" style="background:${color}"></span>
                    <span class="exp-group-name" style="color:${color}">${category}</span>
                    <span class="exp-group-count">${items.length} item${items.length > 1 ? 's' : ''}</span>
                    <span class="exp-group-subtotal">₱${formatNum(subtotal)}</span>
                </div>
            </td>
        </tr>`;
            items.sort((a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0));
            items.forEach(e => { html += _renderExpRow(e, false); });
        });
    }
    const grandTotal = filtered.reduce((s, e) => s + (e.amount || 0), 0);
    html += `
        <tr class="exp-total-row">
            <td colspan="4"></td>
            <td class="exp-total-label">TOTAL</td>
            <td class="exp-total-value">₱${formatNum(grandTotal)}</td>
            <td></td>
        </tr>`;

    tbody.innerHTML = html;
    _updateExpSearchCount(filtered.length, expExpenses.length);
    if (window.lucide) lucide.createIcons();
}

// ════════════════════════════════════════════════════════════
// SEARCH HELPERS
// ════════════════════════════════════════════════════════════
function applyExpenseSearch() {
    _expSearch.name     = document.getElementById('expSearchName')?.value     || '';
    _expSearch.category = document.getElementById('expSearchCategory')?.value || '';
    _expSearch.amtMin   = document.getElementById('expSearchAmtMin')?.value   || '';
    _expSearch.amtMax   = document.getElementById('expSearchAmtMax')?.value   || '';
    _expSearch.month    = document.getElementById('expSearchMonth')?.value    || '';

    const hasFilter = Object.values(_expSearch).some(v => v !== '');
    const clearBtn = document.getElementById('expSearchClearBtn');
    if (clearBtn) clearBtn.style.display = hasFilter ? 'inline-flex' : 'none';
    _renderFilterChips();
    renderExpensesTable();
}

function clearExpenseSearch() {
    _expSearch = { name: '', category: '', amtMin: '', amtMax: '', month: '' };
    ['expSearchName','expSearchCategory','expSearchAmtMin','expSearchAmtMax',
     'expSearchMonth'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const clearBtn = document.getElementById('expSearchClearBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    _renderFilterChips();
    renderExpensesTable();
}

function _updateExpSearchCount(shown, total) {
    const count = document.getElementById('expSearchCount');
    const bar   = document.getElementById('expFilterBar');
    if (!count || !bar) return;
    const hasFilter = Object.values(_expSearch).some(v => v !== '');
    if (total > 0) {
        bar.style.display = 'flex';
        if (hasFilter && shown < total) {
            count.textContent = `Showing ${shown} of ${total} expenses`;
            count.className = 'exp-filter-count filtered';
        } else {
            count.textContent = `${total} expense${total !== 1 ? 's' : ''}`;
            count.className = 'exp-filter-count';
        }
    } else {
        bar.style.display = 'none';
    }
    _renderFilterChips();
}

function _renderFilterChips() {
    const wrap = document.getElementById('expFilterChips');
    if (!wrap) return;
    const chips = [];
    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    if (_expSearch.name)
        chips.push({ label: `Name: "${_expSearch.name}"`, clear: () => { document.getElementById('expSearchName').value=''; _expSearch.name=''; }});
    if (_expSearch.category)
        chips.push({ label: `📂 ${_expSearch.category}`, clear: () => { document.getElementById('expSearchCategory').value=''; _expSearch.category=''; }});
    if (_expSearch.amtMin || _expSearch.amtMax) {
        const lo = _expSearch.amtMin ? `₱${_expSearch.amtMin}` : '₱0';
        const hi = _expSearch.amtMax ? `₱${_expSearch.amtMax}` : '∞';
        chips.push({ label: `Amount: ${lo}–${hi}`, clear: () => {
            ['expSearchAmtMin','expSearchAmtMax'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
            _expSearch.amtMin=''; _expSearch.amtMax='';
        }});
    }
    if (_expSearch.month) {
        const [yr, mo] = _expSearch.month.split('-');
        chips.push({ label: `📅 ${monthNames[parseInt(mo)-1]} ${yr}`, clear: () => { document.getElementById('expSearchMonth').value=''; _expSearch.month=''; }});
    }
    if (!chips.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = chips.map((c, i) => `<span class="exp-chip" onclick="_clearChip(${i})">${c.label} <span class="exp-chip-x">×</span></span>`).join('');
    wrap._chipClears = chips.map(c => c.clear);
}

function _clearChip(i) {
    const wrap = document.getElementById('expFilterChips');
    if (wrap && wrap._chipClears && wrap._chipClears[i]) {
        wrap._chipClears[i]();
        applyExpenseSearch();
    }
}

function _highlightMatch(text, query) {
    if (!query || !text) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return text.slice(0, idx)
        + `<mark class="exp-search-highlight">${text.slice(idx, idx + query.length)}</mark>`
        + text.slice(idx + query.length);
}

function populateExpSearchCategories() {
    const sel = document.getElementById('expSearchCategory');
    if (!sel) return;
    // Same two groups as the entry form, so a role you can tag with is also a role
    // you can filter by.
    sel.innerHTML = _expCategoryOptionsHtml(sel.value, 'All Categories');
}

function populateMonthDropdown() {
    const sel = document.getElementById('expSearchMonth');
    if (!sel) return;
    const current = sel.value;
    const monthSet = new Set();
    expExpenses.forEach(e => {
        if (!e.dateTime) return;
        const d = new Date(e.dateTime);
        monthSet.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    });
    const months = Array.from(monthSet).sort().reverse();
    const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    sel.innerHTML = '<option value="">📅 All Months</option>' +
        months.map(key => {
            const [yr, mo] = key.split('-');
            return `<option value="${key}" ${key===current?'selected':''}>${names[parseInt(mo)-1]} ${yr}</option>`;
        }).join('');
}

// ════════════════════════════════════════════════════════════
// PAYROLL TABLE
// ════════════════════════════════════════════════════════════
function renderPayrollTable() {
    const tbody = document.getElementById('payrollTbody');
    if (!tbody) return;
    if (!expCurrentProject && !expCurrentFolder) {
        tbody.innerHTML = '<tr><td colspan="8" class="exp-empty-row">👈 Select a project from the list.</td></tr>';
        return;
    }
    // When a specific month/project is selected (not folder view), restrict to that period's payroll
    const _payMonthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const _payPeriodSource = expCurrentProject && !expCurrentFolder ? expPayroll.filter(pr => {
        if (!expCurrentProject.folderId) return true;
        if (!pr.paymentDate) return false;
        const d = new Date(pr.paymentDate);
        return _payMonthNames[d.getMonth()] === expCurrentProject.month && d.getFullYear() === Number(expCurrentProject.year);
    }) : expPayroll;

    const name = _paySearch.name || '';
    const filtered = name
        ? _payPeriodSource.filter(p => (p.workerName || '').toLowerCase().includes(name.toLowerCase()))
        : _payPeriodSource;

    if (!_payPeriodSource.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="exp-empty-row">No payroll entries yet. Click ＋ Add Payroll Entry.</td></tr>';
        return;
    }
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="exp-empty-row">🔍 No workers match your search.</td></tr>';
        _updatePaySearchCount(0, _payPeriodSource.length);
        return;
    }

    const grandTotal = filtered.reduce((s, p) => s + (p.totalSalary || 0), 0);

    tbody.innerHTML = filtered.map(p => `
        <tr>
            <td>${formatDate(p.paymentDate)}</td>
            <td><strong>${_highlightMatch(p.workerName || '—', name)}</strong></td>
            <td>${p.role || '—'}</td>
            <td class="exp-notes-cell">${p.notes ? '<span class="exp-notes-text">' + p.notes + '</span>' : '<span class="exp-notes-empty">—</span>'}</td>
            <td>${p.daysWorked || 0}</td>
            <td>${_payRecIsLamsam(p) ? 'Lump Sum' : '₱'+formatNum(p.dailyRate)}</td>
            <td>₱${formatNum(p.totalSalary)}</td>
            <td>${getReceiptThumbsHTML(p)}</td>
            <td class="exp-action-cell">
                <button class="exp-icon-btn exp-icon-btn-view" title="View All Receipts" onclick="openWorkerSummaryModal('${(p.workerName||'').replace(/'/g,"\\'")}')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></button>
                <button class="exp-icon-btn exp-icon-btn-invoice" title="Acknowledge Invoice" onclick="printSinglePayrollInvoice('${p.id}')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
                <button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="openEditPayrollModal('${p.id}')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="exp-icon-btn exp-icon-btn-danger" title="Delete" onclick="deletePayroll('${p.id}')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </td>
        </tr>`).join('') + `
        <tr class="exp-total-row">
            <td colspan="6"></td>
            <td class="exp-total-label">TOTAL</td>
            <td class="exp-total-value">₱${formatNum(grandTotal)}</td>
            <td></td>
        </tr>`;

    _updatePaySearchCount(filtered.length, expPayroll.length);
    if (window.lucide) lucide.createIcons();

}

function applyPayrollSearch() {
    _paySearch.name = document.getElementById('paySearchName')?.value || '';
    const hasFilter = !!_paySearch.name;
    const clearBtn  = document.getElementById('paySearchClearBtn');
    if (clearBtn) clearBtn.style.display = hasFilter ? 'inline-flex' : 'none';
    renderPayrollTable();
}

function clearPayrollSearch() {
    _paySearch.name = '';
    const el = document.getElementById('paySearchName');
    if (el) el.value = '';
    const clearBtn = document.getElementById('paySearchClearBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    const count = document.getElementById('paySearchCount');
    if (count) count.style.display = 'none';
    renderPayrollTable();
}

function _updatePaySearchCount(shown, total) {
    const count = document.getElementById('paySearchCount');
    if (!count) return;
    if (_paySearch.name) {
        count.textContent = `Showing ${shown} of ${total} entries`;
        count.style.display = 'inline-block';
    } else {
        count.style.display = 'none';
    }
}

// ════════════════════════════════════════════════════════════
// PROJECT CRUD
// ════════════════════════════════════════════════════════════
let _pendingFolderId = null;

// Called from the "New Billing Period" button in the folder detail header.
// Reads the active folder from state so folderId is always correct.
function openNewBillingPeriodModal() {
    const folderId = expCurrentFolder?.id || _mvpCurrentFolderId || null;
    openCreateMonthModal(folderId);
}

function openCreateMonthModal(folderId, defaultFundingType) {
    _pendingFolderId = folderId;
    const folder = expFolders.find(f => f.id === folderId);
    const label  = document.getElementById('createProjectFolderLabel');
    if (label) label.textContent = folder ? `📁 ${folder.name}` : '';
    document.getElementById('createProjectForm').reset();
    if (defaultFundingType) {
        const radio = document.querySelector(`input[name="fundingType"][value="${defaultFundingType}"]`);
        if (radio) { radio.checked = true; onFundingTypeChange(); }
    }

    // Load payment requests for the folder's client into the selector
    const wrap   = document.getElementById('pmPrSelectWrap');
    const select = document.getElementById('pmPrSelect');
    if (wrap && select && folder && folder.clientEmail) {
        wrap.style.display = '';
        select.innerHTML = '<option value="">— Select a payment request —</option>';
        db.collection('paymentRequests')
            .where('clientEmail', '==', folder.clientEmail)
            .get()
            .then(snap => {
                const statusLabel = { pending:'Pending', submitted:'Under Review', verified:'Paid', rejected:'Rejected', partial_pending:'Partial Pending', partial_approved:'Partial Approved' };
                // Sort: pending/submitted first, then others
                const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => {
                        const pri = s => (s === 'pending' || s === 'submitted') ? 0 : 1;
                        return pri(a.status) - pri(b.status) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
                    });
                docs.forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r.id;
                    const st  = statusLabel[r.status] || r.status;
                    const amt = '₱' + Number(r.amount || 0).toLocaleString('en-PH');
                    opt.textContent = `${r.billingPeriod || '—'}  ·  ${amt}  [${st}]`;
                    opt.dataset.period = r.billingPeriod || '';
                    opt.dataset.amount = r.amount || '';
                    select.appendChild(opt);
                });
            })
            .catch(() => { wrap.style.display = 'none'; });
    } else if (wrap) {
        wrap.style.display = 'none';
    }

    openExpModal('createProjectModal');
}

window.onFillFromPaymentRequest = function () {
    const select = document.getElementById('pmPrSelect');
    if (!select || !select.value) return;
    const opt    = select.options[select.selectedIndex];
    const period = opt.dataset.period || '';
    const amount = opt.dataset.amount || '';

    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    // Fill month only if the user has not already picked one.
    // Supports exact match ("March") or embedded match ("March 2026").
    const monthSel = document.getElementById('projMonth');
    if (monthSel && !monthSel.value) {
        const foundMonth = months.find(m => period.includes(m));
        if (foundMonth) monthSel.value = foundMonth;
    }

    // Fill year only if the user has not already entered one.
    const yearInput = document.getElementById('projYear');
    if (yearInput && !yearInput.value) {
        const yearMatch = period.match(/\b(20\d{2})\b/);
        if (yearMatch) yearInput.value = yearMatch[1];
    }

    // Always fill amount (this is the main purpose of the feature)
    const budgetInput = document.getElementById('projBudget');
    if (budgetInput && amount) {
        budgetInput.value = Number(amount).toLocaleString('en-PH');
    }
};

function onFundingTypeChange() {
    const val = document.querySelector('input[name="fundingType"]:checked')?.value || 'downpayment';
    const isCover     = val === 'president';
    const budgetGroup = document.getElementById('projBudgetGroup');
    const budgetLabel = document.getElementById('projBudgetLabel');
    const budgetInput = document.getElementById('projBudget');
    const hint        = document.getElementById('progressBillingHint');

    if (budgetGroup) budgetGroup.style.display = isCover ? 'none' : '';
    if (budgetInput) { budgetInput.required = !isCover; if (isCover) budgetInput.value = ''; }

    const labels = { mobilization: 'Mobilization Amount (₱)', downpayment: 'Downpayment Amount (₱)', progress: 'Progress Billing Amount (₱)', final: 'Final Payment Amount (₱)' };
    if (budgetLabel) budgetLabel.textContent = labels[val] || 'Amount (₱)';

    if (hint) {
        if (val === 'progress') {
            const fid   = _pendingFolderId;
            const count = expProjects.filter(p => p.folderId === (fid || null) && p.fundingType === 'progress').length;
            hint.textContent = '📋 This will be Progress Billing #' + (count + 1);
            hint.style.display = '';
        } else {
            hint.style.display = 'none';
        }
    }
}

async function handleCreateProject(e) {
    e.preventDefault();
    const month       = document.getElementById('projMonth').value;
    const year        = parseInt(document.getElementById('projYear').value);
    const fundingType = document.querySelector('input[name="fundingType"]:checked')?.value || 'downpayment';
    const isPresident = fundingType === 'president';
    const budget      = isPresident ? 0 : parseFloat(document.getElementById('projBudget').value.replace(/,/g, '')) || 0;
    const folderId    = _pendingFolderId;
    if (!month || !year) return;
    if (!isPresident && (isNaN(budget) || budget < 0)) return;

    // Auto-number progress billings
    let billingNumber = null;
    if (fundingType === 'progress') {
        billingNumber = expProjects.filter(p => p.folderId === (folderId || null) && p.fundingType === 'progress').length + 1;
    }

    const dupe = expProjects.find(p =>
        p.month === month && p.year === year && p.folderId === (folderId || null)
        && p.fundingType === fundingType
    );
    if (dupe) {
        showExpNotif(`${month} ${year} already has a ${fundingType} period in this folder.`, 'error'); return;
    }
    try {
        showExpLoading('createProjectBtn', true);
        const data = {
            userId: _uid(), month, year,
            fundingType: fundingType,
            ...(billingNumber !== null && { billingNumber }),
            folderId: folderId || null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        const ref = await db.collection('projects').add(data);
        // Fund allocated is confidential — stored in the owner-only
        // projectBudgets collection, never on the staff-readable project doc.
        if (window.currentUserRole !== 'staff' && budget > 0) {
            await db.collection('projectBudgets').doc(ref.id).set({ userId: _uid(), monthlyBudget: budget });
        }
        if (folderId) _expandedFolders.add(folderId);
        showExpNotif('Month added!', 'success');
        document.getElementById('createProjectForm').reset();
        _pendingFolderId = null;
        closeExpModal('createProjectModal');
        selectProject(ref.id);
    } catch (err) {
        showExpNotif('Error: ' + err.message, 'error');
    } finally {
        showExpLoading('createProjectBtn', false);
    }
}

// ════════════════════════════════════════════════════════════
// FOLDER CRUD
// ════════════════════════════════════════════════════════════
async function handleCreateFolder(e) {
    e.preventDefault();
    const name   = document.getElementById('folderName').value.trim();
    const desc   = document.getElementById('folderDesc').value.trim();
    const budget = parseFloat((document.getElementById('folderBudget').value || '').replace(/,/g, '')) || 0;
    if (!name) return;
    try {
        showExpLoading('createFolderBtn', true);
        const ref = await db.collection('folders').add({
            userId: _uid(), name, description: desc,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Contract value is confidential — stored in the owner-only folderBudgets
        // collection, never on the staff-readable folder doc.
        if (window.currentUserRole !== 'staff' && budget > 0) {
            await db.collection('folderBudgets').doc(ref.id).set({ userId: _uid(), totalBudget: budget });
        }
        _expandedFolders.add(ref.id);
        showExpNotif('Project folder created!', 'success');
        document.getElementById('createFolderForm').reset();
        closeExpModal('createFolderModal');
    } catch (err) {
        showExpNotif('Error: ' + err.message, 'error');
    } finally {
        showExpLoading('createFolderBtn', false);
    }
}

let _editingFolderId = null;
function openEditFolderModal(id) {
    const f = expFolders.find(x => x.id === id);
    if (!f) return;
    _editingFolderId = id;
    document.getElementById('editFolderName').value   = f.name        || '';
    document.getElementById('editFolderDesc').value   = f.description || '';
    document.getElementById('editFolderBudget').value = f.totalBudget ? Number(f.totalBudget).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
    openExpModal('editFolderModal');
}

async function handleEditFolder(e) {
    e.preventDefault();
    if (!_editingFolderId) return;
    const name   = document.getElementById('editFolderName').value.trim();
    const desc   = document.getElementById('editFolderDesc').value.trim();
    const budget = parseFloat((document.getElementById('editFolderBudget').value || '').replace(/,/g, '')) || 0;
    try {
        showExpLoading('editFolderBtn', true);
        await db.collection('folders').doc(_editingFolderId).update({
            name, description: desc
        });
        // Update confidential contract value in the owner-only collection.
        if (window.currentUserRole !== 'staff') {
            await db.collection('folderBudgets').doc(_editingFolderId)
                .set({ userId: _uid(), totalBudget: budget }, { merge: true });
        }
        showExpNotif('Folder updated!', 'success');
        closeExpModal('editFolderModal');
        _editingFolderId = null;
    } catch (err) {
        showExpNotif('Error: ' + err.message, 'error');
    } finally {
        showExpLoading('editFolderBtn', false);
    }
}

async function deleteFolder(id) {
    const folder = expFolders.find(f => f.id === id);
    const count  = expProjects.filter(p => p.folderId === id).length;
    const msg    = count > 0
        ? `Delete folder "${folder?.name}" and its ${count} month(s)? All expenses & payroll inside will also be deleted.`
        : `Delete folder "${folder?.name}"?`;
    if (!await showDeleteConfirm(msg)) return;
    try {
        const uid = _uid();
        const projsInFolder = expProjects.filter(p => p.folderId === id);
        for (const p of projsInFolder) {
            const [eSnap, paySnap] = await Promise.all([
                db.collection('expenses').where('projectId','==',p.id).where('userId','==',uid).get(),
                db.collection('payroll').where('projectId','==',p.id).where('userId','==',uid).get()
            ]);
            const batch = db.batch();
            eSnap.docs.forEach(d => batch.delete(d.ref));
            paySnap.docs.forEach(d => batch.delete(d.ref));
            batch.delete(db.collection('projects').doc(p.id));
            // Confidential budget doc is owner-only — only the owner can delete it.
            if (window.currentUserRole !== 'staff') batch.delete(db.collection('projectBudgets').doc(p.id));
            await batch.commit();
        }
        await db.collection('folders').doc(id).delete();
        if (window.currentUserRole !== 'staff') {
            await db.collection('folderBudgets').doc(id).delete().catch(() => {});
        }
        _expandedFolders.delete(id);
        if (expCurrentProject && expProjects.find(p => p.id === expCurrentProject.id)?.folderId === id) {
            expCurrentProject = null;
            updateBudgetOverview();
        }
        showExpNotif('Folder deleted.', 'success');
    } catch (err) {
        showExpNotif('Error: ' + err.message, 'error');
    }
}

async function deleteProject(id) {
    if (!await showDeleteConfirm('Delete this project and ALL its expenses & payroll?')) return;
    try {
        const uid = _uid();
        const [eSnap, pSnap] = await Promise.all([
            db.collection('expenses').where('projectId','==',id).where('userId','==',uid).get(),
            db.collection('payroll').where('projectId','==',id).where('userId','==',uid).get()
        ]);
        const batch = db.batch();
        eSnap.docs.forEach(d => batch.delete(d.ref));
        pSnap.docs.forEach(d => batch.delete(d.ref));
        batch.delete(db.collection('projects').doc(id));
        // Confidential budget doc is owner-only — only the owner can delete it.
        if (window.currentUserRole !== 'staff') batch.delete(db.collection('projectBudgets').doc(id));
        await batch.commit();
        if (expCurrentProject?.id === id) {
            expCurrentProject = null; expExpenses = []; expPayroll = [];
        }
        showExpNotif('Project deleted.', 'success');
        await loadProjects();
    } catch (err) {
        showExpNotif('Error: ' + err.message, 'error');
    }
}

// ════════════════════════════════════════════════════════════
// EXPENSE FORM
// ════════════════════════════════════════════════════════════
function setupExpenseFormListeners() {
    const form = document.getElementById('addExpenseForm');
    if (!form) return;
    const qty  = document.getElementById('expQty');
    const cost = document.getElementById('expUnitCost');
    const amt  = document.getElementById('expAmount');
    const recalc = () => { if (amt) { amt.value = fmtBudgetVal((parseFloat(qty?.value) || 1) * (parseFloat((cost?.value||'').replace(/,/g,'')) || 0)); _updateExpSplitPreview(); } };
    qty?.addEventListener('input', recalc);
    cost?.addEventListener('input', recalc);
    // A required field (the date) lives inside the collapsed "More details" panel.
    // The browser cannot focus a hidden invalid control, so it would refuse to submit
    // with no visible reason. Open the panel first so the message is shown.
    form.addEventListener('invalid', (ev) => {
        if (document.getElementById('expMoreDetails')?.contains(ev.target)) {
            window.expSetMoreDetails(true);
        }
    }, true);
    form.addEventListener('submit', handleAddExpense);
}

let _stagedPayReceipts = [];

function compressImageToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                const MAX = 900;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) {
                    if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                    else       { w = Math.round(w * MAX / h); h = MAX; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.75));
            };
            img.onerror = reject;
            img.src = ev.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function handleAddExpense(e) {
    e.preventDefault();

    // Build split list from checked sources
    const checkedBoxes = Array.from(document.querySelectorAll('input[name="expFundingSrc"]:checked'));
    const checkedSources = checkedBoxes.map(cb => _expSources.find(s => s.id === cb.value)).filter(Boolean);

    // Additional Works has no monthly budget / Cover Expenses concept —
    // always record straight against the current period as a normal expense.
    if (_expIsAdditionalWorks() && expCurrentProject) {
        checkedSources.length = 0;
        checkedSources.push({ id: expCurrentProject.id, remain: Infinity, label: 'Additional Works' });
    }

    // Fallback to hidden select or current project
    const fsSel = document.getElementById('expFundingSourceSelect');
    if (!checkedSources.length && _expCoverExpensesMode) {
        const fallbackId = (fsSel && fsSel.value) ? fsSel.value : (expCurrentProject ? expCurrentProject.id : null);
        if (!fallbackId) { showExpNotif('No funding source selected.', 'error'); return; }
        checkedSources.push({ id: fallbackId, remain: 0, label: 'Cover Expenses' });
    }
    if (!checkedSources.length) { showExpNotif('Select at least one funding source.', 'error'); return; }

    const totalAmt   = parseFloat((document.getElementById('expAmount').value || '').replace(/,/g, '')) || 0;
    const expName    = document.getElementById('expName').value.trim();
    const category   = document.getElementById('expCategory').value;
    const qty        = parseFloat(document.getElementById('expQty').value) || 1;
    const dateTime   = _buildDateTime('expDate', 'expTime');
    const notes      = document.getElementById('expNotes').value.trim();
    const paymentMethod = (document.getElementById('expPaymentMethod')?.value || '').trim();
    // Inventory toggle — when on, this material is also tracked as a stock item.
    const toInventory = !!document.getElementById('expToInventory')?.checked;
    const invUnit     = document.getElementById('expInvUnit')?.value || 'pcs';
    const invMinStock = parseFloat(document.getElementById('expInvMinStock')?.value) || 0;
    // Supporting docs (PO/DR/SI/PR) — compress only those the user selected
    const _docMap = { po: 'expDocPO', dr: 'expDocDR', si: 'expDocSI', pay: 'expDocPR' };
    const docUrls = {};
    for (const [key, inputId] of Object.entries(_docMap)) {
        const file = document.getElementById(inputId)?.files?.[0];
        if (file) {
            try { docUrls[key] = await compressImageToBase64(file); } catch (_) {}
        }
    }

    // Priority split: lowest remaining first; true overflow → Cover Expenses record
    const sortedSources = [...checkedSources].sort((a, b) => a.remain - b.remain);
    let left = totalAmt;
    const splits = [];
    for (const s of sortedSources) {
        if (left <= 0) break;
        const charge = s.remain > 0 ? Math.min(s.remain, left) : 0;
        if (charge > 0) { left -= charge; splits.push({ projectId: s.id, amount: charge, coverExpense: false }); }
    }
    // Any remaining overflow → Cover Expenses (use current project id, flagged as cover)
    if (left > 0) {
        const fid = expCurrentProject?.folderId;
        const coverProj = fid ? expProjects.find(p => p.folderId === fid && p.fundingType === 'president') : null;
        const coverId = coverProj?.id || expCurrentProject?.id || splits[splits.length - 1]?.projectId;
        splits.push({ projectId: coverId, amount: left, coverExpense: true });
    }

    try {
        showExpLoading('addExpenseBtn', true);

        const batch = db.batch();
        splits.forEach((sp, idx) => {
            const ref = db.collection('expenses').doc();
            batch.set(ref, {
                projectId:     sp.projectId,
                userId:        _uid(),
                expenseName:   expName + (splits.length > 1 ? ' (' + (idx + 1) + '/' + splits.length + ')' : ''),
                category,
                quantity:      splits.length > 1 ? 1 : qty,
                amount:        sp.amount,
                dateTime,
                notes,
                ...(paymentMethod ? { paymentMethod } : {}),
                // Supporting documents (PO/DR/SI/PR) attached only to the first split record.
                // Payment Receipt (PR) is the single proof-of-payment field — multi-image receipts removed.
                ...(idx === 0 && docUrls.po  ? { poImageUrl:         docUrls.po  } : {}),
                ...(idx === 0 && docUrls.dr  ? { deliveryReceiptUrl: docUrls.dr  } : {}),
                ...(idx === 0 && docUrls.si  ? { supplierInvoiceUrl: docUrls.si  } : {}),
                ...(idx === 0 && docUrls.pay ? { paymentReceiptUrl:  docUrls.pay } : {}),
                createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
                ...(toInventory ? { inInventory: true } : {}),
                ...(sp.coverExpense && { coverExpense: true }),
                ...(splits.length > 1 && { splitGroup: dateTime + '_' + expName, splitIndex: idx + 1, splitTotal: splits.length })
            });
        });
        await batch.commit();

        // Mirror to the shared Construction inventory when flagged as a stock item.
        if (toInventory && expName) {
            try { await _addExpenseToInventory(expName, qty, invUnit, invMinStock, notes); }
            catch (e) { console.warn('Inventory sync failed:', e); showExpNotif('Saved, but inventory sync failed: ' + e.message, 'error'); }
        }

        const msg = toInventory
            ? 'Expense added & sent to inventory ✓'
            : (splits.length > 1
                ? `Split into ${splits.length} records across funding sources ✓`
                : 'Expense added! ✓');
        showExpNotif(msg, 'success');
        refreshOvAllData();

        document.getElementById('addExpenseForm').reset();
        document.getElementById('expSplitPreview').style.display = 'none';
        if (typeof window.expToggleInventoryFields === 'function') window.expToggleInventoryFields();
        closeExpModal('addExpenseModal');
    } catch (err) {
        showExpNotif('Error saving expense: ' + err.message, 'error');
        console.error(err);
    } finally {
        showExpLoading('addExpenseBtn', false);
    }
}

async function deleteExpense(id) {
    if (!await showDeleteConfirm('Delete this expense?')) return;
    try { await db.collection('expenses').doc(id).delete(); showExpNotif('Deleted.', 'success'); refreshOvAllData(); }
    catch (err) { showExpNotif('Error: ' + err.message, 'error'); }
}

// Show/hide the Unit + Min Stock fields based on the "Add to Inventory" toggle.
window.expToggleInventoryFields = function () {
    const on  = !!document.getElementById('expToInventory')?.checked;
    const box = document.getElementById('expInventoryFields');
    if (box) box.style.display = on ? 'block' : 'none';
};

// "More details" disclosure on the Add Expense modal (payment method, date, notes,
// inventory). Pass `true`/`false` to force a state, or nothing to flip it.
window.expSetMoreDetails = function (open) {
    const box    = document.getElementById('expMoreDetails');
    const toggle = document.getElementById('expMoreToggle');
    const label  = document.getElementById('expMoreLabel');
    if (!box) return;
    if (open === undefined) open = box.style.display === 'none';
    box.style.display = open ? 'block' : 'none';
    if (toggle) { toggle.classList.toggle('open', open); toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    if (label) label.textContent = open ? 'Fewer details' : 'More details — payment, date, notes';
};
window.expToggleMoreDetails = function () { window.expSetMoreDetails(); };

// Stock-in to the shared Construction inventory. If an item with the same name
// already exists, the quantity is added to its current stock; otherwise a new
// inventory item is created. (The expense itself still lives in Materials.)
async function _addExpenseToInventory(itemName, qty, unit, minStock, notes) {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const by  = (firebase.auth().currentUser || {}).uid || null;
    const addQty = parseFloat(qty) || 0;
    const snap = await db.collection('inventory').where('itemName', '==', itemName).limit(1).get();
    if (!snap.empty) {
        const doc = snap.docs[0];
        const cur = parseFloat(doc.data().currentStock) || 0;
        await doc.ref.update({ currentStock: cur + addQty, lastUpdated: now, lastAdjustedBy: by });
    } else {
        await db.collection('inventory').add({
            itemName,
            unit:         unit || 'pcs',
            currentStock: addQty,
            minStock:     parseFloat(minStock) || 0,
            notes:        notes || null,
            lastUpdated:    now,
            lastAdjustedBy: by,
            createdAt:      now
        });
    }
}

// ════════════════════════════════════════════════════════════
// PAYROLL FORM
// ════════════════════════════════════════════════════════════
// ── Lamsam (lump-sum) payroll ──────────────────────────────
// A lamsam entry is paid as a fixed total with NO daily rate. It is stored as
// dailyRate = 0 + a manually-entered total (no DB column needed — a real
// daily-rate entry always has a rate > 0, so dailyRate==0 marks a lamsam).
function _payIsLamsam()     { return ((document.querySelector('input[name="payMode"]:checked')     || {}).value) === 'lamsam'; }
function _editPayIsLamsam() { return ((document.querySelector('input[name="editPayMode"]:checked') || {}).value) === 'lamsam'; }
function _payRecIsLamsam(p) { return p && !parseFloat(p.dailyRate) && (parseFloat(p.totalSalary) || 0) > 0; }

// Sync the form UI to the selected mode. UI only — never recomputes the total
// (so opening an existing entry preserves its saved total, incl. split rows).
function _applyPayMode(isLamsam, ids) {
    const rateGroup = document.getElementById(ids.rateGroup);
    const rate      = document.getElementById(ids.rate);
    const tot       = document.getElementById(ids.total);
    const hint      = document.getElementById(ids.hint);
    if (rateGroup) rateGroup.style.display = isLamsam ? 'none' : '';
    if (rate)      { rate.required = !isLamsam; if (isLamsam) rate.value = ''; }
    if (tot)       tot.readOnly = !isLamsam;
    if (hint)      hint.textContent = isLamsam ? '' : '(auto-computed)';
}
function _recomputePayTotal(ids) {
    const tot = document.getElementById(ids.total);
    if (!tot) return;
    const d = parseFloat((document.getElementById(ids.days) || {}).value) || 0;
    const r = parseFloat(((document.getElementById(ids.rate) || {}).value || '').replace(/,/g, '')) || 0;
    tot.value = fmtBudgetVal(d * r);
}
window.payToggleMode = function () {
    const ids = { rateGroup: 'payRateGroup', rate: 'payDailyRate', total: 'payTotal', hint: 'payTotalHint', days: 'payDays' };
    const lam = _payIsLamsam();
    _applyPayMode(lam, ids);
    if (!lam) _recomputePayTotal(ids);          // user switched back to Daily Rate
    if (typeof _updatePaySplitPreview === 'function') _updatePaySplitPreview();
};
window.editPayToggleMode = function () {
    const ids = { rateGroup: 'editPayRateGroup', rate: 'editPayDailyRate', total: 'editPayTotal', hint: 'editPayTotalHint', days: 'editPayDays' };
    const lam = _editPayIsLamsam();
    _applyPayMode(lam, ids);
    if (!lam) _recomputePayTotal(ids);
};
// Add Payroll redesign — milestone segmented buttons drive the hidden #payMilestone input.
window.paySetMilestone = function (el, val) {
    const row = document.getElementById('payMilestoneRow');
    const inp = document.getElementById('payMilestone');
    if (!row) return;
    const wasOn = el.classList.contains('on');
    row.querySelectorAll('.apr-mile').forEach(b => b.classList.remove('on'));
    if (wasOn) { if (inp) inp.value = ''; }          // click the active one again → clear
    else { el.classList.add('on'); if (inp) inp.value = val; }
};
window.payResetMilestone = function () {
    const row = document.getElementById('payMilestoneRow');
    if (row) row.querySelectorAll('.apr-mile').forEach(b => b.classList.remove('on'));
    const inp = document.getElementById('payMilestone');
    if (inp) inp.value = '';
};
// Edit Payroll redesign — milestone segmented buttons → hidden #editPayMilestone.
window.editPaySetMilestone = function (el, val) {
    const row = document.getElementById('editPayMilestoneRow');
    const inp = document.getElementById('editPayMilestone');
    if (!row) return;
    const wasOn = el.classList.contains('on');
    row.querySelectorAll('.apr-mile').forEach(b => b.classList.remove('on'));
    if (wasOn) { if (inp) inp.value = ''; }
    else { el.classList.add('on'); if (inp) inp.value = val; }
};
// Set the milestone buttons + hidden value from a record (used when opening the edit modal).
window.editPayMileFromValue = function (val) {
    const row = document.getElementById('editPayMilestoneRow');
    const inp = document.getElementById('editPayMilestone');
    if (inp) inp.value = val || '';
    if (row) row.querySelectorAll('.apr-mile').forEach(b => b.classList.toggle('on', (b.getAttribute('data-mile') || '') === (val || '')));
};

function setupPayrollFormListeners() {
    const form = document.getElementById('addPayrollForm');
    if (!form) return;
    const days = document.getElementById('payDays');
    const rate = document.getElementById('payDailyRate');
    const tot  = document.getElementById('payTotal');
    const recalc = () => { if (_payIsLamsam()) { _updatePaySplitPreview(); return; } if (tot) { tot.value = fmtBudgetVal((parseFloat(days?.value) || 0) * (parseFloat((rate?.value||'').replace(/,/g,'')) || 0)); _updatePaySplitPreview(); } };
    days?.addEventListener('input', recalc);
    rate?.addEventListener('input', recalc);
    tot?.addEventListener('input', () => { if (_payIsLamsam()) _updatePaySplitPreview(); });
    form.addEventListener('submit', handleAddPayroll);

    // Wire up receipt image picker
    const receiptInput = document.getElementById('payReceipt');
    receiptInput?.addEventListener('change', (ev) => {
        const files = Array.from(ev.target.files);
        files.forEach(file => {
            if (file.size > 5 * 1024 * 1024) {
                showExpNotif(`"${file.name}" is over 5 MB and was skipped.`, 'error');
                return;
            }
            addPayReceiptPreviewItem(file);
        });
        ev.target.value = '';
    });
}

function addPayReceiptPreviewItem(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataURL = e.target.result;
        const index = _stagedPayReceipts.length;
        _stagedPayReceipts.push({ file, dataURL });

        const grid = document.getElementById('payReceiptGrid');
        if (!grid) return;
        grid.style.display = 'grid';

        const item = document.createElement('div');
        item.className = 'exp-receipt-thumb';
        item.dataset.index = index;
        item.innerHTML = `
            <img src="${dataURL}" alt="Receipt ${index + 1}">
            <button type="button" class="exp-receipt-remove" onclick="removePayReceiptPreview(${index})">✕</button>
            <span class="exp-receipt-num">${index + 1}</span>`;
        grid.appendChild(item);
    };
    reader.readAsDataURL(file);
}

function removePayReceiptPreview(index) {
    _stagedPayReceipts[index] = null;
    const grid = document.getElementById('payReceiptGrid');
    if (!grid) return;
    const item = grid.querySelector(`[data-index="${index}"]`);
    if (item) item.remove();
    const remaining = _stagedPayReceipts.filter(r => r !== null);
    if (!remaining.length) grid.style.display = 'none';
}

function clearPayReceiptPreview() {
    _stagedPayReceipts = [];
    const grid = document.getElementById('payReceiptGrid');
    if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }
    const input = document.getElementById('payReceipt');
    if (input) input.value = '';
}

function _updatePayBudgetBanner() {
    const fsWrap = document.getElementById('payFundingSourceWrap');
    const p   = expCurrentProject;
    const fid = p?.folderId || expCurrentFolder?.id;
    if (!p && !fid) { if (fsWrap) fsWrap.style.display = 'none'; return; }

    const folderMonths = expProjects.filter(m => m.folderId === fid && m.fundingType !== 'president' && (m.monthlyBudget || 0) > 0);
    const sources = folderMonths.map(m => {
        const spent = expExpenses.filter(e => e.projectId === m.id).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
                    + expPayroll.filter(pr => pr.projectId === m.id).reduce((s, pr) => s + (parseFloat(pr.totalSalary) || 0), 0);
        return { id: m.id, label: m.month + ' ' + m.year + ' · ' + _fundingLabel(m), remain: (m.monthlyBudget || 0) - spent, budget: m.monthlyBudget || 0 };
    });

    if (fsWrap) {
        const visibleSources = sources.filter(s => s.remain > 0);
        fsWrap.style.display = visibleSources.length ? 'block' : 'none';
        const list = document.getElementById('payFundingCheckList');
        if (list) {
            // If the active period isn't among the fundable sources, default to the first
            // one so a source is always selected (otherwise the save has nothing to charge).
            const pMatches = p && visibleSources.some(s => s.id === p.id);
            list.innerHTML = visibleSources.map((s, i) => {
                const isChecked = pMatches ? s.id === p.id : i === 0;
                const remClass  = s.remain < s.budget * 0.1 ? 'is-low' : '';
                return '<label class="exp-funding-check-item' + (isChecked ? ' is-checked' : '') + '">'
                    + '<input type="checkbox" name="payFundingSrc" value="' + s.id + '"'
                    + (isChecked ? ' checked' : '')
                    + ' onchange="payFundingCheckChanged(this)">'
                    + '<span class="exp-funding-check-item__label">' + s.label + '</span>'
                    + '<span class="exp-funding-check-item__remain ' + remClass + '">₱' + formatNum(s.remain) + ' left</span>'
                    + '</label>';
            }).join('');
        }
    }
    // Re-use _expSources so split logic works (same sources array)
    _expSources = sources;
    _updatePaySplitPreview();
}

function payFundingCheckChanged(cb) {
    const item = cb.closest('.exp-funding-check-item');
    if (item) item.classList.toggle('is-checked', cb.checked);
    _updatePaySplitPreview();
}

function _updatePaySplitPreview() {
    const preview = document.getElementById('paySplitPreview');
    if (!preview) return;
    const totalRaw = (document.getElementById('payTotal') || {}).value || '0';
    const total    = parseFloat(totalRaw.replace(/,/g, '')) || 0;
    const checked  = Array.from(document.querySelectorAll('input[name="payFundingSrc"]:checked'))
                        .map(cb => _expSources.find(s => s.id === cb.value))
                        .filter(Boolean);
    if (!checked.length || total <= 0) { preview.style.display = 'none'; return; }

    const totalAvailable = checked.reduce((s, src) => s + Math.max(src.remain, 0), 0);
    const overBudget     = total > totalAvailable;
    if (checked.length === 1 && !overBudget) { preview.style.display = 'none'; return; }

    const sorted = [...checked].sort((a, b) => a.remain - b.remain);
    let left = total;
    const splits = [];
    for (const s of sorted) {
        if (left <= 0) break;
        const charge = Math.min(s.remain > 0 ? s.remain : 0, left);
        if (charge > 0) { left -= charge; splits.push({ label: s.label, charge, isCover: false }); }
    }
    if (left > 0) splits.push({ label: '🏦 Cover Expenses', charge: left, isCover: true });

    preview.style.display = 'block';
    preview.innerHTML = '<div class="exp-split-preview">'
        + '<div class="exp-split-preview__header">' + (overBudget ? '⚠️ Over Budget' : '💡 Split Preview') + '</div>'
        + splits.map(sp => '<div class="exp-split-preview__row"><span class="exp-split-preview__name">' + sp.label + '</span>'
            + '<span class="exp-split-preview__amt' + (sp.isCover ? ' is-over' : '') + '">₱' + formatNum(sp.charge) + '</span></div>').join('')
        + '<div class="exp-split-preview__total"><span>Total</span><span>₱' + formatNum(total) + '</span></div>'
        + (overBudget ? '<div class="exp-split-preview__warn">⚠ ₱' + formatNum(total - totalAvailable) + ' over budget — excess charged to Cover Expenses</div>' : '')
        + '</div>';
}

async function handleAddPayroll(e) {
    e.preventDefault();

    // Build split list from checked sources
    const checkedBoxes = Array.from(document.querySelectorAll('input[name="payFundingSrc"]:checked'));
    const checkedSources = checkedBoxes.map(cb => _expSources.find(s => s.id === cb.value)).filter(Boolean);
    if (!checkedSources.length) {
        if (!expCurrentProject) { showExpNotif('Select a project first.', 'error'); return; }
        checkedSources.push({ id: expCurrentProject.id, remain: Infinity, label: 'Current Period' });
    }

    const _payLamsam = _payIsLamsam();
    const d = parseFloat((document.getElementById('payDays') || {}).value) || 0;
    const r = _payLamsam ? 0 : (parseFloat(((document.getElementById('payDailyRate') || {}).value || '').replace(/,/g, '')) || 0);
    const totalSalary = _payLamsam
        ? (parseFloat((document.getElementById('payTotal').value || '').replace(/,/g, '')) || 0)
        : (d * r);
    if (totalSalary <= 0) { showExpNotif(_payLamsam ? 'Enter the lump-sum total amount.' : 'Enter days worked and daily rate.', 'error'); return; }
    const workerName  = document.getElementById('payWorkerName').value.trim();
    const role        = document.getElementById('payRole').value.trim();
    const paymentDate = document.getElementById('payDate').value;
    const notes       = document.getElementById('payNotes').value.trim();
    const laborType   = (document.querySelector('input[name="payLaborType"]:checked') || {}).value || 'direct';
    // Statutory burden follows the worker class it was paid for (see payToggleContractForType).
    const liabilityFor = laborType === 'liability'
        ? ((document.querySelector('input[name="payLiabilityFor"]:checked') || {}).value || 'direct')
        : null;
    // Overhead / indirect pay can't be charged against a pakyaw contract.
    const contractId  = laborType === 'indirect' ? null : ((document.getElementById('payContract') || {}).value || null);
    const payMilestone = contractId ? ((document.getElementById('payMilestone') || {}).value || null) : null;

    // Pakyaw/capped contract: warn (but allow) if this draws the contract over its cap.
    if (contractId && !lcConfirmOverCap(contractId, totalSalary)) return;

    // Priority split: lowest remaining first; overflow → Cover Expenses
    const sortedSources = [...checkedSources].sort((a, b) => a.remain - b.remain);
    let left = totalSalary;
    const splits = [];
    for (const s of sortedSources) {
        if (left <= 0) break;
        const charge = s.remain > 0 ? Math.min(s.remain, left) : 0;
        if (charge > 0) { left -= charge; splits.push({ projectId: s.id, amount: charge, coverExpense: false }); }
    }
    if (left > 0) {
        const fid = expCurrentProject?.folderId;
        const coverProj = fid ? expProjects.find(p => p.folderId === fid && p.fundingType === 'president') : null;
        const coverId = coverProj?.id || expCurrentProject?.id || splits[splits.length - 1]?.projectId;
        splits.push({ projectId: coverId, amount: left, coverExpense: true });
    }

    try {
        showExpLoading('addPayrollBtn', true);
        const validReceipts = _stagedPayReceipts.filter(r => r !== null);
        const receiptImages = [];
        for (const item of validReceipts) receiptImages.push(await compressImageToBase64(item.file));

        const batch = db.batch();
        splits.forEach((sp, idx) => {
            const ref = db.collection('payroll').doc();
            batch.set(ref, {
                projectId: sp.projectId, userId: _uid(),
                workerName, role, laborType,
                ...(liabilityFor && { liabilityFor }),
                daysWorked: splits.length > 1 ? 0 : d, dailyRate: r,
                totalSalary: sp.amount,
                paymentDate, notes,
                receiptImages: idx === 0 ? receiptImages : [],
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                ...(contractId && { contractId }),
                ...(payMilestone && { payMilestone }),
                ...(sp.coverExpense && { coverExpense: true }),
                ...(splits.length > 1 && { splitGroup: paymentDate + '_' + workerName, splitIndex: idx + 1, splitTotal: splits.length })
            });
        });
        await batch.commit();

        const msg = splits.length > 1 ? `Split into ${splits.length} records ✓` : 'Payroll entry added! ✓';
        showExpNotif(msg, 'success');
        refreshOvAllData();
        document.getElementById('addPayrollForm').reset();
        lcUpdateRemainingHint('payContract', 'payContractRemaining');   // clear contract hint
        if (typeof payResetMilestone === 'function') payResetMilestone();
        if (typeof payToggleMode === 'function') payToggleMode(); // reset Daily/Lamsam UI to default
        document.getElementById('paySplitPreview').style.display = 'none';
        clearPayReceiptPreview();
        closeExpModal('addPayrollModal');
    } catch (err) {
        showExpNotif('Error: ' + err.message, 'error');
    } finally {
        showExpLoading('addPayrollBtn', false);
    }
}

async function deletePayroll(id) {
    if (!await showDeleteConfirm('Delete this payroll entry?')) return;
    try { await db.collection('payroll').doc(id).delete(); showExpNotif('Deleted.', 'success'); refreshOvAllData(); }
    catch (err) { showExpNotif('Error: ' + err.message, 'error'); }
}

// ════════════════════════════════════════════════════════════
// CHARTS
// ════════════════════════════════════════════════════════════
function updateExpCharts() {
    renderCategoryPieChart();
    renderBudgetBarChart();
    renderReportsSummaryTable();
}

function renderCategoryPieChart() {
    const ctx = document.getElementById('expCategoryChart');
    if (!ctx) return;
    const cats = {};
    expCategories.forEach(c => { cats[c.name] = 0; });
    cats['Payroll'] = 0;
    expExpenses.forEach(e => {
        const k = e.category || 'Others';
        if (!(k in cats)) cats[k] = 0;
        cats[k] += (e.amount || 0);
    });
    cats['Payroll'] = expPayroll.reduce((s, p) => s + (p.totalSalary || 0), 0);
    const labels = Object.keys(cats).filter(k => cats[k] > 0);
    const data   = labels.map(k => cats[k]);
    const bgColors = labels.map(k => {
        if (k === 'Payroll') return '#f97316';
        const cat = expCategories.find(c => c.name === k);
        return cat ? cat.color + 'cc' : '#a78bfa';
    });
    if (expCharts.pie) expCharts.pie.destroy();
    expCharts.pie = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: bgColors, borderWidth: 2, borderColor: '#fff' }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
                tooltip: { callbacks: { label: c => ` ₱${formatNum(c.parsed)} (${((c.parsed / c.chart.getDatasetMeta(0).total) * 100).toFixed(1)}%)` } }
            }
        }
    });
}

function renderBudgetBarChart() {
    const ctx = document.getElementById('expBudgetChart');
    if (!ctx || !expCurrentProject) return;
    const budget = expCurrentProject.monthlyBudget || 0;
    const spent  = expExpenses.reduce((s, e) => s + (e.amount || 0), 0)
                 + expPayroll.reduce((s, p) => s + (p.totalSalary || 0), 0);
    if (expCharts.bar) expCharts.bar.destroy();
    expCharts.bar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Budget', 'Actual Spend'],
            datasets: [{ data: [budget, spent],
                backgroundColor: ['rgba(5,150,105,0.2)', spent > budget ? 'rgba(239,68,68,0.2)' : 'rgba(79,172,254,0.2)'],
                borderColor: ['#059669', spent > budget ? '#ef4444' : '#4facfe'],
                borderWidth: 2, borderRadius: 8
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { callback: v => '₱' + formatNum(v), font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderReportsSummaryTable() {
    const tbody = document.getElementById('expSummaryTbody');
    if (!tbody) return;
    const cats = {};
    expCategories.forEach(c => { cats[c.name] = 0; });
    cats['Payroll'] = 0;
    expExpenses.forEach(e => {
        const k = e.category || 'Others';
        if (!(k in cats)) cats[k] = 0;
        cats[k] += (e.amount || 0);
    });
    cats['Payroll'] = expPayroll.reduce((s, p) => s + (p.totalSalary || 0), 0);
    const total = Object.values(cats).reduce((a, b) => a + b, 0);
    const colorMap = {};
    expCategories.forEach(c => { colorMap[c.name] = c.color; });
    colorMap['Payroll'] = '#f97316';
    const colors = colorMap;
    const rows = Object.entries(cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="3" class="exp-empty-row">No data yet.</td></tr>'; return; }
    tbody.innerHTML = rows.map(([cat, amt]) => `
        <tr>
            <td><span style="display:inline-block;width:10px;height:10px;background:${colors[cat]};border-radius:2px;margin-right:6px;vertical-align:middle"></span>${cat}</td>
            <td>₱${formatNum(amt)}</td>
            <td>${total > 0 ? ((amt / total) * 100).toFixed(1) : 0}%</td>
        </tr>`).join('');
}

// ════════════════════════════════════════════════════════════
// PROJECT DETAIL MODAL
// ════════════════════════════════════════════════════════════
let _pm = null, _pmExp = [], _pmPay = [], _pmUnsubs = [], _pmCharts = {};

function openProjectModal(id) {
    _pm = expProjects.find(p => p.id === id);
    if (!_pm || !currentUser) return;

    _pmUnsubs.forEach(u => u()); _pmUnsubs = [];
    Object.values(_pmCharts).forEach(c => { try { c.destroy(); } catch(e){} }); _pmCharts = {};

    setText('pmTitle',  _pm.month + ' ' + _pm.year);
    setText('pmBudget', '₱' + formatNum(_pm.monthlyBudget));

    ['pmTotalExp','pmTotalPay','pmTotalSpent','pmRemaining'].forEach(i => setText(i, '₱0.00'));
    setText('pmUsedPct', '0%'); setText('pmRemPct', '100% remaining');
    const bar = document.getElementById('pmProgressBar');
    if (bar) { bar.style.width = '0%'; bar.style.background = '#059669'; }

    const et = document.getElementById('pmExpTbody');
    const pt = document.getElementById('pmPayTbody');
    if (et) et.innerHTML = '<tr><td colspan="6" class="exp-empty-row">Loading…</td></tr>';
    if (pt) pt.innerHTML = '<tr><td colspan="5" class="exp-empty-row">Loading…</td></tr>';

    openExpModal('projectDetailModal');

    const _pmFolderId   = _pm.folderId;
    const _pmMonthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const _pmMonth      = _pm.month;
    const _pmYear       = Number(_pm.year);

    const _filterByPeriod = (items, dateField) => items.filter(item => {
        const raw = item[dateField];
        if (!raw) return false;
        const d = new Date(raw);
        return _pmMonthNames[d.getMonth()] === _pmMonth && d.getFullYear() === _pmYear;
    });

    if (_pmFolderId) {
        // Query all folder expenses then filter by dateTime month/year
        const folderIds = expProjects.filter(p => p.folderId === _pmFolderId).map(p => p.id);
        const chunks = [];
        for (let i = 0; i < folderIds.length; i += 30) chunks.push(folderIds.slice(i, i + 30));

        let _allPmExp = [], _allPmPay = [];
        chunks.forEach(chunk => {
            _pmUnsubs.push(
                db.collection('expenses')
                  .where('projectId', 'in', chunk)
                  .where('userId', '==', _uid())
                  .onSnapshot(snap => {
                      const ids = new Set(chunk);
                      _allPmExp = _allPmExp.filter(e => !ids.has(e.projectId));
                      snap.docs.forEach(d => _allPmExp.push({ id: d.id, ...d.data() }));
                      _pmExp = _filterByPeriod(_allPmExp, 'dateTime')
                                  .sort((a, b) => new Date(b.dateTime||0) - new Date(a.dateTime||0));
                      _pmRenderStats(); _pmRenderExpTable(); _pmRenderCharts();
                  }, err => console.error('pm expenses:', err))
            );
            _pmUnsubs.push(
                db.collection('payroll')
                  .where('projectId', 'in', chunk)
                  .where('userId', '==', _uid())
                  .onSnapshot(snap => {
                      const ids = new Set(chunk);
                      _allPmPay = _allPmPay.filter(p => !ids.has(p.projectId));
                      snap.docs.forEach(d => _allPmPay.push({ id: d.id, ...d.data() }));
                      _pmPay = _filterByPeriod(_allPmPay, 'paymentDate')
                                  .sort((a, b) => new Date(b.paymentDate||0) - new Date(a.paymentDate||0));
                      _pmRenderStats(); _pmRenderPayTable(); _pmRenderCharts();
                  }, err => console.error('pm payroll:', err))
            );
        });
    } else {
        // Standalone project — keep original projectId-based query
        _pmUnsubs.push(
            db.collection('expenses')
              .where('projectId', '==', id)
              .where('userId', '==', _uid())
              .onSnapshot(snap => {
                  _pmExp = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                              .sort((a, b) => new Date(b.dateTime||0) - new Date(a.dateTime||0));
                  _pmRenderStats(); _pmRenderExpTable(); _pmRenderCharts();
              }, err => console.error('pm expenses:', err))
        );
        _pmUnsubs.push(
            db.collection('payroll')
              .where('projectId', '==', id)
              .where('userId', '==', _uid())
              .onSnapshot(snap => {
                  _pmPay = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                              .sort((a, b) => new Date(b.paymentDate||0) - new Date(a.paymentDate||0));
                  _pmRenderStats(); _pmRenderPayTable(); _pmRenderCharts();
              }, err => console.error('pm payroll:', err))
        );
    }
}

function closeProjectModal() {
    closeExpModal('projectDetailModal');
    _pmUnsubs.forEach(u => u()); _pmUnsubs = [];
    Object.values(_pmCharts).forEach(c => { try { c.destroy(); } catch(e){} }); _pmCharts = {};
}

function _pmRenderStats() {
    const budget = _pm?.monthlyBudget || 0;
    const exps   = _pmExp.reduce((s,e) => s+(e.amount||0), 0);
    const pay    = _pmPay.reduce((s,p) => s+(p.totalSalary||0), 0);
    const spent  = exps + pay;
    const remain = budget - spent;
    const pct    = budget > 0 ? (spent/budget)*100 : 0;
    setText('pmTotalExp',   '₱'+formatNum(exps));
    setText('pmTotalPay',   '₱'+formatNum(pay));
    setText('pmTotalSpent', '₱'+formatNum(spent));
    setText('pmRemaining',  '₱'+formatNum(remain));
    setText('pmUsedPct',    pct.toFixed(1)+'%');
    setText('pmRemPct',     (100-pct).toFixed(1)+'% remaining');
    const bar = document.getElementById('pmProgressBar');
    if (bar) {
        const w = Math.min(pct,100);
        bar.style.width = w+'%';
        bar.style.background = w>90?'#ef4444':w>70?'#f59e0b':'#059669';
    }
}

function _pmRenderExpTable() {
    const tbody = document.getElementById('pmExpTbody');
    if (!tbody) return;
    if (!_pmExp.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="exp-empty-row">No expenses yet.</td></tr>';
        return;
    }

    const groups = {};
    _pmExp.forEach(e => {
        const key = e.category || 'Uncategorized';
        if (!groups[key]) groups[key] = [];
        groups[key].push(e);
    });

    let html = '';
    Object.entries(groups).forEach(([category, items]) => {
        const cat = expCategories.find(c => c.name === category);
        const color = cat ? cat.color : '#9ca3af';
        const subtotal = items.reduce((s, e) => s + (e.amount || 0), 0);
        const r = parseInt((color.replace('#','')).substring(0,2),16);
        const g = parseInt((color.replace('#','')).substring(2,4),16);
        const b = parseInt((color.replace('#','')).substring(4,6),16);
        html += `
        <tr class="exp-group-header">
            <td colspan="6">
                <div class="exp-group-header-inner" style="--cat-color:${color};--cat-bg:rgba(${r},${g},${b},0.08);border-left-color:${color}">
                    <span class="exp-group-dot" style="background:${color}"></span>
                    <span class="exp-group-name" style="color:${color}">${category}</span>
                    <span class="exp-group-count">${items.length} item${items.length > 1 ? 's' : ''}</span>
                    <span class="exp-group-subtotal">₱${formatNum(subtotal)}</span>
                </div>
            </td>
        </tr>`;
        items.sort((a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0));
        items.forEach(e => {
            const srcProj = expProjects.find(p => p.id === e.projectId);
            const fundingBadge = e.coverExpense ? _fundingBadgeHTML(null, true) : (srcProj ? _fundingBadgeHTML(srcProj, false) : '');
            html += `
        <tr class="exp-group-row">
            <td>${formatDate(e.dateTime)}</td>
            <td><strong>${e.expenseName||'—'}</strong>${fundingBadge}</td>
            <td class="exp-notes-cell">${e.notes ? '<span class="exp-notes-text">'+e.notes+'</span>' : '<span class="exp-notes-empty">—</span>'}</td>
            <td>${e.quantity||1}</td>
            <td>₱${formatNum(e.amount)}</td>
            <td>${getReceiptThumbsHTML(e)}</td>
        </tr>`;
        });
    });

    const grandTotal = _pmExp.reduce((s, e) => s + (e.amount || 0), 0);
    html += `
        <tr class="exp-total-row">
            <td colspan="3"></td>
            <td class="exp-total-label">TOTAL</td>
            <td class="exp-total-value">₱${formatNum(grandTotal)}</td>
            <td></td>
        </tr>`;

    tbody.innerHTML = html;
}

function _pmRenderPayTable() {
    const tbody = document.getElementById('pmPayTbody');
    if (!tbody) return;
    if (!_pmPay.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="exp-empty-row">No payroll yet.</td></tr>';
        return;
    }

    const roleColors = ['#f97316','#3b82f6','#10b981','#8b5cf6','#ef4444','#f59e0b','#06b6d4','#ec4899'];
    const roleColorMap = {};
    let colorIdx = 0;

    const groups = {};
    _pmPay.forEach(p => {
        const key = p.role || 'Uncategorized';
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });

    let html = '';
    Object.entries(groups).forEach(([role, items]) => {
        if (!(role in roleColorMap)) roleColorMap[role] = roleColors[colorIdx++ % roleColors.length];
        const color = roleColorMap[role];
        const subtotal = items.reduce((s, p) => s + (p.totalSalary || 0), 0);
        const r = parseInt(color.replace('#','').substring(0,2),16);
        const g = parseInt(color.replace('#','').substring(2,4),16);
        const b = parseInt(color.replace('#','').substring(4,6),16);
        html += `
        <tr class="exp-group-header">
            <td colspan="7">
                <div class="exp-group-header-inner" style="--cat-color:${color};--cat-bg:rgba(${r},${g},${b},0.08);border-left-color:${color}">
                    <span class="exp-group-dot" style="background:${color}"></span>
                    <span class="exp-group-name" style="color:${color}">${role}</span>
                    <span class="exp-group-count">${items.length} item${items.length > 1 ? 's' : ''}</span>
                    <span class="exp-group-subtotal">₱${formatNum(subtotal)}</span>
                </div>
            </td>
        </tr>`;
        items.forEach(p => {
            html += `
        <tr class="exp-group-row">
            <td>${formatDate(p.paymentDate)}</td>
            <td><strong>${p.workerName||'—'}</strong></td>
            <td>${p.role||'—'}</td>
            <td class="exp-notes-cell">${p.notes ? '<span class="exp-notes-text">'+p.notes+'</span>' : '<span class="exp-notes-empty">—</span>'}</td>
            <td>${_payRecIsLamsam(p) ? ('Lump Sum' + ((p.daysWorked||0) ? ' · '+(p.daysWorked||0)+'d' : '')) : (p.daysWorked||0)+' days × ₱'+formatNum(p.dailyRate)}</td>
            <td>₱${formatNum(p.totalSalary)}</td>
            <td>${getReceiptThumbsHTML(p)}</td>
        </tr>`;
        });
    });

    const grandTotal = _pmPay.reduce((s, p) => s + (p.totalSalary || 0), 0);
    html += `
        <tr class="exp-total-row">
            <td colspan="5"></td>
            <td class="exp-total-label">TOTAL</td>
            <td class="exp-total-value">₱${formatNum(grandTotal)}</td>
        </tr>`;

    tbody.innerHTML = html;
}

function _pmRenderCharts() {
    const pieCtx = document.getElementById('pmCategoryChart');
    if (pieCtx) {
        const cats = {};
        expCategories.forEach(c => { cats[c.name] = 0; });
        cats['Payroll'] = 0;
        _pmExp.forEach(e => {
            const k = e.category||'Others';
            if (!(k in cats)) cats[k] = 0;
            cats[k] += (e.amount||0);
        });
        cats['Payroll'] = _pmPay.reduce((s,p) => s+(p.totalSalary||0), 0);
        const labels = Object.keys(cats).filter(k => cats[k]>0);
        const data   = labels.map(k => cats[k]);
        const bgColors = labels.map(k => {
            if (k==='Payroll') return '#f97316';
            const cat = expCategories.find(c => c.name===k);
            return cat ? cat.color+'cc' : '#a78bfa';
        });
        if (_pmCharts.pie) _pmCharts.pie.destroy();
        _pmCharts.pie = new Chart(pieCtx, {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: bgColors, borderWidth:2, borderColor:'#fff' }] },
            options: { responsive:true, maintainAspectRatio:false,
                plugins: { legend:{position:'right',labels:{font:{size:11},padding:10}},
                    tooltip:{callbacks:{label:c=>` ₱${formatNum(c.parsed)} (${((c.parsed/c.chart.getDatasetMeta(0).total)*100).toFixed(1)}%)`}} }
            }
        });
    }
    const barCtx = document.getElementById('pmBudgetChart');
    if (barCtx && _pm) {
        const budget = _pm.monthlyBudget||0;
        const spent  = _pmExp.reduce((s,e)=>s+(e.amount||0),0)+_pmPay.reduce((s,p)=>s+(p.totalSalary||0),0);
        if (_pmCharts.bar) _pmCharts.bar.destroy();
        _pmCharts.bar = new Chart(barCtx, {
            type: 'bar',
            data: { labels:['Budget','Actual Spend'], datasets:[{ data:[budget,spent],
                backgroundColor:['rgba(5,150,105,0.15)',spent>budget?'rgba(239,68,68,0.15)':'rgba(79,172,254,0.15)'],
                borderColor:['#059669',spent>budget?'#ef4444':'#4facfe'], borderWidth:2, borderRadius:8 }]},
            options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
                scales:{ y:{beginAtZero:true,ticks:{callback:v=>'₱'+formatNum(v),font:{size:10}},grid:{color:'rgba(0,0,0,0.05)'}}, x:{grid:{display:false}} }
            }
        });
    }
}

// ════════════════════════════════════════════════════════════
// RECEIPT / LIGHTBOX
// ════════════════════════════════════════════════════════════
function getReceiptThumbsHTML(e) {
    const images = e.receiptImages?.length
        ? e.receiptImages
        : (e.receiptURL ? [e.receiptURL] : []);
    if (!images.length) return '<span class="exp-no-receipt">—</span>';

    _receiptStore[e.id] = { images, name: e.expenseName || 'Expense' };

    const thumbsHTML = images.slice(0, 3).map((src, i) =>
        `<img src="${src}" class="exp-inline-thumb" onclick="openLightbox('${e.id}',${i})" alt="receipt">`
    ).join('');
    const more = images.length > 3
        ? `<span class="exp-thumb-more" onclick="openLightbox('${e.id}',0)">+${images.length - 3}</span>`
        : '';
    return `<div class="exp-thumb-row">${thumbsHTML}${more}</div>`;
}

const _receiptStore = {};
// Expose on window so the React portal (admin.html) can stage images for the
// shared lightbox — `const` does not auto-attach to window like a function decl does.
window._receiptStore = _receiptStore;

// ── Worker Receipt Summary Modal ──────────────────────────────
function openWorkerSummaryModal(workerName) {
    // Merge current-project payroll + global cache, deduplicate by id
    const seen = new Set();
    const pool = [...(expPayroll || []), ...(_ovAllPayroll || [])].filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
    });

    const entries = pool
        .filter(p => (p.workerName || '').toLowerCase() === (workerName || '').toLowerCase())
        .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    if (!entries.length) {
        showExpNotif('No payroll entries found for "' + workerName + '".', 'error');
        return;
    }

    const totalPaid     = entries.reduce((s, p) => s + (p.totalSalary || 0), 0);
    const totalDays     = entries.reduce((s, p) => s + (Number(p.daysWorked) || 0), 0);
    const totalReceipts = entries.reduce((s, p) => {
        const imgs = p.receiptImages?.length ? p.receiptImages : (p.receiptURL ? [p.receiptURL] : []);
        return s + imgs.length;
    }, 0);
    const role    = entries[0].role || '—';
    const fmtAmt  = n => '₱' + Number(n||0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate = d => { try { return new Date(d).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' }); } catch(e) { return d||'—'; } };
    const esc     = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const _projs   = (typeof expProjects !== 'undefined' ? expProjects : []);
    const _folders = (typeof expFolders  !== 'undefined' ? expFolders  : []);

    const entriesHTML = entries.map((p, idx) => {
        const imgs     = p.receiptImages?.length ? p.receiptImages : (p.receiptURL ? [p.receiptURL] : []);
        const storeKey = 'wrs_' + p.id;
        _receiptStore[storeKey] = { images: imgs, name: `${p.workerName} — ${fmtDate(p.paymentDate)}` };

        // Resolve project/folder name
        const proj      = _projs.find(pr => pr.id === p.projectId) || null;
        const folder    = proj && proj.folderId ? _folders.find(f => f.id === proj.folderId) || null : null;
        const projLabel = folder ? esc(folder.name) : (proj ? esc((proj.month||'') + ' ' + (proj.year||'')) : '—');
        const periodLabel = proj ? esc((proj.month||'') + ' ' + (proj.year||'')) : '—';

        const thumbsHTML = imgs.length
            ? `<div class="wrs-receipt-row">${imgs.slice(0, 6).map((src, i) =>
                `<img src="${esc(src)}" class="wrs-receipt-thumb" onclick="openLightbox('${storeKey}',${i})" alt="receipt ${i+1}">`
              ).join('') + (imgs.length > 6 ? `<span class="wrs-more-badge" onclick="openLightbox('${storeKey}',0)">+${imgs.length - 6}</span>` : '')}</div>`
            : '<div class="wrs-no-receipt-row"><span class="wrs-no-receipt">No receipt attached</span></div>';

        const hasReceipt = imgs.length > 0;

        return `
        <div class="wrs-entry">
            <div class="wrs-entry-topbar">
                <div class="wrs-entry-num">#${entries.length - idx}</div>
                <div class="wrs-entry-project">
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    ${projLabel}${folder ? `<span class="wrs-entry-period">${periodLabel}</span>` : ''}
                </div>
                <div class="wrs-entry-receipt-badge ${hasReceipt ? 'has-receipt' : 'no-receipt'}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${hasReceipt ? '<polyline points="20 6 9 17 4 12"/>' : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'}</svg>
                    ${hasReceipt ? imgs.length + ' receipt' + (imgs.length > 1 ? 's' : '') : 'No receipt'}
                </div>
                <button class="wrs-inv-btn" title="Print Invoice" onclick="printSinglePayrollInvoice('${p.id}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    Invoice
                </button>
            </div>
            <div class="wrs-entry-body">
                <div class="wrs-entry-info-row">
                    <div class="wrs-entry-info-cell">
                        <span class="wrs-info-label">Payment Date</span>
                        <span class="wrs-info-value">${fmtDate(p.paymentDate)}</span>
                    </div>
                    <div class="wrs-entry-info-cell">
                        <span class="wrs-info-label">Role</span>
                        <span class="wrs-info-value">${esc(p.role||'—')}</span>
                    </div>
                    <div class="wrs-entry-info-cell">
                        <span class="wrs-info-label">Days Worked</span>
                        <span class="wrs-info-value">${p.daysWorked||0} days</span>
                    </div>
                    <div class="wrs-entry-info-cell">
                        <span class="wrs-info-label">Daily Rate</span>
                        <span class="wrs-info-value">${_payRecIsLamsam(p) ? 'Lump Sum' : fmtAmt(p.dailyRate)}</span>
                    </div>
                </div>
                ${p.notes ? `<div class="wrs-entry-notes-row"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>${esc(p.notes)}</div>` : ''}
                <div class="wrs-entry-total-row">
                    <span class="wrs-entry-total-formula">${_payRecIsLamsam(p) ? ('Lump Sum' + ((p.daysWorked||0) ? ' · '+(p.daysWorked||0)+' days' : '')) : (p.daysWorked||0)+' days × '+fmtAmt(p.dailyRate)+'/day'}</span>
                    <span class="wrs-entry-total-amt">${fmtAmt(p.totalSalary)}</span>
                </div>
            </div>
            ${thumbsHTML}
        </div>`;
    }).join('');

    document.getElementById('wrsWorkerName').textContent   = workerName;
    document.getElementById('wrsRole').textContent         = role;
    document.getElementById('wrsEntryCount').textContent   = entries.length + (entries.length === 1 ? ' entry' : ' entries');
    document.getElementById('wrsTotalDays').textContent    = totalDays + ' days';
    document.getElementById('wrsReceiptCount').textContent = totalReceipts + (totalReceipts === 1 ? ' receipt' : ' receipts');
    document.getElementById('wrsTotalPaid').textContent    = fmtAmt(totalPaid);
    document.getElementById('wrsEntriesList').innerHTML    = entriesHTML;
    document.getElementById('workerSummaryModal').dataset.worker = workerName;

    openExpModal('workerSummaryModal');
    if (window.lucide) lucide.createIcons();
}
window.openWorkerSummaryModal = openWorkerSummaryModal;

function printWorkerReceiptSummary(workerName) {
    // Merge current-project + global cache, deduplicate
    const seen2 = new Set();
    const allPay = [...(expPayroll || []), ...(_ovAllPayroll || [])].filter(p => {
        if (seen2.has(p.id)) return false;
        seen2.add(p.id);
        return true;
    });

    const entries = allPay
        .filter(p => (p.workerName || '').toLowerCase() === (workerName || '').toLowerCase())
        .sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

    if (!entries.length) return;

    const totalPaid   = entries.reduce((s, p) => s + (p.totalSalary || 0), 0);
    const totalDays   = entries.reduce((s, p) => s + (Number(p.daysWorked) || 0), 0);
    const fmtAmt      = n => '&#8369;&nbsp;' + Number(n||0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate     = d => { try { return new Date(d).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }); } catch(e) { return d||'—'; } };
    const fmtDateSh   = d => { try { return new Date(d).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' }); } catch(e) { return d||'—'; } };
    const esc         = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const _projs   = (typeof expProjects !== 'undefined' ? expProjects : []);
    const _folders = (typeof expFolders  !== 'undefined' ? expFolders  : []);
    const bizName  = (typeof _defaults !== 'undefined' && _defaults && _defaults.businessName) ? _defaults.businessName : "DAC's Building Design Services";
    const bizAddr  = (typeof _defaults !== 'undefined' && _defaults && _defaults.businessAddress) ? _defaults.businessAddress : '';
    const today    = new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'});

    const entriesHTML = entries.map((p, idx) => {
        const imgs = p.receiptImages?.length ? p.receiptImages : (p.receiptURL ? [p.receiptURL] : []);
        const imgsHTML = imgs.length
            ? `<div style="margin-top:10px;"><div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Receipts (${imgs.length})</div><div style="display:flex;flex-wrap:wrap;gap:8px;">${imgs.map(src =>
                `<img src="${esc(src)}" style="max-width:160px;max-height:120px;border:1px solid #e5e7eb;border-radius:5px;object-fit:cover;" alt="receipt">`
              ).join('')}</div></div>`
            : `<div style="margin-top:8px;padding:8px 10px;background:#fef2f2;border-radius:5px;font-size:11px;color:#ef4444;font-weight:600;">&#9888; No receipt attached</div>`;

        const proj      = _projs.find(pr => pr.id === p.projectId) || null;
        const folder    = proj && proj.folderId ? _folders.find(f => f.id === proj.folderId) || null : null;
        const projLabel = folder ? esc(folder.name) : (proj ? esc((proj.month||'') + ' ' + (proj.year||'')) : '—');
        const periodTxt = proj ? `${esc(proj.month||'')} ${esc(proj.year||'')}` : '';

        return `
        <div style="margin-bottom:16px;border:1.5px solid #e5e7eb;border-radius:8px;overflow:hidden;page-break-inside:avoid;">
            <div style="background:#f8fafc;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="background:#1e3a5f;color:#fff;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;">Entry #${idx+1}</span>
                    <span style="font-size:11px;color:#374151;font-weight:600;">${projLabel}${periodTxt ? ' &mdash; ' + periodTxt : ''}</span>
                </div>
                <span style="font-size:11px;color:#6b7280;">${fmtDate(p.paymentDate)}</span>
            </div>
            <div style="padding:12px 14px;">
                <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
                    <thead>
                        <tr style="background:#1e3a5f;color:#fff;">
                            <th style="padding:7px 10px;font-size:11px;font-weight:700;text-align:left;">Description</th>
                            <th style="padding:7px 10px;font-size:11px;font-weight:700;text-align:center;">Days</th>
                            <th style="padding:7px 10px;font-size:11px;font-weight:700;text-align:right;">Daily Rate</th>
                            <th style="padding:7px 10px;font-size:11px;font-weight:700;text-align:right;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom:1px solid #e9ecef;">
                            <td style="padding:9px 10px;font-size:12px;">${esc(p.role||'Labor')} — ${esc(p.workerName||'—')}${p.notes ? `<div style="font-size:10px;color:#92400e;margin-top:2px;">${esc(p.notes)}</div>` : ''}</td>
                            <td style="padding:9px 10px;font-size:12px;text-align:center;">${p.daysWorked||0}</td>
                            <td style="padding:9px 10px;font-size:12px;text-align:right;">${fmtAmt(p.dailyRate)}</td>
                            <td style="padding:9px 10px;font-size:13px;font-weight:800;text-align:right;color:#1a1a2e;">${fmtAmt(p.totalSalary)}</td>
                        </tr>
                    </tbody>
                </table>
                ${imgsHTML}
            </div>
        </div>`;
    }).join('');

    // Summary table
    const summaryTableHTML = `
        <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
            <thead>
                <tr style="background:#f1f5f9;">
                    <th style="padding:7px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:left;border-bottom:2px solid #e2e8f0;">#</th>
                    <th style="padding:7px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:left;border-bottom:2px solid #e2e8f0;">Date</th>
                    <th style="padding:7px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:left;border-bottom:2px solid #e2e8f0;">Project / Period</th>
                    <th style="padding:7px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:center;border-bottom:2px solid #e2e8f0;">Days</th>
                    <th style="padding:7px 10px;font-size:10px;font-weight:700;color:#6b7280;text-align:right;border-bottom:2px solid #e2e8f0;">Amount</th>
                </tr>
            </thead>
            <tbody>
                ${entries.map((p, i) => {
                    const proj2   = _projs.find(pr => pr.id === p.projectId) || null;
                    const folder2 = proj2 && proj2.folderId ? _folders.find(f => f.id === proj2.folderId) || null : null;
                    const lbl2    = folder2 ? esc(folder2.name) : (proj2 ? esc((proj2.month||'') + ' ' + (proj2.year||'')) : '—');
                    return `<tr style="border-bottom:1px solid #e9ecef;${i%2===1?'background:#f8fafc;':''}">
                        <td style="padding:7px 10px;font-size:11px;color:#6b7280;">${i+1}</td>
                        <td style="padding:7px 10px;font-size:11px;">${fmtDateSh(p.paymentDate)}</td>
                        <td style="padding:7px 10px;font-size:11px;">${lbl2}</td>
                        <td style="padding:7px 10px;font-size:11px;text-align:center;">${p.daysWorked||0}</td>
                        <td style="padding:7px 10px;font-size:11px;text-align:right;font-weight:700;">${fmtAmt(p.totalSalary)}</td>
                    </tr>`;
                }).join('')}
                <tr style="background:#1e3a5f;color:#fff;">
                    <td colspan="3" style="padding:8px 10px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">TOTAL</td>
                    <td style="padding:8px 10px;font-size:11px;font-weight:700;text-align:center;">${totalDays}</td>
                    <td style="padding:8px 10px;font-size:13px;font-weight:800;text-align:right;">${fmtAmt(totalPaid)}</td>
                </tr>
            </tbody>
        </table>`;

    const w = window.open('', '_blank', 'width=820,height=1050');
    if (!w) { alert('Please allow pop-ups to print.'); return; }
    w.document.write(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Payroll Summary — ${esc(workerName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;background:#f5f5f5;}
.page{width:210mm;min-height:297mm;margin:24px auto;padding:14mm 16mm 12mm;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.13);border-radius:4px;}
@media print{body{background:#fff;}.page{margin:0;box-shadow:none;padding:8mm 10mm;border-radius:0;}@page{size:A4 portrait;margin:8mm;}}
</style></head><body>
<div class="page">

  <!-- Header -->
  ${window.dacsPrintHeader('Payroll Summary', `Labor &amp; Payroll<br>Printed: ${today}`)}

  <!-- Worker Info Band -->
  <div style="display:flex;gap:0;margin-bottom:18px;border:1.5px solid #e5e7eb;border-radius:6px;overflow:hidden;">
    <div style="flex:2;padding:11px 14px;border-right:1px solid #e5e7eb;">
      <div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">Worker Name</div>
      <div style="font-size:15px;font-weight:800;color:#1a1a2e;">${esc(workerName)}</div>
    </div>
    <div style="flex:1;padding:11px 14px;border-right:1px solid #e5e7eb;">
      <div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">Role</div>
      <div style="font-size:13px;font-weight:700;color:#1a1a2e;">${esc(entries[0].role||'—')}</div>
    </div>
    <div style="flex:1;padding:11px 14px;border-right:1px solid #e5e7eb;">
      <div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">Total Entries</div>
      <div style="font-size:13px;font-weight:700;color:#1a1a2e;">${entries.length} entries</div>
    </div>
    <div style="flex:1;padding:11px 14px;border-right:1px solid #e5e7eb;">
      <div style="font-size:9px;font-weight:700;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;">Total Days</div>
      <div style="font-size:13px;font-weight:700;color:#1a1a2e;">${totalDays} days</div>
    </div>
    <div style="flex:1;padding:11px 14px;background:#1e3a5f;color:#fff;">
      <div style="font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:4px;opacity:.8;">Total Paid</div>
      <div style="font-size:14px;font-weight:800;">${fmtAmt(totalPaid)}</div>
    </div>
  </div>

  <!-- Summary Table -->
  <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px;">Payment Summary</div>
  ${summaryTableHTML}

  <!-- Detailed Entries -->
  <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px;margin-top:20px;">Detailed Payroll Entries</div>
  ${entriesHTML}

  <!-- Acknowledgment -->
  <div style="border:1.5px dashed #d1d5db;border-radius:6px;padding:14px 16px;margin-top:8px;page-break-inside:avoid;">
    <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:10px;">Acknowledgment</div>
    <div style="font-size:12px;color:#374151;margin-bottom:18px;line-height:1.6;">
      I, <strong>${esc(workerName)}</strong>, hereby acknowledge receipt of the total amount of <strong>${fmtAmt(totalPaid)}</strong>
      covering ${entries.length} payroll ${entries.length === 1 ? 'entry' : 'entries'} totaling <strong>${totalDays} days</strong> of labor rendered.
    </div>
    <div style="display:flex;justify-content:space-between;gap:24px;">
      <div style="flex:1;text-align:center;">
        <div style="height:40px;"></div>
        <div style="border-top:1.5px solid #374151;padding-top:5px;font-size:11px;color:#6b7280;">Worker's Signature</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a2e;margin-top:2px;">${esc(workerName)}</div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="height:40px;"></div>
        <div style="border-top:1.5px solid #374151;padding-top:5px;font-size:11px;color:#6b7280;">Prepared by</div>
      </div>
      <div style="flex:1;text-align:center;">
        <div style="height:40px;"></div>
        <div style="border-top:1.5px solid #374151;padding-top:5px;font-size:11px;color:#6b7280;">Approved by</div>
      </div>
    </div>
  </div>

  <div style="margin-top:16px;padding-top:10px;border-top:1px solid #e5e7eb;text-align:center;font-size:10px;color:#9ca3af;">
    ${esc(bizName)}${bizAddr ? ' &bull; ' + esc(bizAddr) : ''} &bull; Printed ${today}
  </div>
</div>
<script>window.onload=function(){window.print();};<\/script>
</body></html>`);
    w.document.close();
}
window.printWorkerReceiptSummary = printWorkerReceiptSummary;

let _lbImages = [], _lbCurrent = 0, _lbTitle = '';
let _lbZoom = 1, _lbDragging = false, _lbTranslate = { x: 0, y: 0 };

function openLightbox(expenseId, startIndex = 0) {
    const data = _receiptStore[expenseId];
    if (!data) return;
    _lbImages  = data.images;
    _lbCurrent = startIndex;
    _lbTitle   = data.name;

    const lb = document.getElementById('receiptLightbox');
    if (!lb) return;
    document.getElementById('lbTitle').textContent = `📎 ${_lbTitle}`;
    _lbRender();
    lb.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(_lbSetupZoom, 60);
}

function _lbRender() {
    const img     = document.getElementById('lbMainImg');
    const counter = document.getElementById('lbCounter');
    const thumbs  = document.getElementById('lbThumbs');
    if (img) { img.src = _lbImages[_lbCurrent]; _lbResetZoom(false); }
    if (counter) counter.textContent = `${_lbCurrent + 1} / ${_lbImages.length}`;
    if (thumbs) {
        thumbs.innerHTML = _lbImages.map((src, i) => `
            <img src="${src}" class="lb-thumb ${i === _lbCurrent ? 'active' : ''}"
                 onclick="lbGoto(${i})" alt="receipt ${i+1}">`
        ).join('');
        thumbs.style.display = _lbImages.length > 1 ? 'flex' : 'none';
    }
    const prev = document.getElementById('lbPrev');
    const next = document.getElementById('lbNext');
    if (prev) prev.style.display = _lbImages.length > 1 ? 'flex' : 'none';
    if (next) next.style.display = _lbImages.length > 1 ? 'flex' : 'none';
    _lbUpdateZoomUI();
}

function _lbClampTranslate() {
    const img  = document.getElementById('lbMainImg');
    const wrap = document.getElementById('lbImgWrap');
    if (!img || !wrap || _lbZoom <= 1) { _lbTranslate = { x: 0, y: 0 }; return; }
    const iw = img.offsetWidth  * _lbZoom;
    const ih = img.offsetHeight * _lbZoom;
    const ww = wrap.offsetWidth;
    const wh = wrap.offsetHeight;
    const maxX = Math.max(0, (iw - ww) / 2);
    const maxY = Math.max(0, (ih - wh) / 2);
    _lbTranslate.x = Math.min(maxX, Math.max(-maxX, _lbTranslate.x));
    _lbTranslate.y = Math.min(maxY, Math.max(-maxY, _lbTranslate.y));
}

function _lbApplyTransform() {
    const img = document.getElementById('lbMainImg');
    if (!img) return;
    _lbClampTranslate();
    img.style.transform = `scale(${_lbZoom}) translate(${_lbTranslate.x / _lbZoom}px, ${_lbTranslate.y / _lbZoom}px)`;
    img.style.cursor = _lbZoom > 1 ? (_lbDragging ? 'grabbing' : 'grab') : 'zoom-in';
}

function _lbResetZoom(apply = true) {
    _lbZoom = 1;
    _lbTranslate = { x: 0, y: 0 };
    if (apply) { _lbApplyTransform(); _lbUpdateZoomUI(); }
}

function _lbUpdateZoomUI() {
    const btn  = document.getElementById('lbZoomBtn');
    const pct  = document.getElementById('lbZoomPct');
    if (btn) btn.textContent = _lbZoom > 1 ? '↩ Reset' : '🔍';
    if (pct) {
        pct.textContent = _lbZoom > 1 ? `${Math.round(_lbZoom * 100)}%` : '';
        pct.style.display = _lbZoom > 1 ? 'inline' : 'none';
    }
}

function lbZoomIn()  { _lbZoom = Math.min(5, _lbZoom + 0.5); _lbApplyTransform(); _lbUpdateZoomUI(); }
function lbZoomOut() {
    _lbZoom = Math.max(1, _lbZoom - 0.5);
    if (_lbZoom === 1) _lbTranslate = { x: 0, y: 0 };
    _lbApplyTransform(); _lbUpdateZoomUI();
}
function lbZoomToggle() { _lbZoom > 1 ? _lbResetZoom() : lbZoomIn(); }

function _lbSetupZoom() {
    const img  = document.getElementById('lbMainImg');
    const wrap = document.getElementById('lbImgWrap');
    if (!img || !wrap || wrap._zoomReady) return;
    wrap._zoomReady = true;

    img.addEventListener('click', () => {
        if (_lbDragging) return;
        _lbZoom > 1 ? _lbResetZoom() : (() => { _lbZoom = 2.5; _lbApplyTransform(); _lbUpdateZoomUI(); })();
    });

    wrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        _lbZoom = Math.min(5, Math.max(1, _lbZoom + (e.deltaY < 0 ? 0.3 : -0.3)));
        if (_lbZoom === 1) _lbTranslate = { x: 0, y: 0 };
        _lbApplyTransform(); _lbUpdateZoomUI();
    }, { passive: false });

    img.addEventListener('mousedown', (e) => {
        if (_lbZoom <= 1) return;
        e.preventDefault();
        const ox = e.clientX - _lbTranslate.x;
        const oy = e.clientY - _lbTranslate.y;
        _lbDragging = false;
        img.style.cursor = 'grabbing';
        const onMove = (e) => {
            _lbDragging = true;
            _lbTranslate.x = e.clientX - ox;
            _lbTranslate.y = e.clientY - oy;
            _lbApplyTransform();
        };
        const onUp = () => {
            img.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            setTimeout(() => { _lbDragging = false; }, 50);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    let _touches = [];
    let _initDist = 0, _initZoom = 1;
    wrap.addEventListener('touchstart', (e) => {
        _touches = Array.from(e.touches);
        if (_touches.length === 2) {
            _initDist = Math.hypot(_touches[1].clientX - _touches[0].clientX, _touches[1].clientY - _touches[0].clientY);
            _initZoom = _lbZoom;
        }
    }, { passive: true });
    wrap.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
            _lbZoom = Math.min(5, Math.max(1, _initZoom * (dist / _initDist)));
            if (_lbZoom === 1) _lbTranslate = { x: 0, y: 0 };
            _lbApplyTransform(); _lbUpdateZoomUI();
        }
    }, { passive: false });
}

function lbGoto(i) { _lbCurrent = i; _lbRender(); }
function lbPrev()  { _lbCurrent = (_lbCurrent - 1 + _lbImages.length) % _lbImages.length; _lbRender(); }
function lbNext()  { _lbCurrent = (_lbCurrent + 1) % _lbImages.length; _lbRender(); }

function closeLightbox() {
    const lb = document.getElementById('receiptLightbox');
    if (lb) lb.classList.remove('active');
    document.body.style.overflow = '';
    _lbResetZoom();
    const wrap = document.getElementById('lbImgWrap');
    if (wrap) wrap._zoomReady = false;
}

function viewReceipt(expenseId) {
    if (!_receiptStore[expenseId]) {
        const expense = expExpenses.find(e => e.id === expenseId)
                     || _pmExp.find(e => e.id === expenseId);
        if (!expense) return;
        const images = expense.receiptImages?.length
            ? expense.receiptImages
            : (expense.receiptURL ? [expense.receiptURL] : []);
        _receiptStore[expenseId] = { images, name: expense.expenseName || 'Expense' };
    }
    openLightbox(expenseId, 0);
}

// ════════════════════════════════════════════════════════════
// EDIT EXPENSE
// ════════════════════════════════════════════════════════════
let _editingExpenseId = null;

async function openEditExpenseModal(id) {
    // Try the in-memory cache first; if missing (e.g. user came from Project Control
    // without ever opening the standalone Expenses module), fetch from Firestore.
    let e = expExpenses.find(x => x.id === id);
    if (!e) {
        try {
            const snap = await db.collection('expenses').doc(id).get();
            if (snap.exists) e = { id: snap.id, ...snap.data() };
        } catch (err) { console.error('openEditExpenseModal fetch:', err); }
    }
    if (!e) { showExpNotif('Expense not found.', 'error'); return; }
    _editingExpenseId = id;

    // Populate funding source dropdown (with remaining budget like Add Expense)
    const fsSel = document.getElementById('editExpFundingSource');
    if (fsSel) {
        const proj   = expProjects.find(p => p.id === e.projectId);
        const fid    = proj ? proj.folderId : (expCurrentFolder ? expCurrentFolder.id : null);
        const fProjs = fid ? expProjects.filter(p => p.folderId === fid) : expProjects;
        fsSel.innerHTML = fProjs.map(p => {
            const spent   = expExpenses.filter(ex => ex.projectId === p.id && ex.id !== id)
                                .reduce((s, ex) => s + (parseFloat(ex.amount) || 0), 0)
                          + expPayroll.filter(pr => pr.projectId === p.id)
                                .reduce((s, pr) => s + (parseFloat(pr.totalSalary) || 0), 0);
            const budget  = parseFloat(p.monthlyBudget) || 0;
            const remain  = budget - spent;
            const fundLbl = _fundingLabel(p);
            const remTxt  = budget > 0 ? ' — ₱' + formatNum(remain) + ' left' : '';
            const lbl     = (p.month || '') + ' ' + (p.year || '') + ' · ' + fundLbl + remTxt;
            return `<option value="${p.id}"${p.id === e.projectId ? ' selected' : ''}>${lbl.trim()}</option>`;
        }).join('');
    }

    document.getElementById('editExpName').value     = e.expenseName || '';
    const _editExpDT = e.dateTime ? new Date(e.dateTime) : null;
    // Local date parts — toISOString (UTC) shows the previous day for expenses
    // logged 00:00–07:59 PH, silently shifting the date back a day on save.
    document.getElementById('editExpDate').value = _editExpDT
        ? `${_editExpDT.getFullYear()}-${String(_editExpDT.getMonth()+1).padStart(2,'0')}-${String(_editExpDT.getDate()).padStart(2,'0')}`
        : '';
    document.getElementById('editExpTime').value = _editExpDT ? _editExpDT.toTimeString().slice(0,5) : '';
    document.getElementById('editExpQty').value      = e.quantity || 1;
    var _unitCost = e.quantity && e.amount ? (e.amount / e.quantity) : (e.amount || 0);
    document.getElementById('editExpUnitCost').value = fmtBudgetVal(_unitCost);
    document.getElementById('editExpAmount').value   = fmtBudgetVal(e.amount || 0);
    document.getElementById('editExpNotes').value    = e.notes  || '';
    const _editPmEl = document.getElementById('editExpPaymentMethod');
    if (_editPmEl) _editPmEl.value = e.paymentMethod || '';
    // Pass the stored category through so it stays selected even if it is neither a
    // current contract role nor still in the manual list — otherwise saving this
    // form would write "" over a category recorded before either list changed.
    const sel = document.getElementById('editExpCategory');
    sel.innerHTML = _expCategoryOptionsHtml(e.category);
    // Pre-populate Supporting Documents state labels (PO / DR / SI / PR)
    const _editDocFields = {
        editExpDocPOState: e.poImageUrl,
        editExpDocDRState: e.deliveryReceiptUrl,
        editExpDocSIState: e.supplierInvoiceUrl,
        editExpDocPRState: e.paymentReceiptUrl,
    };
    Object.entries(_editDocFields).forEach(([stateId, url]) => {
        const stateEl = document.getElementById(stateId);
        if (stateEl) {
            stateEl.textContent = url ? '✓ Attached — tap to replace' : 'Tap to attach';
            stateEl.parentElement?.parentElement?.classList?.toggle('attached', !!url);
        }
    });
    // Clear any previously-selected file inputs so old picks don't sneak in
    ['editExpDocPO','editExpDocDR','editExpDocSI','editExpDocPR'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    openExpModal('editExpenseModal');
}

function setupEditExpenseFormListeners() {
    const form = document.getElementById('editExpenseForm');
    if (!form) return;
    const qty  = document.getElementById('editExpQty');
    const cost = document.getElementById('editExpUnitCost');
    const amt  = document.getElementById('editExpAmount');
    const recalc = () => {
        if (amt) amt.value = fmtBudgetVal((parseFloat(qty?.value) || 1) * (parseFloat((cost?.value||'').replace(/,/g,'')) || 0));
    };
    qty?.addEventListener('input', recalc);
    cost?.addEventListener('input', recalc);
    form.addEventListener('submit', handleEditExpense);
}

async function handleEditExpense(ev) {
    ev.preventDefault();
    if (!_editingExpenseId) return;
    try {
        showExpLoading('editExpenseBtn', true);
        const editFsSel = document.getElementById('editExpFundingSource');
        const newProjectId = editFsSel && editFsSel.value ? editFsSel.value : null;
        const updateData = {
            expenseName:   document.getElementById('editExpName').value.trim(),
            category:      document.getElementById('editExpCategory').value,
            quantity:      parseFloat(document.getElementById('editExpQty').value) || 1,
            amount:        parseFloat((document.getElementById('editExpAmount').value || '').replace(/,/g, '')) || 0,
            dateTime:      _buildDateTime('editExpDate', 'editExpTime'),
            notes:         document.getElementById('editExpNotes').value.trim(),
            paymentMethod: (document.getElementById('editExpPaymentMethod')?.value || '').trim(),
        };
        if (newProjectId) updateData.projectId = newProjectId;

        // Supporting docs: only overwrite the fields the user re-attached
        const _editDocMap = {
            poImageUrl:         'editExpDocPO',
            deliveryReceiptUrl: 'editExpDocDR',
            supplierInvoiceUrl: 'editExpDocSI',
            paymentReceiptUrl:  'editExpDocPR',
        };
        for (const [field, inputId] of Object.entries(_editDocMap)) {
            const file = document.getElementById(inputId)?.files?.[0];
            if (file) {
                try { updateData[field] = await compressImageToBase64(file); } catch (_) {}
            }
        }

        await db.collection('expenses').doc(_editingExpenseId).update(updateData);
        showExpNotif('Expense updated! ✓', 'success');
        refreshOvAllData();
        closeExpModal('editExpenseModal');
        _editingExpenseId = null;
    } catch (err) { showExpNotif('Error: ' + err.message, 'error'); console.error(err); }
    finally { showExpLoading('editExpenseBtn', false); }
}

// ════════════════════════════════════════════════════════════
// EDIT PAYROLL
// ════════════════════════════════════════════════════════════
let _editingPayrollId = null;
let _editPayStaged    = [];
let _editPayKept      = [];

async function openEditPayrollModal(id) {
    let p = expPayroll.find(x => x.id === id);
    if (!p) {
        try {
            const snap = await db.collection('payroll').doc(id).get();
            if (snap.exists) p = { id: snap.id, ...snap.data() };
        } catch (err) { console.error('openEditPayrollModal fetch:', err); }
    }
    if (!p) { showExpNotif('Payroll entry not found.', 'error'); return; }
    _editingPayrollId = id; _editPayStaged = []; _editPayKept = [];
    document.getElementById('editPayWorkerName').value = p.workerName  || '';
    document.getElementById('editPayRole').value       = p.role        || '';
    const _laborType = p.laborType || 'direct';
    const _radio = document.querySelector('input[name="editPayLaborType"][value="' + _laborType + '"]');
    if (_radio) _radio.checked = true;
    const _burden = p.liabilityFor === 'indirect' ? 'indirect' : 'direct';
    const _bRadio = document.querySelector('input[name="editPayLiabilityFor"][value="' + _burden + '"]');
    if (_bRadio) _bRadio.checked = true;
    const _eDays = document.getElementById('editPayDays'); if (_eDays) _eDays.value = p.daysWorked || '';
    const _eRate = document.getElementById('editPayDailyRate'); if (_eRate) _eRate.value = p.dailyRate || '';
    document.getElementById('editPayTotal').value      = p.totalSalary || '';
    // Edit modal is lump-sum only now (days/rate fields removed) — always make the
    // "Amount paid" field editable and keep the saved total (legacy daily-rate entries
    // keep their total and convert to lump-sum on save).
    _applyPayMode(true, { rateGroup: 'editPayRateGroup', rate: 'editPayDailyRate', total: 'editPayTotal', hint: 'editPayTotalHint', days: 'editPayDays' });
    // Ensure paymentDate is in datetime-local format (YYYY-MM-DDTHH:mm)
    const _payDt = p.paymentDate || '';
    document.getElementById('editPayDate').value = _payDt.includes('T') ? _payDt : (_payDt ? _payDt + 'T00:00' : '');
    document.getElementById('editPayNotes').value      = p.notes       || '';
    if (typeof lcPopulatePayrollPicker === 'function') lcPopulatePayrollPicker();
    const _ecSel = document.getElementById('editPayContract');
    if (_ecSel) _ecSel.value = p.contractId || '';
    lcUpdateRemainingHint('editPayContract', 'editPayContractRemaining');
    payToggleContractForType('edit');   // an indirect row shows no contract picker
    if (typeof editPayMileFromValue === 'function') editPayMileFromValue(p.payMilestone || '');
    const imgs = p.receiptImages?.length ? p.receiptImages : (p.receiptURL ? [p.receiptURL] : []);
    _editPayKept = [...imgs];
    _renderEditPayGrid();
    openExpModal('editPayrollModal');
}

function _renderEditPayGrid() {
    const grid = document.getElementById('editPayReceiptGrid');
    if (!grid) return;
    grid.innerHTML = '';
    let count = 0;
    _editPayKept.forEach((src, i) => {
        count++;
        const d = document.createElement('div');
        d.className = 'exp-receipt-thumb';
        d.innerHTML = `<img src="${src}" alt="Receipt ${count}">
            <button type="button" class="exp-receipt-remove" onclick="_removeEditPayKept(${i})">✕</button>
            <span class="exp-receipt-num">${count}</span>`;
        grid.appendChild(d);
    });
    _editPayStaged.forEach((item, i) => {
        if (!item) return; count++;
        const d = document.createElement('div');
        d.className = 'exp-receipt-thumb exp-receipt-thumb-new';
        d.innerHTML = `<img src="${item.dataURL}" alt="New ${count}">
            <button type="button" class="exp-receipt-remove" onclick="_removeEditPayStaged(${i})">✕</button>
            <span class="exp-receipt-num">${count}</span>
            <span class="exp-receipt-new-badge">NEW</span>`;
        grid.appendChild(d);
    });
    grid.style.display = count > 0 ? 'grid' : 'none';
}
function _removeEditPayKept(i)   { _editPayKept.splice(i, 1); _renderEditPayGrid(); }
function _removeEditPayStaged(i) { _editPayStaged[i] = null;  _renderEditPayGrid(); }

function setupEditPayrollFormListeners() {
    const form = document.getElementById('editPayrollForm');
    if (!form) return;
    const days = document.getElementById('editPayDays');
    const rate = document.getElementById('editPayDailyRate');
    const tot  = document.getElementById('editPayTotal');
    const recalc = () => {
        if (_editPayIsLamsam()) return;
        if (tot) tot.value = fmtBudgetVal((parseFloat(days?.value) || 0) * (parseFloat((rate?.value||'').replace(/,/g,'')) || 0));
    };
    days?.addEventListener('input', recalc);
    rate?.addEventListener('input', recalc);
    document.getElementById('editPayReceiptInput')?.addEventListener('change', ev => {
        Array.from(ev.target.files).forEach(file => {
            const reader = new FileReader();
            reader.onload = e => { _editPayStaged.push({ file, dataURL: e.target.result }); _renderEditPayGrid(); };
            reader.readAsDataURL(file);
        });
        ev.target.value = '';
    });
    form.addEventListener('submit', handleEditPayroll);
}

async function handleEditPayroll(ev) {
    ev.preventDefault();
    if (!_editingPayrollId) return;
    try {
        showExpLoading('editPayrollBtn', true);
        const _eLamsam = _editPayIsLamsam();
        const d = parseFloat((document.getElementById('editPayDays') || {}).value) || 0;
        const r = _eLamsam ? 0 : (parseFloat(((document.getElementById('editPayDailyRate') || {}).value||'').replace(/,/g,'')) || 0);
        const eTotal = _eLamsam ? (parseFloat((document.getElementById('editPayTotal').value||'').replace(/,/g,'')) || 0) : (d * r);
        const newImgs = [];
        for (const item of _editPayStaged.filter(x => x !== null))
            newImgs.push(await compressImageToBase64(item.file));
        const finalImages = [..._editPayKept, ...newImgs];
        const laborType = (document.querySelector('input[name="editPayLaborType"]:checked') || {}).value || 'direct';
        const liabilityFor = laborType === 'liability'
            ? ((document.querySelector('input[name="editPayLiabilityFor"]:checked') || {}).value || 'direct')
            : null;
        // Re-tagging a row as Overhead / indirect also unlinks it from the contract,
        // so the worker's agreed amount is credited back.
        const editContractId = laborType === 'indirect' ? null : ((document.getElementById('editPayContract') || {}).value || null);
        const editMilestone = editContractId ? ((document.getElementById('editPayMilestone') || {}).value || null) : null;
        // Over-cap warning excludes THIS row's current contribution so editing isn't double-counted.
        if (editContractId && !lcConfirmOverCap(editContractId, eTotal, _editingPayrollId)) {
            showExpLoading('editPayrollBtn', false); return;
        }
        await db.collection('payroll').doc(_editingPayrollId).update({
            workerName:    document.getElementById('editPayWorkerName').value.trim(),
            role:          document.getElementById('editPayRole').value.trim(),
            laborType,
            liabilityFor,   // null unless laborType === 'liability'
            daysWorked:    d, dailyRate: r, totalSalary: eTotal,
            paymentDate:   document.getElementById('editPayDate').value,
            notes:         document.getElementById('editPayNotes').value.trim(),
            receiptImages: finalImages,
            contractId:    editContractId,
            payMilestone:  editMilestone,
        });
        showExpNotif('Payroll updated! ✓', 'success');
        refreshOvAllData();
        closeExpModal('editPayrollModal');
        _editingPayrollId = null; _editPayStaged = []; _editPayKept = [];
    } catch (err) { showExpNotif('Error: ' + err.message, 'error'); console.error(err); }
    finally { showExpLoading('editPayrollBtn', false); }
}

// ════════════════════════════════════════════════════════════
// MODAL HELPERS
// ════════════════════════════════════════════════════════════
// True only while the legacy Expenses-tab "guard" path is opening a modal.
// Lets openExpModal tell apart a legacy open (uses the file-scoped current
// project) from a React Project-Control open (provides window.expCurrentProject).
let _legacyModalOpen = false;

function openExpModal(id)  {
    // The React "Add Payroll / Add Expense" buttons live in portal-app and set the
    // chosen billing period on window.expCurrentProject — a DIFFERENT binding from the
    // file-scoped expCurrentProject that the save handlers read. Sync it here so the
    // entry is charged to the period the user is actually viewing (otherwise it falls
    // back to a stale period and silently never appears in that folder's list).
    if (!_legacyModalOpen && (id === 'addPayrollModal' || id === 'addExpenseModal')
        && window.expCurrentProject && window.expCurrentProject.id) {
        expCurrentProject = window.expCurrentProject;
        expCurrentFolder  = null;
        // Rebuild the funding-source list for THIS period (same as the legacy guard path),
        // so the save has a valid source to charge instead of erroring or using a stale one.
        if (id === 'addPayrollModal') _updatePayBudgetBanner();
        else                          _updateExpBudgetBanner();
    }
    _legacyModalOpen = false;
    if (id === 'addExpenseModal') {
        // Start collapsed, and default the date to today. The date input is `required`
        // but sits inside that collapsed panel, so it must never open empty.
        const d = document.getElementById('expDate');
        if (d && !d.value) {
            // Build from local parts — toISOString() would roll back a day in UTC+8.
            const n = new Date();
            d.value = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
        }
        if (typeof window.expSetMoreDetails === 'function') window.expSetMoreDetails(false);
    }
    if (id === 'addPayrollModal' && typeof payToggleMode === 'function') payToggleMode(); // sync Daily/Lamsam UI
    if (id === 'addPayrollModal' && typeof lcPopulatePayrollPicker === 'function') {
        lcPopulatePayrollPicker();
        const sel = document.getElementById('payContract'); if (sel) sel.value = '';
        lcUpdateRemainingHint('payContract', 'payContractRemaining');
        payToggleContractForType('add');   // keep the picker in sync with the labor category
        if (typeof payResetMilestone === 'function') payResetMilestone();
    }
    const m = document.getElementById(id); if (m) m.classList.add('active');
}
function closeExpModal(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('active');
    // Clear staged payroll receipts when closing that modal
    if (id === 'addPayrollModal') clearPayReceiptPreview();
    // Reset the inventory toggle so it doesn't stay on for the next expense
    if (id === 'addExpenseModal') {
        const cb = document.getElementById('expToInventory');
        if (cb) cb.checked = false;
        if (typeof window.expToggleInventoryFields === 'function') window.expToggleInventoryFields();
    }
}
function guardExpModal(modalId) {
    if (!expCurrentProject && !expCurrentFolder) { showExpNotif('Please select a project first.', 'error'); return; }
    if (modalId === 'addExpenseModal') _updateExpBudgetBanner();
    if (modalId === 'addPayrollModal') _updatePayBudgetBanner();
    _legacyModalOpen = true;   // legacy path: keep the file-scoped current project
    openExpModal(modalId);
}

function selectFolderAutoProject(folderId) {
    selectFolder(folderId);
}

// Holds the available sources for the current Add Expense session
var _expSources = [];

// Additional Works child folders (parentFolderId set) have no monthly budget
// and no Cover Expenses concept — entries are recorded straight against the
// (hidden) auto-provisioned period as normal labor/material.
function _expIsAdditionalWorks() {
    const fid = expCurrentProject ? (expCurrentProject.folderId || null) : (expCurrentFolder ? expCurrentFolder.id : null);
    if (!fid) return false;
    const folder = expFolders.find(f => f.id === fid);
    return !!(folder && folder.parentFolderId);
}

function _updateExpBudgetBanner() {
    const banner  = document.getElementById('expBudgetBanner');
    const fsWrap  = document.getElementById('expFundingSourceWrap');
    if (!banner) return;

    const p   = expCurrentProject;
    const fid = p ? (p.folderId || null) : (expCurrentFolder ? expCurrentFolder.id : null);
    if (!p && !fid) { banner.style.display = 'none'; if (fsWrap) fsWrap.style.display = 'none'; return; }

    if (_expIsAdditionalWorks()) {
        _expCoverExpensesMode = false;
        banner.style.display = 'none';
        if (fsWrap) fsWrap.style.display = 'none';
        return;
    }

    const folderMonths = expProjects.filter(m => m.folderId === fid && m.fundingType !== 'president' && (m.monthlyBudget || 0) > 0);
    _expSources = folderMonths.map(m => {
        const spent = expExpenses.filter(e => e.projectId === m.id).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
                    + expPayroll.filter(pr => pr.projectId === m.id).reduce((s, pr) => s + (parseFloat(pr.totalSalary) || 0), 0);
        return { id: m.id, label: m.month + ' ' + m.year + ' · ' + _fundingLabel(m), remain: (m.monthlyBudget || 0) - spent, budget: m.monthlyBudget || 0 };
    });

    const hasSources = _expSources.some(s => s.remain > 0);

    if (!hasSources) {
        // No remaining budget — Cover Expenses mode
        _expCoverExpensesMode = true;
        if (fsWrap) fsWrap.style.display = 'none';
        const fallbackId = p ? p.id : (folderMonths.length > 0 ? folderMonths[folderMonths.length - 1].id : '');
        const fsSel = document.getElementById('expFundingSourceSelect');
        if (fsSel) fsSel.innerHTML = '<option value="' + fallbackId + '" selected></option>';
        banner.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.75rem;padding:0.65rem 0.9rem;border-radius:10px;font-size:0.88rem;font-weight:600;background:#fce7f3;color:#be185d;border:1px solid #fbcfe8;';
        banner.innerHTML = '<span>🏦 No remaining budget — expense will be recorded as <strong>Cover Expenses</strong></span>';
        return;
    }

    _expCoverExpensesMode = false;
    banner.style.display = 'none';

    // Build checkbox list
    if (fsWrap) {
        fsWrap.style.display = 'block';
        const list = document.getElementById('expFundingCheckList');
        if (list) {
            const visibleSources = _expSources.filter(s => s.remain > 0);
            // If the active period isn't among the fundable sources, default to the first
            // one so a source is always selected (otherwise the save has nothing to charge).
            const pMatches = p && visibleSources.some(s => s.id === p.id);
            list.innerHTML = visibleSources.map((s, i) => {
                const isChecked = pMatches ? s.id === p.id : i === 0;
                const remClass  = s.remain < s.budget * 0.1 ? 'is-low' : '';
                return '<label class="exp-funding-check-item' + (isChecked ? ' is-checked' : '') + '">'
                    + '<input type="checkbox" name="expFundingSrc" value="' + s.id + '"'
                    + (isChecked ? ' checked' : '')
                    + ' onchange="expFundingCheckChanged(this)">'
                    + '<span class="exp-funding-check-item__label">' + s.label + '</span>'
                    + '<span class="exp-funding-check-item__remain ' + remClass + '">₱' + formatNum(s.remain) + ' left</span>'
                    + '</label>';
            }).join('');
        }
    }
    _updateExpSplitPreview();
}

function expFundingCheckChanged(cb) {
    // Update is-checked class
    const item = cb.closest('.exp-funding-check-item');
    if (item) item.classList.toggle('is-checked', cb.checked);
    _updateExpSplitPreview();
}

function _updateExpSplitPreview() {
    const preview  = document.getElementById('expSplitPreview');
    if (!preview) return;

    const amtRaw   = (document.getElementById('expAmount') || {}).value || '0';
    const total    = parseFloat(amtRaw.replace(/,/g, '')) || 0;
    const checked  = Array.from(document.querySelectorAll('input[name="expFundingSrc"]:checked'))
                        .map(cb => _expSources.find(s => s.id === cb.value))
                        .filter(Boolean);

    if (!checked.length || total <= 0) { preview.style.display = 'none'; return; }

    const totalAvailable = checked.reduce((s, src) => s + Math.max(src.remain, 0), 0);
    const overBudget     = total > totalAvailable;

    // Hide preview only when single source AND amount fits within its budget
    if (checked.length === 1 && !overBudget) { preview.style.display = 'none'; return; }

    // Priority split: lowest remaining first; true overflow → Cover Expenses row
    const sorted = [...checked].sort((a, b) => a.remain - b.remain);
    let left = total;
    const splits = [];
    for (const s of sorted) {
        if (left <= 0) break;
        const charge = Math.min(s.remain > 0 ? s.remain : 0, left);
        if (charge > 0) { left -= charge; splits.push({ label: s.label, charge, remain: s.remain, isCover: false }); }
    }
    if (left > 0) splits.push({ label: '🏦 Cover Expenses', charge: left, remain: -1, isCover: true });

    preview.style.display = 'block';
    preview.innerHTML = '<div class="exp-split-preview">'
        + '<div class="exp-split-preview__header">' + (overBudget ? '⚠️ Over Budget' : '💡 Split Preview') + '</div>'
        + splits.map(sp => '<div class="exp-split-preview__row">'
            + '<span class="exp-split-preview__name">' + sp.label + '</span>'
            + '<span class="exp-split-preview__amt' + (sp.isCover ? ' is-over' : '') + '">₱' + formatNum(sp.charge) + '</span>'
            + '</div>').join('')
        + '<div class="exp-split-preview__total"><span>Total</span><span>₱' + formatNum(total) + '</span></div>'
        + (overBudget ? '<div class="exp-split-preview__warn">⚠ ₱' + formatNum(total - totalAvailable) + ' over budget — excess will be charged to Cover Expenses</div>' : '')
        + '</div>';
}

function _fundingLabel(m) {
    const map = { mobilization: '🚧 Mobilization', downpayment: '💰 Downpayment', progress: '📋 Billing #' + (m.billingNumber || '?'), final: '🏁 Final Payment', president: '🏦 Cover Expenses' };
    return map[m.fundingType] || m.fundingType || '';
}

function _fundingBadgeHTML(m, isCover) {
    const styles = {
        mobilization: 'background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;',
        downpayment:  'background:#fefce8;color:#a16207;border:1px solid #fde68a;',
        progress:     'background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;',
        final:        'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;',
        president:    'background:#fce7f3;color:#be185d;border:1px solid #fbcfe8;',
    };
    if (isCover || (m && m.fundingType === 'president')) {
        return '<br><span style="font-size:0.72rem;font-weight:600;padding:1px 6px;border-radius:4px;background:#fce7f3;color:#be185d;border:1px solid #fbcfe8;">Charged to 🏦 Cover Expenses</span>';
    }
    const label = _fundingLabel(m);
    const style = styles[m.fundingType] || 'background:#f3f4f6;color:#6b7280;border:1px solid #e5e7eb;';
    return '<br><span style="font-size:0.72rem;font-weight:600;padding:1px 6px;border-radius:4px;' + style + '">Charged to ' + label + '</span>';
}

function _updateFundingBannerFromSelect(sources) {
    const fsSel  = document.getElementById('expFundingSourceSelect');
    const banner = document.getElementById('expBudgetBanner');
    if (!fsSel || !banner) return;
    const s = sources.find(x => x.id === fsSel.value);
    if (!s) return;
    banner.innerHTML = '<span>💰 Remaining: <strong style="font-size:1rem">₱' + formatNum(s.remain) + '</strong> <span style="font-weight:400;color:#86efac;font-size:0.8rem">of ₱' + formatNum(s.budget) + '</span></span>';
}

// ════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════
function getCategoryBadgeHTML(category) {
    if (!category) return '<span class="exp-badge" style="background:#f3f4f6;color:#6b7280">—</span>';
    const cat = expCategories.find(c => c.name === category);
    const color = cat ? cat.color : '#a78bfa';
    const hex = color.replace('#','');
    const r = parseInt(hex.substring(0,2),16);
    const g = parseInt(hex.substring(2,4),16);
    const b = parseInt(hex.substring(4,6),16);
    return `<span class="exp-badge" style="background:rgba(${r},${g},${b},0.15);color:${color};border:1px solid rgba(${r},${g},${b},0.3)">${category}</span>`;
}

// Compact category pill for the flat "All Categories" list — small and subtle
// so it sits cleanly next to the expense name without bloating the row.
function getCategoryPillHTML(category) {
    if (!category) return '';
    const cat = expCategories.find(c => c.name === category);
    const color = cat ? cat.color : '#a78bfa';
    const hex = color.replace('#','');
    const r = parseInt(hex.substring(0,2),16);
    const g = parseInt(hex.substring(2,4),16);
    const b = parseInt(hex.substring(4,6),16);
    return `<span class="exp-cat-pill" style="color:${color};background:rgba(${r},${g},${b},0.12)">${category}</span>`;
}

function formatNum(n) {
    if (n === undefined || n === null) return '0.00';
    return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    const datePart = dt.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    // Only show time if the value includes a time component (not midnight exactly from date-only input)
    const hasTime = typeof d === 'string' && d.includes('T') && !d.endsWith('T00:00') && !d.endsWith('T00:00:00');
    if (hasTime) {
        const timePart = dt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true });
        return datePart + ' · ' + timePart;
    }
    return datePart;
}
function _setOverviewEmpty(isEmpty) {
    const pairs = [
        ['expOverviewEmptyState',  'expOverviewContent'],
        ['expExpensesEmptyState',  'expExpensesContent'],
        ['expPayrollEmptyState',   'expPayrollContent'],
        ['expReportsEmptyState',   'expReportsContent'],
    ];
    pairs.forEach(([emptyId, contentId]) => {
        const e = document.getElementById(emptyId);
        const c = document.getElementById(contentId);
        if (e) e.style.display = isEmpty ? 'flex' : 'none';
        if (c) c.style.display = isEmpty ? 'none' : 'block';
    });
}

function _syncAllEmptyStates() {
    const hasSelection = !!(expCurrentProject || expCurrentFolder);
    _setOverviewEmpty(!hasSelection);
}

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function setStyle(id, prop, val) { const el = document.getElementById(id); if (el) el.style[prop] = val; }
function _buildDateTime(dateId, timeId) {
    const dateVal = (document.getElementById(dateId)?.value || '').trim();
    if (!dateVal) return '';
    const timeVal = (document.getElementById(timeId)?.value || '').trim();
    return timeVal ? dateVal + 'T' + timeVal : dateVal + 'T00:00:00';
}
function showExpNotif(msg, type = 'success') {
    const n = document.getElementById('expNotification');
    if (!n) return;
    n.textContent = msg;
    n.className = 'exp-notification ' + type + ' show';
    setTimeout(() => n.classList.remove('show'), 3500);
}
function showExpLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Saving…' : (btn.dataset.label || 'Save');
}

console.log('✅ Expenses Tracker Module Loaded');
// ════════════════════════════════════════════════════════════
// REPORTS DASHBOARD — Weekly / Monthly / Quarterly / Semi / Annual
// ════════════════════════════════════════════════════════════
let _rptState = {
    period:      'monthly',
    year:        new Date().getFullYear(),
    folderId:    '',
    projects:    [],
    allExpenses: [],
    allPayroll:  [],
    loading:     false
};
let _rptCharts = {};

function initReportsDashboard() {
    // Populate year selector
    const yearSel = document.getElementById('rptYearSel');
    if (yearSel) {
        const cy = new Date().getFullYear();
        const prev = yearSel.value ? parseInt(yearSel.value) : _rptState.year;
        yearSel.innerHTML = '';
        for (let y = cy + 1; y >= cy - 4; y--) {
            const o = document.createElement('option');
            o.value = y; o.textContent = y;
            if (y === prev) o.selected = true;
            yearSel.appendChild(o);
        }
        _rptState.year = parseInt(yearSel.value) || cy;
    }

    // Populate folder selector
    const folderSel = document.getElementById('rptFolderSel');
    if (folderSel) {
        const prevFid = folderSel.value || _rptState.folderId;
        folderSel.innerHTML = '<option value="">All Folders</option>';
        expFolders.forEach(f => {
            const o = document.createElement('option');
            o.value = f.id; o.textContent = f.name;
            if (f.id === prevFid) o.selected = true;
            folderSel.appendChild(o);
        });
        _rptState.folderId = folderSel.value || '';
    }

    // Sync period tabs
    document.querySelectorAll('.rpt-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.period === _rptState.period)
    );
    if (typeof lucide !== 'undefined') lucide.createIcons();
    _rptUpdateAxisHint(_rptState.period);
    loadRptData();
}

function onRptYearChange() {
    _rptState.year = parseInt(document.getElementById('rptYearSel')?.value) || new Date().getFullYear();
    loadRptData();
}

function onRptFolderChange() {
    _rptState.folderId = document.getElementById('rptFolderSel')?.value || '';
    loadRptData();
}

function setRptPeriod(period) {
    _rptState.period = period;
    document.querySelectorAll('.rpt-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.period === period)
    );
    _rptUpdateAxisHint(period);
    renderReportsDashboard();
}

function _rptUpdateAxisHint(period) {
    const el = document.getElementById('rptAxisHintText');
    if (!el) return;
    const hints = {
        weekly:    'X-axis: <strong>W1, W2, W3…</strong> — W = Week number. W1 is the 1st week of January, up to W52/W53 in December.',
        monthly:   'X-axis: <strong>Jan, Feb, Mar…</strong> — Each bar represents one calendar month.',
        quarterly: 'X-axis: <strong>Q1 – Q4</strong> — Q = Quarter. Q1=Jan–Mar · Q2=Apr–Jun · Q3=Jul–Sep · Q4=Oct–Dec',
        semi:      'X-axis: <strong>H1, H2</strong> — H = Half-year. H1=Jan–Jun (first 6 months) · H2=Jul–Dec (last 6 months)',
        annual:    'X-axis: <strong>Full Year</strong> — One combined bar showing total spending for the entire year.'
    };
    el.innerHTML = hints[period] || '';
}

function loadRptData() {
    if (!currentUser) return;
    _rptState.loading = true;
    _rptShowLoading();

    // Specific folder → ALL billing periods for that folder (any year).
    // All Folders → ALL billing periods across all years; year dropdown only affects chart labels.
    let folderProjects;
    if (_rptState.folderId) {
        folderProjects = expProjects.filter(p => p.folderId === _rptState.folderId);
    } else {
        folderProjects = expProjects; // all billing periods, all years
    }

    if (!folderProjects.length) {
        const label = _rptState.folderId
            ? (expFolders.find(f => f.id === _rptState.folderId)?.name || 'selected folder')
            : 'any folder';
        _rptShowEmpty(`No projects found for ${label}. Try a different selection.`);
        _rptState.loading = false;
        return;
    }

    const idSet = new Set(folderProjects.map(p => p.id));
    const ids   = Array.from(idSet);

    // Update subtitle
    const folderCount = _rptState.folderId ? 1 : new Set(folderProjects.map(p => p.folderId).filter(Boolean)).size;
    const projCount   = folderProjects.length;
    const folderLabel = _rptState.folderId
        ? (expFolders.find(f => f.id === _rptState.folderId)?.name || 'Folder')
        : 'Company-Wide';
    // Scope reads as a chip (COMPANY-WIDE / the folder name); the counts sit
    // beside it as quiet meta text.
    setText('rptScopeChip', folderLabel.toUpperCase());
    setText('rptCompanySub',
        `${projCount} project period${projCount!==1?'s':''} · ${folderCount} folder${folderCount!==1?'s':''}`);

    _rptState.projects = folderProjects;

    // Use global cache if populated; otherwise fetch from Firestore.
    // For specific folder: filter by projectId only.
    // For All Folders: same — no year filtering on expenses (all-time totals).
    const cachedExp = _ovAllExpenses.filter(e => idSet.has(e.projectId));
    const cachedPay = _ovAllPayroll.filter(p => idSet.has(p.projectId));

    if (cachedExp.length || cachedPay.length) {
        _rptState.allExpenses = cachedExp;
        _rptState.allPayroll  = cachedPay;
        _rptState.loading = false;
        renderReportsDashboard();
        return;
    }

    // Cache empty — fetch from Firestore.
    // For All Folders: fetch ALL user expenses (avoids missing data in other-year billing periods).
    // For specific folder: fetch by billing period IDs.
    const allExp = [], allPay = [];
    const uid = _uid();
    const promises = [];

    if (!_rptState.folderId) {
        // All Folders: fetch all user expenses (no projectId restriction)
        promises.push(
            db.collection('expenses').where('userId', '==', uid).get()
              .then(snap => snap.docs.forEach(d => allExp.push({ id: d.id, ...d.data() })))
        );
        promises.push(
            db.collection('payroll').where('userId', '==', uid).get()
              .then(snap => snap.docs.forEach(d => allPay.push({ id: d.id, ...d.data() })))
        );
    } else {
        // Specific folder: fetch by billing period IDs (chunked)
        const chunks = [];
        for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
        chunks.forEach(chunk => {
            promises.push(
                db.collection('expenses').where('projectId', 'in', chunk).where('userId', '==', uid).get()
                  .then(snap => snap.docs.forEach(d => allExp.push({ id: d.id, ...d.data() })))
            );
            promises.push(
                db.collection('payroll').where('projectId', 'in', chunk).where('userId', '==', uid).get()
                  .then(snap => snap.docs.forEach(d => allPay.push({ id: d.id, ...d.data() })))
            );
        });
    }

    Promise.all(promises).then(() => {
        // Merge into global cache so future calls are instant
        allExp.forEach(e => { if (!_ovAllExpenses.find(x => x.id === e.id)) _ovAllExpenses.push(e); });
        allPay.forEach(p => { if (!_ovAllPayroll.find(x => x.id === p.id)) _ovAllPayroll.push(p); });

        _rptState.allExpenses = allExp;
        _rptState.allPayroll  = allPay;
        _rptState.loading = false;
        renderReportsDashboard();
    }).catch(err => {
        console.error('Reports fetch error:', err);
        _rptShowEmpty('Error loading report data. Please try again.');
        _rptState.loading = false;
    });
}

function _rptShowLoading() {
    const row = document.getElementById('rptKpiRow');
    if (row) row.innerHTML = '<div class="rpt-loading"><span class="rpt-spinner"></span>Loading report data…</div>';
}

function _rptShowEmpty(msg) {
    const row = document.getElementById('rptKpiRow');
    if (row) row.innerHTML = `<div class="rpt-empty-state"><i data-lucide="bar-chart-2" class="rpt-empty-ico"></i><p>${msg}</p></div>`;
    const tbody = document.getElementById('rptSummaryTbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="exp-empty-row">${msg}</td></tr>`;
    Object.values(_rptCharts).forEach(c => { try { c.destroy(); } catch(e){} }); _rptCharts = {};
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function _rptAllTimeGroups() {
    // Build a single all-time group (no year filter) to match Budget Overview totals
    const allProjs = _rptState.folderId
        ? expProjects.filter(p => p.folderId === _rptState.folderId)
        : expProjects;
    const allProjIdSet  = new Set(allProjs.map(p => p.id));
    const _src2Exp = _ovAllExpenses.length ? _ovAllExpenses : expExpenses;
    const _src2Pay = _ovAllPayroll.length  ? _ovAllPayroll  : expPayroll;
    const allExps       = _src2Exp.filter(e => allProjIdSet.has(e.projectId));
    const allPay        = _src2Pay.filter(p => allProjIdSet.has(p.projectId));
    const clientProjs   = allProjs.filter(p => p.fundingType !== 'president');
    const presProjIds   = new Set(allProjs.filter(p => p.fundingType === 'president').map(p => p.id));

    const budget     = clientProjs.reduce((s, p) => s + (parseFloat(p.monthlyBudget) || 0), 0);
    const mats       = allExps.filter(e => !e.coverExpense).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const labor      = allPay.filter(p => !presProjIds.has(p.projectId)).reduce((s, p) => s + (parseFloat(p.totalSalary) || 0), 0);
    const totalSpent = mats + labor;
    const remaining  = budget - totalSpent;
    const usedPct    = budget > 0 ? (totalSpent / budget) * 100 : 0;
    const workers    = new Set(allPay.map(p => p.workerName || p.id));
    const totalContract = _rptState.folderId
        ? (expFolders.find(f => f.id === _rptState.folderId)?.totalBudget || 0)
        : expFolders.reduce((s, f) => s + (f.totalBudget || 0), 0);

    function _st(pct) {
        if (pct > 100) return 'danger';
        if (pct > 85)  return 'warning';
        if (pct > 60)  return 'ontrack';
        return 'healthy';
    }

    return [{ label: 'All Time', shortLabel: 'All', months: _MONTHS,
        contractValue: totalContract, budget, mats, labor, totalSpent, remaining, usedPct,
        txCount: allExps.length, workerCount: workers.size, status: _st(usedPct) }];
}

function renderReportsDashboard() {
    if (!_rptState.projects?.length) return;
    let groups = _computePeriodGroups(_rptState.period, _rptState.year,
        _rptState.projects, _rptState.allExpenses, _rptState.allPayroll);

    // Annual: replace with all-time data to match Budget Overview
    if (_rptState.period === 'annual' && groups.length === 1) {
        groups = _rptAllTimeGroups(groups);
    }

    _rptRenderKPIs(groups);
    _rptRenderTrendChart(groups);
    _rptRenderCompositionChart();
    _rptRenderBvaChart(groups);
    _rptRenderCategoryChart();
    _rptRenderTable(groups);
    _rptRenderDetailTables();
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ════════════════════════════════════════════════════════════
// PERIOD GROUPING ENGINE
// ════════════════════════════════════════════════════════════
const _MONTHS = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
const _MON3   = _MONTHS.map(m => m.substring(0,3));

function _computePeriodGroups(period, year, projects, expenses, payroll) {
    // Group projects by month name — support multiple billing periods per month
    const projsByMonth = {};
    projects.forEach(p => {
        if (!projsByMonth[p.month]) projsByMonth[p.month] = [];
        projsByMonth[p.month].push(p);
    });

    const expByProj = {}, payByProj = {};
    projects.forEach(p => { expByProj[p.id] = []; payByProj[p.id] = []; });
    expenses.forEach(e => { if (expByProj[e.projectId]) expByProj[e.projectId].push(e); });
    payroll.forEach(p => { if (payByProj[p.projectId]) payByProj[p.projectId].push(p); });

    function _sumMonths(monthNames) {
        let budget = 0, mats = 0, labor = 0, tx = 0;
        const workers = new Set();
        monthNames.forEach(mo => {
            (projsByMonth[mo] || []).forEach(proj => {
                budget += proj.monthlyBudget || 0;
                (expByProj[proj.id] || []).forEach(e => { mats += e.amount || 0; tx++; });
                (payByProj[proj.id] || []).forEach(p => { labor += p.totalSalary || 0; workers.add(p.workerName || p.id); });
            });
        });
        const totalSpent = mats + labor;
        const remaining  = budget - totalSpent;
        const usedPct    = budget > 0 ? (totalSpent / budget) * 100 : 0;
        return { budget, mats, labor, totalSpent, remaining, usedPct, txCount: tx, workerCount: workers.size };
    }

    function _status(pct) {
        if (pct > 100) return 'danger';
        if (pct > 85)  return 'warning';
        if (pct > 60)  return 'ontrack';
        return 'healthy';
    }

    switch (period) {

        case 'annual': {
            const d = _sumMonths(_MONTHS);
            const totalContract = expFolders.reduce((s, f) => s + (f.totalBudget || 0), 0);
            return [{ label: `FY ${year}`, shortLabel: `${year}`, months: _MONTHS,
                contractValue: totalContract, ...d, status: _status(d.usedPct) }];
        }

        case 'semi': {
            return [
                { label:`H1 ${year}`, shortLabel:'H1', months:_MONTHS.slice(0,6)  },
                { label:`H2 ${year}`, shortLabel:'H2', months:_MONTHS.slice(6,12) }
            ].map(h => ({ ...h, ..._sumMonths(h.months), status: _status(_sumMonths(h.months).usedPct) }));
        }

        case 'quarterly': {
            return [
                { label:`Q1 ${year}`, shortLabel:'Q1', months:_MONTHS.slice(0,3) },
                { label:`Q2 ${year}`, shortLabel:'Q2', months:_MONTHS.slice(3,6) },
                { label:`Q3 ${year}`, shortLabel:'Q3', months:_MONTHS.slice(6,9) },
                { label:`Q4 ${year}`, shortLabel:'Q4', months:_MONTHS.slice(9,12) }
            ].map(q => ({ ...q, ..._sumMonths(q.months), status: _status(_sumMonths(q.months).usedPct) }));
        }

        case 'monthly': {
            return _MONTHS.map((mo, i) => {
                const d = _sumMonths([mo]);
                return { label:`${mo} ${year}`, shortLabel:_MON3[i], months:[mo], ...d, status:_status(d.usedPct) };
            });
        }

        case 'weekly': {
            const weeks = _getWeeksInYear(year);
            return weeks.map(wk => {
                let budget = 0, mats = 0, labor = 0, tx = 0;
                const workers = new Set();

                expenses.forEach(e => {
                    if (!e.dateTime) return;
                    const d = new Date(e.dateTime);
                    if (d >= wk.start && d <= wk.end) { mats += e.amount || 0; tx++; }
                });
                payroll.forEach(p => {
                    if (!p.paymentDate) return;
                    const d = new Date(p.paymentDate);
                    if (d >= wk.start && d <= wk.end) { labor += p.totalSalary || 0; workers.add(p.workerName || p.id); }
                });

                // Prorate monthly budget across this week's days
                for (let day = new Date(wk.start); day <= wk.end; day.setDate(day.getDate() + 1)) {
                    const mo = _MONTHS[day.getMonth()];
                    const monthProjs = projsByMonth[mo] || [];
                    if (!monthProjs.length) continue;
                    const daysInMo = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
                    monthProjs.forEach(proj => { budget += (proj.monthlyBudget || 0) / daysInMo; });
                }

                const totalSpent = mats + labor;
                const remaining  = Math.round(budget) - totalSpent;
                const usedPct    = budget > 0 ? (totalSpent / budget) * 100 : 0;
                return {
                    label: `Wk ${wk.num} · ${_fmtDateShort(wk.start)}`,
                    shortLabel: `W${wk.num}`,
                    months: [],
                    budget: Math.round(budget), mats, labor, totalSpent,
                    remaining, usedPct, txCount: tx, workerCount: workers.size,
                    status: _status(usedPct)
                };
            }).filter(w => w.budget > 0 || w.totalSpent > 0);
        }

        default: return [];
    }
}

function _getWeeksInYear(year) {
    const weeks = [];
    // Monday of the first ISO week that contains Jan 4
    let d = new Date(year, 0, 4);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    let num = 1;
    while (true) {
        const start = new Date(d);
        const end   = new Date(d); end.setDate(end.getDate() + 6);
        // Only include weeks that overlap with the target year
        if (start.getFullYear() > year) break;
        if (end.getFullYear() >= year && start.getFullYear() <= year) {
            const cs = start.getFullYear() < year ? new Date(year, 0, 1) : start;
            const ce = end.getFullYear()   > year ? new Date(year, 11,31) : end;
            weeks.push({ num, start: cs, end: ce });
        }
        d.setDate(d.getDate() + 7); num++;
        if (num > 55) break;
    }
    return weeks;
}

function _fmtDateShort(d) {
    return new Date(d).toLocaleDateString('en-PH', { month:'short', day:'numeric' });
}

// ════════════════════════════════════════════════════════════
// REPORT KPI CARDS
// ════════════════════════════════════════════════════════════
// Overhead expenses cache for the report (fetched once per session).
// null = not fetched yet; the KPI renderer kicks off the fetch and re-renders
// itself when the rows arrive.
let _rptOvhdRows = null;
let _rptOvhdFetching = false;

// A payroll row that belongs to OVERHEAD, not Labor: indirect pay, or the
// statutory burden of an indirect worker. Delegates to overhead-module's
// classifier (single source of truth, incl. the legacy keyword fallback).
function _rptIsOverheadPay(p) {
    if (typeof _ovhdIsIndirectPay === 'function') return _ovhdIsIndirectPay(p);
    if (p.laborType === 'indirect') return true;
    if (p.laborType === 'liability') return p.liabilityFor === 'indirect';
    return false;
}

function _rptRenderKPIs(_groups) {
    const row = document.getElementById('rptKpiRow');
    if (!row) return;
    if (window.currentUserRole === 'staff') { row.style.display = 'none'; return; }

    if (_rptOvhdRows === null && !_rptOvhdFetching) {
        _rptOvhdFetching = true;
        db.collection('overheadExpenses').where('userId', '==', _uid()).get()
            .then(snap => {
                _rptOvhdRows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.deletedAt);
                _rptRenderKPIs(_groups);
            })
            .catch(err => { console.error('rpt overhead fetch:', err); _rptOvhdRows = []; });
    }

    const contract = _rptState.folderId
        ? (expFolders.find(f => f.id === _rptState.folderId)?.totalBudget || 0)
        : expFolders.reduce((s, f) => s + (f.totalBudget || 0), 0);
    const contractLabel = _rptState.folderId
        ? (expFolders.find(f => f.id === _rptState.folderId)?.name || 'Folder')
        : 'Company-Wide';

    const _kpiFolderProjs = _rptState.folderId
        ? expProjects.filter(p => p.folderId === _rptState.folderId)
        : expProjects;
    const _kpiClientProjs = _kpiFolderProjs.filter(p => p.fundingType !== 'president');
    const _kpiPresProjIds = new Set(_kpiFolderProjs.filter(p => p.fundingType === 'president').map(p => p.id));
    const _kpiProjIdSet   = new Set(_kpiFolderProjs.map(p => p.id));

    const totReceived     = _kpiClientProjs.reduce((s, p) => s + (parseFloat(p.monthlyBudget) || 0), 0);
    const activePeriodsCount = _kpiClientProjs.filter(p => (p.monthlyBudget || 0) > 0).length;

    const _srcExp = _ovAllExpenses.length ? _ovAllExpenses : expExpenses;
    const _srcPay = _ovAllPayroll.length  ? _ovAllPayroll  : expPayroll;

    const totMats  = _srcExp.filter(e => _kpiProjIdSet.has(e.projectId) && !e.coverExpense).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    // Same money model as Project Control: Labor = direct + direct burden;
    // Overhead = indirect pay + indirect burden + operating costs. Every peso once.
    const _scopePay   = _srcPay.filter(p => _kpiProjIdSet.has(p.projectId) && !_kpiPresProjIds.has(p.projectId));
    const totIndirect = _scopePay.filter(_rptIsOverheadPay).reduce((s, p) => s + (parseFloat(p.totalSalary) || 0), 0);
    const totLabor    = _scopePay.filter(p => !_rptIsOverheadPay(p)).reduce((s, p) => s + (parseFloat(p.totalSalary) || 0), 0);
    // Operating costs recorded against the folders in scope. Company-scope (G&A)
    // rows are deliberately EXCLUDED — company overhead is never charged to jobs.
    const _scopeFolderIds = _rptState.folderId ? new Set([_rptState.folderId]) : new Set(expFolders.map(f => f.id));
    const totOvhdExp  = (_rptOvhdRows || []).filter(e => !e.deletedAt && e.folderId && _scopeFolderIds.has(e.folderId)).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const totOverhead = totIndirect + totOvhdExp;
    const totSpent = totMats + totLabor + totOverhead;
    const totCover = _srcExp.filter(e => _kpiProjIdSet.has(e.projectId) && (e.coverExpense || _kpiPresProjIds.has(e.projectId))).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
                   + _srcPay.filter(p => _kpiPresProjIds.has(p.projectId)).reduce((s, p) => s + (parseFloat(p.totalSalary) || 0), 0);

    const coverPctOfBudget = totReceived > 0 ? (totCover / totReceived) * 100 : 0;
    // Funds Available = Allocated − Spent. (The old "Budget Remaining" was
    // contract − spent, which treats the whole contract as spendable — i.e. a
    // planned margin of zero. The old "Receivable Balance" was just the
    // complement of the Fund Allocated card's %, so it's gone.)
    const fundsAvail       = totReceived - totSpent;
    const fundsAvailPct    = totReceived > 0 ? (fundsAvail / totReceived) * 100 : 0;
    const utilizedPct      = totReceived > 0 ? (totSpent / totReceived) * 100 : 0;
    const contractUsedPct  = contract > 0 ? (totSpent / contract) * 100 : 0;
    const rcvOfContract    = contract > 0 ? (totReceived / contract) * 100 : 0;
    const txCount          = _srcExp.filter(e => _kpiProjIdSet.has(e.projectId)).length;
    const workerCount      = new Set(_srcPay.filter(p => _kpiProjIdSet.has(p.projectId)).map(p => p.workerName || p.id)).size;

    // Build a standard KPI card: label / big value / sub / optional extra class.
    // White card design — BAD/WARNING are conveyed by the value color (CSS) +
    // the status word in the sub, not by flooding the whole card.
    function _card(label, val, sub, cls) {
        return '<div class="rpt-kpi-card' + (cls ? ' ' + cls : '') + '">'
            + '<div class="rpt-kpi-label">' + label + '</div>'
            + '<div class="rpt-kpi-val">'   + val   + '</div>'
            + '<div class="rpt-kpi-sub">'   + sub   + '</div>'
            + '</div>';
    }

    const staffOnly = window.currentUserRole === 'staff';
    let html = '';

    // Section heading: a small caption + hairline, so the strip reads as three
    // stories (what came in / where it went / what's left) instead of 8 tiles.
    const _group = (title) =>
        '<div class="rpt-group"><span class="rpt-group-title">' + title + '</span><span class="rpt-group-rule"></span></div>';
    // Big card with an icon chip (Contract & Funding).
    const _cardIco = (label, val, sub, icon) =>
        '<div class="rpt-kpi-card rpt-kpi-card--lg">'
        + '<div class="rpt-kpi-ico"><i data-lucide="' + icon + '"></i></div>'
        + '<div class="rpt-kpi-label">' + label + '</div>'
        + '<div class="rpt-kpi-val">' + val + '</div>'
        + '<div class="rpt-kpi-sub">' + sub + '</div>'
        + '</div>';
    // Compact card with a colour dot that matches its series in the charts.
    const _cardDot = (label, val, sub, dot, cls, badge) =>
        '<div class="rpt-kpi-card rpt-kpi-card--sm' + (cls ? ' ' + cls : '') + '">'
        + '<div class="rpt-kpi-dotrow">'
        +   '<span class="rpt-kpi-dot" style="background:' + dot + '"></span>'
        +   '<span class="rpt-kpi-label">' + label + '</span>'
        +   (badge ? '<span class="rpt-kpi-flag">' + badge + '</span>' : '')
        + '</div>'
        + '<div class="rpt-kpi-val">' + val + '</div>'
        + '<div class="rpt-kpi-sub">' + sub + '</div>'
        + '</div>';
    const _bar = (pct, color, track) =>
        '<div class="rpt-kpi-bar" style="background:' + track + '"><div class="rpt-kpi-bar-fill" style="width:'
        + Math.max(Math.min(Math.abs(pct), 100), 2).toFixed(1) + '%;background:' + color + '"></div></div>';

    if (!staffOnly) {
        // ── Contract & Funding: what the job is worth, what's been funded ──
        html += _group('Contract &amp; Funding');
        html += '<div class="rpt-grid rpt-grid-2">'
            + _cardIco('Project Budget', '&#8369;' + formatNum(contract),
                contractLabel + ' &middot; ' + _rptState.year, 'wallet')
            + _cardIco('Fund Allocated', '&#8369;' + formatNum(totReceived),
                activePeriodsCount + ' billing period' + (activePeriodsCount !== 1 ? 's' : '')
                + ' &middot; ' + rcvOfContract.toFixed(1) + '% of contract', 'banknote')
            + '</div>';

        // ── Spending Breakdown: the three cost buckets + the exception ──
        const coverState = coverPctOfBudget >= 5 ? 'BAD' : coverPctOfBudget >= 2 ? 'WARNING' : 'HEALTHY';
        const coverCls   = coverPctOfBudget >= 5 ? 'rpt-kpi-card--bad' : coverPctOfBudget >= 2 ? 'rpt-kpi-card--warn' : '';
        html += _group('Spending Breakdown');
        html += '<div class="rpt-grid rpt-grid-4">'
            + _cardDot('Materials &amp; Costs', '&#8369;' + formatNum(totMats),
                (totReceived > 0 ? ((totMats / totReceived) * 100).toFixed(1) : '0.0') + '% of allocated budget', '#157a52')
            + _cardDot('Labor &amp; Payroll', '&#8369;' + formatNum(totLabor),
                (totReceived > 0 ? ((totLabor / totReceived) * 100).toFixed(1) : '0.0') + '% of allocated budget', '#7f9cb0')
            + _cardDot('Overhead', '&#8369;' + formatNum(totOverhead),
                '&#8369;' + formatNum(totIndirect) + ' indirect labor &middot; &#8369;' + formatNum(totOvhdExp) + ' operating', '#c8a45a')
            + _cardDot('Cover Expenses', '&#8369;' + formatNum(totCover),
                coverPctOfBudget.toFixed(1) + '% of allocated budget', '#b4453a', coverCls, coverState)
            + '</div>';

        // ── Totals & Balance: the two numbers the owner actually acts on ──
        html += _group('Totals &amp; Balance');
        html += '<div class="rpt-grid rpt-grid-2">'
            // Total spent — dark card, utilisation bar
            + '<div class="rpt-kpi-card rpt-kpi-card--dark">'
            +   '<div class="rpt-kpi-dotrow">'
            +     '<span class="rpt-kpi-ico rpt-kpi-ico--dark"><i data-lucide="trending-down"></i></span>'
            +     '<span class="rpt-kpi-label">Total Fund Spent</span>'
            +   '</div>'
            +   '<div class="rpt-kpi-val">&#8369;' + formatNum(totSpent) + '</div>'
            +   _bar(utilizedPct, '#157a52', '#dcebe3')
            +   '<div class="rpt-kpi-sub">Labor + Materials + Overhead &middot; <strong>' + utilizedPct.toFixed(1)
            +     '%</strong> utilized &middot; ' + contractUsedPct.toFixed(1) + '% of contract</div>'
            + '</div>'
            // Funds available — green card, remaining bar
            + '<div class="rpt-kpi-card rpt-kpi-card--avail' + (fundsAvail < 0 ? ' rpt-kpi-card--over' : '') + '">'
            +   '<div class="rpt-kpi-dotrow">'
            +     '<span class="rpt-kpi-label">Funds Available</span>'
            +     '<span class="rpt-kpi-pill">' + (totReceived > 0 ? fundsAvailPct.toFixed(1) + '% of allocated' : 'Nothing allocated yet') + '</span>'
            +   '</div>'
            +   '<div class="rpt-kpi-cap">Allocated &minus; Spent</div>'
            +   '<div class="rpt-kpi-val">' + (fundsAvail < 0 ? '-' : '') + '&#8369;' + formatNum(Math.abs(fundsAvail)) + '</div>'
            +   _bar(fundsAvailPct, fundsAvail < 0 ? '#b4453a' : '#157a52', fundsAvail < 0 ? '#f0d3cf' : '#dcebe3')
            +   '<div class="rpt-kpi-sub">' + (fundsAvail < 0 ? 'overspent beyond allocated funds' : 'available to spend') + '</div>'
            + '</div>'
            + '</div>';
    } else {
        html += '<div class="rpt-grid rpt-grid-4">'
            + _cardDot('Materials &amp; Costs', '&#8369;' + formatNum(totMats), txCount + ' transaction' + (txCount !== 1 ? 's' : ''), '#157a52')
            + _cardDot('Labor &amp; Payroll', '&#8369;' + formatNum(totLabor), workerCount + ' worker' + (workerCount !== 1 ? 's' : ''), '#7f9cb0')
            + _cardDot('Total Fund Spent', '&#8369;' + formatNum(totSpent), contractUsedPct.toFixed(1) + '% of contract value', '#1c2b23')
            + '</div>';
    }

    row.innerHTML = html;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ════════════════════════════════════════════════════════════
// REPORT CHARTS
// ════════════════════════════════════════════════════════════
function _rptRenderTrendChart(groups) {
    const ctx = document.getElementById('rptTrendChart');
    if (!ctx) return;
    const labels     = groups.map(g => g.shortLabel);
    const matsData   = groups.map(g => g.mats);
    const laborData  = groups.map(g => g.labor);
    const budgetData = groups.map(g => g.budget);

    const titleMap = { weekly:'Weekly Spending Trend', monthly:'Monthly Spending Trend',
        quarterly:'Quarterly Spending Trend', semi:'Semi-Annual Spending Trend', annual:'Annual Overview' };
    setText('rptTrendTitle',    titleMap[_rptState.period] || 'Spending Trend');
    setText('rptTrendSubtitle', 'Materials vs Labor · dashed line = allocated budget');

    if (_rptCharts.trend) _rptCharts.trend.destroy();
    _rptCharts.trend = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label:'Materials & Costs', data:matsData,
                  backgroundColor:'#157a52', borderWidth:0,
                  borderRadius:5, stack:'spend' },
                { label:'Labor & Payroll',   data:laborData,
                  backgroundColor:'#7f9cb0', borderWidth:0,
                  borderRadius:5, stack:'spend' },
                { label:'Budget Allocated',  data:budgetData, type:'line',
                  borderColor:'#c39e8b', backgroundColor:'transparent',
                  borderWidth:2, borderDash:[6,4], pointBackgroundColor:'#c39e8b',
                  pointRadius:3, tension:0.35 }
            ]
        },
        options: {
            responsive:true, maintainAspectRatio:false,
            font:{ family:"'IBM Plex Sans', system-ui, sans-serif" },
            plugins: {
                legend:{ position:'bottom', labels:{ font:{size:11}, padding:12, usePointStyle:true, pointStyle:'rectRounded' }},
                tooltip:{ callbacks:{ label: c => ` ${c.dataset.label}: ₱${formatNum(c.parsed.y)}` }}
            },
            scales: {
                x:{ stacked:true, grid:{display:false}, ticks:{ font:{size:11}, color:'#9b9a94' } },
                y:{ stacked:false, beginAtZero:true,
                    ticks:{ callback: v => '₱'+formatNum(v), font:{size:10}, color:'#9b9a94' },
                    grid:{ color:'rgba(0,0,0,0.04)' }, border:{display:false} }
            }
        }
    });
}

function _rptRenderCompositionChart() {
    const ctx = document.getElementById('rptCompositionChart');
    if (!ctx) return;
    const cats = {};
    expCategories.forEach(c => { cats[c.name] = 0; });
    _rptState.allExpenses.forEach(e => {
        const k = e.category || 'Others';
        cats[k] = (cats[k] || 0) + (e.amount || 0);
    });
    cats['Payroll'] = _rptState.allPayroll.reduce((s,p) => s+(p.totalSalary||0), 0);
    const labels = Object.keys(cats).filter(k => cats[k] > 0);
    const data   = labels.map(k => cats[k]);
    const RPT_DONUT = ['#157a52','#7f9cb0','#c8a45a','#9fb98a','#d3cdc2','#b0907f','#a8a79f'];
    const colors = labels.map((k,i) => k==='Payroll' ? '#7f9cb0' : RPT_DONUT[i % RPT_DONUT.length]);
    if (_rptCharts.comp) _rptCharts.comp.destroy();
    _rptCharts.comp = new Chart(ctx, {
        type:'doughnut',
        data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:3, borderColor:'#fff' }]},
        options:{
            responsive:true, maintainAspectRatio:false, cutout:'64%',
            font:{ family:"'IBM Plex Sans', system-ui, sans-serif" },
            plugins:{
                legend:{position:'bottom',labels:{font:{size:11},padding:10,usePointStyle:true,pointStyle:'rectRounded'}},
                tooltip:{callbacks:{label:c=>` ₱${formatNum(c.parsed)} (${((c.parsed/c.chart.getDatasetMeta(0).total)*100).toFixed(1)}%)`}}
            }
        }
    });
}

function _rptRenderBvaChart(groups) {
    const ctx = document.getElementById('rptBudgetVsActualChart');
    if (!ctx) return;
    const filtered = groups.filter(g => g.budget > 0 || g.totalSpent > 0);
    if (_rptCharts.bva) _rptCharts.bva.destroy();
    _rptCharts.bva = new Chart(ctx, {
        type:'bar',
        data:{
            labels: filtered.map(g => g.shortLabel),
            datasets:[
                { label:'Budget',       data:filtered.map(g => g.budget),
                  backgroundColor:'#cdd7cf', borderWidth:0, borderRadius:4 },
                { label:'Actual Spend', data:filtered.map(g => g.totalSpent),
                  backgroundColor:filtered.map(g => g.totalSpent > g.budget ? '#c0564a' : '#157a52'),
                  borderWidth:0, borderRadius:4 }
            ]
        },
        options:{
            responsive:true, maintainAspectRatio:false,
            font:{ family:"'IBM Plex Sans', system-ui, sans-serif" },
            plugins:{
                legend:{position:'bottom',labels:{font:{size:11},padding:12,usePointStyle:true,pointStyle:'rectRounded'}},
                tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ₱${formatNum(c.parsed.y)}`}}
            },
            scales:{
                x:{grid:{display:false}, ticks:{font:{size:11},color:'#9b9a94'}},
                y:{beginAtZero:true, ticks:{callback:v=>'₱'+formatNum(v),font:{size:10},color:'#9b9a94'}, grid:{color:'rgba(0,0,0,0.04)'}, border:{display:false}}
            }
        }
    });
}

function _rptRenderCategoryChart() {
    const ctx = document.getElementById('expCategoryChart');
    if (!ctx) return;
    const cats = {};
    expCategories.forEach(c => { cats[c.name] = 0; });
    cats['Payroll'] = 0;
    _rptState.allExpenses.forEach(e => {
        const k = e.category || 'Others';
        if (!(k in cats)) cats[k] = 0;
        cats[k] += (e.amount || 0);
    });
    cats['Payroll'] = _rptState.allPayroll.reduce((s,p) => s+(p.totalSalary||0), 0);
    const labels = Object.keys(cats).filter(k => cats[k] > 0);
    const data   = labels.map(k => cats[k]);
    const RPT_DONUT = ['#157a52','#7f9cb0','#c8a45a','#9fb98a','#d3cdc2','#b0907f','#a8a79f'];
    const bgColors = labels.map((k,i) => k==='Payroll' ? '#7f9cb0' : RPT_DONUT[i % RPT_DONUT.length]);
    if (expCharts.pie) expCharts.pie.destroy();
    expCharts.pie = new Chart(ctx, {
        type:'doughnut',
        data:{ labels, datasets:[{ data, backgroundColor:bgColors, borderWidth:3, borderColor:'#fff' }]},
        options:{
            responsive:true, maintainAspectRatio:false, cutout:'64%',
            font:{ family:"'IBM Plex Sans', system-ui, sans-serif" },
            plugins:{
                legend:{position:'bottom',labels:{font:{size:11},padding:12,usePointStyle:true,pointStyle:'rectRounded'}},
                tooltip:{callbacks:{label:c=>` ₱${formatNum(c.parsed)} (${((c.parsed/c.chart.getDatasetMeta(0).total)*100).toFixed(1)}%)`}}
            }
        }
    });
}

// ════════════════════════════════════════════════════════════
// REPORT TABLE
// ════════════════════════════════════════════════════════════
function _rptRenderTable(groups) {
    const tbody = document.getElementById('rptSummaryTbody');
    if (!tbody) return;

    const titleMap = { weekly:'Weekly Breakdown', monthly:'Monthly Breakdown',
        quarterly:'Quarterly Breakdown', semi:'Semi-Annual Breakdown', annual:'Annual Summary' };
    const subMap = { weekly:`ISO weeks · ${_rptState.year}`, monthly:`All months · ${_rptState.year}`,
        quarterly:`Q1–Q4 · ${_rptState.year}`, semi:`H1 & H2 · ${_rptState.year}`,
        annual:`Full year summary · ${_rptState.year}` };
    setText('rptTableTitle',    titleMap[_rptState.period] || 'Period Breakdown');
    setText('rptTableSubtitle', subMap[_rptState.period]   || '');

    if (!groups.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="exp-empty-row">No data for this period.</td></tr>';
        return;
    }

    const _badge = s => {
        const map = {
            healthy: ['Healthy',     'rpt-badge-healthy'],
            ontrack: ['On Track',    'rpt-badge-ontrack'],
            warning: ['Near Limit',  'rpt-badge-warning'],
            danger:  ['Over Budget', 'rpt-badge-danger']
        };
        const [label, cls] = map[s] || map.healthy;
        return `<span class="rpt-status-badge ${cls}">${label}</span>`;
    };

    const _bar = pct => {
        const c = Math.min(pct, 100);
        const col = pct > 100 ? '#ef4444' : pct > 85 ? '#f59e0b' : '#059669';
        return `<div class="rpt-inline-bar"><div class="rpt-inline-fill" style="width:${c.toFixed(1)}%;background:${col}"></div></div>`;
    };

    const active = groups.filter(g => g.budget > 0 || g.totalSpent > 0);
    const empty  = groups.filter(g => g.budget === 0 && g.totalSpent === 0);

    let html = active.map(g => `
        <tr>
            <td data-label="Period"><strong>${g.label}</strong>${g.txCount ? `<span class="rpt-row-meta">${g.txCount} tx · ${g.workerCount} worker${g.workerCount!==1?'s':''}</span>` : ''}</td>
            <td data-label="Budget Allocated">₱${formatNum(g.budget)}</td>
            <td data-label="Materials & Costs">₱${formatNum(g.mats)}</td>
            <td data-label="Labor & Payroll">₱${formatNum(g.labor)}</td>
            <td data-label="Current Fund Spent"><strong>₱${formatNum(g.totalSpent)}</strong></td>
            <td data-label="Remaining" class="${g.remaining < 0 ? 'rpt-cell-over' : 'rpt-cell-ok'}">
                ${g.remaining < 0 ? '▲ ' : ''}₱${formatNum(Math.abs(g.remaining))}
            </td>
            <td data-label="% Utilized">
                <div class="rpt-pct-cell">
                    <span class="rpt-pct-num">${g.usedPct.toFixed(1)}%</span>
                    ${_bar(g.usedPct)}
                </div>
            </td>
            <td data-label="Status">${_badge(g.status)}</td>
        </tr>`).join('');

    // Collapsed empty periods row
    if (empty.length) {
        html += `<tr class="rpt-row-empty-periods">
            <td colspan="8" class="rpt-empty-periods-cell">
                <span class="rpt-empty-periods-label">⬜ ${empty.length} period${empty.length>1?'s':''} with no budget or activity: ${empty.map(g=>g.shortLabel).join(', ')}</span>
            </td>
        </tr>`;
    }

    // Totals row
    const tB = active.reduce((s,g) => s+g.budget, 0);
    const tM = active.reduce((s,g) => s+g.mats, 0);
    const tL = active.reduce((s,g) => s+g.labor, 0);
    const tS = active.reduce((s,g) => s+g.totalSpent, 0);
    const tR = tB - tS;
    const tP = tB > 0 ? (tS/tB)*100 : 0;
    const tStatus = tP > 100 ? 'danger' : tP > 85 ? 'warning' : tP > 60 ? 'ontrack' : 'healthy';
    html += `
        <tr class="rpt-totals-row">
            <td data-label="Period"><strong>TOTAL</strong></td>
            <td data-label="Budget Allocated"><strong>₱${formatNum(tB)}</strong></td>
            <td data-label="Materials & Costs"><strong>₱${formatNum(tM)}</strong></td>
            <td data-label="Labor & Payroll"><strong>₱${formatNum(tL)}</strong></td>
            <td data-label="Current Fund Spent"><strong>₱${formatNum(tS)}</strong></td>
            <td data-label="Remaining" class="${tR < 0 ? 'rpt-cell-over' : 'rpt-cell-ok'}"><strong>${tR < 0 ? '▲ ' : ''}₱${formatNum(Math.abs(tR))}</strong></td>
            <td data-label="% Utilized">
                <div class="rpt-pct-cell">
                    <span class="rpt-pct-num"><strong>${tP.toFixed(1)}%</strong></span>
                    <div class="rpt-inline-bar"><div class="rpt-inline-fill" style="width:${Math.min(tP,100).toFixed(1)}%;background:${tP>100?'#ef4444':tP>85?'#f59e0b':'#059669'}"></div></div>
                </div>
            </td>
            <td data-label="Status">${_badge(tStatus)}</td>
        </tr>`;

    tbody.innerHTML = html;
}

// ════════════════════════════════════════════════════════════
// CSV EXPORT
// ════════════════════════════════════════════════════════════
function exportRptTable() {
    if (!_rptState.projects?.length) { showExpNotif('No report data to export.', 'error'); return; }

    let groups = _computePeriodGroups(_rptState.period, _rptState.year,
        _rptState.projects, _rptState.allExpenses, _rptState.allPayroll);
    if (_rptState.period === 'annual' && groups.length === 1) {
        groups = _rptAllTimeGroups(groups);
    }

    // Derive a sensible file name
    const folderIds = [...new Set(_rptState.projects.map(p => p.folderId).filter(Boolean))];
    const firstFolder = folderIds.length === 1 ? expFolders.find(f => f.id === folderIds[0]) : null;
    const reportName = (firstFolder?.name || 'DACs-Report').replace(/\s+/g, '-');

    const esc = v => String(v == null ? '' : v).replace(/"/g, '""');
    const row = arr => arr.map(c => '"' + esc(c) + '"').join(',');

    let csv = '\uFEFF'; // BOM for Excel

    // Section 1: Period Summary
    csv += 'PERIOD SUMMARY\n';
    csv += row(['Period','Total Fund Allocated','Materials & Costs','Labor & Payroll',
                'Current Fund Spent','Remaining','% Utilized','Status','Transactions','Workers']) + '\n';
    groups.forEach(g => {
        csv += row([
            g.label,
            g.budget.toFixed(2), g.mats.toFixed(2), g.labor.toFixed(2),
            g.totalSpent.toFixed(2), g.remaining.toFixed(2),
            g.usedPct.toFixed(1) + '%', g.status, g.txCount, g.workerCount
        ]) + '\n';
    });
    const tB = groups.reduce((s,g) => s + g.budget, 0);
    const tM = groups.reduce((s,g) => s + g.mats, 0);
    const tL = groups.reduce((s,g) => s + g.labor, 0);
    const tS = groups.reduce((s,g) => s + g.totalSpent, 0);
    csv += row(['TOTAL', tB.toFixed(2), tM.toFixed(2), tL.toFixed(2),
                tS.toFixed(2), (tB - tS).toFixed(2),
                (tB > 0 ? (tS / tB) * 100 : 0).toFixed(1) + '%', '', '', '']) + '\n';

    // Section 2: Expense Detail
    csv += '\nEXPENSE DETAIL\n';
    csv += row(['Date','Project','Category','Expense Name','Notes / Detail','Qty','Amount']) + '\n';
    const sortedExp = [..._rptState.allExpenses]
        .sort((a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0));
    sortedExp.forEach(e => {
        const proj = _rptState.projects.find(p => p.id === e.projectId);
        csv += row([
            e.dateTime ? new Date(e.dateTime).toLocaleString() : '',
            proj ? proj.month + ' ' + proj.year : '',
            e.category || '',
            e.expenseName || '',
            e.notes || '',
            e.quantity || 1,
            (e.amount || 0).toFixed(2)
        ]) + '\n';
    });
    const expTotal = _rptState.allExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    csv += row(['', '', '', '', '', 'TOTAL', expTotal.toFixed(2)]) + '\n';

    // Section 3: Payroll Detail
    csv += '\nPAYROLL DETAIL\n';
    csv += row(['Date','Project','Worker Name','Role','Notes / Detail','Days','Daily Rate','Total Salary']) + '\n';
    const sortedPay = [..._rptState.allPayroll]
        .sort((a, b) => new Date(b.paymentDate || 0) - new Date(a.paymentDate || 0));
    sortedPay.forEach(p => {
        const proj = _rptState.projects.find(pr => pr.id === p.projectId);
        csv += row([
            p.paymentDate ? new Date(p.paymentDate).toLocaleString() : '',
            proj ? proj.month + ' ' + proj.year : '',
            p.workerName || '',
            p.role || '',
            p.notes || '',
            p.daysWorked || 0,
            (p.dailyRate || 0).toFixed(2),
            (p.totalSalary || 0).toFixed(2)
        ]) + '\n';
    });
    const payTotal = _rptState.allPayroll.reduce((s, p) => s + (p.totalSalary || 0), 0);
    csv += row(['', '', '', '', '', '', 'TOTAL', payTotal.toFixed(2)]) + '\n';

    // Trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = reportName + '_' + _rptState.period + '_' + _rptState.year + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showExpNotif('CSV exported successfully!', 'success');
}


// ──────────────────────────────────────────────────────────
// PRINT FUNCTIONS
// ──────────────────────────────────────────────────────────
function printTransactionReceipt(type, id) {
    const record = type === 'expense'
        ? (expExpenses.find(e => e.id === id) || _pmExp.find(e => e.id === id))
        : (expPayroll.find(p => p.id === id)  || _pmPay.find(p => p.id === id));
    if (!record) { showExpNotif('Record not found.', 'error'); return; }

    const project = expProjects.find(p => p.id === record.projectId);
    const folder  = project?.folderId ? expFolders.find(f => f.id === project.folderId) : null;

    const receiptNo = 'RCP-' + Date.now().toString(36).toUpperCase();
    const printDate = new Date().toLocaleString('en-PH', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });

    let detailsHTML = '';
    let amountLabel = '';
    let amountValue = '';

    if (type === 'expense') {
        const txDate = record.dateTime
            ? new Date(record.dateTime).toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true })
            : '—';
        detailsHTML = `
            <tr><td class="rc-label">Expense Name</td><td class="rc-value"><strong>${record.expenseName || '—'}</strong></td></tr>
            <tr><td class="rc-label">Category</td><td class="rc-value">${record.category || '—'}</td></tr>
            <tr><td class="rc-label">Quantity</td><td class="rc-value">${record.quantity || 1}</td></tr>
            <tr><td class="rc-label">Transaction Date</td><td class="rc-value">${txDate}</td></tr>
            ${record.notes ? `<tr><td class="rc-label">Notes</td><td class="rc-value">${record.notes}</td></tr>` : ''}`;
        amountLabel = 'Total Amount';
        amountValue = '₱' + formatNum(record.amount);
    } else {
        const payDate = record.paymentDate
            ? new Date(record.paymentDate).toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true })
            : '—';
        detailsHTML = `
            <tr><td class="rc-label">Worker Name</td><td class="rc-value"><strong>${record.workerName || '—'}</strong></td></tr>
            <tr><td class="rc-label">Role / Position</td><td class="rc-value">${record.role || '—'}</td></tr>
            <tr><td class="rc-label">Days Worked</td><td class="rc-value">${record.daysWorked || 0} days</td></tr>
            <tr><td class="rc-label">Daily Rate</td><td class="rc-value">₱${formatNum(record.dailyRate)}</td></tr>
            <tr><td class="rc-label">Payment Date</td><td class="rc-value">${payDate}</td></tr>
            ${record.notes ? `<tr><td class="rc-label">Notes</td><td class="rc-value">${record.notes}</td></tr>` : ''}`;
        amountLabel = 'Total Salary';
        amountValue = '₱' + formatNum(record.totalSalary);
    }

    const images = (record.receiptImages?.length ? record.receiptImages : (record.receiptURL ? [record.receiptURL] : []));
    const imagesHTML = images.length
        ? `<div class="rc-imgs-label">Attached Receipt Images</div>
           <div class="rc-imgs">${images.map((src, i) => `<img src="${src}" alt="Receipt ${i+1}">`).join('')}</div>`
        : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Receipt — ${receiptNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background:#f5f5f5; color:#1a1a1a; }
  .rc-page { max-width:520px; margin:24px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.12); }
  .rc-header { background:linear-gradient(135deg,#059669,#047857); padding:28px 28px 20px; color:#fff; }
  .rc-header-top { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
  .rc-logo-circle { width:52px; height:52px; background:rgba(255,255,255,0.2); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.5rem; font-weight:900; letter-spacing:-1px; flex-shrink:0; }
  .rc-company { flex:1; }
  .rc-company-name { font-size:1.1rem; font-weight:800; letter-spacing:0.04em; }
  .rc-company-sub  { font-size:0.75rem; opacity:0.85; margin-top:2px; }
  .rc-type-badge { background:rgba(255,255,255,0.25); border:1px solid rgba(255,255,255,0.4); border-radius:20px; padding:4px 14px; font-size:0.78rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; white-space:nowrap; }
  .rc-meta { display:flex; justify-content:space-between; align-items:flex-end; }
  .rc-receipt-no { font-size:1.35rem; font-weight:900; letter-spacing:0.02em; }
  .rc-print-date { font-size:0.72rem; opacity:0.8; text-align:right; }
  .rc-body { padding:24px 28px; }
  .rc-section-title { font-size:0.68rem; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; color:#9ca3af; margin-bottom:10px; }
  .rc-project-box { background:#f8fffe; border:1px solid #a7f3d0; border-radius:10px; padding:12px 16px; margin-bottom:20px; }
  .rc-project-name { font-size:1rem; font-weight:700; color:#1a1a1a; }
  .rc-project-sub  { font-size:0.78rem; color:#6b7280; margin-top:3px; }
  .rc-details { width:100%; border-collapse:collapse; margin-bottom:20px; }
  .rc-details tr { border-bottom:1px solid #f3f4f6; }
  .rc-details tr:last-child { border-bottom:none; }
  .rc-label { padding:9px 0; font-size:0.8rem; color:#6b7280; font-weight:600; width:42%; vertical-align:top; }
  .rc-value { padding:9px 0; font-size:0.88rem; color:#1a1a1a; }
  .rc-amount-box { background:linear-gradient(135deg,#f0fdf8,#ecfdf5); border:2px solid #a7f3d0; border-radius:12px; padding:16px 20px; display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
  .rc-amount-label { font-size:0.78rem; font-weight:700; color:#059669; text-transform:uppercase; letter-spacing:0.06em; }
  .rc-amount-value { font-size:1.75rem; font-weight:900; color:#047857; letter-spacing:-0.02em; }
  .rc-imgs-label { font-size:0.68rem; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; color:#9ca3af; margin-bottom:8px; }
  .rc-imgs { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }
  .rc-imgs img { width:100px; height:100px; object-fit:cover; border-radius:8px; border:1px solid #e5e7eb; }
  .rc-footer { background:#f8fafc; border-top:1px dashed #e5e7eb; padding:16px 28px; text-align:center; }
  .rc-footer-text { font-size:0.75rem; color:#9ca3af; line-height:1.6; }
  .rc-footer-brand { font-size:0.8rem; font-weight:700; color:#047857; margin-top:4px; }
  @media print {
    body { background:#fff; }
    .rc-page { box-shadow:none; margin:0; border-radius:0; max-width:100%; }
    .rc-no-print { display:none !important; }
  }
</style>
</head>
<body>
<div class="rc-page">
  <div class="rc-header">
    <div class="rc-header-top">
      <div class="rc-logo-circle">D</div>
      <div class="rc-company">
        <div class="rc-company-name">DAC'S BUILDING DESIGN SERVICES</div>
        <div class="rc-company-sub">Official Transaction Receipt</div>
      </div>
      <div class="rc-type-badge">${type === 'expense' ? '🧾 Expense' : '👷 Payroll'}</div>
    </div>
    <div class="rc-meta">
      <div>
        <div style="font-size:0.7rem;opacity:0.8;margin-bottom:2px;">RECEIPT NO.</div>
        <div class="rc-receipt-no">${receiptNo}</div>
      </div>
      <div class="rc-print-date">Printed on<br>${printDate}</div>
    </div>
  </div>
  <div class="rc-body">
    <div class="rc-section-title">Project</div>
    <div class="rc-project-box">
      <div class="rc-project-name">${folder ? folder.name : (project ? project.month + ' ' + project.year : '—')}</div>
      <div class="rc-project-sub">${folder && project ? project.month + ' ' + project.year + (folder.description ? ' · ' + folder.description : '') : (folder?.description || '')}</div>
    </div>
    <div class="rc-section-title">Transaction Details</div>
    <table class="rc-details">${detailsHTML}</table>
    <div class="rc-amount-box">
      <div class="rc-amount-label">${amountLabel}</div>
      <div class="rc-amount-value">${amountValue}</div>
    </div>
    ${imagesHTML}
  </div>
  <div class="rc-footer">
    <div class="rc-footer-text">This is an official transaction receipt generated by the DAC's Admin System.<br>Keep this for your records.</div>
    <div class="rc-footer-brand">DAC's Building Design Services</div>
  </div>
</div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };<\/script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=600,height=800');
    if (!win) { showExpNotif('Pop-up blocked. Please allow pop-ups for this site.', 'error'); return; }
    win.document.write(html);
    win.document.close();
}

// ─────────────────────────────────────────────────────────-----------------------------------------------------------
// FULL BILLING SUMMARY PRINTER
// ─────────────────────────────────────────────────────────-----------------------------------------------------------
function printFullBillingSummary() {
    const _prtBaseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
    const folder = expCurrentFolder;
    const fid    = folder?.id || expCurrentProject?.folderId;
    const projects = fid
        ? expProjects.filter(p => p.folderId === fid)
        : (expCurrentProject ? [expCurrentProject] : []);

    if (!projects.length) { showExpNotif('No billing data to print.', 'error'); return; }

    const folderObj = fid ? expFolders.find(f => f.id === fid) : null;
    const title     = folderObj ? folderObj.name : (expCurrentProject ? expCurrentProject.month + ' ' + expCurrentProject.year : 'Billing Summary');
    const contractVal = folderObj?.totalBudget || 0;

    const typeOrder = ['mobilization','downpayment','progress','final','president'];
    const typeInfo  = {
        mobilization: { label: 'Mobilization',       letter: 'A' },
        downpayment:  { label: 'Downpayment',         letter: 'B' },
        progress:     { label: 'Progress Billing',    letter: 'C' },
        final:        { label: 'Final Payment',       letter: 'D' },
        president:    { label: 'Cover Expenses',      letter: 'E' },
    };

    const sorted = [...projects].sort((a, b) => {
        const ai = typeOrder.indexOf(a.fundingType || 'downpayment');
        const bi = typeOrder.indexOf(b.fundingType || 'downpayment');
        if (ai !== bi) return ai - bi;
        return (a.billingNumber || 0) - (b.billingNumber || 0);
    });

    const totalReceived = sorted.filter(p => p.fundingType !== 'president').reduce((s, p) => s + (p.monthlyBudget || 0), 0);
    const totalSpent    = sorted.reduce((s, p) => s + (p._spent || 0), 0);
    let   grandBalance  = 0;

    // Group by funding type for BOQ-style sections
    const sections = {};
    sorted.forEach(p => {
        const ft = p.fundingType || 'downpayment';
        if (!sections[ft]) sections[ft] = [];
        sections[ft].push(p);
    });

    let itemNo = 1;
    let bodyRows = '';

    typeOrder.forEach(ft => {
        if (!sections[ft]) return;
        const info    = typeInfo[ft];
        const isCover = ft === 'president';
        const sectionItems = sections[ft];
        const sectionTotal = sectionItems.reduce((s, p) => {
            const recv  = isCover ? 0 : (p.monthlyBudget || 0);
            const spent = p._spent || 0;
            return s + (isCover ? spent : recv);
        }, 0);

        // Section header row (red background like BOQ)
        const sectionLabel = ft === 'president' ? 'COVER EXPENSES' : info.label.toUpperCase() + (ft === 'progress' ? 'S' : '');
        bodyRows += `<tr class="sec-hdr">
            <td colspan="2" style="font-weight:800;font-size:0.82rem;letter-spacing:0.04em">${sectionLabel}</td>
            <td></td><td></td><td></td><td></td>
            <td style="text-align:right;font-weight:800">₱${formatNum(sectionTotal)}</td>
        </tr>`;

        sectionItems.forEach((p, idx) => {
            const recv  = isCover ? 0 : (p.monthlyBudget || 0);
            const spent = p._spent || 0;
            const bal   = isCover ? -spent : recv - spent;
            grandBalance += bal;

            const projExp = expExpenses.filter(e => e.projectId === p.id);
            const projPay = expPayroll.filter(r => r.projectId === p.id);
            const matCost = projExp.reduce((s, e) => s + (e.amount || 0), 0);
            const labCost = projPay.reduce((s, r) => s + (r.totalSalary || 0), 0);

            const subLabel = ft === 'progress'
                ? `Progress Billing #${p.billingNumber || (idx + 1)}`
                : info.label;
            const balColor = bal > 0 ? '#166534' : bal < 0 ? '#991b1b' : '#6b7280';
            const balBg    = bal > 0 ? '#dcfce7'  : bal < 0 ? '#fee2e2'  : '#f3f4f6';

            bodyRows += `<tr class="data-row">
                <td style="text-align:center;color:#6b7280">${itemNo++}</td>
                <td>
                    <div style="font-weight:700;font-size:0.85rem">${subLabel}</div>
                    <div style="font-size:0.72rem;color:#9ca3af;margin-top:1px">${p.month} ${p.year}</div>
                </td>
                <td style="text-align:center">1</td>
                <td style="text-align:center">lot</td>
                <td style="text-align:right">${matCost > 0 ? '₱' + formatNum(matCost) : '—'}</td>
                <td style="text-align:right">${labCost > 0 ? '₱' + formatNum(labCost) : '—'}</td>
                <td style="text-align:right;font-weight:700">
                    <span style="background:${balBg};color:${balColor};padding:2px 8px;border-radius:4px;font-size:0.82rem">
                        ${bal < 0 ? '-' : bal > 0 ? '+' : ''}₱${formatNum(Math.abs(bal))}
                    </span>
                </td>
            </tr>`;
        });

        // Subtotal row per section

        bodyRows += `<tr class="subtotal-row">
            <td colspan="4" style="text-align:right;font-size:0.75rem;font-weight:700;color:#6b7280;letter-spacing:0.04em">SUBTOTAL — ${sectionLabel}:</td>
            <td></td><td></td>
            <td style="text-align:right;font-weight:800">₱${formatNum(sectionTotal)}</td>
        </tr>`;
    });

    const gColor  = grandBalance > 0 ? '#166534' : grandBalance < 0 ? '#991b1b' : '#374151';
    const gBg     = grandBalance > 0 ? '#dcfce7'  : grandBalance < 0 ? '#fee2e2'  : '#f3f4f6';
    const printDate = new Date().toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true });

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Bill of Quantities — ${title}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; background:#f0f0f0; color:#1a1a1a; font-size:13px; }
  .page { max-width:820px; margin:20px auto; background:#fff; box-shadow:0 2px 16px rgba(0,0,0,0.15); }
  /* -- Company Header -- */
  .co-header { padding:20px 28px 0; }
  /* -- Project Info Bar -- */
  .proj-bar { background:#f8f9fa; border-bottom:3px solid #e5c100; padding:10px 24px; display:flex; justify-content:space-between; align-items:center; }
  .proj-name { font-size:1rem; font-weight:800; color:#1a1a1a; }
  .proj-meta { font-size:0.72rem; color:#6b7280; margin-top:2px; }
  .print-info { text-align:right; font-size:0.7rem; color:#9ca3af; }
  /* -- Summary Pills -- */
  .summary-bar { display:flex; gap:0; border-bottom:2px solid #e5e7eb; }
  .sum-pill { flex:1; padding:10px 16px; text-align:center; border-right:1px solid #e5e7eb; }
  .sum-pill:last-child { border-right:none; }
  .sum-pill-label { font-size:0.6rem; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#9ca3af; margin-bottom:3px; }
  .sum-pill-val { font-size:1rem; font-weight:800; }
  /* -- BOQ Table -- */
  .boq-wrap { padding:0; }
  table { width:100%; border-collapse:collapse; }
  /* Column header — yellow like reference */
  .col-hdr th { background:#e5c100; color:#1a1a1a; font-size:0.72rem; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; padding:8px 10px; border:1px solid #c9a800; text-align:center; }
  .col-hdr th.desc { text-align:left; }
  /* Unit rates sub-header */
  .unit-hdr th { background:#f5d800; color:#1a1a1a; font-size:0.68rem; font-weight:700; padding:5px 10px; border:1px solid #c9a800; text-align:center; }
  /* Section header — red like reference */
  .sec-hdr td { background:#c0392b; color:#fff; font-size:0.78rem; padding:7px 10px; border:1px solid #a93226; }
  /* Data rows */
  .data-row td { padding:7px 10px; border:1px solid #e5e7eb; vertical-align:middle; }
  .data-row:nth-child(even) td { background:#fafafa; }
  /* Subtotal row */
  .subtotal-row td { background:#fff8e1; border:1px solid #e5e7eb; padding:6px 10px; font-size:0.78rem; }
  /* Grand total */
  .grand-total td { background:#1a1a2e; color:#fff; font-size:0.9rem; font-weight:800; padding:10px 12px; border:1px solid #111; }
  /* Footer */
  .footer { padding:14px 24px; background:#f8f9fa; border-top:3px solid #e5c100; display:flex; justify-content:space-between; align-items:center; }
  .footer-left { font-size:0.7rem; color:#9ca3af; line-height:1.6; }
  .footer-brand { font-size:0.8rem; font-weight:800; color:#059669; }
  @media print {
    body { background:#fff; }
    .page { box-shadow:none; margin:0; max-width:100%; }
    .data-row:nth-child(even) td { background:#fafafa !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .sec-hdr td { background:#c0392b !important; color:#fff !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .col-hdr th { background:#e5c100 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .grand-total td { background:#1a1a2e !important; color:#fff !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style></head><body>
<div class="page">
  <!-- Company Header -->
  <div class="co-header">
    ${window.dacsPrintHeader('Billing Summary', `Printed: ${printDate}`)}
  </div>

  <!-- Project Info Bar -->
  <div class="proj-bar">
    <div>
      <div class="proj-name">${title}</div>
      <div class="proj-meta">${folderObj?.description || 'Project Billing Summary'} &nbsp;·&nbsp; ${sorted.length} billing period${sorted.length !== 1 ? 's' : ''}${contractVal > 0 ? ' &nbsp;·&nbsp; Total Contract: ₱' + formatNum(contractVal) : ''}</div>
    </div>
    <div class="print-info">Printed on<br><strong>${printDate}</strong></div>
  </div>

  <!-- Summary Pills -->
  <div class="summary-bar">
    <div class="sum-pill">
      <div class="sum-pill-label">Total Billed (Received)</div>
      <div class="sum-pill-val" style="color:#1d4ed8">₱${formatNum(totalReceived)}</div>
    </div>
    <div class="sum-pill">
      <div class="sum-pill-label">Current Fund Spent</div>
      <div class="sum-pill-val" style="color:#d97706">₱${formatNum(totalSpent)}</div>
    </div>
    <div class="sum-pill">
      <div class="sum-pill-label">Net Balance</div>
      <div class="sum-pill-val" style="color:${grandBalance >= 0 ? '#166534' : '#991b1b'}">${grandBalance < 0 ? '-' : grandBalance > 0 ? '+' : ''}₱${formatNum(Math.abs(grandBalance))}</div>
    </div>
    ${contractVal > 0 ? `<div class="sum-pill">
      <div class="sum-pill-label">Total Contract</div>
      <div class="sum-pill-val" style="color:#374151">₱${formatNum(contractVal)}</div>
    </div>` : ''}
  </div>

  <!-- BOQ Table -->
  <div class="boq-wrap">
    <table>
      <!-- Column headers -->
      <thead>
        <tr class="col-hdr">
          <th style="width:5%">ITEM NO.</th>
          <th class="desc" style="width:28%">DESCRIPTIONS</th>
          <th style="width:5%">QTY</th>
          <th style="width:5%">UNIT</th>
          <th colspan="2" style="width:24%">UNIT RATES</th>
          <th style="width:14%">TOTAL AMOUNT</th>
        </tr>
        <tr class="unit-hdr">
          <th></th><th></th><th></th><th></th>
          <th style="width:12%">MATERIAL &amp; CONSUMABLES</th>
          <th style="width:12%">LABOR &amp; EQUIPMENT</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
      <tfoot>
        <tr class="grand-total">
          <td colspan="4" style="text-align:right;letter-spacing:0.06em">GRAND TOTAL BALANCE:</td>
          <td style="text-align:right">₱${formatNum(totalReceived)}</td>
          <td style="text-align:right">₱${formatNum(totalSpent)}</td>
          <td style="text-align:right">
            <span style="background:${gBg};color:${gColor};padding:3px 10px;border-radius:4px;font-size:0.88rem">
              ${grandBalance < 0 ? '-' : grandBalance > 0 ? '+' : ''}₱${formatNum(Math.abs(grandBalance))}
            </span>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="footer-left">Official billing summary generated by the DAC's Admin System.<br>This document is for internal use only.</div>
    <div class="footer-brand">DAC's Building Design Services</div>
  </div>
</div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };<\/script>
</body></html>`;

    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) { showExpNotif('Pop-up blocked. Please allow pop-ups for this site.', 'error'); return; }
    win.document.write(html);
    win.document.close();
}

// ─────────────────────────────────────────────────────────-----------------------------------------------------------
// BILLING SUMMARY RECEIPT PRINTER (Budget Overview)
// ─────────────────────────────────────────────────────────-----------------------------------------------------------
function printBillingSummaryReceipt(projectId) {
    const project = expProjects.find(p => p.id === projectId);
    if (!project) { showExpNotif('Project not found.', 'error'); return; }

    const folder   = project.folderId ? expFolders.find(f => f.id === project.folderId) : null;
    const isCover  = project.fundingType === 'president';

    // Gather expenses & payroll for this project
    const projExp  = expExpenses.filter(e => e.projectId === projectId);
    const projPay  = expPayroll.filter(p => p.projectId === projectId);
    const totalExp = projExp.reduce((s, e) => s + (e.amount || 0), 0);
    const totalPay = projPay.reduce((s, p) => s + (p.totalSalary || 0), 0);
    const totalSpent = totalExp + totalPay;
    const received   = isCover ? 0 : (project.monthlyBudget || 0);
    const balance    = isCover ? -totalSpent : received - totalSpent;

    const typeLabels = {
        mobilization: '🚧 Mobilization',
        downpayment:  '💰 Downpayment',
        progress:     '📋 Progress Billing #' + (project.billingNumber || '?'),
        final:        '🏁 Final Payment',
        president:    '🏦 Cover Expenses'
    };
    const typeLabel = typeLabels[project.fundingType] || project.fundingType;

    const receiptNo = 'SUM-' + Date.now().toString(36).toUpperCase();
    const printDate = new Date().toLocaleString('en-PH', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });

    // Expense rows
    const expRows = projExp.length
        ? projExp.map(e => `
            <tr>
                <td style="padding:7px 10px;font-size:0.82rem;color:#374151;border-bottom:1px solid #f3f4f6">${e.dateTime ? new Date(e.dateTime).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
                <td style="padding:7px 10px;font-size:0.82rem;color:#1a1a1a;border-bottom:1px solid #f3f4f6"><strong>${e.expenseName || '—'}</strong></td>
                <td style="padding:7px 10px;font-size:0.82rem;color:#6b7280;border-bottom:1px solid #f3f4f6">${e.category || '—'}</td>
                <td style="padding:7px 10px;font-size:0.82rem;color:#1a1a1a;text-align:right;border-bottom:1px solid #f3f4f6">₱${formatNum(e.amount)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" style="padding:10px;text-align:center;color:#9ca3af;font-size:0.82rem">No expenses</td></tr>';

    // Payroll rows
    const payRows = projPay.length
        ? projPay.map(p => `
            <tr>
                <td style="padding:7px 10px;font-size:0.82rem;color:#374151;border-bottom:1px solid #f3f4f6">${p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
                <td style="padding:7px 10px;font-size:0.82rem;color:#1a1a1a;border-bottom:1px solid #f3f4f6"><strong>${p.workerName || '—'}</strong></td>
                <td style="padding:7px 10px;font-size:0.82rem;color:#6b7280;border-bottom:1px solid #f3f4f6">${_payRecIsLamsam(p) ? ('Lump Sum' + ((p.daysWorked||0) ? ' · '+(p.daysWorked||0)+'d' : '')) : (p.daysWorked || 0)+'d × ₱'+formatNum(p.dailyRate)}</td>
                <td style="padding:7px 10px;font-size:0.82rem;color:#1a1a1a;text-align:right;border-bottom:1px solid #f3f4f6">₱${formatNum(p.totalSalary)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" style="padding:10px;text-align:center;color:#9ca3af;font-size:0.82rem">No payroll entries</td></tr>';

    const balColor = balance > 0 ? '#047857' : balance < 0 ? '#ef4444' : '#6b7280';
    const balSign  = balance < 0 ? '-' : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Billing Summary — ${receiptNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; background:#f5f5f5; color:#1a1a1a; }
  .rc-page { max-width:600px; margin:24px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.12); }
  .rc-header { background:linear-gradient(135deg,#059669,#047857); padding:24px 28px 18px; color:#fff; }
  .rc-header-top { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
  .rc-logo { width:56px; height:56px; background:#fff; border-radius:8px; display:flex; align-items:center; justify-content:center; padding:4px; flex-shrink:0; overflow:hidden; }
  .rc-company-name { font-size:1.05rem; font-weight:800; letter-spacing:0.04em; }
  .rc-company-sub  { font-size:0.72rem; opacity:0.85; margin-top:2px; }
  .rc-type-badge { background:rgba(255,255,255,0.25); border:1px solid rgba(255,255,255,0.4); border-radius:20px; padding:4px 14px; font-size:0.75rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; white-space:nowrap; }
  .rc-meta { display:flex; justify-content:space-between; align-items:flex-end; }
  .rc-receipt-no { font-size:1.25rem; font-weight:900; }
  .rc-print-date { font-size:0.7rem; opacity:0.8; text-align:right; }
  .rc-body { padding:22px 28px; }
  .rc-section-title { font-size:0.65rem; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; color:#9ca3af; margin-bottom:8px; margin-top:18px; }
  .rc-project-box { background:#f8fffe; border:1px solid #a7f3d0; border-radius:10px; padding:12px 16px; margin-bottom:4px; }
  .rc-project-name { font-size:1rem; font-weight:700; }
  .rc-project-sub  { font-size:0.75rem; color:#6b7280; margin-top:3px; }
  .rc-summary-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:4px; }
  .rc-sum-box { background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; padding:10px 14px; text-align:center; }
  .rc-sum-label { font-size:0.62rem; font-weight:700; color:#9ca3af; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px; }
  .rc-sum-val { font-size:1rem; font-weight:800; color:#1a1a1a; }
  .rc-sum-val.green { color:#047857; }
  .rc-sum-val.orange { color:#f59e0b; }
  .rc-balance-box { background:linear-gradient(135deg,#f0fdf8,#ecfdf5); border:2px solid #a7f3d0; border-radius:12px; padding:14px 20px; display:flex; justify-content:space-between; align-items:center; margin-top:16px; margin-bottom:4px; }
  .rc-balance-label { font-size:0.75rem; font-weight:700; color:#059669; text-transform:uppercase; letter-spacing:0.06em; }
  .rc-balance-val { font-size:1.6rem; font-weight:900; letter-spacing:-0.02em; }
  table { width:100%; border-collapse:collapse; }
  thead th { background:#f8fafc; font-size:0.7rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:#6b7280; padding:8px 10px; text-align:left; border-bottom:2px solid #e5e7eb; }
  thead th:last-child { text-align:right; }
  .rc-footer { background:#f8fafc; border-top:1px dashed #e5e7eb; padding:14px 28px; text-align:center; }
  .rc-footer-text { font-size:0.72rem; color:#9ca3af; line-height:1.6; }
  .rc-footer-brand { font-size:0.78rem; font-weight:700; color:#047857; margin-top:3px; }
  @media print {
    body { background:#fff; }
    .rc-page { box-shadow:none; margin:0; border-radius:0; max-width:100%; }
  }
</style>
</head>
<body>
<div class="rc-page">
  <div class="rc-header">
    <div class="rc-header-top">
      <div class="rc-logo"><img src="${window.location.origin}/assets/images/DACS-TRANSPARENT.png" alt="DAC's Logo" style="width:100%;height:100%;object-fit:contain;" onerror="this.style.display='none'"></div>
      <div style="flex:1">
        <div class="rc-company-name">DAC'S BUILDING DESIGN SERVICES</div>
        <div class="rc-company-sub">Billing Period Summary</div>
      </div>
      <div class="rc-type-badge">${typeLabel}</div>
    </div>
    <div class="rc-meta">
      <div>
        <div style="font-size:0.68rem;opacity:0.8;margin-bottom:2px">SUMMARY NO.</div>
        <div class="rc-receipt-no">${receiptNo}</div>
      </div>
      <div class="rc-print-date">Printed on<br>${printDate}</div>
    </div>
  </div>
  <div class="rc-body">
    <div class="rc-section-title">Project</div>
    <div class="rc-project-box">
      <div class="rc-project-name">${folder ? folder.name : project.month + ' ' + project.year}</div>
      <div class="rc-project-sub">${project.month} ${project.year}${folder && folder.description ? ' · ' + folder.description : ''}</div>
    </div>

    <div class="rc-section-title" style="margin-top:16px">Financial Summary</div>
    <div class="rc-summary-grid">
      <div class="rc-sum-box">
        <div class="rc-sum-label">${isCover ? 'Covered' : 'Received'}</div>
        <div class="rc-sum-val green">₱${formatNum(isCover ? totalSpent : received)}</div>
      </div>
      <div class="rc-sum-box">
        <div class="rc-sum-label">Current Fund Spent</div>
        <div class="rc-sum-val orange">₱${formatNum(totalSpent)}</div>
      </div>
      <div class="rc-sum-box">
        <div class="rc-sum-label">Materials</div>
        <div class="rc-sum-val">₱${formatNum(totalExp)}</div>
      </div>
    </div>
    <div class="rc-balance-box">
      <div class="rc-balance-label">${isCover ? 'Total Covered' : 'Net Balance'}</div>
      <div class="rc-balance-val" style="color:${balColor}">${balSign}₱${formatNum(Math.abs(balance))}</div>
    </div>

    <div class="rc-section-title">Expenses (${projExp.length})</div>
    <table>
      <thead><tr><th>Date</th><th>Item</th><th>Category</th><th>Amount</th></tr></thead>
      <tbody>${expRows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="padding:8px 10px;font-size:0.78rem;font-weight:700;color:#6b7280;text-align:right;border-top:2px solid #e5e7eb">SUBTOTAL</td>
        <td style="padding:8px 10px;font-size:0.9rem;font-weight:800;text-align:right;border-top:2px solid #e5e7eb">₱${formatNum(totalExp)}</td>
      </tr></tfoot>
    </table>

    <div class="rc-section-title">Payroll (${projPay.length})</div>
    <table>
      <thead><tr><th>Date</th><th>Worker</th><th>Days × Rate</th><th>Salary</th></tr></thead>
      <tbody>${payRows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="padding:8px 10px;font-size:0.78rem;font-weight:700;color:#6b7280;text-align:right;border-top:2px solid #e5e7eb">SUBTOTAL</td>
        <td style="padding:8px 10px;font-size:0.9rem;font-weight:800;text-align:right;border-top:2px solid #e5e7eb">₱${formatNum(totalPay)}</td>
      </tr></tfoot>
    </table>
  </div>
  <div class="rc-footer">
    <div class="rc-footer-text">Official billing period summary generated by the DAC's Admin System.</div>
    <div class="rc-footer-brand">DAC's Building Design Services</div>
  </div>
</div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };<\/script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=680,height=900');
    if (!win) { showExpNotif('Pop-up blocked. Please allow pop-ups for this site.', 'error'); return; }
    win.document.write(html);
    win.document.close();
}

// ════════════════════════════════════════════════════════════
// REPORT DETAIL TABLES (Expense & Payroll)
// ════════════════════════════════════════════════════════════
function _rptRenderDetailTables() {
    const expCard  = document.getElementById('rptExpDetailCard');
    const payCard  = document.getElementById('rptPayDetailCard');
    const expTbody = document.getElementById('rptExpDetailTbody');
    const payTbody = document.getElementById('rptPayDetailTbody');
    const expSub   = document.getElementById('rptExpDetailSub');
    const paySub   = document.getElementById('rptPayDetailSub');

    // Only show detail tables when a specific folder is selected
    const show = !!_rptState.folderId;
    if (expCard) expCard.style.display = show ? '' : 'none';
    if (payCard) payCard.style.display = show ? '' : 'none';
    if (!show) return;

    const folder = expFolders.find(f => f.id === _rptState.folderId);
    const folderName = folder?.name || 'Selected Folder';

    // ── Expenses ────────────────────────────────────────────
    const sortedExp = [..._rptState.allExpenses]
        .sort((a, b) => new Date(b.dateTime || 0) - new Date(a.dateTime || 0));

    if (expSub) expSub.textContent = `${sortedExp.length} transaction${sortedExp.length !== 1 ? 's' : ''} · ${folderName}`;

    if (!sortedExp.length) {
        if (expTbody) expTbody.innerHTML = '<tr><td colspan="7" class="exp-empty-row">No expenses found.</td></tr>';
    } else {
        // Group by category
        const groups = {};
        sortedExp.forEach(e => {
            const k = e.category || 'Uncategorized';
            if (!groups[k]) groups[k] = [];
            groups[k].push(e);
        });

        let html = '';
        Object.entries(groups).forEach(([cat, items]) => {
            const catObj  = expCategories.find(c => c.name === cat);
            const color   = catObj?.color || '#9ca3af';
            const subtotal = items.reduce((s, e) => s + (e.amount || 0), 0);
            const r = parseInt(color.replace('#','').substring(0,2),16);
            const g = parseInt(color.replace('#','').substring(2,4),16);
            const b = parseInt(color.replace('#','').substring(4,6),16);
            html += `<tr class="exp-group-header"><td colspan="7">
                <div class="exp-group-header-inner" style="--cat-color:${color};--cat-bg:rgba(${r},${g},${b},0.08);border-left-color:${color}">
                    <span class="exp-group-dot" style="background:${color}"></span>
                    <span class="exp-group-name" style="color:${color}">${cat}</span>
                    <span class="exp-group-count">${items.length} item${items.length>1?'s':''}</span>
                    <span class="exp-group-subtotal">₱${formatNum(subtotal)}</span>
                </div></td></tr>`;
            items.forEach(e => {
                const proj = _rptState.projects.find(p => p.id === e.projectId);
                html += `<tr class="exp-group-row">
                    <td>${formatDate(e.dateTime)}</td>
                    <td><span style="font-size:0.78rem;color:#6b7280">${proj ? proj.month+' '+proj.year : '—'}</span></td>
                    <td><strong>${e.expenseName || '—'}</strong></td>
                    <td>${e.category || '—'}</td>
                    <td class="exp-notes-cell">${e.notes ? '<span class="exp-notes-text">'+e.notes+'</span>' : '<span class="exp-notes-empty">—</span>'}</td>
                    <td>${e.quantity || 1}</td>
                    <td>₱${formatNum(e.amount)}</td>
                </tr>`;
            });
        });
        const grandTotal = sortedExp.reduce((s, e) => s + (e.amount || 0), 0);
        html += `<tr class="exp-total-row">
            <td colspan="5"></td>
            <td class="exp-total-label">TOTAL</td>
            <td class="exp-total-value">₱${formatNum(grandTotal)}</td>
        </tr>`;
        if (expTbody) expTbody.innerHTML = html;
    }

    // ── Payroll ─────────────────────────────────────────────
    const sortedPay = [..._rptState.allPayroll]
        .sort((a, b) => new Date(b.paymentDate || 0) - new Date(a.paymentDate || 0));

    if (paySub) paySub.textContent = `${sortedPay.length} entr${sortedPay.length !== 1 ? 'ies' : 'y'} · ${folderName}`;

    if (!sortedPay.length) {
        if (payTbody) payTbody.innerHTML = '<tr><td colspan="7" class="exp-empty-row">No payroll entries found.</td></tr>';
    } else {
        const grandPay = sortedPay.reduce((s, p) => s + (p.totalSalary || 0), 0);
        let html = sortedPay.map(p => {
            const proj = _rptState.projects.find(pr => pr.id === p.projectId);
            return `<tr>
                <td>${formatDate(p.paymentDate)}</td>
                <td><span style="font-size:0.78rem;color:#6b7280">${proj ? proj.month+' '+proj.year : '—'}</span></td>
                <td><strong>${p.workerName || '—'}</strong></td>
                <td>${p.role || '—'}</td>
                <td>${p.daysWorked || 0}</td>
                <td>${_payRecIsLamsam(p) ? 'Lump Sum' : '₱'+formatNum(p.dailyRate)}</td>
                <td>₱${formatNum(p.totalSalary)}</td>
            </tr>`;
        }).join('');
        html += `<tr class="exp-total-row">
            <td colspan="5"></td>
            <td class="exp-total-label">TOTAL</td>
            <td class="exp-total-value">₱${formatNum(grandPay)}</td>
        </tr>`;
        if (payTbody) payTbody.innerHTML = html;
    }
}

// ════════════════════════════════════════════════════════════
// PRINT REPORTS DASHBOARD
// ════════════════════════════════════════════════════════════
function printReportsDashboard() {
    if (!_rptState.projects?.length) { showExpNotif('No report data to print.', 'error'); return; }
    const _prtBaseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

    let groups = _computePeriodGroups(_rptState.period, _rptState.year,
        _rptState.projects, _rptState.allExpenses, _rptState.allPayroll);
    if (_rptState.period === 'annual' && groups.length === 1) {
        groups = _rptAllTimeGroups(groups);
    }

    const selectedFolder = _rptState.folderId ? expFolders.find(f => f.id === _rptState.folderId) : null;
    const reportTitle    = selectedFolder ? selectedFolder.name : 'Company-Wide Report';
    const periodLabels   = { weekly:'Weekly', monthly:'Monthly', quarterly:'Quarterly', semi:'Semi-Annual', annual:'Annual' };
    const periodLabel    = periodLabels[_rptState.period] || _rptState.period;

    const contract    = _rptState.folderId
        ? (expFolders.find(f => f.id === _rptState.folderId)?.totalBudget || 0)
        : expFolders.reduce((s, f) => s + (f.totalBudget || 0), 0);
    // KPI totals mirror Budget Overview (all-time, no year filter)
    const _prtFolderProjs  = _rptState.folderId
        ? expProjects.filter(p => p.folderId === _rptState.folderId)
        : expProjects;
    const _prtClientProjs  = _prtFolderProjs.filter(p => p.fundingType !== 'president');
    const _prtPresProjIds  = new Set(_prtFolderProjs.filter(p => p.fundingType === 'president').map(p => p.id));
    const _prtProjIdSet    = new Set(_prtFolderProjs.map(p => p.id));
    const totReceived      = _prtClientProjs.reduce((s, p) => s + (parseFloat(p.monthlyBudget) || 0), 0);
    const prtActivePeriods = _prtClientProjs.filter(p => (p.monthlyBudget || 0) > 0).length;
    const _prtSrcExp = _ovAllExpenses.length ? _ovAllExpenses : expExpenses;
    const _prtSrcPay = _ovAllPayroll.length  ? _ovAllPayroll  : expPayroll;
    const totMats          = _prtSrcExp
        .filter(e => _prtProjIdSet.has(e.projectId) && !e.coverExpense)
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const totLabor         = _prtSrcPay
        .filter(p => _prtProjIdSet.has(p.projectId) && !_prtPresProjIds.has(p.projectId))
        .reduce((s, p) => s + (parseFloat(p.totalSalary) || 0), 0);
    const totSpent         = totMats + totLabor;
    const totCoverPrt      = _prtSrcExp
        .filter(e => _prtProjIdSet.has(e.projectId) && (e.coverExpense || _prtPresProjIds.has(e.projectId)))
        .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
      + _prtSrcPay
        .filter(p => _prtPresProjIds.has(p.projectId))
        .reduce((s, p) => s + (parseFloat(p.totalSalary) || 0), 0);
    const matPctOfRcv     = totReceived > 0 ? (totMats     / totReceived) * 100 : 0;
    const labPctOfRcv     = totReceived > 0 ? (totLabor    / totReceived) * 100 : 0;
    // Match Budget Overview: percentage of allocated budget
    const coverPctOfBudget = totReceived > 0 ? (totCoverPrt / totReceived) * 100 : 0;
    const utilizedPct     = totReceived > 0 ? (totSpent / totReceived) * 100 : 0;
    const contractPct     = contract   > 0  ? (totSpent / contract)    * 100 : 0;
    const rcvOfContract   = contract   > 0  ? (totReceived / contract) * 100 : 0;
    // Total Budget Remaining = Total Contract − Total Fund Allocated (unbilled contract balance)
    const periodVariance  = contract - totReceived;
    const periodRemPct    = contract > 0 ? (periodVariance / contract) * 100 : 0;
    // Current Spending = Total Contract − Current Fund Spent
    const contractVariance= contract - totSpent;
    const contractRemPct  = contract > 0 ? (contractVariance / contract) * 100 : 0;

    const printDate = new Date().toLocaleString('en-PH', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });

    // ── Period breakdown table rows ─────────────────────────
    const _badge = s => {
        const map = { healthy:'Healthy', ontrack:'On Track', warning:'Near Limit', danger:'Over Budget' };
        const colors = { healthy:'#166534:#dcfce7', ontrack:'#1d4ed8:#dbeafe', warning:'#92400e:#fef3c7', danger:'#991b1b:#fee2e2' };
        const [fg, bg] = (colors[s] || colors.healthy).split(':');
        return `<span style="background:${bg};color:${fg};padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:700">${map[s] || 'Healthy'}</span>`;
    };

    const active = groups.filter(g => g.budget > 0 || g.totalSpent > 0);
    const empty  = groups.filter(g => g.budget === 0 && g.totalSpent === 0);
    const _prtIsStaff = window.currentUserRole === 'staff';
    const _prtColspan = _prtIsStaff ? 6 : 8;

    let tableRows = active.map(g => {
        const remColor = g.remaining < 0 ? '#991b1b' : '#166534';
        const barW     = Math.min(g.usedPct, 100).toFixed(1);
        const barColor = g.usedPct > 100 ? '#ef4444' : g.usedPct > 85 ? '#f59e0b' : '#059669';
        return `<tr>
            <td><strong>${g.label}</strong>${g.txCount ? `<br><span style="font-size:0.7rem;color:#9ca3af">${g.txCount} tx · ${g.workerCount} worker${g.workerCount!==1?'s':''}</span>` : ''}</td>
            ${_prtIsStaff ? '' : `<td style="text-align:right">₱${formatNum(g.budget)}</td>`}
            <td style="text-align:right">₱${formatNum(g.mats)}</td>
            <td style="text-align:right">₱${formatNum(g.labor)}</td>
            <td style="text-align:right"><strong>₱${formatNum(g.totalSpent)}</strong></td>
            ${_prtIsStaff ? '' : `<td style="text-align:right;color:${remColor}">${g.remaining < 0 ? '▲ -' : ''}₱${formatNum(Math.abs(g.remaining))}</td>`}
            <td style="text-align:center">
                <div style="font-size:0.8rem;font-weight:700;margin-bottom:3px">${g.usedPct.toFixed(1)}%</div>
                <div style="background:#e5e7eb;border-radius:4px;height:6px;width:80px;margin:0 auto">
                    <div style="background:${barColor};height:6px;border-radius:4px;width:${barW}%"></div>
                </div>
            </td>
            <td style="text-align:center">${_badge(g.status)}</td>
        </tr>`;
    }).join('');

    if (empty.length) {
        tableRows += `<tr><td colspan="${_prtColspan}" style="text-align:center;color:#9ca3af;font-size:0.78rem;padding:8px">
            ⬡ ${empty.length} period${empty.length>1?'s':''} with no activity: ${empty.map(g=>g.shortLabel).join(', ')}
        </td></tr>`;
    }

    const totRemaining = totReceived - totSpent;
    const tPrint = utilizedPct;
    const tStatusPrint = tPrint > 100 ? 'danger' : tPrint > 85 ? 'warning' : tPrint > 60 ? 'ontrack' : 'healthy';
    const _tdTotal = 'background:#fff;color:#111827;font-weight:800;border-top:2px solid #1a1a2e;';
    const remColorPrint = totRemaining < 0 ? '#991b1b' : '#166534';
    tableRows += `<tr>
        <td style="${_tdTotal}">TOTAL</td>
        ${_prtIsStaff ? '' : `<td style="${_tdTotal}text-align:right">₱${formatNum(totReceived)}</td>`}
        <td style="${_tdTotal}text-align:right">₱${formatNum(totMats)}</td>
        <td style="${_tdTotal}text-align:right">₱${formatNum(totLabor)}</td>
        <td style="${_tdTotal}text-align:right">₱${formatNum(totSpent)}</td>
        ${_prtIsStaff ? '' : `<td style="${_tdTotal}text-align:right;color:${remColorPrint}">${totRemaining<0?'▲ -':''}₱${formatNum(Math.abs(totRemaining))}</td>`}
        <td style="${_tdTotal}text-align:center">${tPrint.toFixed(1)}%</td>
        <td style="${_tdTotal}text-align:center">${_badge(tStatusPrint)}</td>
    </tr>`;

    // ── Category breakdown rows ─────────────────────────────
    const cats = {};
    expCategories.forEach(c => { cats[c.name] = 0; });
    _rptState.allExpenses.forEach(e => { const k = e.category || 'Others'; cats[k] = (cats[k] || 0) + (e.amount || 0); });
    cats['Payroll'] = _rptState.allPayroll.reduce((s, p) => s + (p.totalSalary || 0), 0);
    const catTotal = Object.values(cats).reduce((a, b) => a + b, 0);
    const catRows = Object.entries(cats)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([name, amt]) => {
            const cat   = expCategories.find(c => c.name === name);
            const color = name === 'Payroll' ? '#f97316' : (cat?.color || '#a78bfa');
            const pct   = catTotal > 0 ? ((amt / catTotal) * 100).toFixed(1) : '0.0';
            return `<tr>
                <td><span style="display:inline-block;width:10px;height:10px;background:${color};border-radius:2px;margin-right:6px;vertical-align:middle"></span>${name}</td>
                <td style="text-align:right">₱${formatNum(amt)}</td>
                <td style="text-align:right">${pct}%</td>
                <td style="padding:6px 10px">
                    <div style="background:#e5e7eb;border-radius:4px;height:8px">
                        <div style="background:${color};height:8px;border-radius:4px;width:${pct}%"></div>
                    </div>
                </td>
            </tr>`;
        }).join('');

    // ── Expense detail rows (only when folder selected) ─────
    let expDetailSection = '';
    let payDetailSection = '';
    if (_rptState.folderId) {
        const sortedExp = [..._rptState.allExpenses].sort((a, b) => new Date(b.dateTime||0) - new Date(a.dateTime||0));
        const sortedPay = [..._rptState.allPayroll].sort((a, b) => new Date(b.paymentDate||0) - new Date(a.paymentDate||0));
        const expGrand  = sortedExp.reduce((s, e) => s + (e.amount || 0), 0);
        const payGrand  = sortedPay.reduce((s, p) => s + (p.totalSalary || 0), 0);

        const expDetailRows = sortedExp.map(e => {
            const proj = _rptState.projects.find(p => p.id === e.projectId);
            return `<tr>
                <td>${e.dateTime ? new Date(e.dateTime).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
                <td style="font-size:0.75rem;color:#6b7280">${proj ? proj.month+' '+proj.year : '—'}</td>
                <td><strong>${e.expenseName || '—'}</strong></td>
                <td>${e.category || '—'}</td>
                <td style="color:#6b7280">${e.notes || '—'}</td>
                <td style="text-align:center">${e.quantity || 1}</td>
                <td style="text-align:right">₱${formatNum(e.amount)}</td>
            </tr>`;
        }).join('') + `<tr style="background:#f8fafc;font-weight:800">
            <td colspan="5" style="text-align:right">TOTAL</td><td></td>
            <td style="text-align:right">₱${formatNum(expGrand)}</td>
        </tr>`;

        const payDetailRows = sortedPay.map(p => {
            const proj = _rptState.projects.find(pr => pr.id === p.projectId);
            return `<tr>
                <td>${p.paymentDate ? new Date(p.paymentDate).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
                <td style="font-size:0.75rem;color:#6b7280">${proj ? proj.month+' '+proj.year : '—'}</td>
                <td><strong>${p.workerName || '—'}</strong></td>
                <td>${p.role || '—'}</td>
                <td style="text-align:center">${p.daysWorked || 0}</td>
                <td style="text-align:right">${_payRecIsLamsam(p) ? 'Lump Sum' : '₱'+formatNum(p.dailyRate)}</td>
                <td style="text-align:right">₱${formatNum(p.totalSalary)}</td>
            </tr>`;
        }).join('') + `<tr style="background:#f8fafc;font-weight:800">
            <td colspan="5" style="text-align:right">TOTAL</td><td></td>
            <td style="text-align:right">₱${formatNum(payGrand)}</td>
        </tr>`;

        expDetailSection = `
        <div class="section-title" style="margin-top:28px">Expense Detail — ${sortedExp.length} transaction${sortedExp.length!==1?'s':''}</div>
        <table>
            <thead><tr><th>Date</th><th>Period</th><th>Expense Name</th><th>Category</th><th>Notes</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
            <tbody>${expDetailRows}</tbody>
        </table>`;

        payDetailSection = `
        <div class="section-title" style="margin-top:28px">Payroll Detail — ${sortedPay.length} entr${sortedPay.length!==1?'ies':'y'}</div>
        <table>
            <thead><tr><th>Date</th><th>Period</th><th>Worker Name</th><th>Role</th><th style="text-align:center">Days</th><th style="text-align:right">Daily Rate</th><th style="text-align:right">Total Salary</th></tr></thead>
            <tbody>${payDetailRows}</tbody>
        </table>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Reports — ${reportTitle} · ${periodLabel} ${_rptState.year}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; background:#f0f0f0; color:#1a1a1a; font-size:13px; }
  .page { max-width:960px; margin:20px auto; background:#fff; box-shadow:0 2px 16px rgba(0,0,0,0.15); }
  .co-header { background:linear-gradient(135deg,#1a1a2e 70%,#0f2744 100%); color:#fff; padding:20px 28px 16px; display:flex; align-items:center; gap:20px; border-bottom:3px solid #059669; position:relative; overflow:hidden; }
  .co-header::after { content:''; position:absolute; top:0; right:0; width:200px; height:100%; background:linear-gradient(to left,rgba(5,150,105,0.1),transparent); pointer-events:none; }
  .co-logo { width:68px; height:68px; border-radius:10px; overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center; background:#ffffff; padding:6px; border:1px solid rgba(255,255,255,0.3); }
  .co-logo img { width:100%; height:100%; object-fit:contain; }
  .co-divider { width:1px; height:48px; background:rgba(255,255,255,0.2); flex-shrink:0; }
  .co-name { font-size:1.15rem; font-weight:900; letter-spacing:0.07em; text-transform:uppercase; }
  .co-tagline { font-size:0.72rem; opacity:0.6; margin-top:4px; letter-spacing:0.02em; }
  .co-right { margin-left:auto; text-align:right; }
  .doc-type { font-size:0.6rem; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; opacity:0.55; margin-bottom:4px; }
  .doc-title { font-size:1rem; font-weight:800; color:#059669; letter-spacing:0.04em; }
  .proj-bar { background:#f8f9fa; border-bottom:3px solid #059669; padding:10px 28px; display:flex; justify-content:space-between; align-items:center; }
  .proj-name { font-size:1rem; font-weight:800; }
  .proj-meta { font-size:0.72rem; color:#6b7280; margin-top:2px; }
  .print-info { text-align:right; font-size:0.7rem; color:#9ca3af; }
  .kpi-row { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:8px; padding:14px 28px 0; }
  .kpi-card { background:#4AC84A; border:1.5px solid rgba(255,255,255,0.55); border-radius:10px; padding:10px 12px; box-shadow:0 1px 4px rgba(0,0,0,0.06); -webkit-print-color-adjust:exact; print-color-adjust:exact; color-adjust:exact; }
  .kpi-card--bad { background:#dc2626 !important; border-color:rgba(255,255,255,0.55) !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .kpi-card-head { margin-bottom:4px; }
  .kpi-card-label { font-size:0.58rem; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; color:#ffffff; }
  .kpi-card-val { font-size:1rem; font-weight:800; margin-bottom:2px; color:#ffffff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:baseline; gap:3px; }
  .kpi-peso { font-family:sans-serif; font-size:0.7em; font-weight:700; opacity:0.9; line-height:1; }
  .kpi-num { font-size:1.15em; font-weight:800; letter-spacing:-0.01em; line-height:1; }
  .kpi-card-sub { font-size:0.63rem; color:rgba(255,255,255,0.80); }
  .variance-card { grid-column:1/-1; margin:8px 28px 0; background:#4AC84A; border:1px solid transparent; border-radius:10px; padding:12px 18px; box-shadow:0 1px 4px rgba(0,0,0,0.06); -webkit-print-color-adjust:exact; print-color-adjust:exact; color-adjust:exact; }
  .variance-card--danger { border-left:4px solid rgba(239,68,68,0.7); }
  .variance-card-title { font-size:0.6rem; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:#ffffff; margin-bottom:10px; }
  .variance-cols { display:flex; gap:20px; align-items:flex-start; }
  .variance-col { flex:1; min-width:0; }
  .variance-col-label { font-size:0.58rem; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:rgba(255,255,255,0.75); margin-bottom:3px; }
  .variance-col-val { font-size:1rem; font-weight:800; margin-bottom:4px; color:#ffffff; display:flex; align-items:baseline; gap:3px; }
  .variance-bar-wrap { background:rgba(255,255,255,0.25); border-radius:4px; height:4px; width:100%; margin-bottom:3px; }
  .variance-bar-fill { height:4px; border-radius:4px; }
  .variance-col-sub { font-size:0.63rem; color:rgba(255,255,255,0.80); }
  .variance-divider { width:1px; background:rgba(255,255,255,0.35); align-self:stretch; margin:0 4px; }
  .body { padding:24px 28px; }
  .section-title { font-size:0.65rem; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; color:#9ca3af; margin-bottom:10px; margin-top:24px; }
  table { width:100%; border-collapse:collapse; margin-bottom:4px; }
  thead th { background:#4AC84A; color:#ffffff; font-size:0.7rem; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; padding:8px 10px; border:1px solid #3db53d; -webkit-print-color-adjust:exact; print-color-adjust:exact; color-adjust:exact; }
  tbody tr { border-bottom:1px solid #f3f4f6; }
  tbody tr:nth-child(even) td { background:#fafafa; }
  tbody td { padding:7px 10px; font-size:0.82rem; vertical-align:middle; border:1px solid #e5e7eb; }
  .footer { padding:14px 28px; background:#f8f9fa; border-top:3px solid #059669; display:flex; justify-content:space-between; align-items:center; }
  .footer-left { font-size:0.7rem; color:#9ca3af; line-height:1.6; }
  .footer-brand { font-size:0.8rem; font-weight:800; color:#059669; }
  @media print {
    body { background:#fff; }
    .page { box-shadow:none; margin:0; max-width:100%; }
    .kpi-card { background:#4AC84A !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .kpi-card--bad { background:#dc2626 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .variance-card { background:#4AC84A !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .kpi-card-label, .kpi-card-val, .kpi-card-sub { color:#ffffff !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    .variance-label, .variance-val, .variance-sub, .variance-col-label, .variance-col-val { color:#ffffff !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    thead th { background:#4AC84A !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    tbody tr:nth-child(even) td { background:#fafafa !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="co-header">
    <div class="co-logo"><img src="${_prtBaseUrl}assets/images/DACS-TRANSPARENT.png" alt="DAC\'S Logo"></div>
    <div class="co-divider"></div>
    <div>
      <div class="co-name">DAC'S BUILDING DESIGN SERVICES</div>
      <div class="co-tagline">Professional Building Design &amp; Construction Management</div>
    </div>
    <div class="co-right">
      <div class="doc-type">Report Type</div>
      <div class="doc-title">${periodLabel.toUpperCase()} REPORT · ${_rptState.year}</div>
    </div>
  </div>

  <div class="proj-bar">
    <div>
      <div class="proj-name">${reportTitle}</div>
      <div class="proj-meta">${periodLabel} breakdown · ${_rptState.year} · ${active.length} active period${active.length!==1?'s':''}</div>
    </div>
    <div class="print-info">Printed on<br><strong>${printDate}</strong></div>
  </div>

  <div class="kpi-row">
    ${window.currentUserRole !== 'staff' ? `
    <div class="kpi-card">
      <div class="kpi-card-head"><span class="kpi-card-label">CONTRACT VALUE</span></div>
      <div class="kpi-card-val"><span class="kpi-peso">₱</span><span class="kpi-num">${formatNum(contract)}</span></div>
      <div class="kpi-card-sub">${reportTitle} · ${_rptState.year}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-head"><span class="kpi-card-label">FUND ALLOCATED</span></div>
      <div class="kpi-card-val"><span class="kpi-peso">₱</span><span class="kpi-num">${formatNum(totReceived)}</span></div>
      <div class="kpi-card-sub">${prtActivePeriods} billing period${prtActivePeriods!==1?'s':''} · ${rcvOfContract.toFixed(1)}% of contract</div>
    </div>` : ''}
    <div class="kpi-card">
      <div class="kpi-card-head"><span class="kpi-card-label">MATERIALS &amp; COSTS</span></div>
      <div class="kpi-card-val"><span class="kpi-peso">₱</span><span class="kpi-num">${formatNum(totMats)}</span></div>
      <div class="kpi-card-sub">${matPctOfRcv.toFixed(1)}% of allocated budget</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-head"><span class="kpi-card-label">LABOR &amp; PAYROLL</span></div>
      <div class="kpi-card-val"><span class="kpi-peso">₱</span><span class="kpi-num">${formatNum(totLabor)}</span></div>
      <div class="kpi-card-sub">${labPctOfRcv.toFixed(1)}% of allocated budget</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-card-head"><span class="kpi-card-label">TOTAL FUND SPENT</span></div>
      <div class="kpi-card-val"><span class="kpi-peso">₱</span><span class="kpi-num">${formatNum(totSpent)}</span></div>
      <div class="kpi-card-sub">${utilizedPct.toFixed(1)}% utilized · ${contractPct.toFixed(1)}% of contract</div>
    </div>
    <div class="kpi-card${coverPctOfBudget >= 5 && totCoverPrt > 0 ? ' kpi-card--bad' : ''}">
      <div class="kpi-card-head"><span class="kpi-card-label">COVER EXPENSES</span></div>
      <div class="kpi-card-val"><span class="kpi-peso">₱</span><span class="kpi-num">${formatNum(totCoverPrt)}</span></div>
      <div class="kpi-card-sub">${totCoverPrt <= 0 ? 'No cover expenses' : coverPctOfBudget.toFixed(1) + '% of allocated budget · ' + (coverPctOfBudget >= 5 ? 'BAD' : coverPctOfBudget >= 2 ? 'WARNING' : 'HEALTHY')}</div>
    </div>
  </div>

  ${window.currentUserRole !== 'staff' ? `
  <div class="variance-card ${periodVariance < 0 ? 'variance-card--danger' : ''}">
    <div class="variance-card-title">REMAINING ALLOCATION</div>
    <div class="variance-cols">
      <div class="variance-col">
        <div class="variance-col-label">RECEIVABLE BALANCE</div>
        <div class="variance-col-val"><span class="kpi-peso">${periodVariance<0?'-':''}₱</span><span class="kpi-num">${formatNum(Math.abs(periodVariance))}</span></div>
        <div class="variance-bar-wrap"><div class="variance-bar-fill" style="width:${Math.max(Math.min(Math.abs(periodRemPct),100),2).toFixed(1)}%;background:${periodVariance<0?'rgba(239,68,68,0.8)':'rgba(255,255,255,0.6)'}"></div></div>
        <div class="variance-col-sub">${periodRemPct.toFixed(1)}% of contract · ${periodVariance<0?'over-billed':'pending billing'}</div>
      </div>
      <div class="variance-divider"></div>
      <div class="variance-col">
        <div class="variance-col-label">BUDGET REMAINING</div>
        <div class="variance-col-val"><span class="kpi-peso">${contractVariance<0?'-':''}₱</span><span class="kpi-num">${formatNum(Math.abs(contractVariance))}</span></div>
        <div class="variance-bar-wrap"><div class="variance-bar-fill" style="width:${Math.max(Math.min(Math.abs(contractRemPct),100),2).toFixed(1)}%;background:${contractVariance<0?'rgba(239,68,68,0.8)':'rgba(255,255,255,0.6)'}"></div></div>
        <div class="variance-col-sub">${contract > 0 ? contractRemPct.toFixed(1) + '% of contract · ' + (contractVariance<0?'over budget':'available') : 'No contract set'}</div>
      </div>
    </div>
  </div>` : ''}

  <div class="body">
    <div class="section-title">${periodLabel} Period Breakdown</div>
    <table>
      <thead><tr>
        <th>Period</th>
        ${window.currentUserRole !== 'staff' ? '<th style="text-align:right">Received</th>' : ''}
        <th style="text-align:right">Materials</th>
        <th style="text-align:right">Labor</th>
        <th style="text-align:right">Current Fund Spent</th>
        ${window.currentUserRole !== 'staff' ? '<th style="text-align:right">Remaining</th>' : ''}
        <th style="text-align:center">% Used</th>
        <th style="text-align:center">Status</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>

    <div class="section-title" style="margin-top:28px">Category Breakdown</div>
    <table>
      <thead><tr>
        <th>Category</th>
        <th style="text-align:right">Amount</th>
        <th style="text-align:right">% of Total</th>
        <th>Distribution</th>
      </tr></thead>
      <tbody>${catRows || '<tr><td colspan="4" style="text-align:center;color:#9ca3af">No category data.</td></tr>'}</tbody>
    </table>

    ${expDetailSection}
    ${payDetailSection}
  </div>

  <div class="footer">
    <div class="footer-left">Official report generated by the DAC's Admin System. For internal use only.</div>
    <div class="footer-brand">DAC's Building Design Services</div>
  </div>
</div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=1000,height=900');
    if (!win) { showExpNotif('Pop-up blocked. Please allow pop-ups for this site.', 'error'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.onload = function() { win.print(); win.onafterprint = function() { win.close(); }; };
}

console.log('✅ Reports Dashboard Module Loaded');

// ════════════════════════════════════════════════════════════
// MVP 3-STATE NAVIGATION
// ════════════════════════════════════════════════════════════
let _mvpCurrentFolderId = null;

function mvpNavigate(state, folderId) {
    const s1 = document.getElementById('mvpFolderState');
    const s2 = document.getElementById('mvpProjectState');
    const s3 = document.getElementById('mvpDetailState');
    if (!s1) return;
    s1.style.display = 'none';
    if (s2) s2.style.display = 'none';
    s3.style.display = 'none';

    if (state === 'folders') {
        s1.style.display = '';
        mvpRenderFolderGrid();
    } else if (state === 'detail') {
        if (folderId) _mvpCurrentFolderId = folderId;
        s3.style.display = '';
        const folder = expFolders.find(f => f.id === _mvpCurrentFolderId);
        setText('mvpDetailFolderCrumb', folder ? folder.name : 'Folder');
        mvpSwitchTab('materials');
        // selectFolder loads all expenses/payroll for the folder
        if (typeof selectFolder === 'function') selectFolder(_mvpCurrentFolderId);
        if (window.expenseInboxRenderPC) expenseInboxRenderPC(_mvpCurrentFolderId, folder ? folder.name : '');
    }
}

function mvpSwitchTab(tabName) {
    const map = {
        materials: { btn: 'mvpTabBtnMaterials', panel: 'mvpTabMaterials' },
        payroll:   { btn: 'mvpTabBtnPayroll',   panel: 'mvpTabPayroll'   },
        cover:     { btn: 'mvpTabBtnCover',     panel: 'mvpTabCover'     },
    };
    Object.keys(map).forEach(t => {
        const btn   = document.getElementById(map[t].btn);
        const panel = document.getElementById(map[t].panel);
        if (btn)   btn.classList.toggle('mvp-tab-active', t === tabName);
        if (panel) panel.style.display = t === tabName ? '' : 'none';
    });
    // Refresh payroll tab when switching to it
    if (tabName === 'payroll') mvpRenderPayrollInDetail();
}

function _mvpHealthClass(remPct) {
    if (remPct < 0)  return 'mvp-health-danger';
    if (remPct < 10) return 'mvp-health-critical';
    if (remPct < 20) return 'mvp-health-warning';
    return 'mvp-health-healthy';
}
function _mvpHealthLabel(remPct) {
    if (remPct < 0)  return 'OVER BUDGET';
    if (remPct === 0) return 'AT LIMIT';
    if (remPct < 10) return 'CRITICAL';
    if (remPct < 20) return 'WARNING';
    return 'HEALTHY';
}
function _mvpFmt(n) { return '₱' + formatNum(n); }

function mvpRenderFolderGrid() {
    var grid = document.getElementById('mvpFolderGrid');
    if (!grid) return;

    if (!expFolders.length) {
        grid.innerHTML = '<div class="ov-empty-state">'
            + '<svg viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" width="56" height="56"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            + '<h3 style="margin:0.75rem 0 0.25rem;font-size:1rem;color:#374151;">No Project Folders</h3>'
            + '<p style="color:#9ca3af;font-size:0.875rem;margin:0 0 1rem;">Create your first project folder to start tracking expenses.</p>'
            + '<button class="ov-btn-new ov-btn-new--center" onclick="openExpModal(\'createFolderModal\')">+ New Project Folder</button>'
            + '</div>';
        return;
    }

    var _useOvCache = _ovAllExpenses.length > 0 || _ovAllPayroll.length > 0;

    var fmtD = function(n) {
        n = parseFloat(n) || 0;
        return '&#8369;' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    var fmtDate = function(ts) {
        if (!ts) return null;
        var d = ts && ts.toDate ? ts.toDate() : ts && ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
        if (isNaN(d)) return null;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };
    var progressColor = function(remPct) {
        if (remPct <= 0) return '#ef4444';
        if (remPct < 10) return '#f97316';
        if (remPct < 20) return '#f59e0b';
        return '#10b981';
    };

    grid.innerHTML = expFolders.map(function(folder) {
        var fProjs         = expProjects.filter(function(p) { return p.folderId === folder.id; });
        var contract       = folder.totalBudget || 0;
        var budgetReceived = fProjs.reduce(function(s, p) { return s + (p.monthlyBudget || 0); }, 0);
        var totalCost      = _useOvCache
            ? fProjs.reduce(function(s, p) {
                var e = _ovAllExpenses.filter(function(x) { return x.projectId === p.id; }).reduce(function(s2, x) { return s2 + (parseFloat(x.amount) || 0); }, 0);
                var l = _ovAllPayroll.filter(function(x)  { return x.projectId === p.id; }).reduce(function(s2, x) { return s2 + (parseFloat(x.totalSalary) || 0); }, 0);
                return s + e + l;
              }, 0)
            : fProjs.reduce(function(s, p) { return s + (p._spent || 0); }, 0);
        var variance   = budgetReceived - totalCost;
        var remPct     = budgetReceived > 0 ? ((budgetReceived - totalCost) / budgetReceived) * 100 : 100;
        var spentPct   = budgetReceived > 0 ? Math.min((totalCost / budgetReceived) * 100, 100) : 0;
        var hClass     = _mvpHealthClass(remPct);
        var hLabel     = _mvpHealthLabel(remPct);
        var barClr     = progressColor(remPct);
        var fid        = folder.id;
        var desc       = folder.description || 'No description';
        var createdStr = fmtDate(folder.createdAt);
        var footerMeta = fProjs.length + ' billing period' + (fProjs.length !== 1 ? 's' : '')
                       + (createdStr ? ' &bull; Created ' + createdStr : '');
        var varClass   = variance >= 0 ? 'ov-folder-card__stat-value--positive' : 'ov-folder-card__stat-value--negative';
        var _presPIds  = fProjs.filter(function(p) { return p.fundingType === 'president'; }).map(function(p) { return p.id; });
        var coverCost  = _useOvCache
            ? _ovAllExpenses.filter(function(x) { return fProjs.some(function(p){ return p.id === x.projectId; }) && (x.coverExpense || _presPIds.indexOf(x.projectId) !== -1); }).reduce(function(s,x){ return s+(parseFloat(x.amount)||0); }, 0)
              + _ovAllPayroll.filter(function(x) { return _presPIds.indexOf(x.projectId) !== -1; }).reduce(function(s,x){ return s+(parseFloat(x.totalSalary)||0); }, 0)
            : 0;

        return '<div class="ov-folder-card">'
            + '<div class="ov-folder-card__title-row">'
            +   '<div class="ov-folder-card__name">' + _mvpEsc(folder.name || 'Unnamed') + '</div>'
            +   '<div style="display:flex;gap:0.35rem;align-items:center;">'
            +     '<button class="ov-folder-card__edit-icon" onclick="openEditFolderModal(\'' + fid + '\')" title="Edit folder">'
            +       '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
            +     '</button>'
            +     '<button class="ov-folder-card__del-icon" onclick="confirmDeleteFolder(\'' + fid + '\')" title="Delete folder">'
            +       '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>'
            +     '</button>'
            +   '</div>'
            + '</div>'
            + '<div class="ov-folder-card__desc">' + _mvpEsc(desc) + '</div>'
            + '<div class="ov-folder-card__stat-list">'
            + (window.currentUserRole !== 'staff' ? '<div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Total Contract</span><span class="ov-folder-card__stat-value">' + fmtD(contract) + '</span></div>' : '')
            + (window.currentUserRole !== 'staff' ? '<div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Total Fund Allocated</span><span class="ov-folder-card__stat-value">' + fmtD(budgetReceived) + '</span></div>' : '')
            + (window.currentUserRole === 'staff' ? '<div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Cover Expenses</span><span class="ov-folder-card__stat-value">' + fmtD(coverCost) + '</span></div>' : '')
            +   '<div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Current Fund Spent</span><span class="ov-folder-card__stat-value ov-folder-card__stat-value--positive">' + fmtD(totalCost) + '</span></div>'
            + (window.currentUserRole !== 'staff' ? '<div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Total Fund Allocated Remaining</span><span class="ov-folder-card__stat-value ' + varClass + '">' + fmtD(variance) + '</span></div>' : '')
            + '</div>'
            + '<div class="ov-folder-card__health-row">'
            +   '<span class="mvp-health-badge ' + hClass + '">' + hLabel + '</span>'
            +   '<span style="font-size:0.82rem;color:#6b7280;">' + spentPct.toFixed(1) + '%</span>'
            + '</div>'
            + '<div class="ov-folder-card__progress" style="margin:0.5rem 0 0.75rem;">'
            +   '<div style="height:7px;background:#f3f4f6;border-radius:999px;overflow:hidden;">'
            +     '<div style="height:100%;width:' + spentPct.toFixed(1) + '%;background:' + barClr + ';border-radius:999px;transition:width 0.4s;"></div>'
            +   '</div>'
            + '</div>'
            + '<div class="ov-folder-card__footer-meta">' + footerMeta + '</div>'
            + '<button class="ov-folder-card__view-btn" onclick="mvpNavigate(\'detail\',\'' + fid + '\')">'
            +   'View Details'
            +   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:0.4rem;"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>'
            + '</button>'
            + '</div>';
    }).join('');
}

function mvpRenderProjectGrid(folderId) {
    const grid = document.getElementById('mvpProjectGrid');
    if (!grid) return;
    const fProjs = expProjects.filter(function(p){ return p.folderId === folderId; });
    if (fProjs.length === 0) {
        grid.innerHTML = '<div class="mvp-empty-state"><div class="mvp-empty-icon">&#128203;</div><h3>No Projects Yet</h3><p>Add a project to this folder to start tracking expenses.</p></div>';
        return;
    }
    const folder     = expFolders.find(function(f){ return f.id === folderId; });
    const folderName = folder ? _mvpEsc(folder.name) : '';
    const barColor   = function(remPct) {
        if (remPct <= 0) return '#ef4444';
        if (remPct < 10) return '#f97316';
        if (remPct < 20) return '#f59e0b';
        return '#3b82f6';
    };
    grid.innerHTML = fProjs.map(function(proj) {
        const budget    = proj.monthlyBudget || 0;
        const spent     = proj._spent || 0;
        const remaining = budget - spent;
        const spentPct  = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
        const remPct    = budget > 0 ? (remaining / budget) * 100 : 100;
        const hClass    = _mvpHealthClass(remPct);
        const hLabel    = _mvpHealthLabel(remPct);
        const color     = barColor(remPct);
        const pid       = proj.id;
        return '<div class="mvp-project-card">'
            + '<div class="mvp-project-card__header">'
            +   '<div>'
            +     '<div class="mvp-project-card__name">' + _mvpEsc(proj.month || '') + ' ' + (proj.year || '') + '</div>'
            +     '<div class="mvp-project-card__period">' + folderName + '</div>'
            +   '</div>'
            +   '<span class="mvp-health-badge ' + hClass + '">' + hLabel + '</span>'
            + '</div>'
            + '<div class="mvp-project-card__progress">'
            +   '<div class="mvp-project-card__progress-fill" style="width:' + spentPct.toFixed(1) + '%;background:' + color + '"></div>'
            + '</div>'
            + '<div class="mvp-project-card__stats">'
            +   '<div class="mvp-project-card__stat"><div class="mvp-project-card__stat-label">Budget</div><div class="mvp-project-card__stat-value">' + _mvpFmt(budget) + '</div></div>'
            +   '<div class="mvp-project-card__stat"><div class="mvp-project-card__stat-label">Spent</div><div class="mvp-project-card__stat-value">' + _mvpFmt(spent) + '</div></div>'
            +   '<div class="mvp-project-card__stat"><div class="mvp-project-card__stat-label">Remaining</div><div class="mvp-project-card__stat-value">' + _mvpFmt(remaining) + '</div></div>'
            + '</div>'
            + '<div class="mvp-project-card__actions">'
            +   '<button class="mvp-btn-view" onclick="mvpNavigate(\'detail\',\'' + folderId + '\',\'' + pid + '\')">View Details</button>'
            +   '<button class="mvp-btn-delete" onclick="confirmDeleteProject(\'' + pid + '\')">Delete</button>'
            + '</div>'
            + '</div>';
    }).join('');
}

function mvpRenderAllProjectsTable() {
    const tbody = document.getElementById('mvpAllProjectsTbody');
    if (!tbody) return;
    if (expProjects.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="exp-empty-row">No projects found. Create a folder and add projects to get started.</td></tr>';
        return;
    }
    tbody.innerHTML = expProjects.map(function(proj) {
        const folder     = expFolders.find(function(f){ return f.id === proj.folderId; });
        const folderName = folder ? _mvpEsc(folder.name) : '—';
        const budget     = proj.monthlyBudget || 0;
        const spent      = proj._spent || 0;
        const remaining  = budget - spent;
        const remPct     = budget > 0 ? (remaining / budget) * 100 : 100;
        const hClass     = _mvpHealthClass(remPct);
        const hLabel     = _mvpHealthLabel(remPct);
        return '<tr>'
            + '<td>' + folderName + '</td>'
            + '<td>' + _mvpEsc(proj.month || '') + ' ' + (proj.year || '') + '</td>'
            + '<td>' + _mvpFmt(budget) + '</td>'
            + '<td>' + _mvpFmt(spent) + '</td>'
            + '<td>' + _mvpFmt(remaining) + '</td>'
            + '<td><span class="mvp-health-badge ' + hClass + '">' + hLabel + '</span></td>'
            + '<td><button class="exp-btn exp-btn-sm" onclick="mvpNavigate(\'detail\',\'' + (proj.folderId||'') + '\',\'' + proj.id + '\')">View</button></td>'
            + '</tr>';
    }).join('');
}

function mvpUpdateDetail() {
    // Works at folder level — aggregates all billing periods
    var _fid = (expCurrentFolder && expCurrentFolder.id) ? expCurrentFolder.id : _mvpCurrentFolderId;
    const folder = expFolders.find(function(f){ return f.id === _fid; });
    if (!folder) return;

    const fProjs   = expProjects.filter(function(p){ return p.folderId === folder.id; });
    const contract = folder.totalBudget || 0;
    const budget   = fProjs.reduce(function(s,p){ return s + (p.monthlyBudget||0); }, 0);
    const matSpent = expExpenses.reduce(function(s,e){ return s + (parseFloat(e.amount)||0); }, 0);
    const labSpent = expPayroll.reduce(function(s,e){ return s + (parseFloat(e.totalSalary)||0); }, 0);
    const totalSpent = matSpent + labSpent;
    const remaining  = budget - totalSpent;
    const remPct     = budget > 0 ? (remaining / budget) * 100 : 100;
    const matPct     = budget > 0 ? (matSpent / budget) * 100 : 0;
    const labPct     = budget > 0 ? (labSpent / budget) * 100 : 0;

    const el     = function(id){ return document.getElementById(id); };
    const setTxt = function(id, v){ const e = el(id); if (e) e.textContent = v; };

    // Cover Expenses card
    var presProjs   = fProjs.filter(function(p){ return p.fundingType === 'president'; });
    var presProjIds = presProjs.map(function(p){ return p.id; });
    var coverCost   = expExpenses.filter(function(e){ return e.coverExpense || presProjIds.indexOf(e.projectId) !== -1; })
                        .reduce(function(s,e){ return s+(parseFloat(e.amount)||0); }, 0)
                    + expPayroll.filter(function(p){ return presProjIds.indexOf(p.projectId) !== -1; })
                        .reduce(function(s,p){ return s+(parseFloat(p.totalSalary)||0); }, 0);
    var coverPctOfRcv = budget > 0 ? (coverCost / budget) * 100 : 0;
    setTxt('mvpDetailCoverVal',  coverCost > 0 ? _mvpFmt(coverCost) : '—');
    setTxt('mvpDetailCoverSub',  presProjs.length + ' month' + (presProjs.length !== 1 ? 's' : '') + ' covered');
    setTxt('mvpDetailCoverPct',  coverPctOfRcv.toFixed(1) + '%');
    var coverBadgeEl = el('mvpDetailCoverBadge');
    if (coverBadgeEl) {
        var cLbl, cCls;
        if (coverCost <= 0)          { cLbl = 'NONE';    cCls = 'mvp-health-badge mvp-health-healthy'; }
        else if (coverPctOfRcv >= 5) { cLbl = 'BAD';     cCls = 'mvp-health-badge mvp-health-danger'; }
        else if (coverPctOfRcv >= 2) { cLbl = 'WARNING'; cCls = 'mvp-health-badge mvp-health-warning'; }
        else                         { cLbl = 'HEALTHY'; cCls = 'mvp-health-badge mvp-health-healthy'; }
        coverBadgeEl.className   = cCls;
        coverBadgeEl.textContent = cLbl;
    }

    setTxt('mvpDetailTotalCost',  _mvpFmt(totalSpent));
    setTxt('mvpDetailTotalMat',   _mvpFmt(matSpent));
    setTxt('mvpDetailTotalLab',   _mvpFmt(labSpent));

    setTxt('mvpDetailBudget',     _mvpFmt(budget));
    setTxt('mvpDetailBudgetSub',  fProjs.length + ' billing period' + (fProjs.length !== 1 ? 's' : ''));
    setTxt('mvpDetailHealthPct',  Math.max(0, remPct).toFixed(1) + '%');
    setTxt('mvpDetailHealthSub',  'remaining of budget');
    setTxt('mvpDetailRemPct',     Math.max(0, remPct).toFixed(1) + '% remaining');

    const badge = el('mvpDetailHealthBadge');
    if (badge) {
        const hClass = _mvpHealthClass(remPct);
        const hLabel = _mvpHealthLabel(remPct);
        badge.className   = 'mvp-health-badge ' + hClass;
        badge.textContent = hLabel;
        const colors = { 'mvp-health-healthy':'#10b981','mvp-health-warning':'#f59e0b','mvp-health-critical':'#f97316','mvp-health-danger':'#ef4444' };
        const hCard = el('mvpDetailHealthCard');
        if (hCard) hCard.style.borderLeftColor = colors[hClass] || '#10b981';
    }

    const matW = Math.min(matPct, 100);
    const labW = Math.min(labPct, Math.max(0, 100 - matPct));
    const remW = Math.max(0, 100 - matW - labW);
    const setW = function(id, w){ const e = el(id); if (e) e.style.width = w.toFixed(1) + '%'; };
    setW('mvpDetailStackMat', matW);
    setW('mvpDetailStackLab', labW);
    setW('mvpDetailStackRem', remW);
    setTxt('mvpDetailPctMat', matPct.toFixed(1) + '%');
    setTxt('mvpDetailPctLab', labPct.toFixed(1) + '%');
    setTxt('mvpDetailPctRem', Math.max(0, remPct).toFixed(1) + '%');

    const tbody = el('mvpBreakdownTbody');
    if (tbody) {
        const rows = [
            { cat:'Materials & Costs', amt:matSpent,              pct:matPct, cls:'mvp-bar-mat' },
            { cat:'Labor & Payroll',   amt:labSpent,              pct:labPct, cls:'mvp-bar-lab' },
            ...(window.currentUserRole !== 'staff' ? [{ cat:'Remaining Budget', amt:Math.max(0,remaining), pct:Math.max(0,remPct), cls:'mvp-bar-cov' }] : []),
        ];
        tbody.innerHTML = rows.map(function(r){
            return '<tr>'
                + '<td>' + r.cat + '</td>'
                + '<td>' + _mvpFmt(r.amt) + '</td>'
                + '<td>' + r.pct.toFixed(1) + '%</td>'
                + '<td><div class="mvp-bar-wrap"><div class="mvp-bar-fill ' + r.cls + '" style="width:' + Math.min(r.pct,100).toFixed(1) + '%"></div></div></td>'
                + '</tr>';
        }).join('');
    }

    mvpRenderPayrollInDetail();
}

function mvpRenderPayrollInDetail() {
    const tbody = document.getElementById('mvpPayrollTbody');
    if (!tbody) return;
    const searchVal = (document.getElementById('mvpPaySearchName')||{}).value || '';
    const filtered  = searchVal
        ? expPayroll.filter(function(w){ return (w.workerName||'').toLowerCase().includes(searchVal.toLowerCase()); })
        : expPayroll;
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="exp-empty-row">No payroll entries' + (searchVal ? ' matching "'+_mvpEsc(searchVal)+'"' : ' for this project') + '.</td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(function(w) {
        return '<tr>'
            + '<td>' + formatDate(w.paymentDate) + '</td>'
            + '<td>' + _mvpEsc(w.workerName||'—') + '</td>'
            + '<td>' + _mvpEsc(w.role||'—') + '</td>'
            + '<td>' + _mvpEsc(w.notes||'—') + '</td>'
            + '<td>' + (w.daysWorked||0) + '</td>'
            + '<td>' + _mvpFmt(w.dailyRate||0) + '</td>'
            + '<td>' + _mvpFmt(w.totalSalary||0) + '</td>'
            + '<td>—</td>'
            + '<td class="exp-action-cell">'
            +   '<button class="exp-icon-btn exp-icon-btn-view" title="View All Receipts" onclick="openWorkerSummaryModal(\'' + (w.workerName||'').replace(/'/g,"\\'") + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></button>'
            +   '<button class="exp-icon-btn exp-icon-btn-invoice" title="Acknowledge Invoice" onclick="printSinglePayrollInvoice(\'' + w.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>'
            +   '<button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="openEditPayrollModal(\'' + w.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>'
            +   '<button class="exp-icon-btn exp-icon-btn-danger" title="Delete" onclick="deletePayroll(\'' + w.id + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
            + '</td>'
            + '</tr>';
    }).join('');
    if (window.lucide) lucide.createIcons();
}

function mvpApplyPayrollSearch() {
    mvpRenderPayrollInDetail();
    const val = (document.getElementById('mvpPaySearchName')||{}).value || '';
    const btn = document.getElementById('mvpPaySearchClearBtn');
    if (btn) btn.style.display = val ? '' : 'none';
}

function mvpClearPayrollSearch() {
    const inp = document.getElementById('mvpPaySearchName');
    if (inp) { inp.value = ''; }
    const btn = document.getElementById('mvpPaySearchClearBtn');
    if (btn) btn.style.display = 'none';
    mvpRenderPayrollInDetail();
}

function _mvpEsc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ════════════════════════════════════════════════════════════
// MVP OVERVIEW — Project Folders Grid (Budget Overview tab)
// ════════════════════════════════════════════════════════════
function mvpRenderOverviewFolderGrid() {
    const grid = document.getElementById('mvpOverviewFolderGrid');
    if (!grid) return;

    if (expFolders.length === 0) {
        grid.innerHTML =
            '<div class="bo-empty">'
            + '<div class="bo-empty-icon">📁</div>'
            + '<h3 class="bo-empty-title">No project folders yet</h3>'
            + '<p class="bo-empty-sub">Create your first project folder to start tracking budgets, billing periods, and receivables.</p>'
            + '<button class="bo-btn-primary" onclick="openExpModal(\'createFolderModal\')">+ New Project Folder</button>'
            + '</div>';
        return;
    }

    const fmtD = function(n) {
        return '₱ ' + (n || 0).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
    };
    const fmtDate = function(ts) {
        if (!ts) return null;
        var d;
        if (ts && ts.toDate) { d = ts.toDate(); }
        else if (ts && ts.seconds) { d = new Date(ts.seconds * 1000); }
        else { d = new Date(ts); }
        if (isNaN(d)) return null;
        return d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    };

    var _useOvCache = _ovAllExpenses.length > 0 || _ovAllPayroll.length > 0;

    grid.innerHTML = expFolders.map(function(folder) {
        const fProjs        = expProjects.filter(function(p){ return p.folderId === folder.id; });
        const contract      = folder.totalBudget || 0;
        const budgetReceived= fProjs.reduce(function(s,p){ return s + (p.monthlyBudget||0); }, 0);
        const totalCost     = _useOvCache
            ? fProjs.reduce(function(s, p) {
                var e = _ovAllExpenses.filter(function(x){ return x.projectId === p.id; }).reduce(function(s2,x){ return s2 + (parseFloat(x.amount)||0); }, 0);
                var l = _ovAllPayroll.filter(function(x){ return x.projectId === p.id; }).reduce(function(s2,x){ return s2 + (parseFloat(x.totalSalary)||0); }, 0);
                return s + e + l;
              }, 0)
            : fProjs.reduce(function(s,p){ return s + (p._spent||0); }, 0);
        const variance      = budgetReceived - totalCost;
        const remPct        = budgetReceived > 0 ? ((budgetReceived - totalCost) / budgetReceived) * 100 : 100;
        const spentPct      = budgetReceived > 0 ? Math.min((totalCost / budgetReceived) * 100, 100) : 0;
        const hClass        = _mvpHealthClass(remPct);
        const hLabel        = _mvpHealthLabel(remPct);
        const fid           = folder.id;
        const desc          = folder.description || '';
        const createdStr    = fmtDate(folder.createdAt);
        const footerMeta    = fProjs.length + ' billing period' + (fProjs.length !== 1 ? 's' : '')
                            + (createdStr ? ' · Created ' + createdStr : '');
        const varClass      = variance >= 0 ? 'bo-fld-stat-accent' : 'bo-fld-stat-warn';
        const _cPresPIds    = fProjs.filter(function(p) { return p.fundingType === 'president'; }).map(function(p) { return p.id; });
        const coverCost     = _useOvCache
            ? _ovAllExpenses.filter(function(x) { return fProjs.some(function(p){ return p.id === x.projectId; }) && (x.coverExpense || _cPresPIds.indexOf(x.projectId) !== -1); }).reduce(function(s,x){ return s+(parseFloat(x.amount)||0); }, 0)
              + _ovAllPayroll.filter(function(x) { return _cPresPIds.indexOf(x.projectId) !== -1; }).reduce(function(s,x){ return s+(parseFloat(x.totalSalary)||0); }, 0)
            : 0;
        var barClr = remPct <= 0 ? '#c0392b' : (remPct < 10 ? '#c0392b' : (remPct < 20 ? '#A86B00' : '#1A5C3A'));
        var isStaff = window.currentUserRole === 'staff';

        return '<div class="bo-fld-card">'
            + '<div class="bo-fld-card-head">'
            +   '<div class="bo-fld-card-title">'
            +     '<div class="bo-fld-card-name">' + _mvpEsc(folder.name || 'Unnamed') + '</div>'
            +     (desc ? '<div class="bo-fld-card-desc">' + _mvpEsc(desc) + '</div>' : '')
            +   '</div>'
            +   '<div class="bo-fld-card-actions">'
            +     '<button class="bo-icon-btn" onclick="event.stopPropagation();openEditFolderModal(\'' + fid + '\')" title="Edit folder">'
            +       '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
            +     '</button>'
            +     '<button class="bo-icon-btn bo-icon-btn-danger" onclick="event.stopPropagation();confirmDeleteFolder(\'' + fid + '\')" title="Delete folder">'
            +       '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>'
            +     '</button>'
            +   '</div>'
            + '</div>'
            + '<div class="bo-fld-card-stats">'
            + (!isStaff ? '<div class="bo-fld-stat"><span class="lbl">Total Contract</span><span class="val">' + fmtD(contract) + '</span></div>' : '')
            + (!isStaff ? '<div class="bo-fld-stat"><span class="lbl">Total Fund Allocated</span><span class="val">' + fmtD(budgetReceived) + '</span></div>' : '')
            + (isStaff ? '<div class="bo-fld-stat"><span class="lbl">Cover Expenses</span><span class="val">' + fmtD(coverCost) + '</span></div>' : '')
            +   '<div class="bo-fld-stat"><span class="lbl">Current Fund Spent</span><span class="val bo-fld-stat-accent">' + fmtD(totalCost) + '</span></div>'
            + (!isStaff ? '<div class="bo-fld-stat"><span class="lbl">Remaining</span><span class="val ' + varClass + '">' + fmtD(variance) + '</span></div>' : '')
            + '</div>'
            + '<div class="bo-fld-card-health">'
            +   '<span class="mvp-health-badge ' + hClass + '">' + hLabel + '</span>'
            +   '<span class="bo-fld-card-pct">' + spentPct.toFixed(1) + '% used</span>'
            + '</div>'
            + '<div class="bo-fld-card-progress"><div class="bo-fld-card-progress-fill" style="width:' + spentPct.toFixed(1) + '%;background:' + barClr + '"></div></div>'
            + '<div class="bo-fld-card-meta">' + footerMeta + '</div>'
            + '<button class="bo-fld-card-cta" onclick="mvpOvNavigate(\'detail\',\'' + fid + '\')">'
            +   'Open Project <span style="margin-left:6px">→</span>'
            + '</button>'
            + '</div>';
    }).join('');
}

// Opens the Expenses tab and navigates to a folder's project list
function mvpOpenFolderInExpenses(folderId) {
    if (typeof switchView === 'function') switchView('expExpenses');
    setTimeout(function() { mvpNavigate('detail', folderId); }, 50);
}

/* ── Overview Tab — 2-state navigation ────────────────── */
let _mvpOvCurrentFolderId = null;

function mvpOvNavigate(state, folderId) {
    var s1 = document.getElementById('mvpOvFolderState');
    var s2 = document.getElementById('mvpOvDetailState');
    if (!s1 || !s2) return;
    s1.style.display = 'none';
    s2.style.display = 'none';

    if (state === 'folders') {
        s1.style.display = '';
        mvpRenderOverviewFolderGrid();
    } else if (state === 'detail') {
        if (folderId) _mvpOvCurrentFolderId = folderId;
        s2.style.display = '';
        // Subscribe folder data, then render once data arrives
        if (typeof selectFolder === 'function') selectFolder(_mvpOvCurrentFolderId);
        mvpRenderOvFolderDetail(_mvpOvCurrentFolderId);
    }
}

function _ovSetDelta(amtId, badgeId, delta, label) {
    var amtEl   = document.getElementById(amtId);
    var badgeEl = document.getElementById(badgeId);
    if (amtEl) {
        amtEl.textContent = (delta >= 0 ? '+' : '-') + _mvpFmt(Math.abs(delta));
        amtEl.className = 'ov-kpi-lg__delta-amt ' + (delta >= 0 ? 'is-positive' : 'is-negative');
    }
    if (badgeEl) {
        badgeEl.textContent = label;
        badgeEl.className = 'ov-kpi-lg__delta-badge ' + (delta >= 0 ? 'badge--green' : 'badge--red');
    }
}

function _ovSetStatusBadge(id, usedPct) {
    var el = document.getElementById(id);
    if (!el) return;
    if (usedPct > 100) {
        el.className = 'ov-kpi-lg__status-badge badge--danger';
        el.textContent = 'BAD';
    } else if (usedPct > 80) {
        el.className = 'ov-kpi-lg__status-badge badge--warning';
        el.textContent = 'WARNING';
    } else {
        el.className = 'ov-kpi-lg__status-badge';
        el.textContent = usedPct > 60 ? 'ON TRACK' : 'HEALTHY';
    }
}

function mvpRenderOvFolderDetail(folderId) {
    var fid    = folderId || _mvpOvCurrentFolderId;
    var folder = expFolders.find(function(f) { return f.id === fid; });
    if (!folder) return;

    // Folder header
    setText('mvpOvDetailName',    folder.name    || 'Unnamed Folder');
    setText('mvpOvDetailDesc',    folder.description || '');
    var createdStr = '';
    if (folder.createdAt) {
        var ts = folder.createdAt.toDate ? folder.createdAt.toDate() : new Date(folder.createdAt);
        createdStr = 'Created ' + ts.toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
    }
    setText('mvpOvDetailCreated', createdStr);

    // Aggregate data
    var fProjs     = expProjects.filter(function(p) { return p.folderId === fid; });
    var clientProjs = fProjs.filter(function(p) { return p.fundingType !== 'president'; });
    var presProjs   = fProjs.filter(function(p) { return p.fundingType === 'president'; });
    var presProjIds = presProjs.map(function(p) { return p.id; });

    var contract   = parseFloat(folder.totalBudget) || 0;
    var budgetRcv  = clientProjs.reduce(function(s, p) { return s + (parseFloat(p.monthlyBudget) || 0); }, 0);

    var matCost    = expExpenses.filter(function(e) { return fProjs.some(function(p) { return p.id === e.projectId; }) && !e.coverExpense; })
                        .reduce(function(s, e) { return s + (parseFloat(e.amount) || 0); }, 0);
    var labCost    = expPayroll.filter(function(p) { return fProjs.some(function(pr) { return pr.id === p.projectId; }) && presProjIds.indexOf(p.projectId) === -1; })
                        .reduce(function(s, p) { return s + (parseFloat(p.totalSalary) || 0); }, 0);
    var coverCost  = expExpenses.filter(function(e) { return e.coverExpense || presProjIds.indexOf(e.projectId) !== -1; })
                        .reduce(function(s, e) { return s + (parseFloat(e.amount) || 0); }, 0)
                   + expPayroll.filter(function(p) { return presProjIds.indexOf(p.projectId) !== -1; })
                        .reduce(function(s, p) { return s + (parseFloat(p.totalSalary) || 0); }, 0);

    var totalSpent = matCost + labCost;
    var remaining  = budgetRcv - totalSpent;
    var spentPct   = budgetRcv > 0 ? Math.min((totalSpent / budgetRcv) * 100, 100) : 0;
    var remPct     = 100 - spentPct;
    var matPct     = budgetRcv > 0 ? Math.min((matCost  / budgetRcv) * 100, 100) : 0;
    var labPct     = budgetRcv > 0 ? Math.min((labCost  / budgetRcv) * 100, 100) : 0;
    var totalOfContract = contract > 0 ? Math.min((totalSpent / contract) * 100, 100) : 0;
    var coverOfContract = contract > 0 ? Math.min((coverCost / contract) * 100, 100) : 0;
    var hClass     = _mvpHealthClass(remPct);
    var hLabel     = _mvpHealthLabel(remPct);

    // ── Health badge (section header)
    var badge = document.getElementById('mvpOvHealthBadge');
    if (badge) { badge.className = 'mvp-health-badge ' + hClass; badge.textContent = hLabel; }

    // ── Row 1: TOTAL CONTRACT card
    setText('mvpOvKpiContractVal', _mvpFmt(contract));
    var cDelta1 = contract - budgetRcv;
    var cDelta2 = contract - totalSpent;
    _ovSetDelta('mvpOvKpiContractDelta1', 'mvpOvKpiContractDelta1Badge', cDelta1,
        cDelta1 >= 0 ? 'Profitable' : 'Loss');
    _ovSetDelta('mvpOvKpiContractDelta2', 'mvpOvKpiContractDelta2Badge', cDelta2,
        cDelta2 >= 0 ? 'Under Budget' : 'Over Budget');
    _ovSetStatusBadge('mvpOvKpiContractStatusBadge', totalOfContract);
    setText('mvpOvKpiContractPct', totalOfContract.toFixed(1) + '%');

    // ── Row 1: TOTAL FUND ALLOCATED card
    setText('mvpOvKpiReceivedVal', _mvpFmt(budgetRcv));
    setText('mvpOvKpiReceivedSub', clientProjs.length + ' billing month' + (clientProjs.length !== 1 ? 's' : ''));
    var rDelta = budgetRcv - totalSpent;
    _ovSetDelta('mvpOvKpiReceivedDelta', 'mvpOvKpiReceivedDeltaBadge', rDelta,
        rDelta >= 0 ? 'Good' : 'Deficit');
    _ovSetStatusBadge('mvpOvKpiReceivedStatusBadge', spentPct);
    setText('mvpOvKpiReceivedPct', spentPct.toFixed(1) + '%');

    // ── Row 1: COVER EXPENSES card
    setText('mvpOvKpiCoverVal', coverCost > 0 ? _mvpFmt(coverCost) : '—');
    setText('mvpOvKpiCoverSub', presProjs.length + ' month' + (presProjs.length !== 1 ? 's' : '') + ' covered');
    // Budget Status = cover expenses as % of 10% allowance (10% of budget received = 100%)
    // Budget Status = cover expenses as % of contract value (original)
    var coverBadge = document.getElementById('mvpOvKpiCoverStatusBadge');
    if (coverBadge) {
        coverBadge.className = 'ov-kpi-lg__status-badge ov-kpi-lg__status-badge--none';
        if (coverCost > 0) {
            var cp = coverOfContract;
            coverBadge.className   = 'ov-kpi-lg__status-badge' + (cp >= 5 ? ' badge--danger' : cp >= 2 ? ' badge--warning' : '');
            coverBadge.textContent = cp >= 5 ? 'BAD' : cp >= 2 ? 'WARNING' : 'HEALTHY';
        } else {
            coverBadge.textContent = 'NONE';
        }
    }
    setText('mvpOvKpiCoverPct', coverOfContract.toFixed(1) + '%');

    // ── Row 2: MATERIALS card
    var expCount = expExpenses.filter(function(e) { return fProjs.some(function(p) { return p.id === e.projectId; }); }).length;
    setText('mvpOvKpiMatVal', _mvpFmt(matCost));
    setText('mvpOvKpiMatSub', expCount + ' transaction' + (expCount !== 1 ? 's' : '') + ' · ' + matPct.toFixed(1) + '% of budget');
    setText('mvpOvKpiMatSub2', expCount + ' transaction' + (expCount !== 1 ? 's' : ''));
    setText('mvpOvKpiMatPct', matPct.toFixed(1) + '%');
    setStyle('mvpOvKpiMatBar', 'width', Math.min(matPct, 100).toFixed(1) + '%');

    // ── Row 2: LABOR card
    var workerSet = new Set(expPayroll.map(function(p) { return p.workerName || p.id; }));
    setText('mvpOvKpiLabVal', _mvpFmt(labCost));
    setText('mvpOvKpiLabSub', workerSet.size + ' worker' + (workerSet.size !== 1 ? 's' : '') + ' · ' + labPct.toFixed(1) + '% of budget');
    setText('mvpOvKpiLabSub2', workerSet.size + ' worker' + (workerSet.size !== 1 ? 's' : ''));
    setText('mvpOvKpiLabPct', labPct.toFixed(1) + '%');
    setStyle('mvpOvKpiLabBar', 'width', Math.min(labPct, 100).toFixed(1) + '%');

    // ── Row 2: TOTAL COST card
    setText('mvpOvKpiTotalVal', _mvpFmt(totalSpent));
    setText('mvpOvKpiTotalSub', totalOfContract.toFixed(1) + '% of contract value');
    setText('mvpOvKpiTotalPct', totalOfContract.toFixed(1) + '%');
    setStyle('mvpOvKpiTotalBar', 'width', Math.min(totalOfContract, 100).toFixed(1) + '%');

    // ── Staff card mirrors (same data, card style matching Expenses module) ──
    setText('staffOvTotalVal',   _mvpFmt(totalSpent));
    setText('staffOvMatVal',     _mvpFmt(matCost));
    setText('staffOvLabVal',     _mvpFmt(labCost));
    setText('staffOvCoverVal',   coverCost > 0 ? _mvpFmt(coverCost) : '—');
    setText('staffOvCoverSub',   presProjs.length + ' month' + (presProjs.length !== 1 ? 's' : '') + ' covered');
    setText('staffOvCoverPct',   coverOfContract.toFixed(1) + '%');
    setText('staffOvMatCardVal', _mvpFmt(matCost));
    setText('staffOvMatPct',     matPct.toFixed(1) + '%');
    setText('staffOvLabCardVal', _mvpFmt(labCost));
    setText('staffOvLabPct',     labPct.toFixed(1) + '%');
    var staffCoverBadge = document.getElementById('staffOvCoverBadge');
    if (staffCoverBadge) {
        var scLbl, scCls;
        if (coverCost <= 0)              { scLbl = 'NONE';    scCls = 'mvp-health-badge mvp-health-healthy'; }
        else if (coverOfContract >= 5)   { scLbl = 'BAD';     scCls = 'mvp-health-badge mvp-health-danger'; }
        else if (coverOfContract >= 2)   { scLbl = 'WARNING'; scCls = 'mvp-health-badge mvp-health-warning'; }
        else                             { scLbl = 'HEALTHY'; scCls = 'mvp-health-badge mvp-health-healthy'; }
        staffCoverBadge.className   = scCls;
        staffCoverBadge.textContent = scLbl;
    }

    // ── Row 3: Percentage KPI cards
    var rcvPct  = contract > 0 ? ((contract - budgetRcv) / contract) * 100 : 0;
    var remBPct = contract > 0 ? ((contract - totalSpent) / contract) * 100 : 0;
    var rcvColor  = rcvPct  < 0 ? '#dc2626' : '#0891b2';
    var remBColor = remBPct < 0 ? '#dc2626' : '#059669';
    setText('mvpOvKpiRcvPctVal',  rcvPct.toFixed(1)  + '%');
    setText('mvpOvKpiRcvPctAmt',  _mvpFmt(Math.abs(contract - budgetRcv)));
    setText('mvpOvKpiRcvPctSub',  'of contract remaining to bill');
    setStyle('mvpOvKpiRcvPctBar',  'width',      Math.min(Math.abs(rcvPct), 100).toFixed(1) + '%');
    setStyle('mvpOvKpiRcvPctBar',  'background', rcvColor);
    setText('mvpOvKpiRemPctVal',  remBPct.toFixed(1) + '%');
    setText('mvpOvKpiRemPctAmt',  _mvpFmt(Math.abs(contract - totalSpent)));
    setText('mvpOvKpiRemPctSub',  'of contract remaining');
    setStyle('mvpOvKpiRemPctBar',  'width',      Math.min(Math.abs(remBPct), 100).toFixed(1) + '%');
    setStyle('mvpOvKpiRemPctBar',  'background', remBColor);

    // ── Variance card
    var varEl = document.getElementById('mvpOvVarianceAmt');
    if (varEl) {
        varEl.textContent = _mvpFmt(Math.abs(remaining));
        var amtEl = varEl.closest('.ov-variance-amount');
        if (amtEl) amtEl.classList.toggle('is-negative', remaining < 0);
    }
    setText('mvpOvUtilizedPct', spentPct.toFixed(1) + '%');

    // Stacked bar
    var remBarPct = Math.max(0, remPct);
    setStyle('mvpOvStackMat', 'width', matPct.toFixed(2) + '%');
    setStyle('mvpOvStackLab', 'width', labPct.toFixed(2) + '%');
    setStyle('mvpOvStackRem', 'width', remBarPct.toFixed(2) + '%');
    setText('mvpOvLegMat', matPct.toFixed(1) + '%');
    setText('mvpOvLegLab', labPct.toFixed(1) + '%');
    setText('mvpOvLegRem', remBarPct.toFixed(1) + '%');

    // Billing periods
    mvpRenderOvBillingPeriods(fid);

}

function mvpRenderOvBillingPeriods(folderId) {
    var grid = document.getElementById('mvpOvPeriodGrid');
    if (!grid) return;
    var fid    = folderId || _mvpOvCurrentFolderId;
    var fProjs = expProjects.filter(function(p) { return p.folderId === fid; });

    setText('mvpOvPeriodCount', fProjs.length + ' period' + (fProjs.length !== 1 ? 's' : ''));

    if (!fProjs.length) {
        grid.innerHTML = '<div class="bo-empty bo-empty-compact">'
            + '<h3 class="bo-empty-title">No billing periods yet</h3>'
            + '<p class="bo-empty-sub">Add a billing period to start tracking expenses.</p>'
            + '</div>';
        return;
    }

    function fmtD(n) {
        return '₱ ' + (n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    grid.innerHTML = fProjs.map(function(proj) {
        var pid      = proj.id;
        var pName    = (proj.month || '') + ' ' + (proj.year || '');
        var budget   = parseFloat(proj.monthlyBudget) || 0;
        var matCost  = expExpenses.filter(function(e) { return e.projectId === pid; })
                           .reduce(function(s, e) { return s + (parseFloat(e.amount) || 0); }, 0);
        var labCost  = expPayroll.filter(function(p) { return p.projectId === pid; })
                           .reduce(function(s, p) { return s + (parseFloat(p.totalSalary) || 0); }, 0);
        var totalCost  = matCost + labCost;
        var noBudget   = budget <= 0;
        var remain     = budget - totalCost;
        var spentPct   = budget > 0 ? Math.min((totalCost / budget) * 100, 100) : (totalCost > 0 ? 100 : 0);
        var remPct     = 100 - spentPct;
        var hClass, hLabel;
        if (noBudget) {
            if (totalCost > 0) { hClass = 'mvp-health-warning'; hLabel = 'NO BUDGET'; }
            else               { hClass = 'mvp-health-healthy';  hLabel = 'EMPTY'; }
        } else {
            hClass = _mvpHealthClass(remPct);
            hLabel = _mvpHealthLabel(remPct);
        }
        var barClr = noBudget ? (totalCost > 0 ? '#A86B00' : '#E8E2D9')
                              : (remPct < 0 ? '#c0392b' : remPct < 20 ? '#A86B00' : '#1A5C3A');
        var remClass = remain >= 0 ? 'bo-fld-stat-accent' : 'bo-fld-stat-warn';
        var expCount   = expExpenses.filter(function(e) { return e.projectId === pid; }).length;
        var payCount   = expPayroll.filter(function(p)  { return p.projectId === pid; }).length;
        var entriesTxt = expCount + ' expense' + (expCount !== 1 ? 's' : '') + ' · ' + payCount + ' payroll entr' + (payCount !== 1 ? 'ies' : 'y');
        var fundingLabels = { mobilization:'Mobilization', downpayment:'Downpayment',
            progress:'Progress Billing', final:'Final Payment', president:'Cover Expenses' };
        var fundingLabel = fundingLabels[proj.fundingType] || 'Billing Period';
        var pctTxt = noBudget ? (totalCost > 0 ? fmtD(totalCost) + ' spent' : 'No entries') : spentPct.toFixed(1) + '% used';

        return '<div class="bo-period-card">'
            + '<div class="bo-period-card-head">'
            +   '<div class="bo-period-card-title">'
            +     '<div class="bo-period-card-name">' + _mvpEsc(pName.trim()) + '</div>'
            +     '<div class="bo-period-card-funding">' + fundingLabel + '</div>'
            +   '</div>'
            +   '<div class="bo-fld-card-actions">'
            +     '<button class="bo-icon-btn" onclick="openEditProjectModal(\'' + pid + '\')" title="Edit period">'
            +       '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
            +     '</button>'
            +     '<button class="bo-icon-btn bo-icon-btn-danger" onclick="confirmDeleteProject(\'' + pid + '\')" title="Delete period">'
            +       '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>'
            +     '</button>'
            +   '</div>'
            + '</div>'
            + '<div class="bo-fld-card-stats">'
            +   '<div class="bo-fld-stat"><span class="lbl">Period Budget</span><span class="val">' + (noBudget ? '<em style="color:#A1A1A6;font-style:normal;font-size:12px">Not set</em>' : fmtD(budget)) + '</span></div>'
            +   '<div class="bo-fld-stat"><span class="lbl">Materials</span><span class="val">' + fmtD(matCost) + '</span></div>'
            +   '<div class="bo-fld-stat"><span class="lbl">Labor</span><span class="val">' + fmtD(labCost) + '</span></div>'
            +   '<div class="bo-fld-stat"><span class="lbl">Current Fund Spent</span><span class="val bo-fld-stat-accent">' + fmtD(totalCost) + '</span></div>'
            +   (!noBudget ? '<div class="bo-fld-stat"><span class="lbl">Remaining</span><span class="val ' + remClass + '">' + fmtD(remain) + '</span></div>' : '')
            + '</div>'
            + '<div class="bo-fld-card-health">'
            +   '<span class="mvp-health-badge ' + hClass + '">' + hLabel + '</span>'
            +   '<span class="bo-fld-card-pct">' + pctTxt + '</span>'
            + '</div>'
            + '<div class="bo-fld-card-progress"><div class="bo-fld-card-progress-fill" style="width:' + spentPct.toFixed(1) + '%;background:' + barClr + '"></div></div>'
            + '<div class="bo-fld-card-meta">' + entriesTxt + '</div>'
            + '</div>';
    }).join('');
}

// ─── (Client Payments Panel removed) ──────────────────────────────────────────

async function _ovRenderPayments(folder) {
    var listEl = document.getElementById('mvpOvPaymentList');
    if (!listEl) return;

    var clientEmail = folder ? folder.clientEmail : null;

    if (!clientEmail) {
        listEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:16px 0;">No client assigned to this project folder.</div>';
        return;
    }

    listEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:16px 0;">Loading…</div>';

    try {
        var snap = await db.collection('paymentRequests')
            .where('clientEmail', '==', clientEmail)
            .get();

        var docs = snap.docs.slice().sort(function(a, b) {
            var at = a.data().createdAt, bt = b.data().createdAt;
            var am = at ? (at.seconds || 0) : 0, bm = bt ? (bt.seconds || 0) : 0;
            return bm - am;
        });

        if (snap.empty) {
            listEl.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:20px 0;text-align:center;">No payment requests yet. Click <strong>Add Payment</strong> to create one.</div>';
            return;
        }

        var statusMap = {
            pending:         { label: 'Pending',        bg: '#fffbeb', color: '#d97706' },
            submitted:       { label: 'Under Review',   bg: '#eff6ff', color: '#1d4ed8' },
            partial_pending: { label: 'Partial Pending', bg: '#ffedd5', color: '#c2410c' },
            partial_approved:{ label: 'Partial Approved', bg: '#ecfdf5', color: '#059669' },
            verified:        { label: 'Paid',           bg: '#d1fae5', color: '#065f46' },
            rejected:        { label: 'Rejected',       bg: '#fee2e2', color: '#b91c1c' },
        };

        function _fmtTs(ts) {
            if (!ts) return '—';
            var d = ts.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
            return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        function _fmtAmt(n) {
            return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        var rows = docs.map(function(doc) {
            var r  = doc.data();
            var st = statusMap[r.status] || { label: r.status, bg: '#f3f4f6', color: '#6b7280' };
            return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f3f4f6;">'
                + '<div style="flex:1;min-width:0;">'
                +   '<div style="font-size:13.5px;font-weight:600;color:#111827;">' + (r.billingPeriod || r.description || '—') + '</div>'
                +   '<div style="font-size:12px;color:#6b7280;margin-top:2px;">' + (r.projectName || '') + (r.projectName && r.createdAt ? ' · ' : '') + _fmtTs(r.createdAt) + '</div>'
                + '</div>'
                + '<div style="text-align:right;white-space:nowrap;">'
                +   '<div style="font-size:13.5px;font-weight:700;color:#111827;">' + _fmtAmt(r.amount) + '</div>'
                +   '<span style="display:inline-block;margin-top:3px;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;background:' + st.bg + ';color:' + st.color + ';">' + st.label + '</span>'
                + '</div>'
                + '</div>';
        }).join('');

        listEl.innerHTML = '<div style="padding:0 2px;">' + rows + '</div>';

    } catch (e) {
        listEl.innerHTML = '<div style="color:#b91c1c;font-size:13px;padding:16px 0;">Could not load payments: ' + e.message + '</div>';
    }
}

// ─── Billing Period Detail Modal ─────────────────────────────────────────────
var _pdDonutChart = null;
var _pdBarChart   = null;

function mvpOvOpenPeriodDetail(_folderId, projectId) {
    var modal = document.getElementById('mvpPeriodDetailModal');
    if (!modal) return;

    var proj = expProjects.find(function(p) { return p.id === projectId; });
    if (!proj) return;

    var budget   = parseFloat(proj.monthlyBudget) || 0;
    var pName    = ((proj.month || '') + ' ' + (proj.year || '')).trim();
    var projExps = expExpenses.filter(function(e) { return e.projectId === projectId; });
    var projPay  = expPayroll.filter(function(p)  { return p.projectId === projectId; });
    var matTotal = projExps.reduce(function(s,e) { return s + (parseFloat(e.amount)||0); }, 0);
    var labTotal = projPay.reduce(function(s,p)  { return s + (parseFloat(p.totalSalary)||0); }, 0);
    var total    = matTotal + labTotal;
    var remain   = budget - total;
    var usedPct  = budget > 0 ? (total / budget) * 100 : 0;

    function fmtM(n) {
        return '₱' + (n||0).toLocaleString('en-PH', {minimumFractionDigits:2, maximumFractionDigits:2});
    }

    // Header
    document.getElementById('pdTitle').textContent      = pName || '—';
    document.getElementById('pdBudgetAmt').textContent  = fmtM(budget);

    // Colour header based on health
    var hdr = document.getElementById('pdHeader');
    hdr.style.background = usedPct > 100 ? '#7f1d1d' : usedPct > 80 ? '#78350f' : '#1a4731';

    // KPI Badges
    var remCls  = remain < 0 ? 'pd-kpi--remaining' : 'pd-kpi--remaining positive';
    var usedCls = usedPct > 100 ? 'pd-kpi--used' : 'pd-kpi--used good';
    document.getElementById('pdKpiRow').innerHTML =
        '<div class="pd-kpi-badge pd-kpi--expenses"><div class="pd-kpi-badge__label">Expenses</div><div class="pd-kpi-badge__value">' + fmtM(matTotal) + '</div></div>'
      + '<div class="pd-kpi-badge pd-kpi--payroll"><div class="pd-kpi-badge__label">Payroll</div><div class="pd-kpi-badge__value">' + fmtM(labTotal) + '</div></div>'
      + '<div class="pd-kpi-badge pd-kpi--total"><div class="pd-kpi-badge__label">Current Fund Spent</div><div class="pd-kpi-badge__value">' + fmtM(total) + '</div></div>'
      + '<div class="pd-kpi-badge ' + remCls + '"><div class="pd-kpi-badge__label">Remaining</div><div class="pd-kpi-badge__value">' + fmtM(remain) + '</div></div>'
      + '<div class="pd-kpi-badge ' + usedCls + '"><div class="pd-kpi-badge__label">Used %</div><div class="pd-kpi-badge__value">' + usedPct.toFixed(1) + '%</div></div>';

    // Utilization bar
    var remPct = 100 - usedPct;
    document.getElementById('pdUtilPct').textContent = remPct.toFixed(1) + '% remaining';
    var fillPct = Math.min(usedPct, 100);
    var fillClr = usedPct > 100 ? '#ef4444' : usedPct > 80 ? '#f97316' : usedPct > 60 ? '#f59e0b' : '#10b981';
    var fill = document.getElementById('pdUtilFill');
    fill.style.width      = fillPct + '%';
    fill.style.background = fillClr;

    // ── Charts ──────────────────────────────────────────────────────────────
    // Destroy old charts
    if (_pdDonutChart) { _pdDonutChart.destroy(); _pdDonutChart = null; }
    if (_pdBarChart)   { _pdBarChart.destroy();   _pdBarChart   = null; }

    // Category Breakdown (donut)
    var catMap = {};
    projExps.forEach(function(e) {
        var cat = e.category || 'Uncategorized';
        catMap[cat] = (catMap[cat] || 0) + (parseFloat(e.amount) || 0);
    });
    if (labTotal > 0) catMap['Payroll'] = labTotal;

    var catLabels = Object.keys(catMap);
    var catVals   = catLabels.map(function(k) { return catMap[k]; });
    var palette   = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#84cc16','#6366f1'];
    var catColors = catLabels.map(function(_, i) { return palette[i % palette.length]; });

    var donutCtx = document.getElementById('pdDonutChart').getContext('2d');
    if (catVals.length === 0) catLabels = ['No data'], catVals = [1], catColors = ['#e5e7eb'];
    _pdDonutChart = new Chart(donutCtx, {
        type: 'doughnut',
        data: { labels: catLabels, datasets: [{ data: catVals, backgroundColor: catColors, borderWidth: 2, borderColor: '#fff' }] },
        options: {
            cutout: '62%', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: {
                label: function(ctx) { return ' ' + fmtM(ctx.raw); }
            }}}
        }
    });
    // Legend
    var legend = document.getElementById('pdDonutLegend');
    legend.innerHTML = catLabels.map(function(lbl, i) {
        return '<div class="pd-legend-item"><div class="pd-legend-dot" style="background:' + catColors[i] + '"></div><span>' + _mvpEsc(lbl) + '</span></div>';
    }).join('');

    // Budget vs Actual (bar)
    var barCtx = document.getElementById('pdBarChart').getContext('2d');
    _pdBarChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: ['Budget', 'Expenses', 'Payroll', 'Total'],
            datasets: [{
                label: '₱',
                data: [budget, matTotal, labTotal, total],
                backgroundColor: ['#3b82f6','#f97316','#ef4444', total > budget ? '#ef4444' : '#10b981'],
                borderRadius: 6, borderSkipped: false
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: {
                label: function(ctx) { return ' ' + fmtM(ctx.raw); }
            }}},
            scales: {
                y: { ticks: { callback: function(v) { return '₱' + (v/1000).toFixed(0) + 'k'; } }, grid: { color: '#f3f4f6' } },
                x: { grid: { display: false } }
            }
        }
    });

    // ── Grouped Expenses Table — grouped by category (payment method) ────────
    var expSection = document.getElementById('pdExpensesSection');
    if (!projExps.length) {
        expSection.innerHTML = '<div class="pd-empty">No expenses for this period.</div>';
    } else {
        // Group by category (which stores the payment method: Cash, GCash, Bank, Lalamove…)
        var groups = {};
        projExps.forEach(function(e) {
            var grp = (e.category || 'Uncategorized').toUpperCase();
            if (!groups[grp]) groups[grp] = [];
            groups[grp].push(e);
        });
        var grpColors = ['#1d4ed8','#065f46','#7c3aed','#b45309','#b91c1c','#0f766e','#1e3a5f'];
        var gi = 0;
        var html = '';
        Object.keys(groups).forEach(function(grp) {
            var items  = groups[grp];
            var subttl = items.reduce(function(s,e) { return s+(parseFloat(e.amount)||0); }, 0);
            var clr    = grpColors[gi % grpColors.length]; gi++;
            html += '<div class="pd-group-header" style="background:' + clr + '">'
                  +   '<span>' + _mvpEsc(grp) + ' <small style="opacity:.7;font-weight:400">(' + items.length + ' item' + (items.length!==1?'s':'') + ')</small></span>'
                  +   '<span>Subtotal: ' + fmtM(subttl) + '</span>'
                  + '</div>'
                  + '<table class="pd-group-table"><thead><tr>'
                  +   '<th>#</th><th>Item Name</th><th>Qty</th><th>Date</th><th style="text-align:right">Amount</th>'
                  + '</tr></thead><tbody>';
            items.forEach(function(e, idx) {
                var dt = e.dateTime ? e.dateTime.split('T')[0] : (e.date || '—');
                html += '<tr>'
                      + '<td>' + (idx+1) + '</td>'
                      + '<td>' + _mvpEsc(e.expenseName || '—') + '</td>'
                      + '<td>' + (e.quantity || 1) + '</td>'
                      + '<td>' + _mvpEsc(dt) + '</td>'
                      + '<td style="text-align:right;font-weight:600">' + fmtM(parseFloat(e.amount)||0) + '</td>'
                      + '</tr>';
            });
            html += '<tr class="pd-group-subtotal"><td colspan="4">Subtotal</td><td style="text-align:right">' + fmtM(subttl) + '</td></tr>';
            html += '</tbody></table>';
        });
        expSection.innerHTML = html;
    }

    // ── Payroll Table ───────────────────────────────────────────────────────
    var paySection = document.getElementById('pdPayrollSection');
    if (!projPay.length) {
        paySection.innerHTML = '<div class="pd-empty">No payroll entries for this period.</div>';
    } else {
        var pHtml = '<table class="pd-payroll-table"><thead><tr>'
                  + '<th>#</th><th>Worker</th><th>Role</th><th>Days</th><th>Daily Rate</th><th style="text-align:right">Total</th>'
                  + '</tr></thead><tbody>';
        projPay.forEach(function(p, idx) {
            pHtml += '<tr>'
                   + '<td>' + (idx+1) + '</td>'
                   + '<td>' + _mvpEsc(p.workerName || '—') + '</td>'
                   + '<td>' + _mvpEsc(p.role || '—') + '</td>'
                   + '<td>' + (p.daysWorked || 0) + '</td>'
                   + '<td>' + fmtM(parseFloat(p.dailyRate)||0) + '</td>'
                   + '<td style="text-align:right;font-weight:600">' + fmtM(parseFloat(p.totalSalary)||0) + '</td>'
                   + '</tr>';
        });
        pHtml += '<tr class="pd-group-subtotal"><td colspan="5">Total Payroll</td><td style="text-align:right">' + fmtM(labTotal) + '</td></tr>';
        pHtml += '</tbody></table>';
        paySection.innerHTML = pHtml;
    }

    // Show modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function mvpClosePeriodDetail(e) {
    if (e && e.target !== document.getElementById('mvpPeriodDetailModal')) return;
    var modal = document.getElementById('mvpPeriodDetailModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    if (_pdDonutChart) { _pdDonutChart.destroy(); _pdDonutChart = null; }
    if (_pdBarChart)   { _pdBarChart.destroy();   _pdBarChart   = null; }
}

// ═══════════════════════════════════════════════════════════
// MVP PAYROLL VIEW — 3-state navigation
// ═══════════════════════════════════════════════════════════
var _mvpPayCurrentFolderId  = null;
var _mvpPayCurrentProjectId = null;

function mvpPayNavigate(state, folderId) {
    var s1 = document.getElementById('mvpPayFolderState');
    var s2 = document.getElementById('mvpPayProjectState');
    var s3 = document.getElementById('mvpPayDetailState');
    if (!s1) return;
    s1.style.display = 'none';
    if (s2) s2.style.display = 'none';
    s3.style.display = 'none';

    if (state === 'folders') {
        s1.style.display = '';
        mvpPayRenderFolderGrid();
    } else if (state === 'detail') {
        _mvpPayCurrentFolderId  = folderId || null;
        _mvpPayCurrentProjectId = null; // folder-level: all periods
        s3.style.display = '';
        // Breadcrumb
        var folder = expFolders.find(function(f) { return f.id === folderId; });
        var bf2 = document.getElementById('mvpPayBreadFolder2');
        if (bf2) bf2.textContent = folder ? folder.name : 'Folder';
        // Badge showing folder name + all months
        var badge = document.getElementById('mvpPayFolderBadge');
        if (badge) badge.textContent = (folder ? folder.name : 'Folder') + ' \u2014 All Months';
        mvpPayRenderTable();
    }
}

function mvpPayRenderFolderGrid() {
    var grid = document.getElementById('mvpPayFolderGrid');
    if (!grid) return;

    if (!expFolders.length) {
        grid.innerHTML = '<div class="mvp-empty-state">'
            + '<svg viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" width="52" height="52"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
            + '<p style="color:#9ca3af;margin-top:0.75rem;font-size:0.9rem;">No project folders yet.</p>'
            + '</div>';
        return;
    }

    grid.innerHTML = expFolders.map(function(folder) {
        var fProjs    = expProjects.filter(function(p) { return p.folderId === folder.id; });
        var totalPay  = fProjs.reduce(function(s, p) {
            return s + _ovAllPayroll.filter(function(x) { return x.projectId === p.id; })
                .reduce(function(s2, x) { return s2 + (parseFloat(x.totalSalary) || 0); }, 0);
        }, 0);
        // unique workers
        var workerSet = {};
        _ovAllPayroll.filter(function(x) {
            return fProjs.some(function(p) { return p.id === x.projectId; });
        }).forEach(function(x) { if (x.workerName) workerSet[x.workerName] = 1; });
        var workerCount = Object.keys(workerSet).length;
        var fid = folder.id;

        return '<div class="mvp-folder-card">'
            + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.25rem;">'
            +   '<div style="font-size:1.0625rem;font-weight:700;color:#111827;">' + _mvpEsc(folder.name || 'Unnamed') + '</div>'
            + '</div>'
            + '<div style="font-size:0.8125rem;color:#9ca3af;margin-bottom:1rem;">' + _mvpEsc(folder.description || 'No description') + '</div>'
            + '<div style="display:flex;flex-direction:column;gap:0;">'
            +   '<div style="display:flex;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid #f3f4f6;font-size:0.85rem;">'
            +     '<span style="color:#6b7280;">Total Payroll</span>'
            +     '<span style="font-weight:700;color:#111827;">&#8369;' + _fmtD(totalPay) + '</span>'
            +   '</div>'
            +   '<div style="display:flex;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid #f3f4f6;font-size:0.85rem;">'
            +     '<span style="color:#6b7280;">Billing Periods</span>'
            +     '<span style="font-weight:600;color:#374151;">' + fProjs.length + '</span>'
            +   '</div>'
            +   '<div style="display:flex;justify-content:space-between;padding:0.35rem 0;font-size:0.85rem;">'
            +     '<span style="color:#6b7280;">Workers</span>'
            +     '<span style="font-weight:600;color:#374151;">' + workerCount + '</span>'
            +   '</div>'
            + '</div>'
            + '<button class="ov-folder-card__view-btn" style="margin-top:1.1rem;" onclick="mvpPayNavigate(\'detail\',\'' + fid + '\')">'
            +   'Open &rarr;'
            + '</button>'
            + '</div>';
    }).join('');
}

function mvpPayRenderProjectGrid(folderId) {
    var grid = document.getElementById('mvpPayProjectGrid');
    var bf   = document.getElementById('mvpPayBreadFolder');
    var folder = expFolders.find(function(f) { return f.id === folderId; });
    if (bf) bf.textContent = folder ? folder.name : 'Folder';
    if (!grid) return;

    var fProjs = expProjects.filter(function(p) { return p.folderId === folderId; });
    if (!fProjs.length) {
        grid.innerHTML = '<div class="mvp-empty-state"><p style="color:#9ca3af;">No billing periods in this folder.</p></div>';
        return;
    }

    grid.innerHTML = fProjs.map(function(p) {
        var payTotal = _ovAllPayroll.filter(function(x) { return x.projectId === p.id; })
            .reduce(function(s, x) { return s + (parseFloat(x.totalSalary) || 0); }, 0);
        var entries  = _ovAllPayroll.filter(function(x) { return x.projectId === p.id; }).length;
        var workerSet = {};
        _ovAllPayroll.filter(function(x) { return x.projectId === p.id; })
            .forEach(function(x) { if (x.workerName) workerSet[x.workerName] = 1; });
        var workers = Object.keys(workerSet).length;
        var label   = (p.month || '') + ' ' + (p.year || '');
        var pid = p.id;
        var fid = folderId;

        return '<div class="mvp-project-card">'
            + '<div style="font-size:1rem;font-weight:700;color:#111827;margin-bottom:0.15rem;">' + _mvpEsc(label) + '</div>'
            + '<div style="font-size:0.8rem;color:#9ca3af;margin-bottom:0.85rem;">' + _mvpEsc(p.name || folder ? (folder.name || '') : '') + '</div>'
            + '<div style="font-size:1.3rem;font-weight:800;color:#111827;margin-bottom:0.2rem;">&#8369;' + _fmtD(payTotal) + '</div>'
            + '<div style="font-size:0.8rem;color:#6b7280;margin-bottom:0.85rem;">' + workers + ' worker' + (workers !== 1 ? 's' : '') + ' &bull; ' + entries + ' entr' + (entries !== 1 ? 'ies' : 'y') + '</div>'
            + '<button class="ov-folder-card__view-btn" onclick="mvpPayNavigate(\'detail\',\'' + fid + '\',\'' + pid + '\')">'
            +   'View Payroll &rarr;'
            + '</button>'
            + '</div>';
    }).join('');
}

function mvpPayRenderTable() {
    var tbody = document.getElementById('mvpPayTbody');
    if (!tbody) return;

    var search = (document.getElementById('mvpPaySearchInput') || {}).value || '';
    // Use global cache filtered to current project
    // Show all payroll for the current folder (all billing periods combined)
    var folderProjectIds = expProjects
        .filter(function(p) { return p.folderId === _mvpPayCurrentFolderId; })
        .map(function(p) { return p.id; });
    var rows = _ovAllPayroll.filter(function(x) { return folderProjectIds.indexOf(x.projectId) !== -1; });

    if (search) {
        rows = rows.filter(function(r) {
            return (r.workerName || '').toLowerCase().includes(search.toLowerCase());
        });
    }

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="exp-empty-row">'
            + (search ? 'No workers match your search.' : 'No payroll entries yet. Click + Add Payroll Entry.')
            + '</td></tr>';
        return;
    }

    var grandTotal = rows.reduce(function(s, r) { return s + (parseFloat(r.totalSalary) || 0); }, 0);

    tbody.innerHTML = rows.map(function(r) {
        return '<tr>'
            + '<td>' + (typeof formatDate === 'function' ? formatDate(r.paymentDate) : (r.paymentDate || '—')) + '</td>'
            + '<td><strong>' + _mvpEsc(r.workerName || '—') + '</strong></td>'
            + '<td>' + _mvpEsc(r.role || '—') + '</td>'
            + '<td class="exp-notes-cell">' + (r.notes ? '<span class="exp-notes-text">' + _mvpEsc(r.notes) + '</span>' : '<span class="exp-notes-empty">—</span>') + '</td>'
            + '<td>' + (r.daysWorked || 0) + '</td>'
            + '<td>&#8369;' + (typeof formatNum === 'function' ? formatNum(r.dailyRate) : (r.dailyRate || 0)) + '</td>'
            + '<td>&#8369;' + (typeof formatNum === 'function' ? formatNum(r.totalSalary) : (r.totalSalary || 0)) + '</td>'
            + '<td>' + (typeof getReceiptThumbsHTML === 'function' ? getReceiptThumbsHTML(r) : '—') + '</td>'
            + '<td class="exp-action-cell">'
            +   '<button class="exp-icon-btn exp-icon-btn-edit" title="Edit" onclick="openEditPayrollModal(\'' + r.id + '\')"><i data-lucide="pencil"></i></button>'
            +   '<button class="exp-icon-btn exp-icon-btn-danger" title="Delete" onclick="deletePayroll(\'' + r.id + '\')"><i data-lucide="trash-2"></i></button>'
            + '</td>'
            + '</tr>';
    }).join('') + '<tr class="exp-total-row">'
        + '<td colspan="6"></td>'
        + '<td class="exp-total-label">TOTAL</td>'
        + '<td class="exp-total-value">&#8369;' + (typeof formatNum === 'function' ? formatNum(grandTotal) : grandTotal.toFixed(2)) + '</td>'
        + '<td></td>'
        + '</tr>';

    if (window.lucide) lucide.createIcons();
}

function mvpPayApplySearch() {
    mvpPayRenderTable();
}

// Helper: format number with 2 decimals (reuse fmtD pattern)
function _fmtD(n) {
    n = parseFloat(n) || 0;
    return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Missing alias functions ───────────────────────────────────

function confirmDeleteFolder(id) { deleteFolder(id); }
function confirmDeleteProject(id) { deleteProject(id); }

// Opens the "Move to Folder" modal for a given project
function openMoveToFolderModal(projectId) {
    var project = expProjects.find(function(p) { return p.id === projectId; });
    if (!project) return;
    var label = document.getElementById('moveProjectLabel');
    if (label) label.textContent = project.name || projectId;
    var select = document.getElementById('moveFolderSelect');
    if (select) {
        select.innerHTML = '<option value="">— Select folder —</option>'
            + expFolders.map(function(f) {
                return '<option value="' + f.id + '">' + (f.name || f.id) + '</option>';
            }).join('');
    }
    var form = document.getElementById('moveToFolderForm');
    if (form) form.dataset.projectId = projectId;
    var modal = document.getElementById('moveToFolderModal');
    if (modal) modal.style.display = 'flex';
}

// Handles form submission for moving a project to a folder
async function handleMoveToFolder(e) {
    e.preventDefault();
    var form = document.getElementById('moveToFolderForm');
    var projectId = form && form.dataset.projectId;
    var folderId = document.getElementById('moveFolderSelect').value;
    if (!projectId || !folderId) return;
    try {
        await db.collection('projects').doc(projectId).update({ folderId: folderId });
        closeExpModal('moveToFolderModal');
    } catch (err) {
        console.error('Error moving project to folder:', err);
        alert('Error moving project. Please try again.');
    }
}

window.confirmDeleteFolder    = confirmDeleteFolder;
window.confirmDeleteProject   = confirmDeleteProject;
window.openMoveToFolderModal  = openMoveToFolderModal;
window.handleMoveToFolder     = handleMoveToFolder;

console.log('✅ MVP Navigation Module Loaded');

// ════════════════════════════════════════════════════════════
// LABOR CONTRACTS (PAKYAW / IN-HOUSE CAPPED PAY)
// A capped agreement (worker + scope + agreed amount) on a folder. Payroll rows
// draw it down via payroll.contractId. Admin-only; rides on the payroll pipeline.
// Drawdown math reads expPayroll (folder-wide), so paid/remaining stay live.
// ════════════════════════════════════════════════════════════
let expLaborContracts = [];
let _lcPortalFolderId = null;   // set by the React Project Control portal (see lcSyncFromPortal)

// The folder currently in view (React portal, folder view, or a period inside a folder).
function lcActiveFolderId() {
    return _lcPortalFolderId
        || _mvpCurrentFolderId
        || (expCurrentFolder && expCurrentFolder.id)
        || (expCurrentProject && expCurrentProject.folderId)
        || null;
}

// Bridge for the React Project Control portal (portal-app.compiled.js): it owns its
// own data pipeline, so it pushes the active folder's contracts + folder-wide payroll
// in here. This lets the shared contract modal / save / picker / over-cap functions
// work identically whether opened from the React portal or the legacy Expenses screen.
window.lcSyncFromPortal = function(folderId, contracts, payroll) {
    _lcPortalFolderId = folderId || null;
    expLaborContracts = Array.isArray(contracts) ? contracts : [];
    if (Array.isArray(payroll)) expPayroll = payroll;   // raw payroll docs (have totalSalary + contractId)
    if (typeof lcPopulatePayrollPicker === 'function') lcPopulatePayrollPicker();
    // Contract roles feed the expense Category dropdown — rebuild it now that the
    // active folder's contracts are known.
    if (typeof refreshCategoryDropdown === 'function') refreshCategoryDropdown();
    if (typeof populateExpSearchCategories === 'function') populateExpSearchCategories();
};

// Subscribe to the active folder's contracts (called from subscribeFolderData).
function subscribeLaborContracts(folderId) {
    if (!currentUser || !folderId) { expLaborContracts = []; return; }
    const unsub = db.collection('laborContracts')
        .where('folderId', '==', folderId)
        .where('userId', '==', _uid())
        .onSnapshot(snap => {
            expLaborContracts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.workerName || '').localeCompare(b.workerName || '')
                             || (a.scope || '').localeCompare(b.scope || ''));
            lcPopulatePayrollPicker();
            // Roles drive the expense Category dropdown; this is a live listener, so
            // adding a contract makes its job selectable without a reload.
            refreshCategoryDropdown();
            populateExpSearchCategories();
        }, err => console.error('laborContracts listener:', err));
    expUnsubscribers.push(unsub);
}

// ── Drawdown math ──────────────────────────────────────────
// Overhead / indirect pay (coordination, site supervision, procurement) is a
// company cost, NOT progress against the worker's agreed pakyaw amount — so it
// never draws down a contract, even if an old row still carries a contractId.
function lcDrawsDown(p) { return p.laborType !== 'indirect'; }
// Paid-to-date = sum of every payroll row linked to the contract (splits included).
function lcPaid(contractId, excludeRowId) {
    if (!contractId) return 0;
    return expPayroll
        .filter(p => p.contractId === contractId && p.id !== excludeRowId && lcDrawsDown(p))
        .reduce((s, p) => s + (parseFloat(p.totalSalary) || 0), 0);
}
function lcStats(c) {
    const agreed = parseFloat(c.agreedAmount) || 0;
    const paid = lcPaid(c.id);
    const remaining = agreed - paid;
    const pct = agreed > 0 ? (paid / agreed) * 100 : 0;
    let status = 'Ongoing';
    if (agreed > 0 && paid >= agreed) status = paid > agreed ? 'Over' : 'Completed';
    return { agreed, paid, remaining, pct, status };
}
// Worker names seen on this folder (payroll + contracts) — for autocomplete.
function lcWorkerNames() {
    const set = new Set();
    expPayroll.forEach(p => { if (p.workerName) set.add(String(p.workerName).trim()); });
    expLaborContracts.forEach(c => { if (c.workerName) set.add(String(c.workerName).trim()); });
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}


// ── Create / edit modal ────────────────────────────────────
function lcFillWorkerDatalist() {
    const names = lcWorkerNames();
    const opts = names.map(n => '<option value="' + _mvpEsc(n) + '">').join('');
    ['lcWorkerNames', 'payWorkerNames', 'editPayWorkerNames'].forEach(id => {
        const dl = document.getElementById(id); if (dl) dl.innerHTML = opts;
    });
}
// ── Worker Agreement (piecework rates + company rules) ─────────────
// Template lives in settings/workerAgreement { text, pdfUrl, pdfName } and is
// signed by the worker on the admin's device when the contract is created.
const LC_AGR_DEFAULT =
`WORKER AGREEMENT — PIECEWORK (PAKYAW) TERMS & COMPANY RULES

1. Scope & Rate. The worker agrees to complete the scope of work stated in this contract for the agreed amount (piecework/pakyaw rate). No additional charges beyond the agreed cap unless approved in writing.

2. Quality of Work. Work must meet the company's quality standards. Rework due to poor workmanship is at the worker's expense.

3. Site Rules. The worker agrees to follow all site safety rules and company regulations, keep the work area safe and orderly, and use protective equipment where required.

4. Schedule. The worker will complete the work within the agreed timeframe and coordinate absences with the site supervisor.

5. Tools & Materials. Unless otherwise stated, the worker provides their own hand tools; materials are supplied by the company and must be used responsibly.

6. Payment. Payments are released against completed work and draw down from the agreed contract amount.

7. Termination. The company may end this contract for violation of these terms; completed work will be assessed and paid accordingly.

By signing, the worker confirms they understood and accept these terms.`;

let _lcAgrTemplate = null;                 // cached { text, pdfUrl, pdfName }

async function lcLoadAgrTemplate(force) {
    if (_lcAgrTemplate && !force) return _lcAgrTemplate;
    try {
        const doc = await db.collection('settings').doc('workerAgreement').get();
        const d = doc && doc.exists ? doc.data() : null;
        _lcAgrTemplate = {
            text  : (d && typeof d.text === 'string' && d.text.trim()) ? d.text : LC_AGR_DEFAULT,
            pdfUrl : (d && d.pdfUrl)  || '',
            pdfName: (d && d.pdfName) || ''
        };
    } catch (_) { _lcAgrTemplate = { text: LC_AGR_DEFAULT, pdfUrl: '', pdfName: '' }; }
    return _lcAgrTemplate;
}

// ── Per-contract signed-agreement PDF upload (no on-screen e-signature) ──
let _lcAgrFile = null, _lcAgrUrl = '', _lcAgrName = '';

function _lcAgrRenderState() {
    const nameEl = document.getElementById('lcAgrPdfName');
    const rmEl   = document.getElementById('lcAgrPdfRemoveBtn');
    const link   = document.getElementById('lcAgrPdfLink');
    if (link) { if (_lcAgrUrl && !_lcAgrFile) { link.href = _lcAgrUrl; link.style.display = ''; } else link.style.display = 'none'; }
    if (!nameEl) return;
    if (_lcAgrFile)     { nameEl.textContent = _lcAgrFile.name + ' (new — will upload on save)'; nameEl.style.color = '#111827'; if (rmEl) rmEl.style.display = ''; }
    else if (_lcAgrUrl) { nameEl.textContent = _lcAgrName || 'Signed agreement attached.'; nameEl.style.color = '#111827'; if (rmEl) rmEl.style.display = ''; }
    else                { nameEl.textContent = 'No PDF attached.'; nameEl.style.color = '#6b7280'; if (rmEl) rmEl.style.display = 'none'; }
}

window.lcAgrPdfPick = function (input) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { alert('Please choose a PDF file.'); input.value = ''; return; }
    _lcAgrFile = f; _lcAgrRenderState();
};
window.lcAgrPdfRemove = function () {
    _lcAgrFile = null; _lcAgrUrl = ''; _lcAgrName = '';
    const input = document.getElementById('lcAgrPdfInput'); if (input) input.value = '';
    _lcAgrRenderState();
};

// Fill the agreement section for a new / existing contract. Shows the worker
// name and the current uploaded signed PDF (if any).
function lcAgrPopulate(contract) {
    _lcAgrFile = null;
    _lcAgrUrl  = (contract && (contract.agreementPdfUrl || '')) || '';
    _lcAgrName = (contract && (contract.agreementPdfName || '')) || '';
    const input = document.getElementById('lcAgrPdfInput'); if (input) input.value = '';
    const wn = document.getElementById('lcAgrWorkerName');
    if (wn) wn.textContent = ((contract && contract.workerName) || (document.getElementById('lcWorker')?.value || '')) || '—';
    const cn = document.getElementById('lcAgrCompanyName');
    if (cn) cn.textContent = (typeof _defaults !== 'undefined' && _defaults && _defaults.businessName) ? _defaults.businessName : "DAC's Building Design Services";
    _lcAgrRenderState();
}

// Keep the worker's printed name live as the admin types it (new contracts).
window.lcAgrSyncWorkerName = function () {
    const wn = document.getElementById('lcAgrWorkerName');
    if (wn) wn.textContent = (document.getElementById('lcWorker')?.value || '') || '—';
};

// ── Agreement template editor (settings/workerAgreement) ──
let _lcTplFile = null, _lcTplUrl = '', _lcTplName = '';

function _lcTplRender() {
    const nameEl = document.getElementById('lc-tpl-pdf-name');
    const rmEl   = document.getElementById('lc-tpl-pdf-remove');
    if (!nameEl) return;
    if (_lcTplFile)     { nameEl.textContent = _lcTplFile.name + ' (new — will upload on save)'; nameEl.style.color = '#111827'; if (rmEl) rmEl.style.display = ''; }
    else if (_lcTplUrl) { nameEl.textContent = _lcTplName || 'Attached PDF'; nameEl.style.color = '#111827'; if (rmEl) rmEl.style.display = ''; }
    else                { nameEl.textContent = 'No PDF attached.'; nameEl.style.color = '#6b7280'; if (rmEl) rmEl.style.display = 'none'; }
}

window.lcTplPickPdf = function (input) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { alert('Please choose a PDF file.'); input.value = ''; return; }
    _lcTplFile = f; _lcTplRender();
};
window.lcTplRemovePdf = function () {
    _lcTplFile = null; _lcTplUrl = ''; _lcTplName = '';
    const input = document.getElementById('lc-tpl-pdf-input'); if (input) input.value = '';
    _lcTplRender();
};

async function lcOpenAgrTemplate() {
    _lcTplFile = null;
    let modal = document.getElementById('lcAgrTemplateModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'lcAgrTemplateModal';
        modal.className = 'exp-modal';
        document.body.appendChild(modal);
    }
    modal.innerHTML =
      '<div class="exp-modal-box">'
      + '<div class="exp-modal-header"><h2>Worker Agreement Template</h2><button class="exp-modal-close" aria-label="Close" onclick="closeExpModal(\'lcAgrTemplateModal\')">&times;</button></div>'
      + '<div style="padding:0 4px;">'
      +   '<div class="exp-form-group"><label>Agreement PDF <span style="color:#9ca3af;font-weight:400;">(optional — the comprehensive agreement form)</span></label>'
      +     '<input type="file" id="lc-tpl-pdf-input" accept="application/pdf,.pdf" onchange="lcTplPickPdf(this)" style="display:none;">'
      +     '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      +       '<button type="button" onclick="document.getElementById(\'lc-tpl-pdf-input\').click()" class="exp-btn exp-btn-secondary" style="padding:8px 14px;">Upload PDF</button>'
      +       '<span id="lc-tpl-pdf-name" style="font-size:12.5px;color:#6b7280;">No PDF attached.</span>'
      +       '<button type="button" id="lc-tpl-pdf-remove" onclick="lcTplRemovePdf()" style="display:none;font-size:12px;font-weight:600;color:#dc2626;background:none;border:none;cursor:pointer;font-family:inherit;">Remove</button>'
      +     '</div></div>'
      +   '<div class="exp-form-group"><label>Agreement text <span style="color:#9ca3af;font-weight:400;">(shown in the contract form; used when no PDF)</span></label>'
      +     '<textarea id="lc-tpl-text" rows="12" style="line-height:1.6;">Loading…</textarea></div>'
      +   '<div class="exp-modal-footer">'
      +     '<button type="button" class="exp-btn exp-btn-secondary" onclick="closeExpModal(\'lcAgrTemplateModal\')">Cancel</button>'
      +     '<button type="button" id="lc-tpl-save" class="exp-btn exp-btn-primary" onclick="lcSaveAgrTemplate()">Save Template</button>'
      +   '</div>'
      + '</div></div>';
    openExpModal('lcAgrTemplateModal');
    const tpl = await lcLoadAgrTemplate(true);
    const ta = document.getElementById('lc-tpl-text'); if (ta) ta.value = tpl.text;
    _lcTplUrl = tpl.pdfUrl; _lcTplName = tpl.pdfName;
    _lcTplRender();
}

async function lcSaveAgrTemplate() {
    const ta   = document.getElementById('lc-tpl-text');
    const text = (ta?.value || '').trim();
    if (!text) { showExpNotif('The agreement text cannot be empty.', 'error'); return; }
    const btn = document.getElementById('lc-tpl-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        let pdfUrl = _lcTplUrl, pdfName = _lcTplName;
        if (_lcTplFile) {
            if (btn) btn.textContent = 'Uploading…';
            const safe = String(_lcTplFile.name || 'agreement.pdf').replace(/[^\w.\-]+/g, '_');
            const ref  = storage.ref('workerAgreementGlobal/' + Date.now() + '_' + safe);
            await ref.put(_lcTplFile);
            pdfUrl  = await ref.getDownloadURL();
            pdfName = _lcTplFile.name || 'Worker Agreement.pdf';
        }
        await db.collection('settings').doc('workerAgreement').set({
            text, pdfUrl: pdfUrl || '', pdfName: pdfName || '', updatedAt: new Date().toISOString()
        });
        _lcAgrTemplate = { text, pdfUrl: pdfUrl || '', pdfName: pdfName || '' };
        closeExpModal('lcAgrTemplateModal');
        showExpNotif('Worker agreement template saved ✓', 'success');
    } catch (err) {
        showExpNotif('Error: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Template'; }
    }
}

// View the worker's agreement. If a signed PDF was uploaded, open it directly
// (that IS the signed document). Otherwise fall back to the generated policy sheet.
async function lcOpenAgreement(id) {
    const c = expLaborContracts.find(x => x.id === id); if (!c) return;
    // Always route through lcViewAgreement: it fills the contract details onto
    // the PDF's "Detalye ng Pakyaw Labor Contract" page. A signed SCAN attached
    // to the contract passes through unchanged (image pages have no text
    // anchors to fill), so nothing is ever drawn over a real signature.
    await lcViewAgreement(c);
}

function lcViewAgreementCurrent() {
    const id = document.getElementById('lcId')?.value;
    const c = expLaborContracts.find(x => x.id === id) ||
              (_lcAgrUrl ? { agreementPdfUrl: _lcAgrUrl } : null);
    if (c) lcViewAgreement(c);
}

// Build + auto-print the Worker Agreement PDF (contract + company policy).
async function lcViewAgreement(c) {
    const esc = _mvpEsc;
    const signed = !!c.agreementSigned;

    // Uploaded policy-manual PDF (settings/workerAgreement): fill its "Detalye
    // ng Pakyaw Labor Contract" page with THIS contract's details — and, when
    // signed, stamp the worker's signature + date on every signature line.
    let _tpl = null;
    try { _tpl = await lcLoadAgrTemplate(); } catch (_) { _tpl = null; }
    // Base document: the contract's own attached PDF (if any) wins over the
    // global template — both get the details stamped onto the form page.
    const _basePdf = c.agreementPdfUrl || (_tpl && _tpl.pdfUrl) || '';
    if (_basePdf && typeof window.dacsWorkerAgreementView === 'function') {
        const folder = (typeof expFolders !== 'undefined' ? expFolders : []).find(f => f.id === c.folderId);
        const projName = folder ? (folder.name || '') + (folder.code ? ' · ' + folder.code : '') : '';
        // Details ONLY — signature lines stay BLANK on every page. The worker
        // signs the printed manual by hand (owner's call: the on-screen signature
        // captured at contract creation must NOT be replicated onto the pages).
        await window.dacsWorkerAgreementView(_basePdf, {
            ref      : 'LC-' + String(c.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase(),
            project  : projName,
            worker   : c.workerName || '',
            scope    : c.scope || '',
            payType  : c.payType === 'inhouse' ? 'In-house' : 'Pakyaw',
            amount   : (Number(c.agreedAmount) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            printedName: c.workerName || ''
        });
        return;
    }

    // Policy text: the snapshot the worker signed, or the current template if unsigned.
    let policy = c.agreementTermsSnapshot || '';
    if (!policy) { try { policy = (await lcLoadAgrTemplate()).text || ''; } catch (_) {} }

    let when = '';
    try {
        const at = c.agreementSignedAt;
        const d = at && at.toDate ? at.toDate() : (at ? new Date(at) : null);
        if (d && !isNaN(d)) when = d.toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });
    } catch (_) {}
    const today = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' });

    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to print the agreement.'); return; }

    const signatureBlock = signed
        ? (c.agreementSignatureImage
            ? '<img class="sig-img" src="' + esc(c.agreementSignatureImage) + '" alt="signature">'
            : '<div class="sig-line"></div>')
          + '<div class="sig-name">' + esc(c.agreementSignature || c.workerName || '') + '</div>'
          + '<div class="sig-cap">Worker’s signature · Signed' + (when ? ' on ' + esc(when) : '') + '</div>'
        : '<div class="sig-line"></div>'
          + '<div class="sig-name">' + esc(c.workerName || '') + '</div>'
          + '<div class="sig-cap">Worker’s signature over printed name · Date: _______________</div>';

    const html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Worker Agreement — ' + esc(c.workerName || '') + '</title>'
      + '<style>'
      + '*{box-sizing:border-box;}'
      + 'body{font-family:Georgia,\'Times New Roman\',serif;max-width:760px;margin:0 auto;padding:44px 40px;color:#1a1a1a;line-height:1.65;}'
      + '.doc-head{text-align:center;border-bottom:2px solid #1a1a1a;padding-bottom:16px;margin-bottom:22px;}'
      + '.doc-head .co{font-size:20px;font-weight:700;letter-spacing:.5px;}'
      + '.doc-head .co-sub{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#666;margin-top:2px;}'
      + '.doc-title{font-size:22px;font-weight:700;text-align:center;margin:6px 0 2px;}'
      + '.doc-date{text-align:center;font-size:12px;color:#666;margin-bottom:24px;}'
      + '.status{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.05em;padding:3px 12px;border-radius:20px;}'
      + '.status.signed{background:#e7f7ee;color:#15803d;}'
      + '.status.draft{background:#fff4e5;color:#b45309;}'
      + '.status-wrap{text-align:center;margin-bottom:24px;}'
      + 'h2{font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;color:#444;border-bottom:1px solid #ddd;padding-bottom:5px;margin:28px 0 12px;}'
      + 'table{width:100%;border-collapse:collapse;margin:6px 0 4px;}'
      + 'td{padding:8px 12px;border:1px solid #e2e2e2;font-size:14px;vertical-align:top;}'
      + 'td.k{width:36%;font-weight:700;background:#f7f7f7;}'
      + '.policy{white-space:pre-wrap;font-size:13px;line-height:1.7;}'
      + '.sig-area{margin-top:34px;display:flex;gap:48px;flex-wrap:wrap;}'
      + '.sig-col{flex:1;min-width:220px;}'
      + '.sig-img{max-height:80px;display:block;margin-bottom:2px;}'
      + '.sig-line{border-bottom:1.5px solid #1a1a1a;height:56px;margin-bottom:4px;}'
      + '.sig-name{font-weight:700;font-size:14px;}'
      + '.sig-cap{font-size:11.5px;color:#666;margin-top:2px;}'
      + '.foot{margin-top:40px;font-size:10.5px;color:#999;text-align:center;border-top:1px solid #eee;padding-top:10px;}'
      + '@media print{.noprint{display:none;}body{padding:0;}}'
      + '</style></head><body>'
      + '<div class="doc-head"><div class="co">DAC’s Building Design Services</div><div class="co-sub">Construction · Labor Agreement</div></div>'
      + '<div class="doc-title">Worker Agreement</div>'
      + '<div class="doc-date">' + esc(today) + '</div>'
      + '<div class="status-wrap"><span class="status ' + (signed ? 'signed' : 'draft') + '">' + (signed ? '✓ SIGNED' : 'FOR SIGNATURE') + '</span></div>'

      + '<h2>Contract Details</h2><table>'
      + '<tr><td class="k">Worker</td><td>' + esc(c.workerName || '—') + '</td></tr>'
      + '<tr><td class="k">Scope of work</td><td>' + esc(c.scope || '—') + '</td></tr>'
      + '<tr><td class="k">Agreed amount (cap)</td><td>₱ ' + (Number(c.agreedAmount) || 0).toLocaleString('en-PH') + '</td></tr>'
      + '<tr><td class="k">Pay type</td><td>' + (c.payType === 'inhouse' ? 'In-house (capped)' : 'Pakyaw (piecework)') + '</td></tr>'
      + (c.notes ? '<tr><td class="k">Notes</td><td>' + esc(c.notes) + '</td></tr>' : '')
      + '</table>'

      + '<h2>Worker Policy — Piecework Rates &amp; Company Rules</h2>'
      + '<div class="policy">' + esc(policy) + '</div>'
      + (c.agreementPdfUrl ? '<p style="font-size:12px;color:#555;margin-top:10px;">Full policy document on file: ' + esc(c.agreementPdfUrl) + '</p>' : '')

      + '<h2>Acknowledgement &amp; Signature</h2>'
      + '<p style="font-size:13px;">The worker confirms they have read (or been read) this agreement — including the piecework rates and company rules &amp; regulations above — understood it, and agree to be bound by it.</p>'
      + '<div class="sig-area">'
      +   '<div class="sig-col">' + signatureBlock + '</div>'
      +   '<div class="sig-col"><div class="sig-line"></div><div class="sig-name">DAC’s Building Design Services</div><div class="sig-cap">Company representative · Date: _______________</div></div>'
      + '</div>'

      + '<div class="foot">Generated by DAC’s Portal · This document reflects the agreement ' + (signed ? 'signed by the worker.' : 'to be signed.') + '</div>'
      + '<div class="noprint" style="text-align:center;margin-top:20px;"><button onclick="window.print()" style="padding:11px 26px;font-size:14px;font-family:inherit;cursor:pointer;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;border-radius:8px;">Print / Save as PDF</button></div>'
      + '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},350);};</scr' + 'ipt>'
      + '</body></html>';

    w.document.write(html);
    w.document.close();
}

function lcOpenNew() {
    if (!lcActiveFolderId()) { showExpNotif('Open a project folder first.', 'error'); return; }
    document.getElementById('lcId').value = '';
    document.getElementById('lcWorker').value = '';
    document.getElementById('lcScope').value = '';
    document.getElementById('lcAmount').value = '';
    document.getElementById('lcNotes').value = '';
    const pk = document.querySelector('input[name="lcPayType"][value="pakyaw"]'); if (pk) pk.checked = true;
    const t = document.getElementById('lcModalTitle'); if (t) t.textContent = 'New Labor Contract';
    lcFillWorkerDatalist();
    openExpModal('laborContractModal');
    lcAgrPopulate(null);
}
function lcOpenEdit(id) {
    const c = expLaborContracts.find(x => x.id === id); if (!c) return;
    document.getElementById('lcId').value = c.id;
    document.getElementById('lcWorker').value = c.workerName || '';
    document.getElementById('lcScope').value = c.scope || '';
    document.getElementById('lcAmount').value = c.agreedAmount ? Number(c.agreedAmount).toLocaleString('en-PH') : '';
    document.getElementById('lcNotes').value = c.notes || '';
    const r = document.querySelector('input[name="lcPayType"][value="' + (c.payType === 'inhouse' ? 'inhouse' : 'pakyaw') + '"]'); if (r) r.checked = true;
    const t = document.getElementById('lcModalTitle'); if (t) t.textContent = 'Edit Labor Contract';
    lcFillWorkerDatalist();
    openExpModal('laborContractModal');
    lcAgrPopulate(c);
}
function setupLaborContractFormListeners() {
    const form = document.getElementById('laborContractForm');
    if (form) form.addEventListener('submit', handleSaveLaborContract);
}
async function handleSaveLaborContract(e) {
    e.preventDefault();
    const id = document.getElementById('lcId').value;
    const folderId = lcActiveFolderId();
    if (!folderId) { showExpNotif('No project folder selected.', 'error'); return; }
    const workerName = document.getElementById('lcWorker').value.trim();
    const scope = document.getElementById('lcScope').value.trim();
    const agreedAmount = parseFloat((document.getElementById('lcAmount').value || '').replace(/,/g, '')) || 0;
    const notes = document.getElementById('lcNotes').value.trim();
    const payType = (document.querySelector('input[name="lcPayType"]:checked') || {}).value || 'pakyaw';
    if (!workerName) { showExpNotif('Enter the worker name.', 'error'); return; }
    if (agreedAmount <= 0) { showExpNotif('Enter the agreed amount (the cap).', 'error'); return; }

    try {
        showExpLoading('lcSaveBtn', true);

        // ── Worker agreement PDF ──
        // Upload a newly-picked signed PDF; keep an existing one; or clear if removed.
        // A contract with an attached PDF counts as "signed".
        let agrFields = null;
        if (_lcAgrFile) {
            showExpLoading('lcSaveBtn', true);
            const safe = String(_lcAgrFile.name || 'agreement.pdf').replace(/[^\w.\-]+/g, '_');
            const ref  = storage.ref('workerAgreements/' + folderId + '_' + Date.now() + '_' + safe);
            await ref.put(_lcAgrFile);
            const url = await ref.getDownloadURL();
            agrFields = {
                agreementSigned    : true,
                agreementSignedAt  : new Date(),
                agreementSignature : workerName,
                agreementPdfUrl    : url,
                agreementPdfName   : _lcAgrFile.name || 'Worker Agreement.pdf'
            };
        } else if (!_lcAgrUrl) {
            // No file picked and none kept → clear any previous agreement.
            agrFields = { agreementSigned: false, agreementPdfUrl: '', agreementPdfName: '', agreementSignedAt: null };
        }

        if (id) {
            const existing = expLaborContracts.find(x => x.id === id);
            const update = { workerName, scope, agreedAmount, payType, notes,
                             updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
            if (existing && (parseFloat(existing.agreedAmount) || 0) !== agreedAmount) {
                const hist = Array.isArray(existing.capHistory) ? existing.capHistory.slice() : [];
                hist.push({ amount: agreedAmount, at: new Date().toISOString(), note: 'Edited cap' });
                update.capHistory = hist;
            }
            if (agrFields) Object.assign(update, agrFields);   // attach/replace/clear PDF
            try {
                await db.collection('laborContracts').doc(id).update(update);
            } catch (colErr) {
                // Fallback if the DB doesn't have the newer agreement_pdf_name column
                // yet: retry without it so remove/edit still persists.
                if (/agreement_pdf_name|column/i.test(colErr.message || '')) {
                    const u2 = { ...update }; delete u2.agreementPdfName;
                    await db.collection('laborContracts').doc(id).update(u2);
                } else { throw colErr; }
            }
        } else {
            const addDoc = {
                userId: _uid(), folderId, workerName, scope, agreedAmount, payType, notes,
                status: 'ongoing',
                capHistory: [{ amount: agreedAmount, at: new Date().toISOString(), note: 'Initial cap' }],
                ...(agrFields || { agreementSigned: false }),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            try {
                await db.collection('laborContracts').add(addDoc);
            } catch (colErr) {
                if (/agreement_pdf_name|column/i.test(colErr.message || '')) {
                    delete addDoc.agreementPdfName;
                    await db.collection('laborContracts').add(addDoc);
                } else { throw colErr; }
            }
        }
        showExpNotif((agrFields && agrFields.agreementSigned) ? 'Contract saved — agreement PDF attached ✓' : 'Contract saved ✓', 'success');
        closeExpModal('laborContractModal');
    } catch (err) {
        showExpNotif('Error: ' + err.message, 'error');
    } finally { showExpLoading('lcSaveBtn', false); }
}
// Raise cap. Was a native browser prompt() — no branding, no sense of what the
// change actually does, and no view of what the cap has been before. Now an
// on-brand modal that previews the delta and the resulting remaining balance,
// and lists the cap history. Design: "Labor Modals.dc.html" → 1a.
function lcOpenRaiseCap(id) {
    const c = expLaborContracts.find(x => x.id === id); if (!c) return;
    const st  = lcStats(c);
    const cur = parseFloat(c.agreedAmount) || 0;

    const existing = document.getElementById('lcCapOverlay');
    if (existing) existing.remove();

    // Cap history = entries carrying an amount (file uploads share capHistory).
    const hist = (Array.isArray(c.capHistory) ? c.capHistory : []).filter(h => h && h.amount != null);
    const histHtml = hist.length
        ? hist.map(h => `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #F0F0F0;">
               <span style="font-size:12.5px;font-weight:500;color:#3A3A3C;">${_mvpEsc(h.note || 'Cap change')}</span>
               <span style="font-size:12px;font-weight:400;color:#A1A1A6;">${h.at ? new Date(h.at).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : ''}</span>
               <span style="font:500 12.5px var(--mono,'IBM Plex Mono',monospace);color:#1C1C1E;">₱${formatNum(parseFloat(h.amount) || 0)}</span>
             </div>`).join('')
        : `<div style="padding:8px 0;border-top:1px solid #F0F0F0;font-size:12.5px;font-weight:400;color:#A1A1A6;">No cap changes yet — this is the original agreed amount.</div>`;

    const ov = document.createElement('div');
    ov.id = 'lcCapOverlay';
    ov.className = 'lcm-ov';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.innerHTML = `
        <div class="lcm-card" style="max-width:440px;">
          <div class="lcm-head">
            <div>
              <h3 class="lcm-title">Raise cap</h3>
              <div class="lcm-sub">${_mvpEsc(c.workerName || 'Worker')} · ${_mvpEsc(c.scope || 'job')}</div>
            </div>
            <button type="button" class="lcm-x" data-cap-close aria-label="Close">&times;</button>
          </div>
          <div class="lcm-body">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#FAFBFA;border:1px solid #EEEEEE;border-radius:10px;">
              <span style="font-size:12.5px;font-weight:600;color:#6C6C70;">Current agreed</span>
              <span style="font-size:18px;color:#1C1C1E;font-variant-numeric:tabular-nums;">₱ ${formatNum(cur)}</span>
            </div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A1A1A6;margin:18px 0 8px;">New agreed amount</div>
            <div style="display:flex;align-items:center;gap:8px;border:1.5px solid #1A5C3A;border-radius:10px;padding:11px 14px;box-shadow:0 0 0 3px rgba(26,90,58,.12);">
              <span style="font-size:18px;color:#6C6C70;">₱</span>
              <input id="lcCapInput" type="text" inputmode="decimal" value="${formatNum(cur)}"
                style="flex:1;border:0;outline:none;background:transparent;font-family:var(--serif);font-size:18px;color:#1C1C1E;font-variant-numeric:tabular-nums;width:100%;">
            </div>
            <div id="lcCapDelta" style="margin-top:12px;"></div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A1A1A6;margin:22px 0 2px;">Cap history</div>
            <div>${histHtml}</div>
          </div>
          <div class="lcm-foot">
            <button type="button" class="lcm-btn" data-cap-close>Cancel</button>
            <button type="button" class="lcm-btn primary" id="lcCapSave">Update cap</button>
          </div>
        </div>`;
    document.body.appendChild(ov);

    const input = ov.querySelector('#lcCapInput');
    const delta = ov.querySelector('#lcCapDelta');
    const parse = () => parseFloat(String(input.value).replace(/,/g, '')) || 0;

    // Live preview: how much the cap moves, and what that leaves after payments
    // already made. Silent when unchanged so it never nags.
    const renderDelta = () => {
        const next = parse();
        if (!next || next === cur) { delta.innerHTML = ''; return; }
        const diff = next - cur;
        const up   = diff > 0;
        const rem  = next - st.paid;
        const tone = up ? { bg: '#EAF2EC', fg: '#1A5C3A' } : { bg: '#FBECEB', fg: '#B4453A' };
        const arrow = up
            ? '<polyline points="5 12 12 5 19 12"/><line x1="12" y1="19" x2="12" y2="5"/>'
            : '<polyline points="19 12 12 19 5 12"/><line x1="12" y1="5" x2="12" y2="19"/>';
        delta.innerHTML =
            `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:${tone.fg};background:${tone.bg};padding:5px 11px;border-radius:999px;">`
          + `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${arrow}</svg>`
          + `${up ? '+' : '−'}₱${formatNum(Math.abs(diff))} · new remaining ₱${formatNum(rem)}</span>`
          + (rem < 0
              ? `<div style="margin-top:8px;font-size:12px;font-weight:600;color:#B4453A;">This is below the ₱${formatNum(st.paid)} already paid — the contract would be over its cap.</div>`
              : '');
    };
    input.addEventListener('input', renderDelta);

    const close = () => ov.remove();
    ov.querySelectorAll('[data-cap-close]').forEach(b => b.addEventListener('click', close));

    const save = async () => {
        const next = parse();
        if (next <= 0) { showExpNotif('Enter a valid amount.', 'error'); return; }
        const btn = ov.querySelector('#lcCapSave');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            const h = Array.isArray(c.capHistory) ? c.capHistory.slice() : [];
            h.push({ amount: next, at: new Date().toISOString(), note: next >= cur ? 'Raised cap' : 'Lowered cap' });
            await db.collection('laborContracts').doc(id).update({
                agreedAmount: next, capHistory: h,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            close();
            showExpNotif('Cap updated ✓', 'success');
        } catch (err) {
            btn.disabled = false; btn.textContent = 'Update cap';
            showExpNotif('Error: ' + err.message, 'error');
        }
    };
    ov.querySelector('#lcCapSave').addEventListener('click', save);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

    // Esc closes, matching every other modal in the module.
    const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    input.focus();
    input.select();
}
async function lcDelete(id) {
    const paid = lcPaid(id);
    const msg = paid > 0
        ? 'This contract has ₱' + formatNum(paid) + ' in linked payments. Deleting it unlinks them (the payroll rows stay). Continue?'
        : 'Delete this labor contract?';
    if (!await showDeleteConfirm(msg)) return;
    try {
        await db.collection('laborContracts').doc(id).delete();
        showExpNotif('Contract deleted', 'success');
    } catch (err) { showExpNotif('Error: ' + err.message, 'error'); }
}

// ── Payroll-form contract picker ───────────────────────────
function lcPopulatePayrollPicker() {
    lcFillWorkerDatalist();
    ['payContract', 'editPayContract'].forEach(selId => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const cur = sel.value;
        const opts = ['<option value="">— None (normal payroll) —</option>'].concat(
            expLaborContracts.map(c => {
                const st = lcStats(c);
                return '<option value="' + c.id + '">'
                    + _mvpEsc(c.workerName || 'Worker') + ' · ' + _mvpEsc(c.scope || 'job')
                    + ' (remaining ₱' + formatNum(st.remaining) + ')</option>';
            }));
        sel.innerHTML = opts.join('');
        if (cur && expLaborContracts.some(c => c.id === cur)) sel.value = cur;
    });
}
function lcUpdateRemainingHint(selId, hintId) {
    const sel = document.getElementById(selId);
    const hint = document.getElementById(hintId);
    // Milestone row shows only when a contract is selected.
    const msRow = document.getElementById(selId === 'editPayContract' ? 'editPayMilestoneRow' : 'payMilestoneRow');
    if (!sel || !hint) return;
    const c = expLaborContracts.find(x => x.id === sel.value);
    if (!c) {
        hint.style.display = 'none'; hint.innerHTML = '';
        if (msRow) msRow.style.display = 'none';
        return;
    }
    const st = lcStats(c);
    hint.style.display = '';
    hint.innerHTML = 'Remaining on this contract: <strong class="' + (st.remaining < 0 ? 'lc-neg' : '')
        + '">₱' + formatNum(st.remaining) + '</strong> of ₱' + formatNum(st.agreed) + ' agreed';
    if (msRow) msRow.style.display = '';
}
// Overhead / indirect pay never draws down a pakyaw contract, so the picker is
// hidden (and any earlier pick discarded) the moment that category is chosen.
window.payToggleContractForType = function(which) {
    const isEdit = which === 'edit';
    const selId  = isEdit ? 'editPayContract' : 'payContract';
    const hintId = isEdit ? 'editPayContractRemaining' : 'payContractRemaining';
    const rowId  = isEdit ? 'editPayContractRow' : 'payContractRow';
    const name   = isEdit ? 'editPayLaborType' : 'payLaborType';
    const type = (document.querySelector('input[name="' + name + '"]:checked') || {}).value || 'direct';
    const row = document.getElementById(rowId);
    if (type === 'indirect') {
        const sel = document.getElementById(selId);
        if (sel) sel.value = '';
        lcUpdateRemainingHint(selId, hintId);   // also hides the milestone row
        if (row) row.style.display = 'none';
    } else if (row) {
        row.style.display = '';
    }
    // Statutory contributions are labor BURDEN — they belong with the worker they were
    // paid for. A coordinator's SSS is overhead, not labor. Ask only when it matters.
    const burdenRow = document.getElementById(isEdit ? 'editPayLiabilityForRow' : 'payLiabilityForRow');
    if (burdenRow) burdenRow.style.display = (type === 'liability') ? '' : 'none';
};
// Over-cap guard — returns true to proceed. excludeRowId lets edits ignore their own old amount.
function lcConfirmOverCap(contractId, addAmount, excludeRowId) {
    const c = expLaborContracts.find(x => x.id === contractId);
    if (!c) return true;
    const agreed = parseFloat(c.agreedAmount) || 0;
    const after = lcPaid(contractId, excludeRowId) + (parseFloat(addAmount) || 0);
    if (agreed > 0 && after > agreed) {
        const over = after - agreed;
        return confirm('This payment brings the contract total to ₱' + formatNum(after)
            + ', which exceeds the agreed ₱' + formatNum(agreed) + ' by ₱' + formatNum(over) + '.\n\nSave anyway?');
    }
    return true;
}

// ── Per-contract payment ledger (wallet view) ──────────────
window.lcOpenLedger = function(contractId) {
    const c = expLaborContracts.find(x => x.id === contractId);
    if (!c) { showExpNotif('Contract not found.', 'error'); return; }
    const st = lcStats(c);
    const rows = expPayroll
        .filter(p => p.contractId === contractId && lcDrawsDown(p))
        .sort((a, b) => (a.paymentDate || '').localeCompare(b.paymentDate || ''));
    const titleEl = document.getElementById('lcLedgerTitle');
    if (titleEl) titleEl.textContent = (c.workerName || 'Worker') + ' — ' + (c.scope || 'Contract');
    const body = document.getElementById('lcLedgerBody');
    if (!body) return;
    const mlabel = m => m === 'advance' ? 'Advance' : m === 'progress' ? 'Progress' : m === 'final' ? 'Final' : '—';
    const fmtD = d => { try { return new Date(d).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' }); } catch(e){ return d || '—'; } };
    let running = st.agreed;
    const rowsHtml = rows.length ? rows.map(p => {
        const amt = parseFloat(p.totalSalary) || 0;
        running -= amt;
        const imgs = Array.isArray(p.receiptImages) ? p.receiptImages.filter(Boolean) : [];
        const rcpt = imgs.length ? `<button class="lc-led-rcpt" onclick="lcLedgerViewReceipt('${p.id}')">View</button>` : '<span style="color:#c4c9d4;">—</span>';
        return `<tr>
            <td>${fmtD(p.paymentDate)}</td>
            <td style="color:#A1A1A6;">${mlabel(p.payMilestone)}</td>
            <td class="num amt">₱${formatNum(amt)}</td>
            <td class="num ${running < 0 ? 'lc-neg' : ''}">₱${formatNum(running)}</td>
            <td class="num">${rcpt}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center;color:#A1A1A6;padding:22px;">No payments linked to this contract yet.</td></tr>';
    const badge = st.status === 'Completed' ? 'lc-badge-done' : st.status === 'Over' ? 'lc-badge-over' : 'lc-badge-ongoing';
    // Drawn-down share of the cap, clamped so an overpaid contract shows a full
    // (red) bar rather than overflowing its track.
    const pctPaid = st.agreed > 0 ? Math.min(100, Math.max(0, st.paid / st.agreed * 100)) : 0;
    body.innerHTML = `
        <div class="lc-led-head">
            <span class="lc-type lc-type-${c.payType === 'inhouse' ? 'in' : 'pk'}">${c.payType === 'inhouse' ? 'In-house' : 'Pakyaw'}</span>
            <span class="lc-badge ${badge}">${st.status}</span>
        </div>
        <div class="lc-led-sum">
            <div><span>Agreed</span><strong>₱${formatNum(st.agreed)}</strong></div>
            <div><span>Paid</span><strong>₱${formatNum(st.paid)}</strong></div>
            <div><span>Remaining</span><strong class="${st.remaining < 0 ? 'lc-neg' : ''}">₱${formatNum(st.remaining)}</strong></div>
        </div>
        <div class="lc-led-bar"><i class="${st.remaining < 0 ? 'over' : ''}" style="width:${pctPaid}%;"></i></div>
        <div class="lc-led-scroll"><table class="lc-led-table">
            <thead><tr><th>Date</th><th>Milestone</th><th class="num">Amount</th><th class="num">Remaining after</th><th class="num">Receipt</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table></div>`;
    openExpModal('laborLedgerModal');
};
window.lcLedgerViewReceipt = function(payId) {
    const p = expPayroll.find(x => x.id === payId);
    const imgs = p && Array.isArray(p.receiptImages) ? p.receiptImages.filter(Boolean) : [];
    if (!imgs.length) return;
    if (window._receiptStore && typeof window.openLightbox === 'function') {
        window._receiptStore['lcled_' + payId] = { images: imgs, name: 'Payment receipt' };
        window.openLightbox('lcled_' + payId, 0);
    } else {
        window.open(imgs[0], '_blank');
    }
};

// ── Contract file attachments (photos / PDFs, stored on capHistory) ──
async function lcUploadFile(contractId, file) {
    const c = expLaborContracts.find(x => x.id === contractId);
    if (!c || !file) return;
    try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `laborContractFiles/${contractId}_${Date.now()}.${ext}`;
        const ref = window.storage.ref(path);
        await ref.put(file);
        const url = await ref.getDownloadURL();
        const hist = Array.isArray(c.capHistory) ? c.capHistory.slice() : [];
        hist.push({ fileUrl: url, fileName: file.name, at: new Date().toISOString(), note: 'File uploaded' });
        await db.collection('laborContracts').doc(contractId).update({
            capHistory: hist, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        c.capHistory = hist;
        showExpNotif('File uploaded ✓', 'success');
        window.lcViewFiles(contractId);
    } catch (err) { showExpNotif('Upload failed: ' + err.message, 'error'); }
}

window.lcAddFile = function(contractId, btn) {
    const existing = document.getElementById('lcAddFileDropdown');
    if (existing) { existing.remove(); return; }
    const c = expLaborContracts.find(x => x.id === contractId);
    if (!c) { showExpNotif('Contract not found.', 'error'); return; }

    // Hidden inputs live directly on <body> (not inside the dropdown), and are
    // triggered via input.click() from a real tap handler. Some mobile browsers
    // (notably iOS Safari) won't honor capture="environment" when the input is
    // reached through label-click-forwarding on a display:none element inside a
    // menu that gets removed/re-created — calling .click() directly is reliable.
    const galleryInput = document.createElement('input');
    galleryInput.type = 'file';
    galleryInput.accept = 'image/*,.pdf';
    galleryInput.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.capture = 'environment';
    cameraInput.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';

    document.body.appendChild(galleryInput);
    document.body.appendChild(cameraInput);

    const cleanupInputs = () => { galleryInput.remove(); cameraInput.remove(); };
    const handlePick = (input) => {
        input.onchange = () => {
            const file = input.files && input.files[0];
            cleanupInputs();
            if (file) lcUploadFile(contractId, file);
        };
    };
    handlePick(galleryInput);
    handlePick(cameraInput);

    const menu = document.createElement('div');
    menu.id = 'lcAddFileDropdown';
    menu.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.15);overflow:hidden;min-width:170px;';
    menu.innerHTML = `
        <button type="button" data-pick="gallery" style="display:flex;align-items:center;gap:10px;padding:11px 16px;width:100%;border:0;background:none;cursor:pointer;font:500 13px 'IBM Plex Sans',sans-serif;color:#111827;text-align:left;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload from gallery
        </button>
        <button type="button" data-pick="camera" style="display:flex;align-items:center;gap:10px;padding:11px 16px;width:100%;border:0;background:none;cursor:pointer;font:500 13px 'IBM Plex Sans',sans-serif;color:#111827;border-top:1px solid #f3f4f6;text-align:left;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background=''">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Take a photo
        </button>`;
    menu.querySelector('[data-pick="gallery"]').onclick = () => { menu.remove(); galleryInput.click(); };
    menu.querySelector('[data-pick="camera"]').onclick = () => { menu.remove(); cameraInput.click(); };

    document.body.appendChild(menu);
    const r = (btn || event.target).getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = r.left + 'px';
    const dismiss = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', dismiss, true); cleanupInputs(); } };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
};

window.lcViewFiles = function(contractId) {
    const c = expLaborContracts.find(x => x.id === contractId);
    if (!c) { showExpNotif('Contract not found.', 'error'); return; }
    const files = (Array.isArray(c.capHistory) ? c.capHistory : []).filter(h => h.fileUrl);
    const isImg = url => /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url);
    const existing = document.getElementById('lcFilesOverlay');
    if (existing) existing.remove();

    // Empty state explains what belongs here and offers the upload directly,
    // instead of the old bare "No files uploaded yet." line.
    const itemsHtml = !files.length
        ? `<div class="lcm-empty">
               <div class="lcm-empty-icon">
                 <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
               </div>
               <div class="lcm-empty-title">No files yet</div>
               <div class="lcm-empty-sub">Attach receipts, permits, or the signed agreement to keep this contract's paperwork in one place.</div>
               <button type="button" class="lcm-btn primary" data-files-upload style="margin-top:18px;">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>Upload file
               </button>
             </div>`
        : files.map((h, i) => {
            const url = h.fileUrl;
            const name = h.fileName || ('File ' + (i + 1));
            const img = isImg(url);
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #F0F0F0;">
                ${ img
                    ? `<a href="${_mvpEsc(url)}" target="_blank" rel="noopener" style="flex:none;line-height:0;">
                         <img src="${_mvpEsc(url)}" alt="${_mvpEsc(name)}" style="width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid #E5E5E5;">
                       </a>`
                    : `<a href="${_mvpEsc(url)}" target="_blank" rel="noopener" style="flex:none;width:56px;height:56px;border-radius:10px;border:1px solid #E5E5E5;background:#FAFBFA;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#6C6C70;">PDF</a>`
                }
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;color:#1C1C1E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_mvpEsc(name)}</div>
                    <div style="font-size:11.5px;font-weight:400;color:#A1A1A6;margin-top:3px;">${h.at ? new Date(h.at).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : ''}</div>
                </div>
                <a href="${_mvpEsc(url)}" target="_blank" rel="noopener" class="lc-led-rcpt" style="text-decoration:none;">Open</a>
            </div>`;
        }).join('');

    const ov = document.createElement('div');
    ov.id = 'lcFilesOverlay';
    ov.className = 'lcm-ov';
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    ov.innerHTML = `
        <div class="lcm-card" style="max-width:480px;">
            <div class="lcm-head">
                <div>
                    <h3 class="lcm-title">Files</h3>
                    <div class="lcm-sub">${_mvpEsc(c.workerName || 'Contract')} · ${_mvpEsc(c.scope || 'job')}</div>
                </div>
                <button type="button" class="lcm-x" data-files-close aria-label="Close">&times;</button>
            </div>
            <div class="lcm-body"${files.length ? '' : ' style="padding:0;"'}>${itemsHtml}</div>
            <div class="lcm-foot">
                <button type="button" class="lcm-btn primary" data-files-close>Close</button>
            </div>
        </div>`;
    document.body.appendChild(ov);

    ov.querySelectorAll('[data-files-close]').forEach(b => b.addEventListener('click', () => ov.remove()));
    // Empty-state upload reuses the existing Add file picker. The rect must be
    // read BEFORE the overlay is removed — lcAddFile positions its menu from
    // getBoundingClientRect(), and a detached node reports all zeros, which
    // would pin the picker to the top-left corner. Pass a stand-in holding the
    // captured rect (that method is all lcAddFile uses of the anchor).
    const up = ov.querySelector('[data-files-upload]');
    if (up) up.addEventListener('click', e => {
        const rect = e.currentTarget.getBoundingClientRect();
        ov.remove();
        window.lcAddFile(contractId, { getBoundingClientRect: () => rect });
    });
};

window.lcOpenNew            = lcOpenNew;
window.lcOpenEdit           = lcOpenEdit;
window.lcOpenRaiseCap       = lcOpenRaiseCap;
window.lcOpenAgrTemplate    = lcOpenAgrTemplate;
window.lcSaveAgrTemplate    = lcSaveAgrTemplate;
window.lcOpenAgreement      = lcOpenAgreement;
window.lcViewAgreementCurrent = lcViewAgreementCurrent;
window.lcDelete            = lcDelete;
window.handleSaveLaborContract = handleSaveLaborContract;
window.lcUpdateRemainingHint = lcUpdateRemainingHint;