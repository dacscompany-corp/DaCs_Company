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
//
// Office redesign v5: the meetings are cards (tabs Needs you · All
// meetings); a meeting — and New meeting — opens in the frame's pop-up
// through its page shell (WP.renderMeetingPanel). Closing the pop-up loses
// nothing: unsaved edits and AI suggestions stay in this tab's memory.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;
    const SV = root.SplitView;
    const NEW = WP.NEW_MEETING || '__new';

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

    // One of the frame's sections (v5): its title with its own buttons beside
    // it (the fields they read are on this page), an optional line under it,
    // then its content.
    function sec(title, body, sub, tools) {
        return '<section class="sv-sec wp-sec">' +
            '<div class="wp-sec-head"><div class="sv-sec-title">' + esc(title) + '</div>' +
              (tools ? '<div class="wp-sec-tools">' + tools + '</div>' : '') + '</div>' +
            (sub ? '<div class="wp-sec-sub">' + esc(sub) + '</div>' : '') +
            body + '</section>';
    }

    function confirm(title, sub, label, run) {
        WP.modal({ title, sub, submitLabel: label, body: '', onSubmit: async () => {}, onDone: run });
    }

    // ── Meetings list (cards) ───────────────────────────────────────

    const ui = { tab: null, text: '', selectedId: null };
    let visitTab = null;
    let host = null;
    let list = null;
    const loads = SV && SV.seq ? SV.seq() : { next() { return 0; }, isLatest() { return true; } };

    function cardOf(m) {
        const tasks = (m.draft_count ? m.draft_count + ' draft' + (m.draft_count === 1 ? '' : 's') : '') +
            (m.draft_count && m.task_count ? ' · ' : '') +
            (m.task_count ? m.task_count + ' task' + (m.task_count === 1 ? '' : 's') : '');
        return {
            id: m.id,
            title: m.title,
            sub: 'Held on ' + WP.formatDay(m.held_on),
            meta: tasks || 'No tasks yet',
            right: WP.formatDay(m.held_on),
            pill: m.current_version ? { text: 'Published · version ' + m.current_version, tone: 'done' } : { text: 'Not published', tone: 'none' },
            chips: m.draft_count ? [{ text: 'Draft tasks waiting', tone: 'gold' }] : [],
        };
    }

    function emptyHtml() {
        return '<div class="wp-empty-body"><h3 class="wp-empty-title">No meetings yet</h3>' +
            '<p class="wp-empty-sub">Paste the notes from your meeting. The AI suggests the tasks; you check them before anything reaches workers.</p>' +
            '<button class="att-btn att-btn--primary" type="button" data-new><i data-lucide="plus"></i> New meeting</button></div>';
    }

    function openNew() { ui.selectedId = NEW; draw(); }

    function draw(opts) {
        if (!host || !list) return;
        const text = String(ui.text || '').trim().toLowerCase();
        const shown = list.filter(m => !text || String(m.title || '').toLowerCase().includes(text));
        const tabs = [
            { id: 'needs', label: 'Needs you', count: shown.filter(m => m.draft_count > 0).length, needs: true,
              help: 'Meetings with draft tasks waiting to be published.' },
            { id: 'all', label: 'All meetings', count: shown.length },
        ];
        if (!ui.tab && !visitTab) visitTab = SV.pickDefaultTab(tabs, null);
        const tab = ui.tab || visitTab;
        const inTab = tab === 'needs' ? shown.filter(m => m.draft_count > 0) : shown;
        if (opts && opts.leaveSelection && ui.selectedId && ui.selectedId !== NEW && !inTab.some(m => m.id === ui.selectedId)) ui.selectedId = null;
        const waiting = list.filter(m => m.draft_count > 0).length;
        let empty;
        if (!list.length) empty = emptyHtml();
        else if (text && !inTab.length) empty = 'No meeting matches this search. <button class="att-link" type="button" data-clear>Clear filters</button>';
        else empty = tab === 'needs' ? 'Nothing here. You\'re done.' : 'Nothing in this tab.';

        root.SplitView.render(host, {
            key: 'wpMeetings',
            title: 'Meetings',
            sub: list.length
                ? list.length + (list.length === 1 ? ' meeting' : ' meetings') + '. Type or paste the notes, let the AI suggest tasks, check each one, then publish.'
                : 'Type or paste the notes, let the AI suggest tasks, check each one, then publish.',
            primary: { label: 'New meeting', onClick: openNew },
            more: [{ label: 'Board', icon: 'clipboard-list', onClick: () => root.switchView('wpBoard') }],
            lede: waiting ? waiting + (waiting === 1 ? ' meeting has' : ' meetings have') + ' draft tasks waiting — ' +
                'Open it, check each draft, then publish so workers see the tasks and the notes.' : '',
            tabs: tabs,
            tab: tab,
            onTab: id => { ui.tab = id; draw({ leaveSelection: true }); },
            search: { placeholder: 'Search meetings…', value: ui.text, onInput: t => { ui.text = t; draw({ leaveSelection: true }); } },
            showing: text ? 'Showing ' + shown.length + ' of ' + list.length : '',
            groups: [{ title: '', rows: inTab.map(cardOf) }],
            empty: empty,
            onEmpty: el => {
                const add = el.querySelector('[data-new]');
                if (add) add.addEventListener('click', openNew);
                const clear = el.querySelector('[data-clear]');
                if (clear) clear.addEventListener('click', () => { ui.text = ''; draw({ leaveSelection: true }); });
            },
            selectedId: ui.selectedId,
            refreshPanel: !!(opts && opts.refreshPanel),
            onSelect: (id, panel) => {
                ui.selectedId = id;
                renderMeetingPanel(panel, id, {
                    nextLabel: 'Next meeting',
                    // A new meeting was saved: open it in the pop-up.
                    onCreated: newId => { ui.selectedId = newId; load({ refreshPanel: true }); },
                    // Tasks or publishing changed the list: refresh the cards,
                    // never the open meeting (it redraws itself).
                    onListChanged: () => load(),
                });
            },
            // The pop-up closed: forget the meeting — never redraw from here.
            // Unsaved edits and suggestions stay (pending, suggestions).
            onClose: () => { ui.selectedId = null; },
        });
    }

    async function load(opts) {
        if (!host) return;
        const mine = loads.next();
        if (!list) host.innerHTML = '<div class="sv"><div class="sv-empty">Loading meetings…</div></div>';
        let rows;
        try { rows = await WP.rpc('wp_office_meetings'); } catch (e) { if (loads.isLatest(mine)) WP.fail(host, e); return; }
        if (!loads.isLatest(mine)) return;
        list = rows || [];
        if (root.NavCounts) root.NavCounts.set('meetings', list.filter(m => m.draft_count > 0).length);
        if (opts && opts.reveal && ui.selectedId && ui.selectedId !== NEW) {
            const m = list.find(x => x.id === ui.selectedId);
            const shown = ui.tab || visitTab || 'needs';
            if (m && shown === 'needs' && !(m.draft_count > 0)) ui.tab = 'all';
        }
        draw({ refreshPanel: !!(opts && opts.refreshPanel) });
    }

    function renderMeetings(el) {
        host = el;
        visitTab = null;
        let reveal = false;
        if (WP.state.meetingId) {
            ui.selectedId = WP.state.meetingId;
            WP.state.meetingId = null;
            reveal = true;
        }
        load({ reveal: reveal, refreshPanel: true });
    }

    // ── One meeting ─────────────────────────────────────────────────

    function notesFields(f) {
        return '<div class="wp-notes-top">' +
            '<div class="att-field"><label for="wpmTitle">Meeting</label>' +
              '<input class="att-input" id="wpmTitle" data-title maxlength="200" value="' + esc(f.title) + '"></div>' +
            '<div class="att-field"><label for="wpmDate">Held on</label>' +
              '<input class="att-input" type="date" id="wpmDate" data-date value="' + esc(f.held_on) + '"></div></div>' +
            '<div class="att-field"><label for="wpmNotes">Original notes <span class="att-hint-inline">(office only — never shown to workers)</span></label>' +
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

    function renderNew(panel, hooks) {
        loaded.new = { held_on: WP.todayManila() };
        const f = WP.meetingFields(loaded.new, pending.new);
        const host = SV.page(panel, { kicker: 'Meeting', title: 'New meeting', sub: 'Save the notes first; then draft tasks with AI or add them by hand.' });
        host.innerHTML = '<div class="wp wp-meeting wp-meeting--new">' +
            sec('Notes', notesFields(f) +
                '<div class="wp-actions"><button class="att-btn att-btn--primary" type="button" data-save>Save meeting</button></div>') +
            '</div>';
        track(host, 'new');
        host.querySelector('[data-save]').addEventListener('click', async e => {
            e.target.disabled = true;
            const sent = readNotes(host);
            try {
                const newId = await saveNotes(null, sent);
                const rest = pending.new ? WP.settlePending(pending.new, sent) : {};   // typed while saving: carried over
                delete pending.new;
                if (Object.keys(rest).length) pending[newId] = rest;
                // Still showing the new meeting: open the saved one.
                if (panel.isConnected && panel.dataset.svId === NEW && hooks.onCreated) hooks.onCreated(newId);
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
        if (!tasks.length) return '<div class="wp-pad req-muted">No tasks yet. Draft them with AI, or add one by hand.</div>';
        return '<ul class="wp-mtasks">' + tasks.map(t =>
            '<li><div class="wp-mtask-main"><strong>' + esc(t.title) + '</strong><div class="req-muted">' +
            esc(t.project_name + ' · ' + t.work_name) + '</div>' +
            '<div class="req-muted">' + (t.responsible ? esc(t.responsible.name) : '<span class="wp-late">No responsible person yet</span>') + '</div></div>' +
            '<div class="wp-mtask-side"><span class="att-pill ' + WP.statusPill(t) + '">' + esc(WP.statusLabel(t)) + '</span>' +
            '<button class="att-link" type="button" data-task="' + esc(t.id) + '">Open</button></div></li>').join('') + '</ul>';
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
            '<div class="wp-actions"><button class="att-btn att-btn--primary" type="button" data-publish>Publish…</button></div>';
    }

    function versionsHtml(m) {
        const versions = m.versions || [];
        if (!versions.length) return '<div class="req-muted">Not published yet.</div>';
        return '<ul class="wp-list wp-versions">' + versions.map(v =>
            '<li><strong>Version ' + esc(v.version) + '</strong> <span class="req-muted">' + esc(WP.formatManila(v.published_at)) + ' · ' +
            esc(v.published_by) + '</span>' + (v.change_note ? '<div>' + esc(v.change_note) + '</div>' : '') +
            '<div class="req-muted">To: ' + esc((v.recipients || []).map(r => r.name).join(', ') || 'no one') + '</div></li>').join('') + '</ul>';
    }

    // One meeting in the pop-up's panel. hooks: { nextLabel, onCreated(id)
    // (New meeting saved), onListChanged() (refresh the cards only) }.
    async function renderMeetingPanel(panel, id, hooks) {
        hooks = hooks || {};
        const ticket = tickets.take();            // a newer load — another meeting, or New meeting — wins
        if (id === NEW) { renderNew(panel, hooks); return; }
        // Only the newest load may draw, and only while the pop-up still
        // shows this meeting (not closed, not replaced by another item).
        const showing = () => panel.isConnected && panel.dataset.svId === id;
        const current = () => tickets.isLatest(ticket) && showing();
        if (!panel.dataset.svRestore) panel.innerHTML = '<div class="sv-panel-empty">Loading the meeting…</div>';
        let m, L;
        try { [m, L] = await Promise.all([WP.rpc('wp_office_meeting', { p_meeting: id }), WP.loadLookups(true)]); }
        catch (e) { if (current()) SV.error(panel, WP.errorMessage(e)); return; }
        if (!current()) return;                   // an older load answered late: draw nothing
        loaded[id] = m;
        const f = WP.meetingFields(m, pending[id]);
        // Only redraw if this meeting is still the one open; the cards
        // behind refresh too (draft and task counts).
        const rerender = () => {
            if (!showing()) return;
            renderMeetingPanel(panel, id, hooks);
            if (hooks.onListChanged) hooks.onListChanged();
        };
        const s = suggestions[id];

        const drafts = (m.tasks || []).filter(t => t.status === 'draft').length;
        const nv = (m.versions || []).length;
        const sections =
            sec('Notes', notesFields(f) +
                '<div class="wp-actions"><button class="att-btn" type="button" data-save>Save notes</button></div>') +
            sec('AI drafts', '<div data-ai>' + (drafting[id] ? DRAFTING_HTML : suggestionsHtml(s, aiErrors[id])) + '</div>',
                'Saves the notes, then sends them to Cloudflare\'s AI to suggest tasks. Nothing reaches workers until you review and publish.',
                '<button class="att-btn att-btn--primary" type="button" data-ai-run' + (drafting[id] ? ' disabled' : '') + '><i data-lucide="sparkles"></i> ' +
                (s ? 'Draft again' : 'Draft tasks with AI') + '</button>') +
            sec('Tasks from this meeting', tasksHtml(m), '',
                '<button class="att-btn" type="button" data-add><i data-lucide="plus"></i> Add task</button>') +
            sec('Publish', publishHtml(m, f, L)) +
            '<details class="sv-sec sv-hist"' + (nv <= 3 ? ' open' : '') + '><summary class="sv-sec-title">Published versions <span class="sv-hist-n">' + nv +
              '</span></summary>' + versionsHtml(m) + '</details>';

        // "What to do now" is the sentence alone: Publish… reads the shared
        // notes and recipients on this page, so it stays below.
        const host = SV.page(panel, {
            kicker: 'Meeting · held on ' + WP.formatDay(m.held_on),
            title: m.title,
            pills: [m.current_version ? { text: 'Published · version ' + m.current_version, tone: 'done' } : { text: 'Not published', tone: 'none' }],
            sub: WP.formatDay(m.held_on) + (m.current_version
                ? ' · shared notes published (version ' + m.current_version + ')' : ' · not published yet'),
            step: drafts ? SV.nextStep(drafts + ' draft task' + (drafts === 1 ? '' : 's') +
                ' waiting to be published. Check each one, make sure it has a responsible person, then use Publish.', '') : '',
            nextLabel: hooks.nextLabel,
        });
        host.innerHTML = '<div class="wp wp-meeting">' + sections + '</div>';
        const p = track(host, id);

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

    // D5: the red count on Meetings — meetings with draft tasks waiting.
    if (root.NavCounts) {
        root.NavCounts.register('meetings', async () => ((await WP.rpc('wp_office_meetings')) || []).filter(m => m.draft_count > 0).length);
    }
    WP.renderMeetingPanel = renderMeetingPanel;
})(window);