// ============================================================
// OVERHEAD MANAGEMENT MODULE — DAC's Building Design Services
// Unified Company + Project overhead tracking (see MVP spec):
// every expense carries a `scope` ('company'|'project'), optional
// `folderId` (required when scope==='project'), category, amount,
// date, status ('paid'|'pending'), supplier/invoice/receipt, and an
// append-only `history` array (capHistory-style audit trail —
// pm-admin.js's labor-contract convention, not a separate collection).
// Soft delete via `deletedAt` — every query filters !deletedAt.
// ============================================================

// ── State ────────────────────────────────────────────────────
let _ovhdExpenses    = [];      // all non-deleted docs for this account
let _ovhdUnsub       = null;
let _ovhdMonth       = '';       // 'YYYY-MM'
let _ovhdInitialized = false;
let _ovhdScope       = 'all';    // 'all' | 'company' | 'project'
let _ovhdProjectId   = '';       // folderId filter
let _ovhdCategory    = '';
let _ovhdStatus      = '';
let _ovhdSearch       = '';
let _ovhdCharts       = {};
let _ovhdReceiptPending = null;  // { file } staged before save

// Same threshold as Project Control's Cover Expenses warning (COVER_LIMIT),
// kept consistent app-wide for what counts as a "large expense".
const OVERHEAD_LARGE_EXPENSE = 10000;

// ── Data UID helper ───────────────────────────────────────────
function _ovhdUid() {
    return (typeof _uid === 'function' ? _uid() : null) || window.currentDataUserId || (currentUser && currentUser.uid) || null;
}

