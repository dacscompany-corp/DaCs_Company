// ════════════════════════════════════════════════════════════════════
// Requests → one request (WorkMate, 0086). Owner + staff.
//
// Office redesign v5: the request opens in the frame's pop-up
// (RA.renderRequestPanel, called by js/requests-admin-queue.js), with a
// "What to do now" box (RA.requestNextStep) whose one button is the same
// action as the button inside the request; its forms open in that same
// pop-up (SplitView.form) and every save ends with a short toast.
//
// Every office action on a request: mark portions arranged, move an
// unarranged portion to another weekly batch, resolve a worker's
// reduction of arranged quantity, change or cancel an item (with a
// reason), resolve an offline-edit conflict, match an unlisted item to
// the catalogue. Each is one 0086 RPC; the server re-checks every rule,
// so this screen only decides which buttons to offer.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const SV = root.SplitView;
    const esc = RA.esc;
    const PHOTO_BUCKET = 'request-photos';
    const DAY_MS = 24 * 60 * 60 * 1000;
    const panelLoads = SV ? SV.seq() : { next() { return 0; }, isLatest() { return true; } };

    function kindLabel(kind) { return kind === 'tool' ? 'Tool' : 'Material'; }

    // One row per weekly batch the item is split across: which batch (with
    // its buy and deliver days), how much, whether it is arranged, and
    // what the office can do about it. The label above each value takes
    // the place of a column header.
    function portionList(line) {
        const open = line.status === 'open';
        return (line.portions || []).map(p => {
            const pending = Number(p.pending_reduction) > 0;
            const actions = [];
            if (open && !p.arranged) {
                actions.push('<button class="att-btn att-btn--primary" type="button" data-act="arrange" data-portion="' + esc(p.id) + '">Mark arranged</button>');
                actions.push('<button class="att-btn" type="button" data-act="move" data-portion="' + esc(p.id) + '" data-line="' + esc(line.id) + '">Move…</button>');
            }
            if (p.arranged && !pending) {
                actions.push('<button class="att-btn" type="button" data-act="unarrange" data-portion="' + esc(p.id) + '">Undo arranged</button>');
            }
            if (pending) {
                actions.push('<button class="att-btn att-btn--warn" type="button" data-act="reduction" data-portion="' + esc(p.id) + '" data-line="' + esc(line.id) + '">Resolve reduction…</button>');
            }
            return '<div class="req-portion">' +
                '<div class="req-pcell">' +
                  '<div class="req-plabel">Weekly batch</div>' +
                  '<div class="req-pval"><strong>' + esc(RA.cutoffLabel(p.cutoff_at)) + '</strong></div>' +
                  '<div class="req-steps"><span class="req-step"><em>Buy</em><strong>' + esc(RA.formatDay(p.purchase_on)) + '</strong></span>' +
                    '<span class="req-arrow">→</span>' +
                    '<span class="req-step"><em>Deliver</em><strong>' + esc(RA.formatDay(p.delivery_on)) + '</strong></span></div>' +
                '</div>' +
                '<div class="req-pcell">' +
                  '<div class="req-plabel">Quantity</div>' +
                  '<div class="req-pval req-pqty">' + esc(RA.formatQty(p.quantity)) + ' ' + esc(line.unit) + '</div>' +
                '</div>' +
                '<div class="req-pcell">' +
                  '<div class="req-plabel">Arranged</div>' +
                  (p.arranged
                    ? '<div><span class="att-pill att-pill--done">Arranged</span></div><div class="req-muted">' +
                      esc(p.arranged_by_name || '') + ' · ' + esc(RA.formatManila(p.arranged_at)) + '</div>'
                    : '<div><span class="att-pill att-pill--none">Not yet</span></div>') +
                  (pending ? '<div class="req-red">Reduction −' + esc(RA.formatQty(p.pending_reduction)) + ' ' + esc(line.unit) + '</div>' : '') +
                '</div>' +
                '<div class="req-pcell req-pcell--act"><div class="req-actions">' + actions.join('') + '</div></div>' +
                '</div>';
        }).join('');
    }

    function conflictBlocks(line) {
        return (line.open_conflicts || []).map(k =>
            '<div class="att-info att-info--warn"><i data-lucide="git-compare"></i><div>' +
              '<strong>Offline edit needs a decision.</strong> ' + esc(k.proposed_by_name) + ' changed this to <strong>' +
              esc(RA.formatQty(k.proposed_quantity)) + ' ' + esc(line.unit) + '</strong> on a phone that had not seen the change to ' +
              esc(RA.formatQty(k.current_quantity)) + ' (' + esc(RA.formatManila(k.created_at)) + '). Nothing was overwritten.' +
              '<div class="req-actions" style="margin-top:8px">' +
                '<button class="att-btn att-btn--primary" type="button" data-act="conflict" data-conflict="' + esc(k.id) + '" data-apply="1"' +
                  (line.status === 'open' && Number(k.proposed_quantity) > 0 ? '' : ' disabled') + '>Apply ' +
                  esc(RA.formatQty(k.proposed_quantity)) + '</button>' +
                '<button class="att-btn" type="button" data-act="conflict" data-conflict="' + esc(k.id) + '" data-apply="0">Keep ' +
                  esc(RA.formatQty(line.needed)) + '</button>' +
              '</div>' +
            '</div></div>').join('');
    }

    function lineCard(line, photos) {
        const st = RA.lineState(line);
        const open = line.status === 'open';
        const catalog = line.catalog_item_id
            ? esc(line.catalog_name) + (line.catalog_spec ? ' · ' + esc(line.catalog_spec) : '') + ' (' + esc(line.catalog_unit) + ')'
            : '<span class="req-muted">Not in the catalogue</span>';
        const linePhotos = photos.filter(ph => ph.line_id === line.id);
        const fact = (label, value, cls) =>
            '<div><dt>' + label + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + value + '</dd></div>';
        return '<section class="req-item' + (st === 'cancelled' ? ' is-cancelled' : '') + '">' +
            '<header class="req-item-head">' +
              '<span class="req-item-no">' + (line.position + 1) + '</span>' +
              '<div class="req-item-title">' +
                '<h3>' + esc(line.description) + '</h3>' +
                '<div class="req-item-meta">' + esc(kindLabel(line.kind)) + (line.spec ? ' · ' + esc(line.spec) : '') + ' · ' + esc(line.unit) +
                  (line.category ? ' · ' + esc(line.category) : '') + '</div>' +
              '</div>' +
              '<div class="req-item-tags">' +
                (line.urgent ? '<span class="req-urgent">URGENT · by ' + esc(RA.formatDay(line.needed_by)) + '</span>' : '') +
                '<span class="att-pill ' + RA.STATE_PILL[st] + '">' + esc(RA.STATE_LABEL[st]) + '</span>' +
              '</div>' +
            '</header>' +
            '<dl class="req-facts">' +
              fact('Still needed', esc(RA.formatQty(line.needed)) + ' ' + esc(line.unit), 'req-fact-big') +
              fact('Catalogue', catalog + ' <button class="att-link" type="button" data-act="match" data-line="' + esc(line.id) + '">' +
                (line.catalog_item_id ? 'Change' : 'Match') + '</button>') +
              (line.ref_label ? fact('Requested again from', esc(line.ref_label)) : '') +
              (line.intended_member_name ? fact('For', esc(line.intended_member_name)) : '') +
              (line.urgent ? fact('Why urgent', esc(line.urgent_reason)) : '') +
              (line.notes ? fact('Notes', esc(line.notes)) : '') +
            '</dl>' +
            conflictBlocks(line) +
            ((line.portions || []).length ? '<div class="req-portions">' + portionList(line) + '</div>' : '') +
            (linePhotos.length ? '<div class="req-item-photos"><div class="req-photos">' + linePhotos.map(photoImg).join('') + '</div></div>' : '') +
            (open ? '<footer class="req-item-foot">' +
                '<button class="att-btn" type="button" data-act="qty" data-line="' + esc(line.id) + '">Change quantity…</button>' +
                '<button class="att-btn att-btn--warn" type="button" data-act="cancel" data-line="' + esc(line.id) + '">Cancel item…</button>' +
              '</footer>' : '') +
            '</section>';
    }

    function photoImg(ph) {
        return '<img class="req-photo" alt="Request photo" data-photo-path="' + esc(ph.path) + '">';
    }

    async function loadPhotos(scope) {
        const imgs = scope.querySelectorAll('img[data-photo-path]');
        for (const img of imgs) {
            const { data, error } = await root.sbClient.storage.from(PHOTO_BUCKET).createSignedUrl(img.dataset.photoPath, 600);
            if (error || !data) { img.alt = 'Photo unavailable'; continue; }
            img.src = data.signedUrl;
            img.addEventListener('click', () => root.open(data.signedUrl, '_blank', 'noopener'));
        }
    }

    function historySection(req) {
        const byLine = {};
        (req.lines || []).forEach(l => { byLine[l.id] = (l.position + 1) + '. ' + l.description; });
        const events = (req.events || []).slice().reverse();
        if (!events.length) return SV.section('History', '<div class="sv-empty-inline">No history yet.</div>');
        return SV.history(events.map(e => ({
            when: RA.formatManila(e.created_at),
            html: '<strong>' + esc(e.actor_name) + '</strong> — ' + esc(RA.eventText(e)) +
                (e.line_id && byLine[e.line_id] ? ' <span class="req-muted">(' + esc(byLine[e.line_id]) + ')</span>' : ''),
        })), 6);
    }

    // ── Forms, in the panel ─────────────────────────────────────────
    // ctx.back(): show the request again; ctx.done(): reload queue + panel;
    // ctx.stillShowing(): the panel still shows this request.

    function findLine(req, id) { return (req.lines || []).find(l => l.id === id); }
    function findPortion(req, id) {
        for (const l of req.lines || []) for (const p of l.portions || []) if (p.id === id) return { line: l, portion: p };
        return null;
    }

    function qtyForm(panel, line, ctx) {
        root.SplitView.form(panel, {
            kicker: 'Request',
            title: 'Change quantity',
            sub: line.description + ' · now ' + RA.formatQty(line.needed) + ' ' + line.unit,
            body:
                '<div class="att-field att-span"><label for="reqQty">New quantity (' + esc(line.unit) + ')</label>' +
                  '<input class="att-input" id="reqQty" name="qty" inputmode="decimal" value="' + esc(String(line.needed)) + '"></div>' +
                '<div class="att-field att-span"><label for="reqReason">Reason</label>' +
                  '<input class="att-input" id="reqReason" name="reason" maxlength="200" placeholder="e.g. Engineer recounted on site"></div>' +
                '<div class="att-hint att-span">Lowering below what is already arranged does not erase it: the difference waits as a reduction for you to resolve.</div>',
            submitLabel: 'Change quantity',
            doneText: 'Quantity changed',
            errorMessage: RA.errorMessage,
            onSubmit: async (form) => {
                const q = RA.parseQty(form.qty.value);
                if (q === null) throw new Error('BAD_QUANTITY');
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_change_quantity', { p_line: line.id, p_quantity: q, p_reason: form.reason.value.trim() });
            },
            onCancel: ctx.back,
            onDone: ctx.done,
        });
    }

    function cancelForm(panel, line, ctx) {
        const arranged = (line.portions || []).some(p => p.arranged);
        root.SplitView.form(panel, {
            kicker: 'Request',
            title: 'Cancel this item',
            sub: line.description + ' · ' + RA.formatQty(line.needed) + ' ' + line.unit,
            body:
                (arranged ? '<div class="att-info att-info--warn att-span"><i data-lucide="alert-triangle"></i><div>Part of this is already arranged. ' +
                  'That quantity will wait as a reduction for you to resolve.</div></div>' : '') +
                '<div class="att-field att-span"><label for="reqReason">Reason</label>' +
                  '<input class="att-input" id="reqReason" name="reason" maxlength="200" placeholder="e.g. Wrong size; replaced by item 3"></div>',
            submitLabel: 'Cancel item',
            doneText: 'Item cancelled',
            warn: true,
            errorMessage: RA.errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_cancel_line', { p_line: line.id, p_reason: form.reason.value.trim() });
            },
            onCancel: ctx.back,
            onDone: ctx.done,
        });
    }

    function reductionForm(panel, line, portion, ctx) {
        root.SplitView.form(panel, {
            kicker: 'Request',
            title: 'Resolve the reduction',
            sub: line.description + ' · ' + RA.cutoffLabel(portion.cutoff_at),
            body:
                '<div class="att-info att-span"><i data-lucide="info"></i><div>' +
                  esc(RA.formatQty(portion.quantity)) + ' ' + esc(line.unit) + ' was arranged; the request now needs ' +
                  esc(RA.formatQty(portion.pending_reduction)) + ' ' + esc(line.unit) + ' less. What happened to the order?</div></div>' +
                '<label class="req-toggle att-span"><input type="radio" name="outcome" value="order_reduced" checked> ' +
                  'The supplier order was reduced</label>' +
                '<label class="req-toggle att-span"><input type="radio" name="outcome" value="kept_as_surplus"> ' +
                  'Kept the full order — the extra is surplus</label>' +
                '<div class="att-field att-span"><label for="reqNote">Note <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqNote" name="note" maxlength="200"></div>',
            submitLabel: 'Resolve',
            doneText: 'Reduction resolved',
            errorMessage: RA.errorMessage,
            onSubmit: async (form) => {
                await RA.rpc('pr_office_resolve_reduction', { p_portion: portion.id, p_outcome: form.outcome.value, p_note: form.note.value.trim() || null });
            },
            onCancel: ctx.back,
            onDone: ctx.done,
        });
    }

    async function moveForm(panel, line, portion, ctx) {
        let batches;
        try { batches = await RA.rpc('pr_office_batches'); } catch (e) { alert(RA.errorMessage(e)); return; }
        // Another request may have been opened while this waited.
        if (!ctx.stillShowing()) return;
        const targets = (batches || []).filter(b => b.id !== portion.batch_id);
        root.SplitView.form(panel, {
            kicker: 'Request',
            title: 'Move to another weekly batch',
            sub: line.description + ' · ' + RA.formatQty(portion.quantity) + ' ' + line.unit,
            body:
                '<div class="att-field att-span"><label for="reqBatch">Weekly batch</label>' +
                  '<select class="att-input" id="reqBatch" name="batch">' +
                    targets.map(b => '<option value="' + esc(b.id) + '">' + esc(RA.batchLabel(b)) + '</option>').join('') +
                  '</select></div>' +
                '<div class="att-field att-span"><label for="reqNote">Note <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqNote" name="note" maxlength="200" placeholder="e.g. Supplier can deliver earlier"></div>',
            submitLabel: 'Move',
            doneText: 'Moved to another weekly batch',
            errorMessage: RA.errorMessage,
            onSubmit: async (form) => {
                await RA.rpc('pr_office_move_portion', { p_portion: portion.id, p_batch: form.batch.value, p_note: form.note.value.trim() || null });
            },
            onCancel: ctx.back,
            onDone: ctx.done,
        });
    }

    function conflictForm(panel, line, conflictId, apply, ctx) {
        const k = (line.open_conflicts || []).find(x => x.id === conflictId);
        if (!k) return;
        root.SplitView.form(panel, {
            kicker: 'Request',
            title: apply ? 'Apply the offline edit' : 'Keep the current quantity',
            sub: line.description,
            body:
                '<div class="att-info att-span"><i data-lucide="info"></i><div>' + (apply
                    ? 'The item will need <strong>' + esc(RA.formatQty(k.proposed_quantity)) + ' ' + esc(line.unit) + '</strong>.'
                    : 'The item stays at <strong>' + esc(RA.formatQty(line.needed)) + ' ' + esc(line.unit) + '</strong>; ' +
                      esc(k.proposed_by_name) + '\'s edit is kept in the history only.') + '</div></div>' +
                '<div class="att-field att-span"><label for="reqNote">Note <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqNote" name="note" maxlength="200"></div>',
            submitLabel: apply ? 'Apply' : 'Keep current',
            doneText: apply ? 'Applied the offline edit (' + RA.formatQty(k.proposed_quantity) + ' ' + line.unit + ')'
                            : 'Kept the current quantity; offline edit not applied',
            errorMessage: RA.errorMessage,
            onSubmit: async (form) => {
                await RA.rpc('pr_office_resolve_conflict', { p_conflict: conflictId, p_apply: apply, p_note: form.note.value.trim() || null });
            },
            onCancel: ctx.back,
            onDone: ctx.done,
        });
    }

    async function matchForm(panel, line, ctx) {
        let items;
        try { items = await RA.rpc('pr_office_catalog'); } catch (e) { alert(RA.errorMessage(e)); return; }
        // Another request may have been opened while this waited.
        if (!ctx.stillShowing()) return;
        items = items || [];
        function options(text) {
            return '<option value="">— No match —</option>' + RA.catalogMatches(items, line.kind, text).map(i =>
                '<option value="' + esc(i.id) + '"' + (i.id === line.catalog_item_id ? ' selected' : '') + '>' + esc(RA.itemLabel(i)) + '</option>').join('');
        }
        const opts = {
            kicker: 'Request',
            title: 'Match to the catalogue',
            sub: line.description + (line.spec ? ' · ' + line.spec : '') + ' (' + line.unit + ')',
            body:
                '<div class="att-field att-span"><label for="reqFind">Search the ' + (line.kind === 'tool' ? 'tools' : 'materials') + '</label>' +
                  '<input class="att-input" id="reqFind" name="find" type="search" placeholder="Name, size, unit…"></div>' +
                '<div class="att-field att-span"><label for="reqItem">Catalogue item</label>' +
                  '<select class="att-input" id="reqItem" name="item" size="8">' + options('') + '</select></div>' +
                '<div class="att-hint att-span">Missing? Add it in Requests → Catalogue first. The worker\'s own words stay on the request.</div>',
            submitLabel: 'Save match',
            doneText: 'Matched to a catalogue item',
            errorMessage: RA.errorMessage,
            onOpen: (form) => {
                form.find.addEventListener('input', () => { form.item.innerHTML = options(form.find.value); });
            },
            onSubmit: async (form) => {
                // A listbox can end up with nothing selected after a search;
                // only an explicit pick (an item, or "No match") is saved.
                if (form.item.selectedIndex < 0) throw new Error('BAD_CATALOG_ITEM');
                await RA.rpc('pr_office_match_item', { p_line: line.id, p_item: form.item.value || null });
                opts.doneText = form.item.value ? 'Matched to a catalogue item' : 'Removed the catalogue match';
            },
            onCancel: ctx.back,
            onDone: ctx.done,
        };
        root.SplitView.form(panel, opts);
    }

    // ── The panel ───────────────────────────────────────────────────

    const STATE_TONE = { conflict: 'red', reduction: 'red', cancelled: 'none', unarranged: 'gold', partly: 'gold', arranged: 'done' };

    function draw(panel, req, hooks) {
        const photos = req.photos || [];
        const requestPhotos = photos.filter(ph => !ph.line_id);

        // The year is dropped while it is this year, as in the queue.
        const now = Date.now();
        const year = new Date(now + 8 * 60 * 60 * 1000).getUTCFullYear();
        const today = RA.manilaDayKey(now);
        const when = iso => RA.formatManila(iso).replace(' ' + year + ',', ' ·');
        const lines = req.lines || [];
        const sum = RA.requestSummary(req);
        const state = RA.requestState(req);
        const states = lines.map(RA.lineState);
        const count = (...keys) => states.filter(x => keys.includes(x)).length;
        const chip = (n, text, tone) => n
            ? '<span class="req-sum req-sum--' + tone + '"><strong>' + n + '</strong> ' + text + '</span>' : '';
        const overdue = RA.isOverdue(req, today);
        // "Team Team test" read like a typo: say "Team" only if the name does not.
        const teamLabel = req.team_name
            ? (/^team\b/i.test(req.team_name) ? req.team_name : 'Team ' + req.team_name) : '';

        const pills = [];
        if (req.status === 'cancelled') pills.push({ text: 'Cancelled', tone: 'none' });
        else pills.push({ text: state === 'cancelled' ? 'Closed' : RA.STATE_LABEL[state], tone: STATE_TONE[state] });
        if (sum.urgent) {
            pills.push(overdue
                ? { text: 'OVERDUE · needed ' + RA.formatDay(sum.neededBy), tone: 'solidRed' }
                : { text: sum.neededBy ? 'URGENT · by ' + RA.formatDay(sum.neededBy) : 'URGENT', tone: 'red' });
        }

        // "What to do now", from this fresh copy of the request. Its button
        // is the real action's button (same data-act), so the click below
        // runs exactly what the button inside the item runs.
        const step = RA.requestNextStep(req, today);
        let stepHtml = '';
        if (step) {
            const btn = step.act
                ? '<button class="att-btn att-btn--primary" type="button" data-act="' + esc(step.act.act) + '" data-portion="' + esc(step.act.portion) + '"' +
                  (step.act.line ? ' data-line="' + esc(step.act.line) + '"' : '') + '>' + esc(step.label) + '</button>'
                : '';
            stepHtml = SV.nextStep(step.text, btn);
        }

        const sections = [];
        if (overdue && state !== 'arranged' && state !== 'cancelled') {
            const late = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(sum.neededBy + 'T00:00:00Z')) / DAY_MS);
            const sentence = 'Needed ' + RA.formatDay(sum.neededBy) + '. Arrange it now or tell the worker when it will arrive.';
            // The step box already says the sentence: the notice keeps its title.
            sections.push(SV.notice('red', 'alarm-clock', 'Overdue ' + late + (late === 1 ? ' day' : ' days'),
                step && step.text === sentence ? '' : esc(sentence)));
        }
        if (req.note) sections.push(SV.section('Note from the worker', '<p class="sv-text">' + esc(req.note) + '</p>'));
        sections.push(SV.section('Items (' + lines.length + ')',
            '<div class="req-summary">' +
              '<span class="req-sum req-sum--plain"><strong>' + lines.length + '</strong> item' + (lines.length === 1 ? '' : 's') + '</span>' +
              chip(count('conflict', 'reduction'), 'to resolve', 'red') +
              chip(count('unarranged', 'partly'), 'to arrange', 'gold') +
              chip(count('arranged'), 'arranged', 'green') +
              chip(count('cancelled'), 'cancelled', 'plain') +
            '</div>' +
            lines.map(l => lineCard(l, photos)).join('')));
        if (requestPhotos.length) sections.push(SV.section('Photos', '<div class="req-photos">' + requestPhotos.map(photoImg).join('') + '</div>'));
        sections.push(SV.facts([
            ['Requested by', '<strong>' + esc(req.requester_name) + '</strong>'],
            ['Project', esc(req.project_name)],
            ['Work', esc(req.work_name)],
            ['Team', esc(teamLabel)],
            ['Received', esc(when(req.received_at))],
            ['Drafted on phone', req.drafted_at ? esc(when(req.drafted_at)) : ''],
        ]));
        sections.push(historySection(req));

        SV.fill(panel, SV.panelHtml({
            kicker: 'Request · received ' + when(req.received_at),
            title: req.project_name,
            sub: [req.work_name, 'from ' + req.requester_name, teamLabel].filter(Boolean).join(' · '),
            pills: pills,
            step: stepHtml,
            sections: sections,
            nextLabel: hooks.nextLabel,
        }));

        // stillShowing: this element is still the open pop-up's panel (not
        // closed, not replaced by another item's fresh panel) and shows this request.
        const ctx = { back: () => draw(panel, req, hooks), done: hooks.onChanged, stillShowing: () => panel.isConnected && panel.dataset.svId === req.id };
        // One handler per panel (assigned, not added), so redrawing the same
        // request never stacks a second copy.
        panel.onclick = async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const act = b.dataset.act;
            const line = b.dataset.line ? findLine(req, b.dataset.line) : null;
            const found = b.dataset.portion ? findPortion(req, b.dataset.portion) : null;
            if (act === 'arrange' || act === 'unarrange') {
                b.disabled = true;
                try {
                    await RA.rpc('pr_office_set_arranged', { p_portion: b.dataset.portion, p_arranged: act === 'arrange' });
                    if (act === 'arrange') SV.toast('Marked ' + (found ? RA.formatQty(found.portion.quantity) + ' ' + found.line.unit + ' ' : '') + 'arranged');
                    else SV.toast('Undid "arranged"');
                    hooks.onChanged();
                } catch (err) { alert(RA.errorMessage(err)); b.disabled = false; }
            } else if (act === 'reduction' && found) reductionForm(panel, found.line, found.portion, ctx);
            else if (act === 'move' && found) moveForm(panel, found.line, found.portion, ctx);
            else if (act === 'qty' && line) qtyForm(panel, line, ctx);
            else if (act === 'cancel' && line) cancelForm(panel, line, ctx);
            else if (act === 'match' && line) matchForm(panel, line, ctx);
            else if (act === 'conflict') {
                const owner = (req.lines || []).find(l => (l.open_conflicts || []).some(k => k.id === b.dataset.conflict));
                if (owner) conflictForm(panel, owner, b.dataset.conflict, b.dataset.apply === '1', ctx);
            }
        };

        // Opened by the card's next-step button: press this request's own
        // "What to do now" button — only if the fresh request still has the
        // exact step the card showed (same action, same portion) and the
        // pop-up still shows it. Once only: a Cancel redraws with the same hooks.
        if (hooks.start) {
            const want = hooks.start;
            hooks.start = null;
            const go = panel.querySelector('.sv-step [data-act]');
            if (go && ctx.stillShowing() && RA.sameStep(want, { act: go.dataset.act, portion: go.dataset.portion })) go.click();
        }

        loadPhotos(panel);
    }

    // hooks: { onChanged(): reload the queue and this request, nextLabel,
    //          start: { act, portion } the card showed — begin that exact
    //          "What to do now" step once drawn, or null }.
    async function renderRequestPanel(panel, id, hooks) {
        const mine = panelLoads.next();
        if (!panel.dataset.svRestore) panel.innerHTML = '<div class="sv-panel-empty">Loading the request…</div>';
        let req;
        try { req = await RA.rpc('pr_office_request', { p_request: id }); }
        catch (e) { if (panelLoads.isLatest(mine)) SV.error(panel, RA.errorMessage(e)); return; }
        if (!panelLoads.isLatest(mine)) return;
        // The pop-up was closed, or another item opened, while this loaded.
        if (!panel.isConnected || panel.dataset.svId !== id) return;
        if (!req) { SV.error(panel, RA.errorMessage({ message: 'NOT_FOUND' })); return; }
        draw(panel, req, hooks);
    }

    RA.renderRequestPanel = renderRequestPanel;
})(typeof window !== 'undefined' ? window : globalThis);
