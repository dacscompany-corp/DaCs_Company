/* ══════════════════════════════════════════════════════════
   PM → CASH ADVANCES — list and detail (window.CashAdvanceAdmin)
   Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md §6

   Owner-role accounts only: anyone else gets an empty view and nothing is
   fetched (the server refuses them too). Every figure comes from
   window.CashAdvance; this file only renders. A tracking ledger — payroll
   and project totals are never changed, and nothing here writes anything.

   Holders inside #pmCashAdvancesView:
     #pmCashAdvancesRoot     the list shell (header, filters) or one advance
     #pmCashAdvancesResults  totals + table, inside the shell — re-rendered on
                             each filter change so typing never loses focus
     #pmCashAdvancesModal    the open form (js/cash-advance-forms.js)

   Payroll (Labor lines) is read HERE, per project, straight from
   constructionProjects/{id}/weeklyBills — never from pm-admin.js state —
   so the view works when opened directly (spec §6.1a). Only pm-admin.js's
   name helpers are borrowed; without them names match exactly.
   ══════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    const S = {
        seq: 0, loading: false, loaded: false, error: null, advances: [], projects: [],
        filters: { worker: '', project: '', status: 'all', showVoided: false },
        openId: null, bills: Object.create(null), modal: null, fallbackReported: false,
    };
    let api = null;
    const CA = () => window.CashAdvance;
    const server = () => api || CA().server;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const canSee = () => window.currentUserRole === 'owner';
    const money = (cents) => CA().pesos(cents);
    const field = (label, inner) => '<label class="pca-field"><span class="pca-label">' + esc(label) + '</span>' + inner + '</label>';

    function fmtDay(key) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))) return key ? String(key) : '—';
        const [y, m, d] = String(key).split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function fmtAt(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function report(message, stack) {
        try {
            if (typeof window._dacsReportError === 'function') {
                window._dacsReportError('error', 'cash-advance: ' + message, 'cash-advance-admin.js', 0, 0, stack || '');
            }
        } catch (_) { /* the reporter must never break the screen */ }
    }
    // pm-admin.js's top-level name helpers. Missing → exact matching, reported once.
    function helper(name) {
        const fn = window[name];
        if (typeof fn === 'function') return fn;
        if (!S.fallbackReported) {
            S.fallbackReported = true;
            report(name + ' missing — exact name matching');
        }
        return undefined;
    }
    const similar = () => helper('_pmNamesSimilar');
    const grouper = () => helper('_pmLaborNameGroups');

    // One read per project per visit; a failed read is not cached.
    function loadBills(projectId) {
        if (!projectId) return Promise.resolve({ bills: [], error: null });
        if (!S.bills[projectId]) {
            const store = (typeof db !== 'undefined') ? db : null;
            S.bills[projectId] = Promise.resolve()
                .then(() => store.collection('constructionProjects').doc(projectId).collection('weeklyBills').get())
                .then(snap => ({ bills: snap.docs.map(d => ({ id: d.id, ...d.data() })), error: null }))
                .catch(e => { delete S.bills[projectId]; return { bills: [], error: e || new Error('load failed') }; });
        }
        return S.bills[projectId];
    }

    function cleanup() {
        S.bills = Object.create(null);
        S.modal = null;
        S.openId = null;
        const m = $('pmCashAdvancesModal');
        if (m) m.innerHTML = '';
    }

    function init() {
        if (!canSee()) {
            const root = $('pmCashAdvancesRoot'); if (root) root.innerHTML = '';
            const m = $('pmCashAdvancesModal'); if (m) m.innerHTML = '';
            return Promise.resolve();
        }
        cleanup();
        if (typeof window.registerViewCleanup === 'function') window.registerViewCleanup(cleanup);
        return load();
    }

    async function load() {
        if (!canSee()) return;
        const seq = ++S.seq;
        S.loading = true; S.error = null;
        render();
        try {
            const [advances, projects] = await Promise.all([server().list(), server().projects()]);
            if (seq !== S.seq) return;
            S.advances = Array.isArray(advances) ? advances : [];
            S.projects = Array.isArray(projects) ? projects : [];
            S.loaded = true;
        } catch (e) {
            if (seq !== S.seq) return;
            const t = CA().errorText(e && e.message);
            if (!t.known) report(t.text, e && e.stack);
            S.error = t.text;
        } finally {
            if (seq === S.seq) { S.loading = false; render(); }
        }
    }

    function upsert(advance) {
        if (!advance || !advance.id) return;
        const i = S.advances.findIndex(a => a.id === advance.id);
        if (i >= 0) S.advances[i] = advance; else S.advances.push(advance);
    }

    function render() {
        const root = $('pmCashAdvancesRoot');
        if (!root) return;
        if (!canSee()) { root.innerHTML = ''; return; }
        const open = S.openId ? S.advances.find(a => a.id === S.openId) : null;
        if (open) { root.innerHTML = detailHtml(open); return; }
        S.openId = null;
        root.innerHTML = shellHtml();
        renderResults();
    }

    function setFilter(key, value) {
        S.filters[key] = value;
        if (key === 'worker') renderResults();   // keep the search box (and its focus)
        else render();
    }
    function open(id) { S.openId = id; render(); }
    function close() { S.openId = null; render(); }

    // ── list ─────────────────────────────────────────────────────────
    const badge = (t) => '<span class="pca-badge pca-badge--' + t.status + '">' + esc(t.label) + '</span>';
    const projectLabel = (a) => esc(a.project_name || 'Untitled project')
        + (a.project_deleted ? ' <span class="pca-muted">(project deleted)</span>' : '');

    function shellHtml() {
        const f = S.filters;
        const opts = CA().projectOptions(S.projects, S.advances);
        const chip = (v, label) => '<button type="button" class="pca-chip' + (f.status === v ? ' is-on' : '') + '" aria-pressed="'
            + (f.status === v) + '" onclick="CashAdvanceAdmin.setFilter(\'status\', \'' + v + '\')">' + esc(label) + '</button>';
        return '<div class="pca">'
            + '<div class="pca-head"><div><h2 class="pca-title">Cash Advances</h2>'
            +   '<p class="pca-sub">Money advanced to workers and what they have paid back. Tracking only — payroll and project totals are not changed.</p></div>'
            +   '<button type="button" class="pca-btn pca-btn--primary" onclick="CashAdvanceAdmin.openAdvanceForm()">+ New advance</button></div>'
            + '<div class="pca-filters">'
            +   '<input type="search" id="pcaFilterWorker" class="pca-input" placeholder="Search worker" aria-label="Search worker" value="'
            +     esc(f.worker) + '" oninput="CashAdvanceAdmin.setFilter(\'worker\', this.value)">'
            +   '<select id="pcaFilterProject" class="pca-input" aria-label="Project" onchange="CashAdvanceAdmin.setFilter(\'project\', this.value)">'
            +     '<option value="">All projects</option>'
            +     opts.map(o => '<option value="' + esc(o.id) + '"' + (f.project === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('')
            +   '</select>'
            +   '<div class="pca-chips" role="group" aria-label="Status">'
            +     chip('all', 'All') + chip('unpaid', 'Unpaid') + chip('partial', 'Partially Paid') + chip('paid', 'Fully Paid') + '</div>'
            +   '<label class="pca-check"><input type="checkbox" id="pcaShowVoided"' + (f.showVoided ? ' checked' : '')
            +     ' onchange="CashAdvanceAdmin.setFilter(\'showVoided\', this.checked)"> Show voided</label>'
            + '</div>'
            + '<div id="pmCashAdvancesResults"></div>'
            + '</div>';
    }

    function renderResults() {
        const el = $('pmCashAdvancesResults');
        if (!el) return;
        if (S.loading && !S.loaded) { el.innerHTML = '<p class="pca-muted">Loading cash advances…</p>'; return; }
        if (S.error) {
            el.innerHTML = '<div class="pca-alert">' + esc(S.error)
                + ' <button type="button" class="pca-btn" onclick="CashAdvanceAdmin.load()">Retry</button></div>';
            return;
        }
        const sum = CA().listSummary(S.advances, S.filters, similar());
        const card = (label, cents) => '<div class="pca-card"><span class="pca-card-label">' + esc(label)
            + '</span><span class="pca-card-value">' + money(cents) + '</span></div>';
        let h = '<div class="pca-cards">' + card('Total advanced', sum.totals.advancedCents)
            + card('Total repaid', sum.totals.repaidCents) + card('Outstanding', sum.totals.outstandingCents) + '</div>';
        if (!S.advances.length) { el.innerHTML = h + '<p class="pca-empty">No cash advances yet.</p>'; return; }
        if (!sum.rows.length) { el.innerHTML = h + '<p class="pca-empty">No cash advances match.</p>'; return; }
        h += '<div class="pca-table-wrap"><table class="pca-table"><thead><tr><th>Worker</th><th>Project</th><th>Issued</th>'
            + '<th class="num">Advanced</th><th class="num">Repaid</th><th class="num">Balance</th><th class="num">%</th><th>Status</th>'
            + '</tr></thead><tbody>'
            + sum.rows.map(({ adv, t }) => {
                const go = 'CashAdvanceAdmin.open(\'' + esc(adv.id) + '\')';
                return '<tr class="pca-row' + (t.status === 'voided' ? ' is-void' : '') + '" tabindex="0" onclick="' + go
                    + '" onkeydown="if(event.key===\'Enter\')' + go + '">'
                    + '<td>' + esc(adv.worker_name) + '</td><td>' + projectLabel(adv) + '</td><td>' + esc(fmtDay(adv.issued_on)) + '</td>'
                    + '<td class="num">' + money(t.amountCents) + '</td><td class="num">' + money(t.repaidCents) + '</td>'
                    + '<td class="num">' + money(t.balanceCents) + '</td><td class="num">' + esc(CA().fmtPct(adv.suggest_pct)) + '%</td>'
                    + '<td>' + badge(t) + '</td></tr>';
            }).join('')
            + '</tbody></table></div>';
        el.innerHTML = h;
    }

    // ── detail ───────────────────────────────────────────────────────
    const FIELD = { project: 'Project', worker_name: 'Worker', issued_on: 'Date issued', amount: 'Amount',
                    suggest_pct: 'Suggested %', notes: 'Notes' };
    function changesText(ch) {
        return Object.keys(ch || {}).map(k => {
            const pair = Array.isArray(ch[k]) ? ch[k] : [null, null];
            const f = (v) => k === 'amount' ? money(CA().toCents(v))
                : k === 'suggest_pct' ? CA().fmtPct(v) + '%'
                : k === 'issued_on' ? fmtDay(v)
                : (v == null || v === '' ? '(blank)' : String(v));
            return esc(FIELD[k] || k) + ' ' + esc(f(pair[0])) + ' → ' + esc(f(pair[1]));
        }).join('; ');
    }
    // The amount at issue: the "old" side of the first amount edit, else today's amount.
    function issuedAmount(adv) {
        const e = (adv.events || []).find(x => x.kind === 'edited' && x.changes && x.changes.amount);
        return e ? e.changes.amount[0] : adv.amount;
    }
    function historyHtml(adv) {
        const reps = new Map((adv.repayments || []).map(r => [r.id, r]));
        const live = !adv.voided_at;
        const who = (e) => ' <span class="pca-muted">' + esc(fmtAt(e.at)) + (e.actor_email ? ' · ' + esc(e.actor_email) : '') + '</span>';
        const voidNote = (x) => '<div class="pca-void-note">Voided ' + esc(fmtAt(x.voided_at))
            + (x.voided_by_email ? ' by ' + esc(x.voided_by_email) : '') + ' — ' + esc(x.void_reason) + '</div>';
        return (adv.events || []).map(e => {
            if (e.kind === 'issued') return '<li><b>Advance issued</b> — ' + money(CA().toCents(issuedAmount(adv))) + who(e) + '</li>';
            if (e.kind === 'edited') return '<li><b>Edited</b> — ' + changesText(e.changes) + who(e) + '</li>';
            if (e.kind === 'repaid') {
                const r = reps.get(e.repayment_id) || {};
                const voided = !!r.voided_at;
                return '<li' + (voided ? ' class="is-void"' : '') + '><b>Repayment ' + money(CA().toCents(r.amount)) + '</b> paid '
                    + esc(fmtDay(r.paid_on)) + who(e)
                    + (r.payroll_ref ? '<div class="pca-ref">From payroll: ' + esc(fmtDay(r.payroll_ref.day)) + ' · '
                        + esc(r.payroll_ref.details) + ' · ' + money(CA().toCents(r.payroll_ref.amount)) + '</div>' : '')
                    + (r.notes ? '<div class="pca-ref">' + esc(r.notes) + '</div>' : '')
                    + (voided ? voidNote(r)
                        : (live ? ' <button type="button" class="pca-link" onclick="CashAdvanceAdmin.openVoid(\'repayment\', \''
                            + esc(r.id) + '\')">Void</button>' : ''))
                    + '</li>';
            }
            if (e.kind === 'repayment_voided') {
                const r = reps.get(e.repayment_id) || {};
                return '<li><b>Repayment of ' + money(CA().toCents(r.amount)) + ' voided</b> — ' + esc(e.reason) + who(e) + '</li>';
            }
            if (e.kind === 'voided') return '<li><b>Advance voided</b> — ' + esc(e.reason) + who(e) + '</li>';
            return '';
        }).join('');
    }
    function detailHtml(adv) {
        const t = CA().totals(adv);
        const live = !adv.voided_at;
        const liveReps = (adv.repayments || []).filter(r => !r.voided_at);
        const stat = (label, val) => '<div class="pca-stat"><span class="pca-card-label">' + esc(label)
            + '</span><span class="pca-stat-value">' + val + '</span></div>';
        let h = '<div class="pca"><button type="button" class="pca-back" onclick="CashAdvanceAdmin.close()">← Cash Advances</button>'
            + '<div class="pca-head"><div><h2 class="pca-title">' + esc(adv.worker_name) + '</h2>'
            + '<p class="pca-sub">' + projectLabel(adv) + ' · issued ' + esc(fmtDay(adv.issued_on)) + '</p></div>' + badge(t) + '</div>'
            + '<div class="pca-cards">' + stat('Advanced', money(t.amountCents)) + stat('Repaid', money(t.repaidCents))
            + stat('Balance', money(t.balanceCents)) + stat('Suggested repayment', esc(CA().fmtPct(adv.suggest_pct)) + '% of payroll') + '</div>';
        if (adv.notes) h += '<p class="pca-notes"><b>Agreement:</b> ' + esc(adv.notes) + '</p>';
        if (!live) {
            h += '<div class="pca-alert">Voided ' + esc(fmtAt(adv.voided_at)) + (adv.voided_by_email ? ' by ' + esc(adv.voided_by_email) : '')
                + ' — ' + esc(adv.void_reason) + '</div>';
        } else {
            const id = esc(adv.id);
            h += '<div class="pca-actions">'
                + (t.balanceCents > 0 ? '<button type="button" class="pca-btn pca-btn--primary" onclick="CashAdvanceAdmin.openRepaymentForm(\''
                    + id + '\')">Record repayment</button>' : '')
                + '<button type="button" class="pca-btn" onclick="CashAdvanceAdmin.openAdvanceForm(\'' + id + '\')">Edit advance</button>'
                + '<button type="button" class="pca-btn pca-btn--danger"' + (liveReps.length ? ' disabled aria-describedby="pcaVoidHint"' : '')
                + ' onclick="CashAdvanceAdmin.openVoid(\'advance\', \'' + id + '\')">Void advance</button>'
                + (liveReps.length ? '<span id="pcaVoidHint" class="pca-muted">Void its repayments first.</span>' : '')
                + '</div>';
        }
        h += '<h3 class="pca-h3">History</h3><ol class="pca-history">' + historyHtml(adv) + '</ol></div>';
        return h;
    }

    window.CashAdvanceAdmin = {
        init, load, render, renderResults, setFilter, open, close,
        _state: S,
        _setApi: (a) => { api = a || null; },
        _upsert: upsert,
        _h: { esc, money, fmtDay, fmtAt, field, loadBills, similar, grouper, server, report },
    };
    window.initCashAdvances = init;
})();
