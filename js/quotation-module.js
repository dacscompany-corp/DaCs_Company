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

    // Raw value of a line, ignoring its state. A `removed` line still prints
    // its own amount so a client can see what the deletion was worth.
    function qtRawLineAmount(line) {
        if (!line) return 0;
        return qtParseNum(line.qty) * qtParseNum(line.unitPrice);
    }

    // Only a `normal` line contributes. optional / waived / removed all
    // count zero — but the row KEEPS its qty and unitPrice, which is what
    // lets qtDiffSnapshots value a deletion.
    function qtLineAmount(line) {
        if (!line || (line.state && line.state !== 'normal')) return 0;
        return qtRawLineAmount(line);
    }

    function qtGroupTotal(group) {
        return ((group && group.lines) || []).reduce((s, l) => s + qtLineAmount(l), 0);
    }

    // Lump rules (spec §7): a section's own lumpAmount WINS and the group
    // amounts beneath it must not re-add. With no section amount, groups sum.
    //
    // Those group amounts are an EDITOR-ONLY working figure. They stopped
    // printing on 2026-08-06 — see qtGroupPrintAmount in quotation-print.js.
    // This function is unchanged by that: it is the math, not the sheet.
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
        qtParseNum, qtFmt, qtEscHtml, qtTodayKey, qtLineAmount, qtRawLineAmount, qtGroupTotal,
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
            <button class="qt-btn qt-btn-primary" onclick="qtNewQuote()">
                <i data-lucide="plus"></i> New Quotation
            </button>
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

        <div class="qt-filters">
            <select class="qt-select" onchange="qtSetFilter('status', this.value)">
                ${['all','draft','sent','expired','won','lost'].map(v =>
                    `<option value="${v}"${qtState.filters.status === v ? ' selected' : ''}>${v === 'all' ? 'All statuses' : v}</option>`).join('')}
            </select>
            <select class="qt-select" onchange="qtSetFilter('year', this.value)">
                <option value="all">All years</option>
                ${years.map(y => `<option value="${y}"${qtState.filters.year === y ? ' selected' : ''}>${y}</option>`).join('')}
            </select>
            <input class="qt-input qt-search" placeholder="Search no. / client / project"
                   value="${qtEscHtml(qtState.filters.search)}"
                   oninput="qtSetFilter('search', this.value)">
        </div>

        ${rows.length ? `
        <div class="qt-panel">
            <div class="qt-section-title">Quotation Register
                <span class="qt-section-note">${rows.length} of ${qtState.list.length} shown</span>
            </div>
            <div class="qt-table-scroll">
                <table class="qt-table">
                    <thead>
                        <tr class="qt-thead-row">
                            <th>Quote No.</th><th>Client</th><th>Project</th>
                            <th>Date</th><th>Valid until</th><th class="qt-amt">Total</th>
                            <th>Status</th><th class="qt-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows.map(qtListRow).join('')}</tbody>
                </table>
            </div>
        </div>` : `
        <div class="qt-empty">
            <p class="qt-empty-title">No quotations yet</p>
            <p class="qt-empty-sub">Create one to send a client an itemized estimate.</p>
        </div>`}`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function qtStatCard(label, value) {
        return `<div class="qt-stat"><div class="qt-stat-label">${label}</div><div class="qt-stat-value">${value}</div></div>`;
    }

    function qtListRow(q) {
        const st = qtStatusOf(q);
        return `<tr class="qt-list-row${qtIsOverdue(q) ? ' qt-row-overdue' : ''}">
            <td><strong>${qtEscHtml(q.quoteNo || '—')}</strong>${(q.revNo || 1) > 1 ? ` <span class="qt-sub">Rev ${q.revNo}</span>` : ''}</td>
            <td>${qtEscHtml(q.clientName || '—')}</td>
            <td>${qtEscHtml(q.projectName || '—')}</td>
            <td>${qtEscHtml(q.quoteDate || '—')}</td>
            <td>${qtEscHtml(q.validUntil || '—')}${qtIsOverdue(q) ? ' <span class="qt-pill qt-pill-expired">follow up</span>' : ''}</td>
            <td class="qt-amt">₱${qtFmt(q.totalAmount)}</td>
            <td><span class="qt-pill qt-pill-${st}">${st}</span></td>
            <td class="qt-center">
                <button class="qt-icon-btn qt-icon-btn-edit" title="Open" onclick="qtOpenQuote('${q.id}')"><i data-lucide="pencil"></i></button>
                <button class="qt-icon-btn" title="Print" onclick="qtOpenQuote('${q.id}'); setTimeout(qtPrintSheet, 200);"><i data-lucide="printer"></i></button>
            </td>
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
            images: [],          // document-level renders/photos, max QT_MAX_IMAGES
            showLinePricing: true,   // print unit price + line amounts (0047)
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
        qtHoistLegacyImages(qtState.current);                 // 0045 → 0046 shape
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
            images: JSON.parse(JSON.stringify(q.images || [])),
            showLinePricing: q.showLinePricing !== false,
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
        return `<div class="qt-form-group">
                    <label>${label}</label>
                    <input class="qt-input" type="${type || 'text'}" data-qt-key="${key}"
                           value="${qtEscHtml(v === null || v === undefined ? '' : v)}"
                           ${extra || ''} oninput="qtMarkDirty()">
                </div>`;
    }

    function qtTermArea(label, key, hint) {
        return `<div class="qt-form-group">
                    <label>${label}${hint ? ` <span class="qt-section-note">— ${hint}</span>` : ''}</label>
                    <textarea class="qt-textarea" rows="3"
                              oninput="qtSetTerm('${key}', this.value)">${qtEscHtml(qtTerms()[key])}</textarea>
                </div>`;
    }

    function qtRenderTerms() {
        const pane = qtEl('qtTermsPane');
        if (!pane || !qtState.current) return;
        const t = qtTerms();
        pane.innerHTML = `
        <div class="qt-panel">
            <div class="qt-section-title">Terms &amp; Conditions
                <button class="qt-btn qt-btn-sm" onclick="qtSaveTermsAsDefault()">
                    <i data-lucide="bookmark"></i> Save as my defaults
                </button>
            </div>
            <div class="qt-form-grid-2">
                ${qtTermArea('Validity',          'validityNote',     'e.g. valid for thirty (30) calendar days from issuance')}
                ${qtTermArea('Payment terms',     'payment',          'downpayment, progress billing, turnover')}
                ${qtTermArea('Delivery timeline', 'deliveryTimeline', 'e.g. 14 to 21 days upon approval / payment, whichever comes last')}
                ${qtTermArea('Warranty',          'warranty',         'what is covered, for how long, and what is excluded')}
            </div>
            ${qtTermArea('Exclusions', 'exclusions', 'one per line')}

            <div class="qt-section-title" style="margin-top:1.25rem;">Numbered Conditions
                <button class="qt-btn-ghost-add" onclick="qtAddCondition()">
                    <i data-lucide="plus"></i> Add condition
                </button>
            </div>
            ${t.conditions.map((c, i) => `
            <div class="qt-term-block">
                <div class="qt-term-head">
                    <span class="qt-term-no">${i + 1}.</span>
                    <input class="qt-label-input" placeholder="Title"
                           value="${qtEscHtml(c.title)}" oninput="qtSetCondition(${i},'title',this.value)">
                    <label class="qt-check-label">
                        <input type="checkbox" class="qt-check" ${c.include !== false ? 'checked' : ''}
                               onchange="qtSetCondition(${i},'include',this.checked)"> Print
                    </label>
                    <button class="qt-icon-btn" title="Move up"   onclick="qtMoveCondition(${i},-1)"><i data-lucide="chevron-up"></i></button>
                    <button class="qt-icon-btn" title="Move down" onclick="qtMoveCondition(${i},1)"><i data-lucide="chevron-down"></i></button>
                    <button class="qt-icon-btn qt-icon-btn-del" title="Delete" onclick="qtDeleteCondition(${i})"><i data-lucide="trash-2"></i></button>
                </div>
                <textarea class="qt-textarea" style="margin-top:.45rem;min-height:52px;"
                          placeholder="Body" oninput="qtSetCondition(${i},'body',this.value)">${qtEscHtml(c.body)}</textarea>
            </div>`).join('')}

            <div class="qt-section-title" style="margin-top:1.25rem;">Signature Block
                <span class="qt-section-note">(uncheck to leave a signature line off the printed sheet)</span>
            </div>
            <div class="qt-signoff-grid">
                <label class="qt-check-label">
                    <input type="checkbox" class="qt-check" ${t.signOff.preparedBy !== false ? 'checked' : ''}
                           onchange="qtSetSignOff('preparedBy', this.checked)"> Print “Submitted by” block
                </label>
                <label class="qt-check-label">
                    <input type="checkbox" class="qt-check" ${t.signOff.clientApproval !== false ? 'checked' : ''}
                           onchange="qtSetSignOff('clientApproval', this.checked)"> Print “Client approval / date” block
                </label>
            </div>
        </div>`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function qtRenderEditor() {
        const root = qtEl('quoteEditorView');
        const q = qtState.current;
        if (!root || !q) return;
        const st = qtStatusOf(q);

        root.innerHTML = `
        <div class="qt-toolbar">
            <div class="qt-toolbar-left">
                <button class="qt-back-btn" onclick="qtBackToList()">
                    <i data-lucide="arrow-left"></i> Quotations
                </button>
                <span class="qt-breadcrumb-sep">/</span>
                <h3 class="qt-doc-title">${qtEscHtml(q.quoteNo || 'New Quotation')}</h3>
                ${q.revNo > 1 ? `<span class="qt-doc-sub">Rev ${q.revNo}</span>` : ''}
                <span class="qt-pill qt-pill-${st}">${st}</span>
                <span class="qt-doc-sub">${qtEscHtml(q.projectName || 'Untitled project')}</span>
            </div>
            <div class="qt-toolbar-right">
                <button class="qt-btn qt-btn-outline" onclick="qtPrintSheet()"><i data-lucide="printer"></i> Print</button>
                <button class="qt-btn qt-btn-outline" onclick="qtExportPDF()"><i data-lucide="file-down"></i> Export PDF</button>
                <button class="qt-btn qt-btn-primary" onclick="qtSave()"><i data-lucide="save"></i> Save</button>
            </div>
        </div>

        <div class="qt-panel">
            <div class="qt-section-title">Document Info</div>
            <div class="qt-form-grid">
                ${qtField('Client name',  'clientName')}
                ${qtField('Project name', 'projectName')}
                ${qtField('Quote no.',    'quoteNo')}

                ${qtField('Email',        'clientEmail', 'email')}
                ${qtField('Location',     'location')}
                ${qtField('Quote date',   'quoteDate',  'date')}

                ${qtField('Address',      'clientAddress')}
                ${qtField('Subject',      'subject')}
                ${qtField('Valid until',  'validUntil', 'date')}

                ${qtField('TIN',          'clientTin')}
                ${qtField('Prepared by',  'preparedBy')}
            </div>
            <div class="qt-form-group" style="margin-top:.85rem;">
                <label>Scope note</label>
                <textarea class="qt-textarea" rows="3" data-qt-key="scopeNote"
                          oninput="qtMarkDirty()">${qtEscHtml(q.scopeNote)}</textarea>
            </div>
            <div id="qtPresetBar"></div>     <!-- Task 11 -->
        </div>

        <div id="qtImagesPane"></div>     <!-- Task 7 — one set per document -->
        <div id="qtSectionsPane"></div>   <!-- Task 6 -->
        <div id="qtTotalsPane"></div>     <!-- Task 6 -->
        <div id="qtTermsPane"></div>      <!-- Task 8 -->
        <div id="qtOutcomePane"></div>    <!-- Task 9 -->
        <div id="qtRevisionsPane"></div>  <!-- Task 10 -->
        `;

        qtRenderImages();
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
            images: q.images || [],
            showLinePricing: q.showLinePricing !== false,
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
        <div class="qt-filters" style="margin:1rem 0 0;">
            <select class="qt-select" onchange="if(this.value){qtInsertPreset(this.value);this.value='';}">
                <option value="">Insert client preset…</option>
                ${clients.map(p => `<option value="${p.id}">${qtEscHtml(p.name)}</option>`).join('')}
            </select>
            <button class="qt-btn qt-btn-sm" onclick="qtSavePreset('client')">
                <i data-lucide="bookmark"></i> Save client as preset
            </button>
            <select class="qt-select" onchange="if(this.value){qtInsertPreset(this.value);this.value='';}">
                <option value="">Insert scope preset…</option>
                ${scopes.map(p => `<option value="${p.id}">${qtEscHtml(p.name)}</option>`).join('')}
            </select>
            ${(clients.length + scopes.length)
                ? `<select class="qt-select" onchange="if(this.value){qtDeletePreset(this.value);this.value='';}">
                     <option value="">Delete a preset…</option>
                     ${[...clients, ...scopes].map(p => `<option value="${p.id}">${qtEscHtml(p.kind)}: ${qtEscHtml(p.name)}</option>`).join('')}
                   </select>` : ''}
        </div>`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
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
        <div class="qt-panel">
            <div class="qt-section-title">Outcome
                <span class="qt-section-note">marking a quote Won creates nothing — converting it into a project is a manual step</span>
            </div>
            <div class="qt-actions-row">
                <span class="qt-pill qt-pill-${st}">${st}</span>
                ${q.status === 'draft' ? '<button class="qt-btn qt-btn-primary" onclick="qtSendQuote()"><i data-lucide="send"></i> Send</button>' : ''}
                ${q.status === 'sent'  ? `<button class="qt-btn qt-btn-primary" onclick="qtSetStatus('won')"><i data-lucide="check"></i> Mark Won</button>
                                          <button class="qt-btn qt-btn-danger"  onclick="qtSetStatus('lost')"><i data-lucide="x"></i> Mark Lost</button>` : ''}
                ${(q.status === 'won' || q.status === 'lost') ? `<button class="qt-btn" onclick="qtSetStatus('sent')"><i data-lucide="rotate-ccw"></i> Reopen</button>` : ''}
            </div>
            ${st === 'expired' ? `<p class="qt-warn">
                This quotation lapsed on ${qtEscHtml(q.validUntil)}. Extend the validity date and save — that creates a new revision.</p>` : ''}
            ${q.statusNote ? `<p class="qt-sub">Note: ${qtEscHtml(q.statusNote)}</p>` : ''}

            <div class="qt-form-grid-2">
                <div class="qt-form-group">
                    <label>Follow-up date</label>
                    <input class="qt-input" type="date"
                           value="${qtEscHtml(q.followUpDate || '')}"
                           onchange="qtSetOutcomeField('followUpDate', this.value)">
                    ${overdue ? '<span class="qt-warn">Overdue — pinned to the top of the list</span>' : ''}
                </div>
                <div class="qt-form-group">
                    <label>Follow-up note</label>
                    <input class="qt-input"
                           value="${qtEscHtml(q.followUpNote || '')}"
                           oninput="qtSetOutcomeField('followUpNote', this.value)">
                </div>
            </div>
            <p class="qt-total-note">Reminders are an in-app flag only — nothing is emailed to the client.</p>

            ${(q.history || []).length ? `
            <details style="margin-top:.9rem;">
                <summary class="qt-sub" style="cursor:pointer;">Status history (${q.history.length})</summary>
                <ul class="qt-history">
                    ${q.history.slice().reverse().map(h =>
                        `<li>${qtEscHtml(String(h.at).slice(0, 16).replace('T', ' '))} — ${qtEscHtml(h.from || '·')} → <strong>${qtEscHtml(h.status)}</strong>${h.note ? ' · ' + qtEscHtml(h.note) : ''}${h.by ? ' · ' + qtEscHtml(h.by) : ''}</li>`).join('')}
                </ul>
            </details>` : ''}
        </div>`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
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
        // No `images` key — reference images are per DOCUMENT since 0046.
        qtSections().push({ id: qtNewId(), label: '', pricing: 'rated', lumpAmount: '', groups: [] });
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
        const secTot = '₱ ' + qtFmt(qtSectionTotal(sec));
        const secTotEl = qtEl(`qtSecTot-${sIdx}`);
        if (secTotEl) secTotEl.textContent = secTot;
        const secSubEl = qtEl(`qtSecSub-${sIdx}`);      // the subtotal band under the section
        if (secSubEl) secSubEl.textContent = secTot;

        const g = (sec.groups || [])[gIdx];
        if (!g) return;
        const grpTotEl = qtEl(`qtGrpTot-${sIdx}-${gIdx}`);
        if (grpTotEl) grpTotEl.textContent = '₱ ' + qtFmt(qtGroupDisplayTotal(sec, g));

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

    // Section / group numbering, matching the BOQ report's I. / A. / 1. tree.
    const QT_ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X',
                      'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
    const QT_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    function qtRoman(n) { return QT_ROMAN[n] || String(n + 1); }
    function qtAlpha(n) { return QT_ALPHA[n] || String.fromCharCode(65 + n); }

    // The estimate is ONE table with the BOQ's three row levels — red section
    // rows, grey group rows, white line rows and a pale-yellow subtotal band.
    // Eight columns; every colspan below has to keep adding up to eight.
    const QT_COLS = 8;

    function qtRenderSections() {
        const pane = qtEl('qtSectionsPane');
        if (!pane || !qtState.current) return;
        const secs = qtSections();

        pane.innerHTML = `
        <div class="qt-panel">
            <div class="qt-section-title">Itemized Estimate
                <label class="qt-check-label" title="Affects the printed sheet and the PDF only — you always see the rates here while editing">
                    <input type="checkbox" class="qt-check" ${qtState.current.showLinePricing !== false ? 'checked' : ''}
                           onchange="qtSetPrintPricing(this.checked)">
                    Print unit prices &amp; line amounts
                </label>
            </div>
            ${qtState.current.showLinePricing === false ? `
            <p class="qt-print-hint"><strong>Section totals only.</strong> The printed sheet and PDF drop the Unit Price
            column and leave each line's amount blank — the client sees what is included and what each section costs,
            not the rate behind every line. Nothing about the total changes.</p>` : ''}
            <div class="qt-table-scroll">
                <table class="qt-table qt-table-wide">
                    <thead>
                        <tr class="qt-thead-row">
                            <th class="qt-col-no">Item No.</th>
                            <th class="qt-col-desc">Descriptions</th>
                            <th class="qt-col-qty qt-center">QTY</th>
                            <th class="qt-col-unit qt-center">Unit</th>
                            <th class="qt-col-rate qt-amt">Unit Price</th>
                            <th class="qt-col-amount qt-amt">Amount</th>
                            <th class="qt-col-state">State</th>
                            <th class="qt-col-actions qt-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${secs.length ? secs.map(qtSectionRows).join('')
                        : `<tr class="qt-empty-row"><td colspan="${QT_COLS}">No sections yet. Click "Add Section" below to start itemizing.</td></tr>`}</tbody>
                </table>
            </div>
            <div style="padding:0.8rem 0 0.2rem;">
                <button class="qt-btn-add" onclick="qtAddSection()">
                    <i data-lucide="plus-circle"></i> Add Section
                </button>
            </div>
        </div>`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // One section: its red level-1 row, the reference-image strip, every group
    // and line beneath it, then the subtotal band.
    function qtSectionRows(sec, si) {
        const isLump = sec.pricing === 'lump';
        const hasLumpAmount = isLump && sec.lumpAmount !== '' && sec.lumpAmount !== null && sec.lumpAmount !== undefined;

        return `
        <tr class="qt-row-l1">
            <td class="qt-col-no qt-l1-no">${qtRoman(si)}.</td>
            <td class="qt-col-desc" colspan="3">
                <div class="qt-l1-cell">
                    <input class="qt-label-input" placeholder="SECTION NAME"
                           value="${qtEscHtml(sec.label)}"
                           oninput="qtSetNodeField('section',${si},0,0,'label',this.value)">
                    <select class="qt-cell-select" style="width:auto;" onchange="qtSetPricing(${si}, this.value)">
                        <option value="rated"${!isLump ? ' selected' : ''}>Rated (qty × price)</option>
                        <option value="lump"${isLump  ? ' selected' : ''}>Lump sum (LOT)</option>
                    </select>
                </div>
            </td>
            <td class="qt-col-rate qt-amt">${isLump ? `
                <input class="qt-cell-input qt-amt" placeholder="LOT amount"
                       value="${qtEscHtml(sec.lumpAmount)}"
                       oninput="qtSetNodeField('section',${si},0,0,'lumpAmount',this.value)">` : ''}</td>
            <td class="qt-col-amount qt-amt qt-l1-total" id="qtSecTot-${si}">₱ ${qtFmt(qtSectionTotal(sec))}</td>
            <td class="qt-col-state"></td>
            <td class="qt-col-actions qt-l1-actions">
                <button class="qt-icon-btn qt-icon-btn-add" title="Add group"     onclick="qtAddGroup(${si})"><i data-lucide="plus"></i></button>
                <button class="qt-icon-btn"                 title="Save as preset" onclick="qtSavePreset('scope',${si})"><i data-lucide="bookmark"></i></button>
                <button class="qt-icon-btn"                 title="Move up"       onclick="qtMoveNode('section',${si},0,0,-1)"><i data-lucide="chevron-up"></i></button>
                <button class="qt-icon-btn"                 title="Move down"     onclick="qtMoveNode('section',${si},0,0,1)"><i data-lucide="chevron-down"></i></button>
                <button class="qt-icon-btn qt-icon-btn-del" title="Delete section" onclick="qtDeleteNode('section',${si},0,0)"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>
        ${hasLumpAmount ? `
        <tr class="qt-row-note"><td colspan="${QT_COLS}">
            This section is priced as one LOT. The group amounts below are working figures only — they do <strong>not</strong> add to the total, and they are <strong>not</strong> printed on the client's sheet.
        </td></tr>` : ''}
        ${(sec.groups || []).map((g, gi) => qtGroupRows(sec, si, g, gi)).join('')}
        <tr class="qt-row-subtotal">
            <td colspan="5" class="qt-subtotal-label">Subtotal — ${qtRoman(si)}. ${qtEscHtml(sec.label || '')}</td>
            <td class="qt-col-amount qt-amt" id="qtSecSub-${si}">₱ ${qtFmt(qtSectionTotal(sec))}</td>
            <td colspan="2"></td>
        </tr>`;
    }

    // What the group's Amount cell shows. In a LOT section the group carries
    // its own printed amount; in a rated section it is the sum of its lines.
    function qtGroupDisplayTotal(sec, g) {
        return (sec && sec.pricing === 'lump') ? qtParseNum(g && g.lumpAmount) : qtGroupTotal(g);
    }

    function qtGroupRows(sec, si, g, gi) {
        const isLump = sec.pricing === 'lump';
        return `
        <tr class="qt-row-l2">
            <td class="qt-col-no qt-l2-no">${qtAlpha(gi)}.</td>
            <td class="qt-col-desc" colspan="3">
                <input class="qt-label-input" placeholder="Group / sub-item"
                       value="${qtEscHtml(g.label)}"
                       oninput="qtSetNodeField('group',${si},${gi},0,'label',this.value)">
            </td>
            <td class="qt-col-rate qt-amt">${isLump ? `
                <input class="qt-cell-input qt-amt" placeholder="Amount"
                       value="${qtEscHtml(g.lumpAmount)}"
                       oninput="qtSetNodeField('group',${si},${gi},0,'lumpAmount',this.value)">` : ''}</td>
            <td class="qt-col-amount qt-amt" id="qtGrpTot-${si}-${gi}">₱ ${qtFmt(qtGroupDisplayTotal(sec, g))}</td>
            <td class="qt-col-state"></td>
            <td class="qt-col-actions">
                <button class="qt-icon-btn qt-icon-btn-add" title="Add line"  onclick="qtAddLine(${si},${gi})"><i data-lucide="plus"></i></button>
                <button class="qt-icon-btn"                 title="Move up"   onclick="qtMoveNode('group',${si},${gi},0,-1)"><i data-lucide="chevron-up"></i></button>
                <button class="qt-icon-btn"                 title="Move down" onclick="qtMoveNode('group',${si},${gi},0,1)"><i data-lucide="chevron-down"></i></button>
                <button class="qt-icon-btn qt-icon-btn-del" title="Delete group" onclick="qtDeleteNode('group',${si},${gi},0)"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>
        ${(g.lines || []).map((l, li) => qtLineRow(sec, si, gi, li, l)).join('')}`;
    }

    function qtLineRow(sec, si, gi, li, l) {
        const state = l.state || 'normal';
        return `<tr class="qt-row-l3 qt-row-${state}">
            <td class="qt-col-no qt-l3-no">${li + 1}</td>
            <td class="qt-col-desc"><input class="qt-cell-input" placeholder="Description"
                       value="${qtEscHtml(l.description)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'description',this.value)"></td>
            <td class="qt-col-qty"><input class="qt-cell-input qt-center" value="${qtEscHtml(l.qty)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'qty',this.value)"></td>
            <td class="qt-col-unit"><input class="qt-cell-input qt-center" value="${qtEscHtml(l.unit)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'unit',this.value)"></td>
            ${sec.pricing === 'rated' ? `
            <td class="qt-col-rate"><input class="qt-cell-input qt-amt" value="${qtEscHtml(l.unitPrice)}"
                       oninput="qtSetNodeField('line',${si},${gi},${li},'unitPrice',this.value)"></td>
            <td class="qt-col-amount qt-amt" id="qtAmt-${si}-${gi}-${li}">${qtFmt(qtLineAmount(l))}</td>`
            : `<td colspan="2" class="qt-cell-muted">scope only</td>`}
            <td class="qt-col-state"><select class="qt-cell-select"
                        onchange="qtSetNodeField('line',${si},${gi},${li},'state',this.value)">
                ${QT_STATES.map(s => `<option value="${s}"${state === s ? ' selected' : ''}>${s}</option>`).join('')}
            </select></td>
            <td class="qt-col-actions">
                <button class="qt-icon-btn"                 title="Move up"   onclick="qtMoveNode('line',${si},${gi},${li},-1)"><i data-lucide="chevron-up"></i></button>
                <button class="qt-icon-btn"                 title="Move down" onclick="qtMoveNode('line',${si},${gi},${li},1)"><i data-lucide="chevron-down"></i></button>
                <button class="qt-icon-btn qt-icon-btn-del" title="Delete line" onclick="qtDeleteNode('line',${si},${gi},${li})"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`;
    }

    function qtRenderTotals() {
        const pane = qtEl('qtTotalsPane');
        const q = qtState.current;
        if (!pane || !q) return;
        const pc = qtProjectCost(q.sections), disc = qtDiscountAmount(q),
              sub = qtSubTotal(q), vat = qtVatAmount(q), total = qtGrandTotal(q);

        pane.innerHTML = `
        <div class="qt-panel qt-panel-narrow">
            <div class="qt-section-title">Summary</div>
            <div class="qt-totals-grid">
                <div class="qt-total-row">
                    <span class="qt-total-label">Project Cost:</span>
                    <span class="qt-total-value">₱ ${qtFmt(pc)}</span>
                </div>
                <div class="qt-total-row">
                    <span class="qt-total-label">Less: Discount
                        <select class="qt-mini-select" onchange="qtSetTotalsField('discountType', this.value)">
                            <option value="amount"${q.discountType === 'amount'  ? ' selected' : ''}>₱</option>
                            <option value="percent"${q.discountType === 'percent' ? ' selected' : ''}>%</option>
                        </select>
                        <input class="qt-mini-input" value="${qtEscHtml(q.discount)}"
                               oninput="qtSetTotalsField('discount', this.value)">
                    </span>
                    <span class="qt-total-value qt-total-muted">(${qtFmt(disc)})</span>
                </div>
                <div class="qt-total-row">
                    <span class="qt-total-label">Sub-total:</span>
                    <span class="qt-total-value">₱ ${qtFmt(sub)}</span>
                </div>
                <div class="qt-total-row">
                    <span class="qt-total-label">Plus: VAT
                        <select class="qt-mini-select" onchange="qtSetTotalsField('vatMode', this.value)">
                            <option value="none"${q.vatMode === 'none' ? ' selected' : ''}>Not applicable</option>
                            <option value="exclusive"${q.vatMode === 'exclusive' ? ' selected' : ''}>Exclusive (add)</option>
                            <option value="inclusive"${q.vatMode === 'inclusive' ? ' selected' : ''}>Inclusive (built in)</option>
                        </select>
                        <input class="qt-mini-input" style="width:56px;" value="${qtEscHtml(q.vatPct)}"
                               oninput="qtSetTotalsField('vatPct', this.value)">%
                    </span>
                    <span class="qt-total-value qt-total-muted">${q.vatMode === 'none' ? '—' : (q.vatMode === 'inclusive' ? '(incl. ' + qtFmt(vat) + ')' : qtFmt(vat))}</span>
                </div>
                <div class="qt-total-row qt-total-row-final">
                    <span class="qt-total-label">TOTAL:</span>
                    <span class="qt-total-value">₱ ${qtFmt(total)}</span>
                </div>
            </div>
            <p class="qt-total-note">
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

    // Presentation only (migration 0047). The editor ALWAYS shows the rates —
    // you cannot price a job you cannot see — so this changes nothing here
    // beyond the hint; it is read by the print sheet and the PDF.
    window.qtSetPrintPricing = function (on) {
        if (!qtState.current) return;
        qtState.current.showLinePricing = !!on;
        qtMarkDirty(); qtRenderSections();
    };

    // ── Task 7: Reference images ─────────────────────────────────────────
    // ONE set per quotation, not one per section. They print once, at the top
    // of the sheet under the scope note and above the itemized estimate —
    // the shape of a real quotation. Migration 0046 added the column.
    const QT_MAX_IMG_MB  = 5;
    const QT_MAX_IMAGES  = 4;

    function qtImages() {
        const q = qtState.current;
        if (!q) return [];
        if (!Array.isArray(q.images)) q.images = [];
        return q.images;
    }

    // 0045 stored images inside each section. An old quotation must keep
    // showing and printing its pictures, so pull them up on open — first
    // QT_MAX_IMAGES wins. The section copies are LEFT IN PLACE: nothing is
    // destroyed until the user saves, and the print sheet reads only the
    // document-level list, so nothing prints twice in the meantime.
    function qtHoistLegacyImages(q) {
        if (!q || (Array.isArray(q.images) && q.images.length)) return;
        const found = [];
        (q.sections || []).forEach(sec => (sec.images || []).forEach(im => {
            if (im && im.url && found.length < QT_MAX_IMAGES) found.push(im);
        }));
        if (found.length) {
            q.images = JSON.parse(JSON.stringify(found));
            console.log(`[QT] hoisted ${found.length} legacy section image(s) to the document`);
        }
    }

    window.qtUploadImages = async function (fileList) {
        if (!qtState.current) return;
        const imgs  = qtImages();
        const files = Array.from(fileList || []);
        for (const f of files) {
            if (imgs.length >= QT_MAX_IMAGES) {
                qtToast(`Maximum ${QT_MAX_IMAGES} images — remove one first`, 'error');
                break;
            }
            if (!/^image\//.test(f.type)) { qtToast(`${f.name} is not an image`, 'error'); continue; }
            if (f.size > QT_MAX_IMG_MB * 1024 * 1024) {
                qtToast(`${f.name} is over ${QT_MAX_IMG_MB}MB`, 'error'); continue;
            }
            try {
                const path = `quotations/${qtUid()}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, '_')}`;
                const ref  = storage.ref(path);
                await ref.put(f);
                const url  = await ref.getDownloadURL();
                imgs.push({ url, name: f.name, caption: '' });
                qtMarkDirty();
            } catch (e) {
                // Per-file failure must never block saving the quotation.
                console.error('[QT] image upload failed:', e);
                qtToast(`Upload failed for ${f.name}: ${e.message || e}`, 'error');
            }
        }
        qtRenderImages();
    };

    window.qtRemoveImage = function (idx) {
        if (!confirm('Remove this image from the quotation?')) return;
        // Removes the reference only — the stored file is left in the bucket
        // so an earlier revision that still points at it keeps rendering.
        qtImages().splice(idx, 1);
        qtMarkDirty(); qtRenderImages();
    };

    window.qtMoveImage = function (idx, dir) {
        const arr = qtImages(), j = idx + dir;
        if (j < 0 || j >= arr.length) return;
        [arr[idx], arr[j]] = [arr[j], arr[idx]];
        qtMarkDirty(); qtRenderImages();
    };

    window.qtSetImageCaption = function (idx, text) {
        const im = qtImages()[idx];
        if (im) { im.caption = text; qtMarkDirty(); }
    };

    function qtRenderImages() {
        const host = qtEl('qtImagesPane');
        if (!host || !qtState.current) return;
        const imgs = qtImages();
        const full = imgs.length >= QT_MAX_IMAGES;
        host.innerHTML = `
        <div class="qt-panel">
            <div class="qt-section-title">Reference Images
                <span class="qt-section-note">${imgs.length} of ${QT_MAX_IMAGES} · printed once, above the itemized estimate (max ${QT_MAX_IMG_MB}MB each)</span>
            </div>
            <div class="qt-images-panel">
                ${full ? `<span class="qt-images-hint">Maximum of ${QT_MAX_IMAGES} images reached — remove one to add another.</span>` : `
                <label class="qt-upload-label">
                    <i data-lucide="image-plus"></i> Add image
                    <input type="file" accept="image/*" multiple hidden
                           onchange="qtUploadImages(this.files); this.value='';">
                </label>`}
                ${imgs.length ? `<div class="qt-images-grid">
                    ${imgs.map((im, i) => `
                    <div class="qt-image-card">
                        <img src="${qtEscHtml(im.url)}" alt="${qtEscHtml(im.name)}">
                        <input class="qt-image-caption" placeholder="Caption" value="${qtEscHtml(im.caption)}"
                               oninput="qtSetImageCaption(${i}, this.value)">
                        <div class="qt-image-actions">
                            <button class="qt-icon-btn" title="Move left"  onclick="qtMoveImage(${i},-1)"><i data-lucide="chevron-left"></i></button>
                            <button class="qt-icon-btn" title="Move right" onclick="qtMoveImage(${i},1)"><i data-lucide="chevron-right"></i></button>
                            <button class="qt-icon-btn qt-icon-btn-del" title="Remove" onclick="qtRemoveImage(${i})"><i data-lucide="trash-2"></i></button>
                        </div>
                    </div>`).join('')}
                </div>`
                : `<span class="qt-images-hint">No images yet. Renders or site photos go here.</span>`}
            </div>
        </div>`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ── Task 10: Revisions panel and diff ────────────────────────────────
    function qtRenderRevisions() {
        const pane = qtEl('qtRevisionsPane');
        if (!pane) return;
        const revs = qtState.revisions || [];
        if (!revs.length) {
            pane.innerHTML = `<div class="qt-panel">
                <div class="qt-section-title">Revision History</div>
                <p class="qt-sub">No revisions yet. Sending this quotation freezes Rev 1.</p></div>`;
            return;
        }
        pane.innerHTML = `
        <div class="qt-panel">
            <div class="qt-section-title">Revision History
                <span class="qt-section-note">each frozen copy prints from itself, never from the live record</span>
            </div>
            <div class="qt-table-scroll">
                <table class="qt-table">
                    <thead>
                        <tr class="qt-thead-row">
                            <th>Rev</th><th>Sent</th><th class="qt-amt">Total</th><th>Note</th><th class="qt-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${revs.map((r, i) => `
                    <tr class="qt-list-row">
                        <td><strong>Rev ${r.revNo}</strong></td>
                        <td>${qtEscHtml(qtTsDate(r.sentAt))}</td>
                        <td class="qt-amt">₱ ${qtFmt(r.totalAmount)}</td>
                        <td>${qtEscHtml(r.note || '')}</td>
                        <td class="qt-center">
                            <button class="qt-btn qt-btn-sm" onclick="qtViewRevision('${r.id}')">View</button>
                            ${i < revs.length - 1 ? `<button class="qt-btn qt-btn-sm" onclick="qtShowDiff('${r.id}')">Diff</button>` : ''}
                        </td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>
            <div id="qtDiffPane"></div>
        </div>`;

        if (typeof lucide !== 'undefined') lucide.createIcons();
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
        <div class="qt-diff">
            <h4>Rev ${revs[i + 1].revNo} → Rev ${revs[i].revNo}</h4>
            <ul>
                ${d.added.map(l => row(l, '<span class="qt-tag-added">added</span>', l.amount)).join('')}
                ${d.removed.map(l => row(l, '<span class="qt-tag-removed">deleted</span>', -l.amount)).join('')}
                ${d.changed.map(c => `<li><span class="qt-tag-changed">changed</span>
                    <strong>${qtEscHtml(c.to.description || c.id)}</strong>
                    <span class="qt-sub">${qtEscHtml(c.to.path)}</span> —
                    ${qtEscHtml(c.from.qty)} × ₱${qtFmt(c.from.unitPrice)} (${qtEscHtml(c.from.state)})
                    → ${qtEscHtml(c.to.qty)} × ₱${qtFmt(c.to.unitPrice)} (${qtEscHtml(c.to.state)})
                    — <strong>₱${qtFmt(c.delta)}</strong></li>`).join('')}
                ${(!d.added.length && !d.removed.length && !d.changed.length)
                    ? '<li class="qt-sub">No line-level changes — only header, terms or totals fields differ.</li>' : ''}
            </ul>
            <p class="qt-diff-net">Net change: ₱ ${qtFmt(d.delta)}</p>
        </div>`;
    };

    window.qtViewRevision = function (revId) {
        const r = (qtState.revisions || []).find(x => x.id === revId);
        if (!r) return;
        const root = qtEl('quoteRevisionView');
        if (!root) return;
        root.innerHTML = `
        <div class="qt-toolbar">
            <div class="qt-toolbar-left">
                <button class="qt-back-btn" onclick="switchView('quoteEditor')">
                    <i data-lucide="arrow-left"></i> Back to current
                </button>
                <span class="qt-breadcrumb-sep">/</span>
                <h3 class="qt-doc-title">${qtEscHtml(r.snapshot.quoteNo)} — Rev ${r.revNo}</h3>
                <span class="qt-doc-sub">Frozen ${qtEscHtml(qtTsDate(r.sentAt))} · read-only</span>
            </div>
            <div class="qt-toolbar-right">
                <button class="qt-btn qt-btn-outline" onclick="qtExportPDF(qtRevisionSnapshot('${r.id}'))"><i data-lucide="file-down"></i> Export PDF</button>
                <button class="qt-btn qt-btn-primary" onclick="qtPrintSheet(qtRevisionSnapshot('${r.id}'))"><i data-lucide="printer"></i> Print this revision</button>
            </div>
        </div>
        <pre class="qt-snapshot">${qtEscHtml(JSON.stringify(r.snapshot, null, 2))}</pre>`;
        switchView('quoteRevision');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    // Lets the print module (Task 12) render a frozen revision from itself
    // rather than from the live record.
    window.qtRevisionSnapshot = function (revId) {
        const r = (qtState.revisions || []).find(x => x.id === revId);
        return r ? r.snapshot : null;
    };

    Object.assign(window, { qtToast, qtNewId, qtMarkDirty, qtRenderImages, qtRenderTerms, qtLoadDefaultTerms, qtStatusOf, qtIsOverdue, qtRenderOutcome, qtPushHistory, qtLoadPresets, qtRenderPresetBar });

    window.qtState = qtState;   // read-only use by quotation-print.js

})();
