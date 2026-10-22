// ════════════════════════════════════════════════════════════════════
// Purchasing (WorkMate Stage 2A-2, migration 0097) — shared core for the
// office Purchasing tab inside Requests:
//   js/purchasing-admin-list.js      — the shopping list: who is buying what
//   js/purchasing-admin-record.js    — record a purchase (one receipt, many lines)
//   js/purchasing-admin-purchases.js — purchases, one purchase, owner approvals
//
// 2A-3a (0101): where a purchase came from (Source), a search over the
// list, the word typed before a void (R6), "No receipt", Record again (R7).
//
// Unlike the rest of Requests this tab shows PESO amounts — only to those
// the server lets buy (owner, admin accounts allowed Expenses, staff with
// the Buyer switch: CLAUDE.md "Purchasing — staff exception"). Every rule
// is the server's (0096/0097); this file only previews and explains.
//
// Works in a browser (window.PurchasingAdmin) and in Node for
// tests/purchasing-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    // ── Numbers ─────────────────────────────────────────────────────

    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

    function peso(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return '₱' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function qty(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }

    // Same rules as the server's pur_money / pur_qty: plain decimals,
    // pesos to the centavo, quantities to 3 decimals. Commas are allowed
    // while typing. Null = refused.
    function parseMoney(text) {
        const s = String(text === null || text === undefined ? '' : text).replace(/,/g, '').trim();
        return /^\d+(\.\d{1,2})?$/.test(s) ? Number(s) : null;
    }
    function parseQty(text) {
        const s = String(text === null || text === undefined ? '' : text).replace(/,/g, '').trim();
        if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
        const x = Number(s);
        return x > 0 && x <= 1000000 ? x : null;
    }

    // ── The shopping list ───────────────────────────────────────────

    function sameUnit(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    // Which buttons a portion offers. The server decides again; this only
    // avoids offering what it would refuse. me = { userId, isOwner }.
    function portionActions(p, me) {
        const still = Number(p.still_to_buy) > 0;
        const mine = !!p.buyer_id && p.buyer_id === me.userId;
        return {
            claim: still && !p.buyer_id,
            release: still && !!p.buyer_id && (mine || me.isOwner),
            assign: still && (!p.buyer_id || me.isOwner),
        };
    }

    function buyerLabel(p, me) {
        if (!p.buyer_id) return 'Unassigned';
        return p.buyer_id === me.userId ? 'You' : (p.buyer_name || 'Buyer');
    }

    // Text filter, "mine only", "urgent only". Order stays the server's.
    function filterList(lines, opts) {
        const o = opts || {};
        const t = String(o.text || '').trim().toLowerCase();
        return (lines || []).filter(l => {
            if (o.urgentOnly && !l.urgent) return false;
            if (o.mineOnly && !(l.portions || []).some(p => p.buyer_id && p.buyer_id === o.userId)) return false;
            if (o.unassignedOnly && !(l.portions || []).some(p => !p.buyer_id && Number(p.still_to_buy) > 0)) return false;
            if (!t) return true;
            return [l.description, l.spec, l.catalog_name, l.project_name, l.work_name, l.requester_name, l.category]
                .join(' ').toLowerCase().includes(t);
        });
    }

    // The one-line picture of a list.
    function listSummary(lines, userId) {
        const s = { lines: 0, urgent: 0, unassigned: 0, mine: 0, changed: 0, unitChecks: 0 };
        (lines || []).forEach(l => {
            s.lines++;
            if (l.urgent) s.urgent++;
            if (Number(l.unit_checks) > 0) s.unitChecks++;
            const ps = l.portions || [];
            if (ps.some(p => !p.buyer_id && Number(p.still_to_buy) > 0)) s.unassigned++;
            if (ps.some(p => p.buyer_id === userId && Number(p.still_to_buy) > 0)) s.mine++;
            if (ps.some(p => p.changed)) s.changed++;
        });
        return s;
    }

    // ── Recording a purchase ────────────────────────────────────────

    // What a line will cover — a preview of pur_cover_lines for a line
    // linked to a request with `still` left to buy (for this buyer).
    // countsDirectly = same unit as the request and not a substitute;
    // otherwise it waits for an office check.
    function coverPreview(still, quantity, countsDirectly) {
        const q = Number(quantity) || 0;
        const s = Math.max(0, Number(still) || 0);
        if (!countsDirectly) return { covers: 0, extra: 0, unitCheck: true };
        return { covers: round3(Math.min(q, s)), extra: round3(Math.max(0, q - s)), unitCheck: false };
    }

    // Picked portions are the ONLY ones a line covers (0097, review 16 Oct):
    // what they can still take — each pick up to its portion's Still to buy.
    function pickedStill(portions, picks) {
        const byId = {};
        (portions || []).forEach(p => { byId[p.id] = p; });
        return round3((picks || []).reduce((s, k) => {
            const p = byId[k.portionId];
            return s + (p ? Math.min(Math.max(0, Number(k.quantity) || 0), Math.max(0, Number(p.still_to_buy) || 0)) : 0);
        }, 0));
    }

    // The Still to buy a line's preview uses: its picks when it has any
    // (and the portions are known), otherwise everything this buyer may cover.
    function lineStill(l) {
        const picks = (l.portionPicks || []).filter(k => Number(k.quantity) > 0);
        return picks.length && l.portions ? pickedStill(l.portions, picks) : (Number(l.still) || 0);
    }

    // The portions a batch-filtered list shows for a line, as the picks a
    // purchase from that list covers: the ones this buyer may cover (own or
    // unassigned; the owner: all), each at its Still to buy, in list order.
    // Picks are authoritative on the server, so it covers exactly these.
    function defaultPicks(portions, me) {
        return (portions || [])
            .filter(p => (me.isOwner || !p.buyer_id || p.buyer_id === me.userId) && Number(p.still_to_buy) > 0)
            .map(p => ({ portionId: p.id, quantity: Number(p.still_to_buy) }));
    }

    // A request line's own words, to tell a renamed item from the request.
    const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

    // Same unit and not marked a substitute: the line counts toward Bought at once.
    function countsDirectly(l) {
        return sameUnit(l.unit, l.requestUnit) && l.match !== 'substitute';
    }

    // Receipt photos to upload on save: every selected file not yet uploaded
    // AS THAT FILE — a replacement chosen after an earlier upload goes up too
    // (it used to be skipped because a URL was already there).
    // The receipt photos a stored purchase already has (non-empty text, the
    // four known slots only). A correction that changes the number of lines
    // is a replacement purchase, which takes its photos from the body alone.
    function storedDocs(docs) {
        const out = {};
        ['po_image_url', 'delivery_receipt_url', 'supplier_invoice_url', 'payment_receipt_url'].forEach(k => {
            const v = docs && docs[k];
            if (typeof v === 'string' && v) out[k] = v;
        });
        return out;
    }

    function docUploads(files, uploaded) {
        return Object.keys(files || {}).filter(k => files[k] && !(uploaded && uploaded[k] && uploaded[k].file === files[k]));
    }

    // The server's default charge split (pur_prorate): each share rounded
    // DOWN to the centavo, then the left-over centavos one each to the
    // biggest remainders, the earliest line on a tie. Always adds up.
    function prorate(total, weights) {
        const n = (weights || []).length;
        if (!n) return [];
        const ws = weights.map(w => Math.max(Number(w) || 0, 0));
        let sum = ws.reduce((a, b) => a + b, 0);
        if (sum <= 0) return prorate(total, ws.map(() => 1));
        const cents = Math.round(total * 100);
        const exact = ws.map(w => cents * w / sum);
        const out = exact.map(x => Math.floor(x + 1e-9));
        let left = cents - out.reduce((a, b) => a + b, 0);
        const order = exact.map((x, i) => ({ i, r: x - Math.floor(x + 1e-9) })).sort((a, b) => (b.r - a.r) || (a.i - b.i));
        for (let k = 0; k < order.length && left > 0; k++, left--) out[order[k].i] += 1;
        return out.map(c => c / 100);
    }

    function receiptTotal(lines, charges) {
        const items = (lines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0);
        const fees = (charges || []).filter(c => c.kind === 'delivery_fee').reduce((s, c) => s + (Number(c.amount) || 0), 0);
        const disc = (charges || []).filter(c => c.kind === 'discount').reduce((s, c) => s + (Number(c.amount) || 0), 0);
        return round2(items + fees - disc);
    }

    // A line with no request needs a reason only on a purchase entered in the
    // Purchasing tab or on the phone — the server's own rule (pur_store reads
    // the purchase's source). Project Control purchases have no such field.
    function unplannedReasonNeeded(source) {
        return ['purchasing', 'workmate'].indexOf(source || 'purchasing') !== -1;
    }

    // The pur_record / pur_correct / pur_replace body from the form state.
    // A correction or replacement keeps the purchase's own source (st.source):
    // where it was entered never changes, and the server's rules follow it.
    function buildBody(st) {
        const lines = (st.lines || []).map(l => {
            const out = {
                destination: l.destination || 'project',
                folder_id: l.destination === 'warehouse' ? null : l.folderId,
                item_name: String(l.itemName || '').trim(),
                category: l.category || '',
                quantity: round3(l.quantity),
                unit: String(l.unit || '').trim(),
                amount: round2(l.amount),
                in_inventory: !!l.inInventory,
                min_stock: 0,
            };
            if (l.requestLineId) {
                out.request_line_id = l.requestLineId;
                out.portion_picks = (l.portionPicks || []).filter(p => Number(p.quantity) > 0)
                    .map(p => ({ portion_id: p.portionId, quantity: round3(p.quantity) }));
                out.extra_reason = String(l.extraReason || '').trim();
                out.extra_location = l.extraLocation || null;
                out.substitute = l.match === 'substitute';
                out.substitute_reason = out.substitute ? String(l.substituteReason || '').trim() : '';
            } else {
                out.request_line_id = null;
                out.unplanned_reason = String(l.unplannedReason || '').trim();
            }
            return out;
        });
        const charges = (st.charges || []).map(c => {
            const ch = { kind: c.kind, amount: round2(c.amount) };
            if (c.shares && c.shares.length) ch.shares = c.shares.map((a, i) => ({ line: i + 1, amount: round2(a) }));
            return ch;
        });
        const body = {
            source: st.source || 'purchasing',
            purchase_date: st.purchaseDate,
            // A correction keeps the stored time of day while the date is unchanged.
            date_time: st.dateTime && String(st.dateTime).slice(0, 10) === st.purchaseDate ? st.dateTime : st.purchaseDate,
            supplier: String(st.supplier || '').trim(),
            supplier_id: st.supplierId || null,
            payment_method: String(st.paymentMethod || '').trim(),
            notes: String(st.notes || '').trim(),
            docs: st.docs || {},
            receipt_total: receiptTotal(lines, charges),
            lines,
            charges,
        };
        if (st.boughtBy) body.bought_by = st.boughtBy;
        // A phone purchase's "No receipt" reason rides along: replacing it makes
        // a new purchase, and the server refuses a phone purchase with neither.
        if (String(st.noReceiptReason || '').trim()) body.no_receipt_reason = String(st.noReceiptReason).trim();
        return body;
    }

    // What the server would refuse, said before sending. [{ code, line }].
    // still[i] = Still to buy for line i (linked lines only).
    function formProblems(st) {
        const out = [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.purchaseDate || ''))) out.push({ code: 'BAD_DATE' });
        const lines = st.lines || [];
        if (!lines.length || lines.length > 50) out.push({ code: 'BAD_LINES' });
        lines.forEach((l, i) => {
            const line = i + 1;
            if (!String(l.itemName || '').trim()) out.push({ code: 'BAD_NAME', line });
            if (!(Number(l.quantity) > 0)) out.push({ code: 'BAD_QUANTITY', line });
            if (!(Number(l.amount) >= 0) || l.amount === null || l.amount === '') out.push({ code: 'BAD_AMOUNT', line });
            if (l.destination !== 'warehouse' && !l.folderId) out.push({ code: 'BAD_PROJECT', line });
            if (l.requestLineId) {
                const pv = coverPreview(lineStill(l), l.quantity, countsDirectly(l));
                // A correction whose quantity did not rise gets the server's own reason.
                const keepsQty = l.origQuantity != null && Number(l.quantity) <= Number(l.origQuantity);
                if (pv.extra > 0 && !keepsQty && (!String(l.extraReason || '').trim() || !l.extraLocation)) out.push({ code: 'EXTRA_REASON_REQUIRED', line });
                // An item named differently from its request is either the same
                // thing in other words or a substitute — the buyer says which.
                if ((l.match || 'same') === 'same' && l.requestName && norm(l.itemName) !== norm(l.requestName)) out.push({ code: 'NAME_DIFFERS', line });
                if (l.match === 'substitute' && !String(l.substituteReason || '').trim()) out.push({ code: 'SUBSTITUTE_REASON_REQUIRED', line });
            } else if (unplannedReasonNeeded(st.source) && !String(l.unplannedReason || '').trim()) {
                out.push({ code: 'UNPLANNED_REASON_REQUIRED', line });
            }
        });
        (st.charges || []).forEach((c, i) => {
            if (!(Number(c.amount) > 0)) out.push({ code: 'BAD_AMOUNT', charge: i + 1 });
            if (c.shares && c.shares.length && round2(c.shares.reduce((a, b) => a + (Number(b) || 0), 0)) !== round2(c.amount)) {
                out.push({ code: 'SPLIT_MISMATCH', charge: i + 1 });
            }
        });
        return out;
    }

    // ── Purchases ───────────────────────────────────────────────────

    const HISTORY_LABEL = {
        recorded: 'Recorded', corrected: 'Corrected', refunded: 'Billing periods re-checked',
        voided: 'Voided', replaced: 'Replaced by a new version', unit_checked: 'Office check (different unit or substitute)',
    };
    const REQUEST_STATUS = {
        pending: 'Waiting for the owner', approved: 'Approved', rejected: 'Rejected',
        withdrawn: 'Withdrawn', stale: 'Out of date — the purchase changed',
    };

    function purchaseFlags(p) {
        const f = [];
        if (p.status === 'void') f.push({ text: 'Void', tone: 'hidden' });
        if (p.no_receipt_reason) f.push({ text: 'No receipt', tone: 'abandoned' });
        if (p.pending_change) f.push({ text: 'Owner approval pending', tone: 'working' });
        if (p.unit_check) f.push({ text: 'Unit check', tone: 'abandoned' });
        if (p.needs_review) f.push({ text: 'Office review', tone: 'working' });
        if (p.extra) f.push({ text: 'Extra', tone: 'pc' });
        if (p.unplanned) f.push({ text: 'Unplanned', tone: 'pc' });
        return f;
    }

    // Where a purchase was entered (purchases.source).
    const SOURCE_LABEL = { expenses_form: 'Project Control', purchasing: 'Purchasing', workmate: 'Phone' };
    function sourceLabel(source) {
        return SOURCE_LABEL[source] || String(source || '');
    }

    // The Purchases list's search: every typed word must appear in the
    // supplier, a project, who bought or recorded it, the source or the total.
    function searchPurchases(rows, text) {
        const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return (rows || []).slice();
        return (rows || []).filter(p => {
            const hay = [p.supplier, (p.projects || []).join(' '), p.warehouse ? 'warehouse' : '', p.bought_by_name,
                         p.recorded_by_name, sourceLabel(p.source), String(p.receipt_total == null ? '' : p.receipt_total)]
                .join(' ').toLowerCase();
            return words.every(w => hay.includes(w));
        });
    }

    // R6: before a void the person types a word. One project → its first
    // word (brackets and quotes trimmed off); several projects, the
    // warehouse, or nothing known → VOID. places = one label per line.
    function voidWord(places) {
        const names = Array.from(new Set((places || []).map(x => String(x || '').trim())));
        if (names.length !== 1 || !names[0] || names[0] === 'Warehouse') return 'VOID';
        const first = names[0].split(/\s+/)[0].replace(/^[("'[]+|[)"'\],;:]+$/g, '');
        return first || 'VOID';
    }
    function voidConfirmed(word, typed) {
        return !!word && String(typed == null ? '' : typed).trim().toLowerCase() === String(word).toLowerCase();
    }
    // A label per line: the purchase view's lines (destination, folder_name)
    // or an approval's review doc (where).
    function placesOf(doc) {
        return ((doc && doc.lines) || []).map(l => l.where != null ? l.where
            : (l.destination === 'warehouse' ? 'Warehouse' : (l.folder_name || '')));
    }

    // R7: only a purchase voided on its own — one a correction replaced has
    // its newer version already.
    function canRecordAgain(doc) {
        return !!doc && doc.status === 'void' && !doc.replaced_by;
    }

    // A fee or discount as the record form holds it: a split the office
    // adjusted stays adjusted; an automatic one stays automatic.
    function chargesOf(doc) {
        const lines = (doc && doc.lines) || [];
        return ((doc && doc.charges) || []).map(c => {
            const given = lines.map(l => {
                const sh = (c.shares || []).find(x => x.line === l.line);
                return sh ? Number(sh.amount) : 0;
            });
            const auto = prorate(Number(c.amount), lines.map(l => Number(l.amount)));
            const custom = given.some((g, i) => round2(g) !== round2(auto[i]));
            return { kind: c.kind, amount: String(c.amount), adjust: custom, shares: custom ? given.map(String) : null };
        });
    }

    // R7: the record form's state for a NEW purchase copied from a voided
    // one (the screen adds its blank-line defaults and an operation id).
    // Request links are kept and re-checked by the server when it is saved;
    // weekly picks are NOT copied (the server covers in its usual order, so
    // a portion bought since is simply not covered). Still to buy is what the
    // request needs now. Only the owner records for someone else.
    function recordAgainState(doc, me) {
        const reqs = {};
        (doc.requests || []).forEach(r => { reqs[r.line] = r; });
        const docs = storedDocs(doc.docs);
        return {
            purchaseDate: doc.purchase_date, dateTime: doc.date_time || '',
            supplierId: doc.supplier_id || '', supplier: doc.supplier_id ? '' : (doc.supplier || ''),
            paymentMethod: doc.payment_method || '', notes: doc.notes || '',
            boughtBy: me && me.isOwner ? (doc.bought_by || me.userId) : (me && me.userId) || null,
            docs, stored: Object.assign({}, docs), onFile: Object.keys(docs),
            lines: (doc.lines || []).map(l => {
                const r = reqs[l.line];
                return {
                    requestLineId: l.request_line_id || null, requestUnit: r ? r.unit : '',
                    requestName: r ? r.description + (r.spec ? ' ' + r.spec : '') : '',
                    still: r ? Math.max(0, round3(Number(r.needed) - Number(r.bought))) : 0,
                    portions: null, portionPicks: [], copied: true,
                    destination: l.destination, folderId: l.folder_id || '', folderLabel: l.folder_name || '',
                    itemName: l.item_name, category: l.category || '', quantity: Number(l.quantity), unit: l.unit || '',
                    amount: String(l.amount), extraReason: l.extra_reason || '', extraLocation: l.extra_location || '',
                    match: l.substitute ? 'substitute' : 'wording', substituteReason: l.substitute_reason || '',
                    unplannedReason: l.unplanned_reason || '', inInventory: !!l.in_inventory,
                };
            }),
            charges: chargesOf(doc),
        };
    }

    // Changes the server keeps for the owner (staff then get "send to the owner").
    function needsOwner(error) {
        return /OWNER_APPROVAL_NEEDED|COMPLETED_PROJECT/.test(String((error && (error.message || error)) || ''));
    }

    // ── Owner approvals: the whole change, field by field ──────────
    //
    // base / proposed are pur_review_doc documents (0097): the purchase as
    // the staff member saw it, and as it would be after approval. One row
    // per header field, per line field and per fee or discount (amount and
    // split) — every field, changed or not, so nothing the owner approves is
    // hidden. fmtCutoff turns a weekly cutoff into words (the browser passes
    // RequestsAdmin.cutoffLabel).
    function changeRows(base, proposed, fmtCutoff) {
        const day = fmtCutoff || (x => String(x || '').slice(0, 10));
        const b = base || {}, p = proposed || {};
        const rows = [];
        const add = (group, label, x, y) => rows.push({ group, label, before: x, after: y, changed: x !== y });
        const receipts = d => Object.keys(d.receipts || {}).sort().map(k => k.replace(/_url$/, '').replace(/_/g, ' ') + ' #' + d.receipts[k]).join(', ') || 'none';
        add('Receipt', 'Date and time bought', String(b.date_time || b.purchase_date || ''), String(p.date_time || p.purchase_date || ''));
        add('Receipt', 'Supplier', b.supplier || '—', p.supplier || '—');
        // A body that leaves "bought by" out keeps the purchase's buyer.
        add('Receipt', 'Bought by', b.bought_by || '—', p.bought_by || b.bought_by || '—');
        add('Receipt', 'Paid by', b.payment_method || '—', p.payment_method || '—');
        add('Receipt', 'Notes', b.notes || '—', p.notes || '—');
        add('Receipt', 'Receipt total', peso(b.receipt_total), peso(p.receipt_total));
        add('Receipt', 'Receipt photos', receipts(b), receipts(p));
        const line = (l) => {
            if (!l) return null;
            const picks = (l.picks || []).map(k => qty(k.quantity) + ' from ' + (k.cutoff_at ? 'the ' + day(k.cutoff_at) + ' batch' + (k.buyer ? ' (held by ' + k.buyer + ')' : ' (unassigned)') : 'a portion no longer there')).join(', ');
            return {
                Item: l.item_name || '—',
                Quantity: qty(l.quantity) + ' ' + (l.unit || ''),
                Amount: peso(l.amount),
                'Project / warehouse': l.where || '—',
                Request: l.request ? l.request + (picks ? ' — picked: ' + picks : '') : (l.unplanned_reason ? 'Unplanned: ' + l.unplanned_reason : 'none'),
                Extra: l.extra_reason ? l.extra_reason + ' (' + (l.extra_location === 'warehouse' ? 'warehouse' : 'same project') + ')' : '—',
                Substitute: l.substitute ? 'Yes — ' + (l.substitute_reason || '') : 'No',
                Category: l.category || '—',
            };
        };
        const n = Math.max((b.lines || []).length, (p.lines || []).length);
        for (let i = 0; i < n; i++) {
            const x = line((b.lines || [])[i]), y = line((p.lines || [])[i]);
            Object.keys(x || y).forEach(k => add('Line ' + (i + 1), k, x ? x[k] : '(no line)', y ? y[k] : '(removed)'));
        }
        const charge = (c) => c ? (c.kind === 'discount' ? 'Discount ' : 'Delivery fee ') + peso(c.amount) + ' — split ' +
            (c.shares || []).map((s, k) => 'line ' + (k + 1) + ': ' + peso(s)).join(', ') : '(none)';
        const m = Math.max((b.charges || []).length, (p.charges || []).length);
        for (let i = 0; i < m; i++) add('Fees and discounts', 'Fee / discount ' + (i + 1), charge((b.charges || [])[i]), charge((p.charges || [])[i]));
        return rows;
    }

    // ── Payments (0102, 2A-4a) ──────────────────────────────────────
    // Payments never change Spent: they say how a purchase was paid. These
    // helpers only word the server's answers and check a form before it is
    // sent — the server decides every balance.

    // A purchase's payment state (pur_pay_state) as a pill: text, tone, detail.
    const PAY_STATE = {
        not_tracked: { text: 'Payment not tracked', tone: 'hidden' },
        unpaid: { text: 'Unpaid', tone: 'abandoned' },
        partial: { text: 'Partially paid', tone: 'working' },
        paid: { text: 'Paid', tone: 'done' },
        overpaid: { text: 'Overpaid', tone: 'abandoned' },
        void: { text: 'Void', tone: 'hidden' },
        void_paid: { text: 'Voided — paid, to recover', tone: 'abandoned' },
    };
    function payLabel(pay) {
        if (!pay || !PAY_STATE[pay.state]) return null;
        const base = PAY_STATE[pay.state];
        let detail = '';
        if (pay.state === 'partial') detail = peso(pay.balance) + ' left';
        else if (pay.state === 'overpaid' || pay.state === 'void_paid') detail = peso(pay.unresolved) + ' to recover';
        else if (pay.state === 'unpaid') detail = peso(pay.due) + ' due';
        return { text: base.text, tone: base.tone, detail };
    }

    const PAY_SOURCE = { petty_cash: 'Petty cash', own_money: 'Own money', company: 'Company (paid directly)', credit: 'Supplier credit' };
    const PAY_METHOD = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer', check: 'Check', other: 'Other' };
    // The purchase form's "Paid by" word → a payment method.
    function methodOf(paymentMethod) {
        const m = String(paymentMethod || '').toLowerCase().replace(/\s+/g, '_');
        return PAY_METHOD[m] ? m : 'cash';
    }

    // "YYYY-MM-DD" today from LOCAL date parts (PH is UTC+8 — never toISOString).
    function localDay(d) {
        const x = d || new Date();
        return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }

    // What the server would refuse in a payment form, said before sending.
    // p: {amount, paidOn, method, source, creditId}; ctx: {today, creditLeft}
    function paymentProblems(p, ctx) {
        const out = [];
        const a = parseMoney(p.amount);
        if (!(a > 0)) out.push('BAD_AMOUNT');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.paidOn || '')) || String(p.paidOn) > String((ctx && ctx.today) || localDay()) ||
            String(p.paidOn) < '2020-01-01') out.push('BAD_DATE');
        if (!PAY_SOURCE[p.source]) out.push('BAD_PAY_SOURCE');
        if (p.source !== 'credit' && !PAY_METHOD[p.method]) out.push('BAD_METHOD');
        if (p.source === 'credit') {
            if (!p.creditId) out.push('CREDIT_REQUIRED');
            else if (a > 0 && ctx && ctx.creditLeft != null && a > Number(ctx.creditLeft)) out.push('OVER_CREDIT');
        }
        return out;
    }

    // The pur_pay / pur_record body of one payment.
    function paymentBody(p) {
        const out = { amount: String(round2(parseMoney(p.amount))), paid_on: p.paidOn, source: p.source,
                      method: p.source === 'credit' ? 'other' : p.method, note: String(p.note || '').trim() };
        if (p.personId) out.person_id = p.personId;
        if (p.source === 'credit') out.credit_id = p.creditId;
        if (p.proofUrl) out.proof_url = p.proofUrl;
        return out;
    }

    // Q16: a warning, never a refusal — real cash cannot go below zero, so
    // paying more than recorded means a handover was not recorded, or own money.
    function cashWarning(amount, held) {
        const a = parseMoney(amount);
        if (held == null || !(a > 0) || a <= Number(held)) return '';
        return 'You hold ' + peso(Math.max(0, Number(held))) + ' of petty cash on record. This payment is ' + peso(a) +
            '. It is saved, and the owner sees the difference as a shortfall to check.';
    }

    // "Paid now?" on the purchase form (Q3): none / full / part. Returns the
    // payments to send with the purchase (one transaction on the server).
    // st: {paidNow, paidAmount, paidFrom, paidMethod, paidCredit, purchaseDate};
    // holder = the staff buyer whose petty cash or own money it is (null: none).
    // A supplier credit used at the counter (R10) is checked by the server in
    // the same transaction as the purchase.
    function paidNowPayments(st, total, holder) {
        if (!st || !st.paidNow || st.paidNow === 'none') return [];
        const amount = st.paidNow === 'full' ? total : parseMoney(st.paidAmount);
        return [paymentBody({ amount, paidOn: st.purchaseDate, method: st.paidMethod || 'cash', source: st.paidFrom || 'company',
                              personId: (st.paidFrom === 'petty_cash' || st.paidFrom === 'own_money') ? holder : null,
                              creditId: st.paidFrom === 'credit' ? st.paidCredit : null })];
    }
    // creditLeft: what the chosen credit has left (null: unknown).
    function paidNowProblems(st, total, holder, creditLeft) {
        if (!st || !st.paidNow || st.paidNow === 'none') return [];
        const out = [];
        const amount = st.paidNow === 'full' ? total : parseMoney(st.paidAmount);
        if (!(amount > 0)) out.push('PAID_AMOUNT');
        else if (st.paidNow === 'part' && amount >= total) out.push('PART_NOT_LESS');
        if ((st.paidFrom === 'petty_cash' || st.paidFrom === 'own_money') && !holder) out.push('PERSON_REQUIRED');
        if (!PAY_SOURCE[st.paidFrom || 'company']) out.push('BAD_PAY_SOURCE');
        if (st.paidFrom === 'credit') {
            if (!st.paidCredit) out.push('CREDIT_REQUIRED');
            else if (amount > 0 && creditLeft != null && amount > Number(creditLeft)) out.push('OVER_CREDIT');
        }
        return out;
    }

    // Q10: a refund goes back to the money that paid. Who may receive each kind.
    // credit: the supplier paid back in cash what a credit had paid (instead of the
    // default, back to its credit) — to the company, or into a buyer's hands.
    const REFUND_ROUTES = { petty_cash: ['petty_cash', 'company'], own_money: ['buyer', 'company'], company: ['company', 'petty_cash'],
                            credit: ['company', 'petty_cash'] };
    function routeLabel(fundedBy, receivedBy, name) {
        const who = name || 'the buyer';
        if (receivedBy === 'company') return 'To the owner / company — no balance changes';
        if (fundedBy === 'petty_cash') return 'Back into ' + who + '\'s petty cash (cash held goes up)';
        if (fundedBy === 'own_money') return 'To ' + who + ', for their own money ("Company owes" goes down)';
        return 'To ' + who + ' — company cash they now hold';
    }

    // The Overpaid screen's starting split (server suggestion: the latest
    // payments are the ones paid too much). Credit-funded excess goes back
    // to that supplier's credit (Q10 clarified); every other part is a
    // refund to the money that paid it.
    function defaultResolution(row, today) {
        const refunds = [];
        let credit = 0;
        (row.suggested || []).forEach(s => {
            const amount = round2(s.amount);
            if (!(amount > 0)) return;
            if (s.source === 'credit') { credit = round2(credit + amount); return; }
            refunds.push({ amount, fundedBy: s.source, personId: s.person_id || null, personName: s.person_name || '',
                           receivedBy: s.source === 'own_money' ? 'buyer' : s.source === 'petty_cash' ? 'petty_cash' : 'company',
                           receivedOn: today || localDay() });
        });
        return { refunds, credit };
    }

    // What the server would refuse in a resolution (OVER_SOURCE, OVER_RESOLVED…).
    // paidBy: the purchase's [{source, person_id, paid, refunded}]; unresolved: the ₱ still over.
    function resolutionProblems(refunds, credit, paidBy, unresolved, today) {
        const out = [];
        let total = 0;
        const used = {};
        (refunds || []).forEach((r, i) => {
            const a = parseMoney(r.amount);
            if (!(a > 0)) { out.push({ code: 'BAD_AMOUNT', part: i + 1 }); return; }
            if (!(REFUND_ROUTES[r.fundedBy] || []).includes(r.receivedBy)) out.push({ code: 'BAD_REFUND_ROUTE', part: i + 1 });
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.receivedOn || '')) || String(r.receivedOn) > String(today || localDay())) out.push({ code: 'BAD_DATE', part: i + 1 });
            // Company and credit money is nobody's own: capped by every payment of that kind.
            const anyone = r.fundedBy === 'company' || r.fundedBy === 'credit';
            const key = r.fundedBy + ':' + (anyone ? '' : (r.personId || ''));
            used[key] = round2((used[key] || 0) + a);
            const src = (paidBy || []).filter(p => p.source === r.fundedBy && (anyone || p.person_id === r.personId));
            const left = src.reduce((s, p) => s + Number(p.paid) - Number(p.refunded || 0), 0);
            if (used[key] > round2(left)) out.push({ code: 'OVER_SOURCE', part: i + 1 });
            total = round2(total + a);
        });
        const c = parseMoney(credit);
        if (String(credit == null ? '' : credit).trim() !== '' && !(c >= 0)) out.push({ code: 'BAD_AMOUNT', part: 'credit' });
        if (c > 0) total = round2(total + c);
        if (!(total > 0)) out.push({ code: 'NOTHING_TO_RESOLVE' });
        else if (total > round2(unresolved)) out.push({ code: 'OVER_RESOLVED' });
        return out;
    }

    // A buyer's cash as the tracker shows it: never below ₱0 held (Q16).
    function cashFigures(s) {
        const recorded = Number((s && s.recorded) || 0);
        return { held: Math.max(0, recorded), shortfall: Math.max(0, -recorded), pending: Number((s && s.pending_returns) || 0),
                 owes: Number((s && s.owes) || 0), toReview: Number((s && s.owes_to_review) || 0) };
    }

    // The daily report (pur_cash_report) as rows for the table, print and CSV.
    // Balances below zero read ₱0 with the shortfall beside them. An entry
    // voided later stays on its own day, marked; its reversal is a row on the
    // day it was voided (R7), so a past day's closing never changes.
    function reportRows(rep) {
        const rows = [];
        const bal = (v) => Math.max(0, Number(v));
        const short = (v) => Math.max(0, -Number(v));
        const voided = (x) => (x.voided_on ? ' (voided on ' + x.voided_on + ')' : '');
        (rep && rep.days || []).forEach(d => {
            rows.push({ day: d.day, what: 'Opening', detail: '', amountIn: '', amountOut: '', held: bal(d.opening), shortfall: short(d.opening) });
            (d.received || []).forEach(x => rows.push({ day: d.day, what: 'Petty cash received', detail: (PAY_METHOD[x.method] || x.method || '') +
                (x.note ? ' — ' + x.note : '') + (x.disputed ? ' (buyer says not received)' : '') + voided(x), amountIn: Number(x.amount), amountOut: '' }));
            (d.refunds_in || []).forEach(x => rows.push({ day: d.day, what: 'Refund received', detail: (x.supplier || '') + voided(x),
                amountIn: Number(x.amount), amountOut: '' }));
            (d.payments || []).forEach(x => rows.push({ day: d.day, what: 'Paid to supplier', detail: (x.supplier || 'No supplier') + ' — ' +
                (x.items || []).join(', ') + ' · ' + ((x.projects || []).concat(x.warehouse ? ['Warehouse'] : [])).join(', ') +
                (x.purchase_status === 'void' ? ' (purchase voided)' : '') + voided(x), amountIn: '', amountOut: Number(x.amount) }));
            (d.returns || []).forEach(x => rows.push({ day: d.day, what: 'Returned to the owner', detail: 'handed over ' + x.handed_on +
                (x.handed_to ? ' to ' + x.handed_to : '') + voided(x), amountIn: '', amountOut: Number(x.amount) }));
            (d.reversals || []).forEach(x => rows.push({ day: d.day, what: 'Void: ' + x.what + ' of ' + x.entry_day, detail: x.reason || '',
                amountIn: Number(x.effect) > 0 ? Number(x.effect) : '', amountOut: Number(x.effect) < 0 ? -Number(x.effect) : '' }));
            rows.push({ day: d.day, what: 'Closing', detail: '', amountIn: '', amountOut: '', held: bal(d.closing), shortfall: short(d.closing) });
        });
        return rows;
    }
    function csvCell(v) {
        const s = v == null ? '' : String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function reportCsv(rep) {
        const head = ['Day', 'Entry', 'Detail', 'In (PHP)', 'Out (PHP)', 'Cash held (PHP)', 'Unreconciled shortfall (PHP)'];
        const lines = [head.map(csvCell).join(',')];
        reportRows(rep).forEach(r => lines.push([r.day, r.what, r.detail, r.amountIn === '' ? '' : round2(r.amountIn).toFixed(2),
            r.amountOut === '' ? '' : round2(r.amountOut).toFixed(2), r.held == null ? '' : round2(r.held).toFixed(2),
            r.shortfall == null ? '' : round2(r.shortfall).toFixed(2)].map(csvCell).join(',')));
        return lines.join('\r\n') + '\r\n';
    }

    // ── Server error codes → sentences ─────────────────────────────

    const ERRORS = {
        BUYER_REQUIRED: 'This needs an account that may buy: the owner, or staff with the Buyer switch on. Linking a purchase to a request or picking its portions always does.',
        NAME_DIFFERS: 'The item name differs from the request. Choose "Same item, other words", or "Substitute" if an important specification changed.',
        SUBSTITUTE_REASON_REQUIRED: 'A substitute needs a reason (what changed and who agreed). It counts toward Bought after an office check.',
        OWNER_ONLY: 'Only the owner can do this.',
        NOT_STAFF: 'The Buyer switch is for your own staff accounts only.',
        BAD_SWITCH: 'Choose on or off.',
        BAD_BUYER: 'Pick someone who may buy (the owner or a staff member with the Buyer switch). Only the owner records a purchase for someone else.',
        ASSIGNED_TO_OTHER: 'Another buyer is handling this. Ask the owner to reassign it.',
        NOT_YOUR_PORTION: 'You can only release what you are buying yourself.',
        NOTHING_TO_BUY: 'Nothing is left to buy here.',
        BAD_QUANTITY: 'Enter a quantity above 0 (at most 3 decimals) and no more than what is left.',
        BAD_NOTE: 'Keep the note to 300 characters.',
        LINE_CLOSED: 'This item was cancelled. Reload the list.',
        REDUCTION_PENDING: 'A reduction is waiting on this quantity. Resolve it in the request first.',
        BOUGHT: 'Something was already bought for this quantity, so it stays in its weekly batch.',
        BAD_REQUEST_LINK: 'A purchase line must go to the same project and work (Main Contract or Additional Works) as its request.',
        BAD_PORTION: 'That part of the request is no longer available. Reload the list.',
        BAD_DOCS: 'A receipt photo link is not valid — attach the photo again.',
        EXTRA_REASON_REQUIRED: 'You bought more than is still needed. Say why (pack size, spare, cheaper in bulk) and where the extra goes.',
        BAD_EXTRA: 'The extra goes to the same project or to the warehouse.',
        UNPLANNED_REASON_REQUIRED: 'A purchase with no request needs a reason.',
        BAD_SUPPLIER: 'Give the supplier a name (branch and contact are optional).',
        DUPLICATE_SUPPLIER: 'This supplier and branch are already on the list.',
        OWN_PURCHASE: 'Someone else must check a purchase you bought or recorded yourself.',
        NO_UNIT_CHECK: 'This line has nothing to check. Reload the purchase.',
        MORE_THAN_NEEDED: 'That is more than the request still needs. Enter what this purchase really covers.',
        OWNER_APPROVAL_NEEDED: 'Moving a cost to another project needs the owner. You can send it for approval.',
        COMPLETED_PROJECT: 'This project is marked completed — only the owner can change its costs. You can send it for approval.',
        OWNER_CAN_DO_IT: 'You are the owner — make the change directly.',
        ALREADY_PENDING: 'A change to this purchase is already waiting for the owner.',
        NOT_PENDING: 'This request was already decided. Reload the page.',
        BAD_KIND: 'Choose correct, replace or void.',
        BAD_DECISION: 'Choose approve or reject.',
        LINES_CHANGED: 'A correction keeps the same number of lines. To add or remove a line, use Replace.',
        TOTAL_MISMATCH: 'The lines, fees and discounts do not add up to the receipt total.',
        SPLIT_MISMATCH: 'A fee or discount split must add up to the fee or discount exactly.',
        DISCOUNT_TOO_LARGE: 'A discount cannot be larger than the line it applies to.',
        BAD_DATE: 'Enter the date the goods were actually bought.',
        BAD_AMOUNT: 'Check the amounts (pesos and centavos only).',
        BAD_NAME: 'Give every line an item name.',
        BAD_LINES: 'A purchase has 1 to 50 lines. Check the reasons (300 characters at most).',
        BAD_CHARGES: 'Check the fees and discounts.',
        BAD_PROJECT: 'Pick a project and its work, or the warehouse.',
        BAD_DESTINATION: 'Pick a project and its work, or the warehouse.',
        AW_NO_PERIOD: 'This Additional Works job has no billing period yet.',
        NO_RECEIPT: 'A phone purchase needs a receipt photo, or a reason why there is none.',
        BAD_REASON: 'Keep the reason to 300 characters.',
        CONFIRM_WORD: 'Type the word shown to confirm.',
        REASON_REQUIRED: 'Write a short reason. It is kept in the history.',
        NOT_FOUND: 'This record no longer exists or belongs to another company. Reload the page.',
        BAD_STATE: 'This purchase was already voided or replaced. Reload the page.',
        NOT_OFFICE: 'Only office accounts can do this.',
        NOT_ALLOWED: 'This account is not set up for Expenses.',
        PGRST202: 'The server is not updated for the Purchasing tab yet (migration 0097). Nothing was changed.',
        // 0102 — payments, petty cash, own money.
        BAD_SOURCE: 'This purchase came from an unknown place. Reload the page.',
        BAD_PAY: 'Check the payment: at most five with a purchase, and none on a correction (use Record payment).',
        BAD_PAY_SOURCE: 'Choose where the money came from: petty cash, own money, the company, or a supplier credit.',
        BAD_METHOD: 'Choose how it was paid (cash, GCash, bank transfer, check or other).',
        BAD_PERSON: 'Pick whose money it was.',
        PERSON_REQUIRED: 'Say whose petty cash or own money paid — only a staff buyer holds petty cash.',
        PERSON_NOT_ALLOWED: 'You can record only your own petty cash or own money. The owner records another buyer\'s.',
        NOT_A_BUYER: 'Only a staff buyer of this company holds petty cash or can be owed their own money.',
        CREDIT_REQUIRED: 'Pick the supplier credit to use.',
        CREDIT_GONE: 'That supplier credit was voided. Reload the purchase.',
        CREDIT_SUPPLIER: 'A supplier credit pays only that supplier — this purchase needs a supplier from the list, and the same one.',
        OVER_CREDIT: 'That is more than the credit has left.',
        CREDIT_USED: 'Part of this credit was already used. Void those payments first.',
        NOT_YOURS: 'Only the person who recorded this payment, or the owner, can void it.',
        ALREADY_VOIDED: 'This was already voided. Reload the page.',
        RESOLVED_FIRST: 'A refund or credit already relies on this payment. Void that refund or credit first.',
        NOTHING_TO_RESOLVE: 'Enter a refund or a supplier credit.',
        BAD_RESOLUTION: 'Check the refunds and the credit.',
        BAD_REFUND_ROUTE: 'That refund cannot go there: petty cash goes back into petty cash or to the owner; own money goes to the buyer or the owner; company money goes to the owner or into a buyer\'s petty cash.',
        OVER_SOURCE: 'That is more back than that money paid on this purchase.',
        OVER_RESOLVED: 'Refunds and credit together cannot be more than what is over.',
        ALREADY_DISPUTED: 'You already said this was not received. The owner will check it.',
        OVER_OWED: 'That is more than the company owes this buyer.',
        BAD_RANGE: 'Pick at most 92 days, the start before the end.',
        PAID_AMOUNT: 'Enter how much was paid now.',
        PART_NOT_LESS: 'A part payment is less than the receipt total — choose "Paid in full" instead.',
    };

    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) {
                return ERRORS[code] + (code === 'EXTRA_REASON_REQUIRED' && error && error.hint ? ' (' + error.hint + ')' : '');
            }
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    const pure = { round2, round3, peso, qty, parseMoney, parseQty, sameUnit, portionActions, buyerLabel, filterList,
                   listSummary, coverPreview, pickedStill, lineStill, defaultPicks, countsDirectly, docUploads, storedDocs, prorate, receiptTotal,
                   buildBody, formProblems, unplannedReasonNeeded, HISTORY_LABEL, REQUEST_STATUS, purchaseFlags, needsOwner, changeRows, ERRORS,
                   errorMessage, SOURCE_LABEL, sourceLabel, searchPurchases, voidWord, voidConfirmed, placesOf, canRecordAgain,
                   chargesOf, recordAgainState,
                   PAY_STATE, payLabel, PAY_SOURCE, PAY_METHOD, methodOf, localDay, paymentProblems, paymentBody, cashWarning,
                   paidNowPayments, paidNowProblems, REFUND_ROUTES, routeLabel, defaultResolution, resolutionProblems,
                   cashFigures, reportRows, reportCsv };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser helpers (Requests' own: esc, rpc, modal, head …) ────

    const RA = root.RequestsAdmin;
    const state = { me: null, purchaseId: null };

    async function me() {
        if (!state.me) {
            const data = await RA.rpc('pur_me');
            state.me = { userId: data && data.user_id, isOwner: !!(data && data.is_owner), canBuy: !!(data && data.can_buy) };
        }
        return state.me;
    }

    function openPurchase(id) {
        state.purchaseId = id;
        root.switchView('reqPurchase');
    }

    // A refusal from the server, in words, in a one-button box.
    function notice(error, title) {
        const plain = typeof error === 'string' && !/^[A-Z][A-Z_]+$/.test(error);
        RA.modal({ title: title || 'Not done', body: '<p>' + RA.esc(plain ? error : errorMessage(error)) + '</p>', submitLabel: 'OK', onSubmit: () => {} });
    }

    function pill(text, tone) {
        return '<span class="att-pill att-pill--' + tone + '">' + RA.esc(text) + '</span>';
    }

    root.PurchasingAdmin = Object.assign({}, pure, { me, openPurchase, pill, notice, state });
})(typeof window !== 'undefined' ? window : globalThis);
