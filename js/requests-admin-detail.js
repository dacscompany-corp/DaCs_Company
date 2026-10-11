// ════════════════════════════════════════════════════════════════════
// Requests → one request (WorkMate, 0086). Owner + staff.
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
    const esc = RA.esc;
    const PHOTO_BUCKET = 'request-photos';

    function kindLabel(kind) { return kind === 'tool' ? 'Tool' : 'Material'; }

    function portionRows(line) {
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
            return '<tr>' +
                '<td><strong>' + esc(RA.cutoffLabel(p.cutoff_at)) + '</strong>' +
                  '<div class="req-muted">Buy ' + esc(RA.formatDay(p.purchase_on)) + ' · Deliver ' + esc(RA.formatDay(p.delivery_on)) + '</div></td>' +
                '<td>' + esc(RA.formatQty(p.quantity)) + ' ' + esc(line.unit) + '</td>' +
                '<td>' + (p.arranged
                    ? '<span class="att-pill att-pill--done">Arranged</span><div class="req-muted">' +
                      esc(p.arranged_by_name || '') + ' · ' + esc(RA.formatManila(p.arranged_at)) + '</div>'
                    : '<span class="att-pill att-pill--none">Not yet</span>') + '</td>' +
                '<td>' + (pending
                    ? '<strong style="color:var(--att-red)">−' + esc(RA.formatQty(p.pending_reduction)) + ' ' + esc(line.unit) + '</strong>'
                    : '—') + '</td>' +
                '<td><div class="req-actions">' + actions.join('') + '</div></td>' +
                '</tr>';
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
        return '<div class="att-card">' +
            '<div class="att-card-head"><div>' +
              '<div class="att-card-title">' + (line.position + 1) + '. ' + esc(line.description) + '</div>' +
              '<div class="att-card-sub">' + esc(kindLabel(line.kind)) + (line.spec ? ' · ' + esc(line.spec) : '') + ' · ' + esc(line.unit) +
                (line.category ? ' · ' + esc(line.category) : '') + '</div>' +
            '</div><div class="att-card-tools">' +
              (line.urgent ? '<span class="req-urgent">URGENT · by ' + esc(RA.formatDay(line.needed_by)) + '</span> ' : '') +
              '<span class="att-pill ' + RA.STATE_PILL[st] + '">' + esc(RA.STATE_LABEL[st]) + '</span>' +
            '</div></div>' +
            '<div class="att-card-body att-stack">' +
              '<div class="att-facts">' +
                '<div class="att-fact"><div class="att-fact-label">Still needed</div><div class="att-fact-val att-fact-strong">' +
                  esc(RA.formatQty(line.needed)) + ' ' + esc(line.unit) + '</div></div>' +
                '<div class="att-fact"><div class="att-fact-label">Catalogue</div><div class="att-fact-val">' + catalog +
                  ' <button class="att-link" type="button" data-act="match" data-line="' + esc(line.id) + '">' +
                  (line.catalog_item_id ? 'Change' : 'Match') + '</button></div></div>' +
                (line.ref_label ? '<div class="att-fact"><div class="att-fact-label">Requested again from</div><div class="att-fact-val">' +
                  esc(line.ref_label) + '</div></div>' : '') +
                (line.intended_member_name ? '<div class="att-fact"><div class="att-fact-label">For</div><div class="att-fact-val">' +
                  esc(line.intended_member_name) + '</div></div>' : '') +
                (line.urgent ? '<div class="att-fact"><div class="att-fact-label">Why urgent</div><div class="att-fact-val">' +
                  esc(line.urgent_reason) + '</div></div>' : '') +
                (line.notes ? '<div class="att-fact"><div class="att-fact-label">Notes</div><div class="att-fact-val">' +
                  esc(line.notes) + '</div></div>' : '') +
              '</div>' +
              conflictBlocks(line) +
              ((line.portions || []).length
                ? '<div class="req-table-wrap"><table class="att-table"><thead><tr><th>Weekly batch</th><th>Quantity</th><th>Arranged</th><th>Reduction</th><th></th></tr></thead>' +
                  '<tbody>' + portionRows(line) + '</tbody></table></div>'
                : '') +
              (linePhotos.length ? '<div class="req-photos">' + linePhotos.map(photoImg).join('') + '</div>' : '') +
              (open ? '<div class="req-actions">' +
                '<button class="att-btn" type="button" data-act="qty" data-line="' + esc(line.id) + '">Change quantity…</button>' +
                '<button class="att-btn att-btn--warn" type="button" data-act="cancel" data-line="' + esc(line.id) + '">Cancel item…</button>' +
              '</div>' : '') +
            '</div></div>';
    }

    function photoImg(ph) {
        return '<img class="req-photo" alt="Request photo" data-photo-path="' + esc(ph.path) + '">';
    }

    async function loadPhotos(host) {
        const imgs = host.querySelectorAll('img[data-photo-path]');
        for (const img of imgs) {
            const { data, error } = await root.sbClient.storage.from(PHOTO_BUCKET).createSignedUrl(img.dataset.photoPath, 600);
            if (error || !data) { img.alt = 'Photo unavailable'; continue; }
            img.src = data.signedUrl;
            img.addEventListener('click', () => root.open(data.signedUrl, '_blank', 'noopener'));
        }
    }

    function historyHtml(req) {
        const byLine = {};
        (req.lines || []).forEach(l => { byLine[l.id] = (l.position + 1) + '. ' + l.description; });
        const events = (req.events || []).slice().reverse();
        if (!events.length) return '<div class="att-empty">No history yet.</div>';
        return '<ul class="req-history">' + events.map(e =>
            '<li class="req-history-item"><div class="req-history-when">' + esc(RA.formatManila(e.created_at)) + '</div>' +
            '<div><strong>' + esc(e.actor_name) + '</strong> — ' + esc(RA.eventText(e)) +
            (e.line_id && byLine[e.line_id] ? ' <span class="req-muted">(' + esc(byLine[e.line_id]) + ')</span>' : '') +
            '</div></li>').join('') + '</ul>';
    }

    // ── Modals ──────────────────────────────────────────────────────

    function findLine(req, id) { return (req.lines || []).find(l => l.id === id); }
    function findPortion(req, id) {
        for (const l of req.lines || []) for (const p of l.portions || []) if (p.id === id) return { line: l, portion: p };
        return null;
    }

    function qtyModal(req, line, rerender) {
        RA.modal({
            title: 'Change quantity',
            sub: line.description + ' · now ' + RA.formatQty(line.needed) + ' ' + line.unit,
            body:
                '<div class="att-field att-span"><label for="reqQty">New quantity (' + esc(line.unit) + ')</label>' +
                  '<input class="att-input" id="reqQty" name="qty" inputmode="decimal" value="' + esc(String(line.needed)) + '"></div>' +
                '<div class="att-field att-span"><label for="reqReason">Reason</label>' +
                  '<input class="att-input" id="reqReason" name="reason" maxlength="200" placeholder="e.g. Engineer recounted on site"></div>' +
                '<div class="att-hint att-span">Lowering below what is already arranged does not erase it: the difference waits as a reduction for you to resolve.</div>',
            submitLabel: 'Change quantity',
            onSubmit: async (form) => {
                const q = RA.parseQty(form.qty.value);
                if (q === null) throw new Error('BAD_QUANTITY');
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_change_quantity', { p_line: line.id, p_quantity: q, p_reason: form.reason.value.trim() });
            },
            onDone: rerender,
        });
    }

    function cancelModal(req, line, rerender) {
        const arranged = (line.portions || []).some(p => p.arranged);
        RA.modal({
            title: 'Cancel this item',
            sub: line.description + ' · ' + RA.formatQty(line.needed) + ' ' + line.unit,
            body:
                (arranged ? '<div class="att-info att-info--warn att-span"><i data-lucide="alert-triangle"></i><div>Part of this is already arranged. ' +
                  'That quantity will wait as a reduction for you to resolve.</div></div>' : '') +
                '<div class="att-field att-span"><label for="reqReason">Reason</label>' +
                  '<input class="att-input" id="reqReason" name="reason" maxlength="200" placeholder="e.g. Wrong size; replaced by item 3"></div>',
            submitLabel: 'Cancel item',
            warn: true,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_cancel_line', { p_line: line.id, p_reason: form.reason.value.trim() });
            },
            onDone: rerender,
        });
    }

    function reductionModal(line, portion, rerender) {
        RA.modal({
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
            onSubmit: async (form) => {
                await RA.rpc('pr_office_resolve_reduction', { p_portion: portion.id, p_outcome: form.outcome.value, p_note: form.note.value.trim() || null });
            },
            onDone: rerender,
        });
    }

    async function moveModal(line, portion, rerender) {
        let batches;
        try { batches = await RA.rpc('pr_office_batches'); } catch (e) { alert(RA.errorMessage(e)); return; }
        const targets = (batches || []).filter(b => b.id !== portion.batch_id);
        RA.modal({
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
            onSubmit: async (form) => {
                await RA.rpc('pr_office_move_portion', { p_portion: portion.id, p_batch: form.batch.value, p_note: form.note.value.trim() || null });
            },
            onDone: rerender,
        });
    }

    function conflictModal(req, line, conflictId, apply, rerender) {
        const k = (line.open_conflicts || []).find(x => x.id === conflictId);
        if (!k) return;
        RA.modal({
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
            onSubmit: async (form) => {
                await RA.rpc('pr_office_resolve_conflict', { p_conflict: conflictId, p_apply: apply, p_note: form.note.value.trim() || null });
            },
            onDone: rerender,
        });
    }

    async function matchModal(line, rerender) {
        let items;
        try { items = await RA.rpc('pr_office_catalog'); } catch (e) { alert(RA.errorMessage(e)); return; }
        items = items || [];
        function options(text) {
            return '<option value="">— No match —</option>' + RA.catalogMatches(items, line.kind, text).map(i =>
                '<option value="' + esc(i.id) + '"' + (i.id === line.catalog_item_id ? ' selected' : '') + '>' + esc(RA.itemLabel(i)) + '</option>').join('');
        }
        RA.modal({
            title: 'Match to the catalogue',
            sub: line.description + (line.spec ? ' · ' + line.spec : '') + ' (' + line.unit + ')',
            body:
                '<div class="att-field att-span"><label for="reqFind">Search the ' + (line.kind === 'tool' ? 'tools' : 'materials') + '</label>' +
                  '<input class="att-input" id="reqFind" name="find" type="search" placeholder="Name, size, unit…"></div>' +
                '<div class="att-field att-span"><label for="reqItem">Catalogue item</label>' +
                  '<select class="att-input" id="reqItem" name="item" size="8">' + options('') + '</select></div>' +
                '<div class="att-hint att-span">Missing? Add it in Requests → Catalogue first. The worker\'s own words stay on the request.</div>',
            submitLabel: 'Save match',
            onOpen: (form) => {
                form.find.addEventListener('input', () => { form.item.innerHTML = options(form.find.value); });
            },
            onSubmit: async (form) => {
                // A listbox can end up with nothing selected after a search;
                // only an explicit pick (an item, or "No match") is saved.
                if (form.item.selectedIndex < 0) throw new Error('BAD_CATALOG_ITEM');
                await RA.rpc('pr_office_match_item', { p_line: line.id, p_item: form.item.value || null });
            },
            onDone: rerender,
        });
    }

    // ── The screen ──────────────────────────────────────────────────

    async function renderDetail(host) {
        const id = RA.state.detailId;
        if (!id) { root.switchView('reqQueue'); return; }
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the request…</div></div>';
        let req;
        try { req = await RA.rpc('pr_office_request', { p_request: id }); } catch (e) { RA.fail(host, e); return; }
        if (!req) { RA.fail(host, { message: 'NOT_FOUND' }); return; }
        const photos = req.photos || [];
        const requestPhotos = photos.filter(ph => !ph.line_id);
        const rerender = () => renderDetail(host);

        host.innerHTML =
            '<div class="att-stack">' +
              '<div class="att-crumbs"><button class="att-link" type="button" data-act="back">← Request queue</button></div>' +
              '<div class="att-head"><div>' +
                '<h2 class="att-title">Request from ' + esc(req.requester_name) + '</h2>' +
                '<p class="att-sub">' + esc(req.project_name) + ' · ' + esc(req.work_name) +
                  (req.team_name ? ' · Team ' + esc(req.team_name) : '') + ' · Received ' + esc(RA.formatManila(req.received_at)) +
                  (req.drafted_at ? ' (drafted ' + esc(RA.formatManila(req.drafted_at)) + ')' : '') + '</p>' +
              '</div>' +
              (req.status === 'cancelled' ? '<div class="att-head-actions"><span class="att-pill att-pill--hidden">Cancelled</span></div>' : '') +
              '</div>' +
              (req.note ? '<div class="att-info"><i data-lucide="message-square"></i><div>' + esc(req.note) + '</div></div>' : '') +
              '<div class="req-lines">' + (req.lines || []).map(l => lineCard(l, photos)).join('') + '</div>' +
              (requestPhotos.length ? '<div class="att-card"><div class="att-card-head"><div class="att-card-title">Photos</div></div>' +
                '<div class="att-card-body"><div class="req-photos">' + requestPhotos.map(photoImg).join('') + '</div></div></div>' : '') +
              '<div class="att-card"><div class="att-card-head"><div class="att-card-title">History</div></div>' +
                '<div class="att-card-body">' + historyHtml(req) + '</div></div>' +
            '</div>';

        host.querySelector('.att-stack').addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const act = b.dataset.act;
            if (act === 'back') { root.switchView('reqQueue'); return; }
            const line = b.dataset.line ? findLine(req, b.dataset.line) : null;
            const found = b.dataset.portion ? findPortion(req, b.dataset.portion) : null;
            if (act === 'arrange' || act === 'unarrange') {
                b.disabled = true;
                try {
                    await RA.rpc('pr_office_set_arranged', { p_portion: b.dataset.portion, p_arranged: act === 'arrange' });
                    rerender();
                } catch (err) { alert(RA.errorMessage(err)); b.disabled = false; }
            } else if (act === 'reduction' && found) reductionModal(found.line, found.portion, rerender);
            else if (act === 'move' && found) moveModal(found.line, found.portion, rerender);
            else if (act === 'qty' && line) qtyModal(req, line, rerender);
            else if (act === 'cancel' && line) cancelModal(req, line, rerender);
            else if (act === 'match' && line) matchModal(line, rerender);
            else if (act === 'conflict') {
                const owner = (req.lines || []).find(l => (l.open_conflicts || []).some(k => k.id === b.dataset.conflict));
                if (owner) conflictModal(req, owner, b.dataset.conflict, b.dataset.apply === '1', rerender);
            }
        });

        RA.icons();
        loadPhotos(host);
    }

    RA.views.reqDetail = renderDetail;
})(typeof window !== 'undefined' ? window : globalThis);
