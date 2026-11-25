// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Purchases, one purchase (reqPurchase) and Owner
// approvals (0097). Buyers only.
//
//   Purchases        — newest first, a date range, a project (with its
//                      Additional Works) and a search; where each was
//                      entered (Source: Project Control / Purchasing /
//                      Phone) — real Project Control purchases share this
//                      list (2A-3a, Q17).
//   One purchase     — its lines, what each covered on its request, extras,
//                      unit checks, receipt photos ("No receipt" and why),
//                      history; Correct (the record form), Void (the person
//                      types the project's first word, R6), Check a
//                      different unit, Record again from a voided one (R7).
//   Owner approvals  — staff changes the server keeps for the owner. The
//                      owner approves (the server runs the very same
//                      correct / replace / void) or rejects with a note;
//                      staff see their own and can withdraw.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    function monthStart() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
    }
    function todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    const ui = { from: null, to: null, status: 'recorded', folder: '', search: '', projects: null, sel: null };
    const SV = root.SplitView;
    const TONE = { done: 'done', working: 'gold', abandoned: 'red', pc: 'check', pm: 'pm', none: 'none', hidden: 'none' };

    // One card of the Purchases list (office v5): Recorded / Void, its
    // flags and the total on top; supplier; where it went and where it was
    // entered; who bought it and how it was paid. Buyers only reach this
    // tab, so the total and how it was paid show here.
    function purchaseCard(p) {
        const pay = PA.payLabel(p.pay);
        const forText = (p.projects || []).join(', ') + (p.warehouse ? ((p.projects || []).length ? ' · ' : '') + 'Warehouse' : '');
        return {
            id: p.id,
            title: p.supplier || 'No supplier',
            sub: (forText || '—') + ' · ' + PA.sourceLabel(p.source) + ' · ' + p.lines + (p.lines === 1 ? ' line' : ' lines') +
                (p.linked ? ' · ' + p.linked + ' from requests' : ''),
            meta: RA.formatDay(p.purchase_date) + ' · bought by ' + p.bought_by_name +
                (p.bought_by_name !== p.recorded_by_name ? ', recorded by ' + p.recorded_by_name : '') +
                (pay ? ' · ' + pay.text + (pay.detail ? ' (' + pay.detail + ')' : '') : ''),
            right: PA.peso(p.receipt_total),
            pill: p.status === 'void' ? { text: 'Void', tone: 'red' } : { text: 'Recorded', tone: 'done' },
            chips: PA.purchaseFlags(p).filter(x => x.text !== 'Void').map(x => ({ text: x.text, tone: TONE[x.tone] || 'none' })),
            dim: p.status === 'void',
        };
    }

    async function renderPurchases(host, me, opts) {
        if (ui.from === null) { ui.from = monthStart(); ui.to = todayKey(); }
        // A purchase opened from elsewhere (PA.openPurchase).
        if (PA.state.purchaseId) { ui.sel = PA.state.purchaseId; PA.state.purchaseId = null; }
        let rows;
        try {
            // Every project, completed ones too (an old purchase may need finding).
            if (!ui.projects) ui.projects = (await RA.rpc('pr_office_projects')) || [];
            rows = await RA.rpc('pur_purchases', { p_from: ui.from || null, p_to: ui.to || null, p_folder: ui.folder || null, p_status: ui.status });
        } catch (e) { RA.fail(host, e); return; }
        if (PA.ui.tab !== 'purchases') return;   // another tab was chosen while this loaded
        rows = rows || [];
        const reload = () => renderPurchases(host, me, { refreshPanel: true });
        const toolbar =
            '<label class="att-label">From<input class="att-input" type="date" data-from value="' + esc(ui.from) + '"></label>' +
            '<label class="att-label">To<input class="att-input" type="date" data-to value="' + esc(ui.to) + '"></label>' +
            '<select class="sv-select" data-status aria-label="Status">' +
              [['recorded', 'Recorded'], ['void', 'Voided'], ['all', 'All']].map(s => '<option value="' + s[0] + '"' + (s[0] === ui.status ? ' selected' : '') + '>' + s[1] + '</option>').join('') +
            '</select>' +
            '<select class="sv-select" data-folder aria-label="Project">' +
              '<option value="">All projects</option>' +
              ui.projects.map(f => '<option value="' + esc(f.folder_id) + '"' + (f.folder_id === ui.folder ? ' selected' : '') + '>' +
                esc(f.name + (f.completed ? ' (completed)' : '')) + '</option>').join('') +
            '</select>';
        // The search filters what the server sent, without a reload.
        const draw = (o) => {
            const shown = PA.searchPurchases(rows, ui.search);
            if (o && o.leaveSelection && ui.sel && !shown.some(p => p.id === ui.sel)) ui.sel = null;
            root.SplitView.render(host, PA.frame(host, me, {
                search: { placeholder: 'Search supplier, project, person, source…', value: ui.search, onInput: t => { ui.search = t; draw({ leaveSelection: true }); } },
                toolbar: toolbar,
                onToolbar: el => {
                    el.querySelector('[data-from]').addEventListener('change', e => { ui.from = e.target.value; renderPurchases(host, me); });
                    el.querySelector('[data-to]').addEventListener('change', e => { ui.to = e.target.value; renderPurchases(host, me); });
                    el.querySelector('[data-status]').addEventListener('change', e => { ui.status = e.target.value; renderPurchases(host, me); });
                    el.querySelector('[data-folder]').addEventListener('change', e => { ui.folder = e.target.value; renderPurchases(host, me); });
                },
                showing: rows.length >= 300 ? 'Showing the newest 300 — narrow the dates.' : (shown.length !== rows.length ? 'Showing ' + shown.length + ' of ' + rows.length : ''),
                groups: [{ title: '', rows: shown.map(purchaseCard) }],
                empty: rows.length ? 'Nothing matches the search.' : 'No purchases in these dates.',
                selectedId: ui.sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel) => { ui.sel = id; renderPurchasePanel(panel, id, { onChanged: reload, nextLabel: 'Next purchase' }); },
                onClose: () => { ui.sel = null; },
            }));
        };
        draw(opts);
    }

    function lineRow(l, doc) {
        const covers = (doc.covers || []).filter(c => c.line === l.line);
        const req = (doc.requests || []).find(r => r.line === l.line);
        let what;
        if (req) {
            what = 'For request: ' + esc(req.description) + ' · covered ' + esc(PA.qty(l.covered) + ' ' + req.unit);
            if (Number(l.extra) > 0) what += ' · <strong>extra ' + esc(PA.qty(l.extra)) + '</strong> (' + esc(l.extra_reason) + '; ' + (l.extra_location === 'warehouse' ? 'warehouse' : 'same project') + ')';
            if (l.substitute) what += '<div>' + PA.pill('Substitute', 'pc') + ' for ' + esc(req.description + (req.spec ? ' ' + req.spec : '')) + ': ' + esc(l.substitute_reason) + '</div>';
            if (l.unit_check === 'pending') what += ' · ' + PA.pill((l.substitute ? 'Substitute' : 'Different unit') + ' — office check needed', 'abandoned');
            if (l.unit_check === 'confirmed') what += ' · ' + PA.pill('Checked: covers ' + PA.qty(l.unit_covers) + ' ' + req.unit, 'done');
            if (covers.length) what += '<div class="req-muted">' + covers.map(c => esc(PA.qty(c.quantity) + ' for ' + (c.cutoff_at ? 'Cutoff ' + RA.cutoffLabel(c.cutoff_at) : 'a removed portion') + ' · bought by ' + c.buyer_name)).join('<br>') + '</div>';
        } else {
            what = l.destination === 'warehouse' ? 'Warehouse — company stock' : 'Unplanned';
            if (l.unplanned_reason) what += ': ' + esc(l.unplanned_reason);
        }
        return [esc(l.line), '<strong>' + esc(l.item_name) + '</strong><div class="req-muted">' +
                esc(l.destination === 'warehouse' ? 'Warehouse' : l.folder_name) + '</div>',
            esc(PA.qty(l.quantity) + ' ' + (l.unit || '')), esc(PA.peso(l.amount)),
            what + (l.needs_funding_review ? ' ' + PA.pill('Office review', 'working') : '')];
    }

    // "Office review" (v5 lines): every line an office check or a billing
    // period is waiting on, with its button.
    function reviewLines(doc) {
        const out = [];
        (doc.lines || []).forEach(l => {
            const req = (doc.requests || []).find(r => r.line === l.line);
            if (l.unit_check === 'pending' && req) {
                out.push({
                    t: (l.substitute ? 'Substitute' : 'Different unit') + ' — office check needed',
                    s: 'Line ' + l.line + ' · bought ' + PA.qty(l.quantity) + ' ' + (l.unit || '') + ' of ' + l.item_name +
                       ' · the request asked for ' + req.description + (req.spec ? ' ' + req.spec : '') + ' in ' + req.unit,
                    acts: SV.lbtn(l.substitute ? 'Check substitute…' : 'Check unit…', 'data-check="' + esc(l.line) + '"', 'primary'),
                });
            }
            if (l.unit_check === 'confirmed' && req) {
                out.push({ t: 'Checked: covers ' + PA.qty(l.unit_covers) + ' ' + req.unit, s: 'Line ' + l.line + ' · ' + l.item_name, pills: [{ text: 'Checked', tone: 'done' }] });
            }
            if (l.needs_funding_review) {
                out.push({ t: 'Office review', s: 'Line ' + l.line + ' · ' + l.item_name + ' — on Cover until its month has a billing period (Reconciliation).',
                           pills: [{ text: 'Office review', tone: 'gold' }] });
            }
        });
        return out;
    }

    // One purchase in the Purchasing pop-up (office v5), through the page
    // shell, wide (the lines table). hooks: { onChanged(): reload the list and
    // this purchase, nextLabel }.
    async function renderPurchasePanel(panel, id, hooks) {
        const showing = () => panel.isConnected && panel.dataset.svId === id;
        if (!panel.dataset.svRestore) panel.innerHTML = '<div class="sv-panel-empty">Loading…</div>';
        let me, doc, replaces = null;
        try {
            me = await PA.me();
            doc = await RA.rpc('pur_purchase', { p_purchase: id });
        } catch (e) { if (showing()) SV.error(panel, PA.errorMessage(e)); return; }
        if (!showing()) return;   // the pop-up closed or moved on while this loaded
        // The earlier version this purchase replaced, if any (the server keeps
        // only the forward link). This tab is buyers-only, and buyers may read
        // purchase rows; for anyone else it finds nothing and nothing is shown.
        try {
            const r = await root.sbClient.from('purchases').select('id').eq('replaced_by', doc.id).limit(1);
            if (!r.error && r.data && r.data.length) replaces = r.data[0].id;
        } catch (_) { /* only a link */ }
        const open = doc.status === 'recorded';
        const pending = (doc.change_requests || []).find(r => r.status === 'pending');
        const docs = Object.entries(doc.docs || {}).filter(([, v]) => v);
        // R6: the word typed before a void (the one project's first word, else VOID).
        const word = PA.voidWord(PA.placesOf(doc));
        if (!showing()) return;
        const pay = PA.payLabel(doc.pay);
        // The footer: the payment buttons (filled by js/purchasing-admin-pay.js)
        // then Correct, Void, Record again.
        const acts = '<span class="sv-acts-slot" data-pay-acts></span>' +
            (open && !pending ? SV.lbtn('Correct…', 'data-correct') + SV.lbtn('Void…', 'data-void', 'danger') : '') +
            (PA.canRecordAgain(doc) ? SV.lbtn('Record again…', 'data-again') : '');
        const host = SV.page(panel, {
            kicker: 'Purchase · ' + RA.formatDay(doc.purchase_date),
            title: doc.supplier || 'No supplier',
            pills: [doc.status === 'void' ? { text: 'Void', tone: 'red' } : { text: 'Recorded', tone: 'done' }]
                .concat(pay ? [{ text: pay.text, tone: TONE[pay.tone] || 'none' }] : [])
                .concat(pending ? [{ text: 'Owner approval pending', tone: 'gold' }] : []),
            sub: PA.peso(doc.receipt_total) +
                ' · bought by ' + doc.bought_by_name + (doc.bought_by_name !== doc.recorded_by_name ? ', recorded by ' + doc.recorded_by_name : '') +
                ' · entered in ' + PA.sourceLabel(doc.source),
            actions: acts,
            wide: true,
            nextLabel: hooks.nextLabel,
        });
        const review = reviewLines(doc);
        const history = (doc.history || []).map(h => ({ at: h.at, when: RA.formatManila(h.at), html: '<strong>' + esc(PA.HISTORY_LABEL[h.kind] || h.kind) + '</strong> by ' +
                  esc(h.actor_name) + (h.reason ? ': ' + esc(h.reason) : '') }))
            .concat((doc.change_requests || []).map(r => ({ at: r.requested_at, when: RA.formatManila(r.requested_at), html: '— owner approval asked by ' + esc(r.requested_by_name) +
                  ' (' + esc(r.kind) + '): ' + esc(r.reason) + ' — <strong>' + esc(PA.REQUEST_STATUS[r.status] || r.status) + '</strong>' +
                  (r.decision_note ? ': ' + esc(r.decision_note) : '') })))
            .sort((x, y) => String(y.at).localeCompare(String(x.at)));
        host.innerHTML =
            '<div class="att-stack pur-tab req-detail sv-page-secs">' +
              (doc.status === 'void' ? SV.notice('red', 'ban', 'Voided — it counts for nothing in Spent or Bought.',
                  doc.replaced_by ? 'It was replaced by a newer version. <a class="att-link" href="#" data-open-purchase="' + esc(doc.replaced_by) + '">Open the newer version</a>'
                                  : 'Its receipt and history are kept.') : '') +
              (replaces ? SV.notice('grey', 'history', 'This is a newer version: it replaced an earlier purchase.',
                  '<a class="att-link" href="#" data-open-purchase="' + esc(replaces) + '">Open the earlier version</a>') : '') +
              (pending ? SV.notice('gold', 'hourglass', 'A change is waiting for the owner (' + pending.kind + ', by ' + pending.requested_by_name + ')',
                  esc(pending.reason)) : '') +
              (doc.no_receipt_reason ? SV.notice('grey', 'receipt', 'No receipt: ' + doc.no_receipt_reason, '') : '') +
              SV.section('Lines', SV.table(['#', 'Item', 'Quantity', 'Amount', 'Request'],
                (doc.lines || []).map(l => lineRow(l, doc))
                  .concat((doc.charges || []).map(c => ['', esc(c.kind === 'discount' ? 'Discount' : 'Delivery fee'), '',
                    esc((c.kind === 'discount' ? '−' : '') + PA.peso(c.amount)),
                    '<span class="req-muted">' + esc((c.shares || []).map(s => 'line ' + s.line + ': ' + PA.peso(s.amount)).join(' · ')) + '</span>'])),
                { num: [2, 3] })) +
              SV.section('Office review', review.length ? SV.lines(review) : SV.lines([{ t: 'Nothing to check on this purchase.' }])) +
              // Receipt photos as tiles (v5 design): a striped frame with the
              // photo's name; a click opens the photo itself (no thumbnail is
              // downloaded until it is asked for).
              (docs.length ? SV.section('Receipt photos', '<div class="pur-photo-tiles">' +
                  docs.map(([k, v]) => {
                      const name = k.replace(/_url$/, '').replace(/_/g, ' ');
                      const label = name.charAt(0).toUpperCase() + name.slice(1);
                      return '<button type="button" class="pur-photo-tile" data-doc-url="' + esc(v) + '" title="Click opens full size" aria-label="Open ' + esc(label) + '">' +
                          '<span class="pur-photo-cap">' + esc(label) + '</span></button>';
                  }).join('') + '</div>') : '') +
              // 0102: deposits, the rest, refunds and credit (js/purchasing-admin-pay.js).
              '<div data-payments></div>' +
              (history.length ? SV.history(history, 6) : SV.section('History', '<div class="sv-empty-inline">No history yet.</div>')) +
            '</div>';

        const reload = hooks.onChanged;
        if (PA.renderPayments) PA.renderPayments(host.querySelector('[data-payments]'), doc);
        host.querySelectorAll('[data-open-purchase]').forEach(a => a.addEventListener('click', (e) => {
            e.preventDefault();
            PA.openPurchase(a.dataset.openPurchase);
        }));
        // Purchase receipts are never given a signed link: window.open (the
        // shim in supabase-config.js §11b) downloads the photo with this
        // account's session — Storage checks the Buyer rule on every
        // download — and shows a copy that lives only in the new tab.
        host.querySelectorAll('[data-doc-url]').forEach(a => a.addEventListener('click', (e) => {
            e.preventDefault();
            root.open(a.dataset.docUrl, '_blank');
        }));
        const corr = panel.querySelector('[data-correct]');
        if (corr) corr.addEventListener('click', () => PA.openRecord({ purchase: doc }));
        // R7: a NEW purchase filled in from this voided one; nothing is saved until Save.
        const again = panel.querySelector('[data-again]');
        if (again) again.addEventListener('click', () => PA.openRecord({ again: doc }));
        let sentToOwner = false;
        const vd = panel.querySelector('[data-void]');
        if (vd) vd.addEventListener('click', () => RA.modal({
            title: 'Void this purchase?',
            sub: 'It leaves Spent and Bought — all ' + (doc.lines || []).length + ' line(s). The receipt and history are kept; it does not say goods were returned or money refunded.',
            body: '<p><strong>' + esc((doc.lines || []).map(l => l.destination === 'warehouse' ? 'Warehouse' : l.folder_name).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—') +
                    '</strong> · ' + esc(doc.supplier || 'No supplier') + ' · <strong>' + esc(PA.peso(doc.receipt_total)) + '</strong> · entered in ' + esc(PA.sourceLabel(doc.source)) + '</p>' +
                  '<label class="att-label">Reason (kept in the history)<input class="att-input" name="reason" maxlength="500" required></label>' +
                  '<label class="att-label">Type <strong>' + esc(word) + '</strong> to confirm<input class="att-input" name="confirm" autocomplete="off" required></label>',
            submitLabel: 'Void purchase', warn: true,
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const reason = form.reason.value.trim();
                if (!reason) throw new Error('REASON_REQUIRED');
                if (!PA.voidConfirmed(word, form.confirm.value)) throw new Error('CONFIRM_WORD');
                sentToOwner = false;
                try {
                    await RA.rpc('pur_void', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_reason: reason });
                } catch (e) {
                    if (me.isOwner || !PA.needsOwner(e)) throw e;
                    await RA.rpc('pur_request_change', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_kind: 'void', p_body: null, p_reason: reason });
                    sentToOwner = true;
                }
            },
            // The modal has closed (and cleared the shared host) by now.
            onDone: () => {
                reload();
                // Project Control's "Waiting for the owner" pill, now — not after a refresh.
                if (sentToOwner && root.expPurReloadFlags) root.expPurReloadFlags();
                if (sentToOwner) PA.notice('Only the owner can void this one (completed project). It was sent to the owner for approval.', 'Sent to the owner');
            },
        }));
        host.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => {
            const l = doc.lines.find(x => String(x.line) === b.dataset.check);
            const req = (doc.requests || []).find(r => r.line === l.line);
            RA.modal({
                title: l.substitute ? 'Check a substitute' : 'Check a different unit',
                sub: (l.substitute
                        ? 'Bought ' + PA.qty(l.quantity) + ' ' + l.unit + ' of ' + l.item_name + ' instead of ' + req.description + (req.spec ? ' ' + req.spec : '') +
                          ' (' + l.substitute_reason + '). If it does the job, how many ' + req.unit + ' of the request does it cover (0 if it does not)? '
                        : 'Bought ' + PA.qty(l.quantity) + ' ' + l.unit + '; the request is in ' + req.unit + '. How many ' + req.unit + ' does this cover? ') +
                     'Someone other than the buyer checks it; it is kept in the history.',
                body: '<label class="att-label">Covers (' + esc(req.unit) + ')<input class="att-input" name="covers" inputmode="decimal" required></label>' +
                      '<label class="att-label">How you know<input class="att-input" name="note" maxlength="300" required placeholder="e.g. 2 boxes of 12"></label>',
                submitLabel: 'Confirm',
                errorMessage: PA.errorMessage,
                onSubmit: async (form) => {
                    // 0 allowed (it covers none of the request); at most 3 decimals.
                    const v = form.covers.value.replace(/,/g, '').trim();
                    if (!/^\d+(\.\d{1,3})?$/.test(v)) throw new Error('BAD_QUANTITY');
                    const covers = Number(v);
                    await RA.rpc('pur_check_unit', { p_op: root.DacsReceipts.newId(), p_purchase: doc.id, p_line_no: l.line,
                                                     p_covers: covers, p_note: form.note.value.trim() });
                },
                onDone: reload,
            });
        }));
        RA.icons();
    }

    // Every field of the purchase as the staff member saw it, beside what
    // they asked for — changed rows marked. A void lists the whole purchase.
    function changeTable(r) {
        if (r.kind === 'void') {
            const rows = PA.changeRows(r.base, r.base, RA.cutoffLabel);
            return '<p class="sv-text"><strong>Void the whole purchase</strong> — it leaves Spent and Bought:</p>' +
                SV.table(['', 'Field', 'Now'], rows.map(x => ['<span class="req-muted">' + esc(x.group) + '</span>', esc(x.label), esc(x.before)]));
        }
        const rows = PA.changeRows(r.base, r.proposed, RA.cutoffLabel);
        const n = rows.filter(x => x.changed).length;
        return '<p class="sv-text"><strong>' + n + (n === 1 ? ' change' : ' changes') + '</strong> — every field is listed; changed ones are marked.</p>' +
            SV.table(['', 'Field', 'When asked', 'Asked for'], rows.map(x => ['<span class="req-muted">' + esc(x.group) + '</span>',
                esc(x.label) + (x.changed ? ' ' + PA.pill('changed', 'working') : ''), esc(x.before),
                x.changed ? '<strong>' + esc(x.after) + '</strong>' : esc(x.after)]),
                { rowAttrs: i => rows[i].changed ? 'class="pur-changed"' : '' });
    }

    // Owner approvals (office v5): cards under "Waiting for the owner" and
    // "Decided"; a card opens the change in the pop-up — what was asked,
    // every field beside what was asked for, and Approve / Reject… /
    // Withdraw / Open purchase in its footer.
    const appUi = { sel: null };
    async function renderApprovals(host, me, opts) {
        let list;
        try { list = await RA.rpc('pur_change_requests', { p_scope: 'all' }); } catch (e) { RA.fail(host, e); return; }
        if (PA.ui.tab !== 'approvals') return;   // another tab was chosen while this loaded
        list = list || [];
        const pending = list.filter(r => r.status === 'pending');
        // The badge follows what the screen just loaded (D5: gone at zero).
        if (root.NavCounts && me.isOwner) root.NavCounts.set('purchasing', pending.length);
        const decided = list.filter(r => r.status !== 'pending').slice(0, 30);
        const KIND = { void: 'Void', replace: 'Replace' };
        const statusPill = r => ({ text: PA.REQUEST_STATUS[r.status] || r.status,
            tone: r.status === 'pending' ? (r.changed_since ? 'red' : 'gold') : r.status === 'approved' ? 'done' : r.status === 'rejected' ? 'red' : 'none' });
        const titleOf = r => (KIND[r.kind] || 'Correct') + ' — asked by ' + r.requested_by_name;
        const aboutOf = r => {
            const b = r.base || {};
            return [b.supplier || 'No supplier', (b.purchase_date || b.date_time) ? RA.formatDay(String(b.purchase_date || b.date_time).slice(0, 10)) : '',
                b.receipt_total != null ? PA.peso(b.receipt_total) : ''].filter(Boolean).join(' · ');
        };
        const cardOf = r => ({
            id: r.id,
            title: titleOf(r),
            sub: aboutOf(r),
            meta: 'Asked ' + RA.formatManila(r.requested_at) + ' · Reason: ' + r.reason,
            pill: statusPill(r),
            chips: r.status === 'pending' && r.changed_since ? [{ text: 'Out of date', tone: 'red' }] : [],
            nextLabel: r.status === 'pending' && me.isOwner && !r.changed_since ? 'Approve' : '',
            dim: r.status !== 'pending',
        });
        const reload = () => renderApprovals(host, me, { refreshPanel: true });
        const approve = async (id) => {
            const res = await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: id, p_approve: true, p_note: null });
            if (res && res.status === 'stale') PA.notice('The purchase changed after this was asked, so nothing was applied. Ask for a new request.', 'Out of date');
        };
        function onApprove(r, b) {
            // R6: approving a void voids for good — the owner types the word too.
            if (r && r.kind === 'void') {
                const word = PA.voidWord(PA.placesOf(r.base));
                return RA.modal({
                    title: 'Approve this void?',
                    sub: 'The whole purchase leaves Spent and Bought. There is no undo.',
                    body: '<label class="att-label">Type <strong>' + esc(word) + '</strong> to confirm<input class="att-input" name="confirm" autocomplete="off" required></label>',
                    submitLabel: 'Approve void', warn: true, errorMessage: PA.errorMessage,
                    onSubmit: async (form) => {
                        if (!PA.voidConfirmed(word, form.confirm.value)) throw new Error('CONFIRM_WORD');
                        await approve(r.id);
                    },
                    onDone: reload,
                });
            }
            if (b) b.disabled = true;
            (async () => { try { await approve(r.id); } catch (e) { PA.notice(e); } reload(); })();
        }
        function panelOf(r) {
            const isOpen = r.status === 'pending';
            const canApprove = isOpen && me.isOwner && !r.changed_since;
            return SV.panelHtml({
                kicker: 'Owner approval',
                title: titleOf(r),
                pills: [statusPill(r)],
                sub: 'When asked: ' + RA.formatManila(r.requested_at) + ' · ' + aboutOf(r),
                step: canApprove ? SV.nextStep('A change only the owner can make is waiting. Approving applies exactly the "Asked for" column.',
                    '<button type="button" class="att-btn att-btn--primary" data-approve="' + esc(r.id) + '">Approve</button>') : '',
                sections: [
                    (r.changed_since ? SV.notice('red', 'alert-triangle', 'The purchase changed after this was asked',
                        '(a correction, an office check or a receipt). It cannot be approved — ask for a new request.') : ''),
                    SV.section('Reason', '<p class="sv-text">' + esc(r.reason) + '</p>'),
                    (isOpen ? SV.section('Asked for', changeTable(r)) : ''),
                    (r.decision_note ? SV.section('Note', '<p class="sv-text">' + esc(r.decision_note) + '</p>') : ''),
                    (!isOpen ? SV.section('Decided', SV.facts([['Status', esc(PA.REQUEST_STATUS[r.status] || r.status)],
                        ['By', esc(r.decided_by_name || '')], ['On', r.decided_at ? esc(RA.formatManila(r.decided_at)) : '']])) : ''),
                ],
                actions:
                    (isOpen && me.isOwner ? SV.lbtn('Approve', 'data-approve="' + esc(r.id) + '"' +
                        (r.changed_since ? ' disabled title="The purchase changed after this was asked"' : ''), 'primary') +
                      SV.lbtn('Reject…', 'data-reject="' + esc(r.id) + '"', 'warn') : '') +
                    (isOpen && !me.isOwner && r.requested_by === me.userId ? SV.lbtn('Withdraw', 'data-withdraw="' + esc(r.id) + '"') : '') +
                    SV.lbtn('Open purchase →', 'data-open="' + esc(r.purchase_id) + '"'),
                nextLabel: 'Next',
            });
        }
        root.SplitView.render(host, PA.frame(host, me, {
            lede: me.isOwner
                ? 'Changes your staff asked for that only you can make. Approving applies exactly the "Asked for" column, through the normal correction — and only while the purchase still reads as it did when they asked.'
                : 'Changes you sent to the owner.',
            // 2C (0105): stock cost moves waiting for the main owner — js/stock-cost-admin.js (empty for anyone else, or with stock off).
            aside: (me.isOwner && root.StockCostAdmin ? '<div data-stock-costs></div>' : ''),
            search: false,
            showing: list.length ? 'Showing ' + (pending.length + decided.length) + ' of ' + list.length : '',
            groups: [
                { title: 'Waiting for the owner', tone: pending.length ? 'gold' : 'muted', rows: pending.map(cardOf) },
                { title: 'Decided', tone: 'muted', rows: decided.map(cardOf) },
            ],
            empty: 'Nothing is waiting.',
            selectedId: appUi.sel,
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel, o) => {
                appUi.sel = id;
                const r = list.find(x => x.id === id);
                if (!r) { SV.error(panel, 'This change is no longer on the list. Reload the page.'); return; }
                SV.fill(panel, panelOf(r));
                panel.onclick = e => {
                    const b = e.target.closest('button');
                    if (!b || b.disabled) return;
                    if (b.dataset.open) { PA.openPurchase(b.dataset.open); return; }
                    if (b.dataset.approve) return onApprove(r, b);
                    if (b.dataset.reject) return RA.modal({
                        title: 'Reject this change?',
                        body: '<label class="att-label">Why (the requester sees this)<input class="att-input" name="note" maxlength="500" required></label>',
                        submitLabel: 'Reject', warn: true, errorMessage: PA.errorMessage,
                        onSubmit: async (form) => {
                            await RA.rpc('pur_decide_change', { p_op: root.DacsReceipts.newId(), p_request: b.dataset.reject, p_approve: false, p_note: form.note.value.trim() });
                        },
                        onDone: reload,
                    });
                    if (b.dataset.withdraw) {
                        b.disabled = true;
                        (async () => { try { await RA.rpc('pur_withdraw_change', { p_request: b.dataset.withdraw }); } catch (e) { PA.notice(e); } reload(); })();
                    }
                };
                if (o && o.start) { const go = panel.querySelector('.sv-step [data-approve]'); if (go) go.click(); }
            },
            onClose: () => { appUi.sel = null; },
        }));
        const costs = host.querySelector('[data-stock-costs]');
        if (costs) root.StockCostAdmin.renderApprovals(costs);
    }

    PA.renderPurchases = renderPurchases;

    // D5: the red count on Purchasing — changes waiting for the owner's
    // approval, for owner accounts (who can approve); nobody else counts it.
    if (root.NavCounts) {
        root.NavCounts.register('purchasing', async () => {
            const me = await PA.me();
            if (!me.isOwner) return null;
            const list = (await RA.rpc('pur_change_requests', { p_scope: 'pending' })) || [];
            return list.filter(r => r.status === 'pending').length;
        });
    }
    PA.renderApprovals = renderApprovals;
    PA.renderPurchasePanel = renderPurchasePanel;
    // The old one-purchase page lands on Purchasing (PA.openPurchase opens
    // the purchase there); focused accounts keep the id.
    RA.views.reqPurchase = () => root.switchView('reqPurchasing');
})(typeof window !== 'undefined' ? window : globalThis);