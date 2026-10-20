// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing (0097). Buyers only (the nav hides it otherwise;
// the server refuses everyone else).
//
// One view with three tabs:
//   Shopping list    — this file: every open request line with something
//                      still to buy, its portions and who is buying each;
//   Purchases        — js/purchasing-admin-purchases.js;
//   Owner approvals  — js/purchasing-admin-purchases.js.
// "Record purchase" (js/purchasing-admin-record.js) opens from the list
// with the ticked lines.
//
// Wording (spec): Needed · Bought · Still to buy; "Unassigned / You /
// <name>"; assigning is NOT "arranged" — that stays its own button.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    // Survives navigation within the session, not a reload.
    const ui = { tab: 'list', batchId: null, folderId: '', text: '', mine: false, unassigned: false, urgent: false, picked: {} };
    PA.ui = ui;

    function tabs() {
        const t = (id, label) => '<button type="button" class="att-seg-btn' + (ui.tab === id ? ' is-on' : '') + '" data-tab="' + id + '">' + label + '</button>';
        return '<div class="att-seg" role="tablist" aria-label="Purchasing">' +
            t('list', 'Shopping list') + t('purchases', 'Purchases') + t('approvals', 'Owner approvals') + '</div>';
    }

    function figures(l) {
        const parts = ['Needed <strong>' + esc(PA.qty(l.needed)) + '</strong>'];
        if (Number(l.from_stock) > 0) parts.push('From stock <strong>' + esc(PA.qty(l.from_stock)) + '</strong>');
        parts.push('Bought <strong>' + esc(PA.qty(l.bought)) + '</strong>');
        parts.push('Still to buy <strong>' + esc(PA.qty(l.still_to_buy)) + '</strong>');
        if (Number(l.extra) > 0) parts.push('Extra <strong>' + esc(PA.qty(l.extra)) + '</strong>');
        return '<div class="pur-figures">' + parts.join(' · ') + ' <span class="req-muted">' + esc(l.unit) + '</span></div>';
    }

    function portionRow(p, me) {
        const a = PA.portionActions(p, me);
        const who = PA.buyerLabel(p, me);
        const btn = (act, label, extra) => '<button type="button" class="att-btn att-btn--sm' + (extra || '') + '" data-act="' + act +
            '" data-portion="' + esc(p.id) + '">' + label + '</button>';
        return '<div class="pur-portion' + (p.changed ? ' is-changed' : '') + '">' +
            '<span class="pur-portion-batch">' + esc('Cutoff ' + RA.cutoffLabel(p.cutoff_at)) + '</span>' +
            '<span class="pur-portion-qty">' + esc(PA.qty(p.quantity - p.pending_reduction)) + ' needed · ' +
              esc(PA.qty(p.bought)) + ' bought · <strong>' + esc(PA.qty(p.still_to_buy)) + ' still to buy</strong></span>' +
            '<span class="pur-portion-who' + (p.buyer_id ? '' : ' is-open') + '">' + esc(who) + '</span>' +
            (p.arranged ? PA.pill('Arranged', 'done') : '') +
            (p.changed ? PA.pill('Quantity changed', 'abandoned') : '') +
            '<span class="pur-portion-acts">' +
              (a.claim ? btn('claim', 'I\'ll buy this', ' att-btn--primary') : '') +
              (a.assign ? btn('assign', p.buyer_id ? 'Reassign…' : 'Assign…') : '') +
              (a.release ? btn('release', 'Release') : '') +
              btn(p.arranged ? 'unarrange' : 'arrange', p.arranged ? 'Undo arranged' : 'Mark arranged') +
            '</span></div>';
    }

    function lineCard(l, me) {
        const urgent = l.urgent ? '<span class="req-urgent">URGENT' + (l.needed_by ? ' · by ' + esc(RA.formatDay(l.needed_by)) : '') + '</span>' : '';
        const canBuy = Number(l.still_to_buy) > 0;
        return '<div class="att-card pur-line' + (l.urgent ? ' is-urgent' : '') + '" data-line="' + esc(l.line_id) + '">' +
            '<div class="att-card-body">' +
              '<div class="pur-line-head">' +
                '<label class="pur-pick">' + (canBuy
                  ? '<input type="checkbox" data-pick="' + esc(l.line_id) + '"' + (ui.picked[l.line_id] ? ' checked' : '') + ' aria-label="Add to the purchase">'
                  : '') + '</label>' +
                '<div class="pur-line-main">' +
                  '<div><strong>' + esc(l.description) + '</strong>' + (l.spec ? ' <span class="req-muted">' + esc(l.spec) + '</span>' : '') +
                    (l.catalog_name ? ' <span class="req-muted">· ' + esc(l.catalog_name) + '</span>' : '') + ' ' + urgent +
                    (Number(l.unit_checks) > 0 ? ' ' + PA.pill('Office check waiting', 'abandoned') : '') + '</div>' +
                  '<div class="req-muted">' + esc(l.project_name) + ' · ' + esc(l.work_name) + ' · requested by ' + esc(l.requester_name) + '</div>' +
                  figures(l) +
                '</div>' +
              '</div>' +
              '<div class="pur-portions">' + (l.portions || []).map(p => portionRow(p, me)).join('') + '</div>' +
            '</div></div>';
    }

    function summaryHtml(lines, me) {
        const s = PA.listSummary(lines, me.userId);
        const chip = (n, text, tone) => n ? '<span class="req-sum req-sum--' + tone + '"><strong>' + n + '</strong> ' + text + '</span>' : '';
        return '<div class="req-summary">' +
            '<span class="req-sum req-sum--plain"><strong>' + s.lines + '</strong> item' + (s.lines === 1 ? '' : 's') + ' to buy</span>' +
            chip(s.urgent, 'urgent', 'red') + chip(s.changed, 'quantity changed', 'red') + chip(s.unitChecks, 'unit check', 'gold') +
            chip(s.unassigned, 'unassigned', 'gold') + chip(s.mine, 'yours', 'green') + '</div>';
    }

    async function renderList(host, me) {
        let batches, lines;
        try {
            batches = await RA.rpc('pr_office_batches');
            batches = batches || [];
            if (ui.batchId === null) {
                const now = Date.now();
                const current = batches.find(b => Date.parse(b.cutoff_at) > now);
                ui.batchId = current ? current.id : '';
            }
            if (ui.batchId && !batches.some(b => b.id === ui.batchId)) ui.batchId = '';
            lines = await RA.rpc('pur_shopping_list', { p_batch: ui.batchId || null, p_folder: ui.folderId || null, p_scope: 'open' });
        } catch (e) { RA.fail(host, e); return; }
        lines = lines || [];
        const projects = [];
        lines.forEach(l => { if (!projects.some(p => p.id === l.project_id)) projects.push({ id: l.project_id, name: l.project_name }); });
        const shown = PA.filterList(lines, { text: ui.text, mineOnly: ui.mine, unassignedOnly: ui.unassigned, urgentOnly: ui.urgent, userId: me.userId });
        const pickedCount = Object.keys(ui.picked).filter(k => ui.picked[k] && lines.some(l => l.line_id === k)).length;

        host.querySelector('[data-body]').innerHTML =
            summaryHtml(lines, me) +
            '<div class="att-toolbar">' +
              '<select class="att-filter" data-batch aria-label="Weekly batch">' +
                '<option value="">All weekly batches</option>' +
                batches.map(b => '<option value="' + esc(b.id) + '"' + (b.id === ui.batchId ? ' selected' : '') + '>' +
                  esc('Cutoff ' + RA.cutoffLabel(b.cutoff_at) + ' · Buy ' + RA.formatDay(b.purchase_on)) + '</option>').join('') +
              '</select>' +
              '<select class="att-filter" data-folder aria-label="Project">' +
                '<option value="">All projects</option>' +
                projects.map(p => '<option value="' + esc(p.id) + '"' + (p.id === ui.folderId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
              '</select>' +
              '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                '<input class="att-search" type="search" data-text aria-label="Search" placeholder="Search item, project, worker…" value="' + esc(ui.text) + '"></div>' +
              '<label class="req-toggle"><input type="checkbox" data-mine' + (ui.mine ? ' checked' : '') + '> Mine</label>' +
              '<label class="req-toggle"><input type="checkbox" data-unassigned' + (ui.unassigned ? ' checked' : '') + '> Unassigned</label>' +
              '<label class="req-toggle"><input type="checkbox" data-urgent' + (ui.urgent ? ' checked' : '') + '> Urgent</label>' +
              '<button type="button" class="att-btn att-btn--primary" data-record' + (pickedCount ? '' : ' disabled') + '>' +
                '<i data-lucide="shopping-cart"></i> Record purchase' + (pickedCount ? ' (' + pickedCount + ')' : '') + '</button>' +
              '<button type="button" class="att-btn" data-unplanned><i data-lucide="plus"></i> Purchase with no request</button>' +
            '</div>' +
            (shown.length
              ? shown.map(l => lineCard(l, me)).join('')
              : '<div class="att-empty">' + (lines.length ? 'Nothing matches these filters.' : 'Nothing left to buy in this batch.') + '</div>');

        const body = host.querySelector('[data-body]');
        const reload = () => renderList(host, me);
        body.querySelector('[data-batch]').addEventListener('change', e => { ui.batchId = e.target.value; ui.picked = {}; reload(); });
        body.querySelector('[data-folder]').addEventListener('change', e => { ui.folderId = e.target.value; reload(); });
        body.querySelector('[data-text]').addEventListener('change', e => { ui.text = e.target.value; reload(); });
        body.querySelector('[data-mine]').addEventListener('change', e => { ui.mine = e.target.checked; reload(); });
        body.querySelector('[data-unassigned]').addEventListener('change', e => { ui.unassigned = e.target.checked; reload(); });
        body.querySelector('[data-urgent]').addEventListener('change', e => { ui.urgent = e.target.checked; reload(); });
        body.querySelectorAll('[data-pick]').forEach(c => c.addEventListener('change', () => { ui.picked[c.dataset.pick] = c.checked; reload(); }));
        body.querySelector('[data-record]').addEventListener('click', () => {
            const picked = lines.filter(l => ui.picked[l.line_id]);
            if (picked.length) PA.openRecord({ requestLines: picked, batchId: ui.batchId || '', onDone: () => { ui.picked = {}; } });
        });
        body.querySelector('[data-unplanned]').addEventListener('click', () => PA.openRecord({ requestLines: [] }));
        body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act, b.dataset.portion, lines, me, reload)));
        RA.icons();
    }

    async function act(kind, portionId, lines, me, reload) {
        const line = lines.find(l => (l.portions || []).some(p => p.id === portionId));
        const p = line && line.portions.find(x => x.id === portionId);
        if (!p) return;
        const run = async (name, args) => {
            try { await RA.rpc(name, args); reload(); }
            catch (e) { PA.notice(e); }
        };
        if (kind === 'claim') return run('pur_assign_portion', { p_portion: p.id, p_buyer: me.userId, p_quantity: null, p_note: null });
        if (kind === 'release') return run('pur_assign_portion', { p_portion: p.id, p_buyer: null, p_quantity: null, p_note: null });
        if (kind === 'arrange' || kind === 'unarrange') return run('pr_office_set_arranged', { p_portion: p.id, p_arranged: kind === 'arrange' });
        if (kind === 'assign') {
            let options;
            try { options = await RA.rpc('pur_buyer_options'); } catch (e) { return PA.notice(e); }
            RA.modal({
                title: (p.buyer_id ? 'Reassign' : 'Assign') + ' — ' + line.description,
                sub: 'Still to buy: ' + PA.qty(p.still_to_buy) + ' ' + line.unit + '. What was already bought stays with whoever bought it.',
                body:
                    '<label class="att-label">Buyer<select class="att-input" name="buyer">' +
                      (options || []).map(o => '<option value="' + esc(o.user_id) + '"' + (o.user_id === p.buyer_id ? ' selected' : '') + '>' +
                        esc(o.is_me ? 'You (' + o.name + ')' : o.name) + '</option>').join('') +
                    '</select></label>' +
                    '<label class="att-label">Quantity<input class="att-input" name="qty" inputmode="decimal" value="' + esc(PA.qty(p.still_to_buy)) + '"></label>' +
                    '<p class="req-muted">Less than all of it splits that part off for this buyer; the rest stays as it is.</p>' +
                    '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label>',
                submitLabel: 'Assign',
                errorMessage: PA.errorMessage,
                onSubmit: async (form) => {
                    const q = PA.parseQty(form.qty.value);
                    if (q === null) throw new Error('BAD_QUANTITY');
                    await RA.rpc('pur_assign_portion', { p_portion: p.id, p_buyer: form.buyer.value,
                        p_quantity: q === Number(p.still_to_buy) ? null : q, p_note: form.note.value.trim() || null });
                },
                onDone: reload,
            });
        }
    }

    async function renderPurchasing(host) {
        host.innerHTML = '<div class="att-stack pur-tab"><div class="att-empty">Loading…</div></div>';
        let me;
        try { me = await PA.me(); } catch (e) { RA.fail(host, e); return; }
        if (!me.canBuy) {
            host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' +
                esc(PA.ERRORS.BUYER_REQUIRED) + '</div></div></div>';
            RA.icons();
            return;
        }
        host.innerHTML =
            '<div class="att-stack pur-tab">' +
              RA.head('Purchasing', 'Who is buying what, what was bought, and what is still to buy. Prices show here only.', tabs()) +
              '<div data-body><div class="att-empty">Loading…</div></div>' +
            '</div>';
        host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            if (ui.tab === b.dataset.tab) return;
            ui.tab = b.dataset.tab;
            renderPurchasing(host);
        }));
        if (ui.tab === 'purchases') return PA.renderPurchases(host.querySelector('[data-body]'), me);
        if (ui.tab === 'approvals') return PA.renderApprovals(host.querySelector('[data-body]'), me);
        if (ui.tab === 'record') return PA.renderRecord(host.querySelector('[data-body]'), me);
        return renderList(host, me);
    }

    PA.renderPurchasing = renderPurchasing;
    RA.views.reqPurchasing = renderPurchasing;
})(typeof window !== 'undefined' ? window : globalThis);
