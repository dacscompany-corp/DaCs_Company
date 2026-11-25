// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing (0097). Buyers only (the nav hides it otherwise;
// the server refuses everyone else).
//
// One view with four tabs:
//   Shopping list    — this file: every open request line with something
//                      still to buy, its portions and who is buying each;
//   Purchases        — js/purchasing-admin-purchases.js;
//   Owner approvals  — js/purchasing-admin-purchases.js;
//   Cash             — js/purchasing-admin-cash.js (0102): the main owner's
//                      petty-cash tracker, or a buyer's own cash;
//   Company stock    — owner accounts, once stock is on (2C, 0105):
//                      js/stock-cost-admin.js.
//   Reconciliation   — owner accounts (Stage 4, 0109): where every purchase
//                      peso is, what is waiting, "Cover is right", money
//                      still out, bills to check — js/reconciliation-admin.js.
// "Record purchase" (js/purchasing-admin-record.js) opens from the list
// with the ticked lines.
// 0104: a line whose catalogue item is in the warehouse says so ("In
// warehouse: 12", a hint — no reservation) and, once stock is on, offers
// "Issue from stock" (js/stock-admin.js). "From stock" counts only issues.
//
// Wording (spec): Needed · Bought · Still to buy; "Unassigned / You /
// <name>"; assigning is NOT "arranged" — that stays its own button.
//
// Office redesign v5: every tab sits in the shared frame (PA.frame: title,
// pill tabs, the Record purchase pop-up). The Shopping list and Purchases
// are cards — a card's tick box adds the line to the purchase, the sticky
// "Record purchase (N)" records it, and a card opens its line (or
// purchase) in the pop-up. Owner approvals, Cash, Company stock and
// Reconciliation keep their own content inside the frame (custom body).
// Record purchase opens in the pop-up, wide, and is never closed by a
// stray click or Escape.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;
    const SV = root.SplitView;
    const RECORD = '__record';

    // Survives navigation within the session, not a reload.
    const ui = { tab: 'list', lastTab: 'list', batchId: null, folderId: '', text: '', mine: false, unassigned: false, urgent: false, picked: {},
                 lineSel: null, recordOpen: false };
    PA.ui = ui;

    function tabs() {
        const t = (id, label) => ({ id, label });
        return [t('list', 'Shopping list'), t('purchases', 'Purchases'), t('approvals', 'Owner approvals'), t('cash', 'Cash'),
            (companyStockTab() ? t('company', 'Company stock') : ''),
            (reconcileTab() ? t('reconcile', 'Reconciliation') : '')].filter(Boolean);
    }

    const TAB_HELP = {
        list: 'Bought something on the list? Tick it, then press Record purchase.',
        purchases: 'Project Control purchases are listed here too — check the Source and the project before you void anything.',
    };

    // The frame every Purchasing tab shares: title, tabs, and the Record
    // purchase pop-up (PA.openRecord → ui.recordOpen), which any tab can show.
    function frame(host, me, extra) {
        const cfg = Object.assign({
            key: 'reqPurchasing',
            title: 'Purchasing',
            sub: 'Who is buying what, what was bought, and what is still to buy. Prices show here only.',
            tabs: tabs().map(t => Object.assign(t, { help: TAB_HELP[t.id] || '' })),
            tab: ui.tab,
            onTab: id => { ui.tab = id; ui.lastTab = id; renderPurchasing(host); },
        }, extra);
        const inner = cfg.onSelect, innerClose = cfg.onClose;
        // Once Record purchase is showing, a redraw behind it never reloads
        // it: what was typed stays.
        if (ui.recordOpen) { cfg.selectedId = RECORD; if (ui.recordShown) cfg.refreshPanel = false; }
        cfg.onSelect = (id, panel, o) => {
            if (id === RECORD) {
                ui.recordShown = true;
                const body = SV.page(panel, { kicker: 'Purchasing', title: 'Record purchase', wide: true, keep: true });
                body.classList.add('pur-tab', 'req-detail');
                return PA.renderRecord(body, me);
            }
            if (inner) inner(id, panel, o);
        };
        cfg.onClose = was => {
            if (was === RECORD) { ui.recordOpen = false; ui.recordShown = false; }
            else if (innerClose) innerClose(was);
        };
        return cfg;
    }
    PA.frame = frame;

    // Stage 4: the owner's checks — owner accounts (the server refuses anyone else).
    function reconcileTab() {
        return !!(root.ReconciliationAdmin && PA.ui.isOwner);
    }

    // 2C: the value of company stock — owner accounts, once stock is on.
    function companyStockTab() {
        return !!(root.StockCostAdmin && root.currentStockOn && PA.ui.isOwner);
    }

    // Needed · Bought · Still to buy, as three blocks the eye can compare.
    function figures(l) {
        const stat = (label, value, cls) => '<div class="pur-stat' + (cls ? ' ' + cls : '') + '"><span class="pur-stat-label">' + label +
            '</span><strong>' + esc(PA.qty(value)) + '</strong></div>';
        return '<div class="pur-stats">' +
            stat('Needed', l.needed) +
            (Number(l.from_stock) > 0 ? stat('From stock', l.from_stock) : '') +
            (l._tools && Number(l._tools.filled) > 0 ? stat('Tools issued', l._tools.filled) : '') +
            stat('Bought', l.bought) +
            stat('Still to buy', l.still_to_buy, 'is-key') +
            (Number(l.extra) > 0 ? stat('Extra', l.extra) : '') +
            '<span class="pur-stat-unit">' + esc(l.unit) + '</span></div>';
    }

    function portionRow(p, me) {
        const a = PA.portionActions(p, me);
        const who = PA.buyerLabel(p, me);
        const btn = (act, label, extra) => '<button type="button" class="att-btn att-btn--sm' + (extra || '') + '" data-act="' + act +
            '" data-portion="' + esc(p.id) + '">' + label + '</button>';
        return '<div class="pur-portion' + (p.changed ? ' is-changed' : '') + '">' +
            '<div class="pur-pcell"><span class="pur-plabel">Weekly batch</span>' +
              '<span class="pur-portion-batch">' + esc('Cutoff ' + RA.cutoffLabel(p.cutoff_at)) + '</span></div>' +
            '<div class="pur-pcell"><span class="pur-plabel">To buy</span>' +
              '<span class="pur-portion-qty">' + esc(PA.qty(p.quantity - p.pending_reduction)) + ' needed · ' +
              (Number(p.from_stock) > 0 ? esc(PA.qty(p.from_stock)) + ' from stock · ' : '') +
              (Number(p._tools) > 0 ? esc(PA.qty(p._tools)) + ' tools issued · ' : '') +
              esc(PA.qty(p.bought)) + ' bought · <strong>' + esc(PA.qty(p.still_to_buy)) + ' still to buy</strong></span></div>' +
            '<div class="pur-pcell"><span class="pur-plabel">Buyer</span>' +
              '<span class="pur-portion-who' + (p.buyer_id ? '' : ' is-open') + '">' + esc(who) + '</span></div>' +
            '<div class="pur-ptags">' +
              (p.arranged ? PA.pill('Arranged', 'done') : '') +
              (p.changed ? PA.pill('Quantity changed', 'abandoned') : '') + '</div>' +
            '<span class="pur-portion-acts">' +
              (a.claim ? btn('claim', 'I\'ll buy this', ' att-btn--primary') : '') +
              (a.assign ? btn('assign', p.buyer_id ? 'Reassign…' : 'Assign…') : '') +
              (a.release ? btn('release', 'Release') : '') +
              btn(p.arranged ? 'unarrange' : 'arrange', p.arranged ? 'Undo arranged' : 'Mark arranged') +
            '</span></div>';
    }

    // A Shopping list card: the line, what is still to buy, who buys it.
    function cardOf(l, me) {
        const canBuy = Number(l.still_to_buy) > 0;
        const portions = l.portions || [];
        const buyers = portions.map(p => PA.buyerLabel(p, me)).filter((v, i, a) => a.indexOf(v) === i);
        const chips = [];
        if (l.urgent) chips.push({ text: 'URGENT' + (l.needed_by ? ' · by ' + RA.formatDay(l.needed_by) : ''), tone: 'red' });
        if (Number(l.unit_checks) > 0) chips.push({ text: 'Office check waiting', tone: 'red' });
        if (portions.some(p => p.changed)) chips.push({ text: 'Quantity changed', tone: 'red' });
        if (portions.length && portions.every(p => p.arranged)) chips.push({ text: 'Arranged', tone: 'done' });
        if (canBuy && Number(l.in_warehouse) > 0) chips.push({ text: 'In warehouse', tone: 'check' });
        return {
            id: l.line_id,
            title: l.description + (l.spec ? ' · ' + l.spec : ''),
            sub: l.project_name + ' · ' + l.work_name + ' · requested by ' + l.requester_name,
            meta: 'Needed ' + PA.qty(l.needed) + ' · Bought ' + PA.qty(l.bought) + ' · Buyer: ' + buyers.join(', '),
            right: PA.qty(l.still_to_buy) + ' ' + l.unit,
            pill: canBuy ? { text: 'Still to buy', tone: 'gold' } : { text: 'Bought', tone: 'done' },
            chips: chips,
            stripe: l.urgent ? 'red' : '',
            tick: canBuy ? { on: !!ui.picked[l.line_id], label: 'Add to the purchase' } : null,
        };
    }

    function lineCard(l, me, inPopup) {
        const urgent = l.urgent ? '<span class="req-urgent">URGENT' + (l.needed_by ? ' · by ' + esc(RA.formatDay(l.needed_by)) : '') + '</span>' : '';
        const canBuy = Number(l.still_to_buy) > 0;
        return '<div class="att-card pur-line' + (l.urgent ? ' is-urgent' : '') + '" data-line="' + esc(l.line_id) + '">' +
            '<div class="att-card-body">' +
              '<div class="pur-line-head">' +
                (inPopup ? '' : '<label class="pur-pick">' + (canBuy
                  ? '<input type="checkbox" data-pick="' + esc(l.line_id) + '"' + (ui.picked[l.line_id] ? ' checked' : '') + ' aria-label="Add to the purchase">'
                  : '') + '</label>') +
                '<div class="pur-line-main">' +
                  '<div class="pur-line-title"><strong>' + esc(l.description) + '</strong>' + (l.spec ? ' <span class="req-muted">' + esc(l.spec) + '</span>' : '') +
                    (l.catalog_name ? ' <span class="req-muted">· ' + esc(l.catalog_name) + '</span>' : '') + ' ' + urgent +
                    (Number(l.unit_checks) > 0 ? ' ' + PA.pill('Office check waiting', 'abandoned') : '') + '</div>' +
                  '<div class="req-muted">' + esc(l.project_name) + ' · ' + esc(l.work_name) + ' · requested by ' + esc(l.requester_name) + '</div>' +
                  // 0104: warehouse stock of this catalogue item — a hint to check
                  // before buying (no reservation, Q9); issuing is what counts.
                  (canBuy && Number(l.in_warehouse) > 0
                    ? '<div class="pur-instock"><i data-lucide="warehouse"></i> In warehouse: <strong>' + esc(PA.qty(l.in_warehouse)) + ' ' +
                      esc(l.in_warehouse_unit || l.unit) + '</strong> — check before buying' +
                      (root.StockAdmin && root.currentStockOn
                        ? ' <button type="button" class="att-btn att-btn--sm" data-issue="' + esc(l.line_id) + '">Issue from stock…</button>' : '') +
                      '</div>'
                    : '') +
                  // 0107 (Q14): each tool issued for this line — one bought for it
                  // counts through its purchase, once.
                  (l._tools && l._tools.tools.length
                    ? '<div class="pur-instock"><i data-lucide="wrench"></i> Issued: ' + l._tools.tools.map(t => '<strong>' + esc(t.label) + '</strong> with ' +
                      esc(t.holder_name) + (t.counted ? '' : ', bought for this')).join('; ') + '</div>'
                    : '') +
                '</div>' +
                figures(l) +
              '</div>' +
              '<div class="pur-portions">' + (l.portions || []).map(p => portionRow(p, me)).join('') + '</div>' +
            '</div></div>';
    }

    // The list's status sentence (it was a row of chips).
    function summaryText(lines, me) {
        const s = PA.listSummary(lines, me.userId);
        const parts = [s.lines + ' item' + (s.lines === 1 ? '' : 's') + ' to buy'];
        [[s.urgent, 'urgent'], [s.changed, 'quantity changed'], [s.unitChecks, 'unit check'], [s.unassigned, 'unassigned'], [s.mine, 'yours']]
            .forEach(([n, text]) => { if (n) parts.push(n + ' ' + text); });
        return parts.join(' · ');
    }

    let listData = null;    // { batches, lines, projects } as last loaded

    async function renderList(host, me, opts) {
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
        if (ui.tab !== 'list') return;    // another tab was chosen while this loaded
        lines = lines || [];
        // 0107 (Q14): the tools issued for these lines, while tools are on.
        let tools = {};
        if (root.currentToolsOn && lines.length) {
            try { tools = (await RA.rpc('tl_line_tools', { p_lines: lines.map(l => l.line_id) })) || {}; } catch (_) { tools = {}; }
        }
        lines.forEach(l => {
            l._tools = tools[l.line_id] || null;
            (l.portions || []).forEach(p => { p._tools = l._tools && l._tools.portions ? Number(l._tools.portions[p.id] || 0) : 0; });
        });
        const projects = [];
        lines.forEach(l => { if (!projects.some(p => p.id === l.project_id)) projects.push({ id: l.project_id, name: l.project_name }); });
        listData = { batches, lines, projects };
        drawList(host, me, opts);
    }

    function drawList(host, me, opts) {
        const { batches, lines, projects } = listData;
        const reload = () => renderList(host, me, { refreshPanel: true });
        const shown = PA.filterList(lines, { text: ui.text, mineOnly: ui.mine, unassignedOnly: ui.unassigned, urgentOnly: ui.urgent, userId: me.userId });
        if (opts && opts.leaveSelection && ui.lineSel && !shown.some(l => l.line_id === ui.lineSel)) ui.lineSel = null;
        const pickedCount = Object.keys(ui.picked).filter(k => ui.picked[k] && lines.some(l => l.line_id === k)).length;
        const toolbar =
            '<select class="sv-select" data-batch aria-label="Weekly batch">' +
              '<option value="">All weekly batches</option>' +
              batches.map(b => '<option value="' + esc(b.id) + '"' + (b.id === ui.batchId ? ' selected' : '') + '>' +
                esc('Cutoff ' + RA.cutoffLabel(b.cutoff_at) + ' · Buy ' + RA.formatDay(b.purchase_on)) + '</option>').join('') +
            '</select>' +
            '<select class="sv-select" data-folder aria-label="Project">' +
              '<option value="">All projects</option>' +
              projects.map(p => '<option value="' + esc(p.id) + '"' + (p.id === ui.folderId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
            '</select>' +
            '<div class="pur-quick" role="group" aria-label="Quick filters">' +
              '<label class="pur-chip"><input type="checkbox" data-mine' + (ui.mine ? ' checked' : '') + '><span>Mine</span></label>' +
              '<label class="pur-chip"><input type="checkbox" data-unassigned' + (ui.unassigned ? ' checked' : '') + '><span>Unassigned</span></label>' +
              '<label class="pur-chip"><input type="checkbox" data-urgent' + (ui.urgent ? ' checked' : '') + '><span>Urgent</span></label>' +
            '</div>' +
            (pickedCount ? '<button type="button" class="att-btn" data-clear-picks>Clear</button>' : '') +
            '<button type="button" class="att-btn" data-unplanned><i data-lucide="plus"></i> Purchase with no request</button>';

        root.SplitView.render(host, frame(host, me, {
            lede: summaryText(lines, me),
            search: { placeholder: 'Search item, project, worker…', value: ui.text, onInput: t => { ui.text = t; drawList(host, me, { leaveSelection: true }); } },
            toolbar: toolbar,
            onToolbar: el => {
                el.querySelector('[data-batch]').addEventListener('change', e => { ui.batchId = e.target.value; ui.picked = {}; renderList(host, me); });
                el.querySelector('[data-folder]').addEventListener('change', e => { ui.folderId = e.target.value; renderList(host, me); });
                el.querySelector('[data-mine]').addEventListener('change', e => { ui.mine = e.target.checked; drawList(host, me, { leaveSelection: true }); });
                el.querySelector('[data-unassigned]').addEventListener('change', e => { ui.unassigned = e.target.checked; drawList(host, me, { leaveSelection: true }); });
                el.querySelector('[data-urgent]').addEventListener('change', e => { ui.urgent = e.target.checked; drawList(host, me, { leaveSelection: true }); });
                const clr = el.querySelector('[data-clear-picks]');
                if (clr) clr.addEventListener('click', () => { ui.picked = {}; drawList(host, me); });
                el.querySelector('[data-unplanned]').addEventListener('click', () => PA.openRecord({ requestLines: [] }));
            },
            showing: shown.length !== lines.length ? 'Showing ' + shown.length + ' of ' + lines.length : '',
            groups: [{ title: '', rows: shown.map(l => cardOf(l, me)) }],
            empty: lines.length ? 'Nothing matches these filters.' : 'Nothing left to buy in this batch.',
            onTick: (id, on) => { ui.picked[id] = on; drawList(host, me); },
            tickBar: { label: 'Record purchase', onClick: () => {
                const picked = lines.filter(l => ui.picked[l.line_id]);
                if (picked.length) PA.openRecord({ requestLines: picked, batchId: ui.batchId || '', onDone: () => { ui.picked = {}; } });
            } },
            selectedId: ui.lineSel,
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel) => {
                ui.lineSel = id;
                const l = lines.find(x => x.line_id === id);
                if (!l) { SV.error(panel, 'This item is no longer on the list. It may be bought already.'); return; }
                const body = SV.page(panel, {
                    kicker: 'Shopping list · one request line',
                    title: l.description + (l.spec ? ' · ' + l.spec : ''),
                    sub: l.project_name + ' · ' + l.work_name + ' · requested by ' + l.requester_name,
                    nextLabel: 'Next item',
                });
                body.innerHTML = '<div class="att-stack pur-tab req-detail">' + lineCard(l, me, true) + '</div>';
                // One handler per panel (assigned, never added): a fresh
                // panel per item, so nothing stacks.
                panel.onclick = e => {
                    const b = e.target.closest('[data-act]');
                    if (b && b.dataset.portion) { act(b.dataset.act, b.dataset.portion, lines, me, reload); return; }
                    const issue = e.target.closest('[data-issue]');
                    const line = l;
                    if (issue && root.StockAdmin) root.StockAdmin.openIssue(line, reload);
                };
                RA.icons();
            },
            onClose: () => { ui.lineSel = null; },
        }));
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
        host.innerHTML = '<div class="sv"><div class="sv-empty">Loading…</div></div>';
        let me;
        try { me = await PA.me(); } catch (e) { RA.fail(host, e); return; }
        ui.isOwner = !!me.isOwner;
        if (!me.canBuy) {
            host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' +
                esc(PA.ERRORS.BUYER_REQUIRED) + '</div></div></div>';
            RA.icons();
            return;
        }
        // PA.openRecord asked for the Record purchase pop-up over the tab the
        // office was on.
        if (ui.tab === 'record') { ui.recordOpen = true; ui.tab = ui.lastTab || 'list'; }
        if ((ui.tab === 'company' && !companyStockTab()) || (ui.tab === 'reconcile' && !reconcileTab())) ui.tab = 'list';
        if (ui.tab === 'purchases') return PA.renderPurchases(host, me);
        if (ui.tab === 'list') return renderList(host, me, { refreshPanel: true });
        // Owner approvals, Cash, Company stock and Reconciliation keep their
        // own content (sections, tables, their buttons) inside the frame.
        root.SplitView.render(host, frame(host, me, {
            custom: true,
            search: false,
            refreshPanel: true,
            onCustom: el => {
                el.classList.add('pur-tab', 'req-detail');
                if (ui.tab === 'approvals') return PA.renderApprovals(el, me);
                if (ui.tab === 'cash' && PA.renderCash) return PA.renderCash(el, me);
                if (ui.tab === 'company' && companyStockTab()) return root.StockCostAdmin.renderCompanyStock(el);
                if (ui.tab === 'reconcile' && reconcileTab()) return root.ReconciliationAdmin.render(el);
            },
        }));
    }

    PA.renderPurchasing = renderPurchasing;
    RA.views.reqPurchasing = renderPurchasing;
})(typeof window !== 'undefined' ? window : globalThis);