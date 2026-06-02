// ════════════════════════════════════════════════════════════
// PAYMENT REPORTS MODULE (Admin)
// Analytics dashboard: KPIs, charts, per-client summary, CSV export.
// ════════════════════════════════════════════════════════════

(function () {
    'use strict';

    let _allRequests   = [];
    let _loading       = false;
    let _trendChart    = null;
    let _statusChart   = null;
    let _selectedMonth = ''; // '' = all time, 'YYYY-MM' = filtered month

    // ══════════════════════════════════════════════════════
    // PUBLIC ENTRY POINT
    // ══════════════════════════════════════════════════════

    window.initPaymentReports = function () {
        if (_loading) return;
        // Scroll main content area to top on every visit
        const mainContent = document.querySelector('.main-content') || document.querySelector('.content-area') || document.documentElement;
        if (mainContent) mainContent.scrollTop = 0;
        // If data already loaded, just re-render (charts may need resize after view switch)
        if (_allRequests.length > 0) {
            _render();
            return;
        }
        _loadData();
    };

    // ══════════════════════════════════════════════════════
    // DATA LOADING
    // ══════════════════════════════════════════════════════

    async function _loadData() {
        _loading = true;
        _showLoading(true);
        try {
            // Scope to this owner's data — see payment-requests.js _loadRequests
            // for the same pattern + reasoning. Without this filter Payment
            // Reports loaded every paymentRequest doc visible to the user.
            const uid = window.currentDataUserId || firebase.auth().currentUser?.uid;
            if (!uid) {
                _loading = false;
                _showLoading(false);
                _allRequests = [];
                requestAnimationFrame(_render);
                return;
            }
            const snap = await db.collection('paymentRequests')
                .where('ownerUid', '==', uid)
                .get();
            _allRequests = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _loading = false;
            _showLoading(false);
            // Give browser one frame to paint the content div before rendering charts
            requestAnimationFrame(_render);
        } catch (e) {
            _loading = false;
            _showLoading(false);
            console.error('PaymentReports: load error', e);
            const errEl = document.getElementById('rptLoading');
            if (errEl) errEl.innerHTML = `<div style="text-align:center;"><p style="color:#b91c1c;font-weight:600;">Could not load report data.</p><p style="font-size:13px;color:#6b7280;">${_esc(e.message)}</p></div>`;
        }
    }

    window.prRefreshReports = function () {
        _allRequests = [];
        _loading = false;
        _loadData();
    };

    // ══════════════════════════════════════════════════════
    // RENDER
    // ══════════════════════════════════════════════════════

    function _render() {
        _populateMonthFilter();
        _renderKPIs();
        _renderClientTable();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        // Defer chart init to next paint frame so the parent containers
        // have a computed height (required for maintainAspectRatio: false)
        requestAnimationFrame(() => {
            _renderTrendChart();
            _renderStatusChart();
        });
    }

    // ══════════════════════════════════════════════════════
    // MONTH FILTER HELPERS
    // ══════════════════════════════════════════════════════

    function _getMonthKey(r) {
        const ms = _tsToMs(r.createdAt) || _tsToMs(r.dueDate) || _tsToMs(r.updatedAt);
        if (!ms) return null;
        const d = new Date(ms);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    }

    function _filterRequests() {
        if (!_selectedMonth) return _allRequests;
        return _allRequests.filter(r => _getMonthKey(r) === _selectedMonth);
    }

    function _populateMonthFilter() {
        const sel = document.getElementById('rptMonthFilter');
        if (!sel) return;
        const months = new Set();
        _allRequests.forEach(r => { const k = _getMonthKey(r); if (k) months.add(k); });
        const sorted = [...months].sort().reverse();
        sel.innerHTML = '<option value="">All Months</option>'
            + sorted.map(m => {
                const [y, mo] = m.split('-');
                const label = new Date(+y, +mo - 1, 1)
                    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                return `<option value="${m}" ${m === _selectedMonth ? 'selected' : ''}>${label}</option>`;
            }).join('');
    }

    window.rptOnMonthChange = function (val) {
        _selectedMonth = val;
        _renderKPIs();
        _renderClientTable();
        requestAnimationFrame(() => {
            _renderTrendChart();
            _renderStatusChart();
        });
    };

    // ══════════════════════════════════════════════════════
    // KPI CARDS
    // ══════════════════════════════════════════════════════

    function _renderKPIs() {
        const now      = Date.now();
        const requests = _filterRequests();
        let totalBilled = 0, totalCollected = 0, outstanding = 0, overdue = 0;

        requests.forEach(r => {
            const amt = r.amount || 0;
            totalBilled += amt;

            if (r.status === 'verified') {
                totalCollected += (r.paidAmount != null ? r.paidAmount : amt);
            } else if (r.status !== 'rejected') {
                outstanding += amt;
                const dueMs = _tsToMs(r.dueDate);
                if (dueMs && dueMs < now) overdue += amt;
            }
        });

        const rate = totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : '0.0';

        _setText('rptTotalBilled',    _fmt(totalBilled));
        _setText('rptTotalCollected', _fmt(totalCollected));
        _setText('rptOutstanding',    _fmt(outstanding));
        _setText('rptOverdue',        _fmt(overdue));
        _setText('rptCollectionRate', rate + '%');

        // Colour the overdue card red if there's any overdue amount
        const overdueCard = document.getElementById('rptOverdueCard');
        if (overdueCard) overdueCard.classList.toggle('rpt-kpi-cell--danger', overdue > 0);

        // Remaining Allocation card
        const remainingEl = document.getElementById('rptRemainingAmt');
        if (remainingEl) remainingEl.textContent = _fmt(outstanding);

        // Expense Coverage — red when collected exceeds billed (>100%) or when
        // outstanding > collected (expenses exceed what's been funded)
        const coveragePct = totalBilled > 0
            ? ((totalCollected / totalBilled) * 100).toFixed(1)
            : '0.0';
        const coverageEl = document.getElementById('rptExpenseCoverage');
        if (coverageEl) {
            coverageEl.textContent = coveragePct + '%';
            const isOver = parseFloat(coveragePct) > 100;
            coverageEl.classList.toggle('rpt-remaining-amt--red', isOver);
        }
    }

    // ══════════════════════════════════════════════════════
    // MONTHLY TREND CHART
    // ══════════════════════════════════════════════════════

    function _renderTrendChart() {
        const ctx = document.getElementById('prTrendChart');
        if (!ctx) return;

        const wrap = ctx.closest('.rpt-chart-wrap');
        if (wrap) wrap.style.position = 'relative'; // ensure absolute children work

        function _showTrendEmpty(msg, sub) {
            if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
            ctx.style.display = 'none';
            if (!wrap) return;
            let nd = wrap.querySelector('.rpt-no-data');
            if (!nd) { nd = document.createElement('div'); nd.className = 'rpt-no-data'; wrap.appendChild(nd); }
            nd.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:16px;';
            nd.innerHTML = '<i data-lucide="bar-chart-2" style="width:36px;height:36px;color:#d1d5db;display:block;margin:0 auto 10px;"></i>'
                + '<div style="color:#6b7280;font-size:14px;font-weight:600;margin-bottom:4px;">' + msg + '</div>'
                + '<div style="color:#9ca3af;font-size:12px;">' + sub + '</div>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        try {
            const requests = _filterRequests();
            const monthly = {};
            requests.forEach(r => {
                if (r.status !== 'verified') return;
                const ms = _tsToMs(r.verifiedAt) || _tsToMs(r.createdAt)
                         || _tsToMs(r.updatedAt)  || _tsToMs(r.dueDate);
                if (!ms) return;
                const d   = new Date(ms);
                const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                monthly[key] = (monthly[key] || 0) + (r.paidAmount != null ? +r.paidAmount : +(r.amount || 0));
            });

            const keys = Object.keys(monthly).sort().slice(-12);

            if (!keys.length) {
                _showTrendEmpty('No trend data yet', 'Verified payments need a date to appear here');
                return;
            }

            const labels = keys.map(k => {
                const [y, m] = k.split('-');
                try {
                    return new Date(+y, +m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
                } catch(e) { return k; }
            });
            const data = keys.map(k => monthly[k]);

            if (_trendChart) { _trendChart.destroy(); _trendChart = null; }
            ctx.style.display = '';
            if (wrap) { const nd = wrap.querySelector('.rpt-no-data'); if (nd) nd.remove(); }

            // Force synchronous layout so Chart.js reads correct canvas dimensions
            const _w = wrap ? wrap.offsetWidth : (ctx.parentElement ? ctx.parentElement.offsetWidth : 0);
            const _h = wrap ? wrap.offsetHeight : 240;
            if (_w > 0) {
                ctx.width  = _w;
                ctx.height = _h || 240;
            }

        _trendChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Collected (₱)',
                    data,
                    backgroundColor: 'rgba(0,168,94,0.75)',
                    borderColor:     '#00a85e',
                    borderWidth:     1.5,
                    borderRadius:    6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: c => '₱ ' + c.parsed.y.toLocaleString('en-PH', { minimumFractionDigits: 2 })
                        }
                    }
                },
                scales: {
                    y: {
                        ticks: { callback: v => '₱' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) },
                        grid:  { color: '#f3f4f6' }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
        } catch (err) {
            console.error('PaymentReports: trend chart error', err);
            _showTrendEmpty('Chart error', err.message || 'Could not render trend chart');
        }
    }

    // ══════════════════════════════════════════════════════
    // STATUS BREAKDOWN CHART
    // ══════════════════════════════════════════════════════

    function _renderStatusChart() {
        const c = { pending: 0, partial_pending: 0, submitted: 0, verified: 0, rejected: 0 };
        _filterRequests().forEach(r => { if (c[r.status] !== undefined) c[r.status]++; });

        const ctx = document.getElementById('rptStatusChart');
        if (!ctx) return;
        if (_statusChart) { _statusChart.destroy(); _statusChart = null; }

        _statusChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels:   ['Pending', 'Awaiting Approval', 'Under Review', 'Paid', 'Rejected'],
                datasets: [{
                    data: [c.pending, c.partial_pending, c.submitted, c.verified, c.rejected],
                    backgroundColor: ['#fbbf24', '#f97316', '#3b82f6', '#00a85e', '#ef4444'],
                    borderWidth:     2,
                    borderColor:     '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels:   { font: { size: 12 }, padding: 14, boxWidth: 14 }
                    }
                }
            }
        });
    }

    // ══════════════════════════════════════════════════════
    // PER-CLIENT SUMMARY TABLE
    // ══════════════════════════════════════════════════════

    function _renderClientTable() {
        const clients = {};

        _filterRequests().forEach(r => {
            const key = r.clientEmail || 'unknown';
            if (!clients[key]) {
                clients[key] = {
                    name:     r.clientName || _nameFromEmail(r.clientEmail || ''),
                    email:    r.clientEmail || '—',
                    requests: []
                };
            }
            clients[key].requests.push(r);
        });

        const tbody = document.getElementById('rptClientTbody');
        if (!tbody) return;

        const rows = Object.values(clients).sort((a, b) => a.name.localeCompare(b.name));

        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:28px;">No payment data yet.</td></tr>';
            return;
        }

        const now = Date.now();

        tbody.innerHTML = rows.map(c => {
            const totalBilled = c.requests.reduce((s, r) => s + (r.amount || 0), 0);
            const totalPaid   = c.requests
                .filter(r => r.status === 'verified')
                .reduce((s, r) => s + (r.paidAmount != null ? r.paidAmount : (r.amount || 0)), 0);
            const outstanding = totalBilled - totalPaid;
            const overdueCount = c.requests.filter(r =>
                r.status !== 'verified' && _tsToMs(r.dueDate) && _tsToMs(r.dueDate) < now
            ).length;
            const lastMs = c.requests
                .map(r => _tsToMs(r.verifiedAt || r.submittedAt || r.createdAt))
                .reduce((a, b) => Math.max(a, b), 0);
            const lastDate = lastMs
                ? new Date(lastMs).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—';

            const initials = (c.name[0] || 'C').toUpperCase();
            const overdueHtml = overdueCount > 0
                ? `<span class="rpt-overdue-pill">${overdueCount} Overdue</span>`
                : '<span style="color:#9ca3af;">—</span>';
            const idx = rows.indexOf(c);

            return `
            <tr class="rpt-client-row">
                <td>
                    <div class="rpt-client-cell">
                        <div class="rpt-avatar">${initials}</div>
                        <div>
                            <div class="rpt-client-name">${_esc(c.name)}</div>
                            <div class="rpt-client-email">${_esc(c.email)}</div>
                        </div>
                    </div>
                </td>
                <td class="rpt-td-center">${c.requests.length}</td>
                <td class="rpt-td-amt">${_fmt(totalBilled)}</td>
                <td class="rpt-td-amt rpt-collected">${_fmt(totalPaid)}</td>
                <td class="rpt-td-amt ${outstanding > 0.01 ? 'rpt-outstanding' : 'rpt-zero'}">${_fmt(outstanding)}</td>
                <td class="rpt-td-center">${overdueHtml}</td>
                <td class="rpt-td-date">${lastDate}</td>
                <td class="rpt-td-center">
                    <button class="rpt-view-btn" onclick="window.rptViewClientReceipts(${idx})">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        View
                    </button>
                </td>
            </tr>`;
        }).join('');

        // Store rows for modal access
        tbody._rptRows = rows;
    }

    // ══════════════════════════════════════════════════════
    // CLIENT RECEIPTS MODAL
    // ══════════════════════════════════════════════════════

    window.rptViewClientReceipts = function (idx) {
        const tbody = document.getElementById('rptClientTbody');
        const rows  = tbody && tbody._rptRows;
        if (!rows) return;
        const c = rows[idx];
        if (!c) return;

        document.getElementById('clientReceiptsTitle').textContent = c.name;
        document.getElementById('clientReceiptsEmail').textContent = c.email;

        const statusLabel = { pending: 'Pending', partial_pending: 'Awaiting Approval', partial_approved: 'Partial Approved', submitted: 'Under Review', verified: 'Paid', rejected: 'Rejected' };
        const statusColor = { pending: '#f59e0b', partial_pending: '#f97316', partial_approved: '#3b82f6', submitted: '#3b82f6', verified: '#059669', rejected: '#dc2626' };

        const sorted = [...c.requests].sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));

        document.getElementById('clientReceiptsTbody').innerHTML = sorted.map(r => {
            const dueMs  = _tsToMs(r.dueDate);
            const dueStr = dueMs ? new Date(dueMs).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
            const st     = r.status || 'pending';
            const color  = statusColor[st] || '#6b7280';
            const label  = statusLabel[st]  || st;
            const paid   = r.status === 'verified' ? (r.paidAmount != null ? r.paidAmount : (r.amount || 0)) : null;
            return `
            <tr style="border-bottom:1px solid #f3f4f6;">
                <td style="padding:10px 14px;color:#111827;font-weight:600;">${_esc(r.billingPeriod || '—')}</td>
                <td style="padding:10px 14px;color:#6b7280;">${_esc(r.projectName || '—')}</td>
                <td style="padding:10px 14px;text-align:right;font-weight:600;">${_fmt(r.amount || 0)}</td>
                <td style="padding:10px 14px;text-align:right;color:#059669;font-weight:600;">${paid !== null ? _fmt(paid) : '<span style="color:#9ca3af;">—</span>'}</td>
                <td style="padding:10px 14px;text-align:center;color:#6b7280;">${dueStr}</td>
                <td style="padding:10px 14px;text-align:center;">
                    <span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;background:${color}18;color:${color};">${label}</span>
                </td>
            </tr>`;
        }).join('');

        openExpModal('clientReceiptsModal');
    };

    // ══════════════════════════════════════════════════════
    // CSV EXPORT
    // ══════════════════════════════════════════════════════

    window.prExportReportCSV = function () {
        const clients = {};
        const now = Date.now();

        _allRequests.forEach(r => {
            const key = r.clientEmail || 'unknown';
            if (!clients[key]) clients[key] = { name: r.clientName || _nameFromEmail(r.clientEmail || ''), email: r.clientEmail || '', requests: [] };
            clients[key].requests.push(r);
        });

        let csv = 'Client Name,Email,Total Requests,Total Billed (PHP),Total Collected (PHP),Outstanding (PHP),Overdue Count\n';

        Object.values(clients)
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(c => {
                const totalBilled = c.requests.reduce((s, r) => s + (r.amount || 0), 0);
                const totalPaid   = c.requests.filter(r => r.status === 'verified')
                    .reduce((s, r) => s + (r.paidAmount != null ? r.paidAmount : (r.amount || 0)), 0);
                const outstanding = totalBilled - totalPaid;
                const overdueCount = c.requests.filter(r =>
                    r.status !== 'verified' && _tsToMs(r.dueDate) && _tsToMs(r.dueDate) < now
                ).length;
                csv += `"${c.name.replace(/"/g, '""')}","${c.email}",${c.requests.length},${totalBilled.toFixed(2)},${totalPaid.toFixed(2)},${outstanding.toFixed(2)},${overdueCount}\n`;
            });

        const dateStr = new Date().toISOString().slice(0, 10);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `payment-report-${dateStr}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // ══════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════

    function _showLoading(on) {
        const loading = document.getElementById('rptLoading');
        const content = document.getElementById('rptContent');
        if (loading) loading.style.display = on ? 'flex' : 'none';
        if (content) content.style.display = on ? 'none' : 'block';
    }

    function _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function _fmt(n) {
        return '₱ ' + (n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function _nameFromEmail(email) {
        return (email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function _tsToMs(ts) {
        if (!ts) return 0;
        if (typeof ts.toDate === 'function') return ts.toDate().getTime();
        if (ts instanceof Date) return ts.getTime();
        if (typeof ts === 'number') return ts;
        return new Date(ts).getTime() || 0;
    }

})();
