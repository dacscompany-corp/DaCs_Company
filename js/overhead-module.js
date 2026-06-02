// ============================================================
// OVERHEAD EXPENSES MODULE — DAC's Building Design Services
// ============================================================

// ── State ────────────────────────────────────────────────────
let _ovhdExpenses    = [];
let _ovhdUnsub       = null;
let _ovhdMonth       = '';       // 'YYYY-MM'
let _ovhdInitialized = false;

// ── Data UID helper ───────────────────────────────────────────
function _ovhdUid() {
    return window.currentDataUserId || (currentUser && currentUser.uid) || null;
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

    if (!_ovhdInitialized) {
        _ovhdInitialized = true;
        _ovhdSubscribe();
    } else {
        _ovhdRender();
    }
}

function onOverheadMonthChange(val) {
    _ovhdMonth = val;
    _ovhdRender();
}

// ── Firestore subscription ────────────────────────────────────
function _ovhdSubscribe() {
    if (!currentUser) return;
    if (_ovhdUnsub) { _ovhdUnsub(); _ovhdUnsub = null; }

    try {
        _ovhdUnsub = db.collection('overheadExpenses')
            .where('userId', '==', _ovhdUid())
            .orderBy('date', 'desc')
            .onSnapshot(snap => {
                _ovhdExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                _ovhdRender();
            }, err => {
                console.warn('Overhead onSnapshot error, falling back to .get():', err);
                // Fallback without orderBy (no index needed)
                db.collection('overheadExpenses')
                    .where('userId', '==', _ovhdUid())
                    .get()
                    .then(snap => {
                        _ovhdExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                        _ovhdRender();
                    })
                    .catch(e => console.error('Overhead fallback .get() error:', e));
            });
    } catch(e) {
        console.error('_ovhdSubscribe error:', e);
    }
}

// ── Render ────────────────────────────────────────────────────
function _ovhdRender() {
    // Filter to selected month
    const filtered = _ovhdExpenses.filter(ex => {
        if (!ex.date) return false;
        return String(ex.date).startsWith(_ovhdMonth);
    });

    // Totals by category — current month
    const totals = {};
    let grandTotal = 0;
    filtered.forEach(ex => {
        const cat = ex.category || 'Uncategorized';
        totals[cat] = (totals[cat] || 0) + parseFloat(ex.amount || 0);
        grandTotal += parseFloat(ex.amount || 0);
    });

    // Totals by category — previous month (for trend comparison)
    const prevMonth = _ovhdPrevMonth(_ovhdMonth);
    const prevTotals = {};
    _ovhdExpenses
        .filter(ex => ex.date && String(ex.date).startsWith(prevMonth))
        .forEach(ex => {
            const cat = ex.category || 'Uncategorized';
            prevTotals[cat] = (prevTotals[cat] || 0) + parseFloat(ex.amount || 0);
        });

    // Summary cards
    const totalCount = filtered.length;
    const prevGrandTotal = Object.values(prevTotals).reduce((a, b) => a + b, 0);

    const totalEl = document.getElementById('ovhdTotalAmount');
    if (totalEl) totalEl.textContent = _fmtAmt(grandTotal);

    const countEl = document.getElementById('ovhdTotalCount');
    if (countEl) countEl.textContent = totalCount;

    const avgEl = document.getElementById('ovhdAvgAmount');
    if (avgEl) avgEl.textContent = totalCount > 0 ? _fmtAmt(grandTotal / totalCount) : '₱0.00';

    // KPI trend badge on Total Overhead card
    _ovhdSetKpiTrend('ovhdTotalTrend', grandTotal, prevGrandTotal);

    _ovhdRenderBreakdown(totals, grandTotal, prevTotals);
    _ovhdRenderTable(filtered);
}

