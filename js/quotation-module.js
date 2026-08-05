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

    // ── Step 1: Blank quote factory and editor state ──────────────────
    function qtBlankQuote() {
        const today = qtTodayKey();
        const d = new Date(); d.setDate(d.getDate() + 30);
        const p = n => String(n).padStart(2, '0');
        const validUntil = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        return {
            id: null,
            quoteNo: qtNextQuoteNo(qtState.list), revNo: 1,
            quoteDate: today, validUntil,
            clientName: '', clientEmail: '', clientAddress: '', clientTin: '',
            projectName: '', location: '', subject: 'Project Estimate', scopeNote: '',
            sections: [],
            discount: 0, discountType: 'amount',
            vatMode: 'none', vatPct: 12,
            totalAmount: 0,
            status: 'draft', statusNote: '', decidedAt: null,
            followUpDate: '', followUpNote: '',
            terms: qtDefaultTerms(), preparedBy: '', history: []
        };
    }

    // Overwritten from settings/quotationDefaults in Task 8.
    function qtDefaultTerms() {
        return { validityNote: '', payment: '', deliveryTimeline: '', warranty: '',
                 exclusions: '', conditions: [], signOff: { preparedBy: true, clientApproval: true } };
    }

    function qtMarkDirty() { qtState.isDirty = true; }

    // ── Task 8: Terms defaults loader ──────────────────────────────────
    // Standard clauses are typed once and reused, following the
    // settings/invoiceDefaults precedent in labor-invoice-module.js.
    async function qtLoadDefaultTerms() {
        try {
            const doc = await db.collection('settings').doc('quotationDefaults').get();
            if (doc.exists && doc.data() && doc.data().terms) return doc.data().terms;
        } catch (e) { console.warn('[QT] no saved default terms:', e.message); }
        return null;
    }

    window.qtSaveTermsAsDefault = async function () {
        qtCollectHeader();
        try {
            // Note: `{ merge: true }` is a no-op for the kv-backed `settings` collection
            // in the Supabase shim (js/supabase-config.js) — it always fully overwrites.
            // This document only ever holds `{ userId, terms }`, so the behaviour is safe.
            await db.collection('settings').doc('quotationDefaults')
                .set({ userId: qtUid(), terms: qtState.current.terms }, { merge: true });
            qtToast('Saved as your default terms');
        } catch (e) {
            qtToast('Could not save defaults: ' + (e.message || e), 'error');
        }
    };

    // ── Step 2: Open / new / back ──────────────────────────────────────
    window.qtNewQuote = async function () {
        // Nothing is published to qtState until the defaults have loaded, so a
        // slow read can never write into a quotation the user opened meanwhile.
        const before = qtState.current;
        const fresh  = qtBlankQuote();
        const saved  = await qtLoadDefaultTerms();
        // The user navigated (opened a quote, or clicked New again) while we
        // were fetching — abandon rather than yanking them somewhere else.
        if (qtState.current !== before) return;
        if (saved) fresh.terms = saved;
        qtState.current   = fresh;
        qtState.revisions = [];
        qtState.isDirty   = false;
        switchView('quoteEditor');
        qtRenderEditor();
    };

    window.qtOpenQuote = function (id) {
        const q = qtState.list.find(x => x.id === id);
        if (!q) { qtToast('Quotation not found', 'error'); return; }
        qtState.current   = JSON.parse(JSON.stringify(q));   // edit a copy
        qtState.revisions = [];
        qtState.isDirty   = false;
        switchView('quoteEditor');
        qtRenderEditor();
        qtLoadRevisions(id);                                  // defined in Task 10
    };

    window.qtBackToList = function () {
        if (qtState.isDirty && !confirm('You have unsaved changes. Leave anyway?')) return;
        qtState.current = null;
        qtState.isDirty = false;
        switchView('quoteList');
        qtRenderList();
    };

    // ── Task 10: Revisions — snapshot on send, history, diff ────────────
    function qtLoadRevisions(quotationId) {
        if (qtState.revUnsub) { qtState.revUnsub(); qtState.revUnsub = null; }
        if (!quotationId) { qtState.revisions = []; qtRenderRevisions(); return; }
        qtState.revUnsub = db.collection('quotationRevisions')
            .where('quotationId', '==', quotationId)
            .onSnapshot(snap => {
                qtState.revisions = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => (b.revNo || 0) - (a.revNo || 0));
                qtRenderRevisions();
            }, err => console.error('[QT] revisions load error:', err));
    }

    // The frozen copy. Everything the print sheet needs to reproduce the
    // document exactly as it was sent — so a revision prints from itself,
    // never from the live record.
    function qtSnapshotOf(q) {
        return {
            quoteNo: q.quoteNo, revNo: q.revNo,
            quoteDate: q.quoteDate, validUntil: q.validUntil,
            clientName: q.clientName, clientEmail: q.clientEmail,
            clientAddress: q.clientAddress, clientTin: q.clientTin,
            projectName: q.projectName, location: q.location,
            subject: q.subject, scopeNote: q.scopeNote,
            sections: JSON.parse(JSON.stringify(q.sections || [])),
            discount: q.discount, discountType: q.discountType,
            vatMode: q.vatMode, vatPct: q.vatPct,
            totalAmount: q.totalAmount,
            terms: JSON.parse(JSON.stringify(q.terms || {})),
            preparedBy: q.preparedBy
        };
    }

    // ── Task 8: Terms editor helpers ──────────────────────────────────
    function qtTerms() {
        const q = qtState.current;
        if (!q.terms) q.terms = qtDefaultTerms();
        if (!Array.isArray(q.terms.conditions)) q.terms.conditions = [];
        if (!q.terms.signOff) q.terms.signOff = { preparedBy: true, clientApproval: true };
        return q.terms;
    }

    window.qtSetTerm = function (key, value) { qtTerms()[key] = value; qtMarkDirty(); };
    window.qtSetSignOff = function (key, on)  { qtTerms().signOff[key] = on; qtMarkDirty(); };

    window.qtAddCondition = function () {
        qtTerms().conditions.push({ title: '', body: '', include: true });
        qtMarkDirty(); qtRenderTerms();
    };
    window.qtSetCondition = function (i, field, value) {
        qtTerms().conditions[i][field] = value; qtMarkDirty();
    };
    window.qtDeleteCondition = function (i) {
        if (!confirm('Delete this condition?')) return;
        qtTerms().conditions.splice(i, 1); qtMarkDirty(); qtRenderTerms();
    };
    window.qtMoveCondition = function (i, dir) {
        const arr = qtTerms().conditions, j = i + dir;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        qtMarkDirty(); qtRenderTerms();
    };

    // ── Step 3: Header form renderer ───────────────────────────────────
    function qtField(label, key, type, extra) {
        const v = qtState.current[key];
        return `<label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;margin-bottom:.15rem;">${label}</label>
                <input class="qt-btn" style="font-weight:400;width:100%;margin-bottom:.6rem;"
                       type="${type || 'text'}" data-qt-key="${key}"
                       value="${qtEscHtml(v === null || v === undefined ? '' : v)}"
                       ${extra || ''} oninput="qtMarkDirty()">`;
    }

    function qtTermArea(label, key, hint) {
        return `<label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;margin:.6rem 0 .15rem;">${label}
                ${hint ? `<span style="font-weight:400;">— ${hint}</span>` : ''}</label>
                <textarea class="qt-btn" style="font-weight:400;width:100%;min-height:56px;"
                          oninput="qtSetTerm('${key}', this.value)">${qtEscHtml(qtTerms()[key])}</textarea>`;
    }

    function qtRenderTerms() {
        const pane = qtEl('qtTermsPane');
        if (!pane || !qtState.current) return;
        const t = qtTerms();
        pane.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <h3 style="font-size:.95rem;margin:0;">Terms &amp; conditions</h3>
                <button class="qt-btn" onclick="qtSaveTermsAsDefault()">Save as my defaults</button>
            </div>
            ${qtTermArea('Validity',          'validityNote',     'e.g. valid for thirty (30) calendar days from issuance')}
            ${qtTermArea('Payment terms',     'payment',          'downpayment, progress billing, turnover')}
            ${qtTermArea('Delivery timeline', 'deliveryTimeline', 'e.g. 14 to 21 days upon approval / payment, whichever comes last')}
            ${qtTermArea('Warranty',          'warranty',         'what is covered, for how long, and what is excluded')}
            ${qtTermArea('Exclusions',        'exclusions',       'one per line')}

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;">
                <h4 style="font-size:.85rem;margin:0;">Numbered conditions</h4>
                <button class="qt-btn" onclick="qtAddCondition()">+ Condition</button>
            </div>
            ${t.conditions.map((c, i) => `
            <div style="border:1px solid #f3f4f6;border-radius:8px;padding:.6rem;margin-top:.5rem;">
                <div style="display:flex;gap:.4rem;align-items:center;">
                    <span class="qt-sub" style="width:1.5rem;">${i + 1}.</span>
                    <input class="qt-btn" style="flex:1;font-weight:600;" placeholder="Title"
                           value="${qtEscHtml(c.title)}" oninput="qtSetCondition(${i},'title',this.value)">
                    <label class="qt-sub" style="display:flex;gap:.25rem;align-items:center;">
                        <input type="checkbox" ${c.include !== false ? 'checked' : ''}
                               onchange="qtSetCondition(${i},'include',this.checked)"> print
                    </label>
                    <button class="qt-btn" onclick="qtMoveCondition(${i},-1)">↑</button>
                    <button class="qt-btn" onclick="qtMoveCondition(${i},1)">↓</button>
                    <button class="qt-btn qt-btn-danger" onclick="qtDeleteCondition(${i})">×</button>
                </div>
                <textarea class="qt-btn" style="font-weight:400;width:100%;min-height:52px;margin-top:.4rem;"
                          placeholder="Body" oninput="qtSetCondition(${i},'body',this.value)">${qtEscHtml(c.body)}</textarea>
            </div>`).join('')}

            <div style="margin-top:1rem;display:flex;gap:1rem;flex-wrap:wrap;">
                <label class="qt-sub"><input type="checkbox" ${t.signOff.preparedBy !== false ? 'checked' : ''}
                       onchange="qtSetSignOff('preparedBy', this.checked)"> Print "Submitted by" block</label>
                <label class="qt-sub"><input type="checkbox" ${t.signOff.clientApproval !== false ? 'checked' : ''}
                       onchange="qtSetSignOff('clientApproval', this.checked)"> Print "Client approval / date" block</label>
            </div>
        </div>`;
    }

    function qtRenderEditor() {
        const root = qtEl('quoteEditorView');
        const q = qtState.current;
        if (!root || !q) return;
        const st = qtStatusOf(q);

        root.innerHTML = `
        <div class="qt-header">
            <div>
                <h2 class="qt-title">${qtEscHtml(q.quoteNo || 'New Quotation')}
                    ${q.revNo > 1 ? `<span class="qt-sub">Rev ${q.revNo}</span>` : ''}
                    <span class="qt-pill qt-pill-${st}">${st}</span></h2>
                <p class="qt-sub">${qtEscHtml(q.projectName || 'Untitled project')}</p>
            </div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                <button class="qt-btn" onclick="qtBackToList()">← Back</button>
                <button class="qt-btn qt-btn-primary" onclick="qtSave()">Save</button>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin-top:1rem;">
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;">
                <h3 style="font-size:.85rem;margin:0 0 .75rem;">Client</h3>
                ${qtField('Client name',  'clientName')}
                ${qtField('Email',        'clientEmail', 'email')}
                ${qtField('Address',      'clientAddress')}
                ${qtField('TIN',          'clientTin')}
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;">
                <h3 style="font-size:.85rem;margin:0 0 .75rem;">Project</h3>
                ${qtField('Project name', 'projectName')}
                ${qtField('Location',     'location')}
                ${qtField('Subject',      'subject')}
                ${qtField('Prepared by',  'preparedBy')}
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;">
                <h3 style="font-size:.85rem;margin:0 0 .75rem;">Document</h3>
                ${qtField('Quote no.',    'quoteNo')}
                ${qtField('Quote date',   'quoteDate',  'date')}
                ${qtField('Valid until',  'validUntil', 'date')}
            </div>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
            <label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;margin-bottom:.15rem;">Scope note</label>
            <textarea class="qt-btn" style="font-weight:400;width:100%;min-height:60px;" data-qt-key="scopeNote"
                      oninput="qtMarkDirty()">${qtEscHtml(q.scopeNote)}</textarea>
        </div>

        <div id="qtPresetBar"></div>     <!-- Task 11 -->

        <div id="qtSectionsPane"></div>   <!-- Task 6 -->
        <div id="qtTotalsPane"></div>     <!-- Task 6 -->
        <div id="qtTermsPane"></div>      <!-- Task 8 -->
        <div id="qtOutcomePane"></div>    <!-- Task 9 -->
        <div id="qtRevisionsPane"></div>  <!-- Task 10 -->
        `;

        qtRenderSections();
        qtRenderTotals();
        qtRenderTerms();
        qtRenderOutcome();
        qtRenderRevisions();
        qtRenderPresetBar();

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // Reads every [data-qt-key] input back into qtState.current.
    function qtCollectHeader() {
        const root = qtEl('quoteEditorView');
        if (!root || !qtState.current) return;
        root.querySelectorAll('[data-qt-key]').forEach(inp => {
            qtState.current[inp.dataset.qtKey] = inp.value;
        });
    }

    // ── Step 4: Save ──────────────────────────────────────────────────
    window.qtSave = async function (opts) {
        if (!qtState.current) return;
        qtCollectHeader();
        const q = qtState.current;

        // Editing a quotation that has already been sent creates a new
        // revision. The bump happens on save; the next Send freezes it.
        // A sent quote always HAS a revision — an empty list means the listener
        // has not loaded yet, so prompt rather than silently skipping the bump.
        const latest = qtState.revisions[0];
        // A status transition is not a content edit — it must not create a revision.
        if (!(opts && opts.skipRevBump) && q.status === 'sent' && qtState.isDirty
            && (!latest || latest.revNo === q.revNo)) {
            if (confirm(`This quotation was already sent as Rev ${q.revNo}.\n\nSaving creates Rev ${q.revNo + 1}. Continue?`)) {
                q.revNo = (q.revNo || 1) + 1;
            } else {
                return false;
            }
        }

        q.totalAmount = qtGrandTotal(q);

        // Only the columns that exist in migration 0045. The shim maps
        // camelCase straight to snake_case, so ANY stray key fails the whole
        // save — never spread an arbitrary object in here.
        const payload = {
            userId: qtUid(),
            quoteNo: q.quoteNo, revNo: q.revNo,
            quoteDate: q.quoteDate || null, validUntil: q.validUntil || null,
            clientName: q.clientName, clientEmail: q.clientEmail,
            clientAddress: q.clientAddress, clientTin: q.clientTin,
            projectName: q.projectName, location: q.location,
            subject: q.subject, scopeNote: q.scopeNote,
            sections: q.sections || [],
            discount: qtParseNum(q.discount), discountType: q.discountType || 'amount',
            vatMode: q.vatMode || 'none', vatPct: qtParseNum(q.vatPct),
            totalAmount: q.totalAmount,
            status: q.status || 'draft', statusNote: q.statusNote || '',
            decidedAt: q.decidedAt || null,
            followUpDate: q.followUpDate || null, followUpNote: q.followUpNote || '',
            terms: q.terms || {}, preparedBy: q.preparedBy || '',
            history: q.history || [],
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            if (q.id) {
                await db.collection('quotations').doc(q.id).update(payload);
            } else {
                payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                payload.createdBy = (window.auth.currentUser && window.auth.currentUser.email) || '';
                const ref = await db.collection('quotations').add(payload);
                q.id = ref.id;
            }
            qtState.isDirty = false;
            qtToast('Quotation saved');
            qtRenderEditor();
            return true;
        } catch (e) {
            console.error('[QT] save failed:', e);
            // Surface the real Postgres message — a missing column fails the
            // entire save, and a generic "could not save" hides which one.
            qtToast('Save failed: ' + (e.message || e), 'error');
            return false;
        }
    };

    // ── Step 5: Ctrl+S and the dirty guard ─────────────────────────────
    window.initQuotationModule = function (view) {
        if (!qtUid() || !qtIsOwner()) return;
        qtLoadList();
        qtLoadPresets();
        if (view === 'quoteList' || !view) qtRenderList();
        if (view === 'quoteEditor' && qtState.current) qtRenderEditor();

        // Attach once — init runs on EVERY view switch, so without this guard
        // Ctrl+S fires qtSave() N times and the unload guards stack.
        if (!window._qtHandlersWired) {
            window._qtHandlersWired = true;
            window.addEventListener('beforeunload', e => {
                if (qtState.isDirty) { e.preventDefault(); e.returnValue = ''; }
            });
            document.addEventListener('keydown', e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    const v = qtEl('quoteEditorView');
                    if (v && v.style.display !== 'none') { e.preventDefault(); window.qtSave(); }
                }
            });
        }
    };

    // ── Task 11: Client and scope presets ─────────────────────────────────
    function qtLoadPresets() {
        db.collection('quotationPresets')
            .where('userId', '==', qtUid())
            .get()
            .then(snap => {
                qtState.presets = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                                           .filter(p => !p.deletedAt);
                qtRenderPresetBar();
            })
            .catch(e => console.error('[QT] presets load error:', e));
    }

    window.qtSavePreset = async function (kind, sIdx) {
        qtCollectHeader();
        const q = qtState.current;
        let data, suggested;
        if (kind === 'client') {
            data = { clientName: q.clientName, clientEmail: q.clientEmail,
                     clientAddress: q.clientAddress, clientTin: q.clientTin };
            suggested = q.clientName || 'Client';
        } else {
            const sec = qtSections()[sIdx];
            if (!sec) return;
            // Deep copy, then re-id every node — a preset inserted twice must
            // not produce duplicate ids, or the revision diff pairs the wrong
            // lines together.
            const copy = JSON.parse(JSON.stringify(sec));
            copy.id = qtNewId();
            (copy.groups || []).forEach(g => {
                g.id = qtNewId();
                (g.lines || []).forEach(l => { l.id = qtNewId(); });
            });
            data = { sections: [copy] };
            suggested = sec.label || 'Scope block';
        }
        const name = prompt('Save preset as:', suggested);
        if (!name) return;
        try {
            await db.collection('quotationPresets').add({
                userId: qtUid(), kind, name, data,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            qtToast('Preset saved');
            qtLoadPresets();
        } catch (e) {
            qtToast('Could not save preset: ' + (e.message || e), 'error');
        }
    };

    window.qtInsertPreset = function (id) {
        const p = (qtState.presets || []).find(x => x.id === id);
        if (!p || !qtState.current) return;
        if (p.kind === 'client') {
            Object.assign(qtState.current, p.data);
            qtRenderEditor();
        } else {
            const copy = JSON.parse(JSON.stringify(p.data.sections || []));
            copy.forEach(sec => {
                sec.id = qtNewId();
                (sec.groups || []).forEach(g => {
                    g.id = qtNewId();
                    (g.lines || []).forEach(l => { l.id = qtNewId(); });
                });
                qtSections().push(sec);
            });
            qtRenderSections(); qtRenderTotals();
        }
        qtMarkDirty();
        qtToast(`Inserted "${p.name}"`);
    };

    window.qtDeletePreset = async function (id) {
        if (!confirm('Delete this preset?')) return;
        try {
            await db.collection('quotationPresets').doc(id)
                .update({ deletedAt: new Date().toISOString() });
            qtLoadPresets();
        } catch (e) { qtToast('Could not delete preset: ' + (e.message || e), 'error'); }
    };

    function qtRenderPresetBar() {
        const host = qtEl('qtPresetBar');
        if (!host) return;
        const clients = (qtState.presets || []).filter(p => p.kind === 'client');
        const scopes  = (qtState.presets || []).filter(p => p.kind === 'scope');
        host.innerHTML = `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-top:.75rem;">
            <select class="qt-btn" onchange="if(this.value){qtInsertPreset(this.value);this.value='';}">
                <option value="">Insert client preset…</option>
                ${clients.map(p => `<option value="${p.id}">${qtEscHtml(p.name)}</option>`).join('')}
            </select>
            <button class="qt-btn" onclick="qtSavePreset('client')">Save client as preset</button>
            <select class="qt-btn" onchange="if(this.value){qtInsertPreset(this.value);this.value='';}">
                <option value="">Insert scope preset…</option>
                ${scopes.map(p => `<option value="${p.id}">${qtEscHtml(p.name)}</option>`).join('')}
            </select>
            ${(clients.length + scopes.length)
                ? `<select class="qt-btn qt-btn-danger" onchange="if(this.value){qtDeletePreset(this.value);this.value='';}">
                     <option value="">Delete a preset…</option>
                     ${[...clients, ...scopes].map(p => `<option value="${p.id}">${qtEscHtml(p.kind)}: ${qtEscHtml(p.name)}</option>`).join('')}
                   </select>` : ''}
        </div>`;
    }

    // ── Task 9: Outcome panel — status, follow-ups, history ──────────────
    function qtPushHistory(status, from, note) {
        const q = qtState.current;
        if (!Array.isArray(q.history)) q.history = [];
        q.history.push({
            at: new Date().toISOString(),
            by: (window.auth.currentUser && window.auth.currentUser.email) || '',
            status, from: from || null, note: note || ''
        });
    }

    window.qtSetStatus = async function (status) {
        const q = qtState.current;
        if (!q || q.status === status) return;

        // Capture previous state for rollback if save fails.
        const prevStatus    = q.status;
        const prevNote      = q.statusNote;
        const prevDecided   = q.decidedAt;

        // WON creates NOTHING. No folder, no construction project, no invoice,
        // no contract value — converting a won quote into a project is a
        // manual admin action (migration 0045 isolation contract).
        let note = '';
        if (status === 'lost') {
            note = prompt('Reason for loss (optional):') || '';
        }

        q.status     = status;
        q.statusNote = (status === 'lost') ? note : '';
        q.decidedAt  = (status === 'won' || status === 'lost') ? new Date().toISOString() : null;
        qtPushHistory(status, prevStatus, note);
        qtMarkDirty();

        const ok = await window.qtSave({ skipRevBump: true });
        if (!ok) {
            // The write failed — put the record back so the panel cannot show a
            // status the database never accepted.
            q.status     = prevStatus;
            q.statusNote = prevNote;
            q.decidedAt  = prevDecided;
            if (Array.isArray(q.history)) q.history.pop();   // drop the entry we just appended
            qtToast('Status not saved — reverted', 'error');
        }
        qtRenderEditor();
    };

    window.qtSetOutcomeField = function (key, value) {
        qtState.current[key] = value;
        qtMarkDirty();
    };

    function qtRenderOutcome() {
        const pane = qtEl('qtOutcomePane');
        const q = qtState.current;
        if (!pane || !q) return;
        const st = qtStatusOf(q);
        const overdue = qtIsOverdue(q);

        pane.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
            <h3 style="font-size:.95rem;margin:0 0 .6rem;">Outcome</h3>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
                <span class="qt-pill qt-pill-${st}">${st}</span>
                ${q.status === 'draft' ? '<button class="qt-btn qt-btn-primary" onclick="qtSendQuote()">Send →</button>' : ''}
                ${q.status === 'sent'  ? `<button class="qt-btn qt-btn-primary" onclick="qtSetStatus('won')">Mark Won</button>
                                          <button class="qt-btn qt-btn-danger"  onclick="qtSetStatus('lost')">Mark Lost</button>` : ''}
                ${(q.status === 'won' || q.status === 'lost') ? `<button class="qt-btn" onclick="qtSetStatus('sent')">Reopen</button>` : ''}
            </div>
            ${st === 'expired' ? `<p class="qt-sub" style="color:#b45309;margin:.5rem 0 0;">
                This quotation lapsed on ${qtEscHtml(q.validUntil)}. Extend the validity date and save — that creates a new revision.</p>` : ''}
            ${q.statusNote ? `<p class="qt-sub" style="margin:.5rem 0 0;">Note: ${qtEscHtml(q.statusNote)}</p>` : ''}

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.75rem;margin-top:.9rem;">
                <div>
                    <label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;">Follow-up date</label>
                    <input class="qt-btn" style="font-weight:400;width:100%;" type="date"
                           value="${qtEscHtml(q.followUpDate || '')}"
                           onchange="qtSetOutcomeField('followUpDate', this.value)">
                    ${overdue ? '<p class="qt-sub" style="color:#b45309;">Overdue — pinned to the top of the list</p>' : ''}
                </div>
                <div>
                    <label style="display:block;font-size:.75rem;color:#6b7280;font-weight:600;">Follow-up note</label>
                    <input class="qt-btn" style="font-weight:400;width:100%;"
                           value="${qtEscHtml(q.followUpNote || '')}"
                           oninput="qtSetOutcomeField('followUpNote', this.value)">
                </div>
            </div>
            <p class="qt-sub" style="margin:.5rem 0 0;">Reminders are an in-app flag only — nothing is emailed to the client.</p>

            ${(q.history || []).length ? `
            <details style="margin-top:.9rem;">
                <summary class="qt-sub" style="cursor:pointer;">Status history (${q.history.length})</summary>
                <ul style="margin:.4rem 0 0 1rem;font-size:.8rem;color:#4b5563;">
                    ${q.history.slice().reverse().map(h =>
                        `<li>${qtEscHtml(String(h.at).slice(0, 16).replace('T', ' '))} — ${qtEscHtml(h.from || '·')} → <strong>${qtEscHtml(h.status)}</strong>${h.note ? ' · ' + qtEscHtml(h.note) : ''}${h.by ? ' · ' + qtEscHtml(h.by) : ''}</li>`).join('')}
                </ul>
            </details>` : ''}
        </div>`;
    }

    window.qtSendQuote = async function () {
        const q = qtState.current;
        if (!q) return;

        // Save first so the snapshot matches what is stored, and so a brand
        // new quotation has an id to hang the revision off.
        const ok = await window.qtSave();
        if (!ok) return;            // the save failed — never freeze a snapshot of unsaved data
        if (!q.id) { qtToast('Save the quotation before sending', 'error'); return; }

        const note = prompt('What changed in this revision? (optional)') || '';

        try {
            // The snapshot is written BEFORE the status flips. If this insert
            // fails, the quotation stays where it was and the user is told —
            // never a "sent" quote with no frozen copy behind it.
            await db.collection('quotationRevisions').add({
                quotationId: q.id, userId: qtUid(),
                revNo: q.revNo || 1,
                snapshot: qtSnapshotOf(q),
                totalAmount: qtParseNum(q.totalAmount),
                sentAt: firebase.firestore.FieldValue.serverTimestamp(),
                note,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.error('[QT] snapshot failed:', e);
            qtToast('Could not freeze this revision — status unchanged: ' + (e.message || e), 'error');
            return;
        }

        const from = q.status;
        q.status = 'sent';
        qtPushHistory('sent', from, note ? 'Rev ' + q.revNo + ': ' + note : 'Rev ' + q.revNo);
        await window.qtSave();
        qtToast(`Sent — Rev ${q.revNo} frozen`);
        qtRenderEditor();
    };

    // ── Task 6: Section tree editor and the totals panel ───────────────
    function qtSections() { return (qtState.current && qtState.current.sections) || []; }

    window.qtAddSection = function () {
        qtSections().push({ id: qtNewId(), label: '', pricing: 'rated', lumpAmount: '', images: [], groups: [] });
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };
    window.qtAddGroup = function (sIdx) {
        qtSections()[sIdx].groups.push({ id: qtNewId(), label: '', lumpAmount: '', lines: [] });
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };
    window.qtAddLine = function (sIdx, gIdx) {
        qtSections()[sIdx].groups[gIdx].lines.push({
            id: qtNewId(), description: '', qty: 1, unit: 'set', unitPrice: 0, state: 'normal'
        });
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };

    window.qtDeleteNode = function (kind, sIdx, gIdx, lIdx) {
        // A line is DELETED here only while drafting. To retire a line from a
        // sent quote, set its state to 'removed' instead — that keeps the
        // price in the data so the revision diff can value the deletion.
        if (!confirm('Delete this ' + kind + '?')) return;
        if (kind === 'section') qtSections().splice(sIdx, 1);
        else if (kind === 'group') qtSections()[sIdx].groups.splice(gIdx, 1);
        else qtSections()[sIdx].groups[gIdx].lines.splice(lIdx, 1);
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };

    window.qtMoveNode = function (kind, sIdx, gIdx, lIdx, dir) {
        const arr = kind === 'section' ? qtSections()
                  : kind === 'group'   ? qtSections()[sIdx].groups
                  :                      qtSections()[sIdx].groups[gIdx].lines;
        const i = kind === 'section' ? sIdx : kind === 'group' ? gIdx : lIdx;
        const j = i + dir;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        qtMarkDirty(); qtRenderSections();
    };

    window.qtSetNodeField = function (kind, sIdx, gIdx, lIdx, field, value) {
        const node = kind === 'section' ? qtSections()[sIdx]
                   : kind === 'group'   ? qtSections()[sIdx].groups[gIdx]
                   :                      qtSections()[sIdx].groups[gIdx].lines[lIdx];
        node[field] = value;
        qtMarkDirty(); qtRenderTotals();
        if (field === 'state') qtRenderSections();   // restyle the row
        if (field === 'qty' || field === 'unitPrice' || field === 'lumpAmount') {
            qtRefreshAmounts(sIdx, gIdx, lIdx);       // patch stale money cells without losing focus
        }
    };

    // Patches the line/group/section money cells painted by qtRenderSections
    // in place, using textContent — no HTML re-parse, no lost focus/cursor.
    // Guarded with null checks: the cells don't exist in every pricing mode
    // (e.g. a lump section has no per-line Amount cell).
    function qtRefreshAmounts(sIdx, gIdx, lIdx) {
        const sec = qtSections()[sIdx];
        if (!sec) return;
        const secTotEl = qtEl(`qtSecTot-${sIdx}`);
        if (secTotEl) secTotEl.textContent = '₱' + qtFmt(qtSectionTotal(sec));

        const g = (sec.groups || [])[gIdx];
        if (!g) return;
        const grpTotEl = qtEl(`qtGrpTot-${sIdx}-${gIdx}`);
        if (grpTotEl) grpTotEl.textContent = '₱' + qtFmt(qtGroupTotal(g));

        const l = (g.lines || [])[lIdx];
        if (!l) return;
        const amtEl = qtEl(`qtAmt-${sIdx}-${gIdx}-${lIdx}`);
        if (amtEl) amtEl.textContent = qtFmt(qtLineAmount(l));
    }

    window.qtSetPricing = function (sIdx, mode) {
        qtSections()[sIdx].pricing = mode;
        qtMarkDirty(); qtRenderSections(); qtRenderTotals();
    };

    const QT_STATES = ['normal', 'optional', 'waived', 'removed'];

    function qtRenderSections() {
        const pane = qtEl('qtSectionsPane');
        if (!pane || !qtState.current) return;
        const secs = qtSections();

        pane.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin:1.25rem 0 .5rem;">
            <h3 style="font-size:.95rem;margin:0;">Itemized estimate</h3>
            <button class="qt-btn" onclick="qtAddSection()">+ Section</button>
        </div>
        ${secs.length ? secs.map((sec, si) => `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-bottom:.75rem;">
            <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
                <input class="qt-btn" style="flex:1;min-width:180px;font-weight:700;" placeholder="SECTION NAME"
                       value="${qtEscHtml(sec.label)}"
                       oninput="qtSetNodeField('section',${si},0,0,'label',this.value)">
                <select class="qt-btn" onchange="qtSetPricing(${si}, this.value)">
                    <option value="rated"${sec.pricing === 'rated' ? ' selected' : ''}>Rated (qty × price)</option>
                    <option value="lump"${sec.pricing === 'lump'  ? ' selected' : ''}>Lump sum (LOT)</option>
                </select>
                ${sec.pricing === 'lump' ? `
                <input class="qt-btn qt-amt" style="width:140px;" placeholder="LOT amount"
                       value="${qtEscHtml(sec.lumpAmount)}"
                       oninput="qtSetNodeField('section',${si},0,0,'lumpAmount',this.value)">` : ''}
                <span class="qt-stat-value" id="qtSecTot-${si}">₱${qtFmt(qtSectionTotal(sec))}</span>
                <button class="qt-btn" onclick="qtMoveNode('section',${si},0,0,-1)">↑</button>
                <button class="qt-btn" onclick="qtMoveNode('section',${si},0,0,1)">↓</button>
                <button class="qt-btn" onclick="qtSavePreset('scope',${si})">Save as preset</button>
                <button class="qt-btn qt-btn-danger" onclick="qtDeleteNode('section',${si},0,0)">Delete</button>
            </div>
            ${sec.pricing === 'lump' && sec.lumpAmount !== '' && sec.lumpAmount !== null && sec.lumpAmount !== undefined
              ? `<p class="qt-sub" style="margin:.4rem 0 0;">This section is priced as one LOT. The group amounts below are a printed breakdown and do <strong>not</strong> add to the total.</p>` : ''}

            <div id="qtImages-${si}"></div>   <!-- Task 7 -->

            ${(sec.groups || []).map((g, gi) => `
            <div style="border-top:1px solid #f3f4f6;margin-top:.75rem;padding-top:.75rem;">
                <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">
                    <input class="qt-btn" style="flex:1;min-width:160px;font-weight:600;" placeholder="Group / sub-item"
                           value="${qtEscHtml(g.label)}"
                           oninput="qtSetNodeField('group',${si},${gi},0,'label',this.value)">
                    ${sec.pricing === 'lump' ? `
                    <input class="qt-btn qt-amt" style="width:130px;" placeholder="Amount"
                           value="${qtEscHtml(g.lumpAmount)}"
                           oninput="qtSetNodeField('group',${si},${gi},0,'lumpAmount',this.value)">` : `
                    <span class="qt-sub" id="qtGrpTot-${si}-${gi}">₱${qtFmt(qtGroupTotal(g))}</span>`}
                    <button class="qt-btn" onclick="qtMoveNode('group',${si},${gi},0,-1)">↑</button>
                    <button class="qt-btn" onclick="qtMoveNode('group',${si},${gi},0,1)">↓</button>
                    <button class="qt-btn qt-btn-danger" onclick="qtDeleteNode('group',${si},${gi},0)">×</button>
                </div>
                <table class="qt-table" style="margin-top:.5rem;">
                    <thead><tr>
                        <th style="width:38%">Description</th><th style="width:70px">Qty</th>
                        <th style="width:80px">Unit</th>
                        ${sec.pricing === 'rated' ? '<th style="width:110px">Unit price</th><th class="qt-amt" style="width:110px">Amount</th>' : '<th colspan="2"></th>'}
                        <th style="width:110px">State</th><th style="width:40px"></th>
                    </tr></thead>
                    <tbody>${(g.lines || []).map((l, li) => qtLineRow(sec, si, gi, li, l)).join('')}</tbody>
                </table>
                <button class="qt-btn" style="margin-top:.4rem;" onclick="qtAddLine(${si},${gi})">+ Line</button>
            </div>`).join('')}

            <button class="qt-btn" style="margin-top:.75rem;" onclick="qtAddGroup(${si})">+ Group</button>
        </div>`).join('') : `<div class="qt-empty">No sections yet. Add one to start itemizing.</div>`}`;

        if (typeof qtRenderImages === 'function') qtSections().forEach((_, si) => qtRenderImages(si));
    }

    function qtLineRow(sec, si, gi, li, l) {
        const struck = l.state === 'removed' ? 'text-decoration:line-through;opacity:.55;' : '';
        const faded  = (l.state === 'optional' || l.state === 'waived') ? 'opacity:.7;' : '';
        return `<tr style="${struck}${faded}">
            <td><input class="qt-btn" style="width:100%;font-weight:400;" value="${qtEscHtml(l.description)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'description',this.value)"></td>
            <td><input class="qt-btn" style="width:100%;font-weight:400;" value="${qtEscHtml(l.qty)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'qty',this.value)"></td>
            <td><input class="qt-btn" style="width:100%;font-weight:400;" value="${qtEscHtml(l.unit)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'unit',this.value)"></td>
            ${sec.pricing === 'rated' ? `
            <td><input class="qt-btn qt-amt" style="width:100%;font-weight:400;" value="${qtEscHtml(l.unitPrice)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'unitPrice',this.value)"></td>
            <td class="qt-amt" id="qtAmt-${si}-${gi}-${li}">${qtFmt(qtLineAmount(l))}</td>` : '<td colspan="2" class="qt-sub">scope only</td>'}
            <td><select class="qt-btn" style="width:100%;"
                        onchange="qtSetNodeField('line',${si},${gi},${li},'state',this.value)">
                ${QT_STATES.map(s => `<option value="${s}"${(l.state || 'normal') === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select></td>
            <td><button class="qt-btn qt-btn-danger" onclick="qtDeleteNode('line',${si},${gi},${li})">×</button></td>
        </tr>`;
    }

    function qtRenderTotals() {
        const pane = qtEl('qtTotalsPane');
        const q = qtState.current;
        if (!pane || !q) return;
        const pc = qtProjectCost(q.sections), disc = qtDiscountAmount(q),
              sub = qtSubTotal(q), vat = qtVatAmount(q), total = qtGrandTotal(q);

        pane.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;max-width:460px;margin-left:auto;">
            <table style="width:100%;font-size:.88rem;">
                <tr><td>Project Cost</td><td class="qt-amt">₱${qtFmt(pc)}</td></tr>
                <tr>
                    <td>Less: Discount
                        <select class="qt-btn" style="padding:.15rem .4rem;" onchange="qtSetTotalsField('discountType', this.value)">
                            <option value="amount"${q.discountType === 'amount'  ? ' selected' : ''}>₱</option>
                            <option value="percent"${q.discountType === 'percent' ? ' selected' : ''}>%</option>
                        </select>
                        <input class="qt-btn qt-amt" style="width:90px;padding:.15rem .4rem;font-weight:400;"
                               value="${qtEscHtml(q.discount)}" oninput="qtSetTotalsField('discount', this.value)">
                    </td>
                    <td class="qt-amt">(${qtFmt(disc)})</td>
                </tr>
                <tr style="border-top:1px solid #e5e7eb;"><td><strong>Sub-total</strong></td><td class="qt-amt"><strong>₱${qtFmt(sub)}</strong></td></tr>
                <tr>
                    <td>Plus: VAT
                        <select class="qt-btn" style="padding:.15rem .4rem;" onchange="qtSetTotalsField('vatMode', this.value)">
                            <option value="none"${q.vatMode === 'none' ? ' selected' : ''}>Not applicable</option>
                            <option value="exclusive"${q.vatMode === 'exclusive' ? ' selected' : ''}>Exclusive (add)</option>
                            <option value="inclusive"${q.vatMode === 'inclusive' ? ' selected' : ''}>Inclusive (built in)</option>
                        </select>
                        <input class="qt-btn qt-amt" style="width:60px;padding:.15rem .4rem;font-weight:400;"
                               value="${qtEscHtml(q.vatPct)}" oninput="qtSetTotalsField('vatPct', this.value)">%
                    </td>
                    <td class="qt-amt">${q.vatMode === 'none' ? '—' : (q.vatMode === 'inclusive' ? '(incl. ' + qtFmt(vat) + ')' : qtFmt(vat))}</td>
                </tr>
                <tr style="border-top:2px solid #111827;">
                    <td><strong>TOTAL</strong></td>
                    <td class="qt-amt"><strong>₱${qtFmt(total)}</strong></td>
                </tr>
            </table>
            <p class="qt-sub" style="margin:.5rem 0 0;">
                ${q.vatMode === 'none' ? 'Prints as “VAT not applicable”.'
                 : q.vatMode === 'exclusive' ? 'VAT is added on top of the discounted sub-total.'
                 : 'VAT is already inside the total and is shown broken out.'}
            </p>
        </div>`;
    }

    window.qtSetTotalsField = function (key, value) {
        qtState.current[key] = value;
        qtMarkDirty(); qtRenderTotals();
    };

    // ── Task 7: Section reference images ─────────────────────────────────
    const QT_MAX_IMG_MB = 5;

    window.qtUploadImages = async function (sIdx, fileList) {
        const sec = qtSections()[sIdx];
        if (!sec) return;
        sec.images = sec.images || [];
        const files = Array.from(fileList || []);
        for (const f of files) {
            if (!/^image\//.test(f.type)) { qtToast(`${f.name} is not an image`, 'error'); continue; }
            if (f.size > QT_MAX_IMG_MB * 1024 * 1024) {
                qtToast(`${f.name} is over ${QT_MAX_IMG_MB}MB`, 'error'); continue;
            }
            try {
                const path = `quotations/${qtUid()}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, '_')}`;
                const ref  = storage.ref(path);
                await ref.put(f);
                const url  = await ref.getDownloadURL();
                sec.images.push({ url, name: f.name, caption: '' });
                qtMarkDirty();
            } catch (e) {
                // Per-file failure must never block saving the quotation.
                console.error('[QT] image upload failed:', e);
                qtToast(`Upload failed for ${f.name}: ${e.message || e}`, 'error');
            }
        }
        qtRenderImages(sIdx);
    };

    window.qtRemoveImage = function (sIdx, idx) {
        if (!confirm('Remove this image from the quotation?')) return;
        // Removes the reference only — the stored file is left in the bucket
        // so an earlier revision that still points at it keeps rendering.
        qtSections()[sIdx].images.splice(idx, 1);
        qtMarkDirty(); qtRenderImages(sIdx);
    };

    window.qtSetImageCaption = function (sIdx, idx, text) {
        qtSections()[sIdx].images[idx].caption = text;
        qtMarkDirty();
    };

    function qtRenderImages(sIdx) {
        const host = qtEl('qtImages-' + sIdx);
        const sec  = qtSections()[sIdx];
        if (!host || !sec) return;
        const imgs = sec.images || [];
        host.innerHTML = `
        <div style="margin-top:.6rem;">
            <label class="qt-btn" style="display:inline-block;cursor:pointer;">
                + Reference image
                <input type="file" accept="image/*" multiple hidden
                       onchange="qtUploadImages(${sIdx}, this.files); this.value='';">
            </label>
            <span class="qt-sub" style="margin-left:.5rem;">Renders and photos printed with this section (max ${QT_MAX_IMG_MB}MB each)</span>
            ${imgs.length ? `<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.5rem;">
                ${imgs.map((im, i) => `
                <div style="width:150px;">
                    <img src="${qtEscHtml(im.url)}" alt="${qtEscHtml(im.name)}"
                         style="width:150px;height:105px;object-fit:cover;border:1px solid #e5e7eb;border-radius:8px;">
                    <input class="qt-btn" style="width:100%;font-weight:400;font-size:.75rem;margin-top:.2rem;"
                           placeholder="Caption" value="${qtEscHtml(im.caption)}"
                           oninput="qtSetImageCaption(${sIdx}, ${i}, this.value)">
                    <button class="qt-btn qt-btn-danger" style="width:100%;margin-top:.2rem;font-size:.75rem;"
                            onclick="qtRemoveImage(${sIdx}, ${i})">Remove</button>
                </div>`).join('')}
            </div>` : ''}
        </div>`;
    }

    // ── Task 10: Revisions panel and diff ────────────────────────────────
    function qtRenderRevisions() {
        const pane = qtEl('qtRevisionsPane');
        if (!pane) return;
        const revs = qtState.revisions || [];
        if (!revs.length) {
            pane.innerHTML = `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
                <h3 style="font-size:.95rem;margin:0 0 .3rem;">Revision history</h3>
                <p class="qt-sub">No revisions yet. Sending this quotation freezes Rev 1.</p></div>`;
            return;
        }
        pane.innerHTML = `
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;">
            <h3 style="font-size:.95rem;margin:0 0 .6rem;">Revision history</h3>
            <table class="qt-table">
                <thead><tr><th>Rev</th><th>Sent</th><th class="qt-amt">Total</th><th>Note</th><th></th></tr></thead>
                <tbody>${revs.map((r, i) => `
                <tr>
                    <td><strong>Rev ${r.revNo}</strong></td>
                    <td>${qtEscHtml(qtTsDate(r.sentAt))}</td>
                    <td class="qt-amt">₱${qtFmt(r.totalAmount)}</td>
                    <td>${qtEscHtml(r.note || '')}</td>
                    <td>
                        <button class="qt-btn" onclick="qtViewRevision('${r.id}')">View</button>
                        ${i < revs.length - 1 ? `<button class="qt-btn" onclick="qtShowDiff('${r.id}')">Diff</button>` : ''}
                    </td>
                </tr>`).join('')}</tbody>
            </table>
            <div id="qtDiffPane"></div>
        </div>`;
    }

    function qtTsDate(ts) {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    window.qtShowDiff = function (revId) {
        const revs = qtState.revisions;
        const i = revs.findIndex(r => r.id === revId);
        if (i < 0 || i >= revs.length - 1) return;
        const curr = revs[i].snapshot, prev = revs[i + 1].snapshot;
        // Snapshots carry their own totalAmount at the row level.
        curr.totalAmount = revs[i].totalAmount;
        prev.totalAmount = revs[i + 1].totalAmount;
        const d = qtDiffSnapshots(prev, curr);

        const row = (l, tag, delta) => `<li>${tag} <strong>${qtEscHtml(l.description || l.id)}</strong>
            <span class="qt-sub">${qtEscHtml(l.path)}</span> — ₱${qtFmt(delta)}</li>`;

        qtEl('qtDiffPane').innerHTML = `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:.8rem;margin-top:.8rem;">
            <h4 style="font-size:.85rem;margin:0 0 .4rem;">Rev ${revs[i + 1].revNo} → Rev ${revs[i].revNo}</h4>
            <ul style="margin:0 0 .5rem 1rem;font-size:.82rem;">
                ${d.added.map(l => row(l, '<span style="color:#047857;">added</span>', l.amount)).join('')}
                ${d.removed.map(l => row(l, '<span style="color:#b91c1c;">deleted</span>', -l.amount)).join('')}
                ${d.changed.map(c => `<li><span style="color:#b45309;">changed</span>
                    <strong>${qtEscHtml(c.to.description || c.id)}</strong>
                    <span class="qt-sub">${qtEscHtml(c.to.path)}</span> —
                    ${qtEscHtml(c.from.qty)} × ₱${qtFmt(c.from.unitPrice)} (${qtEscHtml(c.from.state)})
                    → ${qtEscHtml(c.to.qty)} × ₱${qtFmt(c.to.unitPrice)} (${qtEscHtml(c.to.state)})
                    — <strong>₱${qtFmt(c.delta)}</strong></li>`).join('')}
                ${(!d.added.length && !d.removed.length && !d.changed.length)
                    ? '<li class="qt-sub">No line-level changes — only header, terms or totals fields differ.</li>' : ''}
            </ul>
            <p style="margin:0;font-weight:700;">Net change: ₱${qtFmt(d.delta)}</p>
        </div>`;
    };

    window.qtViewRevision = function (revId) {
        const r = (qtState.revisions || []).find(x => x.id === revId);
        if (!r) return;
        const root = qtEl('quoteRevisionView');
        if (!root) return;
        root.innerHTML = `
        <div class="qt-header">
            <div>
                <h2 class="qt-title">${qtEscHtml(r.snapshot.quoteNo)} — Rev ${r.revNo}</h2>
                <p class="qt-sub">Frozen ${qtEscHtml(qtTsDate(r.sentAt))} · read-only</p>
            </div>
            <div style="display:flex;gap:.5rem;">
                <button class="qt-btn" onclick="switchView('quoteEditor')">← Back to current</button>
                <button class="qt-btn qt-btn-primary" onclick="qtPrintSheet(qtRevisionSnapshot('${r.id}'))">Print this revision</button>
            </div>
        </div>
        <pre style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:1rem;margin-top:1rem;overflow:auto;font-size:.75rem;">${qtEscHtml(JSON.stringify(r.snapshot, null, 2))}</pre>`;
        switchView('quoteRevision');
    };

    // Lets the print module (Task 12) render a frozen revision from itself
    // rather than from the live record.
    window.qtRevisionSnapshot = function (revId) {
        const r = (qtState.revisions || []).find(x => x.id === revId);
        return r ? r.snapshot : null;
    };

    Object.assign(window, { qtToast, qtNewId, qtMarkDirty, qtRenderImages, qtRenderTerms, qtLoadDefaultTerms, qtStatusOf, qtIsOverdue, qtRenderOutcome, qtPushHistory, qtLoadPresets, qtRenderPresetBar });

})();
