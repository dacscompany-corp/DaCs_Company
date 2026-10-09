// ════════════════════════════════════════════════════════════════════
// Requests → setup (WorkMate, 0086). Owner + staff.
//
//   reqBatches  — weekly batches; change purchasing / delivery dates
//   reqTeams    — teams, members and the one leader per team
//   reqCatalog  — the item catalogue (deactivate, never delete)
//   reqProjects — which Project Control projects accept requests
// Every change is a 0086 office RPC.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;

    function head(title, sub, actions) {
        return '<div class="att-head"><div><h2 class="att-title">' + esc(title) + '</h2>' +
            '<p class="att-sub">' + esc(sub) + '</p></div>' +
            (actions ? '<div class="att-head-actions">' + actions + '</div>' : '') + '</div>';
    }

    // ── Weekly batches ──────────────────────────────────────────────

    async function renderBatches(host) {
        host.innerHTML = '<div class="att-stack req-batches"><div class="att-empty">Loading batches…</div></div>';
        let batches;
        try { batches = await RA.rpc('pr_office_batches'); } catch (e) { RA.fail(host, e); return; }
        batches = (batches || []).slice().sort((a, b) => Date.parse(a.cutoff_at) - Date.parse(b.cutoff_at));
        const now = Date.now();
        const year = new Date(now + 8 * 60 * 60 * 1000).getUTCFullYear();

        // The batch the office is working on is the first one whose cutoff
        // has not passed -- the same rule the Queue uses for "This week".
        // It goes first; then what is coming; closed ones last and quiet.
        const future = batches.filter(b => Date.parse(b.cutoff_at) > now);
        const current = future[0] || null;
        const upcoming = future.slice(1);
        const closed = batches.filter(b => Date.parse(b.cutoff_at) <= now).reverse();

        // "1 day 6 hours" / "5 hours 20 min" until the cutoff.
        function closesIn(iso) {
            const ms = Date.parse(iso) - now;
            const d = Math.floor(ms / 86400000);
            const h = Math.floor((ms % 86400000) / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            const part = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
            if (d > 0) return part(d, 'day') + (h ? ' ' + part(h, 'hour') : '');
            if (h > 0) return part(h, 'hour') + (m ? ' ' + m + ' min' : '');
            return Math.max(m, 1) + ' min';
        }
        // The year is dropped while it is this year.
        const when = iso => RA.formatManila(iso).replace(' ' + year + ',', ' ·');

        function rowHtml(b, kind) {
            const items = Number(b.open_portions) || 0;
            return '<tr class="req-brow' + (kind === 'current' ? ' is-current' : '') +
                   (kind === 'closed' ? ' is-closed' : '') + '">' +
                '<td><strong>' + esc(RA.cutoffLabel(b.cutoff_at)) + '</strong></td>' +
                '<td>' + esc(RA.formatDay(b.purchase_on)) + '</td>' +
                '<td>' + esc(RA.formatDay(b.delivery_on)) + '</td>' +
                '<td>' + (items
                    ? '<strong>' + items + '</strong> ' + (items === 1 ? 'item' : 'items') +
                      '<div><button class="att-link" type="button" data-queue="' + esc(b.id) + '">View in queue</button></div>'
                    : '<span class="req-muted">None</span>') + '</td>' +
                '<td>' + (b.updated_by_name
                    ? '<span class="att-pill att-pill--working">Dates changed</span>' +
                      '<div class="req-muted">' + esc(b.updated_by_name) + ' · ' + esc(when(b.updated_at)) + '</div>'
                    : '<span class="req-muted">Default dates</span>') + '</td>' +
                '<td class="req-bact"><button class="att-btn" type="button" data-edit="' + esc(b.id) + '">Change dates…</button></td>' +
                '</tr>';
        }
        function headingHtml(title, meta, count) {
            return '<tr class="req-group"><td colspan="6"><span class="req-group-title">' + esc(title) + '</span>' +
                (meta ? '<span class="req-group-meta">' + esc(meta) + '</span>' : '') +
                '<span class="req-group-count">' + count + (count === 1 ? ' batch' : ' batches') + '</span></td></tr>';
        }

        const rows =
            (current ? headingHtml('This week', 'Closes in ' + closesIn(current.cutoff_at), 1) + rowHtml(current, 'current') : '') +
            (upcoming.length ? headingHtml('Upcoming', '', upcoming.length) + upcoming.map(b => rowHtml(b, 'upcoming')).join('') : '') +
            (closed.length ? headingHtml('Closed', 'Cutoff has passed', closed.length) + closed.map(b => rowHtml(b, 'closed')).join('') : '');

        host.innerHTML =
            '<div class="att-stack req-batches">' +
              head('Weekly batches', 'When each week\'s requests are bought and delivered.') +
              '<div class="att-info"><i data-lucide="calendar-clock"></i><div>Requests received before ' +
                '<strong>Saturday 12:00 noon</strong> (Manila) join that week\'s batch. Holidays or supplier delays? ' +
                'Use <strong>Change dates</strong> to move purchasing and delivery — workers see the new dates.</div></div>' +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<div class="req-table-wrap"><table class="att-table req-btable"><thead><tr>' +
                  '<th>Cutoff</th><th>Purchasing</th><th>Delivery</th><th>Open items</th><th>Last changed</th><th></th>' +
                '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
                (batches.length ? '' : '<div class="att-empty">No batches yet.</div>') +
              '</div></div>' +
            '</div>';

        host.querySelectorAll('[data-queue]').forEach(btn => btn.addEventListener('click', () => {
            if (RA.showQueueForBatch) RA.showQueueForBatch(btn.dataset.queue);
        }));

        // A date-only value moved by whole days, never through a time zone.
        function addDays(key, n) {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
            if (!m) return key;
            return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
        }

        host.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
            const b = batches.find(x => x.id === btn.dataset.edit);
            if (!b) return;
            RA.modal({
                title: 'Change batch dates',
                sub: 'Cutoff ' + RA.cutoffLabel(b.cutoff_at) + ' — the cutoff itself does not change',
                body:
                    '<div class="att-field"><label for="reqBuy">Purchasing</label>' +
                      '<input class="att-input" id="reqBuy" name="buy" type="date" value="' + esc(b.purchase_on) + '"></div>' +
                    '<div class="att-field"><label for="reqDeliver">Delivery</label>' +
                      '<input class="att-input" id="reqDeliver" name="deliver" type="date" value="' + esc(b.delivery_on) + '"></div>' +
                    '<div class="req-shift"><span>Move both:</span>' +
                      '<button class="att-link" type="button" data-shift="1">+1 day</button>' +
                      '<button class="att-link" type="button" data-shift="7">+1 week</button>' +
                      '<button class="att-link" type="button" data-undo>Undo</button></div>' +
                    '<div class="req-preview" data-preview aria-live="polite"></div>',
                submitLabel: 'Save dates',
                // What the workers will see, said back in words with the
                // weekday (a date box only shows numbers), and Save stays
                // off until the dates are valid AND different from saved.
                onOpen: (form) => {
                    const buy = form.buy, deliver = form.deliver;
                    const save = form.querySelector('[data-submit]');
                    const prev = form.querySelector('[data-preview]');
                    function refresh() {
                        const problem = RA.validateDates(buy.value, deliver.value);
                        const changed = buy.value !== b.purchase_on || deliver.value !== b.delivery_on;
                        if (problem) {
                            prev.className = 'req-preview req-preview--bad';
                            prev.textContent = problem;
                        } else {
                            prev.className = 'req-preview';
                            prev.innerHTML = 'Workers will see: <strong>Buy ' + esc(RA.formatDay(buy.value)) +
                                '</strong> · <strong>Deliver ' + esc(RA.formatDay(deliver.value)) + '</strong>' +
                                (changed ? '' : ' <span class="req-muted">(no change yet)</span>');
                        }
                        save.disabled = !!problem || !changed;
                    }
                    form.addEventListener('input', refresh);
                    form.addEventListener('change', refresh);
                    form.querySelectorAll('[data-shift]').forEach(s => s.addEventListener('click', () => {
                        if (!buy.value || !deliver.value) return;
                        const n = Number(s.dataset.shift);
                        buy.value = addDays(buy.value, n);
                        deliver.value = addDays(deliver.value, n);
                        refresh();
                    }));
                    form.querySelector('[data-undo]').addEventListener('click', () => {
                        buy.value = b.purchase_on;
                        deliver.value = b.delivery_on;
                        refresh();
                    });
                    refresh();
                },
                onSubmit: async (form) => {
                    const problem = RA.validateDates(form.buy.value, form.deliver.value);
                    if (problem) throw new Error('BAD_DATES');
                    await RA.rpc('pr_office_set_batch_dates', { p_batch: b.id, p_purchase_on: form.buy.value, p_delivery_on: form.deliver.value });
                },
                onDone: () => renderBatches(host),
            });
        }));
        RA.icons();
    }

    // ── Teams ───────────────────────────────────────────────────────

    function teamCard(t, people) {
        const memberIds = t.members.map(m => m.worker_id);
        const candidates = people.filter(p => !memberIds.includes(p.id));
        // pr_office_teams sends names only; the roster number comes from the
        // people list (active workers). A deactivated member shows no number.
        const numberOf = (id) => { const p = people.find(x => x.id === id); return p ? RA.workerNo(p.worker_no) : ''; };
        return '<div class="att-card" data-team="' + esc(t.id) + '">' +
            '<div class="att-card-head"><div>' +
              '<div class="att-card-title">' + esc(t.name) + '</div>' +
              '<div class="att-card-sub">' + t.members.length + ' member' + (t.members.length === 1 ? '' : 's') + '</div>' +
            '</div><div class="att-card-tools">' +
              (t.active ? '<span class="att-pill att-pill--done">Active</span>' : '<span class="att-pill att-pill--hidden">Inactive</span>') +
              ' <button class="att-btn" type="button" data-act="edit-team">Rename / deactivate…</button>' +
            '</div></div>' +
            '<div class="att-card-body att-stack">' +
              (t.members.length
                ? '<div class="req-table-wrap"><table class="att-table"><tbody>' + t.members.map(m =>
                    '<tr><td><strong>' + esc(m.name) + '</strong>' +
                      (numberOf(m.worker_id) ? ' <span class="req-muted att-mono">' + esc(numberOf(m.worker_id)) + '</span>' : '') +
                      (m.is_leader ? ' <span class="att-pill att-pill--pc">Leader</span>' : '') + '</td>' +
                    '<td>' + (m.role === 'teamLeader' ? 'Team Leader' : 'Worker') + '</td>' +
                    '<td><div class="req-actions">' +
                      (t.active && m.role === 'teamLeader' && !m.is_leader
                        ? '<button class="att-btn" type="button" data-act="lead" data-worker="' + esc(m.worker_id) + '">Make leader</button>' : '') +
                      (t.active && m.is_leader
                        ? '<button class="att-btn" type="button" data-act="unlead">No leader</button>' : '') +
                      '<button class="att-btn att-btn--warn" type="button" data-act="remove" data-worker="' + esc(m.worker_id) + '">Remove</button>' +
                    '</div></td></tr>').join('') + '</tbody></table></div>'
                : '<div class="att-empty">No members yet.</div>') +
              (t.active ? '<div class="req-actions">' +
                '<select class="att-filter" data-pick aria-label="Add a member"><option value="">Add a member…</option>' +
                  candidates.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) +
                    (RA.workerNo(p.worker_no) ? ' · ' + esc(RA.workerNo(p.worker_no)) : '') +
                    (p.role === 'teamLeader' ? ' (Team Leader)' : '') + '</option>').join('') +
                '</select>' +
                '<button class="att-btn att-btn--primary" type="button" data-act="add">Add</button>' +
              '</div>' : '') +
            '</div></div>';
    }

    function teamModal(team, rerender) {
        RA.modal({
            title: team ? 'Edit team' : 'New team',
            body:
                '<div class="att-field att-span"><label for="reqTeamName">Team name</label>' +
                  '<input class="att-input" id="reqTeamName" name="name" maxlength="80" value="' + esc(team ? team.name : '') + '" placeholder="e.g. Masonry crew A"></div>' +
                (team ? '<label class="req-toggle att-span"><input type="checkbox" name="active"' + (team.active ? ' checked' : '') + '> Active (can send requests)</label>' : ''),
            submitLabel: team ? 'Save' : 'Create team',
            onSubmit: async (form) => {
                if (!form.name.value.trim()) throw new Error('BAD_TEAM');
                await RA.rpc('pr_office_save_team', {
                    p_team: team ? team.id : null,
                    p_name: form.name.value.trim(),
                    p_active: team ? form.active.checked : true,
                });
            },
            onDone: rerender,
        });
    }

    async function renderTeams(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading teams…</div></div>';
        let teams, people;
        try { [teams, people] = await Promise.all([RA.rpc('pr_office_teams'), RA.rpc('pr_office_people')]); }
        catch (e) { RA.fail(host, e); return; }
        teams = teams || [];
        people = people || [];
        const rerender = () => renderTeams(host);
        host.innerHTML =
            '<div class="att-stack">' +
              head('Teams', 'A team leader can send requests for the whole team. They need the Team Leader role and to be set as this team\'s leader.',
                   '<button class="att-btn att-btn--primary" type="button" data-new-team>New team</button>') +
              (teams.length ? teams.map(t => teamCard(t, people)).join('') : '<div class="att-empty">No teams yet.</div>') +
            '</div>';
        host.querySelector('[data-new-team]').addEventListener('click', () => teamModal(null, rerender));
        host.querySelectorAll('[data-team]').forEach(card => card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const team = teams.find(t => t.id === card.dataset.team);
            const act = b.dataset.act;
            if (act === 'edit-team') { teamModal(team, rerender); return; }
            let call = null;
            if (act === 'add') {
                const pick = card.querySelector('[data-pick]').value;
                if (!pick) return;
                call = ['pr_office_add_member', { p_team: team.id, p_worker: pick }];
            } else if (act === 'remove') {
                const m = team.members.find(x => x.worker_id === b.dataset.worker);
                if (!confirm('Remove ' + (m ? m.name : 'this person') + ' from ' + team.name + '?' +
                    (m && m.is_leader ? ' The team will have no leader.' : ''))) return;
                call = ['pr_office_remove_member', { p_team: team.id, p_worker: b.dataset.worker }];
            } else if (act === 'lead') {
                call = ['pr_office_set_leader', { p_team: team.id, p_worker: b.dataset.worker }];
            } else if (act === 'unlead') {
                call = ['pr_office_set_leader', { p_team: team.id, p_worker: null }];
            }
            if (!call) return;
            b.disabled = true;
            try { await RA.rpc(call[0], call[1]); rerender(); }
            catch (err) { alert(RA.errorMessage(err)); b.disabled = false; }
        }));
        RA.icons();
    }

    // ── Catalogue ───────────────────────────────────────────────────

    const catUi = { text: '', kind: '', showInactive: false };

    function itemModal(item, rerender) {
        const v = item || { kind: 'material', name: '', spec: '', unit: '', category: '', active: true };
        RA.modal({
            title: item ? 'Edit item' : 'New item',
            sub: 'One row = one exact item. A different size or unit is a different item.',
            body:
                '<div class="att-field"><label for="reqKind">Kind</label><select class="att-input" id="reqKind" name="kind">' +
                  '<option value="material"' + (v.kind === 'material' ? ' selected' : '') + '>Material</option>' +
                  '<option value="tool"' + (v.kind === 'tool' ? ' selected' : '') + '>Tool</option></select></div>' +
                '<div class="att-field"><label for="reqCat">Category <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqCat" name="category" maxlength="60" value="' + esc(v.category) + '" placeholder="e.g. plumbing"></div>' +
                '<div class="att-field att-span"><label for="reqName">Name</label>' +
                  '<input class="att-input" id="reqName" name="name" maxlength="120" value="' + esc(v.name) + '" placeholder="e.g. PVC pipe"></div>' +
                '<div class="att-field"><label for="reqSpec">Size / spec <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="reqSpec" name="spec" maxlength="120" value="' + esc(v.spec) + '" placeholder="e.g. 1/2 in, 3 m"></div>' +
                '<div class="att-field"><label for="reqUnit">Unit</label>' +
                  '<input class="att-input" id="reqUnit" name="unit" maxlength="30" value="' + esc(v.unit) + '" placeholder="e.g. pc, bag, m"></div>' +
                (item ? '<label class="req-toggle att-span"><input type="checkbox" name="active"' + (v.active ? ' checked' : '') + '> Active (workers can pick it)</label>' : ''),
            submitLabel: item ? 'Save' : 'Add item',
            onSubmit: async (form) => {
                await RA.rpc('pr_office_save_item', {
                    p_item: item ? item.id : null,
                    p_kind: form.kind.value,
                    p_name: form.name.value.trim(),
                    p_spec: form.spec.value.trim(),
                    p_unit: form.unit.value.trim(),
                    p_category: form.category.value.trim(),
                    p_active: item ? form.active.checked : true,
                });
            },
            onDone: rerender,
        });
    }

    async function renderCatalog(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the catalogue…</div></div>';
        let items;
        try { items = await RA.rpc('pr_office_catalog'); } catch (e) { RA.fail(host, e); return; }
        items = items || [];
        const rerender = () => renderCatalog(host);
        host.innerHTML =
            '<div class="att-stack">' +
              head('Item catalogue', 'The materials and tools workers pick from. Unlisted items are matched to an entry here from the request screen.',
                   '<button class="att-btn att-btn--primary" type="button" data-new-item>New item</button>') +
              '<div class="att-toolbar">' +
                '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                  '<input class="att-search" type="search" data-text aria-label="Search" placeholder="Search name, size, unit, category…" value="' + esc(catUi.text) + '"></div>' +
                '<select class="att-filter" data-kind aria-label="Kind">' +
                  '<option value="">Materials and tools</option>' +
                  '<option value="material"' + (catUi.kind === 'material' ? ' selected' : '') + '>Materials</option>' +
                  '<option value="tool"' + (catUi.kind === 'tool' ? ' selected' : '') + '>Tools</option></select>' +
                '<label class="req-toggle"><input type="checkbox" data-inactive' + (catUi.showInactive ? ' checked' : '') + '> Show inactive</label>' +
              '</div>' +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<div class="req-table-wrap"><table class="att-table"><thead><tr><th>Kind</th><th>Name</th><th>Size / spec</th><th>Unit</th><th>Category</th><th>Status</th><th></th></tr></thead>' +
                '<tbody data-rows></tbody></table></div><div class="att-empty" data-empty style="display:none">No item matches.</div>' +
              '</div></div>' +
            '</div>';
        function draw() {
            const t = catUi.text.trim().toLowerCase();
            const list = items.filter(i => (catUi.showInactive || i.active) && (!catUi.kind || i.kind === catUi.kind) &&
                (!t || [i.name, i.spec, i.unit, i.category].join(' ').toLowerCase().includes(t)));
            host.querySelector('[data-rows]').innerHTML = list.map(i =>
                '<tr><td>' + (i.kind === 'tool' ? 'Tool' : 'Material') + '</td><td><strong>' + esc(i.name) + '</strong></td>' +
                '<td>' + esc(i.spec || '—') + '</td><td>' + esc(i.unit) + '</td><td>' + esc(i.category || '—') + '</td>' +
                '<td>' + (i.active ? '<span class="att-pill att-pill--done">Active</span>' : '<span class="att-pill att-pill--hidden">Inactive</span>') + '</td>' +
                '<td><button class="att-btn" type="button" data-edit="' + esc(i.id) + '">Edit…</button></td></tr>').join('');
            host.querySelector('[data-empty]').style.display = list.length ? 'none' : 'block';
        }
        draw();
        host.querySelector('[data-new-item]').addEventListener('click', () => itemModal(null, rerender));
        host.querySelector('[data-text]').addEventListener('input', e => { catUi.text = e.target.value; draw(); });
        host.querySelector('[data-kind]').addEventListener('change', e => { catUi.kind = e.target.value; draw(); });
        host.querySelector('[data-inactive]').addEventListener('change', e => { catUi.showInactive = e.target.checked; draw(); });
        host.querySelector('[data-rows]').addEventListener('click', e => {
            const b = e.target.closest('[data-edit]');
            if (b) itemModal(items.find(i => i.id === b.dataset.edit), rerender);
        });
        RA.icons();
    }

    // ── Projects ────────────────────────────────────────────────────

    function requestableNote(p) {
        if (p.completed) return '<span class="att-pill att-pill--hidden">Completed</span>';
        if (p.requestable) return '<span class="att-pill att-pill--done">Workers can request</span>';
        return '<span class="att-pill att-pill--none">Not open</span>' +
            '<div class="req-muted">' + (p.hidden_from_time_in ? 'Hidden from Time In.' : 'Not on today\'s Time In list.') + ' Turn on Allow requests to open it.</div>';
    }

    async function renderProjects(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading projects…</div></div>';
        let projects;
        try { projects = await RA.rpc('pr_office_projects'); } catch (e) { RA.fail(host, e); return; }
        projects = projects || [];
        host.innerHTML =
            '<div class="att-stack">' +
              head('Projects open to requests', 'A Project Control project accepts requests while it is on today\'s Time In list, or when Allow requests is on — use that for an upcoming site with no geofence yet. Completed projects never accept requests. Open Additional Works under a project are offered with it.') +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<div class="req-table-wrap"><table class="att-table"><thead><tr><th>Project</th><th>Additional Works</th><th>Requests</th><th>Allow requests</th></tr></thead><tbody>' +
                projects.map(p =>
                    '<tr><td><strong>' + esc(p.name) + '</strong></td>' +
                    '<td>' + esc(String(p.additional_works)) + ' open</td>' +
                    '<td>' + requestableNote(p) + '</td>' +
                    '<td><label class="req-toggle"><input type="checkbox" data-folder="' + esc(p.folder_id) + '"' +
                      (p.allow_requests ? ' checked' : '') + (p.completed ? ' disabled' : '') + '> ' +
                      (p.allow_requests ? 'On' : 'Off') + '</label></td></tr>').join('') +
                '</tbody></table></div>' +
                (projects.length ? '' : '<div class="att-empty">No Project Control projects yet.</div>') +
              '</div></div>' +
            '</div>';
        host.querySelectorAll('input[data-folder]').forEach(box => box.addEventListener('change', async () => {
            box.disabled = true;
            try {
                await RA.rpc('pr_office_set_allow_requests', { p_folder: box.dataset.folder, p_allow: box.checked });
                renderProjects(host);
            } catch (err) {
                alert(RA.errorMessage(err));
                box.checked = !box.checked;
                box.disabled = false;
            }
        }));
        RA.icons();
    }

    RA.views.reqBatches = renderBatches;
    RA.views.reqTeams = renderTeams;
    RA.views.reqCatalog = renderCatalog;
    RA.views.reqProjects = renderProjects;
})(typeof window !== 'undefined' ? window : globalThis);