// ── Helpers ──────────────────────────────────────────────────
function _fmtAmt(n) {
    if (isNaN(n) || n === null || n === undefined) return '₱0.00';
    return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function _esc(s) {
    return String(s || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function _ovhdToast(msg, type) {
    const el = document.getElementById('expNotification');
    if (!el) return;
    el.textContent = msg;
    el.className = 'exp-notification' + (type === 'error' ? ' error' : '');
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3500);
}
// Existing docs saved before `scope` existed have no such field — infer it
// from whether a folderId was recorded (the drill always wrote one).
function _ovhdEffectiveScope(ex) {
    return ex.scope || (ex.folderId ? 'project' : 'company');
}
function _ovhdFolderName(folderId) {
    const f = (typeof expFolders !== 'undefined' ? expFolders : []).find(x => x.id === folderId);
    return f ? f.name : (folderId ? 'Unknown Project' : '—');
}

// ── Init ─────────────────────────────────────────────────────
function initOverheadModule() {
    // Default month = current YYYY-MM
    if (!_ovhdMonth) {
        const now = new Date();
        _ovhdMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }
    // Sync month picker
    const picker = document.getElementById('ovhdMonthPicker');
    if (picker) picker.value = _ovhdMonth;

    _ovhdPopulateProjectSelects();
    _ovhdPopulateCategorySelect();

    if (!_ovhdInitialized) {
        _ovhdInitialized = true;
        _ovhdSubscribe();
    } else {
        _ovhdRender();
    }
}

function _ovhdPopulateProjectSelects() {
    const folders = typeof expFolders !== 'undefined' ? expFolders : [];
    ['ovhdProjectSel', 'ovhdExpProject'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.value;
        const placeholder = id === 'ovhdProjectSel' ? '<option value="">All Projects</option>' : '<option value="">Select project…</option>';
        sel.innerHTML = placeholder + folders.map(f => `<option value="${_esc(f.id)}">${_esc(f.name)}</option>`).join('');
        if (cur && folders.some(f => f.id === cur)) sel.value = cur;
    });
}

function _ovhdPopulateCategorySelect() {
    const sel = document.getElementById('ovhdCategorySel');
    if (!sel) return;
    const cur = sel.value;
    const cats = Array.from(new Set(_ovhdExpenses.map(e => e.category).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${_esc(c)}">${_esc(c)}</option>`).join('');
    if (cur && cats.includes(cur)) sel.value = cur;
}

// ── Filter control handlers ─────────────────────────────────
function setOverheadScope(scope) {
    _ovhdScope = scope;
    document.querySelectorAll('#ovhdScopeTabs .rpt-tab').forEach(t => t.classList.toggle('active', t.dataset.scope === scope));
    _ovhdRender();
}
function onOverheadProjectChange(val) { _ovhdProjectId = val || ''; _ovhdRender(); }
function onOverheadCategoryChange(val) { _ovhdCategory = val || ''; _ovhdRender(); }
function onOverheadStatusChange(val) { _ovhdStatus = val || ''; _ovhdRender(); }
function onOverheadSearchChange(val) { _ovhdSearch = String(val || '').trim().toLowerCase(); _ovhdRender(); }
function onOverheadMonthChange(val) { _ovhdMonth = val; _ovhdRender(); }

// ── Firestore subscription ────────────────────────────────────
function _ovhdSubscribe() {
    if (!currentUser) return;
    if (_ovhdUnsub) { _ovhdUnsub(); _ovhdUnsub = null; }

    try {
        _ovhdUnsub = db.collection('overheadExpenses')
            .where('userId', '==', _ovhdUid())
            .onSnapshot(snap => {
                _ovhdExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.deletedAt);
                _ovhdPopulateCategorySelect();
                _ovhdRender();
            }, err => {
                console.warn('Overhead onSnapshot error, falling back to .get():', err);
                db.collection('overheadExpenses')
                    .where('userId', '==', _ovhdUid())
                    .get()
                    .then(snap => {
                        _ovhdExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.deletedAt);
                        _ovhdPopulateCategorySelect();
                        _ovhdRender();
                    })
                    .catch(e => console.error('Overhead fallback .get() error:', e));
            });
    } catch(e) {
        console.error('_ovhdSubscribe error:', e);
    }
}

// ── Filtering (single source of truth every card/chart/table reads from) ──
function _ovhdFilteredForMonth() {
    return _ovhdExpenses.filter(ex => {
        if (!ex.date || !String(ex.date).startsWith(_ovhdMonth)) return false;
        const scope = _ovhdEffectiveScope(ex);
        if (_ovhdScope !== 'all' && scope !== _ovhdScope) return false;
        if (_ovhdProjectId && ex.folderId !== _ovhdProjectId) return false;
        if (_ovhdCategory && ex.category !== _ovhdCategory) return false;
        if (_ovhdStatus && (ex.status || 'pending') !== _ovhdStatus) return false;
        if (_ovhdSearch) {
            const hay = [ex.expenseName, ex.description, ex.category, _ovhdFolderName(ex.folderId)].join(' ').toLowerCase();
            if (!hay.includes(_ovhdSearch)) return false;
        }
        return true;
    });
}

// ── Render ────────────────────────────────────────────────────
function _ovhdRender() {
    const filtered = _ovhdFilteredForMonth();

    // Company vs Project vs Overall — computed from the SAME filtered set
    // every card/chart/table below reads, so switching any filter keeps
    // every section in agreement (never a separately-unfiltered total).
    let companyTotal = 0, projectTotal = 0;
    filtered.forEach(ex => {
        const amt = parseFloat(ex.amount || 0);
        if (_ovhdEffectiveScope(ex) === 'company') companyTotal += amt; else projectTotal += amt;
    });
    const overallTotal = companyTotal + projectTotal;

    const prevMonth = _ovhdPrevMonth(_ovhdMonth);
    const prevFiltered = _ovhdExpenses.filter(ex => {
        if (!ex.date || !String(ex.date).startsWith(prevMonth)) return false;
        const scope = _ovhdEffectiveScope(ex);
        if (_ovhdScope !== 'all' && scope !== _ovhdScope) return false;
        if (_ovhdProjectId && ex.folderId !== _ovhdProjectId) return false;
        if (_ovhdCategory && ex.category !== _ovhdCategory) return false;
        if (_ovhdStatus && (ex.status || 'pending') !== _ovhdStatus) return false;
        return true;
    });
    let prevCompany = 0, prevProject = 0;
    prevFiltered.forEach(ex => {
        const amt = parseFloat(ex.amount || 0);
        if (_ovhdEffectiveScope(ex) === 'company') prevCompany += amt; else prevProject += amt;
    });

    _ovhdSet('ovhdCompanyAmount', _fmtAmt(companyTotal));
    _ovhdSet('ovhdProjectAmount', _fmtAmt(projectTotal));
    _ovhdSet('ovhdOverallAmount', _fmtAmt(overallTotal));
    _ovhdSetKpiTrend('ovhdCompanyTrend', companyTotal, prevCompany);
    _ovhdSetKpiTrend('ovhdProjectTrend', projectTotal, prevProject);

    // Totals by category — for the By-Category panel
    const totals = {};
    filtered.forEach(ex => {
        const cat = ex.category || 'Uncategorized';
        totals[cat] = (totals[cat] || 0) + parseFloat(ex.amount || 0);
    });

    _ovhdRenderBreakdown(totals, overallTotal);
    _ovhdRenderTable(filtered);
    _ovhdRenderScopeChart(companyTotal, projectTotal);
    _ovhdRenderMonthlyChart();
    _ovhdRenderTrendChart();
    _ovhdRenderLargeExpenseBadge(filtered);
}
function _ovhdSet(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ── Previous month helper ──────────────────────────────────────
function _ovhdPrevMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── Trend badge helper ──────────────────────────────────────────
function _ovhdTrendHTML(current, prev) {
    if (!prev || prev === 0) return '';
    const diff    = current - prev;
    const pct     = Math.abs((diff / prev) * 100).toFixed(1);
    if (Math.abs(diff) < 0.01) return `<span class="ovhd-trend ovhd-trend-flat">→ 0%</span>`;
    if (diff > 0) return `<span class="ovhd-trend ovhd-trend-up">↑ ${pct}%</span>`;
    return `<span class="ovhd-trend ovhd-trend-down">↓ ${pct}%</span>`;
}
function _ovhdSetKpiTrend(elId, current, prev) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = _ovhdTrendHTML(current, prev);
}

// ── Large-expense / over-threshold badge (live-computed, not persisted) ──
function _ovhdRenderLargeExpenseBadge(filtered) {
    const el = document.getElementById('ovhdLargeExpenseBadge');
    if (!el) return;
    const largeCount = filtered.filter(ex => (parseFloat(ex.amount) || 0) > OVERHEAD_LARGE_EXPENSE).length;
    if (largeCount > 0) {
        el.style.display = 'inline-flex';
        el.textContent = `⚠ ${largeCount} large expense${largeCount !== 1 ? 's' : ''} (over ${_fmtAmt(OVERHEAD_LARGE_EXPENSE)})`;
    } else {
        el.style.display = 'none';
    }
}

// ── Category breakdown ─────────────────────────────────────────
const _OVHD_PALETTE = ['#157a52','#c8a45a','#7f9cb0','#9fb98a','#b0907f','#8a7fb0','#5e9d80','#c0564a'];
function _ovhdCatColor(name) {
    let h = 0;
    const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return _OVHD_PALETTE[h % _OVHD_PALETTE.length];
}

function _ovhdRenderBreakdown(totals, grandTotal) {
    const container = document.getElementById('ovhdBreakdownList');
    if (!container) return;

    const cats = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    if (!cats.length) {
        container.innerHTML = '<p class="ovhd-empty-row">No expenses match the current filters.</p>';
        return;
    }

    container.innerHTML = `<div class="ovhd-breakdown-list">${cats.map(cat => {
        const amt    = totals[cat];
        const pct    = grandTotal > 0 ? (amt / grandTotal) * 100 : 0;
        const pctStr = pct.toFixed(1);
        const color  = _ovhdCatColor(cat);
        return `
        <div class="ovhd-bd-row" onclick="openCategoryDetail('${_esc(cat)}','${color}')" title="View ${_esc(cat)} details">
            <div class="ovhd-bd-top">
                <span class="ovhd-bd-name"><span class="ovhd-bd-dot" style="background:${color}"></span>${_esc(cat)}</span>
                <span class="ovhd-bd-amt">${_fmtAmt(amt)}</span>
            </div>
            <div class="ovhd-bd-track"><div class="ovhd-bd-fill" style="width:${pctStr}%;background:${color}"></div></div>
            <div class="ovhd-bd-pct">${pctStr}% of total</div>
        </div>`;
    }).join('')}</div>`;
}

// ── Table ──────────────────────────────────────────────────────
function _ovhdRenderTable(filtered) {
    const tbody = document.getElementById('ovhdTableBody');
    if (!tbody) return;
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="ovhd-table-empty">No overhead expenses match the current filters.</td></tr>';
        return;
    }
    const sorted = [...filtered].sort((a, b) => {
        const da = a.date || '', db2 = b.date || '';
        return da < db2 ? 1 : da > db2 ? -1 : 0;
    });
    tbody.innerHTML = sorted.map(ex => {
        const dateStr = ex.date ? ex.date.substring(0, 10) : '—';
        const scope = _ovhdEffectiveScope(ex);
        const status = ex.status || 'pending';
        return `
        <tr>
            <td>${_esc(dateStr)}</td>
            <td><span class="ovhd-cat-badge" style="--ovhd-dot:${scope === 'company' ? '#157a52' : '#7f9cb0'}">${scope === 'company' ? 'Company' : 'Project'}</span></td>
            <td>${_esc(_ovhdFolderName(ex.folderId))}</td>
            <td><span class="ovhd-cat-badge" style="--ovhd-dot:${_ovhdCatColor(ex.category || 'Uncategorized')}">${_esc(ex.category || 'Uncategorized')}</span></td>
            <td>${_esc(ex.expenseName || ex.description || '—')}</td>
            <td class="ovhd-amt-cell">${_fmtAmt(parseFloat(ex.amount || 0))}</td>
            <td><span class="ovhd-cat-badge" style="--ovhd-dot:${status === 'paid' ? '#157a52' : '#c8a45a'}">${status === 'paid' ? 'Paid' : 'Pending'}</span></td>
            <td style="white-space:nowrap;">
                <button class="exp-icon-btn" onclick="openOverheadEditModal('${_esc(ex.id)}')" title="Edit">
                    <i data-lucide="pencil" style="width:14px;height:14px;stroke:currentColor;"></i>
                </button>
                <button class="exp-icon-btn exp-icon-btn-danger" onclick="deleteOverheadExpense('${_esc(ex.id)}')" title="Delete">
                    <i data-lucide="trash-2" style="width:14px;height:14px;stroke:currentColor;"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Charts ───────────────────────────────────────────────────
function _ovhdRenderScopeChart(companyTotal, projectTotal) {
    const ctx = document.getElementById('ovhdScopeChart');
    if (!ctx || typeof Chart === 'undefined') return;
    const labels = [], data = [], colors = [];
    if (companyTotal > 0) { labels.push('Company'); data.push(companyTotal); colors.push('#157a52'); }
    if (projectTotal > 0) { labels.push('Project'); data.push(projectTotal); colors.push('#7f9cb0'); }
    if (_ovhdCharts.scope) _ovhdCharts.scope.destroy();
    if (!data.length) return;
    _ovhdCharts.scope = new Chart(ctx, {
        type: 'pie',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff' }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            font: { family: "'IBM Plex Sans', system-ui, sans-serif" },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
                tooltip: { callbacks: { label: c => ` ${c.label}: ₱${Number(c.parsed).toLocaleString('en-PH')} (${((c.parsed / (companyTotal + projectTotal)) * 100).toFixed(1)}%)` } }
            }
        }
    });
}

function _ovhdRenderMonthlyChart() {
    const ctx = document.getElementById('ovhdMonthlyChart');
    if (!ctx || typeof Chart === 'undefined') return;
    // Same scope/project/category/status filters as everywhere else, but
    // across the whole year the current month belongs to (not just one month).
    const year = _ovhdMonth.split('-')[0];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const totals = new Array(12).fill(0);
    _ovhdExpenses.forEach(ex => {
        if (!ex.date || !String(ex.date).startsWith(year + '-')) return;
        const scope = _ovhdEffectiveScope(ex);
        if (_ovhdScope !== 'all' && scope !== _ovhdScope) return;
        if (_ovhdProjectId && ex.folderId !== _ovhdProjectId) return;
        if (_ovhdCategory && ex.category !== _ovhdCategory) return;
        if (_ovhdStatus && (ex.status || 'pending') !== _ovhdStatus) return;
        const mIdx = parseInt(String(ex.date).substring(5, 7), 10) - 1;
        if (mIdx >= 0 && mIdx < 12) totals[mIdx] += parseFloat(ex.amount || 0);
    });
    if (_ovhdCharts.monthly) _ovhdCharts.monthly.destroy();
    _ovhdCharts.monthly = new Chart(ctx, {
        type: 'bar',
        data: { labels: months, datasets: [{ label: 'Overhead', data: totals, backgroundColor: '#157a52', borderWidth: 0, borderRadius: 5 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            font: { family: "'IBM Plex Sans', system-ui, sans-serif" },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: c => ` ₱${Number(c.parsed.y).toLocaleString('en-PH')}` } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9b9a94' } },
                y: { beginAtZero: true, ticks: { callback: v => '₱' + Number(v).toLocaleString('en-PH'), font: { size: 10 }, color: '#9b9a94' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } }
            }
        }
    });
}

function _ovhdRenderTrendChart() {
    const ctx = document.getElementById('ovhdTrendChart');
    if (!ctx || typeof Chart === 'undefined') return;
    // Last 6 months ending at the selected month, same filters applied.
    const [cy, cm] = _ovhdMonth.split('-').map(Number);
    const labels = [], totals = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(cy, cm - 1 - i, 1);
        const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        labels.push(d.toLocaleString('en-PH', { month: 'short', year: '2-digit' }));
        let sum = 0;
        _ovhdExpenses.forEach(ex => {
            if (!ex.date || !String(ex.date).startsWith(ym)) return;
            const scope = _ovhdEffectiveScope(ex);
            if (_ovhdScope !== 'all' && scope !== _ovhdScope) return;
            if (_ovhdProjectId && ex.folderId !== _ovhdProjectId) return;
            if (_ovhdCategory && ex.category !== _ovhdCategory) return;
            if (_ovhdStatus && (ex.status || 'pending') !== _ovhdStatus) return;
            sum += parseFloat(ex.amount || 0);
        });
        totals.push(sum);
    }
    if (_ovhdCharts.trend) _ovhdCharts.trend.destroy();
    _ovhdCharts.trend = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: 'Overhead', data: totals, borderColor: '#157a52', backgroundColor: 'rgba(21,122,82,0.08)', fill: true, borderWidth: 2, pointRadius: 3, tension: 0.3 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            font: { family: "'IBM Plex Sans', system-ui, sans-serif" },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ₱${Number(c.parsed.y).toLocaleString('en-PH')}` } } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9b9a94' } },
                y: { beginAtZero: true, ticks: { callback: v => '₱' + Number(v).toLocaleString('en-PH'), font: { size: 10 }, color: '#9b9a94' }, grid: { color: 'rgba(0,0,0,0.04)' }, border: { display: false } }
            }
        }
    });
}

