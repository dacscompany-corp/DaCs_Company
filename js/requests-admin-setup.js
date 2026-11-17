// ════════════════════════════════════════════════════════════════════
// Requests → setup (WorkMate, 0086). Owner + staff.
//
//   reqBatches  — weekly batches; change purchasing / delivery dates
//   reqTeams    — teams, members and the one leader per team
//   reqCatalog  — the item catalogue (deactivate, never delete)
//   reqProjects — which projects accept requests, and show their item history
// Every change is a 0086/0090 office RPC.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const head = RA.head;

    // ── Weekly batches ──────────────────────────────────────────────

    const batchUi = { sel: null };
    async function renderBatches(host, o) {
        if (!host.querySelector('.sv')) host.innerHTML = '<div class="att-stack req-batches"><div class="att-empty">Loading batches…</div></div>';
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

        // Office redesign v5: one card per batch under This week / Upcoming /
        // Closed; a batch opens in the pop-up with Change dates… and View in queue.
        function cardOf(b, kind) {
            const items = Number(b.open_portions) || 0;
            return {
                id: b.id,
                title: 'Cutoff ' + RA.cutoffLabel(b.cutoff_at),
                sub: 'Purchasing ' + RA.formatDay(b.purchase_on) + ' · Delivery ' + RA.formatDay(b.delivery_on),
                meta: (items ? items + ' open ' + (items === 1 ? 'item' : 'items') : 'No open items') + ' · ' +
                    (b.updated_by_name ? 'Dates changed by ' + b.updated_by_name + ' · ' + when(b.updated_at) : 'Default dates'),
                pill: kind === 'current' ? { text: 'This week', tone: 'done' } : kind === 'closed' ? { text: 'Closed', tone: 'none' } : { text: 'Upcoming', tone: 'gold' },
                dim: kind === 'closed',
            };
        }
        const groups = [
            current ? { title: 'This week', tone: 'green', meta: esc('Closes in ' + closesIn(current.cutoff_at)), rows: [cardOf(current, 'current')] } : null,
            upcoming.length ? { title: 'Upcoming', rows: upcoming.map(x => cardOf(x, 'upcoming')) } : null,
            closed.length ? { title: 'Closed', tone: 'muted', meta: 'Cutoff has passed', rows: closed.map(x => cardOf(x, 'closed')) } : null,
        ].filter(Boolean);

        root.SplitView.render(host, {
            key: 'reqBatches',
            title: 'Weekly batches',
            sub: "When each week's requests are bought and delivered.",
            strips: ["Requests received before Saturday 12:00 noon (Manila) join that week's batch. Holidays or supplier delays? " +
                'Use Change dates to move purchasing and delivery — workers see the new dates.'],
            search: false,
            groups: groups,
            empty: 'No batches yet.',
            selectedId: batchUi.sel,
            // After Change dates… the open batch reloads with the saved record.
            refreshPanel: !!(o && o.refreshPanel),
            onSelect: (id, panel) => {
                batchUi.sel = id;
                const bt = batches.find(x => x.id === id);
                if (!bt) return root.SplitView.error(panel, 'This batch is no longer listed.');
                const items = Number(bt.open_portions) || 0;
                const body = root.SplitView.page(panel, { kicker: 'Weekly batch', title: 'Cutoff ' + RA.cutoffLabel(bt.cutoff_at), nextLabel: 'Next batch' });
                body.innerHTML = root.SplitView.facts([
                        ['Cutoff', esc(RA.cutoffLabel(bt.cutoff_at))],
                        ['Purchasing', esc(RA.formatDay(bt.purchase_on))],
                        ['Delivery', esc(RA.formatDay(bt.delivery_on))],
                        ['Open items', items ? '<strong>' + items + '</strong> ' + (items === 1 ? 'item' : 'items') : '<span class="req-muted">None</span>'],
                        ['Last changed', bt.updated_by_name ? 'Dates changed · ' + esc(bt.updated_by_name) + ' · ' + esc(when(bt.updated_at)) : 'Default dates'],
                    ]) +
                    '<div class="wp-actions"><button class="att-btn att-btn--primary" type="button" data-edit="' + esc(bt.id) + '">Change dates…</button>' +
                    (items ? '<button class="att-btn" type="button" data-queue="' + esc(bt.id) + '">View in queue</button>' : '') + '</div>';
                body.querySelector('[data-edit]').addEventListener('click', () => openDates(bt));
                const q = body.querySelector('[data-queue]');
                if (q) q.addEventListener('click', () => { if (RA.showQueueForBatch) RA.showQueueForBatch(bt.id); });
                RA.icons();
            },
            onClose: () => { batchUi.sel = null; },
        });

        // A date-only value moved by whole days, never through a time zone.
        function addDays(key, n) {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
            if (!m) return key;
            return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
        }

        // Whole calendar days between two date-only values (to - from).
        function dayDiff(from, to) {
            const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(from || ''));
            const z = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(to || ''));
            if (!a || !z) return null;
            return Math.round((Date.UTC(+z[1], +z[2] - 1, +z[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
        }
        const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

        // One card per date: the day said in words first (a date box only
        // shows numbers), the picker underneath, what it was once changed.
        function dateCard(kind, label, icon, id, value) {
            return '<div class="req-bd-card" data-card="' + kind + '">' +
                '<div class="req-bd-eyebrow"><i data-lucide="' + icon + '"></i>' + label + '</div>' +
                '<div class="req-bd-day" data-day="' + kind + '"></div>' +
                '<div class="req-bd-delta" data-delta="' + kind + '"></div>' +
                '<label class="req-bd-pick" for="' + id + '"><span>Pick a date</span>' +
                  '<input class="att-input" id="' + id + '" name="' + kind + '" type="date" value="' + esc(value) + '"></label>' +
              '</div>';
        }

        // Change batch dates (its own form, unchanged), opened from a batch's pop-up.
        function openDates(b) {
            RA.modal({
                title: 'Change batch dates',
                sub: 'Cutoff ' + RA.cutoffLabel(b.cutoff_at) + ' — the cutoff itself does not change',
                body:
                    '<div class="req-bd">' +
                      '<div class="req-bd-grid">' +
                        dateCard('buy', 'Purchasing', 'shopping-cart', 'reqBuy', b.purchase_on) +
                        '<div class="req-bd-link" aria-hidden="true"><i data-lucide="arrow-right"></i>' +
                          '<span data-gap></span></div>' +
                        dateCard('deliver', 'Delivery', 'truck', 'reqDeliver', b.delivery_on) +
                      '</div>' +
                      '<div class="req-bd-shift"><span class="req-bd-shift-label">Move both</span>' +
                        '<button class="req-bd-chip" type="button" data-shift="-1">\u22121 day</button>' +
                        '<button class="req-bd-chip" type="button" data-shift="1">+1 day</button>' +
                        '<button class="req-bd-chip" type="button" data-shift="7">+1 week</button>' +
                        '<button class="att-link req-bd-undo" type="button" data-undo>Reset to saved</button></div>' +
                      '<div class="req-preview" data-preview aria-live="polite"></div>' +
                    '</div>',
                submitLabel: 'Save dates',
                // What the workers will see, said back in words with the
                // weekday, and Save stays off until the dates are valid AND
                // different from saved.
                onOpen: (form) => {
                    const buy = form.buy, deliver = form.deliver;
                    const save = form.querySelector('[data-submit]');
                    const prev = form.querySelector('[data-preview]');
                    const undo = form.querySelector('[data-undo]');
                    const gap = form.querySelector('[data-gap]');
                    form.closest('.att-modal-box').classList.add('req-bd-box');

                    function paintCard(kind, input, saved, bad) {
                        const card = form.querySelector('[data-card="' + kind + '"]');
                        const n = dayDiff(saved, input.value);
                        const delta = form.querySelector('[data-delta="' + kind + '"]');
                        form.querySelector('[data-day="' + kind + '"]').textContent = RA.formatDay(input.value);
                        if (n) {
                            delta.className = 'req-bd-delta is-changed';
                            delta.textContent = (n > 0 ? '+' : '\u2212') + plural(Math.abs(n), 'day') +
                                ' \u00b7 was ' + RA.formatDay(saved);
                        } else {
                            delta.className = 'req-bd-delta';
                            delta.textContent = 'Saved date';
                        }
                        card.classList.toggle('is-changed', !!n);
                        card.classList.toggle('is-bad', !!bad);
                    }

                    function refresh() {
                        const problem = RA.validateDates(buy.value, deliver.value);
                        const changed = buy.value !== b.purchase_on || deliver.value !== b.delivery_on;
                        paintCard('buy', buy, b.purchase_on, false);
                        paintCard('deliver', deliver, b.delivery_on, problem && problem !== 'Enter both dates.');
                        const between = dayDiff(buy.value, deliver.value);
                        gap.textContent = between === null || between < 0 ? ''
                            : between === 0 ? 'Same day' : plural(between, 'day') + ' later';
                        if (problem) {
                            prev.className = 'req-preview req-preview--bad';
                            prev.textContent = problem;
                        } else {
                            prev.className = 'req-preview';
                            prev.innerHTML = '<span class="req-bd-eyebrow">Workers will see</span>' +
                                '<span class="req-bd-see"><span><em>Buy</em> ' + esc(RA.formatDay(buy.value)) + '</span>' +
                                '<span><em>Deliver</em> ' + esc(RA.formatDay(deliver.value)) + '</span></span>' +
                                (changed ? '' : '<span class="req-muted">No change yet</span>');
                        }
                        undo.disabled = !changed;
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
                    undo.addEventListener('click', () => {
                        buy.value = b.purchase_on;
                        deliver.value = b.delivery_on;
                        refresh();
                    });
                    // Anywhere on a card opens its picker, not just the box.
                    form.querySelectorAll('.req-bd-card').forEach(card => card.addEventListener('click', (e) => {
                        const input = card.querySelector('input');
                        if (e.target === input || !input.showPicker) return;
                        try { input.showPicker(); } catch (err) { /* needs a user gesture; the box still works */ }
                    }));
                    refresh();
                },
                onSubmit: async (form) => {
                    const problem = RA.validateDates(form.buy.value, form.deliver.value);
                    if (problem) throw new Error('BAD_DATES');
                    await RA.rpc('pr_office_set_batch_dates', { p_batch: b.id, p_purchase_on: form.buy.value, p_delivery_on: form.deliver.value });
                },
                onDone: () => renderBatches(host, { refreshPanel: true }),
            });
        }
        RA.icons();
    }

    // ── Teams ───────────────────────────────────────────────────────
    //
    // Layout: a summary strip (teams / need a leader / not in a team), a
    // search box, then the teams as a grid of compact cards. Each card
    // puts the leader first because a team without one still sends requests
    // with no leader to see them -- that is the thing the office has to
    // notice. Inactive teams sit at the bottom, dimmed. All actions are the
    // same RPCs.

    const teamUi = { text: '', showInactive: false };
    const NO_LEADER_NOTE = 'Requests still reach the office, but no leader sees them or checks the team\'s work.';
    // A named leader without the role, or with a switched-off account, has no powers
    // (pr_is_current_leader), so the office must not read them as the leader (0111).
    const validLeader = (m) => m.is_leader && !m.leader_problem;
    const LEADER_PROBLEM = {
        no_role: 'no longer has the Team Leader role.',
        inactive: 'has a switched-off account.',
    };

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    // Add members: a button that opens a searchable, multi-select list in
    // the card. Each row shows the roster number and role, and where the
    // person already is, so the office can choose without guessing.
    function pickerHtml(t, candidates, teams) {
        const elsewhere = (id) => {
            const o = teams.find(x => x.id !== t.id && x.active && x.members.some(m => m.worker_id === id));
            return o ? o.name : '';
        };
        const sorted = candidates.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const rows = sorted.map(p => {
            const no = RA.workerNo(p.worker_no);
            const other = elsewhere(p.id);
            return '<label class="req-pick-row" data-pick-row data-q="' + esc((p.name + ' ' + no).toLowerCase()) + '">' +
                '<input type="checkbox" value="' + esc(p.id) + '">' +
                '<span class="req-avatar" aria-hidden="true">' + esc(initials(p.name)) + '</span>' +
                '<span class="req-member-name"><strong>' + esc(p.name) + '</strong>' +
                  '<span class="req-member-meta">' + (no ? '<span class="att-mono">' + esc(no) + '</span> · ' : '') +
                  (p.role === 'teamLeader' ? 'Team Leader role' : 'Worker') + '</span></span>' +
                (other ? '<span class="req-tag req-tag--muted">In ' + esc(other) + '</span>'
                       : p.role === 'teamLeader' ? '<span class="req-tag">Can lead</span>' : '') +
              '</label>';
        }).join('');
        return '<footer class="req-team-add">' +
            '<button class="att-btn" type="button" data-act="open-add"><i data-lucide="user-plus"></i> Add members</button>' +
          '</footer>' +
          '<div class="req-picker" data-picker hidden>' +
            '<div class="req-picker-search"><i data-lucide="search"></i>' +
              '<input type="search" class="att-input" data-pick-q placeholder="Search by name or worker number" aria-label="Search workers to add to ' + esc(t.name) + '"></div>' +
            (rows ? '<div class="req-pick-list">' + rows + '<div class="req-pick-none" data-pick-none hidden>No worker matches that search.</div></div>'
                  : '<div class="req-pick-none">Everyone is already in this team.</div>') +
            '<div class="req-picker-foot"><span data-pick-count>None selected</span>' +
              '<span class="req-picker-btns">' +
                '<button class="att-btn" type="button" data-act="close-add">Cancel</button>' +
                '<button class="att-btn att-btn--primary" type="button" data-act="add-selected" data-pick-go>Add to team</button>' +
              '</span></div>' +
          '</div>';
    }

    function teamCard(t, people, teams) {
        const memberIds = t.members.map(m => m.worker_id);
        const candidates = people.filter(p => !memberIds.includes(p.id));
        // pr_office_teams sends names only; the roster number comes from the
        // people list (active workers). A deactivated member shows no number.
        const numberOf = (id) => { const p = people.find(x => x.id === id); return p ? RA.workerNo(p.worker_no) : ''; };
        const leader = t.members.find(validLeader) || null;
        const badMark = t.members.find(m => m.is_leader && m.leader_problem) || null;
        const anyMark = t.members.some(m => m.is_leader);
        const canLead = t.members.filter(m => m.role === 'teamLeader' && !m.is_leader);
        const n = t.members.length;
        const search = (t.name + ' ' + t.members.map(m => m.name + ' ' + numberOf(m.worker_id)).join(' ')).toLowerCase();

        // Leader first; then team leaders; then workers, A–Z.
        const rank = (m) => (validLeader(m) ? 0 : m.role === 'teamLeader' ? 1 : 2);
        const members = t.members.slice().sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));

        let leaderLine;
        if (!t.active) {
            leaderLine = '<div class="req-team-lead req-team-lead--off"><i data-lucide="pause-circle"></i>' +
                '<span>Inactive — this team can\'t send requests.</span>' +
                (anyMark ? '<button class="req-link" type="button" data-act="clear-mark">Clear old leader mark</button>' : '') + '</div>';
        } else if (leader) {
            leaderLine = '<div class="req-team-lead"><i data-lucide="badge-check"></i>' +
                '<span>Led by <strong>' + esc(leader.name) + '</strong></span>' +
                '<button class="req-link" type="button" data-act="unlead">Remove as leader</button></div>';
        } else {
            leaderLine = '<div class="req-team-lead req-team-lead--warn"><i data-lucide="alert-triangle"></i>' +
                '<span><strong>' + (badMark ? 'No valid leader.' : 'No leader.') + '</strong> ' +
                (badMark ? esc(badMark.name) + ' ' + LEADER_PROBLEM[badMark.leader_problem] + ' ' : '') + NO_LEADER_NOTE +
                (canLead.length ? ' Pick one below.' : ' Add someone with the Team Leader role.') + '</span>' +
                (badMark ? '<button class="req-link" type="button" data-act="clear-mark">Clear leader mark</button>' : '') + '</div>';
        }

        const rows = members.map(m => {
            const no = numberOf(m.worker_id);
            return '<li class="req-member' + (validLeader(m) ? ' is-leader' : '') + '">' +
                '<span class="req-avatar" aria-hidden="true">' + esc(initials(m.name)) + '</span>' +
                '<span class="req-member-name"><strong>' + esc(m.name) + '</strong>' +
                  '<span class="req-member-meta">' + (no ? '<span class="att-mono">' + esc(no) + '</span> · ' : '') +
                  (m.role === 'teamLeader' ? 'Team Leader role' : 'Worker') + '</span></span>' +
                '<span class="req-member-tools">' +
                  (validLeader(m) ? '<span class="att-pill att-pill--done">Leader</span>'
                    : m.is_leader ? '<span class="att-pill att-pill--none">Can\'t lead</span>' : '') +
                  (t.active && m.role === 'teamLeader' && !m.is_leader
                    ? '<button class="att-btn req-btn-sm" type="button" data-act="lead" data-worker="' + esc(m.worker_id) + '">Make leader</button>' : '') +
                  '<button class="req-icon-btn" type="button" data-act="remove" data-worker="' + esc(m.worker_id) + '"' +
                    ' aria-label="Remove ' + esc(m.name) + ' from ' + esc(t.name) + '" title="Remove from team"><i data-lucide="x"></i></button>' +
                '</span></li>';
        }).join('');

        return '<section class="req-team' + (t.active ? '' : ' is-inactive') + (t.active && !leader ? ' is-leaderless' : '') + '"' +
                ' data-team="' + esc(t.id) + '" data-search="' + esc(search) + '">' +
            '<header class="req-team-head">' +
              '<div class="req-team-title"><h3>' + esc(t.name) + '</h3>' +
                '<span class="req-team-count">' + n + ' member' + (n === 1 ? '' : 's') + '</span></div>' +
              '<div class="req-team-tools">' +
                (t.active ? '' : '<span class="att-pill att-pill--hidden">Inactive</span>') +
                '<button class="req-icon-btn" type="button" data-act="edit-team" aria-label="Edit ' + esc(t.name) + '" title="Rename or deactivate"><i data-lucide="pencil"></i></button>' +
              '</div>' +
            '</header>' +
            leaderLine +
            (n ? '<ul class="req-members">' + rows + '</ul>'
               : '<div class="req-team-empty">No members yet.</div>') +
            (t.active ? pickerHtml(t, candidates, teams) : '') +
          '</section>';
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

    function filterPicker(card) {
        const q = (card.querySelector('[data-pick-q]').value || '').trim().toLowerCase();
        let shown = 0;
        card.querySelectorAll('[data-pick-row]').forEach(r => {
            const hit = !q || r.dataset.q.includes(q);
            r.hidden = !hit;
            if (hit) shown++;
        });
        const none = card.querySelector('[data-pick-none]');
        if (none) none.hidden = shown > 0;
    }

    function updatePickCount(card) {
        const n = card.querySelectorAll('.req-pick-row input:checked').length;
        card.querySelector('[data-pick-count]').textContent = n ? n + ' selected' : 'None selected';
        card.querySelector('[data-pick-go]').textContent = n ? 'Add ' + n + ' to team' : 'Add to team';
    }

    function applyTeamFilter(host) {
        const q = teamUi.text.trim().toLowerCase();
        let shown = 0;
        host.querySelectorAll('.req-team').forEach(card => {
            const hit = !q || card.dataset.search.includes(q);
            card.hidden = !hit;
            if (hit) shown++;
        });
        const none = host.querySelector('[data-team-none]');
        if (none) none.hidden = shown > 0 || !q;
    }

    async function renderTeams(host) {
        host.innerHTML = '<div class="att-stack req-teams"><div class="att-empty">Loading teams…</div></div>';
        let teams, people;
        try { [teams, people] = await Promise.all([RA.rpc('pr_office_teams'), RA.rpc('pr_office_people')]); }
        catch (e) { RA.fail(host, e); return; }
        teams = teams || [];
        people = people || [];
        const rerender = () => renderTeams(host);

        const byName = (a, b) => String(a.name).localeCompare(String(b.name));
        const active = teams.filter(t => t.active);
        const inactive = teams.filter(t => !t.active).sort(byName);
        // Leaderless teams first: they are the ones that need the office.
        active.sort((a, b) => (a.members.some(validLeader) - b.members.some(validLeader)) || byName(a, b));
        const leaderless = active.filter(t => !t.members.some(validLeader)).length;
        const inTeam = new Set();
        active.forEach(t => t.members.forEach(m => inTeam.add(m.worker_id)));
        const unassigned = people.filter(p => !inTeam.has(p.id)).length;

        const stat = (label, value, tone, icon) =>
            '<div class="req-team-stat' + (tone ? ' req-team-stat--' + tone : '') + '">' +
              '<i data-lucide="' + icon + '"></i><div><div class="req-team-stat-v">' + value + '</div>' +
              '<div class="req-team-stat-l">' + label + '</div></div></div>';

        host.innerHTML =
            '<div class="att-stack req-teams">' +
              head('Teams', 'Members can send requests for their team. A leader also sees them and checks the team\'s work. Only people with the Team Leader role can be made leader.',
                   '<button class="att-btn att-btn--primary" type="button" data-new-team><i data-lucide="plus"></i> New team</button>') +
              (teams.length
                ? '<div class="req-team-stats">' +
                    stat('Active teams', active.length, '', 'users') +
                    stat(leaderless === 1 ? 'Team needs a leader' : 'Teams need a leader', leaderless, leaderless ? 'warn' : 'ok', leaderless ? 'alert-triangle' : 'badge-check') +
                    stat('Workers not in a team', unassigned, '', 'user-x') +
                  '</div>' +
                  '<div class="req-team-bar">' +
                    '<label class="req-team-search"><i data-lucide="search"></i>' +
                      '<input type="search" class="att-input" data-team-q placeholder="Search a team or worker" value="' + esc(teamUi.text) + '" aria-label="Search teams and workers"></label>' +
                    (inactive.length ? '<label class="req-toggle"><input type="checkbox" data-team-inactive' + (teamUi.showInactive ? ' checked' : '') + '> Show inactive (' + inactive.length + ')</label>' : '') +
                  '</div>' +
                  (active.length ? '<div class="req-team-grid">' + active.map(t => teamCard(t, people, teams)).join('') + '</div>'
                                 : '<div class="att-empty">No active teams.</div>') +
                  (inactive.length && teamUi.showInactive
                    ? '<h3 class="req-team-section">Inactive teams</h3><div class="req-team-grid">' + inactive.map(t => teamCard(t, people, teams)).join('') + '</div>' : '') +
                  '<div class="att-empty" data-team-none hidden>No team or worker matches that search.</div>'
                : '<div class="att-empty">No teams yet. Create one, add workers, then pick a leader.</div>') +
            '</div>';

        host.querySelector('[data-new-team]').addEventListener('click', () => teamModal(null, rerender));
        const q = host.querySelector('[data-team-q]');
        if (q) q.addEventListener('input', () => { teamUi.text = q.value; applyTeamFilter(host); });
        const inact = host.querySelector('[data-team-inactive]');
        if (inact) inact.addEventListener('change', () => { teamUi.showInactive = inact.checked; rerender(); });
        applyTeamFilter(host);

        host.querySelectorAll('[data-team]').forEach(card => {
            card.addEventListener('input', (e) => { if (e.target.matches('[data-pick-q]')) filterPicker(card); });
            card.addEventListener('change', (e) => { if (e.target.matches('.req-pick-row input')) updatePickCount(card); });
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !card.querySelector('[data-picker]').hidden) card.querySelector('[data-act="close-add"]').click();
            });
        });
        host.querySelectorAll('[data-team]').forEach(card => card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const team = teams.find(t => t.id === card.dataset.team);
            const act = b.dataset.act;
            if (act === 'edit-team') { teamModal(team, rerender); return; }
            if (act === 'open-add' || act === 'close-add') {
                const panel = card.querySelector('[data-picker]');
                const open = act === 'open-add';
                panel.hidden = !open;
                card.querySelector('.req-team-add').hidden = open;
                if (open) { const q = panel.querySelector('[data-pick-q]'); q.value = ''; filterPicker(card); q.focus(); }
                return;
            }
            if (act === 'add-selected') {
                const ids = Array.from(card.querySelectorAll('.req-pick-row input:checked')).map(c => c.value);
                if (!ids.length) { card.querySelector('[data-pick-q]').focus(); return; }
                b.disabled = true;
                const failed = [];
                for (const id of ids) {
                    try { await RA.rpc('pr_office_add_member', { p_team: team.id, p_worker: id }); }
                    catch (err) { const p = people.find(x => x.id === id); failed.push((p ? p.name : 'A worker') + ': ' + RA.errorMessage(err)); }
                }
                if (failed.length) alert('Some people could not be added.\n\n' + failed.join('\n'));
                rerender();
                return;
            }
            let call = null;
            if (act === 'remove') {
                const m = team.members.find(x => x.worker_id === b.dataset.worker);
                if (!confirm('Remove ' + (m ? m.name : 'this person') + ' from ' + team.name + '?' +
                    (m && m.is_leader ? ' The team will have no leader until you pick one. ' + NO_LEADER_NOTE : ''))) return;
                call = ['pr_office_remove_member', { p_team: team.id, p_worker: b.dataset.worker }];
            } else if (act === 'lead') {
                call = ['pr_office_set_leader', { p_team: team.id, p_worker: b.dataset.worker }];
            } else if (act === 'unlead') {
                if (!confirm(team.name + ' will have no leader until you pick one. ' + NO_LEADER_NOTE + ' Continue?')) return;
                call = ['pr_office_set_leader', { p_team: team.id, p_worker: null }];
            } else if (act === 'clear-mark') {
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

    const normText = s => String(s || '').trim().toLowerCase();
    // "ZZ test pipe · 1/2 in" -- the name and size are one item's identity.
    const itemLabel = i => i.name + (i.spec ? ' · ' + i.spec : '');

    // The database refuses a second ACTIVE item with the same kind, name,
    // size and unit (index pr_catalog_identity, 0085). Said here first, so
    // the admin sees which item they would be duplicating instead of an
    // error code after pressing Save.
    function findDuplicate(items, v, selfId) {
        return items.find(i => i.active && i.id !== selfId && i.kind === v.kind &&
            normText(i.name) === normText(v.name) && normText(i.spec) === normText(v.spec) &&
            normText(i.unit) === normText(v.unit)) || null;
    }

    // Existing values first, so "electrical" is picked rather than retyped as
    // "Electrical" and split into two categories.
    function uniqueValues(list, extra) {
        const seen = new Set();
        const out = [];
        list.concat(extra || []).forEach(function (v) {
            const t = String(v || '').trim();
            if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
        });
        return out;
    }

    function itemModal(item, rerender, items) {
        const v = item || { kind: 'material', name: '', spec: '', unit: '', category: '', brand: '', aliases: [], active: true };
        // 0092: once a request uses the item, its kind and unit are fixed
        // (pr_office_save_item refuses ITEM_IN_USE). Locked here before Save.
        const locked = !!(item && item.in_use);
        const categories = uniqueValues(items.map(i => i.category)).sort((a, b) => a.localeCompare(b));
        const units = uniqueValues(items.map(i => i.unit), ['pc', 'bag', 'm', 'kg', 'set', 'roll', 'box', 'sack', 'pail', 'length']);
        const opts = list => list.map(x => '<option value="' + esc(x) + '"></option>').join('');
        RA.modal({
            title: item ? 'Edit item' : 'New item',
            sub: 'One row = one exact item. A different size or unit is a different item.',
            body:
                '<div class="req-im">' +
                  '<div class="req-im-grid">' +
                    '<div class="att-field"><label for="reqKind">Kind</label><select class="att-input" id="reqKind" name="kind"' + (locked ? ' disabled' : '') + '>' +
                      '<option value="material"' + (v.kind === 'material' ? ' selected' : '') + '>Material</option>' +
                      '<option value="tool"' + (v.kind === 'tool' ? ' selected' : '') + '>Tool</option></select></div>' +
                    '<div class="att-field"><label for="reqCat">Category <span class="att-hint-inline">(optional)</span></label>' +
                      '<input class="att-input" id="reqCat" name="category" maxlength="60" list="reqCatList" value="' + esc(v.category) + '" placeholder="e.g. plumbing">' +
                      '<datalist id="reqCatList">' + opts(categories) + '</datalist></div>' +
                    '<div class="att-field req-im-wide"><label for="reqName">Name</label>' +
                      '<input class="att-input" id="reqName" name="name" maxlength="120" required value="' + esc(v.name) + '" placeholder="e.g. PVC pipe"></div>' +
                    '<div class="att-field"><label for="reqSpec">Size / spec <span class="att-hint-inline">(optional)</span></label>' +
                      '<input class="att-input" id="reqSpec" name="spec" maxlength="120" value="' + esc(v.spec) + '" placeholder="e.g. 1/2 in, 3 m"></div>' +
                    '<div class="att-field"><label for="reqUnit">Unit</label>' +
                      '<input class="att-input" id="reqUnit" name="unit" maxlength="30" required list="reqUnitList" value="' + esc(v.unit) + '" placeholder="e.g. pc, bag, m"' + (locked ? ' disabled' : '') + '>' +
                      '<datalist id="reqUnitList">' + opts(units) + '</datalist></div>' +
                    '<div class="att-field req-im-wide"><label for="reqBrand">Brand <span class="att-hint-inline">(optional)</span></label>' +
                      '<input class="att-input" id="reqBrand" name="brand" maxlength="80" value="' + esc(v.brand || '') + '" placeholder="e.g. Omni"></div>' +
                    '<div class="att-field req-im-wide"><label for="reqAliases">Other names workers use <span class="att-hint-inline">(optional — for search only)</span></label>' +
                      '<textarea class="att-input" id="reqAliases" name="aliases" rows="2" placeholder="e.g. saksakan, outlet, plug">' +
                        esc((v.aliases || []).join(', ')) + '</textarea></div>' +
                  '</div>' +
                  (locked ? '<div class="req-im-note req-im-note--hint" data-locked>Already used in requests, so <strong>kind and unit are locked</strong>. To change them, add a new item and deactivate this one.</div>' : '') +
                  (item ? '<label class="req-toggle"><input type="checkbox" name="active"' + (v.active ? ' checked' : '') + '> Active (workers can pick it)</label>' : '') +
                  '<div class="req-im-note" data-note aria-live="polite"></div>' +
                '</div>',
            submitLabel: item ? 'Save' : 'Add item',
            // The form says back what this item is, warns when it would
            // duplicate an active one, and keeps Save off until the item is
            // complete (and, when editing, different from what is saved).
            onOpen: (form) => {
                form.closest('.att-modal-box').classList.add('req-im-box');
                const save = form.querySelector('[data-submit]');
                const note = form.querySelector('[data-note]');
                function current() {
                    return { kind: form.kind.value, name: form.name.value, spec: form.spec.value,
                             unit: form.unit.value, category: form.category.value, brand: form.brand.value,
                             aliases: RA.parseAliases(form.aliases.value).join(', '),
                             active: item ? form.active.checked : true };
                }
                function refresh() {
                    const c = current();
                    const complete = c.name.trim() && c.unit.trim();
                    const dup = c.active ? findDuplicate(items, c, item ? item.id : null) : null;
                    const changed = !item || ['kind', 'name', 'spec', 'unit', 'category', 'brand'].some(k => String(c[k]).trim() !== String(v[k] || '').trim()) ||
                                    c.aliases !== (v.aliases || []).join(', ') || c.active !== v.active;
                    if (dup) {
                        note.className = 'req-im-note req-im-note--bad';
                        note.innerHTML = 'Already in the catalogue: <strong>' + esc(itemLabel(dup)) + '</strong> · ' + esc(dup.unit) +
                            '. Open that item to change it, or make this one different (size or unit).';
                    } else if (complete) {
                        note.className = 'req-im-note';
                        note.innerHTML = 'This item: <strong>' + esc(itemLabel(c)) + '</strong> · ' + esc(c.unit.trim());
                    } else {
                        note.className = 'req-im-note req-im-note--hint';
                        note.textContent = 'Fill in the name and the unit.';
                    }
                    save.disabled = !complete || !!dup || !changed;
                }
                form.addEventListener('input', refresh);
                form.addEventListener('change', refresh);
                refresh();
            },
            onSubmit: async (form) => {
                const aliases = RA.parseAliases(form.aliases.value);
                const problem = RA.aliasesProblem(aliases);
                if (problem) throw new Error(problem);
                await RA.rpc('pr_office_save_item', {
                    p_item: item ? item.id : null,
                    p_kind: form.kind.value,
                    p_name: form.name.value.trim(),
                    p_spec: form.spec.value.trim(),
                    p_unit: form.unit.value.trim(),
                    p_category: form.category.value.trim(),
                    p_active: item ? form.active.checked : true,
                    p_aliases: aliases,
                    p_brand: form.brand.value.trim(),
                });
            },
            onDone: rerender,
        });
    }

    // Office redesign v5: tabs All · Materials · Tools (the kind, with counts),
    // "Show inactive" kept; one card per item; an item opens in the pop-up
    // with its Active switch (same confirm) and Edit….
    async function renderCatalog(host) {
        if (!host.querySelector('.sv')) host.innerHTML = '<div class="att-stack req-catalog"><div class="att-empty">Loading the catalogue…</div></div>';
        let items;
        try { items = await RA.rpc('pr_office_catalog'); } catch (e) { RA.fail(host, e); return; }
        items = (items || []).slice().sort((a, b) =>
            (b.active - a.active) || String(a.name).localeCompare(String(b.name)) || String(a.spec).localeCompare(String(b.spec)));
        const rerender = () => renderCatalog(host);
        const inactiveCount = items.filter(i => !i.active).length;

        async function toggle(item, sw) {
            const next = !item.active;
            if (next && findDuplicate(items, item, item.id)) {
                alert('Another active item already has the same name, size and unit, so this one cannot be turned on.');
                return;
            }
            if (!next && !confirm('Make "' + itemLabel(item) + '" inactive?\n\nWorkers can no longer pick it. You can turn it back on any time.')) return;
            sw.disabled = true;
            try {
                await RA.rpc('pr_office_save_item', {
                    p_item: item.id, p_kind: item.kind, p_name: item.name, p_spec: item.spec || '',
                    p_unit: item.unit, p_category: item.category || '', p_active: next,
                });
                rerender();
            } catch (err) {
                alert(RA.errorMessage(err));
                sw.disabled = false;
            }
        }

        function draw(o) {
            const t = normText(catUi.text);
            const pool = items.filter(i => catUi.showInactive || i.active);
            const list = pool.filter(i => (!catUi.kind || i.kind === catUi.kind) &&
                (!t || [i.name, i.spec, i.unit, i.category, i.brand].concat(i.aliases || []).join(' ').toLowerCase().includes(t)));
            if (o && o.leaveSelection && catUi.sel && !list.some(i => i.id === catUi.sel)) catUi.sel = null;
            let empty;
            if (!items.length) empty = 'No items yet. Workers can only pick what is listed here — add the first one with New item.';
            else empty = 'No item matches. <button class="att-link" type="button" data-clear>Clear filters</button>';
            root.SplitView.render(host, {
                key: 'reqCatalog',
                title: 'Item catalogue',
                sub: 'The materials and tools workers pick from. Unlisted items are matched to an entry here from the request screen.',
                primary: { label: 'New item', onClick: () => itemModal(null, rerender, items) },
                tabs: [['', 'All', pool.length], ['material', 'Materials', pool.filter(i => i.kind === 'material').length],
                       ['tool', 'Tools', pool.filter(i => i.kind === 'tool').length]].map(([id, label, count]) => ({ id: id || 'all', label, count })),
                tab: catUi.kind || 'all',
                onTab: id => { catUi.kind = id === 'all' ? '' : id; draw({ leaveSelection: true }); },
                search: { placeholder: 'Search name, size, unit, category, brand, other names…', value: catUi.text, onInput: v => { catUi.text = v; draw({ leaveSelection: true }); } },
                toolbar: '<label class="req-toggle"><input type="checkbox" data-inactive' + (catUi.showInactive ? ' checked' : '') + '> Show inactive' +
                    (inactiveCount ? ' <span class="req-muted">(' + inactiveCount + ')</span>' : '') + '</label>',
                onToolbar: el => el.querySelector('[data-inactive]').addEventListener('change', e => { catUi.showInactive = e.target.checked; draw({ leaveSelection: true }); }),
                showing: list.length !== pool.length ? 'Showing ' + list.length + ' of ' + pool.length : '',
                groups: [{ title: '', rows: list.map(i => ({
                    id: i.id,
                    title: i.name + (i.spec ? ' · ' + i.spec : ''),
                    sub: (i.kind === 'tool' ? 'Tool' : 'Material') + ' · ' + i.unit + (i.category ? ' · ' + i.category : '') + (i.brand ? ' · ' + i.brand : ''),
                    meta: (i.aliases || []).length ? 'Also called: ' + i.aliases.join(', ') : '',
                    chips: [{ text: i.kind === 'tool' ? 'Tool' : 'Material', tone: i.kind === 'tool' ? 'pm' : 'check' }],
                    pill: i.active ? { text: 'Active', tone: 'done' } : { text: 'Hidden from workers', tone: 'none' },
                    dim: !i.active,
                })) }],
                empty: empty,
                onEmpty: el => {
                    const c = el.querySelector('[data-clear]');
                    if (c) c.addEventListener('click', () => { catUi.text = ''; catUi.kind = ''; catUi.showInactive = false; renderCatalog(host); });
                },
                selectedId: catUi.sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel) => {
                    catUi.sel = id;
                    const i = items.find(x => x.id === id);
                    if (!i) return root.SplitView.error(panel, 'This item is no longer listed.');
                    const body = root.SplitView.page(panel, { kicker: 'Catalogue item', title: i.name + (i.spec ? ' · ' + i.spec : ''),
                        pills: [{ text: i.kind === 'tool' ? 'Tool' : 'Material', tone: i.kind === 'tool' ? 'pm' : 'check' }], nextLabel: 'Next item' });
                    body.innerHTML = root.SplitView.facts([
                            ['Kind', i.kind === 'tool' ? 'Tool' : 'Material'], ['Unit', esc(i.unit)],
                            ['Category', i.category ? esc(i.category) : '<span class="req-muted">—</span>'], ['Brand', i.brand ? esc(i.brand) : ''],
                            ['Also called', (i.aliases || []).length ? esc(i.aliases.join(', ')) : ''],
                        ]) +
                        '<div class="req-cact"><button class="att-switch" type="button" role="switch" aria-checked="' + (i.active ? 'true' : 'false') +
                          '" data-toggle="' + esc(i.id) + '" aria-label="Active: ' + esc(itemLabel(i)) + '" title="' +
                          (i.active ? 'Workers can pick this item.' : 'Hidden from workers.') + '">' +
                          '<span class="att-switch-track"></span><span>' + (i.active ? 'Active' : 'Inactive') + '</span></button>' +
                          ' <span class="req-muted">' + (i.active ? 'Workers can pick this item.' : 'Hidden from workers.') + '</span></div>' +
                        '<div class="wp-actions"><button class="att-btn att-btn--primary" type="button" data-edit="' + esc(i.id) + '">Edit…</button></div>';
                    body.querySelector('[data-toggle]').addEventListener('click', e => toggle(i, e.currentTarget));
                    body.querySelector('[data-edit]').addEventListener('click', () => itemModal(i, rerender, items));
                    RA.icons();
                },
                onClose: () => { catUi.sel = null; },
            });
        }
        draw({ refreshPanel: true });
    }

    // ── Projects ────────────────────────────────────────────────────

    const projUi = { text: '', filter: 'all' };

    // Why a project is open or not. "Workers can request" next to an Allow
    // requests switch that said Off read as a contradiction: the project was
    // open because it is on today's Time In list, and Allow requests is only
    // the override for one that is not. The reason is now part of the status.
    function projectStatus(p) {
        if (p.completed) {
            return { key: 'completed', label: 'Completed', pill: 'att-pill--hidden',
                     why: 'Completed projects never accept requests' };
        }
        if (p.requestable) {
            return { key: 'open', label: 'Open', pill: 'att-pill--done',
                     why: p.allow_requests ? 'Allow requests is on' : 'On today\'s Time In list' };
        }
        return { key: 'closed', label: 'Not open', pill: 'att-pill--working',
                 why: p.hidden_from_time_in ? 'Hidden from Time In' : 'Not on today\'s Time In list' };
    }

    // Office redesign v5: tabs All · Open · Not open · Completed (with counts),
    // "How this works" in the frame, one card per project; a project opens in
    // the pop-up with its two switches (the same handlers and RPCs).
    async function renderProjects(host) {
        if (!host.querySelector('.sv')) host.innerHTML = '<div class="att-stack req-projects"><div class="att-empty">Loading projects…</div></div>';
        let projects;
        try { projects = await RA.rpc('pr_office_projects'); } catch (e) { RA.fail(host, e); return; }
        projects = projects || [];

        const stat = projects.map(p => Object.assign({ p: p }, projectStatus(p)));
        const nOpen = stat.filter(s => s.key === 'open').length;
        const nClosed = stat.filter(s => s.key === 'closed').length;
        const nDone = stat.filter(s => s.key === 'completed').length;
        const nOverride = projects.filter(p => p.allow_requests && !p.completed).length;
        const TONE = { 'att-pill--done': 'done', 'att-pill--working': 'gold', 'att-pill--hidden': 'none' };
        const lede = projects.length ? [projects.length + ' ' + (projects.length === 1 ? 'project' : 'projects'),
            nOpen ? nOpen + ' open to workers' : '', nClosed ? nClosed + ' not open' : '',
            nOverride ? nOverride + ' ' + (nOverride === 1 ? 'override on' : 'overrides on') : '', nDone ? nDone + ' completed' : ''].filter(Boolean).join(' · ') : '';

        async function flip(kind, proj, sw) {
            if (!proj || sw.disabled) return;
            sw.disabled = true;
            try {
                // Item history (0090): its own switch, never touches Allow requests;
                // completed projects keep it (history outlives the job).
                if (kind === 'history') await RA.rpc('pr_office_set_allow_history', { p_folder: proj.folder_id, p_allow: !proj.allow_history });
                else { const project = proj; await RA.rpc('pr_office_set_allow_requests', { p_folder: project.folder_id, p_allow: !project.allow_requests }); }
                projUi.refresh = true;
                renderProjects(host);
            } catch (err) {
                alert(RA.errorMessage(err));
                sw.disabled = false;
            }
        }

        function draw(o) {
            const t = String(projUi.text || '').trim().toLowerCase();
            const list = stat.filter(s => (projUi.filter === 'all' || s.key === projUi.filter) &&
                (!t || String(s.p.name).toLowerCase().includes(t)));
            if (o && o.leaveSelection && projUi.sel && !list.some(s => s.p.folder_id === projUi.sel)) projUi.sel = null;
            root.SplitView.render(host, {
                key: 'reqProjects',
                title: 'Projects open to requests',
                sub: 'Which Project Control projects workers can send requests for.',
                lede: lede,
                how: { title: 'How this works',
                       text: 'A project accepts requests while it is on today\'s Time In list. Allow requests opens one that is not — use it for an upcoming site with no ' +
                             'geofence yet. Completed projects never accept requests. Open Additional Works under a project are offered with it. ' +
                             'Item history is separate: it lets workers browse what was requested on that project before (Find Previous Item), and it stays on after the project is completed.' },
                tabs: [['all', 'All', stat.length], ['open', 'Open', nOpen], ['closed', 'Not open', nClosed], ['completed', 'Completed', nDone]]
                    .map(([id, label, count]) => ({ id, label, count })),
                tab: projUi.filter,
                onTab: id => { projUi.filter = id; draw({ leaveSelection: true }); },
                search: { placeholder: 'Search projects…', value: projUi.text, onInput: v => { projUi.text = v; draw({ leaveSelection: true }); } },
                showing: list.length !== stat.length ? 'Showing ' + list.length + ' of ' + stat.length : '',
                groups: [{ title: '', rows: list.map(s => {
                    const works = Number(s.p.additional_works) || 0;
                    const chips = [];
                    if (s.p.allow_requests && !s.p.completed) chips.push({ text: 'Override on', tone: 'gold' });
                    if (s.p.allow_history) chips.push({ text: 'Item history on', tone: 'check' });
                    return { id: s.p.folder_id, title: s.p.name, sub: s.why, meta: works ? works + ' open Additional Works' : 'No Additional Works',
                             pill: { text: s.label, tone: TONE[s.pill] || 'none' }, chips: chips, dim: s.key === 'completed' };
                }) }],
                empty: !projects.length ? 'No Project Control projects yet.'
                    : 'No project matches. <button class="att-link" type="button" data-clear>Clear filters</button>',
                onEmpty: el => {
                    const c = el.querySelector('[data-clear]');
                    if (c) c.addEventListener('click', () => { projUi.text = ''; projUi.filter = 'all'; renderProjects(host); });
                },
                selectedId: projUi.sel,
                refreshPanel: !!(o && o.refreshPanel),
                onSelect: (id, panel) => {
                    projUi.sel = id;
                    const s = stat.find(x => x.p.folder_id === id);
                    if (!s) return root.SplitView.error(panel, 'This project is no longer listed.');
                    const p = s.p;
                    const on = !!p.allow_requests;
                    const works = Number(p.additional_works) || 0;
                    const body = root.SplitView.page(panel, { kicker: 'Project', title: p.name, pills: [{ text: s.label, tone: TONE[s.pill] || 'none' }], nextLabel: 'Next project' });
                    body.innerHTML = root.SplitView.facts([
                            ['Status', esc(s.label)], ['Why', esc(s.why)],
                            ['Additional Works', works ? '<strong>' + works + ' open</strong>' : '<span class="req-muted">—</span>'],
                        ]) +
                        '<div class="req-pswitches">' +
                          '<div class="req-pswitch"><div><strong>Allow requests</strong> <span class="req-th-hint">override</span><div class="req-muted">' +
                            esc(p.completed ? 'Completed projects never accept requests.' :
                                on ? 'On: open to requests even when not on the Time In list.' : 'Off: open only while on today\'s Time In list.') + '</div></div>' +
                            '<button class="att-switch" type="button" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' +
                            ' data-folder="' + esc(p.folder_id) + '"' + (p.completed ? ' disabled' : '') +
                            ' aria-label="Allow requests: ' + esc(p.name) + '"><span class="att-switch-track"></span><span>' + (on ? 'On' : 'Off') + '</span></button></div>' +
                          '<div class="req-pswitch"><div><strong>Item history</strong> <span class="req-th-hint">Find Previous Item</span><div class="req-muted">' +
                            esc(p.allow_history ? 'On: workers can browse what was requested on this project before.' :
                                'Off: workers do not see this project\'s item history.') + '</div></div>' +
                            '<button class="att-switch" type="button" role="switch" aria-checked="' + (p.allow_history ? 'true' : 'false') + '"' +
                            ' data-history="' + esc(p.folder_id) + '" aria-label="Item history: ' + esc(p.name) + '">' +
                            '<span class="att-switch-track"></span><span>' + (p.allow_history ? 'Workers can browse' : 'Off') + '</span></button></div>' +
                        '</div>';
                    body.querySelector('[data-folder]').addEventListener('click', e => flip('requests', p, e.currentTarget));
                    body.querySelector('[data-history]').addEventListener('click', e => flip('history', p, e.currentTarget));
                    RA.icons();
                },
                onClose: () => { projUi.sel = null; },
            });
        }
        const refresh = !!projUi.refresh;
        projUi.refresh = false;
        draw({ refreshPanel: refresh || true });
    }

    RA.views.reqBatches = renderBatches;
    // Office redesign v5: Teams is already a grid of team cards with their
    // members and buttons, so it keeps its content inside the frame (custom
    // body); the frame draws the header, and the page's own title line is
    // hidden there (css/split-view.css), its New team button stays.
    RA.views.reqTeams = host => root.SplitView.render(host, {
        key: 'reqTeams', title: 'Teams',
        sub: 'Members can send requests for their team. A leader also sees them and checks the team\x27s work. Only people with the Team Leader role can be made leader.',
        search: false, custom: true, onCustom: el => renderTeams(el),
    });
    RA.views.reqCatalog = renderCatalog;
    RA.views.reqProjects = renderProjects;
})(typeof window !== 'undefined' ? window : globalThis);