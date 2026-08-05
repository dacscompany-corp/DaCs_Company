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

    window.initQuotationModule = function (view) {
        if (!qtUid() || !qtIsOwner()) return;
        if (view === 'quoteList' || !view) {
            const root = qtEl('quoteListView');
            if (root) root.innerHTML = '<div class="qt-empty">Quotations — list renders in Task 4.</div>';
        }
    };

    Object.assign(window, { qtToast, qtNewId });

})();