// ── Add/Edit Modal ──────────────────────────────────────────────
function onOverheadScopeFieldChange() {
    const scope = (document.querySelector('input[name="ovhdExpScope"]:checked') || {}).value || 'company';
    const grp = document.getElementById('ovhdExpProjectGroup');
    const sel = document.getElementById('ovhdExpProject');
    if (grp) grp.style.display = scope === 'project' ? '' : 'none';
    if (sel) sel.required = scope === 'project';
}

function openOverheadModal() {
    const modal = document.getElementById('overheadAddModal');
    if (!modal) return;
    document.getElementById('ovhdModalTitle').textContent = 'Add Overhead Expense';
    const form = document.getElementById('overheadExpenseForm');
    if (form) form.reset();
    document.getElementById('ovhdEditingId').value = '';
    document.getElementById('ovhdReceiptUrl').value = '';
    document.getElementById('ovhdReceiptBtnLabel').textContent = 'Attach receipt';
    _ovhdReceiptPending = null;
    onOverheadScopeFieldChange();
    const dateEl = document.getElementById('ovhdExpDate');
    if (dateEl) {
        const now = new Date();
        dateEl.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
    _ovhdPopulateProjectSelects();
    modal.classList.add('active');
}

function openOverheadEditModal(id) {
    const ex = _ovhdExpenses.find(e => e.id === id);
    if (!ex) { _ovhdToast('Expense not found.', 'error'); return; }
    const modal = document.getElementById('overheadAddModal');
    if (!modal) return;
    document.getElementById('ovhdModalTitle').textContent = 'Edit Overhead Expense';
    document.getElementById('ovhdEditingId').value = id;
    _ovhdPopulateProjectSelects();

    const scope = _ovhdEffectiveScope(ex);
    const radio = document.querySelector(`input[name="ovhdExpScope"][value="${scope}"]`);
    if (radio) radio.checked = true;
    onOverheadScopeFieldChange();
    if (document.getElementById('ovhdExpProject')) document.getElementById('ovhdExpProject').value = ex.folderId || '';
    document.getElementById('ovhdExpName').value = ex.expenseName || '';
    document.getElementById('ovhdExpCategory').value = ex.category || '';
    document.getElementById('ovhdExpAmount').value = ex.amount != null ? Number(ex.amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    document.getElementById('ovhdExpDate').value = ex.date ? ex.date.substring(0, 10) : '';
    document.getElementById('ovhdExpDescription').value = ex.description || '';
    document.getElementById('ovhdExpSupplier').value = ex.supplier || '';
    document.getElementById('ovhdExpInvoice').value = ex.invoiceNumber || '';
    document.getElementById('ovhdExpStatus').value = ex.status || 'pending';
    document.getElementById('ovhdExpNotes').value = ex.notes || '';
    document.getElementById('ovhdReceiptUrl').value = ex.receiptUrl || '';
    document.getElementById('ovhdReceiptBtnLabel').textContent = ex.receiptUrl ? 'Replace receipt' : 'Attach receipt';
    _ovhdReceiptPending = null;
    modal.classList.add('active');
}

function closeOverheadModal() {
    const modal = document.getElementById('overheadAddModal');
    if (modal) modal.classList.remove('active');
}

// ── Receipt attachment (gallery + camera, matches labor-contract "Add file" UX) ──
function overheadAddReceipt(btn) {
    const existing = document.getElementById('ovhdReceiptDropdown');
    if (existing) { existing.remove(); return; }

    const galleryInput = document.createElement('input');
    galleryInput.type = 'file'; galleryInput.accept = 'image/*,.pdf';
    galleryInput.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    const cameraInput = document.createElement('input');
    cameraInput.type = 'file'; cameraInput.accept = 'image/*'; cameraInput.capture = 'environment';
    cameraInput.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    document.body.appendChild(galleryInput);
    document.body.appendChild(cameraInput);
    const cleanup = () => { galleryInput.remove(); cameraInput.remove(); };
    const handlePick = (input) => {
        input.onchange = () => {
            const file = input.files && input.files[0];
            cleanup();
            if (file) {
                _ovhdReceiptPending = { file };
                const lbl = document.getElementById('ovhdReceiptBtnLabel');
                if (lbl) lbl.textContent = file.name;
            }
        };
    };
    handlePick(galleryInput); handlePick(cameraInput);

    const menu = document.createElement('div');
    menu.id = 'ovhdReceiptDropdown';
    menu.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.15);overflow:hidden;min-width:170px;';
    menu.innerHTML = `
        <button type="button" data-pick="gallery" style="display:flex;align-items:center;gap:10px;padding:11px 16px;width:100%;border:0;background:none;cursor:pointer;font:500 13px 'IBM Plex Sans',sans-serif;color:#111827;text-align:left;">Upload from gallery</button>
        <button type="button" data-pick="camera" style="display:flex;align-items:center;gap:10px;padding:11px 16px;width:100%;border:0;background:none;cursor:pointer;font:500 13px 'IBM Plex Sans',sans-serif;color:#111827;border-top:1px solid #f3f4f6;text-align:left;">Take a photo</button>`;
    menu.querySelector('[data-pick="gallery"]').onclick = () => { menu.remove(); galleryInput.click(); };
    menu.querySelector('[data-pick="camera"]').onclick = () => { menu.remove(); cameraInput.click(); };
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.left = r.left + 'px';
    const dismiss = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', dismiss, true); cleanup(); } };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
}

// ── Save (Add or Edit) ──────────────────────────────────────────
async function handleSaveOverheadExpense(e) {
    if (e) e.preventDefault();
    if (!currentUser) return;

    const editingId   = document.getElementById('ovhdEditingId')?.value || '';
    const scope       = (document.querySelector('input[name="ovhdExpScope"]:checked') || {}).value || 'company';
    const folderId    = scope === 'project' ? (document.getElementById('ovhdExpProject')?.value || '') : '';
    const expenseName = document.getElementById('ovhdExpName')?.value?.trim();
    const category    = document.getElementById('ovhdExpCategory')?.value?.trim();
    const amountRaw   = document.getElementById('ovhdExpAmount')?.value?.replace(/,/g, '').trim();
    const date        = document.getElementById('ovhdExpDate')?.value?.trim();
    const description = document.getElementById('ovhdExpDescription')?.value?.trim();
    const supplier    = document.getElementById('ovhdExpSupplier')?.value?.trim() || '';
    const invoiceNumber = document.getElementById('ovhdExpInvoice')?.value?.trim() || '';
    const status      = document.getElementById('ovhdExpStatus')?.value || 'pending';
    const notes       = document.getElementById('ovhdExpNotes')?.value?.trim() || '';

    // Rule 1/2: company expenses cannot have a project; project expenses must select one.
    if (scope === 'project' && !folderId) { _ovhdToast('Please select a project.', 'error'); return; }
    if (!expenseName) { _ovhdToast('Please enter an expense name.', 'error'); return; }
    if (!category)  { _ovhdToast('Please select a category.', 'error'); return; }
    // Rule 3: amount must be greater than zero.
    if (!amountRaw || isNaN(amountRaw) || parseFloat(amountRaw) <= 0) {
        _ovhdToast('Please enter a valid amount.', 'error'); return;
    }
    if (!date) { _ovhdToast('Please select a date.', 'error'); return; }
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (new Date(date) > today) { _ovhdToast('Date cannot be in the future.', 'error'); return; }
    if (!description) { _ovhdToast('Please enter a description.', 'error'); return; }

    const btn = document.getElementById('ovhdSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        let receiptUrl = document.getElementById('ovhdReceiptUrl')?.value || '';
        if (_ovhdReceiptPending && _ovhdReceiptPending.file) {
            const file = _ovhdReceiptPending.file;
            const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
            const path = `overheadReceipts/${_ovhdUid()}_${Date.now()}.${ext}`;
            const ref = window.storage.ref(path);
            await ref.put(file);
            receiptUrl = await ref.getDownloadURL();
        }

        const amount = parseFloat(amountRaw);
        const payload = {
            userId: _ovhdUid(), scope, folderId: folderId || null,
            expenseName, category, amount, date, description,
            supplier, invoiceNumber, receiptUrl, status, notes,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (editingId) {
            const existing = _ovhdExpenses.find(e => e.id === editingId);
            const history = Array.isArray(existing?.history) ? existing.history.slice() : [];
            const changed = [];
            if (existing) {
                ['scope','folderId','expenseName','category','amount','date','description','status'].forEach(f => {
                    const oldV = existing[f] != null ? existing[f] : (f === 'folderId' ? null : '');
                    const newV = payload[f] != null ? payload[f] : (f === 'folderId' ? null : '');
                    if (String(oldV) !== String(newV)) changed.push(f);
                });
            }
            if (changed.length) {
                history.push({ fields: changed, at: new Date().toISOString(), note: 'Edited: ' + changed.join(', ') });
            }
            await db.collection('overheadExpenses').doc(editingId).update({ ...payload, history });
            const idx = _ovhdExpenses.findIndex(e => e.id === editingId);
            if (idx >= 0) _ovhdExpenses[idx] = { ..._ovhdExpenses[idx], ...payload, history };
            _ovhdToast('Overhead expense updated.');
        } else {
            const history = [{ fields: ['created'], at: new Date().toISOString(), note: 'Expense created' }];
            const ref = await db.collection('overheadExpenses').add({
                ...payload, history, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: _ovhdUid()
            });
            _ovhdExpenses.unshift({ id: ref.id, ...payload, history });
            _ovhdToast('Overhead expense added.');
        }

        closeOverheadModal();
        if (date && date.length >= 7) {
            _ovhdMonth = date.substring(0, 7);
            const picker = document.getElementById('ovhdMonthPicker');
            if (picker) picker.value = _ovhdMonth;
        }
        _ovhdPopulateCategorySelect();
        _ovhdRender();
    } catch(err) {
        console.error('handleSaveOverheadExpense:', err);
        _ovhdToast('Error saving expense: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
    }
}

// ── Category Detail Modal ──────────────────────────────────────
function openCategoryDetail(cat, color) {
    const modal = document.getElementById('ovhdCatDetailModal');
    if (!modal) return;

    const allEntries = _ovhdExpenses.filter(ex => (ex.category || 'Uncategorized') === cat && ex.date);

    const monthMap = {};
    allEntries.forEach(ex => {
        const ym = String(ex.date).substring(0, 7);
        if (!monthMap[ym]) monthMap[ym] = [];
        monthMap[ym].push(ex);
    });
    const months = Object.keys(monthMap).sort();

    const monthTotals = {};
    months.forEach(ym => {
        monthTotals[ym] = monthMap[ym].reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    });

    const allTimeTotal  = Object.values(monthTotals).reduce((a, b) => a + b, 0);
    const allTimeCount  = allEntries.length;
    const monthsTracked = months.length;
    const avgPerMonth   = monthsTracked > 0 ? allTimeTotal / monthsTracked : 0;

    const titleEl = document.getElementById('ovhdCatDetailTitle');
    titleEl.textContent = cat;
    titleEl.style.borderLeft = `4px solid ${color}`;
    titleEl.style.paddingLeft = '10px';

    document.getElementById('ovhdCatDetailSummary').innerHTML = `
        <div class="ovhd-detail-stat">
            <span class="ovhd-detail-stat-label">All-Time Total</span>
            <span class="ovhd-detail-stat-val">${_fmtAmt(allTimeTotal)}</span>
        </div>
        <div class="ovhd-detail-stat">
            <span class="ovhd-detail-stat-label">Total Entries</span>
            <span class="ovhd-detail-stat-val">${allTimeCount}</span>
        </div>
        <div class="ovhd-detail-stat">
            <span class="ovhd-detail-stat-label">Months Tracked</span>
            <span class="ovhd-detail-stat-val">${monthsTracked}</span>
        </div>
        <div class="ovhd-detail-stat">
            <span class="ovhd-detail-stat-label">Avg / Month</span>
            <span class="ovhd-detail-stat-val">${_fmtAmt(avgPerMonth)}</span>
        </div>`;

    const displayMonths = [...months].reverse();
    const monthlyHTML = displayMonths.map((ym, i) => {
        const prevYm    = months[months.length - 1 - i - 1];
        const curr      = monthTotals[ym];
        const prev      = prevYm ? monthTotals[prevYm] : 0;
        const trend     = _ovhdTrendHTML(curr, prev);
        const entries   = monthMap[ym];
        const entryRows = entries
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map(ex => `
            <tr class="ovhd-detail-entry-row">
                <td style="padding-left:2rem;color:#6b7280;font-size:0.8rem;">${ex.date ? ex.date.substring(0, 10) : '—'}</td>
                <td style="color:#6b7280;font-size:0.8rem;">${_esc(ex.expenseName || ex.description || '—')}</td>
                <td class="ovhd-amt-cell" style="font-size:0.8rem;">${_fmtAmt(parseFloat(ex.amount || 0))}</td>
            </tr>`).join('');

        const [y, m] = ym.split('-');
        const monthName = new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleString('en-PH', { month: 'long', year: 'numeric' });

        return `
        <tr class="ovhd-detail-month-row">
            <td>
                <div class="ovhd-detail-month-label">
                    <span class="ovhd-detail-month-name">${monthName}</span>
                    <span class="ovhd-detail-entry-count">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>
                </div>
            </td>
            <td><div class="ovhd-detail-month-trend">${trend}</div></td>
            <td class="ovhd-amt-cell">${_fmtAmt(curr)}</td>
        </tr>
        ${entryRows}`;
    }).join('');

    document.getElementById('ovhdCatDetailTbody').innerHTML =
        monthlyHTML || `<tr><td colspan="3" class="ovhd-table-empty">No entries found for this category.</td></tr>`;

    modal.classList.add('active');
}

function closeCategoryDetail() {
    const modal = document.getElementById('ovhdCatDetailModal');
    if (modal) modal.classList.remove('active');
}

// ── Delete (soft) ────────────────────────────────────────────────
async function deleteOverheadExpense(id) {
    if (!id) return;
    if (!await showDeleteConfirm('Delete this overhead expense?')) return;
    try {
        const existing = _ovhdExpenses.find(e => e.id === id);
        const history = Array.isArray(existing?.history) ? existing.history.slice() : [];
        history.push({ fields: ['deletedAt'], at: new Date().toISOString(), note: 'Expense deleted' });
        await db.collection('overheadExpenses').doc(id).update({
            deletedAt: firebase.firestore.FieldValue.serverTimestamp(), history
        });
        _ovhdExpenses = _ovhdExpenses.filter(e => e.id !== id);
        _ovhdRender();
        _ovhdToast('Expense deleted.');
    } catch(err) {
        console.error('deleteOverheadExpense:', err);
        _ovhdToast('Error deleting expense: ' + err.message, 'error');
    }
}

// ── CSV export (Excel-compatible) ────────────────────────────────
function exportOverheadCsv() {
    const filtered = _ovhdFilteredForMonth();
    const headers = ['Date', 'Scope', 'Project', 'Category', 'Description', 'Amount', 'Status'];
    const csvEsc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = filtered.map(ex => [
        ex.date || '',
        _ovhdEffectiveScope(ex) === 'company' ? 'Company' : 'Project',
        _ovhdFolderName(ex.folderId),
        ex.category || '',
        ex.expenseName || ex.description || '',
        Number(ex.amount) || 0,
        ex.status || 'pending'
    ].map(csvEsc).join(','));
    const csv = [headers.map(csvEsc).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `overhead-${_ovhdMonth}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Print reports (popup-window print, same convention as printMaterialReceipt) ──
function toggleOverheadReportMenu() {
    const menu = document.getElementById('ovhdReportMenu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    if (menu.style.display === 'block') {
        const dismiss = e => {
            if (!menu.contains(e.target)) { menu.style.display = 'none'; document.removeEventListener('click', dismiss, true); }
        };
        setTimeout(() => document.addEventListener('click', dismiss, true), 0);
    }
}

function printOverheadReport(kind) {
    const menu = document.getElementById('ovhdReportMenu');
    if (menu) menu.style.display = 'none';

    const [cy, cm] = _ovhdMonth.split('-').map(Number);
    let rangeStart, rangeEnd, rangeLabel, scopeFilter = null;

    if (kind === 'monthly') { rangeStart = `${cy}-${String(cm).padStart(2,'0')}-01`; rangeEnd = `${cy}-${String(cm).padStart(2,'0')}-31`; rangeLabel = new Date(cy, cm-1, 1).toLocaleString('en-PH', { month: 'long', year: 'numeric' }); }
    else if (kind === 'quarterly') { const q = Math.floor((cm-1)/3); rangeStart = `${cy}-${String(q*3+1).padStart(2,'0')}-01`; rangeEnd = `${cy}-${String(q*3+3).padStart(2,'0')}-31`; rangeLabel = `Q${q+1} ${cy}`; }
    else if (kind === 'annual') { rangeStart = `${cy}-01-01`; rangeEnd = `${cy}-12-31`; rangeLabel = `FY ${cy}`; }
    else { rangeStart = '0000-01-01'; rangeEnd = '9999-12-31'; rangeLabel = 'All Time'; if (kind === 'company') scopeFilter = 'company'; if (kind === 'project') scopeFilter = 'project'; if (kind === 'overall') scopeFilter = null; }

    const rows = _ovhdExpenses.filter(ex => {
        if (!ex.date) return false;
        if (ex.date < rangeStart || ex.date > rangeEnd) return false;
        if (scopeFilter && _ovhdEffectiveScope(ex) !== scopeFilter) return false;
        return true;
    }).sort((a, b) => (a.date < b.date ? -1 : 1));

    const total = rows.reduce((s, ex) => s + (Number(ex.amount) || 0), 0);
    const titleMap = { monthly: 'Monthly Overhead Report', quarterly: 'Quarterly Overhead Report', annual: 'Annual Overhead Report',
        company: 'Company Overhead Report', project: 'Project Overhead Report', overall: 'Overall Overhead Report' };

    const bodyRows = rows.map(ex => `<tr>
        <td>${_esc(ex.date ? ex.date.substring(0,10) : '—')}</td>
        <td>${_ovhdEffectiveScope(ex) === 'company' ? 'Company' : 'Project'}</td>
        <td>${_esc(_ovhdFolderName(ex.folderId))}</td>
        <td>${_esc(ex.category || '—')}</td>
        <td>${_esc(ex.expenseName || ex.description || '—')}</td>
        <td style="text-align:right;">₱${(Number(ex.amount)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>${ex.status === 'paid' ? 'Paid' : 'Pending'}</td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:20px;">No expenses in this range.</td></tr>';

    const printedOn = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    const html = `<!DOCTYPE html><html><head><title>${_esc(titleMap[kind] || 'Overhead Report')}</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:#111;padding:32px;max-width:900px;margin:0 auto;}
    .header{border-bottom:2px solid #157a52;padding-bottom:14px;margin-bottom:20px;}
    .doc-title{font-size:19px;font-weight:800;color:#157a52;margin:0;}
    .doc-sub{font-size:12px;color:#6b7280;margin-top:4px;}
    table{width:100%;border-collapse:collapse;margin-top:10px;}
    th{background:#f9fafb;text-align:left;padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;border-bottom:1px solid #e5e7eb;}
    td{padding:8px 10px;border-bottom:1px solid #f1f5f9;}
    .total-row td{font-weight:700;border-top:2px solid #111;border-bottom:none;}
    @media print{body{padding:14px;}}</style></head>
    <body>
    <div class="header"><h1 class="doc-title">${_esc(titleMap[kind] || 'Overhead Report')}</h1><div class="doc-sub">${_esc(rangeLabel)} · Generated ${printedOn}</div></div>
    <table><thead><tr><th>Date</th><th>Scope</th><th>Project</th><th>Category</th><th>Description</th><th style="text-align:right;">Amount</th><th>Status</th></tr></thead>
    <tbody>${bodyRows}</tbody>
    <tfoot><tr class="total-row"><td colspan="5">TOTAL</td><td style="text-align:right;">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td></td></tr></tfoot>
    </table>
    </body></html>`;

    const w = window.open('', '_blank');
    if (!w) { _ovhdToast('Allow popups for this site to print the report.', 'error'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
}
