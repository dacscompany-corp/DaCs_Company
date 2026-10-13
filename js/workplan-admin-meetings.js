// ════════════════════════════════════════════════════════════════════
// Work Plan → Meetings (WorkMate My Work, 0093). Owner + staff.
//
// A meeting holds the office's ORIGINAL notes (never shown to workers).
// "Draft tasks with AI" saves the notes, sends them to the dacs-ai worker
// and lists suggestions; each opens the task form pre-filled, with every
// name it could not match exactly left as "Needs your choice" (spec §4).
// Nothing reaches workers until Publish: the meeting's drafts become live
// tasks and the shared notes go to the chosen people (default: everyone
// assigned a task from this meeting).
//
// Unsaved edits — notes, shared notes, recipients, change note — live in
// `pending` and survive every redraw (adding or editing a task, saving
// notes, AI drafting, a failed AI request). A save or publish forgets only
// the values it actually sent, so text typed while it runs is kept
// (settlePending — in place, so the input handlers' object is never
// swapped out). A slow, older load never draws over the meeting now open
// (loadTickets). AI never overwrites what the office typed: replacing
// shared notes or unadded suggestions asks first. A failed AI request
// redraws the screen with the error, so every button works again. A late
// result never redraws a different meeting. AI suggestions live only in
// this browser tab; leaving the page with unsaved edits asks first.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;

    const suggestions = {};   // meetingId → { shared_notes, items: [{ task, resolved, added }] }
    const pending = {};       // meetingId (or 'new') → unsaved edits
    const loaded = {};        // meetingId (or 'new') → the meeting as last loaded
    const DRAFTING_HTML = '<div class="req-muted">Saving the notes and drafting… this can take up to a minute. You can keep typing; nothing is lost.</div>';
    const drafting = {};      // meetingId → true while a draft request is running (one at a time)
    const aiErrors = {};      // meetingId → the last AI failure, shown until the next attempt
    const tickets = WP.loadTickets();   // only the newest meeting load may draw

    root.addEventListener('beforeunload', e => {
        const dirty = Object.keys(pending).some(id => WP.meetingUnsaved(loaded[id] || {}, pending[id]));
        const unadded = Object.keys(suggestions).some(id => suggestions[id].items.some(it => !it.added));
        if (dirty || unadded) { e.preventDefault(); e.returnValue = ''; }
    });

    // Forget only what was saved. pending[id] is never replaced: the input
    // handlers hold this object, so anything typed since stays.
    function settle(id, sent) {
        WP.settlePending(pending[id], sent);
    }

    function card(title, body, sub, tools) {
        return '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">' + esc(title) + '</div>' +
            (sub ? '<div class="att-card-sub">' + esc(sub) + '</div>' : '') + '</div>' +
            (tools ? '<div class="att-card-tools">' + tools + '</div>' : '') + '</div><div class="att-card-body">' + body + '</div></div>';
    }

    function confirm(title, sub, label, run) {
        WP.modal({ title, sub, submitLabel: label, body: '', onSubmit: async () => {}, onDone: run });
    }

    // ── Meetings list ───────────────────────────────────────────────

    async function renderMeetings(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading meetings…</div></div>';
        let list;
        try { list = await WP.rpc('wp_office_meetings'); } catch (e) { WP.fail(host, e); return; }
        list = list || [];
        const rows = list.map(m =>
            '<tr tabindex="0" data-id="' + esc(m.id) + '">' +
            '<td>' + esc(WP.formatDay(m.held_on)) + '</td>' +
            '<td><strong>' + esc(m.title) + '</strong></td>' +
            '<td>' + (m.current_version
                ? '<span class="att-pill att-pill--done">Published · version ' + esc(m.current_version) + '</span>'
                : '<span class="att-pill att-pill--none">Not published</span>') + '</td>' +
            '<td>' + esc(m.draft_count) + ' draft' + (m.draft_count === 1 ? '' : 's') + ' · ' + esc(m.task_count) + ' task' +
              (m.task_count === 1 ? '' : 's') + '</td>' +
            '<td class="req-go"><i data-lucide="chevron-right"></i></td></tr>').join('');
        host.innerHTML = '<div class="att-stack">' +
            WP.head('Meetings', 'Type or paste the notes, let the AI suggest tasks, check each one, then publish.',
                '<button class="att-btn" type="button" data-board><i data-lucide="clipboard-list"></i> Board</button>' +
                '<button class="att-btn att-btn--primary" type="button" data-new><i data-lucide="plus"></i> New meeting</button>') +
            '<div class="att-card"><div class="att-card-body" style="padding:0">' +
            (list.length
                ? '<div class="req-table-wrap"><table class="att-table req-table"><thead><tr><th>Held on</th><th>Meeting</th>' +
                  '<th>Shared notes</th><th>Tasks</th><th class="req-go"><span class="req-sr">Open</span></th></tr></thead>' +
                  '<tbody data-rows>' + rows + '</tbody></table></div>'
                : '<div class="att-empty">No meetings yet.</div>') +
            '</div></div></div>';
        host.querySelector('[data-board]').addEventListener('click', () => root.switchView('wpBoard'));
        host.querySelector('[data-new]').addEventListener('click', () => WP.openMeeting(null));
        const body = host.querySelector('[data-rows]');
        if (body) {
            body.addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) WP.openMeeting(tr.dataset.id); });
            body.addEventListener('keydown', e => {
                const tr = e.target.closest('tr[data-id]');
                if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); WP.openMeeting(tr.dataset.id); }
            });
        }
        WP.icons();
    }

    // ── One meeting ─────────────────────────────────────────────────

    function notesFields(f) {
        return '<div class="att-field att-span"><label for="wpmTitle">Meeting</label>' +
              '<input class="att-input" id="wpmTitle" data-title maxlength="200" value="' + esc(f.title) + '"></div>' +
            '<div class="att-field att-span"><label for="wpmDate">Held on</label>' +
              '<input class="att-input" type="date" id="wpmDate" data-date value="' + esc(f.held_on) + '"></div>' +
            '<div class="att-field att-span"><label for="wpmNotes">Original notes <span class="att-hint-inline">(office only — never shown to workers)</span></label>' +
              '<textarea class="att-input" id="wpmNotes" data-notes rows="10">' + esc(f.notes) + '</textarea></div>';
    }

    // Exactly what is on screen (the same values `pending` holds), so a
    // finished save can tell what was sent from what was typed since.
    function readNotes(host) {
        return {
            title: host.querySelector('[data-title]').value,
            held_on: host.querySelector('[data-date]').value,
            notes: host.querySelector('[data-notes]').value,
        };
    }

    async function saveNotes(id, f) {
        const r = await WP.rpc('wp_office_save_meeting', { p_meeting: id || null, p_title: f.title.trim(), p_held_on: f.held_on || null,
                                                            p_original_notes: f.notes });
        return r.meeting_id;
    }

    // Record every edit as it is typed, so a redraw can put it back.
    function track(host, id) {
        const p = pending[id] || (pending[id] = {});
        const bind = (selector, key, ev) => {
            const el = host.querySelector(selector);
            if (el) el.addEventListener(ev || 'input', () => { p[key] = el.value; });
        };
        bind('[data-title]', 'title');
        bind('[data-date]', 'held_on', 'change');
        bind('[data-notes]', 'notes');
        bind('[data-shared]', 'shared');
        bind('[data-change]', 'change');
        const recips = host.querySelector('[data-recips]');
        host.querySelectorAll('[name="wpmRecip"]').forEach(r => r.addEventListener('change', () => {
            p.recip = r.value;
            if (recips) recips.hidden = r.value !== 'choose';
        }));
        host.querySelectorAll('[name="wpmPerson"]').forEach(b => b.addEventListener('change', () => {
            p.people = Array.from(host.querySelectorAll('[name="wpmPerson"]')).filter(x => x.checked).map(x => x.value);
        }));
        return p;
    }

    function renderNew(host) {
        loaded.new = { held_on: WP.todayManila() };
        const f = WP.meetingFields(loaded.new, pending.new);
        host.innerHTML = '<div class="att-stack">' +
            '<div class="req-actions"><button class="att-btn" type="button" data-back><i data-lucide="arrow-left"></i> Meetings</button></div>' +
            WP.head('New meeting', 'Save the notes first; then draft tasks with AI or add them by hand.') +
            card('Notes', notesFields(f) +
                '<div class="req-actions"><button class="att-btn att-btn--primary" type="button" data-save>Save meeting</button></div>') +
            '</div>';
        track(host, 'new');
        host.querySelector('[data-back]').addEventListener('click', () => root.switchView('wpMeetings'));
        host.querySelector('[data-save]').addEventListener('click', async e => {
            e.target.disabled = true;
            const sent = readNotes(host);
            try {
                const newId = await saveNotes(null, sent);
                const rest = pending.new ? WP.settlePending(pending.new, sent) : {};   // typed while saving: carried over
                delete pending.new;
                if (Object.keys(rest).length) pending[newId] = rest;
                if (WP.state.meetingId === null) {                    // still on this screen
                    WP.state.meetingId = newId;
                    renderMeeting(host);
                }
            } catch (err) { root.alert(WP.errorMessage(err)); e.target.disabled = false; }
        });
        WP.icons();
    }

    function suggestionsHtml(s, error) {
        const note = '<div class="req-muted">Suggestions stay only in this browser tab until you add them as drafts. ' +
            'Reloading the page discards suggestions you have not added; saved notes and draft tasks stay.</div>';
        const failed = error ? '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' + esc(error) +
            '</div></div>' : '';
        if (!s) return failed + '<div class="req-muted">No AI suggestions yet. You can also add tasks by hand below.</div>' + note;
        return failed + note +
            (s.shared_notes
                ? '<div class="wp-row"><div><strong>Suggested shared notes</strong><p class="wp-text">' + esc(s.shared_notes) + '</p></div>' +
                  '<button class="att-btn" type="button" data-use-notes>Use as shared notes</button></div>'
                : '') +
            (s.items.length
                ? s.items.map((it, i) =>
                    '<div class="wp-row' + (it.added ? ' is-added' : '') + '"><div><strong>' + esc(it.task.title) + '</strong>' +
                    '<div class="req-muted">' + esc([it.task.project || 'No project', it.task.work,
                        it.task.responsible ? 'Responsible: ' + it.task.responsible : ''].filter(Boolean).join(' · ')) + '</div>' +
                    (it.resolved.flags.length ? '<ul class="wp-flags">' + it.resolved.flags.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '') +
                    (it.task.source_passage ? '<blockquote class="wp-passage">' + esc(it.task.source_passage) + '</blockquote>' : '') +
                    '</div>' +
                    (it.added
                        ? '<span class="att-pill att-pill--done">Added as draft</span>'
                        : '<button class="att-btn att-btn--primary" type="button" data-ai-add="' + i + '">Review and add…</button>') +
                    '</div>').join('')
                : '<div class="req-muted">The AI found no tasks in these notes.</div>');
    }

    function tasksHtml(m) {
        const tasks = m.tasks || [];
        if (!tasks.length) return '<div class="req-muted">No tasks yet.</div>';
        return tasks.map(t =>
            '<div class="wp-row"><div><strong>' + esc(t.title) + '</strong><div class="req-muted">' +
            esc(t.project_name + ' · ' + t.work_name + (t.responsible ? ' · ' + t.responsible.name : ' · no responsible person yet')) + '</div></div>' +
            '<div><span class="att-pill ' + WP.statusPill(t) + '">' + esc(WP.statusLabel(t)) + '</span> ' +
            '<button class="att-link" type="button" data-task="' + esc(t.id) + '">Open</button></div></div>').join('');
    }

    function publishHtml(m, f, L) {
        const drafts = (m.tasks || []).filter(t => t.status === 'draft');
        return '<div class="att-field att-span"><label for="wpmShared">Shared notes <span class="att-hint-inline">(workers read this — no prices, pay or private matters; check it yourself, the AI is not enough)</span></label>' +
              '<textarea class="att-input" id="wpmShared" data-shared rows="6">' + esc(f.shared) + '</textarea></div>' +
            '<fieldset class="wp-recipients att-span"><legend>Who receives the notes</legend>' +
              '<label class="req-toggle"><input type="radio" name="wpmRecip" value="default"' + (f.recip !== 'choose' ? ' checked' : '') + '>' +
                ' Everyone assigned a task from this meeting</label>' +
              '<label class="req-toggle"><input type="radio" name="wpmRecip" value="choose"' + (f.recip === 'choose' ? ' checked' : '') + '>' +
                ' Choose people</label>' +
              '<div class="wp-checks" data-recips' + (f.recip === 'choose' ? '' : ' hidden') + '>' + L.people.map(p =>
                '<label class="req-toggle"><input type="checkbox" name="wpmPerson" value="' + esc(p.id) + '"' +
                (f.people.includes(p.id) ? ' checked' : '') + '> ' +
                esc(p.name + (WP.workerNo(p.worker_no) ? ' · ' + WP.workerNo(p.worker_no) : '')) + '</label>').join('') + '</div>' +
            '</fieldset>' +
            (m.current_version
                ? '<div class="att-field att-span"><label for="wpmChange">What changed <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="wpmChange" data-change maxlength="300" value="' + esc(f.change) + '"></div>'
                : '') +
            '<div class="req-muted">' + (drafts.length
                ? drafts.length + ' draft task' + (drafts.length === 1 ? '' : 's') + ' will be published with the notes. Each needs a responsible person.'
                : 'No draft tasks — this publishes the notes only.') + '</div>' +
            '<div class="req-actions"><button class="att-btn att-btn--primary" type="button" data-publish>Publish…</button></div>';
    }

    function versionsHtml(m) {
        const versions = m.versions || [];
        if (!versions.length) return '<div class="req-muted">Not published yet.</div>';
        return '<ul class="wp-list">' + versions.map(v =>
            '<li><strong>Version ' + esc(v.version) + '</strong> <span class="req-muted">' + esc(WP.formatManila(v.published_at)) + ' · ' +
            esc(v.published_by) + '</span>' + (v.change_note ? '<div>' + esc(v.change_note) + '</div>' : '') +
            '<div class="req-muted">To: ' + esc((v.recipients || []).map(r => r.name).join(', ') || 'no one') + '</div></li>').join('') + '</ul>';
    }

    async function renderMeeting(host) {
        const id = WP.state.meetingId;
        const ticket = tickets.take();            // a newer load — another meeting, or New meeting — wins
        if (!id) { renderNew(host); return; }
        const current = () => tickets.isLatest(ticket) && WP.state.meetingId === id;
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the meeting…</div></div>';
        let m, L;
        try { [m, L] = await Promise.all([WP.rpc('wp_office_meeting', { p_meeting: id }), WP.loadLookups(true)]); }
        catch (e) { if (current()) WP.fail(host, e); return; }
        if (!current()) return;                   // an older load answered late: draw nothing
        loaded[id] = m;
        const f = WP.meetingFields(m, pending[id]);
        // Only redraw if this meeting is still the one open.
        const rerender = () => { if (WP.state.meetingId === id) renderMeeting(host); };
        const s = suggestions[id];

        host.innerHTML = '<div class="att-stack">' +
            '<div class="req-actions"><button class="att-btn" type="button" data-back><i data-lucide="arrow-left"></i> Meetings</button></div>' +
            WP.head(m.title, WP.formatDay(m.held_on) + (m.current_version
                ? ' · shared notes published (version ' + m.current_version + ')' : ' · not published yet')) +
            card('Notes', notesFields(f) +
                '<div class="req-actions"><button class="att-btn" type="button" data-save>Save notes</button></div>') +
            card('AI drafts', '<div data-ai>' + (drafting[id] ? DRAFTING_HTML : suggestionsHtml(s, aiErrors[id])) + '</div>',
                'Saves the notes, then sends them to Cloudflare\'s AI to suggest tasks. Nothing reaches workers until you review and publish.',
                '<button class="att-btn att-btn--primary" type="button" data-ai-run' + (drafting[id] ? ' disabled' : '') + '><i data-lucide="sparkles"></i> ' +
                (s ? 'Draft again' : 'Draft tasks with AI') + '</button>') +
            card('Tasks from this meeting', tasksHtml(m), '',
                '<button class="att-btn" type="button" data-add><i data-lucide="plus"></i> Add task by hand</button>') +
            card('Publish', publishHtml(m, f, L)) +
            card('Published versions', versionsHtml(m)) +
            '</div>';
        const p = track(host, id);

        host.querySelector('[data-back]').addEventListener('click', () => root.switchView('wpMeetings'));
        host.querySelector('[data-save]').addEventListener('click', async e => {
            e.target.disabled = true;
            const sent = readNotes(host);
            try { await saveNotes(id, sent); settle(id, sent); rerender(); }
            catch (err) { root.alert(WP.errorMessage(err)); e.target.disabled = false; }
        });

        const runDraft = async (button) => {
            const sent = readNotes(host);
            if (!sent.notes.trim()) { root.alert(WP.errorMessage(new Error('NO_NOTES'))); return; }
            if (sent.notes.length > WP.NOTES_MAX) { root.alert(WP.errorMessage(new Error('NOTES_TOO_LONG'))); return; }
            if (drafting[id]) return;
            drafting[id] = true;
            button.disabled = true;
            delete aiErrors[id];
            host.querySelector('[data-ai]').innerHTML = DRAFTING_HTML;
            try {
                await saveNotes(id, sent);
                settle(id, sent);
                const ctx = { projects: L.projects, people: L.people, teams: L.teams, heldOn: sent.held_on };
                const d = await WP.aiDraft(sent.notes, ctx);
                suggestions[id] = { shared_notes: d.shared_notes,
                                    items: d.tasks.map(t => ({ task: t, resolved: WP.resolveDraft(t, ctx), added: false })) };
            } catch (err) {
                // Earlier suggestions stay; the redraw shows why and wires every button again.
                aiErrors[id] = WP.errorMessage(err);
            } finally {
                delete drafting[id];
            }
            rerender();
        };
        host.querySelector('[data-ai-run]').addEventListener('click', e => {
            const button = e.currentTarget;
            if (s && s.items.some(it => !it.added)) {
                confirm('Draft again?', 'The suggestions you have not added yet will be replaced. Added drafts and your notes stay.',
                        'Draft again', () => runDraft(button));
            } else {
                runDraft(button);
            }
        });

        const useNotes = host.querySelector('[data-use-notes]');
        if (useNotes) useNotes.addEventListener('click', () => {
            const box = host.querySelector('[data-shared]');
            const apply = () => { box.value = s.shared_notes; p.shared = box.value; };
            if (box.value.trim() && box.value !== s.shared_notes) {
                confirm('Replace your shared notes?', 'What you wrote in Shared notes will be replaced by the AI suggestion.', 'Replace', apply);
            } else {
                apply();
            }
        });
        host.querySelectorAll('[data-ai-add]').forEach(b => b.addEventListener('click', () => {
            const it = s.items[Number(b.dataset.aiAdd)];
            WP.openTaskForm({ meetingId: id, values: it.resolved.values, onDone: () => { it.added = true; rerender(); } });
        }));
        host.querySelector('[data-add]').addEventListener('click', () => WP.openTaskForm({ meetingId: id, onDone: rerender }));
        host.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => WP.openTask(b.dataset.task)));

        host.querySelector('[data-publish]').addEventListener('click', () => {
            const choose = host.querySelector('[name="wpmRecip"]:checked').value === 'choose';
            const people = Array.from(host.querySelectorAll('[name="wpmPerson"]')).filter(x => x.checked).map(x => x.value);
            const changeEl = host.querySelector('[data-change]');
            // What this publish sends — afterwards only these are forgotten.
            const sent = { shared: host.querySelector('[data-shared]').value, recip: choose ? 'choose' : 'default', people,
                           change: changeEl ? changeEl.value : '' };
            WP.modal({
                title: 'Publish to workers?',
                sub: 'Draft tasks become live in My Work; the shared notes go to ' +
                     (choose ? people.length + ' chosen ' + (people.length === 1 ? 'person' : 'people') : 'everyone assigned a task from this meeting') + '.',
                submitLabel: 'Publish', body: '',
                onSubmit: async () => {
                    if (choose && !people.length) throw new Error('NO_RECIPIENTS');
                    await WP.rpc('wp_office_publish', { p_meeting: id, p_tasks: (m.tasks || []).filter(t => t.status === 'draft').map(t => t.id), p_shared_notes: sent.shared,
                                                        p_recipients: choose ? people : null, p_change_note: sent.change.trim() });
                },
                onDone: () => { settle(id, sent); rerender(); },
            });
        });
        WP.icons();
    }

    WP.views.wpMeetings = renderMeetings;
    WP.views.wpMeeting = renderMeeting;
})(window);
