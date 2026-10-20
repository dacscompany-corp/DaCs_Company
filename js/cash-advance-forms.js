/* ══════════════════════════════════════════════════════════
   PM → CASH ADVANCES — pop-up forms (merged into window.CashAdvanceAdmin)
   Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md §6.3–6.5

   New / edit advance, record repayment (with the suggestion calculator) and
   the two voids. Every form holds ONE operation id from opening until a
   success or close; a retry re-sends it, so the server records once (R16).
   The browser checks mirror the server's; the server's locked check is final.

   The suggestion is a label: the "Payroll basis" (a picked Labor line or a
   typed figure) only feeds the calculator. The actual repayment starts empty
   and changes only when the owner types it or presses "Use ₱…".
   ══════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    const A = () => window.CashAdvanceAdmin;
    const CA = () => window.CashAdvance;
    const S = () => A()._state;
    const H = () => A()._h;
    const $ = (id) => document.getElementById(id);
    const val = (id) => { const e = $(id); return e ? String(e.value == null ? '' : e.value) : ''; };
    const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const NOTE = '<p class="pca-calc-note">Suggestion only — nothing is deducted.</p>';

    function show(html) {
        const h = $('pmCashAdvancesModal');
        if (h) h.innerHTML = '<div class="pca-overlay" role="dialog" aria-modal="true"><div class="pca-modal">' + html + '</div></div>';
    }
    function closeModal() {
        const m = S().modal;
        if (m && m.saving) return;            // never abandon a save in flight
        S().modal = null;
        const h = $('pmCashAdvancesModal');
        if (h) h.innerHTML = '';
    }
    function setError(msg) { const e = $('pcaFormError'); if (e) e.textContent = msg || ''; }
    function setSaving(m, on) {
        const b = $('pcaSave');
        if (!b) return;
        b.disabled = !!on;
        b.textContent = on ? 'Saving…' : m.label;
    }
    function buttons(onSave, label, danger) {
        return '<div class="pca-modal-actions"><button type="button" class="pca-btn" onclick="CashAdvanceAdmin.closeModal()">Cancel</button>'
            + '<button type="button" id="pcaSave" class="pca-btn ' + (danger ? 'pca-btn--danger' : 'pca-btn--primary') + '" onclick="'
            + onSave + '">' + H().esc(label) + '</button></div>';
    }
    function toast(msg) { if (typeof window._pmToast === 'function') window._pmToast(msg); }

    // One submit path for every form: guards the double-click, keeps the op
    // id on failure, reloads when the screen was stale, reports the unknown.
    async function submit(m, call, onDone) {
        m.saving = true;
        setSaving(m, true);
        setError('');
        try {
            const res = await call();
            m.saving = false;
            if (S().modal === m) closeModal();
            onDone(res || {});
            A().render();
            toast('Saved.');
        } catch (e) {
            m.saving = false;
            const msg = e && e.message;
            const code = CA().errorCode(msg);
            if (CA().RELOAD_CODES.includes(code)) await A().load();
            const advId = m.advanceId || m.id;
            const fresh = advId ? S().advances.find(a => a.id === advId) : null;
            const t = CA().errorText(msg, fresh ? CA().totals(fresh) : null);
            if (!t.known) H().report(t.text, e && e.stack);
            if (S().modal === m) {
                setSaving(m, false);
                setError(t.known ? t.text : "Couldn't save — check the connection and try again. (" + t.text + ')');
            }
        }
    }

    // ── new / edit advance ───────────────────────────────────────────
    function openAdvanceForm(id) {
        const adv = id ? S().advances.find(a => a.id === id) : null;
        if (id && (!adv || adv.voided_at)) return;
        const esc = H().esc, field = H().field;
        S().modal = { kind: 'advance', id: adv ? adv.id : null, opId: CA().newOpId(), saving: false,
                      label: adv ? 'Save changes' : 'Save advance', projectId: '' };
        const t = adv ? CA().totals(adv) : null;
        const cur = adv ? adv.project_id : '';
        const projects = CA().projectOptions(S().projects, adv ? [adv] : []);
        show('<h3 class="pca-modal-title">' + (adv ? 'Edit advance' : 'New cash advance') + '</h3>'
            + field('Project', '<select id="pcaProject" class="pca-input" onchange="CashAdvanceAdmin.pickProject(this.value)">'
                + (adv ? '' : '<option value="">Choose a project</option>')
                + projects.map(o => '<option value="' + esc(o.id) + '"' + (o.id === cur ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('')
                + '</select>')
            + field('Worker name', '<input id="pcaWorker" class="pca-input" list="pcaWorkerNames" autocomplete="off" maxlength="120" value="'
                + esc(adv ? adv.worker_name : '') + '"><datalist id="pcaWorkerNames"></datalist><span id="pcaNamesNote" class="pca-muted"></span>')
            + field('Date issued', '<input id="pcaIssued" type="date" class="pca-input" value="' + esc(adv ? adv.issued_on : CA().dateKey()) + '">')
            + field('Amount advanced (₱)', '<input id="pcaAmount" class="pca-input" inputmode="decimal" value="'
                + esc(adv ? (CA().toCents(adv.amount) / 100).toFixed(2) : '') + '">'
                + (t && t.repaidCents > 0 ? '<span class="pca-muted">Can\'t go below ' + H().money(t.repaidCents) + ' already repaid.</span>' : ''))
            + field('Suggested repayment %', '<input id="pcaPct" class="pca-input" inputmode="decimal" value="'
                + esc(adv ? CA().fmtPct(adv.suggest_pct) : String(CA().DEFAULT_PCT)) + '">'
                + '<span class="pca-muted">Of each payroll — a suggestion only, nothing is deducted.</span>')
            + field('Notes / agreement', '<textarea id="pcaNotes" class="pca-input" rows="3">' + esc(adv ? adv.notes || '' : '') + '</textarea>')
            + '<p id="pcaFormError" class="pca-error" role="alert"></p>'
            + buttons('CashAdvanceAdmin.saveAdvance()', S().modal.label));
        if (cur) pickProject(cur);
    }

    // Name suggestions come from THAT project's Labor lines (spec §6.3).
    async function pickProject(projectId) {
        const m = S().modal;
        if (!m || m.kind !== 'advance') return [];
        m.projectId = projectId || '';
        const dl = $('pcaWorkerNames'), note = $('pcaNamesNote');
        if (dl) dl.innerHTML = '';
        if (!projectId) return [];
        if (note) note.textContent = 'Loading names…';
        const res = await H().loadBills(projectId);
        if (S().modal !== m || m.projectId !== projectId) return [];
        if (note) note.textContent = '';
        if (res.error) return [];          // suggestions simply don't appear
        const names = CA().nameSuggestions(res.bills, H().grouper());
        if (dl) dl.innerHTML = names.map(n => '<option value="' + H().esc(n) + '"></option>').join('');
        return names;
    }

    async function saveAdvance() {
        const m = S().modal;
        if (!m || m.kind !== 'advance' || m.saving) return;
        const adv = m.id ? S().advances.find(a => a.id === m.id) : null;
        const projectId = val('pcaProject'), worker = val('pcaWorker').trim(), issuedOn = val('pcaIssued');
        const amt = CA().parseAmount(val('pcaAmount')), pct = CA().parsePct(val('pcaPct'));
        let msg = '';
        if (!projectId) msg = 'Choose a project.';
        else if (!worker) msg = "Enter the worker's name.";
        else if (!isDay(issuedOn)) msg = 'Pick a date.';
        else if (!amt.ok) msg = amt.error;
        else if (!pct.ok) msg = pct.error;
        else if (adv && amt.cents < CA().totals(adv).repaidCents) {
            msg = "The amount can't be lower than the " + H().money(CA().totals(adv).repaidCents) + ' already repaid.';
        }
        if (msg) { setError(msg); return; }
        const f = { projectId, worker, issuedOn, amount: amt.value, pct: pct.value, notes: val('pcaNotes').trim() || null };
        await submit(m, () => (m.id ? H().server().editAdvance(m.opId, m.id, f) : H().server().recordAdvance(m.opId, f)),
                     (res) => A()._upsert(res.advance));
    }

    // ── record repayment ─────────────────────────────────────────────
    async function openRepaymentForm(advanceId) {
        const adv = S().advances.find(a => a.id === advanceId);
        if (!adv || adv.voided_at) return;
        const t = CA().totals(adv);
        if (t.balanceCents <= 0) return;
        const esc = H().esc, field = H().field, money = H().money;
        const m = S().modal = { kind: 'repay', advanceId, opId: CA().newOpId(), saving: false, label: 'Save repayment',
                                lines: [], linesError: false, basis: '', suggest: null };
        show('<h3 class="pca-modal-title">Record repayment</h3>'
            + '<p class="pca-sub">' + esc(adv.worker_name) + ' · Balance <b>' + money(t.balanceCents) + '</b></p>'
            + '<section class="pca-calc" aria-label="Suggested repayment">'
            +   '<h4 class="pca-calc-title">Suggested repayment (' + esc(CA().fmtPct(adv.suggest_pct)) + '% of payroll)</h4>'
            +   field('Payroll basis', '<select id="pcaBasis" class="pca-input" onchange="CashAdvanceAdmin.pickBasis(this.value)">'
                  + '<option value="">Loading payroll lines…</option></select>')
            +   '<div id="pcaBasisTyped" style="display:none">'
            +     field('Payroll amount (₱) — for the suggestion only', '<input id="pcaBasisAmt" class="pca-input" inputmode="decimal" oninput="CashAdvanceAdmin.renderCalc()">')
            +   '</div>'
            +   '<p id="pcaLinesNote" class="pca-muted"></p>'
            +   '<div id="pcaCalc" class="pca-calc-result"></div>'
            + '</section>'
            + field('Payment date', '<input id="pcaPaidOn" type="date" class="pca-input" value="' + esc(CA().dateKey()) + '">')
            + field('Actual repayment (₱)', '<input id="pcaAmt" class="pca-input" inputmode="decimal" value="">')
            + '<label class="pca-check" id="pcaLinkWrap" style="display:none"><input type="checkbox" id="pcaLinkRef" checked> Link this payroll line to the repayment</label>'
            + field('Notes', '<textarea id="pcaRepNotes" class="pca-input" rows="2"></textarea>')
            + '<p id="pcaFormError" class="pca-error" role="alert"></p>'
            + buttons('CashAdvanceAdmin.saveRepayment()', m.label));
        renderCalc();
        const res = await H().loadBills(adv.project_id);
        if (S().modal !== m) return;
        m.linesError = !!res.error;
        m.lines = res.error ? [] : CA().laborLines(res.bills, adv.worker_name, H().similar());
        const sel = $('pcaBasis');
        if (sel) {
            sel.innerHTML = (m.lines.length ? '<option value="">Choose a payroll line</option>' : '<option value="">No payroll lines for this worker</option>')
                + m.lines.map(l => '<option value="' + esc(l.key) + '">' + esc(H().fmtDay(l.day) + ' · ' + l.details + ' · ' + money(l.cents)) + '</option>').join('')
                + '<option value="typed">Type an amount</option>';
        }
        const note = $('pcaLinesNote');
        if (note) note.textContent = m.linesError ? "Payroll lines couldn't load — type an amount instead." : '';
        if (m.linesError) {
            if (sel) sel.value = 'typed';
            pickBasis('typed');
        }
    }

    const currentLine = (m) => (m.lines || []).find(l => l.key === m.basis) || null;
    function basisCents(m) {
        if (m.basis === 'typed') { const p = CA().parseAmount(val('pcaBasisAmt')); return p.ok ? p.cents : 0; }
        const l = currentLine(m);
        return l ? l.cents : 0;
    }
    function pickBasis(value) {
        const m = S().modal;
        if (!m || m.kind !== 'repay') return;
        m.basis = value || '';
        const typed = $('pcaBasisTyped'); if (typed) typed.style.display = m.basis === 'typed' ? '' : 'none';
        const link = $('pcaLinkWrap'); if (link) link.style.display = currentLine(m) ? '' : 'none';
        renderCalc();
    }
    function renderCalc() {
        const m = S().modal;
        if (!m || m.kind !== 'repay') return;
        const adv = S().advances.find(a => a.id === m.advanceId);
        const el = $('pcaCalc');
        if (!adv || !el) return;
        const money = H().money;
        const pct = Number(adv.suggest_pct) || 0;
        const b = basisCents(m);
        m.suggest = null;
        if (pct <= 0) { el.innerHTML = '<p class="pca-calc-line">No suggestion</p>' + NOTE; return; }
        if (b <= 0) { el.innerHTML = '<p class="pca-muted">Pick a payroll line or type an amount to see the suggestion.</p>' + NOTE; return; }
        const s = CA().suggestion(b, pct, CA().totals(adv).balanceCents);
        if (s.none) { el.innerHTML = '<p class="pca-calc-line">No suggestion</p>' + NOTE; return; }
        m.suggest = s.capped;
        el.innerHTML = '<p class="pca-calc-line">' + money(b) + ' × ' + H().esc(CA().fmtPct(pct)) + '% = <b>' + money(s.raw) + '</b> suggested</p>'
            + (s.isCapped ? '<p class="pca-calc-line">capped at the balance, <b>' + money(s.capped) + '</b></p>' : '')
            + '<button type="button" class="pca-btn" id="pcaUse" onclick="CashAdvanceAdmin.useSuggestion()">Use ' + money(s.capped) + '</button>'
            + NOTE;
    }
    function useSuggestion() {
        const m = S().modal;
        if (!m || m.kind !== 'repay' || m.suggest == null) return;
        const e = $('pcaAmt');
        if (e) e.value = (m.suggest / 100).toFixed(2);
    }
    async function saveRepayment() {
        const m = S().modal;
        if (!m || m.kind !== 'repay' || m.saving) return;
        const adv = S().advances.find(a => a.id === m.advanceId);
        if (!adv) return;
        const t = CA().totals(adv);
        const paidOn = val('pcaPaidOn');
        const amt = CA().parseAmount(val('pcaAmt'));
        let msg = '';
        if (!isDay(paidOn)) msg = 'Pick a date.';
        else if (!amt.ok) msg = amt.error;
        else if (amt.cents > t.balanceCents) msg = "That's more than the remaining balance of " + H().money(t.balanceCents) + '.';
        if (msg) { setError(msg); return; }
        const line = currentLine(m);
        const link = $('pcaLinkRef');
        const f = { paidOn, amount: amt.value, notes: val('pcaRepNotes').trim() || null,
                    payrollRef: line && link && link.checked ? CA().payrollRef(line) : null };
        await submit(m, () => H().server().recordRepayment(m.opId, m.advanceId, f), (res) => A()._upsert(res.advance));
    }

    // ── voids ────────────────────────────────────────────────────────
    function openVoid(what, id) {
        let adv = null, rep = null;
        if (what === 'repayment') {
            adv = S().advances.find(a => (a.repayments || []).some(r => r.id === id));
            rep = adv ? adv.repayments.find(r => r.id === id) : null;
            if (!rep || rep.voided_at || adv.voided_at) return;
        } else {
            adv = S().advances.find(a => a.id === id);
            if (!adv || adv.voided_at || (adv.repayments || []).some(r => !r.voided_at)) return;   // R11
        }
        const esc = H().esc, money = H().money;
        const label = what === 'repayment' ? 'Void repayment' : 'Void advance';
        S().modal = { kind: 'void', what, id, advanceId: adv.id, opId: CA().newOpId(), saving: false, label };
        show('<h3 class="pca-modal-title">' + label + '</h3>'
            + '<p class="pca-sub">' + (what === 'repayment'
                ? 'The ' + money(CA().toCents(rep.amount)) + ' repayment of ' + esc(H().fmtDay(rep.paid_on))
                  + ' stops counting and the balance goes back up by that amount. It stays in the history.'
                : 'This advance of ' + money(CA().toCents(adv.amount)) + ' to ' + esc(adv.worker_name)
                  + ' stops counting in every total. It stays in the history.') + '</p>'
            + H().field('Reason', '<textarea id="pcaVoidReason" class="pca-input" rows="2"></textarea>')
            + '<p id="pcaFormError" class="pca-error" role="alert"></p>'
            + buttons('CashAdvanceAdmin.saveVoid()', label, true));
    }
    async function saveVoid() {
        const m = S().modal;
        if (!m || m.kind !== 'void' || m.saving) return;
        const reason = val('pcaVoidReason').trim();
        if (!reason) { setError('Give a reason for voiding.'); return; }
        await submit(m, () => (m.what === 'repayment' ? H().server().voidRepayment(m.opId, m.id, reason)
                                                      : H().server().voidAdvance(m.opId, m.id, reason)),
                     (res) => A()._upsert(res.advance));
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', (e) => {
            if (e && e.key === 'Escape' && window.CashAdvanceAdmin && S().modal) closeModal();
        });
    }

    Object.assign(window.CashAdvanceAdmin, { openAdvanceForm, pickProject, saveAdvance, openRepaymentForm, pickBasis,
                                             renderCalc, useSuggestion, saveRepayment, openVoid, saveVoid, closeModal });
})();