// ── Previous month helper ──────────────────────────────────────
function _ovhdPrevMonth(ym) {
    // ym = 'YYYY-MM', returns previous month string
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 2, 1); // month is 0-indexed
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── Trend badge helper ──────────────────────────────────────────
function _ovhdTrendHTML(current, prev) {
    if (!prev || prev === 0) return '';
    const diff    = current - prev;
    const pct     = Math.abs((diff / prev) * 100).toFixed(1);
    if (Math.abs(diff) < 0.01) {
        return `<span class="ovhd-trend ovhd-trend-flat">→ 0%</span>`;
    }
    if (diff > 0) {
        // Spending increased — bad for overhead (red arrow up)
        return `<span class="ovhd-trend ovhd-trend-up">↑ ${pct}%</span>`;
    }
    // Spending decreased — good (green arrow down)
    return `<span class="ovhd-trend ovhd-trend-down">↓ ${pct}%</span>`;
}

// ── KPI card trend badge ────────────────────────────────────────
function _ovhdSetKpiTrend(elId, current, prev) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = _ovhdTrendHTML(current, prev);
}

// ── Category breakdown ─────────────────────────────────────────
function _ovhdRenderBreakdown(totals, grandTotal, prevTotals) {
    const container = document.getElementById('ovhdBreakdownList');
    if (!container) return;

    // Build per-category counts from the current month's filtered expenses
    const filtered = _ovhdExpenses.filter(ex => ex.date && String(ex.date).startsWith(_ovhdMonth));
    const counts = {};
    filtered.forEach(ex => {
        const cat = ex.category || 'Uncategorized';
        counts[cat] = (counts[cat] || 0) + 1;
    });

    const cats = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    if (!cats.length) {
        container.innerHTML = '<p class="exp-empty-row">No expenses for this month.</p>';
        return;
    }

    const COLORS = [
        { border: '#059669', ico: '#059669', bg: '#ecfdf5', mini: '#059669' },
        { border: '#2563eb', ico: '#2563eb', bg: '#eff6ff', mini: '#3b82f6' },
        { border: '#7c3aed', ico: '#7c3aed', bg: '#f5f3ff', mini: '#a78bfa' },
        { border: '#d97706', ico: '#d97706', bg: '#fffbeb', mini: '#fbbf24' },
        { border: '#dc2626', ico: '#dc2626', bg: '#fef2f2', mini: '#f87171' },
        { border: '#0891b2', ico: '#0891b2', bg: '#ecfeff', mini: '#22d3ee' },
        { border: '#db2777', ico: '#db2777', bg: '#fdf2f8', mini: '#f472b6' },
        { border: '#65a30d', ico: '#65a30d', bg: '#f7fee7', mini: '#a3e635' },
    ];

    const prevT = prevTotals || {};
    container.innerHTML = `<div class="ovhd-cat-grid">${cats.map((cat, i) => {
        const amt     = totals[cat];
        const prev    = prevT[cat] || 0;
        const pct     = grandTotal > 0 ? ((amt / grandTotal) * 100).toFixed(1) : '0.0';
        const c       = COLORS[i % COLORS.length];
        const trend   = _ovhdTrendHTML(amt, prev);
        const count   = counts[cat] || 0;
        const avg     = count > 0 ? amt / count : 0;
        const prevLbl = prev > 0
            ? `<span class="ovhd-prev-amt">vs ${_fmtAmt(prev)} last month</span>`
            : `<span class="ovhd-prev-amt">No data last month</span>`;
        return `
        <div class="exp-cost-card ovhd-cat-card" style="border-left:3px solid ${c.border}">
            <div class="exp-cost-head">
                <span class="exp-cost-dot" style="width:10px;height:10px;border-radius:3px;background:${c.border};display:inline-block;flex-shrink:0;"></span>
                <span class="exp-cost-tag">${_esc(cat)}</span>
            </div>
            <div class="ovhd-cat-kpi-row">
                <div class="ovhd-cat-kpi">
                    <span class="ovhd-cat-kpi-label">Total Overhead</span>
                    <span class="ovhd-cat-kpi-val" style="color:${c.border}">${_fmtAmt(amt)}</span>
                </div>
                <div class="ovhd-cat-kpi">
                    <span class="ovhd-cat-kpi-label">Total Entries</span>
                    <span class="ovhd-cat-kpi-val">${count}</span>
                </div>
                <div class="ovhd-cat-kpi">
                    <span class="ovhd-cat-kpi-label">Average per Entry</span>
                    <span class="ovhd-cat-kpi-val">${_fmtAmt(avg)}</span>
                </div>
            </div>
            <div class="ovhd-trend-row">
                ${trend}
                ${prevLbl}
            </div>
            <div class="exp-cost-meta">${pct}% of total</div>
            <div class="exp-cost-minibar">
                <div class="exp-mini-fill" style="width:${pct}%;background:${c.mini}"></div>
            </div>
            <button class="ovhd-view-detail-btn" onclick="openCategoryDetail('${_esc(cat)}','${c.border}')">
                View Details
            </button>
        </div>`;
    }).join('')}</div>`;
}

