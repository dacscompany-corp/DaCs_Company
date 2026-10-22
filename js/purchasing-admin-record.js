// ════════════════════════════════════════════════════════════════════
// Requests → Purchasing → Record purchase (0097). One receipt, many lines,
// several projects. Opens from the shopping list with the ticked request
// lines, empty ("Purchase with no request"), or from a purchase to correct
// it, or from a voided purchase to record it again (R7, 2A-3a: a NEW
// purchase filled in from the old one). Saves through the SAME server
// operations as everything else:
//   new            → pur_record   (source 'purchasing'; a correction or
//                                  replacement keeps the purchase's own source)
//   same lines     → pur_correct  (reason required)
//   lines added or removed → pur_replace (reason required)
// The server decides Spent, the billing periods and what each line covers;
// the preview here only says what it will do. A change the server keeps
// for the owner is offered to staff as "Send to the owner" (pur_request_change).
//
// Picked weekly portions are the ONLY portions a line covers; without picks
// the server covers this buyer's own portions, then unassigned ones. A
// correction keeps the portions a line already covered. Unsaved receipt
// photos live in the form state, so a redraw never drops them and a
// replacement photo is uploaded even after an earlier one was.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    const PA = root.PurchasingAdmin;
    if (!RA || !PA) return;
    const esc = RA.esc;

    // A numbered part of the form with one line saying what it is for.
    function secHtml(num, title, help) {
        return '<div class="pur-sec"><span class="pur-sec-num" aria-hidden="true">' + num + '</span>' +
            '<span class="pur-sec-title">' + esc(title) + '</span></div>' +
            (help ? '<p class="pur-sec-help">' + esc(help) + '</p>' : '');
    }

    let ctx = null;   // { requestLines, batchId, purchase, again, onDone }
    let openCredits = [];   // 0102: the chosen supplier's credits with something left (R10)
    let st = null;    // the form

    const DOCS = [['po', 'po_image_url', 'Purchase order'], ['dr', 'delivery_receipt_url', 'Delivery receipt'],
                  ['si', 'supplier_invoice_url', 'Supplier invoice'], ['pr', 'payment_receipt_url', 'Payment receipt']];

    // "YYYY-MM-DD" from LOCAL date parts (PH is UTC+8 — never toISOString).
    function todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // What this buyer may still cover on a request line: their own and the
    // unassigned portions (the owner: every portion).
    function mayCover(p, me) {
        return me.isOwner || !p.buyer_id || p.buyer_id === me.userId;
    }
    function stillFor(l, me) {
        return (l.portions || []).reduce((s, p) => s + (mayCover(p, me) ? Number(p.still_to_buy) || 0 : 0), 0);
    }

    function newLine() {
        return { requestLineId: null, requestUnit: '', requestName: '', still: 0, portions: null, portionPicks: [],
                 destination: 'project', folderId: '', folderLabel: '',
                 itemName: '', category: 'Materials', quantity: 1, unit: '', amount: '', extraReason: '', extraLocation: '',
                 match: 'same', substituteReason: '', unplannedReason: '', inInventory: false };
    }

    function fromRequest(l, me, batchId) {
        const still = stillFor(l, me);
        const name = l.description + (l.spec ? ' ' + l.spec : '');
        const portions = (l.portions || []).filter(p => mayCover(p, me) && Number(p.still_to_buy) > 0);
        return Object.assign(newLine(), {
            requestLineId: l.line_id, requestUnit: l.unit, requestName: name, still,
            // The portions this buyer may pick (own, unassigned; the owner: all).
            portions,
            // A list filtered to one weekly batch shows only that batch's portions:
            // pick them, so the server covers exactly what the form describes.
            portionPicks: batchId ? PA.defaultPicks(l.portions, me) : [],
            folderId: l.work_id, folderLabel: l.project_name + ' · ' + l.work_name, itemName: name,
            category: l.category || 'Materials', quantity: still || 1, unit: l.unit,
        });
    }

    function fromPurchase(doc) {
        const reqs = {};
        (doc.requests || []).forEach(r => { reqs[r.line] = r; });
        return {
            opId: root.DacsReceipts.newId(), editId: doc.id, editLines: (doc.lines || []).length, reason: '',
            // Where it was entered stays (a replacement too); a phone
            // purchase's "No receipt" reason goes with it.
            source: doc.source || 'purchasing', noReceiptReason: doc.no_receipt_reason || '',
            purchaseDate: doc.purchase_date, supplierId: doc.supplier_id || '', supplier: doc.supplier_id ? '' : (doc.supplier || ''),
            paymentMethod: doc.payment_method || '', notes: doc.notes || '', boughtBy: doc.bought_by || '',
            dateTime: doc.date_time || '',
            stored: PA.storedDocs(doc.docs), docs: PA.storedDocs(doc.docs), files: {}, uploaded: {}, onFile: Object.keys(PA.storedDocs(doc.docs)),
            lines: (doc.lines || []).map(l => {
                const r = reqs[l.line];
                const name = r ? r.description + (r.spec ? ' ' + r.spec : '') : '';
                return Object.assign(newLine(), {
                    requestLineId: l.request_line_id || null, requestUnit: r ? r.unit : '', requestName: name,
                    // This purchase's own cover is released when it is corrected.
                    still: r ? Math.max(0, Number(r.needed) - Number(r.bought) + Number(l.covered || 0)) : 0,
                    destination: l.destination, folderId: l.folder_id || '', folderLabel: l.folder_name || '',
                    itemName: l.item_name, category: l.category || '', quantity: Number(l.quantity), unit: l.unit || '',
                    amount: String(l.amount), extraReason: l.extra_reason || '', extraLocation: l.extra_location || '',
                    match: l.substitute ? 'substitute' : 'wording', substituteReason: l.substitute_reason || '',
                    unplannedReason: l.unplanned_reason || '', inInventory: !!l.in_inventory, origQuantity: Number(l.quantity),
                    // Kept as they are: a correction never re-picks (the server keeps the portions covered).
                    portionPicks: (l.portion_picks || []).map(p => ({ portionId: p.portion_id, quantity: p.quantity })),
                });
            }),
            // A split the office adjusted stays adjusted: a correction never
            // quietly resets it to the automatic one.
            charges: PA.chargesOf(doc),
        };
    }

    // R7: a NEW purchase filled in from a voided one (PurchasingAdmin.
    // recordAgainState): request links are re-checked by the server, picks
    // are not copied, nothing is saved until Save.
    function fromAgain(doc, me) {
        const s = PA.recordAgainState(doc, me);
        return Object.assign(s, {
            opId: root.DacsReceipts.newId(), editId: null, editLines: 0, reason: '', againOf: doc.id,
            files: {}, uploaded: {},
            lines: s.lines.map(l => Object.assign(newLine(), l)),
        });
    }

    // The line with its typed quantity, for the pure previews.
    function parsed(l) {
        return Object.assign({}, l, { quantity: PA.parseQty(l.quantity) || 0 });
    }

    function previewText(l) {
        if (!l.requestLineId) return l.destination === 'warehouse' ? 'Warehouse — company stock, outside every project\'s Spent' : 'Unplanned — no request';
        if (l.match === 'substitute') return 'Substitute — counts toward Bought after an office check';
        if (!PA.sameUnit(l.unit, l.requestUnit)) return 'Different unit from the request (' + l.requestUnit + ') — counts toward Bought after an office check';
        const p = parsed(l);
        const still = PA.lineStill(p);
        const pv = PA.coverPreview(still, p.quantity, true);
        const picked = (l.portionPicks || []).some(k => Number(k.quantity) > 0);
        return 'Covers ' + PA.qty(pv.covers) + ' of ' + PA.qty(still) + (picked ? ' in the portions picked' : ' still to buy') +
            (pv.extra > 0 ? ' · Extra ' + PA.qty(pv.extra) : '');
    }

    function extraNeeded(l) {
        if (!l.requestLineId) return false;
        const p = parsed(l);
        return PA.coverPreview(PA.lineStill(p), p.quantity, PA.countsDirectly(p)).extra > 0;
    }

    // Optional: which weekly portions this line is for. Picked = the only
    // ones it covers; none picked = the server's automatic order.
    function picksHtml(l, i) {
        if (!l.requestLineId) return '';
        if (l.copied) return '<div class="req-muted">Covers your own portions first, then unassigned ones, earliest first — checked again when you save.</div>';
        if (!l.portions) {
            const kept = (l.portionPicks || []).filter(k => Number(k.quantity) > 0);
            return kept.length ? '<div class="req-muted">Picked portions are kept: ' + esc(kept.map(k => PA.qty(k.quantity)).join(' + ')) + '</div>'
                               : '<div class="req-muted">Keeps the weekly portions it covered; quantity you add follows the usual order.</div>';
        }
        if (!l.portions.length) return '';
        const pick = (id) => (l.portionPicks || []).find(k => k.portionId === id);
        const any = (l.portionPicks || []).some(k => Number(k.quantity) > 0);
        return '<details class="pur-picks"' + (any ? ' open' : '') + '><summary>Weekly portions (optional — leave empty for your own, then unassigned, earliest first)</summary>' +
            '<div class="pur-rec-row">' + l.portions.map(p =>
                '<label class="att-label">' + esc('Cutoff ' + RA.cutoffLabel(p.cutoff_at) + ' · ' + (p.buyer_id ? (p.mine ? 'yours' : p.buyer_name) : 'unassigned') +
                    ' · ' + PA.qty(p.still_to_buy) + ' to buy') +
                '<input class="att-input" data-pickq="' + i + ':' + esc(p.id) + '" inputmode="decimal" placeholder="0" value="' +
                    esc(pick(p.id) ? pick(p.id).quantity : '') + '"></label>').join('') +
            '</div><div class="req-muted">Only the portions you fill in are covered; anything more is extra.</div></details>';
    }

    // Matches the request, other words for the same item, or a substitute.
    function matchHtml(l, i) {
        if (!l.requestLineId) return '';
        return '<div class="pur-rec-row">' +
            '<label class="att-label">Compared with the request<select class="att-input" data-f="match" data-i="' + i + '">' +
              [['same', 'Same as requested'], ['wording', 'Same item, other words'], ['substitute', 'Substitute — an important specification differs']]
                .map(o => '<option value="' + o[0] + '"' + (l.match === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') +
            '</select></label>' +
            '<label class="att-label pur-w2" data-subreason="' + i + '"' + (l.match === 'substitute' ? '' : ' hidden') + '>What changed, and who agreed' +
              '<input class="att-input" data-f="substituteReason" data-i="' + i + '" maxlength="300" placeholder="e.g. Boysen out of stock; Davies agreed by the foreman" value="' + esc(l.substituteReason) + '"></label>' +
            '<span class="req-muted">Requested: ' + esc(l.requestName + ' (' + l.requestUnit + ')') + '</span>' +
            '</div>';
    }

    function lineHtml(l, i, folders) {
        const linked = !!l.requestLineId;
        const where = linked
            ? '<div class="req-muted">' + esc(l.folderLabel) + '</div>'
            : '<label class="att-label pur-w2">Charged to<select class="att-input" data-f="where" data-i="' + i + '" aria-label="Project or warehouse">' +
                '<option value="">Choose…</option>' +
                '<option value="warehouse"' + (l.destination === 'warehouse' ? ' selected' : '') + '>Warehouse (company stock)</option>' +
                folders.map(f => '<option value="' + esc(f.id) + '"' + (l.destination !== 'warehouse' && f.id === l.folderId ? ' selected' : '') + '>' + esc(f.label) + '</option>').join('') +
              '</select><span class="pur-hint">Pick the project it was for, or Warehouse if it goes to company stock.</span></label>';
        return '<div class="att-card pur-rec-line"><div class="att-card-body">' +
            '<div class="pur-rec-head"><span class="pur-rec-no">' + (i + 1) + '</span>' +
              '<span class="pur-rec-kind' + (linked ? '' : ' is-open') + '">' + (linked ? 'From a request' : 'No request') + '</span>' +
              '<button type="button" class="att-btn att-btn--sm pur-rec-remove" data-remove="' + i + '" aria-label="Remove this item"><i data-lucide="trash-2"></i> Remove</button></div>' +
            '<div class="pur-rec-row">' +
              '<label class="att-label pur-w2">Item<input class="att-input" data-f="itemName" data-i="' + i + '" maxlength="200" value="' + esc(l.itemName) + '"></label>' +
              '<label class="att-label">Quantity<input class="att-input" data-f="quantity" data-i="' + i + '" inputmode="decimal" value="' + esc(l.quantity) + '"></label>' +
              '<label class="att-label">Unit<input class="att-input" data-f="unit" data-i="' + i + '" maxlength="30" value="' + esc(l.unit) + '"></label>' +
              '<label class="att-label">Amount (₱)<input class="att-input" data-f="amount" data-i="' + i + '" inputmode="decimal" value="' + esc(l.amount) + '"></label>' +
              '<label class="att-label">Category<input class="att-input" data-f="category" data-i="' + i + '" maxlength="100" value="' + esc(l.category) + '"></label>' +
            '</div>' +
            '<div class="pur-rec-row">' + where +
              '<span class="pur-preview" data-preview="' + i + '">' + esc(previewText(l)) + '</span></div>' +
            matchHtml(l, i) +
            picksHtml(l, i) +
            '<div class="pur-rec-row" data-extra="' + i + '"' + (extraNeeded(l) ? '' : ' hidden') + '>' +
              '<label class="att-label pur-w2">Why more than needed?<input class="att-input" data-f="extraReason" data-i="' + i + '" maxlength="300" placeholder="Pack size, spare for breakage, cheaper in bulk…" value="' + esc(l.extraReason) + '"></label>' +
              '<label class="att-label">Extra goes to<select class="att-input" data-f="extraLocation" data-i="' + i + '">' +
                '<option value="">Choose…</option>' +
                '<option value="project"' + (l.extraLocation === 'project' ? ' selected' : '') + '>Same project</option>' +
                '<option value="warehouse"' + (l.extraLocation === 'warehouse' ? ' selected' : '') + '>Warehouse (cost stays on the project)</option>' +
              '</select></label>' +
            '</div>' +
            (linked ? '' :
              '<div class="pur-rec-row"><label class="att-label pur-w2">Why was it bought without a request?' +
                (PA.unplannedReasonNeeded(st.source) ? '' : ' (optional)') + '<input class="att-input" data-f="unplannedReason" data-i="' + i + '" maxlength="300" placeholder="What it was for and why it was not requested" value="' + esc(l.unplannedReason) + '"></label></div>') +
            '</div></div>';
    }

    function chargeHtml(c, i) {
        const shares = c.adjust ? (c.shares || PA.prorate(PA.parseMoney(c.amount) || 0, st.lines.map(l => PA.parseMoney(l.amount) || 0))) : null;
        return '<div class="pur-rec-row">' +
            '<select class="att-input" data-cf="kind" data-c="' + i + '"><option value="delivery_fee"' + (c.kind === 'delivery_fee' ? ' selected' : '') + '>Delivery fee</option>' +
              '<option value="discount"' + (c.kind === 'discount' ? ' selected' : '') + '>Discount</option></select>' +
            '<input class="att-input" data-cf="amount" data-c="' + i + '" inputmode="decimal" aria-label="Amount" value="' + esc(c.amount) + '">' +
            '<label class="req-toggle"><input type="checkbox" data-cf="adjust" data-c="' + i + '"' + (c.adjust ? ' checked' : '') + '> Adjust the split</label>' +
            '<span class="pur-preview" data-cpreview="' + i + '"></span>' +
            '<button type="button" class="att-btn att-btn--sm" data-cremove="' + i + '" aria-label="Remove">&times;</button>' +
            (shares ? '<div class="pur-shares">' + st.lines.map((l, k) =>
                '<label class="att-label">' + esc('Line ' + (k + 1)) + '<input class="att-input" data-share="' + i + ':' + k + '" inputmode="decimal" value="' + esc(shares[k]) + '"></label>').join('') + '</div>' : '') +
            '</div>';
    }

    // One receipt photo slot. The chosen file is kept in st.files, so a
    // redraw shows it again (a file input cannot be refilled) and Save
    // uploads it — a newer choice replaces an earlier upload.
    function docHtml(d) {
        const [key, field, label] = d;
        const chosen = st.files[key];
        const status = chosen
            ? 'Chosen: ' + esc(chosen.name || 'photo') + (st.uploaded[key] && st.uploaded[key].file === chosen ? ' (uploaded)' : ' (uploads when you save)') +
              ' <button type="button" class="att-btn att-btn--sm" data-doc-clear="' + key + '">Remove</button>'
            : (st.onFile || []).includes(field) ? 'On file — choose a photo to replace it' : '';
        return '<label class="att-label">' + label + '<input class="att-input" type="file" accept="image/*" data-doc="' + key + '">' +
            (status ? '<span class="req-muted" data-doc-status="' + key + '">' + status + '</span>' : '') + '</label>';
    }

    function refresh(host) {
        st.lines.forEach((l, i) => {
            const pv = host.querySelector('[data-preview="' + i + '"]');
            if (pv) pv.textContent = previewText(l);
            const ex = host.querySelector('[data-extra="' + i + '"]');
            if (ex) ex.hidden = !extraNeeded(l);
            const sr = host.querySelector('[data-subreason="' + i + '"]');
            if (sr) sr.hidden = l.match !== 'substitute';
        });
        st.charges.forEach((c, i) => {
            const el = host.querySelector('[data-cpreview="' + i + '"]');
            if (!el || c.adjust) { if (el) el.textContent = ''; return; }
            const split = PA.prorate(PA.parseMoney(c.amount) || 0, st.lines.map(l => PA.parseMoney(l.amount) || 0));
            el.textContent = 'Split by line amount: ' + split.map(PA.peso).join(' · ');
        });
        const total = PA.receiptTotal(st.lines.map(l => ({ amount: PA.parseMoney(l.amount) || 0 })),
                                      st.charges.map(c => ({ kind: c.kind, amount: PA.parseMoney(c.amount) || 0 })));
        const t = host.querySelector('[data-total]');
        if (t) t.textContent = PA.peso(total);
    }

    // The form, as the server will read it.
    function formState() {
        return {
            purchaseDate: st.purchaseDate, dateTime: st.dateTime, supplierId: st.supplierId || null, supplier: st.supplier, paymentMethod: st.paymentMethod,
            notes: st.notes, docs: st.docs, boughtBy: st.boughtBy || null,
            lines: st.lines.map(l => Object.assign({}, l, { quantity: PA.parseQty(l.quantity), amount: PA.parseMoney(l.amount),
                portionPicks: (l.portionPicks || []).map(k => ({ portionId: k.portionId, quantity: PA.parseQty(k.quantity) || 0 })) })),
            charges: st.charges.map(c => ({ kind: c.kind, amount: PA.parseMoney(c.amount),
                shares: c.adjust ? (c.shares || []).map(x => PA.parseMoney(x)) : null })),
        };
    }

    async function uploadDocs() {
        for (const key of PA.docUploads(st.files, st.uploaded)) {
            const file = st.files[key];
            const field = DOCS.find(d => d[0] === key)[1];
            const blob = await root.DacsReceipts.compressToBlob(file);
            st.docs[field] = await root.DacsReceipts.uploadReceipt('purchase', blob, root.currentDataUserId);
            st.uploaded[key] = { file, url: st.docs[field] };
        }
    }

    // Whose petty cash or own money a "paid now" payment is (0102): a staff
    // buyer only — the caller, or the buyer the owner picked in "Bought by".
    function cashHolder(me) {
        if (!me.isOwner) return me.userId;
        return st.boughtBy && st.boughtBy !== me.userId ? st.boughtBy : null;
    }

    async function save(host, me) {
        const box = host.querySelector('[data-problems]');
        const fs = formState();
        const problems = PA.formProblems(fs);
        if (st.editId && !String(st.reason || '').trim()) problems.unshift({ code: 'REASON_REQUIRED' });
        // "Paid now?" (0102, Q3): new purchases only — a correction never carries payments.
        if (!st.editId) {
            const credit = openCredits.find(c => c.id === st.paidCredit);
            PA.paidNowProblems(st, PA.receiptTotal(PA.buildBody(fs).lines, PA.buildBody(fs).charges), cashHolder(me), credit ? credit.left : null)
              .forEach(code => problems.push({ code }));
        }
        if (problems.length) {
            box.innerHTML = '<ul>' + problems.map(p => '<li>' + esc((p.line ? 'Line ' + p.line + ': ' : p.charge ? 'Fee/discount ' + p.charge + ': ' : '') +
                PA.ERRORS[p.code]) + '</li>').join('') + '</ul>';
            box.hidden = false;
            return;
        }
        box.hidden = true;
        const btn = host.querySelector('[data-save]');
        btn.disabled = true;
        let body;
        try {
            await uploadDocs();
            body = PA.buildBody(formState());
            let res;
            if (!st.editId) {
                // The purchase and its "paid now" payment are accepted together, or neither is.
                const pays = PA.paidNowPayments(st, body.receipt_total, cashHolder(me));
                res = await RA.rpc('pur_record', { p_op: st.opId, p_body: pays.length ? Object.assign({}, body, { payments: pays }) : body });
            } else if (body.lines.length === st.editLines) {
                res = await RA.rpc('pur_correct', { p_op: st.opId, p_purchase: st.editId, p_body: body, p_reason: st.reason.trim() });
            } else {
                res = await RA.rpc('pur_replace', { p_op: st.opId, p_purchase: st.editId, p_body: body, p_reason: st.reason.trim() });
            }
            const done = ctx && ctx.onDone;
            const goTo = st.editId ? (res && res.purchase_id) || st.editId : null;
            ctx = null; st = null;
            if (done) done();
            if (res && res.replayed) {
                PA.notice('This purchase was already saved by an earlier press — check it; changes made since were NOT applied.', 'Already saved');
            }
            PA.ui.tab = goTo ? 'purchases' : 'list';
            if (goTo) PA.openPurchase(goTo); else root.switchView('reqPurchasing');
        } catch (e) {
            btn.disabled = false;
            if (st) refreshDocs(host);
            if (st && st.editId && !me.isOwner && PA.needsOwner(e)) return offerOwner(host, body);
            box.innerHTML = esc(PA.errorMessage(e));
            box.hidden = false;
        }
    }

    // After an upload, say so beside each photo without redrawing the form.
    function refreshDocs(host) {
        DOCS.forEach(d => {
            const el = host.querySelector('[data-doc-status="' + d[0] + '"]');
            if (el && st.files[d[0]] && st.uploaded[d[0]] && st.uploaded[d[0]].file === st.files[d[0]]) {
                el.firstChild.textContent = 'Chosen: ' + (st.files[d[0]].name || 'photo') + ' (uploaded) ';
            }
        });
    }

    // Staff: the server keeps this change for the owner. Send it as a request.
    function offerOwner(host, body) {
        const kind = body.lines.length === st.editLines ? 'correct' : 'replace';
        const editId = st.editId, reason = st.reason.trim();
        RA.modal({
            title: 'Send to the owner?',
            sub: 'Only the owner can make this change (another project, or a completed project). The owner sees every field of this version and approves or rejects it.',
            body: '<p class="req-muted">Reason: ' + esc(reason) + '</p>',
            submitLabel: 'Send for approval',
            errorMessage: PA.errorMessage,
            onSubmit: async () => {
                await RA.rpc('pur_request_change', { p_op: root.DacsReceipts.newId(), p_purchase: editId, p_kind: kind, p_body: body, p_reason: reason });
            },
            onDone: () => {
                ctx = null; st = null;
                // Project Control's "Waiting for the owner" pill, now — not after a refresh.
                if (root.expPurReloadFlags) root.expPurReloadFlags();
                PA.ui.tab = 'purchases'; PA.openPurchase(editId);
            },
        });
    }

    // Section 5 (0102, Q3): was it paid at the counter? Saved with the
    // purchase in one go. Later payments: Record payment on the purchase.
    // A credit with the chosen supplier may pay at the counter too (R10).
    function paidNowHtml(me) {
        const holder = cashHolder(me);
        const from = { company: PA.PAY_SOURCE.company };
        if (holder) { from.petty_cash = PA.PAY_SOURCE.petty_cash; from.own_money = PA.PAY_SOURCE.own_money; }
        if (openCredits.length) from.credit = PA.PAY_SOURCE.credit;
        if (!from[st.paidFrom]) st.paidFrom = holder ? 'petty_cash' : 'company';
        if (st.paidFrom === 'credit' && !openCredits.some(c => c.id === st.paidCredit)) st.paidCredit = openCredits[0].id;
        if (!PA.PAY_METHOD[st.paidMethod]) st.paidMethod = PA.methodOf(st.paymentMethod);
        const sel = (map, v) => Object.keys(map).map(k => '<option value="' + esc(k) + '"' + (k === v ? ' selected' : '') + '>' + esc(map[k]) + '</option>').join('');
        const now = st.paidNow || 'none';
        return secHtml('5', 'Paid now?', 'Optional. A payment never changes Spent — it only says how the receipt was paid.') +
            '<div class="att-card"><div class="att-card-body"><div class="pur-rec-row">' +
              '<label class="att-label">Paid at the counter<select class="att-input" data-paid="paidNow">' +
                sel({ none: 'Not paid yet / record later', full: 'Paid in full', part: 'Paid part (deposit)' }, now) + '</select></label>' +
              (now === 'part' ? '<label class="att-label">Amount paid (₱)<input class="att-input" data-paid="paidAmount" inputmode="decimal" value="' + esc(st.paidAmount || '') + '"></label>' : '') +
              (now !== 'none' ? '<label class="att-label">Paid from<select class="att-input" data-paid="paidFrom">' + sel(from, st.paidFrom) + '</select></label>' +
                (st.paidFrom === 'credit'
                  ? '<label class="att-label">Credit to use<select class="att-input" data-paid="paidCredit">' +
                      openCredits.map(c => '<option value="' + esc(c.id) + '"' + (c.id === st.paidCredit ? ' selected' : '') + '>' +
                        esc(PA.peso(c.left) + ' left') + '</option>').join('') + '</select></label>'
                  : '<label class="att-label">How<select class="att-input" data-paid="paidMethod">' + sel(PA.PAY_METHOD, st.paidMethod) + '</select></label>') : '') +
            '</div>' +
            (now !== 'none' && !holder && me.isOwner ? '<p class="req-muted">Petty cash and own money belong to a staff buyer: pick them in "Bought by" to use theirs.</p>' : '') +
            '</div></div>';
    }

    async function renderRecord(host, me) {
        if (!ctx) { PA.ui.tab = 'list'; return PA.renderPurchasing(host.closest('.content-view') || host.parentNode); }
        let suppliers, buyers, folders;
        try {
            const [s, b, f, cr] = await Promise.all([
                RA.rpc('pur_suppliers'),
                me.isOwner ? RA.rpc('pur_buyer_options') : Promise.resolve([]),
                root.sbClient.from('folders').select('id, name, parent_folder_id, completed_at').order('name'),
                // R10: the chosen supplier's open credits, for "Paid now" (new purchases only).
                st && !st.editId && st.supplierId ? RA.rpc('pur_credits', { p_supplier: st.supplierId }) : Promise.resolve([]),
            ]);
            if (f.error) throw f.error;
            suppliers = s || []; buyers = b || [];
            openCredits = (cr || []).filter(c => !c.voided_at && Number(c.left) > 0);
            const all = f.data || [];
            folders = [];
            all.filter(x => !x.parent_folder_id && (me.isOwner || !x.completed_at)).forEach(p => {
                folders.push({ id: p.id, label: p.name + ' · Main Contract' });
                all.filter(c => c.parent_folder_id === p.id).forEach(c => folders.push({ id: c.id, label: p.name + ' · ' + c.name }));
            });
        } catch (e) { RA.fail(host, e); return; }
        if (!st) {
            st = ctx.purchase ? fromPurchase(ctx.purchase) : ctx.again ? fromAgain(ctx.again, me) : {
                opId: root.DacsReceipts.newId(), editId: null, editLines: 0, reason: '',
                purchaseDate: todayKey(), supplierId: '', supplier: '', paymentMethod: 'Cash', notes: '', boughtBy: me.userId,
                docs: {}, files: {}, uploaded: {}, onFile: [],
                lines: ctx.requestLines.length ? ctx.requestLines.map(l => fromRequest(l, me, ctx.batchId)) : [newLine()],
                charges: [],
            };
        }

        host.innerHTML =
            (!st.editId && !st.againOf && !(ctx.requestLines || []).length
                ? '<div class="att-info"><i data-lucide="info"></i><div><strong>Bought something nobody asked for?</strong> ' +
                  'Add each item below, choose the project it was for (or Warehouse), and say why it was bought.</div></div>'
                : '') +
            (st.againOf ? '<div class="att-info"><i data-lucide="copy"></i><div><strong>Record again</strong> — a new purchase copied from a voided one. ' +
                  'Check every line: it is saved as a new purchase. The voided one stays voided, as history.</div></div>' : '') +
            secHtml('1', st.editId ? 'Correct this purchase' : st.againOf ? 'Record again — purchase details' : 'Purchase details',
                    'Who sold it, when it was bought and how it was paid.') +
            '<div class="att-card"><div class="att-card-body">' +
              '<div class="pur-rec-row">' +
                '<label class="att-label">Date bought<input class="att-input" type="date" data-h="purchaseDate" value="' + esc(st.purchaseDate) + '"></label>' +
                '<label class="att-label pur-w2">Supplier<select class="att-input" data-h="supplierId">' +
                  '<option value="">' + (st.supplier ? esc(st.supplier) + ' (typed)' : 'Choose…') + '</option>' +
                  suppliers.filter(s => s.active || s.id === st.supplierId).map(s => '<option value="' + esc(s.id) + '"' + (s.id === st.supplierId ? ' selected' : '') + '>' +
                    esc(s.name + (s.branch ? ' · ' + s.branch : '')) + '</option>').join('') +
                '</select></label>' +
                '<button type="button" class="att-btn att-btn--sm" data-new-supplier>+ New supplier</button>' +
                '<label class="att-label">Paid by<select class="att-input" data-h="paymentMethod">' +
                  ['Cash', 'GCash', 'Bank transfer', 'Check', 'On account', ''].map(m => '<option value="' + esc(m) + '"' + (m === st.paymentMethod ? ' selected' : '') + '>' + esc(m || 'Not yet paid / not known') + '</option>').join('') +
                '</select></label>' +
                (me.isOwner && buyers.length ? '<label class="att-label">Bought by<select class="att-input" data-h="boughtBy">' +
                  buyers.map(b => '<option value="' + esc(b.user_id) + '"' + (b.user_id === st.boughtBy ? ' selected' : '') + '>' + esc(b.is_me ? 'You (' + b.name + ')' : b.name) + '</option>').join('') +
                '</select></label>' : '') +
              '</div>' +
              '<label class="att-label">Notes<input class="att-input" data-h="notes" maxlength="2000" value="' + esc(st.notes) + '"></label>' +
            '</div></div>' +
            secHtml('2', 'What was bought', 'One card for each item on the receipt.') +
            '<div data-lines>' + st.lines.map((l, i) => lineHtml(l, i, folders)).join('') + '</div>' +
            '<button type="button" class="att-btn" data-add-line>+ Add a line with no request</button>' +
            secHtml('3', 'Delivery fees and discounts', 'Optional. Skip this if the receipt has neither.') +
            '<div class="att-card"><div class="att-card-body">' +
              '<p class="req-muted">Shared across the lines by line amount unless you adjust it. Never charged to one project automatically.</p>' +
              st.charges.map((c, i) => chargeHtml(c, i)).join('') +
              '<button type="button" class="att-btn att-btn--sm" data-add-charge="delivery_fee">+ Delivery fee</button> ' +
              '<button type="button" class="att-btn att-btn--sm" data-add-charge="discount">+ Discount</button>' +
            '</div></div>' +
            secHtml('4', 'Receipt photos', 'Optional.') +
            '<div class="att-card"><div class="att-card-body">' +
              '<p class="req-muted">Kept once for the whole receipt, office buyers only — never shown to clients, partners or workers.</p>' +
              '<div class="pur-rec-row">' + DOCS.map(docHtml).join('') + '</div></div></div>' +
            (st.editId ? '' : paidNowHtml(me)) +
            (st.editId ? '<label class="att-label">Reason for the change (kept in the history)<input class="att-input" data-h="reason" maxlength="500" value="' + esc(st.reason) + '"></label>' : '') +
            '<div class="att-info att-info--warn" data-problems hidden></div>' +
            '<div class="pur-rec-foot"><span>Receipt total <strong data-total></strong></span>' +
              '<button type="button" class="att-btn" data-cancel>Cancel</button>' +
              '<button type="button" class="att-btn att-btn--primary" data-save>' + (st.editId ? 'Save correction' : 'Save purchase') + '</button></div>';

        const rerender = () => renderRecord(host, me);
        host.querySelectorAll('[data-h]').forEach(el => el.addEventListener('input', () => {
            st[el.dataset.h] = el.value;
            if (el.dataset.h === 'supplierId' && el.value) st.supplier = '';
            // Whose petty cash "Paid now" can use follows "Bought by"; which credit, the supplier.
            if ((el.dataset.h === 'boughtBy' || el.dataset.h === 'supplierId') && st.paidNow && st.paidNow !== 'none') return rerender();
            refresh(host);
        }));
        host.querySelectorAll('[data-paid]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
            st[el.dataset.paid] = el.value;
            if (el.dataset.paid === 'paidNow' || el.dataset.paid === 'paidFrom') rerender();
        }));
        host.querySelectorAll('[data-f]').forEach(el => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
            const l = st.lines[Number(el.dataset.i)];
            if (el.dataset.f === 'where') {
                l.destination = el.value === 'warehouse' ? 'warehouse' : 'project';
                l.folderId = el.value === 'warehouse' ? '' : el.value;
            } else {
                l[el.dataset.f] = el.value;
            }
            refresh(host);
        }));
        host.querySelectorAll('[data-pickq]').forEach(el => el.addEventListener('input', () => {
            const [i, id] = el.dataset.pickq.split(':');
            const l = st.lines[Number(i)];
            l.portionPicks = (l.portionPicks || []).filter(k => k.portionId !== id);
            if (String(el.value).trim()) l.portionPicks.push({ portionId: id, quantity: el.value });
            // Keep the picks in the portions' own order (the server covers them in this order).
            l.portionPicks.sort((a, b) => l.portions.findIndex(p => p.id === a.portionId) - l.portions.findIndex(p => p.id === b.portionId));
            refresh(host);
        }));
        host.querySelectorAll('[data-doc]').forEach(el => el.addEventListener('change', () => {
            const file = el.files && el.files[0];
            if (file) st.files[el.dataset.doc] = file; else delete st.files[el.dataset.doc];
            rerender();
        }));
        host.querySelectorAll('[data-doc-clear]').forEach(b => b.addEventListener('click', (e) => {
            e.preventDefault();
            const key = b.dataset.docClear;
            const field = DOCS.find(d => d[0] === key)[1];
            delete st.files[key];
            // An upload made for this choice is not sent (the stored receipt stays as it was).
            if (st.uploaded[key]) {
                delete st.uploaded[key]; delete st.docs[field];
                if (st.stored && st.stored[field]) st.docs[field] = st.stored[field];
            }
            rerender();
        }));
        host.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
            st.lines.splice(Number(b.dataset.remove), 1);
            st.charges.forEach(c => { c.shares = null; });
            rerender();
        }));
        host.querySelector('[data-add-line]').addEventListener('click', () => { st.lines.push(newLine()); st.charges.forEach(c => { c.shares = null; }); rerender(); });
        host.querySelectorAll('[data-add-charge]').forEach(b => b.addEventListener('click', () => {
            st.charges.push({ kind: b.dataset.addCharge, amount: '', adjust: false, shares: null }); rerender();
        }));
        host.querySelectorAll('[data-cf]').forEach(el => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
            const c = st.charges[Number(el.dataset.c)];
            if (el.dataset.cf === 'adjust') { c.adjust = el.checked; c.shares = null; return rerender(); }
            c[el.dataset.cf] = el.value;
            refresh(host);
        }));
        host.querySelectorAll('[data-share]').forEach(el => el.addEventListener('input', () => {
            const [ci, li] = el.dataset.share.split(':').map(Number);
            const c = st.charges[ci];
            if (!c.shares) c.shares = PA.prorate(PA.parseMoney(c.amount) || 0, st.lines.map(l => PA.parseMoney(l.amount) || 0)).map(String);
            c.shares[li] = el.value;
        }));
        host.querySelectorAll('[data-cremove]').forEach(b => b.addEventListener('click', () => { st.charges.splice(Number(b.dataset.cremove), 1); rerender(); }));
        host.querySelector('[data-new-supplier]').addEventListener('click', () => RA.modal({
            title: 'New supplier',
            body: '<label class="att-label">Name<input class="att-input" name="name" maxlength="120" required></label>' +
                  '<label class="att-label">Branch (optional)<input class="att-input" name="branch" maxlength="120"></label>' +
                  '<label class="att-label">Contact (optional)<input class="att-input" name="contact" maxlength="200"></label>',
            submitLabel: 'Add supplier',
            errorMessage: PA.errorMessage,
            onSubmit: async (form) => {
                const s = await RA.rpc('pur_save_supplier', { p_id: null, p_name: form.name.value, p_branch: form.branch.value,
                                                             p_contact: form.contact.value, p_active: true });
                st.supplierId = s.id;
                st.supplier = '';
            },
            onDone: rerender,
        }));
        host.querySelector('[data-cancel]').addEventListener('click', () => {
            const back = st.editId || st.againOf;
            ctx = null; st = null;
            PA.ui.tab = back ? 'purchases' : 'list';
            if (back) PA.openPurchase(back); else root.switchView('reqPurchasing');
        });
        host.querySelector('[data-save]').addEventListener('click', () => save(host, me));
        refresh(host);
        RA.icons();
    }

    PA.openRecord = function (c) {
        ctx = c; st = null;
        PA.ui.tab = 'record';
        root.switchView('reqPurchasing');
    };
    PA.renderRecord = renderRecord;
})(typeof window !== 'undefined' ? window : globalThis);