// ════════════════════════════════════════════════════════════════════
// Work Plan (WorkMate My Work, 0093/0094) — shared core for the office.
//
// The office (owner + staff) turns meeting notes into tasks, publishes
// them with shared notes, and checks the work:
//   js/workplan-admin-form.js     — the task form (create / edit)
//   js/workplan-admin-board.js    — the Board: the office lists
//   js/workplan-admin-task.js     — one task: people, problems, photos, decisions
//   js/workplan-admin-meetings.js — meetings, AI drafts, publishing
// Every change goes through an office RPC; nothing here writes a table.
// NO MONEY anywhere. AI only suggests: names are filled in only on ONE
// exact match, and the office reviews every draft before saving.
//
// Reuses js/requests-admin-core.js (load it first). Works in a browser
// (window.WorkPlanAdmin, window.initWorkPlanModule) and in Node for
// tests/workplan-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    const IN_NODE = typeof module !== 'undefined' && module.exports;
    const RAP = IN_NODE ? require('./requests-admin-core.js') : root.RequestsAdmin;
    if (!RAP) return;

    // ── Task states ─────────────────────────────────────────────────

    const STATUS_LABEL = {
        draft: 'Draft', not_started: 'Not started', in_progress: 'In progress', reported_done: 'Reported done',
        leader_checked: 'Leader checked', completed: 'Completed', cancelled: 'Cancelled',
    };
    const STATUS_PILL = {
        draft: 'att-pill--none', not_started: 'att-pill--hidden', in_progress: 'att-pill--working',
        reported_done: 'att-pill--pc', leader_checked: 'att-pill--pc', completed: 'att-pill--done', cancelled: 'att-pill--hidden',
    };
    const LIVE = ['not_started', 'in_progress', 'reported_done', 'leader_checked'];

    // A draft a team leader proposed reads "Proposal" until the office acts.
    function statusLabel(t) {
        if (t.status === 'draft' && t.proposed_by) return 'Proposal';
        return STATUS_LABEL[t.status] || String(t.status || '');
    }
    function statusPill(t) {
        if (t.status === 'draft' && t.proposed_by) return 'att-pill--pm';
        return STATUS_PILL[t.status] || 'att-pill--none';
    }

    // Planned days are calendar days: read their parts, never a time zone.
    function plannedLabel(t) {
        const s = t.planned_start ? RAP.formatDay(t.planned_start) : '';
        const e = t.planned_end ? RAP.formatDay(t.planned_end) : '';
        if (s && e) return s === e ? s : s + ' – ' + e;
        if (e) return 'By ' + e;
        if (s) return 'From ' + s;
        return '—';
    }

    // ── The office lists (spec §15) ─────────────────────────────────

    // One heading per task; the first that matches wins, in this order.
    const GROUPS = [
        { key: 'check',   title: 'Waiting for your check',          test: t => t.status === 'reported_done' || t.status === 'leader_checked' },
        { key: 'blocked', title: 'Blocked',                         test: t => !!t.blocked && (t.status === 'not_started' || t.status === 'in_progress') },
        { key: 'unacked', title: 'Not acknowledged after 24 hours', test: t => !!t.not_acknowledged_24h },
        { key: 'overdue', title: 'Overdue',                         test: t => !!t.overdue },
        { key: 'active',  title: 'Not started and in progress',     test: t => t.status === 'not_started' || t.status === 'in_progress' },
        { key: 'drafts',  title: 'Drafts and proposals',            test: t => t.status === 'draft' },
        { key: 'done',    title: 'Completed in the last 30 days',   test: t => t.status === 'completed' },
    ];

    function boardGroups(tasks) {
        const out = GROUPS.map(g => ({ key: g.key, title: g.title, tasks: [] }));
        (tasks || []).forEach(t => {
            const i = GROUPS.findIndex(g => g.test(t));
            if (i >= 0) out[i].tasks.push(t);
        });
        return out.filter(g => g.tasks.length);
    }

    function alertCounts(tasks) {
        const all = tasks || [];
        const live = all.filter(t => LIVE.includes(t.status));
        return {
            check: live.filter(t => t.status === 'reported_done' || t.status === 'leader_checked').length,
            blocked: live.filter(t => t.blocked).length,
            unacked: live.filter(t => t.not_acknowledged_24h).length,
            overdue: live.filter(t => t.overdue).length,
            proposals: all.filter(t => t.status === 'draft' && t.proposed_by).length,
        };
    }

    function norm(s) {
        return String(s === null || s === undefined ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function filterBoard(tasks, opts) {
        const o = opts || {};
        const text = norm(o.text);
        return (tasks || []).filter(t => {
            if (o.folder && t.folder_id !== o.folder) return false;
            if (!text) return true;
            const hay = [t.title, t.project_name, t.work_name, t.team_name, t.responsible && t.responsible.name]
                .concat((t.helpers || []).map(h => h.name)).join(' ');
            return norm(hay).includes(text);
        });
    }

    // ── The task form ───────────────────────────────────────────────

    const DAY = /^\d{4}-\d{2}-\d{2}$/;

    // A field the office must still choose (an AI name that matched no
    // name, or more than one). Never sent to the server.
    const CHOOSE = '?';
    const CHOICE_FIELDS = ['folder_id', 'work_id', 'team_id', 'responsible_id'];

    // The server's own checks, so the office hears about them before Save.
    function taskProblem(v) {
        if (CHOICE_FIELDS.some(k => v[k] === CHOOSE) || (v.checks || []).length) return 'NEEDS_CHOICE';
        if (!String(v.title || '').trim()) return 'TITLE_REQUIRED';
        if (!v.folder_id || !v.work_id) return 'BAD_DESTINATION';
        if ((v.planned_start && !DAY.test(v.planned_start)) || (v.planned_end && !DAY.test(v.planned_end))) return 'BAD_DATES';
        if (v.planned_start && v.planned_end && v.planned_end < v.planned_start) return 'BAD_DATES';
        if (v.responsible_id && (v.helper_ids || []).includes(v.responsible_id)) return 'BAD_PERSON';
        return null;
    }

    const uniq = a => Array.from(new Set((a || []).filter(Boolean)));

    // wp_office_save_task is a FULL save: every field, arrays never null.
    function buildTaskPayload(v) {
        const out = {
            folder_id: v.folder_id,
            work_id: v.work_id,
            title: String(v.title || '').trim(),
            instructions: String(v.instructions || '').trim(),
            helper_ids: uniq(v.helper_ids),
            depends_on: uniq(v.depends_on),
            office_flags: Array.isArray(v.office_flags) ? v.office_flags.slice() : [],
            source_passage: String(v.source_passage || ''),
        };
        ['meeting_id', 'team_id', 'responsible_id', 'planned_start', 'planned_end'].forEach(k => { if (v[k]) out[k] = v[k]; });
        if (v.minor_text_only) out.minor_text_only = true;
        const note = String(v.change_note || '').trim();
        if (note) out.change_note = note;
        return out;
    }

    function docToForm(d) {
        return {
            meeting_id: d.meeting_id || '', folder_id: d.folder_id || '', work_id: d.work_id || '', team_id: d.team_id || '',
            responsible_id: d.responsible ? d.responsible.id : '',
            helper_ids: (d.helpers || []).map(h => h.id), depends_on: (d.depends_on || []).slice(),
            title: d.title || '', instructions: d.instructions || '',
            planned_start: d.planned_start || '', planned_end: d.planned_end || '',
            source_passage: d.source_passage || '',
            office_flags: Array.isArray(d.office_flags) ? d.office_flags.slice() : [],
            checks: [],
        };
    }

    // What saving would change for the people on a PUBLISHED task — the
    // same rule as wp_office_save_task (0094): people, team and planned
    // dates always need a new reading; wording (`text`) does unless the
    // office marks it a minor spelling correction.
    function revisionChanges(doc, v) {
        if (!doc || doc.status === 'draft') return { changes: [], text: false };
        const sameSet = (a, b) => {
            const x = uniq(a).sort(), y = uniq(b).sort();
            return x.length === y.length && x.every((e, i) => e === y[i]);
        };
        const changes = [];
        if ((v.responsible_id || '') !== (doc.responsible ? doc.responsible.id : '')
            || !sameSet(v.helper_ids, (doc.helpers || []).map(h => h.id))) changes.push('people');
        if ((v.team_id || '') !== (doc.team_id || '')) changes.push('team');
        if ((v.planned_start || '') !== (doc.planned_start || '') || (v.planned_end || '') !== (doc.planned_end || '')) changes.push('planned dates');
        const text = String(v.title || '').trim() !== String(doc.title || '')
                  || String(v.instructions || '').trim() !== String(doc.instructions || '');
        return { changes, text };
    }

    // A full save sends every link. Anything the office did not see on
    // screen stays; only what it unticked goes.
    function keepSelections(original, shown, ticked) {
        const seen = new Set(shown || []);
        return uniq((original || []).filter(id => !seen.has(id)).concat(ticked || []));
    }

    // ── Unsaved meeting edits ───────────────────────────────────────

    // The screen's fields: the server copy, overlaid with what the office
    // typed but has not saved yet (survives redraws, not a reload).
    function meetingFields(m, pending) {
        const s = m || {};
        const latest = (s.versions || [])[0] || null;   // newest first
        return Object.assign({ title: s.title || '', held_on: s.held_on || '', notes: s.original_notes || '',
                               shared: latest ? latest.shared_notes || '' : '', recip: 'default', people: [], change: '' },
                             pending || {});
    }

    function meetingUnsaved(m, pending) {
        const saved = meetingFields(m);
        return Object.keys(pending || {}).some(k => JSON.stringify(pending[k]) !== JSON.stringify(saved[k]));
    }

    // After a save or publish: forget only the edits that were sent, IN
    // PLACE. The screen's input handlers keep writing to this same object,
    // so text typed while the save ran — or after it, while the AI is
    // still drafting — is never lost. Returns the same object.
    function settlePending(pending, sent) {
        if (!pending) return pending;
        Object.keys(sent || {}).forEach(k => {
            if (k in pending && JSON.stringify(pending[k]) === JSON.stringify(sent[k])) delete pending[k];
        });
        return pending;
    }

    // Each screen load takes a ticket; only the newest ticket may draw, so a
    // slow answer for a meeting or task the office has left never replaces
    // the one now open.
    function loadTickets() {
        let last = 0;
        return { take: () => ++last, isLatest: ticket => ticket === last };
    }

    // ── History and problems ────────────────────────────────────────

    const BLOCKER_KIND = { materials: 'Materials', tool: 'Tool', preparation: 'Preparation', other: 'Other' };
    function blockerKind(k) { return BLOCKER_KIND[k] || String(k || ''); }

    const EVENT_TEXT = {
        drafted: 'Drafted', proposed: 'Proposed by a team leader', edited: 'Edited',
        revised: 'Revised — everyone on the task must read it again', published: 'Published',
        acknowledged: 'Read it ("I\'ve read this")', started: 'Started work', progress: 'Progress',
        blocker_reported: 'Reported a problem', blocker_cleared: 'Problem cleared', reported_done: 'Reported done',
        leader_checked: 'Leader checked', sent_back: 'Sent back', approved: 'Approved — completed', reopened: 'Reopened',
        cancelled: 'Cancelled', photo_attached: 'Added a photo', meeting_created: 'Meeting created',
        notes_published: 'Shared notes published',
    };
    function eventText(ev) {
        const base = EVENT_TEXT[ev && ev.kind] || String((ev && ev.kind) || '');
        return ev && ev.note ? base + ' — ' + ev.note : base;
    }

    // ── Error codes → sentences ─────────────────────────────────────

    const ERRORS = {
        OFFICE_ONLY: 'Only active office accounts (owner or staff) can do this.',
        NOT_FOUND: 'This task or meeting no longer exists, or belongs to another company. Reload the page.',
        TITLE_REQUIRED: 'Give it a title.',
        BAD_DATES: 'Check the dates: use real days, and the end cannot be before the start.',
        BAD_DESTINATION: 'Choose an open project, then Main Contract or one of its own Additional Works. A published task keeps its project.',
        BAD_TEAM: 'Choose an active team of your company, or no team.',
        BAD_PERSON: 'Choose active workers or team leaders (from the task\'s team, if it has one). The responsible person cannot also be a helper.',
        NO_RESPONSIBLE: 'Choose the responsible person first.',
        BAD_DEPENDENCY: 'A task can only wait for another task of the same project. Remove that link first.',
        DEPENDENCY_CYCLE: 'That would make tasks wait for each other in a circle.',
        HAS_DEPENDENTS: 'Another task still waits for this one. Remove that link first.',
        TASK_CLOSED: 'This task is completed or cancelled and can no longer be edited.',
        TASK_BLOCKED: 'This task still has an open problem or an unfinished earlier task. Clear it first.',
        BAD_STATE: 'This task has moved on since you opened it. Reload the page.',
        REASON_REQUIRED: 'Write a short reason. It is saved in the task\'s history.',
        NOTE_REQUIRED: 'Write a short note about what was checked.',
        BAD_OPERATION: 'Part of the form could not be read. Reload and try again.',
        // Browser-side
        NEEDS_CHOICE: 'Choose every field marked "Needs your choice", and tick the boxes confirming you checked the helpers or dates. The AI could not match them.',
        NO_NOTES: 'Type or paste the meeting notes first.',
        NOTES_TOO_LONG: 'The notes are too long for the AI (20,000 characters at most). Split them, or add tasks by hand.',
        NO_RECIPIENTS: 'Choose at least one person to receive the notes.',
        AI_UNREADABLE: 'The AI answer could not be read. Try again, or add the tasks by hand.',
        AI_FAILED: 'The AI did not answer. Try again, or add the tasks by hand.',
        // From the AI worker
        AI_NOT_SIGNED_IN: 'Your sign-in has expired. Reload the page and sign in again to use the AI.',
        AI_NOT_ALLOWED: 'This account cannot use AI drafting. Add the tasks by hand.',
        AI_TOO_LARGE: 'Too much text for the AI. Shorten the notes, or add tasks by hand.',
        AI_RATE_LIMITED: 'AI limit reached (per person: 10 drafts in 10 minutes, 50 in any 24 hours). Add tasks by hand, or try again later.',
    };

    function errorMessage(error) {
        const text = String((error && (error.message || error.error_description || error.error)) || (typeof error === 'string' ? error : '') || '');
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) return ERRORS[code];
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    // ── AI drafts (spec §4, §5) ─────────────────────────────────────

    const NOTES_MAX = 20000;

    const DRAFT_RULES = [
        'You turn construction meeting notes into DRAFT tasks for DAC\'s Building Design Services (Philippines). Office staff review every draft before any worker sees it.',
        'Answer with ONLY one JSON object, no other text, in exactly this shape:',
        '{"tasks":[{"title":"","instructions":"","project":"","work":"","team":"","responsible":"","helpers":[],"planned_start":null,"planned_end":null,"waits_for":[],"materials":[],"source_passage":"","flags":[]}],"shared_notes":""}',
        'Rules:',
        '- One task per distinct piece of work for one project. "work" is "Main Contract" or the name of one of that project\'s Additional Works. If the notes do not say which, leave "work" empty and add a flag.',
        '- Copy project, Additional Works, team and person names EXACTLY from the lists below. If a name in the notes is not in the lists, is unclear, or could be more than one entry, leave the field empty and explain in "flags".',
        '- Never invent dates, quantities, names, projects or deadlines. Give planned_start / planned_end only when the notes state them, as YYYY-MM-DD; otherwise null, and add a flag when the timing is vague (for example "next week").',
        '- "waits_for": short descriptions of earlier work that must finish first. "materials": materials or tools the task needs, as written in the notes.',
        '- "source_passage": the exact sentence or sentences from the notes this task comes from.',
        '- Write "title", "instructions" and "shared_notes" in the language of the notes: mostly Tagalog gives clear Tagalog; mixed gives natural Taglish; English gives English. Keep the facts unchanged.',
        '- "shared_notes": a short summary of the meeting that is safe for workers to read. Leave out money, prices, pay, salaries, penalties and private or personal matters.',
    ];

    function draftMessages(notes, ctx) {
        const c = ctx || {};
        const projects = (c.projects || []).map(p => '- ' + p.name +
            ((p.works || []).length ? ' [Additional Works: ' + p.works.map(w => w.name).join('; ') + ']' : '')).join('\n');
        const people = (c.people || []).map(p => '- ' + p.name + (RAP.workerNo(p.worker_no) ? ' (' + RAP.workerNo(p.worker_no) + ')' : '')).join('\n');
        const teams = (c.teams || []).map(t => '- ' + t.name).join('\n');
        return [
            { role: 'system', content: DRAFT_RULES.join('\n') + '\n\nProjects:\n' + (projects || '- (none)') +
                '\n\nPeople:\n' + (people || '- (none)') + '\n\nTeams:\n' + (teams || '- (none)') },
            { role: 'user', content: 'Meeting held on ' + (c.heldOn || '') + '. Notes:\n' + String(notes || '') },
        ];
    }

    function clean(x, max) {
        const s = String(x === null || x === undefined ? '' : x).trim();
        return (s.toLowerCase() === 'null' ? '' : s).slice(0, max);
    }
    function cleanList(x) {
        return Array.isArray(x) ? x.map(y => clean(y, 200)).filter(Boolean) : [];
    }

    function parseDraft(text) {
        const s = String(text || '');
        const a = s.indexOf('{');
        const b = s.lastIndexOf('}');
        if (a < 0 || b <= a) throw new Error('AI_UNREADABLE');
        let obj;
        try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('AI_UNREADABLE'); }
        const day = x => (DAY.test(String(x || '')) ? String(x) : null);
        const tasks = (Array.isArray(obj && obj.tasks) ? obj.tasks : []).slice(0, 30).map(t => ({
            title: clean(t.title, 200), instructions: clean(t.instructions, 4000),
            project: clean(t.project, 200), work: clean(t.work, 200), team: clean(t.team, 200),
            responsible: clean(t.responsible, 200), helpers: cleanList(t.helpers),
            planned_start: day(t.planned_start), planned_end: day(t.planned_end),
            raw_start: clean(t.planned_start, 40), raw_end: clean(t.planned_end, 40),
            waits_for: cleanList(t.waits_for), materials: cleanList(t.materials),
            source_passage: clean(t.source_passage, 2000), flags: cleanList(t.flags),
        })).filter(t => t.title);
        return { tasks, shared_notes: clean(obj && obj.shared_notes, 4000) };
    }

    // Every entry whose name is exactly this one (case and spaces aside).
    function hits(list, name) {
        const n = norm(name);
        return n ? (list || []).filter(x => norm(x.name) === n) : [];
    }
    // A person by a W-number that matches exactly one account; otherwise
    // by name (with any "(W-0007)" taken out).
    function personHits(people, hint) {
        const raw = String(hint || '');
        const m = /\bW-?0*(\d{1,6})\b/i.exec(raw);
        const name = raw.replace(/\(?\s*\bW-?\d{1,6}\b\s*\)?/gi, '').trim();
        if (m) {
            const byNo = (people || []).filter(x => Number(x.worker_no) === Number(m[1]));
            if (byNo.length === 1) {
                // A name that points to someone else must not be overridden by the number: ask the office.
                const named = name ? hits(people, name) : [];
                return named.length && !named.includes(byNo[0]) ? byNo.concat(named) : byNo;
            }
        }
        return hits(people, name || raw);
    }
    function unmatched(what, raw, count) {
        return count > 1 ? what + ' "' + raw + '" matches ' + count + ' names — choose one'
                         : what + ' not recognised: "' + raw + '"';
    }

    // AI names → the company's real ids, ONLY on one exact match. Anything
    // else is left as CHOOSE (the form refuses to save until the office
    // picks) and explained in a flag (spec §4: flag, never guess). An
    // unnamed or unknown Additional Works never becomes Main Contract.
    function resolveDraft(t, ctx) {
        const c = ctx || {};
        const flags = t.flags.slice();
        const checks = [];
        const v = {
            folder_id: CHOOSE, work_id: CHOOSE, team_id: '', responsible_id: CHOOSE, helper_ids: [], depends_on: [],
            title: t.title, instructions: t.instructions, planned_start: t.planned_start || '', planned_end: t.planned_end || '',
            source_passage: t.source_passage,
        };

        const proj = hits(c.projects, t.project);
        if (!t.project) flags.push('No project given — choose one');
        else if (proj.length !== 1) flags.push(unmatched('Project', t.project, proj.length));
        else v.folder_id = proj[0].folder_id;

        if (v.folder_id !== CHOOSE) {
            if (norm(t.work) === 'main contract') v.work_id = v.folder_id;
            else if (!t.work) flags.push('Main Contract or Additional Works not given — choose one');
            else {
                const w = hits(proj[0].works, t.work);
                if (w.length === 1) v.work_id = w[0].work_id;
                else flags.push(unmatched('Additional Works', t.work, w.length));
            }
        }

        if (t.team) {
            const tm = hits(c.teams, t.team);
            if (tm.length === 1) v.team_id = tm[0].id;
            else { v.team_id = CHOOSE; flags.push(unmatched('Team', t.team, tm.length)); }
        }

        if (!t.responsible) flags.push('No responsible person given — choose one');
        else {
            const r = personHits(c.people, t.responsible);
            if (r.length === 1) v.responsible_id = r[0].id;
            else flags.push(unmatched('Person', t.responsible, r.length));
        }

        t.helpers.forEach(h => {
            const r = personHits(c.people, h);
            if (r.length !== 1) {
                flags.push(unmatched('Person', h, r.length));
                if (!checks.includes('helpers')) checks.push('helpers');
            } else if (r[0].id !== v.responsible_id && !v.helper_ids.includes(r[0].id)) {
                v.helper_ids.push(r[0].id);
            }
        });

        if (t.raw_start && !t.planned_start) flags.push('Start date unclear: "' + t.raw_start + '"');
        if (t.raw_end && !t.planned_end) flags.push('End date unclear: "' + t.raw_end + '"');
        if ((t.raw_start && !t.planned_start) || (t.raw_end && !t.planned_end)) checks.push('dates');
        t.waits_for.forEach(w => flags.push('Waits for: ' + w + ' — link it after both are drafts'));
        if (t.materials.length) flags.push('Materials mentioned: ' + t.materials.join(', '));

        v.office_flags = flags;
        v.checks = checks;
        return { values: v, flags };
    }

    // Today in Manila as 'YYYY-MM-DD': the +8 h offset makes the UTC slice
    // the Manila calendar day (same as js/requests-admin-queue.js).
    function todayManila() {
        return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    const pure = { STATUS_LABEL, statusLabel, statusPill, plannedLabel, boardGroups, alertCounts, filterBoard,
                   CHOOSE, taskProblem, buildTaskPayload, docToForm, revisionChanges, keepSelections,
                   meetingFields, meetingUnsaved, settlePending, loadTickets, blockerKind, eventText, ERRORS, errorMessage,
                   NOTES_MAX, draftMessages, parseDraft, resolveDraft, todayManila,
                   formatDay: RAP.formatDay, formatManila: RAP.formatManila, workerNo: RAP.workerNo };

    if (IN_NODE) {
        module.exports = pure;
        return;
    }

    // ── Browser helpers ─────────────────────────────────────────────

    const AI_WORKER_URL = 'https://dacs-ai.dacsbuilding.workers.dev';

    function fail(host, error) {
        host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
            RAP.esc(errorMessage(error)) + '</div></div></div>';
        RAP.icons();
    }

    function modal(opts) {
        return RAP.modal(Object.assign({ errorMessage }, opts));
    }

    // The worker checks the signed-in account, size and limits on the
    // server (ai_authorize, 0095) and picks the model itself.
    async function aiDraft(notes, ctx) {
        if (!String(notes || '').trim()) throw new Error('NO_NOTES');
        if (String(notes).length > NOTES_MAX) throw new Error('NOTES_TOO_LONG');
        const { data } = await root.sbClient.auth.getSession();
        const token = data && data.session ? data.session.access_token : '';
        if (!token) throw new Error('AI_NOT_SIGNED_IN');
        let res, body;
        try {
            res = await fetch(AI_WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ feature: 'work_plan_draft', messages: draftMessages(notes, ctx), temperature: 0.2 }),
            });
            body = await res.json();
        } catch (e) {
            throw new Error('AI_FAILED');
        }
        if (!res.ok) {
            const code = body && body.error && body.error.code;
            throw new Error(code && ERRORS[code] ? code : 'AI_FAILED');
        }
        const text = body && body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message.content : '';
        return parseDraft(text);
    }

    const state = { taskId: null, meetingId: null };
    const views = {};

    function openTask(id) { state.taskId = id; root.switchView('wpTask'); }
    function openMeeting(id) { state.meetingId = id; root.switchView('wpMeeting'); }

    root.WorkPlanAdmin = Object.assign({}, pure, {
        esc: RAP.esc, icons: RAP.icons, rpc: RAP.rpc, head: RAP.head, signImages: RAP.signImages,
        fail, modal, aiDraft, AI_WORKER_URL, state, views, openTask, openMeeting,
    });

    root.initWorkPlanModule = function (view) {
        const host = document.getElementById(view + 'View');
        const render = views[view];
        if (host && render) render(host);
    };
})(typeof window !== 'undefined' ? window : globalThis);