// ── Table ──────────────────────────────────────────────────────
function _ovhdRenderTable(filtered) {
    const tbody = document.getElementById('ovhdTableBody');
    if (!tbody) return;
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="ovhd-table-empty">No overhead expenses found for this month.</td></tr>';
        return;
    }
    // Sort by date desc
    const sorted = [...filtered].sort((a, b) => {
        const da = a.date || '', db2 = b.date || '';
        return da < db2 ? 1 : da > db2 ? -1 : 0;
    });
    tbody.innerHTML = sorted.map(ex => {
        const dateStr = ex.date ? ex.date.substring(0, 10) : '—';
        return `
        <tr>
            <td>${_esc(dateStr)}</td>
            <td><span class="ovhd-cat-badge">${_esc(ex.category || 'Uncategorized')}</span></td>
            <td>${_esc(ex.description || '—')}</td>
            <td class="ovhd-amt-cell">${_fmtAmt(parseFloat(ex.amount || 0))}</td>
            <td>
                <button class="exp-icon-btn exp-icon-btn-danger" onclick="deleteOverheadExpense('${_esc(ex.id)}')" title="Delete">
                    <i data-lucide="trash-2" style="width:14px;height:14px;stroke:currentColor;"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Modal ──────────────────────────────────────────────────────
function openOverheadModal() {
    const modal = document.getElementById('overheadAddModal');
    if (!modal) return;
    // Reset form
    const form = document.getElementById('overheadExpenseForm');
    if (form) form.reset();
    // Default date to today
    const dateEl = document.getElementById('ovhdExpDate');
    if (dateEl) {
        const now = new Date();
        const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        dateEl.value = today;
    }
    modal.classList.add('active');
}

function closeOverheadModal() {
    const modal = document.getElementById('overheadAddModal');
    if (modal) modal.classList.remove('active');
}

// ── Add ────────────────────────────────────────────────────────
async function handleAddOverheadExpense(e) {
    if (e) e.preventDefault();
    if (!currentUser) return;

    const category    = document.getElementById('ovhdExpCategory')?.value?.trim();
    const amountRaw   = document.getElementById('ovhdExpAmount')?.value?.replace(/,/g, '').trim();
    const date        = document.getElementById('ovhdExpDate')?.value?.trim();
    const description = document.getElementById('ovhdExpDescription')?.value?.trim();

    if (!category)  { _ovhdToast('Please select a category.', 'error'); return; }
    if (!amountRaw || isNaN(amountRaw) || parseFloat(amountRaw) <= 0) {
        _ovhdToast('Please enter a valid amount.', 'error'); return;
    }
    if (!date)      { _ovhdToast('Please select a date.', 'error'); return; }

    const btn = document.getElementById('ovhdSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
        const ref = await db.collection('overheadExpenses').add({
            userId:      _ovhdUid(),
            category:    category,
            amount:      parseFloat(amountRaw),
            date:        date,
            description: description || '',
            createdAt:   firebase.firestore.FieldValue.serverTimestamp()
        });
        // Immediately update local array so UI reflects change without needing index
        _ovhdExpenses.unshift({
            id:          ref.id,
            userId:      _ovhdUid(),
            category:    category,
            amount:      parseFloat(amountRaw),
            date:        date,
            description: description || ''
        });
        closeOverheadModal();
        _ovhdToast('Overhead expense added.');
        // Sync month picker to the new entry's month
        if (date && date.length >= 7) {
            _ovhdMonth = date.substring(0, 7);
            const picker = document.getElementById('ovhdMonthPicker');
            if (picker) picker.value = _ovhdMonth;
        }
        _ovhdRender();
    } catch(err) {
        console.error('handleAddOverheadExpense:', err);
        _ovhdToast('Error saving expense: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
    }
}

// ── Category Detail Modal ──────────────────────────────────────
function openCategoryDetail(cat, color) {
    const modal = document.getElementById('ovhdCatDetailModal');
    if (!modal) return;

    // All entries for this category across ALL months
    const allEntries = _ovhdExpenses.filter(ex =>
        (ex.category || 'Uncategorized') === cat && ex.date
    );

    // Group by month (YYYY-MM), sorted oldest → newest
    const monthMap = {};
    allEntries.forEach(ex => {
        const ym = String(ex.date).substring(0, 7);
        if (!monthMap[ym]) monthMap[ym] = [];
        monthMap[ym].push(ex);
    });
    const months = Object.keys(monthMap).sort();

    // Per-month totals
    const monthTotals = {};
    months.forEach(ym => {
        monthTotals[ym] = monthMap[ym].reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    });

    const allTimeTotal  = Object.values(monthTotals).reduce((a, b) => a + b, 0);
    const allTimeCount  = allEntries.length;
    const monthsTracked = months.length;
    const avgPerMonth   = monthsTracked > 0 ? allTimeTotal / monthsTracked : 0;

    // Header
    const titleEl = document.getElementById('ovhdCatDetailTitle');
    titleEl.textContent = cat;
    titleEl.style.borderLeft = `4px solid ${color}`;
    titleEl.style.paddingLeft = '10px';

    // All-time summary strip
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

    // Monthly breakdown — newest first for display
    const displayMonths = [...months].reverse();
    const monthlyHTML = displayMonths.map((ym, i) => {
        const prevYm    = months[months.length - 1 - i - 1]; // previous in ascending order
        const curr      = monthTotals[ym];
        const prev      = prevYm ? monthTotals[prevYm] : 0;
        const trend     = _ovhdTrendHTML(curr, prev);
        const entries   = monthMap[ym];
        const entryRows = entries
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map(ex => `
            <tr class="ovhd-detail-entry-row">
                <td style="padding-left:2rem;color:#6b7280;font-size:0.8rem;">${ex.date ? ex.date.substring(0, 10) : '—'}</td>
                <td style="color:#6b7280;font-size:0.8rem;">${_esc(ex.description || '—')}</td>
                <td class="ovhd-amt-cell" style="font-size:0.8rem;">${_fmtAmt(parseFloat(ex.amount || 0))}</td>
            </tr>`).join('');

        const [y, m] = ym.split('-');
        const monthName = new Date(parseInt(y), parseInt(m) - 1, 1)
            .toLocaleString('en-PH', { month: 'long', year: 'numeric' });

        return `
        <tr class="ovhd-detail-month-row">
            <td>
                <div class="ovhd-detail-month-label">
                    <span class="ovhd-detail-month-name">${monthName}</span>
                    <span class="ovhd-detail-entry-count">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</span>
                </div>
            </td>
            <td>
                <div class="ovhd-detail-month-trend">
                    ${trend}
                </div>
            </td>
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

// ── Delete ─────────────────────────────────────────────────────
async function deleteOverheadExpense(id) {
    if (!id) return;
    if (!await showDeleteConfirm('Delete this overhead expense?')) return;
    try {
        await db.collection('overheadExpenses').doc(id).delete();
        _ovhdExpenses = _ovhdExpenses.filter(e => e.id !== id);
        _ovhdRender();
        _ovhdToast('Expense deleted.');
    } catch(err) {
        console.error('deleteOverheadExpense:', err);
        _ovhdToast('Error deleting expense: ' + err.message, 'error');
    }
}
