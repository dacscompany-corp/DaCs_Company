// ════════════════════════════════════════════════════════════════════
// Requests → Stock (WorkMate Stage 2B-a, migration 0104).
//
// Where goods are, in catalogue units: the company warehouse and each
// project's site. Four tabs:
//   Stock            — every item by place; open one for its lots and history;
//   Receiving        — warehouse purchases awaiting delivery or a match,
//                      and "Match a project purchase line…" (F1);
//   Waiting for owner — counts and opening stock the main owner confirms;
//   History          — the latest records, each reversible (never edited).
// Actions: Issue / move, Record leftovers, Count, Opening stock. The
// shopping list's "Issue from stock" opens the same issue form (openIssue).
//
// Goods are issued oldest RECEIVED first (each delivery is its own layer,
// dated the day it arrived); one item's screen lists them in that order.
//
// QUANTITIES ONLY: no peso amount is read or shown here. Since 2C (0105)
// each record lists its cost moves — "Cost assignment pending", "Cost
// transferred"… — as states; their values (owner accounts) and the main
// owner's Approve / Reject / Reverse cost, and a recorder's Ask again, are
// js/stock-cost-admin.js (window.StockCostAdmin). Owner and office
// staff allowed Expenses use it (Buyer staff are office staff); the nav
// hides it until the main owner switches stock on (launch), and shows the
// main owner the switch. Every rule is the server's (0104); this file only
// previews and explains. Each form sends one operation id, kept across
// retries of the same form, so a double press records once.
//
// Works in a browser (window.StockAdmin) and in Node for
// tests/stock-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    // ── Words ───────────────────────────────────────────────────────

    const KIND_LABEL = {
        receive: 'Received',
        not_delivered: 'Not delivered',
        leftover: 'Leftovers recorded',
        issue: 'Issued to project',
        return: 'Returned to warehouse',
        move: 'Moved',
        count: 'Count',
        opening: 'Opening stock',
    };

    // The server's count reasons (stk_count), in this order on screen.
    const COUNT_REASONS = [
        ['lost', 'Lost'], ['damaged', 'Damaged'], ['expired', 'Expired'], ['miscounted', 'Miscounted'], ['other', 'Other'],
    ];

    function qty(n) {
        const x = Number(n);
        if (n === null || n === undefined || n === '' || !isFinite(x)) return '—';
        return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }

    // Same rule as the server's pur_qty: a plain number, at most 3 decimals.
    // allowZero for a count. Null = refused.
    function parseQty(text, allowZero) {
        const s = String(text === null || text === undefined ? '' : text).replace(/,/g, '').trim();
        if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
        const x = Number(s);
        if (x > 1000000) return null;
        if (x === 0 && !allowZero) return null;
        return x;
    }

    // A record's state as a pill: [text, tone] or null.
    function recordState(r) {
        if (r.reversed) return ['Reversed', 'abandoned'];
        if (r.status === 'pending') return ['Waiting for the owner', 'working'];
        if (r.status === 'rejected') return ['Rejected', 'abandoned'];
        if (r.status === 'withdrawn') return ['Withdrawn', 'abandoned'];
        return null;
    }

    // One line about a record: what moved, how much, from where to where.
    function recordText(r) {
        const unit = r.kind === 'receive' || r.kind === 'not_delivered' ? (r.line_unit || '') : (r.item_unit || '');
        const what = r.item_name || r.line_item || 'Item';
        const howMuch = qty(r.quantity) + (unit ? ' ' + unit : '');
        switch (r.kind) {
            case 'receive': return howMuch + ' ' + what + ' received at the warehouse';
            case 'not_delivered': return howMuch + ' ' + what + ' will not be delivered';
            case 'leftover': return howMuch + ' ' + what + ' left over — ' + (r.to_name || '');
            case 'count': return what + ' at ' + (r.to_name || '') + ': counted ' + qty(r.quantity) + ', books ' + qty(r.book_quantity);
            case 'opening': return howMuch + ' ' + what + ' already at ' + (r.to_name || '');
            default: return howMuch + ' ' + what + ' — ' + (r.from_name || '') + ' → ' + (r.to_name || '');
        }
    }

    // What the record says about a request.
    function requestText(r) {
        if (r.request_line_id) return 'For request: ' + (r.request_description || 'request line');
        if (r.unplanned_reason) return 'Unplanned: ' + r.unplanned_reason;
        return '';
    }

    // A count's difference, signed, with its reason.
    function countDifference(r) {
        const d = Math.round((Number(r.quantity) - Number(r.book_quantity)) * 1000) / 1000;
        return (d > 0 ? '+' : '') + qty(d);
    }

    // Each delivery or entry still in stock, oldest received first — the
    // order the server issues them in: "Received 2 Oct 2026 · Warehouse 5".
    function layerText(layers) {
        const day = (d) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
            return m ? Number(m[3]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1] : String(d || '');
        };
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return (layers || []).map(y => 'Received ' + esc(day(y.received_on)) + ' · ' + esc(y.name) + ' ' + esc(qty(y.quantity))).join('<br>');
    }

    // Who may reverse or withdraw (the server decides again).
    // me = { userId, isOwner, isMainOwner }.
    function canReverse(r, me) {
        if (r.reversed || r.status === 'rejected' || r.status === 'withdrawn') return false;
        if (r.status === 'pending') return r.recorded_by === me.userId || me.isMainOwner;
        if (r.kind === 'count' || r.kind === 'opening') return me.isMainOwner && !(r.kind === 'count' && Number(r.quantity) === Number(r.book_quantity));
        return r.recorded_by === me.userId || me.isOwner;
    }

    // ── Cost moves (0105): states only ──────────────────────────────

    // A cost move's state as a pill: [text, tone].
    function costState(c) {
        if (c.status === 'pending') {
            return [c.kind === 'assign' ? 'Cost assignment pending' : c.kind === 'transfer' ? 'Cost transfer pending'
                    : 'Back to company stock — pending', 'working'];
        }
        if (c.status === 'rejected') return ['Cost move rejected — kept with source', 'abandoned'];
        if (c.status === 'withdrawn') return ['Cost request withdrawn', 'abandoned'];
        if (c.reversed) return ['Cost move reversed', 'abandoned'];
        return [c.kind === 'assign' ? 'Cost assigned' : c.kind === 'transfer' ? 'Cost transferred'
                : c.kind === 'back' ? 'Cost back in company stock' : 'Company stock loss', 'done'];
    }

    // "4 bag: Company stock → Barlin" — what moved and whose cost.
    function costText(c, unit) {
        const q = c.status === 'approved' ? c.approved_quantity : c.quantity;
        return qty(q) + (unit ? ' ' + unit : '') + ': ' + (c.from_name || '') + ' → ' + (c.to_name || '');
    }

    // Ask again: a rejected or reversed one, while nothing else is open for
    // the same movement (costs = the record's cost moves).
    function canResubmit(c, costs) {
        if (!(c.status === 'rejected' || (c.status === 'approved' && c.reversed && c.kind !== 'loss'))) return false;
        return !(costs || []).some(x => x.id !== c.id && x.move_id === c.move_id
                                     && (x.status === 'pending' || (x.status === 'approved' && !x.reversed)));
    }

    // me = { isMainOwner }: decide a pending one; reverse an approved one (a loss goes with its count).
    function costActions(c, me, costs, canRecord) {
        const out = [];
        if (me.isMainOwner && c.status === 'pending') out.push('approve', 'reject');
        if (me.isMainOwner && c.status === 'approved' && !c.reversed && c.kind !== 'loss') out.push('reverse');
        if (canRecord && canResubmit(c, costs)) out.push('resubmit');
        return out;
    }

    // Places to pick: the warehouse, then each project (completed ones last,
    // marked — goods can still be recorded there, Q16).
    function placeOptions(choices) {
        const projects = (choices && choices.projects) || [];
        return [{ value: 'warehouse', label: 'Warehouse' }]
            .concat(projects.filter(p => !p.completed).map(p => ({ value: p.folder_id, label: p.name })))
            .concat(projects.filter(p => p.completed).map(p => ({ value: p.folder_id, label: p.name + ' (completed)' })));
    }

    function itemLabel(i) {
        return i ? i.name + (i.spec ? ' — ' + i.spec : '') + ' (' + i.unit + ')' : '';
    }

    // A warehouse line: does it need the office's match, and what is left
    // to receive?
    function needsMatch(line) { return !line.match && !line.auto_item_id; }

    // Match form checks, as the server's: the same unit counts one for one;
    // another unit needs a note and someone other than who bought it.
    function matchProblems(line, item, coversText, note) {
        const out = [];
        if (!item) return ['BAD_ITEM'];
        const covers = parseQty(coversText);
        const same = String(line.unit || '').trim().toLowerCase() === String(item.unit || '').trim().toLowerCase();
        if (covers === null || (same && covers !== Number(line.quantity))) out.push('BAD_QUANTITY');
        if (!same && !String(note || '').trim()) out.push('REASON_REQUIRED');
        if (!same && line.can_check === false) out.push('OWN_PURCHASE');
        return out;
    }

    // ── Issue / move ────────────────────────────────────────────────

    // st: { itemId, from, to, quantity, on, lotId, returnsRecord,
    // requestLineId, unplannedReason, note }. ctx: { today }.
    function moveProblems(st, ctx) {
        const out = [];
        if (!st.itemId) out.push('BAD_ITEM');
        if (parseQty(st.quantity) === null) out.push('BAD_QUANTITY');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.on || '')) || (ctx && ctx.today && st.on > ctx.today)) out.push('BAD_DATE');
        if (!st.returnsRecord) {
            if (!st.from || !st.to || st.from === st.to) out.push('BAD_LOCATION');
            const toSite = st.to && st.to !== 'warehouse';
            if (toSite && !st.requestLineId && !String(st.unplannedReason || '').trim()) out.push('UNPLANNED_REASON_REQUIRED');
            if (!toSite && (st.requestLineId || String(st.unplannedReason || '').trim())) out.push('BAD_REQUEST_LINK');
        }
        if (String(st.note || '').trim().length > 300 || String(st.unplannedReason || '').trim().length > 300) out.push('BAD_NOTE');
        return out;
    }

    function moveBody(st) {
        const b = { item_id: st.itemId, quantity: String(parseQty(st.quantity)), on: st.on, note: String(st.note || '').trim() };
        if (st.returnsRecord) {
            b.returns_record = st.returnsRecord;
        } else {
            b.from = st.from;
            b.to = st.to;
            if (st.to !== 'warehouse') {
                if (st.requestLineId) b.request_line_id = st.requestLineId;
                else b.unplanned_reason = String(st.unplannedReason || '').trim();
            }
        }
        if (st.lotId) b.lot_id = st.lotId;
        return b;
    }

    // What kind of record a move will be (the server decides the same way).
    function moveKind(st) {
        if (st.returnsRecord) return 'return';
        return st.from === 'warehouse' ? 'issue' : 'move';
    }

    function countProblems(st, book, ctx) {
        const out = [];
        if (!st.itemId) out.push('BAD_ITEM');
        if (!st.at) out.push('BAD_LOCATION');
        const c = parseQty(st.counted, true);
        if (c === null) out.push('BAD_QUANTITY');
        if (c !== null && book !== null && book !== undefined && c !== Number(book)
            && !COUNT_REASONS.some(([k]) => k === st.reason)) out.push('REASON_REQUIRED');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(st.on || '')) || (ctx && ctx.today && st.on > ctx.today)) out.push('BAD_DATE');
        return out;
    }

    // ── Errors in words ─────────────────────────────────────────────

    const ERRORS = {
        STOCK_OFF: 'Stock is not switched on yet. The main owner switches it on at launch.',
        TO_MATCH: 'Match this purchase line to a catalogue item first (Receiving tab — a project\'s line: "Match a project purchase line…").',
        NOT_WAREHOUSE: 'That purchase line is for a project, not the warehouse. Record its leftovers instead.',
        NOT_PROJECT: 'That purchase line is for the warehouse — it becomes stock by being received.',
        MORE_THAN_AWAITED: 'That is more than is still awaited on this line.',
        MORE_THAN_BOUGHT: 'That is more than this purchase line brought (counting what is already recorded as stock).',
        MORE_THAN_ISSUED: 'That is more than this issue sent and has not had back.',
        NOT_ENOUGH: 'There is not that much there.',
        BAD_LOT: 'Pick a lot of this item.',
        BAD_RETURN: 'Only a live issue from the warehouse can be returned.',
        BAD_LOCATION: 'Pick where the goods are and where they go — two different places.',
        BAD_ITEM: 'Pick a catalogue item.',
        BAD_PROJECT: 'Pick one of your projects.',
        UNPLANNED_REASON_REQUIRED: 'Goods going to a project fill a request line, or say why they are needed.',
        REQUEST_EXCEEDED: 'That is more than the request still needs. Record the rest separately, as unplanned with a reason.',
        ITEM_MISMATCH: 'That request line is for a different catalogue item.',
        UNIT_MISMATCH: 'That request line uses another unit. Issue it as unplanned with a reason.',
        LINE_CLOSED: 'That request line was cancelled.',
        BAD_REQUEST_LINK: 'A request belongs to the project the goods go to — never to the warehouse.',
        BAD_PORTION: 'Check the weekly portions picked.',
        COUNT_PENDING: 'A count of this item here is already waiting for the owner.',
        STALE_COUNT: 'The books changed since this count. Reject it, then count again.',
        STOCK_IN_USE: 'This purchase line has stock records. Reverse them first, or keep its destination, project, unit and enough quantity.',
        MOVED_ON: 'Those goods have moved on. Reverse the later records first.',
        COST_MOVED: 'The main owner approved this movement\'s cost. The main owner reverses that cost move first.',
        STOCK_COST_IN_USE: 'The owner approved cost moves that rely on this purchase line as it stands. Reverse them first.',
        RETURNS_FIRST: 'Part of this issue came back. Reverse that return first.',
        NOT_YOURS: 'Only the person who recorded this, or an owner, can reverse it.',
        OWN_PURCHASE: 'Another unit is checked by the office — never by whoever recorded or bought the purchase.',
        BAD_QUANTITY: 'Enter a quantity (at most 3 decimals). For the same unit, the match is the line\'s own quantity.',
        BAD_DATE: 'Pick a date that has happened.',
        REASON_REQUIRED: 'Please give a reason.',
        BAD_NOTE: 'That note is too long (300 characters at most).',
        BAD_STATE: 'This record was already decided, withdrawn or reversed. Reload the page.',
        NOT_ALLOWED: 'Only the main owner can do that.',
        OWNER_ONLY: 'Only the main owner can do that.',
        NOT_OFFICE: 'Only owner and office accounts can record stock.',
        NOT_FOUND: 'That was not found. Reload the page.',
        BAD_OP: 'Something went wrong. Close the form and try again.',
        BAD_SWITCH: 'Something went wrong. Reload the page.',
        STOCK_TICK_RETIRED: 'The old "Add to inventory" tick is retired — stock is recorded in Requests → Stock.',
        ITEM_IN_USE: 'That catalogue item is used in requests or stock, so its kind and unit cannot change.',
        PGRST202: 'Stock is not installed on the server yet.',
    };
    const HINTED = ['NOT_ENOUGH', 'MORE_THAN_BOUGHT', 'MORE_THAN_ISSUED', 'MORE_THAN_AWAITED', 'REQUEST_EXCEEDED'];

    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) {
                return ERRORS[code] + (HINTED.includes(code) && error && error.hint ? ' (' + error.hint + ')' : '');
            }
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    function localDay(d) {
        const x = d || new Date();
        return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }

    const pure = { KIND_LABEL, COUNT_REASONS, qty, parseQty, recordState, recordText, requestText, countDifference, canReverse, layerText,
                   costState, costText, canResubmit, costActions,
                   placeOptions, itemLabel, needsMatch, matchProblems, moveProblems, moveBody, moveKind, countProblems,
                   ERRORS, errorMessage, localDay };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser ─────────────────────────────────────────────────────

    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const ui = { tab: 'stock', itemId: null, sel: null, text: '' };
    const SV = root.SplitView;
    let cache = { choices: null, status: null };

    const newOp = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

    // Who is looking, from the server (stk_status).
    function me() {
        const s = cache.status || {};
        return { userId: s.user_id, isOwner: !!s.is_owner, isMainOwner: !!s.is_main_owner, canRecord: !!s.can_record };
    }

    function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }

    // A refusal from the server in words — or a plain sentence as it is.
    function notice(error, title) {
        const plain = typeof error === 'string' && !/^[A-Z][A-Z_]+$/.test(error);
        RA.modal({ title: title || 'Not done', body: '<p>' + esc(plain ? error : errorMessage(error)) + '</p>', submitLabel: 'OK', onSubmit: () => {} });
    }

    async function choices() {
        if (!cache.choices) cache.choices = await RA.rpc('stk_choices');
        return cache.choices;
    }

    function options(list, selected) {
        return list.map(o => '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
    }
    function itemOptions(items, selected) {
        return '<option value="">Pick an item…</option>' +
            items.map(i => '<option value="' + esc(i.item_id) + '"' + (i.item_id === selected ? ' selected' : '') + '>' + esc(itemLabel(i)) + '</option>').join('');
    }

    // A form that sends one operation id however many times it is submitted.
    function sendOnce(fn) {
        const opId = newOp();
        return (...args) => fn(opId, ...args);
    }

    // ── Forms ───────────────────────────────────────────────────────

    // Issue / move. preset: { itemId, from, to, requestLineId, quantity,
    // returnsRecord, returnFrom, lockItem }. onDone: after saving.
    async function openMove(preset, onDone) {
        const p = preset || {};
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const places = placeOptions(ch);
        const isReturn = !!p.returnsRecord;
        const send = sendOnce((opId, body) => RA.rpc('stk_move', { p_op: opId, p_body: body }));
        RA.modal({
            title: isReturn ? 'Return to the warehouse' : (p.from === 'warehouse' || !p.from ? 'Issue from stock' : 'Move goods'),
            sub: isReturn ? 'The same lots go back. A return never reopens the request — the goods were delivered.'
                          : 'Quantities in the catalogue item\'s unit. The oldest goods go first unless you name the lot.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Item<select class="att-input" name="item"' + (p.lockItem || isReturn ? ' disabled' : '') + '>' +
                  itemOptions(ch.items, p.itemId) + '</select></label>' +
                (isReturn ? '<p class="req-muted">From ' + esc(p.returnFrom || 'the project') + ' back to the Warehouse.</p>' :
                  '<div class="stk-grid2">' +
                    '<label class="att-label">From<select class="att-input" name="from">' + options(places, p.from || 'warehouse') + '</select></label>' +
                    '<label class="att-label">To<select class="att-input" name="to">' +
                      '<option value="">Pick a place…</option>' + options(places, p.to) + '</select></label>' +
                  '</div>') +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Quantity<input class="att-input" name="qty" inputmode="decimal" value="' + esc(p.quantity ? qty(p.quantity) : '') + '"></label>' +
                  '<label class="att-label">Date received<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '</div>' +
                (isReturn ? '' :
                  '<div data-request-box><label class="att-label">Fills request<select class="att-input" name="request">' +
                    '<option value="">None — unplanned</option></select></label>' +
                  '<label class="att-label" data-unplanned>Why it is needed (unplanned)<input class="att-input" name="unplanned" maxlength="300"></label></div>') +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: isReturn ? 'Return' : 'Save',
            errorMessage,
            onOpen: (form) => {
                if (isReturn) return;
                const sync = async () => {
                    const to = form.to.value;
                    const box = form.querySelector('[data-request-box]');
                    box.style.display = to && to !== 'warehouse' ? '' : 'none';
                    if (!to || to === 'warehouse') return;
                    let lines = [];
                    try { lines = await RA.rpc('stk_request_lines', { p_folder: to }); } catch (_) { lines = []; }
                    const item = form.item.value;
                    form.request.innerHTML = '<option value="">None — unplanned</option>' + lines
                        .filter(l => !item || !l.catalog_item_id || l.catalog_item_id === item)
                        .map(l => '<option value="' + esc(l.line_id) + '"' + (l.line_id === p.requestLineId ? ' selected' : '') + '>' +
                            esc(l.description + (l.spec ? ' — ' + l.spec : '') + ' · still ' + qty(l.still_to_buy) + ' ' + l.unit + ' · ' + l.requester_name) +
                            '</option>').join('');
                    form.querySelector('[data-unplanned]').style.display = form.request.value ? 'none' : '';
                };
                form.to.addEventListener('change', sync);
                form.item.addEventListener('change', sync);
                form.request.addEventListener('change', () => {
                    form.querySelector('[data-unplanned]').style.display = form.request.value ? 'none' : '';
                });
                sync();
            },
            onSubmit: async (form) => {
                const st = isReturn
                    ? { itemId: p.itemId, quantity: form.qty.value, on: form.on.value, returnsRecord: p.returnsRecord, note: form.note.value }
                    : { itemId: p.lockItem ? p.itemId : form.item.value, from: form.from.value, to: form.to.value, quantity: form.qty.value,
                        on: form.on.value, requestLineId: form.request.value || null, unplannedReason: form.unplanned.value, note: form.note.value };
                const problems = moveProblems(st, { today: localDay() });
                if (problems.length) throw new Error(problems[0]);
                await send(moveBody(st));
            },
            onDone,
        });
    }

    // preset: { folder, line: 'purchase_id:line_no' } — back from Match… on
    // the same project and line.
    async function openLeftover(onDone, preset) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, a) => RA.rpc('stk_leftover', Object.assign({ p_op: opId }, a)));
        let lines = [];
        RA.modal({
            title: 'Record leftovers',
            sub: 'Goods a project bought and did not use. Their cost stays with that project.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Project<select class="att-input" name="folder"><option value="">Pick a project…</option>' +
                  options(placeOptions(ch).filter(o => o.value !== 'warehouse'), null) + '</select></label>' +
                '<label class="att-label">Purchase line<select class="att-input" name="line"><option value="">Pick the project first</option></select></label>' +
                '<p class="req-muted" data-line-note></p>' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Quantity<input class="att-input" name="qty" inputmode="decimal"></label>' +
                  '<label class="att-label">Where<select class="att-input" name="where"><option value="site">Still at the site</option>' +
                    '<option value="warehouse">Brought to the warehouse</option></select></label>' +
                '</div>' +
                '<label class="att-label">Date<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Save',
            errorMessage,
            onOpen: async (form) => {
                const note = form.querySelector('[data-line-note]');
                const loadLines = async () => {
                    lines = [];
                    note.textContent = '';
                    try { lines = await RA.rpc('stk_project_lines', { p_folder: form.folder.value }); } catch (e) { note.textContent = errorMessage(e); }
                    form.line.innerHTML = '<option value="">Pick a purchase line…</option>' + lines.map((l, i) =>
                        '<option value="' + i + '">' + esc(RA.formatDay(l.purchase_date) + ' · ' + l.item_name + ' · ' + qty(l.quantity) + ' ' + l.unit) + '</option>').join('');
                };
                const showLine = () => {
                    const l = lines[Number(form.line.value)];
                    if (!l) { note.textContent = ''; return; }
                    if (!needsMatch(l)) {
                        note.textContent = (l.match ? 'Counts as ' + l.match.item_name + ' (' + l.match.item_unit + '). ' : '') +
                            'Already recorded as stock: ' + qty(l.entered) + '.';
                        return;
                    }
                    // F1: a project line is matched here — Receiving lists warehouse lines only.
                    note.innerHTML = esc('Not matched to a catalogue item yet — match it first. ') +
                        '<button type="button" class="att-btn att-btn--sm" data-match-line>Match…</button>';
                    note.querySelector('[data-match-line]').addEventListener('click', () =>
                        openMatch(l, () => openLeftover(onDone, { folder: form.folder.value, line: l.purchase_id + ':' + l.line_no })));
                };
                form.folder.addEventListener('change', loadLines);
                form.line.addEventListener('change', showLine);
                if (preset && preset.folder) {
                    form.folder.value = preset.folder;
                    await loadLines();
                    const i = lines.findIndex(l => l.purchase_id + ':' + l.line_no === preset.line);
                    if (i >= 0) { form.line.value = String(i); showLine(); }
                }
            },
            onSubmit: async (form) => {
                const l = lines[Number(form.line.value)];
                if (!l) throw new Error('NOT_FOUND');
                if (parseQty(form.qty.value) === null) throw new Error('BAD_QUANTITY');
                await send({ p_purchase: l.purchase_id, p_line_no: l.line_no, p_qty: String(parseQty(form.qty.value)),
                             p_where: form.where.value, p_on: form.on.value, p_note: form.note.value.trim() });
            },
            onDone,
        });
    }

    async function openCount(preset, onDone) {
        const p = preset || {};
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, body) => RA.rpc('stk_count', { p_op: opId, p_body: body }));
        RA.modal({
            title: 'Count',
            sub: 'Count one item at one place. A difference waits for the main owner, with a reason.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Item<select class="att-input" name="item">' + itemOptions(ch.items, p.itemId) + '</select></label>' +
                '<label class="att-label">Place<select class="att-input" name="at">' + options(placeOptions(ch), p.at || 'warehouse') + '</select></label>' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Counted<input class="att-input" name="counted" inputmode="decimal"></label>' +
                  '<label class="att-label">Date<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '</div>' +
                '<label class="att-label">If it differs from the books: why<select class="att-input" name="reason"><option value="">—</option>' +
                  COUNT_REASONS.map(([k, label]) => '<option value="' + k + '">' + label + '</option>').join('') + '</select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Save count',
            errorMessage,
            onSubmit: async (form) => {
                const st = { itemId: form.item.value, at: form.at.value, counted: form.counted.value, on: form.on.value, reason: form.reason.value };
                const problems = countProblems(st, null, { today: localDay() });
                if (problems.length) throw new Error(problems[0]);
                const r = await send({ item_id: st.itemId, at: st.at, counted: String(parseQty(st.counted, true)), on: st.on,
                                       reason: st.reason, note: form.note.value.trim() });
                if (r && r.status === 'pending') {
                    root.setTimeout(() => notice('Counted ' + qty(r.counted) + ', the books say ' + qty(r.book) +
                        '. The difference waits for the main owner.', 'Count saved'), 0);
                }
            },
            onDone,
        });
    }

    async function openOpening(onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, body) => RA.rpc('stk_opening', { p_op: opId, p_body: body }));
        let lines = [];
        RA.modal({
            title: 'Opening stock',
            sub: 'Goods already there before stock tracking. Name the purchase when you know it (its cost stays with that project); otherwise it is untraced. The main owner confirms.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Item<select class="att-input" name="item">' + itemOptions(ch.items, null) + '</select></label>' +
                '<label class="att-label">Place<select class="att-input" name="at">' + options(placeOptions(ch), 'warehouse') + '</select></label>' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Quantity<input class="att-input" name="qty" inputmode="decimal"></label>' +
                  '<label class="att-label">Date counted<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '</div>' +
                '<label class="att-label">Bought for project (optional)<select class="att-input" name="folder"><option value="">Not known — untraced</option>' +
                  options(placeOptions(ch).filter(o => o.value !== 'warehouse'), null) + '</select></label>' +
                '<label class="att-label">Purchase line<select class="att-input" name="line"><option value="">—</option></select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Send to the owner',
            errorMessage,
            onOpen: (form) => {
                form.folder.addEventListener('change', async () => {
                    lines = [];
                    if (form.folder.value) {
                        try { lines = await RA.rpc('stk_project_lines', { p_folder: form.folder.value }); } catch (_) { lines = []; }
                    }
                    form.line.innerHTML = '<option value="">—</option>' + lines.map((l, i) =>
                        '<option value="' + i + '">' + esc(RA.formatDay(l.purchase_date) + ' · ' + l.item_name + ' · ' + qty(l.quantity) + ' ' + l.unit) + '</option>').join('');
                });
            },
            onSubmit: async (form) => {
                if (!form.item.value) throw new Error('BAD_ITEM');
                if (parseQty(form.qty.value) === null) throw new Error('BAD_QUANTITY');
                const b = { item_id: form.item.value, at: form.at.value, quantity: String(parseQty(form.qty.value)), on: form.on.value,
                            note: form.note.value.trim() };
                const l = lines[Number(form.line.value)];
                if (form.folder.value && form.line.value !== '' && l) { b.purchase_id = l.purchase_id; b.line_no = String(l.line_no); }
                await send(b);
            },
            onDone,
        });
    }

    async function openMatch(line, onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, a) => RA.rpc('stk_match', Object.assign({ p_op: opId }, a)));
        const pre = (line.match && line.match.item_id) || line.suggested_item_id || '';
        RA.modal({
            title: 'Match to a catalogue item',
            sub: line.item_name + ' · ' + qty(line.quantity) + ' ' + line.unit + ' (bought ' + RA.formatDay(line.purchase_date) + ' by ' + line.bought_by_name + ')',
            body: '<div class="stk-form">' +
                '<label class="att-label">Catalogue item<select class="att-input" name="item">' + itemOptions(ch.items, pre) + '</select></label>' +
                '<label class="att-label">How many item units is the whole line?<input class="att-input" name="covers" inputmode="decimal" value="' + esc(qty(line.quantity)) + '"></label>' +
                '<p class="req-muted" data-unit-note></p>' +
                '<label class="att-label">Note (needed for another unit)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Match',
            errorMessage,
            onOpen: (form) => {
                const sync = () => {
                    const item = ch.items.find(i => i.item_id === form.item.value);
                    const n = form.querySelector('[data-unit-note]');
                    if (!item) { n.textContent = ''; return; }
                    const same = String(line.unit).trim().toLowerCase() === String(item.unit).trim().toLowerCase();
                    form.covers.readOnly = same;
                    if (same) form.covers.value = qty(line.quantity);
                    n.textContent = same ? 'Same unit — one for one.'
                        : 'Another unit: ' + qty(line.quantity) + ' ' + line.unit + ' = how many ' + item.unit + '?' +
                          (line.can_check === false ? ' The office checks this, not whoever bought it.' : '');
                };
                form.item.addEventListener('change', sync);
                sync();
            },
            onSubmit: async (form) => {
                const item = ch.items.find(i => i.item_id === form.item.value);
                const problems = matchProblems(line, item, form.covers.value, form.note.value);
                if (problems.length) throw new Error(problems[0]);
                await send({ p_purchase: line.purchase_id, p_line_no: line.line_no, p_item: item.item_id,
                             p_covers: String(parseQty(form.covers.value)), p_note: form.note.value.trim() || null });
            },
            onDone,
        });
    }

    // F1: a project's purchase line, to match — Receiving lists warehouse
    // lines only, and the phone sends the office here (Dacs Web → Stock →
    // Receiving). Pick the project and the line, then the same match form.
    async function openProjectMatch(onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        let lines = [];
        let picked = null;
        RA.modal({
            title: 'Match a project purchase line',
            sub: 'A purchase bought for a project, to count as a catalogue item — needed before its leftovers can be recorded.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Project<select class="att-input" name="folder"><option value="">Pick a project…</option>' +
                  options(placeOptions(ch).filter(o => o.value !== 'warehouse'), null) + '</select></label>' +
                '<label class="att-label">Purchase line<select class="att-input" name="line"><option value="">Pick the project first</option></select></label>' +
                '<p class="req-muted" data-line-note></p></div>',
            submitLabel: 'Next',
            errorMessage,
            onOpen: (form) => {
                const note = form.querySelector('[data-line-note]');
                form.folder.addEventListener('change', async () => {
                    lines = [];
                    note.textContent = '';
                    try { lines = await RA.rpc('stk_project_lines', { p_folder: form.folder.value }); } catch (e) { note.textContent = errorMessage(e); }
                    form.line.innerHTML = (lines.length ? '<option value="">Pick a purchase line…</option>' : '<option value="">No purchases for this project</option>') +
                        lines.map((l, i) => '<option value="' + i + '">' + esc(RA.formatDay(l.purchase_date) + ' · ' + l.item_name + ' · ' + qty(l.quantity) + ' ' + l.unit +
                            (needsMatch(l) ? ' · not matched yet' : '')) + '</option>').join('');
                });
                form.line.addEventListener('change', () => {
                    const l = lines[Number(form.line.value)];
                    note.textContent = !l ? '' : l.match ? 'Counts as ' + l.match.item_name + ' (' + l.match.item_unit + ') — you can change it while none of it is stock.'
                        : l.auto_item_id ? 'Already counts as its request\'s catalogue item.' : '';
                });
            },
            onSubmit: async (form) => {
                picked = lines[Number(form.line.value)] || null;
                if (!picked) throw new Error('NOT_FOUND');
            },
            onDone: () => openMatch(picked, onDone),
        });
    }

    function openReceive(line, onDone) {
        const send = sendOnce((opId, a) => RA.rpc('stk_receive', Object.assign({ p_op: opId }, a)));
        RA.modal({
            title: 'Received',
            sub: line.item_name + ' — awaiting ' + qty(line.awaiting) + ' ' + line.unit,
            body: '<div class="stk-form">' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">Quantity received (' + esc(line.unit) + ')<input class="att-input" name="qty" inputmode="decimal" value="' + esc(qty(line.awaiting)) + '"></label>' +
                  '<label class="att-label">Date<input class="att-input" type="date" name="on" value="' + esc(localDay()) + '" max="' + esc(localDay()) + '"></label>' +
                '</div>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Received',
            errorMessage,
            onSubmit: async (form) => {
                const q = parseQty(form.qty.value);
                if (q === null) throw new Error('BAD_QUANTITY');
                if (q > Number(line.awaiting)) throw new Error('MORE_THAN_AWAITED');
                await send({ p_purchase: line.purchase_id, p_line_no: line.line_no, p_qty: String(q), p_on: form.on.value, p_note: form.note.value.trim() });
            },
            onDone,
        });
    }

    function openNotDelivered(line, onDone) {
        const send = sendOnce((opId, a) => RA.rpc('stk_not_delivered', Object.assign({ p_op: opId }, a)));
        RA.modal({
            title: 'Will not be delivered',
            sub: line.item_name + ' — awaiting ' + qty(line.awaiting) + ' ' + line.unit + '. Any money back goes through a supplier refund or credit.',
            warn: true,
            body: '<div class="stk-form">' +
                '<label class="att-label">Quantity (' + esc(line.unit) + ')<input class="att-input" name="qty" inputmode="decimal" value="' + esc(qty(line.awaiting)) + '"></label>' +
                '<label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: 'Close it',
            errorMessage,
            onSubmit: async (form) => {
                const q = parseQty(form.qty.value);
                if (q === null) throw new Error('BAD_QUANTITY');
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send({ p_purchase: line.purchase_id, p_line_no: line.line_no, p_qty: String(q), p_reason: form.reason.value.trim() });
            },
            onDone,
        });
    }

    function openReverse(r, onDone) {
        const pending = r.status === 'pending';
        const send = sendOnce((opId, reason) => RA.rpc('stk_reverse', { p_op: opId, p_record: r.id, p_reason: reason }));
        RA.modal({
            title: pending ? 'Withdraw' : 'Reverse',
            sub: recordText(r) + (pending ? '' : '. The record stays, marked reversed; record the right one afterwards.'),
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: pending ? 'Withdraw' : 'Reverse',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }

    function openDecide(r, approve, onDone) {
        const send = sendOnce((opId, note) => RA.rpc('stk_decide', { p_op: opId, p_record: r.id, p_approve: approve, p_note: note }));
        RA.modal({
            title: approve ? 'Confirm' : 'Reject',
            sub: recordText(r) + (r.kind === 'count' ? ' (' + countDifference(r) + ', ' + (r.reason || '') + ')' : ''),
            warn: !approve,
            body: '<div class="stk-form"><label class="att-label">' + (approve ? 'Note (optional)' : 'Reason') + '<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: approve ? 'Confirm' : 'Reject',
            errorMessage,
            onSubmit: async (form) => {
                if (!approve && !form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.note.value.trim());
            },
            onDone,
        });
    }

    // ── The view ────────────────────────────────────────────────────

    // Office redesign v5: tabs with counts, cards, one item / receiving line /
    // record in the frame's pop-up. Waiting for owner keeps its own content
    // (the records and, for the main owner, the cost-move cards).
    const TAB_HELP = {
        stock: 'One card per catalogue item, and where it is.',
        receiving: 'Warehouse purchases awaiting delivery or a match.',
        history: 'Every stock record.',
    };
    const TONE = { done: 'done', working: 'gold', abandoned: 'red', pc: 'check', pm: 'pm', none: 'none', hidden: 'none' };

    function lineKey(l) { return l.purchase_id + ':' + l.line_no; }

    // A receiving line's one next step: match it first, then receive it.
    function lineStep(l) {
        if (!l.match) return { act: 'match', label: 'Match…', text: 'Match this purchase line to a catalogue item first.' };
        if (Number(l.awaiting) > 0) return { act: 'receive', label: 'Received…', text: 'This warehouse purchase is awaiting delivery.' };
        return null;
    }
    // A card's button starts only the step it showed.
    function sameKey(want, have) { return !!(want && have && want.act === have.act); }

    function itemRow(i) {
        return { id: 'i:' + i.item_id, title: i.name + (i.spec ? ' · ' + i.spec : ''),
                 sub: i.places.map(p => p.name + ': ' + qty(p.quantity)).join(' · '), right: qty(i.total) + ' ' + i.unit };
    }
    function lineRow(l) {
        const step = lineStep(l);
        return { id: 'l:' + lineKey(l), title: l.item_name,
                 sub: qty(l.quantity) + ' ' + l.unit + ' · bought ' + RA.formatDay(l.purchase_date) + ' by ' + l.bought_by_name,
                 meta: 'Received ' + qty(l.received) + (Number(l.not_delivered) > 0 ? ' · not delivered ' + qty(l.not_delivered) : '') + ' · awaiting ' + qty(l.awaiting),
                 right: qty(l.awaiting) + ' ' + l.unit,
                 pill: l.match ? { text: 'Counts as ' + l.match.item_name, tone: 'done' } : { text: 'Not matched yet', tone: 'gold' },
                 nextLabel: step ? step.label : '' };
    }
    function recRow(r) {
        const st = recordState(r);
        return { id: 'r:' + r.id, title: KIND_LABEL[r.kind] || r.kind, sub: recordText(r),
                 meta: r.recorded_by_name + ' · ' + RA.formatDay(r.on),
                 pill: st ? { text: st[0], tone: TONE[st[1]] || 'none' } : null, dim: !!r.reversed };
    }

    function recordRow(r, m) {
        const st = recordState(r);
        const req = requestText(r);
        return '<div class="stk-rec' + (r.reversed ? ' is-reversed' : '') + '" data-record="' + esc(r.id) + '">' +
            '<div class="stk-rec-main"><strong>' + esc(KIND_LABEL[r.kind] || r.kind) + '</strong> ' + (st ? pill(st[0], st[1]) : '') +
              '<div>' + esc(recordText(r)) + '</div>' +
              (req ? '<div class="req-muted">' + esc(req) + '</div>' : '') +
              (r.kind === 'count' && r.status !== 'done' || (r.kind === 'count' && Number(r.quantity) !== Number(r.book_quantity))
                ? '<div class="req-muted">Difference ' + esc(countDifference(r)) + (r.reason ? ' · ' + esc(r.reason) : '') + '</div>' : '') +
              (r.reason && r.kind === 'not_delivered' ? '<div class="req-muted">' + esc(r.reason) + '</div>' : '') +
              (r.note ? '<div class="req-muted">Note: ' + esc(r.note) + '</div>' : '') +
              '<div class="req-muted">' + esc(r.recorded_by_name) + ' · ' + esc(RA.formatDay(r.on)) +
                (r.decided_by_name ? ' · ' + esc(r.status === 'rejected' ? 'rejected' : r.status === 'withdrawn' ? 'withdrawn' : 'confirmed') + ' by ' + esc(r.decided_by_name) +
                  (r.decision_note ? ': ' + esc(r.decision_note) : '') : '') +
                (r.reversed ? ' · reversed by ' + esc(r.reversed_by_name) + ': ' + esc(r.reverse_reason) : '') + '</div>' +
              (r.costs || []).map(c => costLine(c, r, m)).join('') +
            '</div>' +
            '<div class="stk-rec-acts">' +
              (r.kind === 'issue' && Number(r.returnable) > 0 ? '<button type="button" class="att-btn att-btn--sm" data-rec-act="return">Return…</button>' : '') +
              (r.status === 'pending' && m.isMainOwner ? '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-rec-act="confirm">Confirm</button>' +
                '<button type="button" class="att-btn att-btn--sm" data-rec-act="reject">Reject</button>' : '') +
              (canReverse(r, m) ? '<button type="button" class="att-btn att-btn--sm" data-rec-act="reverse">' + (r.status === 'pending' ? 'Withdraw' : 'Reverse') + '</button>' : '') +
            '</div></div>';
    }

    // One cost move under its record: its state, and (owner accounts) its
    // value from js/stock-cost-admin.js; the buttons open that file's forms.
    function costLine(c, r, m) {
        const st = costState(c);
        const SC = root.StockCostAdmin;
        const v = SC ? SC.valueText(c) : '';
        const acts = SC ? costActions(c, m, r.costs, m.canRecord) : [];
        const label = { approve: 'Approve…', reject: 'Reject…', reverse: 'Reverse cost…', resubmit: 'Ask again…' };
        const why = c.reversed ? c.reverse_reason : c.status === 'pending' ? c.note : c.decision_note;
        return '<div class="stk-cost" data-cost="' + esc(c.id) + '">' + pill(st[0], st[1]) + ' <span>' + esc(costText(c, r.item_unit)) + '</span>' +
            (v ? ' <strong>' + esc(v) + '</strong>' : '') +
            (why ? ' <span class="req-muted">· ' + esc(why) + '</span>' : '') +
            (acts.length ? '<span class="stk-cost-acts">' + acts.map(a => '<button type="button" class="att-btn att-btn--sm' +
                (a === 'approve' ? ' att-btn--primary' : '') + '" data-cost-act="' + a + '">' + label[a] + '</button>').join('') + '</span>' : '') +
            '</div>';
    }

    function itemCard(i) {
        return '<div class="att-card stk-item" data-item="' + esc(i.item_id) + '"><div class="att-card-body">' +
            '<div class="stk-item-head"><strong>' + esc(i.name) + '</strong>' + (i.spec ? ' <span class="req-muted">' + esc(i.spec) + '</span>' : '') +
              '<span class="stk-item-total">' + esc(qty(i.total)) + ' ' + esc(i.unit) + '</span></div>' +
            '<div class="stk-places">' + i.places.map(p => '<span class="stk-place' + (p.kind === 'warehouse' ? ' is-warehouse' : '') + '">' +
              esc(p.name) + ': <strong>' + esc(qty(p.quantity)) + '</strong></span>').join('') + '</div>' +
            '</div></div>';
    }

    function lineCard(l) {
        const match = l.match ? 'Counts as ' + l.match.item_name + (l.match.auto ? '' : ' (' + qty(l.match.covers) + ' ' + l.match.item_unit + ' for ' + qty(l.match.per) + ' ' + l.unit + ')')
                              : 'Not matched yet';
        return '<div class="att-card stk-line"><div class="att-card-body">' +
            '<div><strong>' + esc(l.item_name) + '</strong> · ' + esc(qty(l.quantity)) + ' ' + esc(l.unit) +
              ' <span class="req-muted">bought ' + esc(RA.formatDay(l.purchase_date)) + ' by ' + esc(l.bought_by_name) + '</span></div>' +
            '<div class="req-muted">Received ' + esc(qty(l.received)) + (Number(l.not_delivered) > 0 ? ' · not delivered ' + esc(qty(l.not_delivered)) : '') +
              ' · <strong>awaiting ' + esc(qty(l.awaiting)) + '</strong></div>' +
            '<div>' + (l.match ? pill(match, 'done') : pill(match, 'working')) + '</div>' +
            '<div class="stk-line-acts" data-line="' + esc(l.purchase_id + ':' + l.line_no) + '">' +
              (Number(l.awaiting) > 0 ? '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-line-act="receive">Received…</button>' +
                '<button type="button" class="att-btn att-btn--sm" data-line-act="nd">Not delivered…</button>' : '') +
              '<button type="button" class="att-btn att-btn--sm" data-line-act="match">' + (l.match ? 'Change match…' : 'Match…') + '</button>' +
            '</div></div></div>';
    }

    // One catalogue item in the pop-up: its lots, Issue / move, Count, its records.
    async function renderItem(panel, itemId, reload, nextLabel) {
        const sid = panel.dataset.svId;
        panel.innerHTML = '<div class="sv-panel-empty">Loading…</div>';
        let it;
        try { it = await RA.rpc('stk_item', { p_item: itemId }); } catch (e) { if (panel.isConnected && panel.dataset.svId === sid) SV.error(panel, errorMessage(e)); return; }
        if (!panel.isConnected || panel.dataset.svId !== sid) return;   // closed or moved on while this loaded
        const m = me();
        const body = SV.page(panel, { kicker: 'Stock item', title: itemLabel(it), nextLabel: nextLabel });
        body.classList.add('stk-tab', 'req-detail');
        body.innerHTML =
            '<div class="stk-lots">' + (it.lots.length ? it.lots.map(l =>
                '<div class="stk-lot"><div><strong>' + esc(l.untraced ? 'Untraced (old stock)' : (l.line_item || 'Purchase')) + '</strong> · ' +
                  esc(l.untraced ? 'counted ' : 'bought ') + esc(RA.formatDay(l.since)) +
                  (l.cost_folder_name ? ' · ' + esc(l.cost_folder_name) + '\'s leftovers' : '') + '</div>' +
                  '<div class="req-muted">' + (l.places.length ? l.places.map(p => esc(p.name) + ': ' + esc(qty(p.quantity))).join(' · ') : 'Nothing left') + '</div>' +
                  (l.layers && l.layers.length ? '<div class="req-muted">' + layerText(l.layers) + '</div>' : '') + '</div>').join('')
              : '<div class="att-empty">No lots yet.</div>') + '</div>' +
            '<div class="stk-actions">' +
              '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-item-act="move">Issue / move</button>' +
              '<button type="button" class="att-btn att-btn--sm" data-item-act="count">Count</button></div>' +
            '<h3 class="stk-h">History</h3>' +
            '<div class="stk-recs">' + (it.records.map(r => recordRow(r, m)).join('') || '<div class="att-empty">Nothing yet.</div>') + '</div>';
        body.querySelector('[data-item-act="move"]').addEventListener('click', () => openMove({ itemId: it.item_id }, reload));
        body.querySelector('[data-item-act="count"]').addEventListener('click', () => openCount({ itemId: it.item_id }, reload));
        wireRecords(body, it.records, reload);
    }

    function wireRecords(scope, records, reload) {
        scope.querySelectorAll('[data-rec-act]').forEach(b => b.addEventListener('click', () => {
            const id = b.closest('[data-record]').dataset.record;
            const r = records.find(x => x.id === id);
            if (!r) return;
            const act = b.dataset.recAct;
            if (act === 'reverse') return openReverse(r, reload);
            if (act === 'confirm') return openDecide(r, true, reload);
            if (act === 'reject') return openDecide(r, false, reload);
            if (act === 'return') return openMove({ itemId: r.item_id, returnsRecord: r.id, returnFrom: r.to_name, quantity: r.returnable }, reload);
        }));
        scope.querySelectorAll('[data-cost-act]').forEach(b => b.addEventListener('click', () => {
            const r = records.find(x => x.id === b.closest('[data-record]').dataset.record);
            const c = r && (r.costs || []).find(x => x.id === b.closest('[data-cost]').dataset.cost);
            const SC = root.StockCostAdmin;
            if (!c || !SC) return;
            const act = b.dataset.costAct;
            if (act === 'approve') return SC.openDecide(c, true, reload, r.item_unit);
            if (act === 'reject') return SC.openDecide(c, false, reload, r.item_unit);
            if (act === 'reverse') return SC.openReverse(c, reload, r.item_unit);
            if (act === 'resubmit') return SC.openResubmit(c, reload, r.item_unit);
        }));
    }

    async function render(host, opts) {
        if (!host.querySelector('.sv')) host.innerHTML = '<div class="sv"><div class="sv-empty">Loading…</div></div>';
        let status;
        try { status = await RA.rpc('stk_status'); } catch (e) { RA.fail(host, e); return; }
        cache.status = status;
        root.currentStockMainOwner = !!(status && status.is_main_owner);
        if (!status || !status.enabled) return renderOff(host, status);
        const reload = () => render(host, { refreshPanel: true });
        cache.choices = null;
        let ov;
        try { ov = await RA.rpc('stk_overview'); } catch (e) { RA.fail(host, e); return; }
        const m = me();
        if (root.NavCounts && m.isMainOwner) root.NavCounts.set('stock', ov.pending.length);
        const draw = (o) => {
            const text = String(ui.text || '').trim().toLowerCase();
            const hit = r => !text || (r.title + ' ' + (r.sub || '') + ' ' + (r.meta || '')).toLowerCase().includes(text);
            const rows = ui.tab === 'stock' ? ov.items.map(itemRow) : ui.tab === 'receiving' ? ov.awaiting.map(lineRow)
                : ui.tab === 'history' ? ov.recent.map(recRow) : [];
            const shown = rows.filter(hit);
            if (o && o.leaveSelection && ui.sel && !shown.some(r => r.id === ui.sel)) ui.sel = null;
            const empty = {
                stock: 'No stock yet. Receive a warehouse purchase, record leftovers or opening stock.',
                receiving: 'No warehouse purchase is awaiting delivery or a match.',
                history: 'No stock records yet.',
            }[ui.tab];
            root.SplitView.render(host, {
                key: 'reqStock',
                title: 'Stock',
                sub: 'Where goods are, in catalogue units. When goods reach someone else\'s project, the main owner approves where their cost goes.',
                primary: { label: 'Issue / move', onClick: () => openMove({}, reload) },
                more: [
                    { label: 'Record leftovers', onClick: () => openLeftover(reload) },
                    { label: 'Count', onClick: () => openCount({}, reload) },
                    { label: 'Opening stock', onClick: () => openOpening(reload) },
                ],
                // Receiving keeps its own button: the phone sends the office here
                // (Dacs Web → Stock → Receiving) to match a project purchase line.
                toolbar: ui.tab === 'receiving' ? '<button type="button" class="att-btn" data-project-match>Match a project purchase line…</button>' : '',
                onToolbar: el => { if (el.querySelector('[data-project-match]')) el.querySelector('[data-project-match]').addEventListener('click', () => openProjectMatch(reload)); },
                lede: ui.tab === 'stock' && ov.pending.length ? ov.pending.length + ' waiting for the owner.' : '',
                tabs: [['stock', 'Stock', ov.items.length], ['receiving', 'Receiving', ov.awaiting.length],
                       ['pending', 'Waiting for owner', ov.pending.length], ['history', 'History', ov.recent.length]]
                    .map(([id, label, count]) => ({ id, label, count, needs: id === 'pending' && m.isMainOwner, help: TAB_HELP[id] || '' })),
                tab: ui.tab,
                onTab: id => { ui.tab = id; ui.sel = null; ui.text = ''; draw(); },
                search: ui.tab === 'pending' ? false : { placeholder: 'Search an item…', value: ui.text, onInput: t => { ui.text = t; draw({ leaveSelection: true }); } },
                showing: text ? 'Showing ' + shown.length + ' of ' + rows.length : '',
                groups: [{ title: '', rows: shown }],
                empty: text ? 'Nothing matches the search.' : empty,
                custom: ui.tab === 'pending',
                onCustom: el => {
                    el.classList.add('stk-tab', 'req-detail');
                    el.innerHTML = (ov.pending.length ? '<div class="stk-recs">' + ov.pending.map(r => recordRow(r, m)).join('') + '</div>'
                        : '<div class="att-empty">No count or opening stock is waiting for the owner.</div>') +
                        (m.isMainOwner ? '<div data-costs></div>'
                            : '<p class="req-muted">Only the main owner confirms counts and opening stock, and approves where moved goods\' cost goes.</p>');
                    wireRecords(el, ov.pending, reload);
                    // 2C: the main owner's pending cost moves, the same cards as Purchasing → Owner approvals.
                    if (m.isMainOwner && root.StockCostAdmin) root.StockCostAdmin.renderApprovals(el.querySelector('[data-costs]'));
                },
                selectedId: ui.sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel, so) => {
                    ui.sel = id;
                    const kind = id.slice(0, 2), key = id.slice(2);
                    if (kind === 'i:') return renderItem(panel, key, reload, 'Next item');
                    if (kind === 'l:') {
                        const l = ov.awaiting.find(x => lineKey(x) === key);
                        if (!l) return SV.error(panel, 'This purchase line is no longer awaiting delivery or a match.');
                        const step = lineStep(l);
                        const body = SV.page(panel, {
                            kicker: 'Receiving', title: l.item_name,
                            sub: qty(l.quantity) + ' ' + l.unit + ' · bought ' + RA.formatDay(l.purchase_date) + ' by ' + l.bought_by_name,
                            step: step ? SV.nextStep(step.text, '<button type="button" class="att-btn att-btn--primary" data-line="' + esc(key) +
                                '" data-line-act="' + esc(step.act) + '">' + esc(step.label) + '</button>') : '',
                            nextLabel: 'Next line',
                        });
                        body.classList.add('stk-tab', 'req-detail');
                        body.innerHTML = lineCard(l);
                        // One handler per panel (assigned): a fresh panel per item.
                        panel.onclick = e => {
                            const btn = e.target.closest('[data-line-act]');
                            if (!btn) return;
                            if (btn.dataset.lineAct === 'receive') return openReceive(l, reload);
                            if (btn.dataset.lineAct === 'nd') return openNotDelivered(l, reload);
                            return openMatch(l, reload);
                        };
                        // The card's button: only the step it showed.
                        const want = so && so.start ? lineStep(l) : null;
                        const go = panel.querySelector('.sv-step [data-line-act]');
                        if (want && go && sameKey(want, { act: go.dataset.lineAct })) go.click();
                        RA.icons();
                        return;
                    }
                    const r = ov.recent.find(x => x.id === key) || ov.pending.find(x => x.id === key);
                    if (!r) return SV.error(panel, 'This stock record is no longer listed.');
                    const st = recordState(r);
                    const body = SV.page(panel, { kicker: 'Stock record', title: KIND_LABEL[r.kind] || r.kind,
                        pills: st ? [{ text: st[0], tone: TONE[st[1]] || 'none' }] : [], sub: recordText(r), nextLabel: 'Next record' });
                    body.classList.add('stk-tab', 'req-detail');
                    body.innerHTML = '<div class="stk-recs">' + recordRow(r, m) + '</div>';
                    wireRecords(body, [r], reload);
                    RA.icons();
                },
                onClose: () => { ui.sel = null; },
            });
            // 2B-b: the pilot's way back (Q30) — the main owner only, typed; at the bottom.
            host.querySelector('.sv').insertAdjacentHTML('beforeend',
                (status.is_main_owner ? '<div class="stk-switch-off"><button type="button" class="att-btn att-btn--sm att-btn--ghost" data-switch-off>Switch stock off…</button></div>' : ''));
            const off = host.querySelector('[data-switch-off]');
            if (off) off.addEventListener('click', () => openSwitchOff());
            RA.icons();
        };
        draw(opts);
    }

    // Switch stock off again (2B-b): for a pilot that failed before launch.
    // Records already made stay as they are; nothing is undone or deleted.
    function openSwitchOff() {
        return RA.modal({
            title: 'Switch stock off',
            sub: 'Type OFF to confirm. Only if the pilot failed — stock is not launched yet.',
            warn: true,
            body: '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
                'Every stock record stays as it is — nothing is undone or deleted. Recording stops (web and phone), the Stock tab goes ' +
                'for everyone but you, and the old "Add to inventory" tick works again.</div></div>' +
                '<div class="stk-form"><label class="att-label">Type OFF<input class="att-input" name="word" autocomplete="off"></label></div>',
            submitLabel: 'Switch off',
            errorMessage,
            onSubmit: async (form) => {
                if (form.word.value.trim() !== 'OFF') throw new Error('Type OFF to confirm.');
                await RA.rpc('stk_set_enabled', { p_on: false });
                root.currentStockOn = false;
            },
            onDone: () => root.location.reload(),
        });
    }

    // Before launch: nobody sees the tab except the main owner, who sees the switch.
    function renderOff(host, status) {
        if (!status || !status.is_main_owner) {
            host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' +
                esc(ERRORS.STOCK_OFF) + '</div></div></div>';
            RA.icons();
            return;
        }
        root.SplitView.render(host, { key: 'reqStock', title: 'Stock', sub: 'Not switched on yet.', search: false, tabs: [],
            off: { title: 'Not switched on yet.',
                   text: 'Switch stock on only at launch — after owner-confirmed cost moves (2C) and the phone (2B-b) are ready. ' +
                         'Once it is on, the old "Add to inventory" tick stops working, and staff start recording stock here.',
                   button: { label: 'Switch stock on…', onClick: () => switchOn() } } });
        RA.icons();
    }
    function switchOn() {
        return RA.modal({
            title: 'Switch stock on',
            sub: 'Type STOCK to confirm. Do this only at launch.',
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Type STOCK<input class="att-input" name="word" autocomplete="off"></label></div>',
            submitLabel: 'Switch on',
            errorMessage,
            onSubmit: async (form) => {
                if (form.word.value.trim() !== 'STOCK') throw new Error('Type STOCK to confirm.');
                await RA.rpc('stk_set_enabled', { p_on: true });
                root.currentStockOn = true;
            },
            onDone: () => root.location.reload(),
        });
    }

    // The shopping list's "Issue from stock": the issue form for one request line.
    function openIssue(line, onDone) {
        return openMove({ itemId: line.catalog_item_id, from: 'warehouse', to: line.work_id, requestLineId: line.line_id,
                          quantity: Math.min(Number(line.in_warehouse) || 0, Number(line.still_to_buy) || 0), lockItem: true }, onDone);
    }

    root.StockAdmin = Object.assign({}, pure, { openIssue, render });
    RA.views.reqStock = render;

    // D5: the red count on Stock — counts and opening stock waiting for the
    // owner, for the main owner (who alone confirms them); nobody else counts it.
    if (root.NavCounts) {
        root.NavCounts.register('stock', async () => {
            const st = await RA.rpc('stk_status');
            if (!st || !st.enabled || !st.is_main_owner) return null;
            const ov = await RA.rpc('stk_overview');
            return ((ov && ov.pending) || []).length;
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
