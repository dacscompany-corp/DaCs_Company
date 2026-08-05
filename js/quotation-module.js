/* ════════════════════════════════════════════════════════════════════
   QUOTATION MODULE — outgoing client quotations / project estimates.

   A quotation is a SALES document produced BEFORE any project exists.
   DELIBERATELY ISOLATED (migration 0045, same rule as 0041 / 0043):
   nothing here writes to folders, construction_projects, invoices,
   payment_requests, expenses, payroll or boq_documents, and no money
   math reads `quotations`. Marking a quote WON changes a status string
   and nothing else.

   Owner-only. Every meaningful figure is a peso amount.
   ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ==== QT CALC ENGINE START ====
    // Pure functions only — no DOM, no network, no module state. They are
    // extracted and unit-tested by tests/quotation.test.js. Keep them that
    // way: anything that touches qtState or the DOM belongs below the END
    // marker, or the tests stop being able to load this block.

    function qtParseNum(v) {
        if (v === null || v === undefined || v === '') return 0;
        const n = parseFloat(String(v).replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
    }

    function qtFmt(n) {
        return Number(qtParseNum(n)).toLocaleString('en-PH',
            { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function qtEscHtml(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Local date key. NEVER toISOString().slice(0,10) — PH is UTC+8 and
    // that rolls the key back a day (see CLAUDE.md).
    function qtTodayKey() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    // Only a `normal` line contributes. optional / waived / removed all
    // count zero — but the row KEEPS its qty and unitPrice, which is what
    // lets qtDiffSnapshots value a deletion.
    function qtLineAmount(line) {
        if (!line || (line.state && line.state !== 'normal')) return 0;
        return qtParseNum(line.qty) * qtParseNum(line.unitPrice);
    }

    function qtGroupTotal(group) {
        return ((group && group.lines) || []).reduce((s, l) => s + qtLineAmount(l), 0);
    }

    // Lump rules (spec §7): a section's own lumpAmount WINS and the group
    // amounts beneath it are a display breakdown that must not re-add —
    // the reference document's REPAIR SERVICE 200,126 = KIOSK 92,707 +
    // ELECTRICAL 107,419 shape. With no section amount, groups sum.
    function qtSectionTotal(section) {
        if (!section) return 0;
        const groups = section.groups || [];
        if (section.pricing === 'lump') {
            if (section.lumpAmount !== '' && section.lumpAmount !== null &&
                section.lumpAmount !== undefined) return qtParseNum(section.lumpAmount);
            return groups.reduce((s, g) => s + qtParseNum(g.lumpAmount), 0);
        }
        return groups.reduce((s, g) => s + qtGroupTotal(g), 0);
    }

    function qtProjectCost(sections) {
        return (sections || []).reduce((s, sec) => s + qtSectionTotal(sec), 0);
    }

    function qtDiscountAmount(q) {
        const pc = qtProjectCost(q && q.sections);
        return (q && q.discountType === 'percent')
            ? pc * (qtParseNum(q.discount) / 100)
            : qtParseNum(q && q.discount);
    }

    function qtSubTotal(q) {
        return Math.max(0, qtProjectCost(q && q.sections) - qtDiscountAmount(q));
    }

    // exclusive → computed on the DISCOUNTED sub-total and added.
    // inclusive → the component already inside the sub-total.
    // none      → zero; the sheet prints "VAT not applicable".
    function qtVatAmount(q) {
        const st = qtSubTotal(q), pct = qtParseNum(q && q.vatPct);
        if (!q || q.vatMode === 'none' || !q.vatMode) return 0;
        if (q.vatMode === 'exclusive') return st * (pct / 100);
        return st - (st / (1 + pct / 100));
    }

    function qtGrandTotal(q) {
        return (q && q.vatMode === 'exclusive') ? qtSubTotal(q) + qtVatAmount(q) : qtSubTotal(q);
    }

    // Computed, never stored — so extending the validity date fixes it and
    // no cron is needed. String compare is safe on YYYY-MM-DD keys.
    function qtIsExpired(q) {
        return !!(q && q.status === 'sent' && q.validUntil && q.validUntil < qtTodayKey());
    }

    function qtNextQuoteNo(list) {
        const yr = new Date().getFullYear(), pre = `Q-${yr}-`;
        const max = (list || []).reduce((m, q) => {
            const no = (q && q.quoteNo) || '';
            if (!no.startsWith(pre)) return m;
            const n = parseInt(no.slice(pre.length), 10);
            return isNaN(n) ? m : Math.max(m, n);
        }, 0);
        return pre + String(max + 1).padStart(4, '0');
    }

    function qtFlattenLines(sections) {
        const out = [];
        (sections || []).forEach(sec => (sec.groups || []).forEach(g =>
            (g.lines || []).forEach(l => out.push({
                id: l.id,
                path: `${sec.label || ''} › ${g.label || ''}`,
                description: l.description, qty: l.qty, unit: l.unit,
                unitPrice: l.unitPrice, state: l.state || 'normal',
                amount: qtLineAmount(l)
            }))));
        return out;
    }

    // Matches lines by their stable id across two snapshots.
    function qtDiffSnapshots(prev, curr) {
        const a = new Map(qtFlattenLines(prev && prev.sections).map(l => [l.id, l]));
        const b = new Map(qtFlattenLines(curr && curr.sections).map(l => [l.id, l]));
        const added = [], removed = [], changed = [];
        b.forEach((l, id) => { if (!a.has(id)) added.push(l); });
        a.forEach((l, id) => { if (!b.has(id)) removed.push(l); });
        b.forEach((l, id) => {
            const o = a.get(id);
            if (!o) return;
            if (o.qty !== l.qty || o.unitPrice !== l.unitPrice ||
                o.state !== l.state || o.description !== l.description) {
                changed.push({ id, from: o, to: l, delta: l.amount - o.amount });
            }
        });
        return { added, removed, changed,
                 delta: qtParseNum(curr && curr.totalAmount) - qtParseNum(prev && prev.totalAmount) };
    }
    // ==== QT CALC ENGINE END ====

    // Expose the calc engine for the rest of the module and the console.
    Object.assign(window, {
        qtParseNum, qtFmt, qtEscHtml, qtTodayKey, qtLineAmount, qtGroupTotal,
        qtSectionTotal, qtProjectCost, qtDiscountAmount, qtSubTotal,
        qtVatAmount, qtGrandTotal, qtIsExpired, qtNextQuoteNo,
        qtFlattenLines, qtDiffSnapshots
    });

    // ── State ─────────────────────────────────────────────────────────
    const qtState = {
        list:      [],     // all live quotations for this owner
        presets:   [],     // client + scope presets
        current:   null,   // the quotation open in the editor
        revisions: [],     // revisions of the current quotation
        filters:   { status: 'all', year: 'all', search: '' },
        isDirty:   false,
        unsub:     null,
        revUnsub:  null
    };

    function qtUid() {
        return (window.auth && window.auth.currentUser && window.auth.currentUser.uid) || null;
    }
    // Owner-only. Staff are already blocked in _visibleNav and switchView;
    // this is the module's own third gate (RLS is the fourth).
    function qtIsOwner() {
        return typeof window.currentUserRole === 'undefined'
            || window.currentUserRole === null
            || window.currentUserRole === 'owner';
    }
    function qtEl(id) { return document.getElementById(id); }

    function qtToast(msg, type) {
        let t = qtEl('qtToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'qtToast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.className = 'qt-toast qt-toast-show' + (type === 'error' ? ' qt-toast-error' : '');
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove('qt-toast-show'), 3200);
    }

    // Stable ids for tree nodes. The revision diff matches lines by these,
    // so they must survive a save/load round-trip — never regenerate them.
    function qtNewId() {
        return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // Display status. 'expired' is DERIVED, never stored — extending the
    // validity date fixes it and no cron is needed.
    function qtStatusOf(q) { return qtIsExpired(q) ? 'expired' : (q.status || 'draft'); }

    function qtIsOverdue(q) {
        return q.status === 'sent' && q.followUpDate && q.followUpDate < qtTodayKey();
    }

    function qtLoadList() {
        if (qtState.unsub) { qtState.unsub(); qtState.unsub = null; }
        qtState.unsub = db.collection('quotations')
            .where('userId', '==', qtUid())
            .onSnapshot(snap => {
                qtState.list = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(q => !q.deletedAt);          // soft delete
                if (!qtState.current) qtRenderList();
            }, err => {
                console.error('[QT] list load error:', err);
                qtToast('Could not load quotations: ' + err.message, 'error');
            });

        if (typeof window.registerViewCleanup === 'function') {
            window.registerViewCleanup(() => {
                if (qtState.unsub)    { qtState.unsub();    qtState.unsub = null; }
                if (qtState.revUnsub) { qtState.revUnsub(); qtState.revUnsub = null; }
            });
        }
    }

    // Win rate deliberately ignores draft/sent — an undecided quote is not
    // a loss. Pending value excludes expired quotes: an expired price is
    // not a live opportunity.
    function qtPipelineStats(list) {
        const yr = new Date().getFullYear();
        const s = { draft: 0, sent: 0, won: 0, lost: 0, expired: 0,
                    pendingValue: 0, wonValueYear: 0, winRate: 0, overdue: 0 };
        (list || []).forEach(q => {
            const st = qtStatusOf(q);
            s[st] = (s[st] || 0) + 1;
            if (st === 'sent') s.pendingValue += qtParseNum(q.totalAmount);
            if (q.status === 'won' && String(q.quoteDate || '').startsWith(String(yr))) {
                s.wonValueYear += qtParseNum(q.totalAmount);
            }
            if (qtIsOverdue(q)) s.overdue++;
        });
        const decided = s.won + s.lost;
        s.winRate = decided ? (s.won / decided) * 100 : 0;
        return s;
    }

    function qtFilteredList() {
        const f = qtState.filters, term = (f.search || '').toLowerCase();
        return qtState.list
            .filter(q => f.status === 'all' || qtStatusOf(q) === f.status)
            .filter(q => f.year === 'all' || String(q.quoteDate || '').startsWith(f.year))
            .filter(q => !term
                || (q.quoteNo     || '').toLowerCase().includes(term)
                || (q.clientName  || '').toLowerCase().includes(term)
                || (q.projectName || '').toLowerCase().includes(term))
            // Overdue follow-ups pinned to the top, then newest first.
            .sort((a, b) => (qtIsOverdue(b) - qtIsOverdue(a))
                         || String(b.quoteDate || '').localeCompare(String(a.quoteDate || '')));
    }

    function qtRenderList() {
        const root = qtEl('quoteListView');
        if (!root) return;
        const stats = qtPipelineStats(qtState.list);
        const rows  = qtFilteredList();
        const years = [...new Set(qtState.list.map(q => String(q.quoteDate || '').slice(0, 4)).filter(Boolean))].sort().reverse();

        root.innerHTML = `
        <div class="qt-header">
            <div>
                <h2 class="qt-title">Quotations</h2>
                <p class="qt-sub">Client estimates and proposals${stats.overdue ? ` · <strong>${stats.overdue} follow-up${stats.overdue > 1 ? 's' : ''} overdue</strong>` : ''}</p>
            </div>
            <button class="qt-btn qt-btn-primary" onclick="qtNewQuote()">+ New Quotation</button>
        </div>

        <div class="qt-stats">
            ${qtStatCard('Draft',        stats.draft)}
            ${qtStatCard('Sent',         stats.sent)}
            ${qtStatCard('Expired',      stats.expired)}
            ${qtStatCard('Won',          stats.won)}
            ${qtStatCard('Lost',         stats.lost)}
            ${qtStatCard('Win rate',     stats.winRate.toFixed(0) + '%')}
            ${qtStatCard('Pending value','₱' + qtFmt(stats.pendingValue))}
            ${qtStatCard('Won this year','₱' + qtFmt(stats.wonValueYear))}
        </div>

        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem;">
            <select class="qt-btn" onchange="qtSetFilter('status', this.value)">
                ${['all','draft','sent','expired','won','lost'].map(v =>
                    `<option value="${v}"${qtState.filters.status === v ? ' selected' : ''}>${v === 'all' ? 'All statuses' : v}</option>`).join('')}
            </select>
            <select class="qt-btn" onchange="qtSetFilter('year', this.value)">
                <option value="all">All years</option>
                ${years.map(y => `<option value="${y}"${qtState.filters.year === y ? ' selected' : ''}>${y}</option>`).join('')}
            </select>
            <input class="qt-btn" style="font-weight:400;" placeholder="Search no. / client / project"
                   value="${qtEscHtml(qtState.filters.search)}"
                   oninput="qtSetFilter('search', this.value)">
        </div>

        ${rows.length ? `
        <table class="qt-table">
            <thead><tr>
                <th>Quote No.</th><th>Client</th><th>Project</th>
                <th>Date</th><th>Valid until</th><th class="qt-amt">Total</th>
                <th>Status</th><th></th>
            </tr></thead>
            <tbody>${rows.map(qtListRow).join('')}</tbody>
        </table>` : `
        <div class="qt-empty">
            <p><strong>No quotations yet</strong></p>
            <p>Create one to send a client an itemized estimate.</p>
        </div>`}`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function qtStatCard(label, value) {
        return `<div class="qt-stat"><div class="qt-stat-label">${label}</div><div class="qt-stat-value">${value}</div></div>`;
    }

    function qtListRow(q) {
        const st = qtStatusOf(q);
        return `<tr class="${qtIsOverdue(q) ? 'qt-row-overdue' : ''}">
            <td><strong>${qtEscHtml(q.quoteNo || '—')}</strong>${(q.revNo || 1) > 1 ? ` <span class="qt-sub">Rev ${q.revNo}</span>` : ''}</td>
            <td>${qtEscHtml(q.clientName || '—')}</td>
            <td>${qtEscHtml(q.projectName || '—')}</td>
            <td>${qtEscHtml(q.quoteDate || '—')}</td>
            <td>${qtEscHtml(q.validUntil || '—')}${qtIsOverdue(q) ? ' <span class="qt-pill qt-pill-expired">follow up</span>' : ''}</td>
            <td class="qt-amt">₱${qtFmt(q.totalAmount)}</td>
            <td><span class="qt-pill qt-pill-${st}">${st}</span></td>
            <td><button class="qt-btn" onclick="qtOpenQuote('${q.id}')">Open</button></td>
        </tr>`;
    }

    window.qtSetFilter = function (key, value) {
        qtState.filters[key] = value;
        qtRenderList();
    };
    // Replaced with the real editor in Task 5.
    window.qtOpenQuote = function (id) { console.log('[QT] open', id); };
    window.qtNewQuote  = function () { console.log('[QT] new'); };

    window.initQuotationModule = function (view) {
        if (!qtUid() || !qtIsOwner()) return;
        qtLoadList();
        if (view === 'quoteList' || !view) qtRenderList();
    };

    Object.assign(window, { qtToast, qtNewId });

})();
