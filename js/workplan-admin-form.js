// ════════════════════════════════════════════════════════════════════
// Work Plan → the task form (create / edit). Owner + staff.
//
// One form for every screen: a new standalone task, a draft from a
// meeting, an AI suggestion to review, or editing a task. It always sends
// the FULL task (wp_office_save_task replaces every field), so:
//   * a field the AI could not match reads "Needs your choice" and Save
//     refuses until the office picks (NEEDS_CHOICE);
//   * every helper and every "waits for" link the task already has stays
//     on screen and is kept unless the office unticks it — including a
//     link to a task completed long ago (not on the Board, fetched here);
//   * the task's own project, work and team stay selectable even when
//     closed or inactive, so an edit never silently changes them;
//   * on a published task the form shows, before saving, whether people
//     must read it again. The server decides (0094): people, team and
//     dates always; wording unless "only a spelling correction".
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;
    const CHOOSE = WP.CHOOSE;

    let cache = null;
    async function loadLookups(force) {
        if (cache && !force) return cache;
        const [projects, people, teams] = await Promise.all([
            WP.rpc('wp_office_destinations'), WP.rpc('pr_office_people'), WP.rpc('pr_office_teams'),
        ]);
        cache = { projects: projects || [], people: people || [], teams: (teams || []).filter(t => t.active) };
        return cache;
    }

    // Keep the task's own project, work and team selectable.
    function withCurrent(L, doc) {
        if (!doc) return L;
        const projects = L.projects.slice();
        let i = projects.findIndex(x => x.folder_id === doc.folder_id);
        if (i < 0) {
            projects.push({ folder_id: doc.folder_id, name: doc.project_name + ' (closed)', works: [] });
            i = projects.length - 1;
        }
        if (doc.work_id && doc.work_id !== doc.folder_id && !(projects[i].works || []).some(w => w.work_id === doc.work_id)) {
            projects[i] = Object.assign({}, projects[i], {
                works: (projects[i].works || []).concat([{ work_id: doc.work_id, name: doc.work_name + ' (closed)' }]),
            });
        }
        const teams = L.teams.slice();
        if (doc.team_id && !teams.some(t => t.id === doc.team_id)) {
            teams.push({ id: doc.team_id, name: (doc.team_name || 'Team') + ' (inactive)', members: [] });
        }
        return { projects, people: L.people, teams };
    }

    function personLabel(p) {
        return p.name + (WP.workerNo(p.worker_no) ? ' · ' + WP.workerNo(p.worker_no) : '');
    }
    function opt(value, label, selected) {
        return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }
    function chooseOpt() {
        return '<option value="' + CHOOSE + '" selected>Needs your choice…</option>';
    }
    function check(name, value, label, on) {
        return '<label class="req-toggle"><input type="checkbox" name="' + name + '" value="' + esc(value) + '"' +
            (on ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }
    // half = sits beside its neighbour (two columns); otherwise full width.
    // `hint` is one plain sentence under the box: what to put here.
    function field(id, label, inner, unresolved, half, required, hint) {
        return '<div class="att-field' + (half ? '' : ' att-span') + '"><label for="' + id + '">' + esc(label) +
            (required ? ' <span class="wp-req" aria-hidden="true">*</span>' : '') +
            (unresolved ? ' <span class="wp-chip wp-chip--red" data-needs>Needs your choice</span>' : '') +
            '</label>' + inner + (hint ? '<span class="wp-hint">' + esc(hint) + '</span>' : '') + '</div>';
    }
    // The form reads top to bottom as the task is thought of: what, where, who, when.
    // A numbered part with one line saying what it is for.
    function section(num, title, help) {
        return '<div class="wp-sec att-span"><span class="wp-sec-num" aria-hidden="true">' + num + '</span>' +
            '<span class="wp-sec-title">' + esc(title) + '</span></div>' +
            (help ? '<p class="wp-sec-help att-span">' + esc(help) + '</p>' : '');
    }
    function confirmBox(key, text) {
        return '<label class="req-toggle wp-confirm"><input type="checkbox" name="check_' + key + '"> ' + esc(text) + '</label>';
    }

    function formHtml(v, L, published, fresh) {
        const checks = v.checks || [];
        return (
            // What the AI or the meeting left for the office to check comes
            // first: it changes how the rest is filled in.
            ((v.office_flags || []).length
                ? '<div class="att-info att-info--warn att-span"><i data-lucide="flag"></i><div><strong>To check:</strong>' +
                  '<ul class="wp-flags">' + v.office_flags.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
                  '<label class="req-toggle"><input type="checkbox" name="clear_flags"> All checked — clear these notes</label></div></div>'
                : '') +
            (v.source_passage
                ? '<div class="att-field att-span"><span class="wp-lbl">From the meeting notes</span>' +
                  '<blockquote class="wp-passage">' + esc(v.source_passage) + '</blockquote></div>'
                : '') +

            // Only on a brand-new task: say what is asked of the person, once.
            (fresh
                ? '<div class="att-info att-span wp-intro"><i data-lucide="info"></i><div><strong>Four short parts: what, where, who and when.</strong> ' +
                  'Only the title and the project are needed (marked <span class="wp-req">*</span>). ' +
                  'Everything else can wait, and you can change it all before you publish.</div></div>'
                : '') +

            section('1', 'What needs to be done', 'Give the task a short name, then explain it the way you would tell the worker.') +
            field('wpfTitle', 'Task title', '<input class="att-input" id="wpfTitle" name="title" maxlength="200" placeholder="e.g. Install ceiling lights, 2nd floor" value="' + esc(v.title) + '">', false, false, true, 'Keep it short. Workers read this first.') +
            field('wpfInstr', 'Instructions', '<textarea class="att-input" id="wpfInstr" name="instructions" rows="5" placeholder="What the worker should do, and anything they must know.">' + esc(v.instructions) + '</textarea>', false, false, false,
                'Optional. Say what to do, which part of the site, and anything to be careful about.') +

            section('2', 'Where is the work', 'Choose the project this task belongs to.') +
            field('wpfFolder', 'Project',
                '<select class="att-input" id="wpfFolder" name="folder"' + (published ? ' disabled' : '') + '>' +
                (v.folder_id === CHOOSE ? chooseOpt() : '<option value="">Choose a project…</option>') +
                L.projects.map(p => opt(p.folder_id, p.name, v.folder_id)).join('') + '</select>' +
                (published ? '<span class="att-hint-inline">A published task keeps its project.</span>' : ''),
                v.folder_id === CHOOSE, true, true) +
            field('wpfWork', 'Main Contract or Additional Works',
                '<select class="att-input" id="wpfWork" name="work"' + (published ? ' disabled' : '') + '></select>',
                v.work_id === CHOOSE, true, true, 'Pick Main Contract unless the task is for an Additional Work.') +

            section('3', 'Who will do it', 'Workers see the task in their WorkMate app, under My Work, once you publish it.') +
            field('wpfTeam', 'Team',
                '<select class="att-input" id="wpfTeam" name="team">' + (v.team_id === CHOOSE ? chooseOpt() : '') +
                '<option value="">No team (individual task)</option>' +
                L.teams.map(t => opt(t.id, t.name, v.team_id)).join('') + '</select>', v.team_id === CHOOSE, true, false, 'Choose a team if a group does the task together. Otherwise leave it as it is.') +
            field('wpfResp', 'Responsible person', '<select class="att-input" id="wpfResp" name="responsible"></select>',
                v.responsible_id === CHOOSE, true, false, 'The main person for this task. You can choose later, but choose someone before you publish.') +
            '<div class="att-field att-span"><div class="wp-helper-head"><span class="wp-lbl">Helpers <span class="att-hint-inline">optional</span></span>' +
              '<span class="wp-count" data-helper-count></span></div>' +
              '<span class="wp-hint">Tick anyone who will help with this task.</span>' +
              '<input class="att-input wp-helper-search" type="search" data-helper-search placeholder="Find a person…" aria-label="Find a helper" hidden>' +
              '<div class="wp-checks" data-helpers></div>' +
              (checks.includes('helpers') ? confirmBox('helpers', 'I have checked the helpers (the AI named someone it could not match)') : '') +
            '</div>' +

            section('4', 'When', 'Optional. Leave the dates empty if there is no fixed date.') +
            field('wpfStart', 'Planned start', '<input class="att-input" type="date" id="wpfStart" name="planned_start" value="' + esc(v.planned_start) + '">', false, true, false, 'The day the work should begin.') +
            field('wpfEnd', 'Planned end', '<input class="att-input" type="date" id="wpfEnd" name="planned_end" value="' + esc(v.planned_end) + '">', false, true, false, 'The day it should be finished.') +
            '<div class="wp-inline-err att-span" data-date-err hidden>The end date is before the start date.</div>' +
            (checks.includes('dates')
                ? '<div class="att-field att-span">' + confirmBox('dates', 'I have checked the dates (the notes were unclear)') + '</div>' : '') +

            // Rarely needed, so it starts closed -- unless the task already
            // waits for something, which must stay in view.
            '<details class="wp-adv att-span" data-adv' + ((v.depends_on || []).length ? ' open' : '') + '>' +
              '<summary>Waits for other tasks <span class="att-hint-inline">optional</span></summary>' +
              '<div class="att-hint-inline wp-adv-hint">Use this only if this task cannot start until another task is finished. Only tasks of the same project are listed. Untick a task to remove its link.</div>' +
              '<div class="wp-checks" data-deps></div>' +
            '</details>' +

            (fresh
                ? '<div class="att-info att-span"><i data-lucide="arrow-right"></i><div><strong>What happens next:</strong> after you save, ' +
                  'the task stays a draft that only the office can see. Open it and press Publish when it is ready for the workers.</div></div>'
                : '') +

            (published
                ? '<div class="att-field att-span" data-revision aria-live="polite"></div>' +
                  field('wpfChange', 'What changed (optional, shown in the history)',
                        '<input class="att-input" id="wpfChange" name="change_note" maxlength="300">')
                : '')
        );
    }

    function read(form, v) {
        const el = n => form.querySelector('[name="' + n + '"]');
        const val = n => (el(n) ? el(n).value : '');
        const all = n => Array.from(form.querySelectorAll('[name="' + n + '"]'));
        const resp = val('responsible');
        const clear = el('clear_flags');
        const minor = el('minor_text_only');
        return {
            meeting_id: v.meeting_id, folder_id: val('folder'), work_id: val('work'), team_id: val('team'),
            responsible_id: resp,
            helper_ids: WP.keepSelections(v.helper_ids, all('helper').map(b => b.value),
                                          all('helper').filter(b => b.checked).map(b => b.value)).filter(id => id !== resp),
            depends_on: WP.keepSelections(v.depends_on, all('dep').map(b => b.value),
                                          all('dep').filter(b => b.checked).map(b => b.value)),
            title: val('title'), instructions: val('instructions'),
            planned_start: val('planned_start'), planned_end: val('planned_end'),
            source_passage: v.source_passage,
            office_flags: clear && clear.checked ? [] : v.office_flags,
            checks: (v.checks || []).filter(k => !(el('check_' + k) && el('check_' + k).checked)),
            minor_text_only: !!(minor && minor.checked),
            change_note: val('change_note'),
        };
    }

    function wire(form, v, L, o) {
        const sel = n => form.querySelector('[name="' + n + '"]');
        const ticked = n => Array.from(form.querySelectorAll('[name="' + n + '"]')).filter(b => b.checked).map(b => b.value);
        const workMustChoose = v.work_id === CHOOSE;
        const names = {};
        L.people.forEach(p => { names[p.id] = personLabel(p); });
        if (o.doc) {
            if (o.doc.responsible && !names[o.doc.responsible.id]) names[o.doc.responsible.id] = o.doc.responsible.name + ' (not available — choose again)';
            (o.doc.helpers || []).forEach(h => { if (!names[h.id]) names[h.id] = h.name + ' (not available — untick)'; });
        }

        const publishedTask = !!o.doc && o.doc.status !== 'draft';
        function fillWorks() {
            const p = L.projects.find(x => x.folder_id === sel('folder').value);
            const works = p ? [{ work_id: p.folder_id, name: 'Main Contract' }].concat(p.works || []) : [];
            const current = v.work_id === CHOOSE ? CHOOSE : (v.work_id || (p ? p.folder_id : ''));
            // Before a project is chosen the list is empty: say so, instead of a blank box.
            const waiting = !p && current !== CHOOSE;
            sel('work').innerHTML = waiting
                ? '<option value="">Choose a project first</option>'
                : (current === CHOOSE ? chooseOpt() : '') + works.map(w => opt(w.work_id, w.name, current)).join('');
            sel('work').disabled = publishedTask || waiting;
        }

        // Helpers: a search box once the list is long, and a count of who is ticked.
        const helperSearch = form.querySelector('[data-helper-search]');
        function applyHelperFilter() {
            const q = helperSearch.value.trim().toLowerCase();
            form.querySelectorAll('[data-helpers] label').forEach(l => { l.hidden = !!q && !l.textContent.toLowerCase().includes(q); });
            const n = ticked('helper').length;
            form.querySelector('[data-helper-count]').textContent = n ? n + ' selected' : '';
        }

        function checkDates() {
            const a = sel('planned_start').value, b = sel('planned_end').value;
            form.querySelector('[data-date-err]').hidden = !(a && b && b < a);
        }
        function pool() {
            const team = L.teams.find(t => t.id === sel('team').value);
            return team ? L.people.filter(p => (team.members || []).some(m => m.worker_id === p.id)) : L.people;
        }
        const labelFor = (id, ps) => (names[id] || 'Unknown person') + (ps.some(p => p.id === id) ? '' : ' — not in this team');

        let helpersDrawn = false;
        function fillPeople() {
            const ps = pool();
            const respEl = sel('responsible');
            const resp = respEl.options.length ? respEl.value : v.responsible_id;
            const ids = ps.map(p => p.id);
            if (resp && resp !== CHOOSE && !ids.includes(resp)) ids.push(resp);   // never drop the current person silently
            respEl.innerHTML = (resp === CHOOSE ? chooseOpt() : '') +
                '<option value="">No one yet (choose before publishing)</option>' +
                ids.map(id => opt(id, labelFor(id, ps), resp)).join('');
            const chosen = respEl.value;
            const keep = helpersDrawn ? ticked('helper') : v.helper_ids;
            const helperIds = ps.map(p => p.id);
            v.helper_ids.concat(keep).forEach(id => { if (!helperIds.includes(id)) helperIds.push(id); });
            form.querySelector('[data-helpers]').innerHTML =
                helperIds.filter(id => id !== chosen).map(id => check('helper', id, labelFor(id, ps), keep.includes(id))).join('') ||
                '<span class="req-muted">No one else to add.</span>';
            helpersDrawn = true;
            helperSearch.hidden = helperIds.length <= 8;
            if (helperSearch.hidden) helperSearch.value = '';
            applyHelperFilter();
        }

        let depsDrawn = false;
        function fillDeps() {
            const keep = depsDrawn ? ticked('dep') : v.depends_on;
            const ids = o.others.filter(t => t.folder_id === sel('folder').value).map(t => t.id);
            v.depends_on.concat(keep).forEach(id => { if (!ids.includes(id)) ids.push(id); });
            form.querySelector('[data-deps]').innerHTML = ids.map(id => {
                const t = o.depInfo[id];
                const label = t ? t.title + ' · ' + WP.statusLabel(t) + (o.others.some(x => x.id === id) ? '' : ' (completed earlier)')
                                : 'A task that is no longer available';
                return check('dep', id, label, keep.includes(id));
            }).join('') || '<span class="req-muted">No other task in this project.</span>';
            depsDrawn = true;
        }

        let lastRevision = '';
        function showRevision() {
            const box = form.querySelector('[data-revision]');
            if (!box) return;
            const r = WP.revisionChanges(o.doc, read(form, v));
            const key = r.changes.join(',') + '|' + r.text;
            if (key === lastRevision) return;
            lastRevision = key;
            const minor = form.querySelector('[name="minor_text_only"]');
            const wasMinor = !!(minor && minor.checked);
            if (r.changes.length) {
                box.innerHTML = '<div class="att-info att-info--warn"><i data-lucide="refresh-cw"></i><div>Saving makes a ' +
                    '<strong>new version</strong>: everyone on the task must read it again. Changed: ' +
                    esc((r.text ? ['instructions'] : []).concat(r.changes).join(', ')) + '.</div></div>';
            } else if (r.text) {
                box.innerHTML = '<div class="att-info"><i data-lucide="refresh-cw"></i><div>Saving the new wording makes a ' +
                    '<strong>new version</strong> that everyone must read again.' +
                    '<label class="req-toggle"><input type="checkbox" name="minor_text_only"' + (wasMinor ? ' checked' : '') + '>' +
                    ' Only a spelling correction — keep the current version</label></div></div>';
            } else {
                box.innerHTML = '<div class="req-muted">Nothing changed yet that needs a new reading.</div>';
            }
            WP.icons();
        }

        fillWorks(); fillPeople(); fillDeps(); showRevision();
        sel('folder').addEventListener('change', () => { v.work_id = workMustChoose ? CHOOSE : ''; fillWorks(); fillDeps(); });
        sel('team').addEventListener('change', fillPeople);
        sel('responsible').addEventListener('change', fillPeople);
        form.addEventListener('change', e => {
            const chip = e.target.closest('.att-field') && e.target.closest('.att-field').querySelector('[data-needs]');
            if (chip && e.target.tagName === 'SELECT' && e.target.value !== CHOOSE) chip.remove();
            applyHelperFilter();
            checkDates();
            showRevision();
        });
        form.addEventListener('input', showRevision);
        helperSearch.addEventListener('input', applyHelperFilter);
        checkDates();
    }

    // opts: { taskId, doc, values, meetingId, onDone(savedDoc) }
    async function openTaskForm(opts) {
        const o = opts || {};
        let L, board;
        const depInfo = {};
        try {
            [L, board] = await Promise.all([loadLookups(true), WP.rpc('wp_office_board', { p_folder: null })]);
            (board || []).forEach(t => { depInfo[t.id] = t; });
            // A link to a task completed more than 30 days ago is not on the
            // Board: fetch it so the form shows it and keeps it.
            const missing = ((o.doc && o.doc.depends_on) || []).filter(id => !depInfo[id]);
            (await Promise.all(missing.map(id => WP.rpc('wp_office_task', { p_task: id })))).forEach(t => { depInfo[t.id] = t; });
        } catch (e) { root.alert(WP.errorMessage(e)); return; }
        const v = Object.assign({ meeting_id: o.meetingId || '', folder_id: '', work_id: '', team_id: '', responsible_id: '',
            helper_ids: [], depends_on: [], title: '', instructions: '', planned_start: '', planned_end: '',
            source_passage: '', office_flags: [], checks: [] }, o.doc ? WP.docToForm(o.doc) : {}, o.values || {});
        const published = !!o.doc && o.doc.status !== 'draft';
        const look = withCurrent(L, o.doc);
        const others = (board || []).filter(t => t.id !== o.taskId && t.status !== 'cancelled');
        let saved = null;
        WP.modal({
            title: o.taskId ? 'Edit task' : 'New task',
            sub: o.taskId ? '' : 'Saved as a draft. Workers see it only after you publish.',
            submitLabel: o.taskId ? 'Save' : 'Save as draft',
            body: formHtml(v, look, published, !o.taskId && !o.meetingId),
            onOpen: form => {
                form.closest('.att-modal-box').classList.add('wp-form-box');
                wire(form, v, look, { doc: o.doc, others, depInfo });
            },
            onSubmit: async form => {
                const values = read(form, v);
                const problem = WP.taskProblem(values);
                if (problem) throw new Error(problem);
                const r = await WP.rpc('wp_office_save_task', { p_task: o.taskId || null, p_data: WP.buildTaskPayload(values) });
                saved = r && r.task;
            },
            onDone: () => { if (o.onDone) o.onDone(saved); },
        });
    }

    WP.loadLookups = loadLookups;
    WP.openTaskForm = openTaskForm;
})(window);