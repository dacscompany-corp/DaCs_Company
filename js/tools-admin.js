// ════════════════════════════════════════════════════════════════════
// Requests → Tools (WorkMate Stage 3a, migration 0107).
//
// Every real tool, numbered TOOL-0001…, and who has it. Four tabs:
//   Tools             — every tool and its state; open one for its history;
//   Out               — tools issued, longest out first, with days held;
//   To register       — purchase lines of tools not registered yet;
//   Waiting for owner — Lost reports and Retire requests the main owner decides.
// Actions: Register tools, and per tool Issue, Hand over, Return (with its
// condition), Repaired, Ask to retire, Report lost, Found. A tool at a
// project always has a named responsible person. Mistakes are reversed
// with a reason (never edited), while they are the tool's latest record.
//
// NO MONEY: no peso amount is read or shown here — a tool's cost stays where
// its purchase put it. Owner and office staff allowed Expenses use it, once
// the main owner switches tools on; every rule is the server's (0107) and
// this file only previews and explains. Each form sends one operation id,
// kept across retries of the same form, so a double press records once.
// Photos go to uploads/tools/<company>/<yyyy-mm>/<uuid>.jpg (owner/staff).
//
// Works in a browser (window.ToolsAdmin) and in Node for
// tests/tools-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    // ── Words ───────────────────────────────────────────────────────

    const STATE_LABEL = {
        available: ['Available', 'done'],
        issued: ['Issued', 'working'],
        repair: ['Under repair', 'abandoned'],
        lost_pending: ['Lost — waiting for the owner', 'abandoned'],
        lost: ['Lost', 'abandoned'],
        retire_pending: ['Retire — waiting for the owner', 'abandoned'],
        retired: ['Retired', 'cancelled'],
        cancelled: ['Cancelled', 'cancelled'],
    };

    const KIND_LABEL = {
        register: 'Registered',
        issue: 'Issued',
        handover: 'Handed over',
        return: 'Returned',
        repaired: 'Repaired',
        lost: 'Reported lost',
        found: 'Found',
        retire: 'Retire request',
    };

    // The server's conditions (tl_condition). Damaged only on a return or when found.
    const CONDITIONS = [
        ['good', 'Good'], ['needs_repair', 'Needs repair'], ['missing_parts', 'Missing parts'], ['damaged', 'Damaged beyond repair'],
    ];
    function conditionLabel(c) {
        const hit = CONDITIONS.find(([k]) => k === c);
        return hit ? hit[1] : (c || '');
    }

    function daysText(n) {
        const d = Number(n);
        if (!isFinite(d) || d <= 0) return 'today';
        return d === 1 ? '1 day' : d + ' days';
    }

    // Where a tool is and who answers for it, in words.
    function whereText(t) {
        if (t.state === 'issued') return t.holder_name + ' · ' + t.folder_name + ' · ' + daysText(t.days) +
            (t.condition && t.condition !== 'good' ? ' · ' + conditionLabel(t.condition) + ' — not usable until repaired' : '');
        if ((t.state === 'lost' || t.state === 'lost_pending') && t.holder_name) return 'Last with ' + t.holder_name + (t.folder_name ? ' · ' + t.folder_name : '');
        if (t.state === 'lost' || t.state === 'lost_pending') return 'Last at the warehouse';
        if (t.state === 'available') return 'Warehouse';
        // A Retire waits on a tool Under repair — still at the warehouse, in its condition (TF2).
        if (t.state === 'repair' || t.state === 'retire_pending') return 'Warehouse · ' + conditionLabel(t.condition);
        return '';
    }

    // A record in one line.
    function recordText(r) {
        const st = r.status === 'pending' ? ' (waiting for the owner)' : r.status === 'rejected' ? ' (rejected)' : r.status === 'withdrawn' ? ' (withdrawn)' : '';
        switch (r.kind) {
            case 'register': return 'Registered' + (r.holder_name ? ' with ' + r.holder_name + ' · ' + r.folder_name : ' at the warehouse') +
                (r.condition && r.condition !== 'good' ? ' · ' + conditionLabel(r.condition) : '');
            case 'issue': return 'Issued to ' + r.holder_name + ' · ' + r.folder_name;
            case 'handover': return 'Handed over' + (r.from_holder_name ? ' from ' + r.from_holder_name : '') + ' to ' + r.holder_name + ' · ' + r.folder_name;
            case 'return': return 'Returned by ' + r.holder_name + ' · ' + conditionLabel(r.condition);
            case 'repaired': return r.holder_name ? 'Repaired — still with ' + r.holder_name + ' · ' + r.folder_name : 'Repaired — available again';
            case 'lost': return 'Reported lost' + (r.holder_name ? ' (last with ' + r.holder_name + ')' : '') + st;
            case 'found': return 'Found · ' + conditionLabel(r.condition);
            case 'retire': return 'Retire' + st;
            default: return r.kind;
        }
    }

    // What the office may do with a tool in this state (the server's rules).
    function actionsFor(t) {
        switch (t.state) {
            case 'available': return ['issue', 'lost'];
            // Needing repair at its project (rev 3): stays with its person, no handover until repaired.
            case 'issued': return t.condition && t.condition !== 'good' ? ['repaired', 'return', 'lost'] : ['handover', 'return', 'lost'];
            case 'repair': return ['repaired', 'retire', 'lost'];
            case 'lost': return ['found'];
            default: return [];
        }
    }

    // Withdraw (pending: whoever recorded it, or the main owner) or reverse
    // (the tool's latest done record, not a decided loss / retirement:
    // whoever recorded it, or an owner) — tl_reverse's rule.
    function canReverse(r, me) {
        if (r.reversed || r.status === 'rejected' || r.status === 'withdrawn') return false;
        if (r.status === 'pending') return r.recorded_by === me.userId || me.isMainOwner;
        if (r.kind === 'lost' || r.kind === 'retire' || !r.latest) return false;
        return r.recorded_by === me.userId || me.isOwner;
    }

    // tools/<company>/<yyyy-mm>/<uuid>.jpg — month from LOCAL parts (PH,
    // UTC+8), the shape tl_photo accepts.
    function photoPath(ownerId, now, id) {
        if (!ownerId) throw new Error('No company account to file the photo under — sign in again.');
        const d = now || new Date();
        return 'tools/' + String(ownerId).toLowerCase() + '/' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '/' +
            String(id).toLowerCase() + '.jpg';
    }

    // Form checks, as the server's.
    // st: { itemId, count, at ('warehouse' or a folder id), holderId, condition, details,
    //       fromLine (registering from a purchase line), hasPhoto }
    function registerProblems(st) {
        const out = [];
        if (!st.itemId) out.push('BAD_ITEM');
        const n = Number(st.count);
        if (!/^\d+$/.test(String(st.count || '').trim()) || n < 1 || n > 50) out.push('BAD_QUANTITY');
        if (!st.at) out.push('BAD_PROJECT');
        if (!CONDITIONS.some(([k]) => k === st.condition)) out.push('BAD_CONDITION');
        // Damaged beyond repair: at the warehouse, where the owner decides (rev 2).
        if (st.condition === 'damaged' && st.at && st.at !== 'warehouse') out.push('DAMAGED_AT_PROJECT');
        else if (st.at && st.at !== 'warehouse' && !st.holderId) out.push('PERSON_REQUIRED');
        // The opening register keeps a photo of each tool (Q7, rev 2).
        if (!st.fromLine && !st.hasPhoto) out.push('PHOTO_REQUIRED');
        if (String(st.details || '').trim().length > 200) out.push('BAD_NOTE');
        return out;
    }
    // st: { holderId, folderId }
    function issueProblems(st) {
        const out = [];
        if (!st.holderId) out.push('PERSON_REQUIRED');
        if (!st.folderId) out.push('BAD_PROJECT');
        return out;
    }

    // People as options: "Mark (W-0007) · Masons", "Ana · office" — the crew's worker number comes with
    // the name (0108, TF1). Anyone active in the company may hold a tool (T1 = C).
    const ROLE_LABEL = { teamLeader: 'team leader', staff: 'office', owner: 'owner' };
    function personLabel(p) {
        return p.name + (p.teams && p.teams.length ? ' · ' + p.teams.join(', ') : ROLE_LABEL[p.role] ? ' · ' + ROLE_LABEL[p.role] : '');
    }

    // Projects to pick: not completed — and the tool's own project, kept even if completed.
    function projectOptions(projects, keepId) {
        return projects.filter(p => !p.completed || p.folder_id === keepId)
            .map(p => ({ value: p.folder_id, label: p.name + (p.completed ? ' (completed)' : '') }));
    }

    // The request lines an issue may fill: a tool line of this project naming
    // this tool's item, or naming none.
    function requestOptions(lines, itemId) {
        return lines.filter(l => Number(l.still_to_buy) > 0 && (!l.catalog_item_id || l.catalog_item_id === itemId))
            .map(l => ({ value: l.line_id, label: l.description + (l.spec ? ' — ' + l.spec : '') + ' · ' + l.requester_name +
                                                 ' · still ' + Number(l.still_to_buy) + ' ' + l.unit }));
    }

    // ── Errors in words ─────────────────────────────────────────────

    const ERRORS = {
        TOOLS_OFF: 'Tools are not switched on yet. The main owner switches them on.',
        NOT_A_TOOL: 'That catalogue item is not a tool. Pick a tool item (Catalogue → Kind: Tool).',
        BAD_ITEM: 'Pick an active tool item.',
        BAD_QUANTITY: 'Register 1 to 50 tools at a time.',
        PERSON_REQUIRED: 'A tool at a project always has a named responsible person. Pick who has it.',
        BAD_PERSON: 'Pick someone active in this company — a worker, team leader, office staff or owner.',
        BAD_PROJECT: 'Pick one of your projects.',
        PROJECT_COMPLETED: 'That project is completed. Pick a project still in progress.',
        BAD_PLACE: 'From this purchase line, tools start at the warehouse — or, for a project purchase, with someone on that project.',
        BAD_CONDITION: 'Pick the tool\'s condition.',
        DAMAGED_AT_PROJECT: 'A tool damaged beyond repair is registered at the warehouse, where the main owner decides whether to retire it.',
        PHOTO_REQUIRED: 'The opening register needs a photo of the tool.',
        BAD_PHOTO: 'That photo could not be used. Choose it again.',
        LINE_IS_STOCK: 'This purchase line was already received as stock. Reverse that first (Requests → Stock), then register its tools.',
        MORE_THAN_BOUGHT: 'That is more tools than this purchase line bought.',
        TOOL_ITEM: 'A tool is not counted as stock — register it here under Tools.',
        TOOL_LINE: 'Tools were registered from this purchase line, so it is never stock.',
        TOOLS_IN_USE: 'Tools were registered from this purchase. Cancel those registrations first, or keep the line and enough quantity.',
        NOT_AVAILABLE: 'Only an Available tool can be issued. Return it, repair it, or wait for the owner\'s decision first.',
        NOT_ISSUED: 'That tool is not issued to anyone right now.',
        NEEDS_REPAIR: 'That tool needs repair first. Mark it Repaired where it is, or have it returned.',
        NOT_IN_REPAIR: 'That tool is not under repair.',
        NOT_LOST: 'That tool is not marked lost.',
        SAME_HOLDER: 'That person already has it, on that project.',
        NOT_A_TOOL_LINE: 'That request line is for a material, not a tool.',
        BAD_REQUEST_LINK: 'That request belongs to another project.',
        ITEM_MISMATCH: 'That request line is for a different tool.',
        UNIT_MISMATCH: 'That request line uses another unit.',
        LINE_CLOSED: 'That request line was cancelled.',
        REQUEST_EXCEEDED: 'That request line is already filled. Issue the tool without a request.',
        LATER_RECORDS: 'Something happened to this tool after that record. Reverse the later records first.',
        NOT_YOURS: 'Only the person who recorded this, or an owner, can do that.',
        OWNER_ONLY: 'Only the main owner can do that.',
        NOT_ALLOWED: 'Only the main owner can do that.',
        NOT_OFFICE: 'Only owner and office accounts can record tools.',
        BAD_STATE: 'This was already decided, withdrawn or reversed. Reload the page.',
        REASON_REQUIRED: 'Please give a reason.',
        BAD_NOTE: 'That note is too long.',
        NOT_FOUND: 'That was not found. Reload the page.',
        BAD_OP: 'Something went wrong. Close the form and try again.',
        OP_CANCELLED: 'This was cancelled — nothing was recorded. Try again.',
        BAD_SWITCH: 'Something went wrong. Reload the page.',
        ITEM_IN_USE: 'That catalogue item is used by tools, requests or stock, so its kind and unit cannot change.',
        PGRST202: 'Tools are not installed on the server yet.',
    };
    const HINTED = ['MORE_THAN_BOUGHT', 'TOOLS_IN_USE'];

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

    const pure = { STATE_LABEL, KIND_LABEL, CONDITIONS, conditionLabel, daysText, whereText, recordText, actionsFor, canReverse,
                   photoPath, registerProblems, issueProblems, personLabel, projectOptions, requestOptions, ERRORS, errorMessage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser ─────────────────────────────────────────────────────

    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const ui = { tab: 'tools', toolId: null };
    let cache = { choices: null, status: null };

    const newOp = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

    // Who is looking, from the server (tl_status).
    function me() {
        const s = cache.status || {};
        return { userId: s.user_id, isOwner: !!s.is_owner, isMainOwner: !!s.is_main_owner, canRecord: !!s.can_record };
    }

    function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }
    function statePill(state) { const s = STATE_LABEL[state] || [state, 'cancelled']; return pill(s[0], s[1]); }

    function notice(error, title) {
        const plain = typeof error === 'string' && !/^[A-Z][A-Z_]+$/.test(error);
        RA.modal({ title: title || 'Not done', body: '<p>' + esc(plain ? error : errorMessage(error)) + '</p>', submitLabel: 'OK', onSubmit: () => {} });
    }

    async function choices() {
        if (!cache.choices) cache.choices = await RA.rpc('tl_choices');
        return cache.choices;
    }

    function options(list, selected, blank) {
        return (blank ? '<option value="">' + esc(blank) + '</option>' : '') +
            list.map(o => '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
    }
    function peopleOptions(people, selected) {
        return options(people.map(p => ({ value: p.id, label: personLabel(p) })), selected, 'Who has it…');
    }
    function conditionOptions(allowDamaged, selected) {
        return CONDITIONS.filter(([k]) => allowDamaged || k !== 'damaged')
            .map(([k, l]) => '<option value="' + k + '"' + (k === (selected || 'good') ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
    }

    // A form that sends one operation id however many times it is submitted.
    function sendOnce(fn) {
        const opId = newOp();
        return (...args) => fn(opId, ...args);
    }

    // The photo a form picked, uploaded once (kept across retries of the form).
    function photoOnce() {
        let done = null;
        return async (file) => {
            if (!file) return null;
            if (done && done.file === file) return done.path;
            const blob = await root.DacsReceipts.compressToBlob(file);
            const path = photoPath(root.currentDataUserId, new Date(), newOp());
            const { error } = await root.sbClient.storage.from('uploads').upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
            if (error) throw new Error('Couldn\'t upload the photo: ' + (error.message || error));
            done = { file, path };
            return path;
        };
    }
    const photoField = '<label class="att-label">Photo (optional)<input class="att-input" type="file" name="photo" accept="image/*"></label>';

    // ── Forms ───────────────────────────────────────────────────────

    // Register tools. preset: { line } — a purchase line from "To register".
    async function openRegister(preset, onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const line = preset && preset.line;
        const send = sendOnce((opId, body) => RA.rpc('tl_register', { p_op: opId, p_body: body }));
        const upload = photoOnce();
        const left = line ? Math.max(0, Math.floor(Number(line.quantity)) - Number(line.registered)) : 1;
        const places = line && line.destination === 'warehouse' ? [{ value: 'warehouse', label: 'Warehouse' }]
            : [{ value: 'warehouse', label: 'Warehouse' }].concat(projectOptions(ch.projects)
                .filter(p => !line || p.value === line.folder_id).map(p => ({ value: p.value, label: 'With someone at ' + p.label })));
        RA.modal({
            title: 'Register tools',
            sub: line ? 'From ' + line.item_name + ' · ' + Number(line.quantity) + ' ' + line.unit + ' bought ' + RA.formatDay(line.purchase_date) +
                        ' · ' + line.registered + ' registered. Its cost stays where the purchase put it.'
                      : 'Tools the company already owns, or bought before. Each one gets its own number (TOOL-0001…).',
            body: '<div class="stk-form">' +
                '<label class="att-label">Tool<select class="att-input" name="item"><option value="">Pick a tool…</option>' +
                  ch.items.map(i => '<option value="' + esc(i.item_id) + '"' + (line && line.suggested_item_id === i.item_id ? ' selected' : '') + '>' +
                    esc(i.name + (i.spec ? ' — ' + i.spec : '')) + '</option>').join('') + '</select></label>' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">How many<input class="att-input" name="count" inputmode="numeric" value="' + esc(String(left || 1)) + '"></label>' +
                  '<label class="att-label">Condition<select class="att-input" name="condition">' + conditionOptions(true) + '</select></label>' +
                '</div>' +
                '<label class="att-label">Where is it now<select class="att-input" name="at">' + options(places, 'warehouse') + '</select></label>' +
                '<label class="att-label" data-person hidden>Responsible person<select class="att-input" name="holder">' + peopleOptions(ch.people, null) + '</select></label>' +
                '<p class="req-muted" data-cond-note></p>' +
                '<label class="att-label">Brand / model / serial (optional)<input class="att-input" name="details" maxlength="200"></label>' +
                (line ? photoField
                      : '<label class="att-label">Photo of the tool<input class="att-input" type="file" name="photo" accept="image/*"></label>' +
                        '<p class="req-muted">Needed for the opening register. Several identical tools registered together share it.</p>') +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Register',
            errorMessage,
            onOpen: (form) => {
                const n = form.querySelector('[data-cond-note]');
                const sync = () => {
                    form.querySelector('[data-person]').hidden = form.at.value === 'warehouse';
                    n.textContent = form.condition.value === 'damaged' ? 'At the warehouse, under repair — and the main owner is asked to retire it.'
                        : form.condition.value === 'good' ? '' : 'Under repair until you mark it Repaired (at the warehouse).';
                };
                form.at.addEventListener('change', sync);
                form.condition.addEventListener('change', sync);
                sync();
            },
            onSubmit: async (form) => {
                const st = { itemId: form.item.value, count: form.count.value, at: form.at.value,
                             holderId: form.at.value === 'warehouse' ? '' : form.holder.value, condition: form.condition.value, details: form.details.value,
                             fromLine: !!line, hasPhoto: !!form.photo.files[0] };
                const problems = registerProblems(st);
                if (problems.length) throw new Error(problems[0]);
                const body = { item_id: st.itemId, count: String(Number(st.count)), at: st.at, holder_id: st.holderId || null,
                               condition: st.condition, details: st.details.trim(), note: form.note.value.trim(),
                               photo_path: await upload(form.photo.files[0]) };
                if (line) { body.purchase_id = line.purchase_id; body.line_no = String(line.line_no); }
                await send(body);
            },
            onDone,
        });
    }

    async function openIssue(t, onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, body) => RA.rpc('tl_issue', { p_op: opId, p_body: body }));
        const upload = photoOnce();
        let lines = [];
        RA.modal({
            title: 'Issue ' + t.label,
            sub: t.item_name + (t.details ? ' · ' + t.details : '') + '. The person named answers for it until it is returned or handed over.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Responsible person<select class="att-input" name="holder">' + peopleOptions(ch.people, null) + '</select></label>' +
                '<label class="att-label">Project<select class="att-input" name="folder">' + options(projectOptions(ch.projects), null, 'Pick a project…') + '</select></label>' +
                '<label class="att-label">Fills a request (optional)<select class="att-input" name="line"><option value="">No request</option></select></label>' +
                '<p class="req-muted" data-line-note></p>' +
                photoField +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Issue',
            errorMessage,
            onOpen: (form) => {
                const note = form.querySelector('[data-line-note]');
                form.folder.addEventListener('change', async () => {
                    lines = [];
                    note.textContent = '';
                    if (form.folder.value) {
                        try { lines = await RA.rpc('tl_request_lines', { p_folder: form.folder.value }); } catch (e) { note.textContent = errorMessage(e); }
                    }
                    form.line.innerHTML = options(requestOptions(lines, t.item_id), null, 'No request');
                });
            },
            onSubmit: async (form) => {
                const problems = issueProblems({ holderId: form.holder.value, folderId: form.folder.value });
                if (problems.length) throw new Error(problems[0]);
                await send({ tool_id: t.id, holder_id: form.holder.value, folder_id: form.folder.value, request_line_id: form.line.value || null,
                             note: form.note.value.trim(), photo_path: await upload(form.photo.files[0]) });
            },
            onDone,
        });
    }

    async function openHandover(t, onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, body) => RA.rpc('tl_handover', { p_op: opId, p_body: body }));
        RA.modal({
            title: 'Hand over ' + t.label,
            sub: 'Now with ' + t.holder_name + ' · ' + t.folder_name + '. Straight to the next person — no trip back to the warehouse.',
            body: '<div class="stk-form">' +
                '<label class="att-label">To<select class="att-input" name="holder">' +
                  peopleOptions(ch.people.filter(p => p.id !== t.holder_id), null) + '</select></label>' +
                '<label class="att-label">Project<select class="att-input" name="folder">' + options(projectOptions(ch.projects, t.folder_id), t.folder_id) + '</select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Hand over',
            errorMessage,
            onSubmit: async (form) => {
                const problems = issueProblems({ holderId: form.holder.value, folderId: form.folder.value });
                if (problems.length) throw new Error(problems[0]);
                await send({ tool_id: t.id, holder_id: form.holder.value, folder_id: form.folder.value, note: form.note.value.trim() });
            },
            onDone,
        });
    }

    function openReturn(t, onDone) {
        const send = sendOnce((opId, body) => RA.rpc('tl_return', { p_op: opId, p_body: body }));
        const upload = photoOnce();
        RA.modal({
            title: 'Return ' + t.label,
            sub: 'From ' + t.holder_name + ' · ' + t.folder_name + '. A tool that is not in good condition cannot be issued until it is repaired.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Condition<select class="att-input" name="condition">' + conditionOptions(true) + '</select></label>' +
                '<p class="req-muted" data-cond-note></p>' +
                photoField +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Return',
            errorMessage,
            onOpen: (form) => {
                const n = form.querySelector('[data-cond-note]');
                const sync = () => {
                    n.textContent = form.condition.value === 'good' ? 'Back to the warehouse, available.'
                        : form.condition.value === 'damaged' ? 'Under repair, and the main owner is asked to retire it.'
                        : 'Under repair until you mark it Repaired.';
                };
                form.condition.addEventListener('change', sync);
                sync();
            },
            onSubmit: async (form) => {
                await send({ tool_id: t.id, condition: form.condition.value, note: form.note.value.trim(), photo_path: await upload(form.photo.files[0]) });
            },
            onDone,
        });
    }

    function openFound(t, onDone) {
        const send = sendOnce((opId, body) => RA.rpc('tl_found', { p_op: opId, p_body: body }));
        RA.modal({
            title: 'Found ' + t.label,
            sub: 'It comes back to the warehouse: available if good, otherwise under repair.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Condition<select class="att-input" name="condition">' + conditionOptions(true) + '</select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Found',
            errorMessage,
            onSubmit: async (form) => { await send({ tool_id: t.id, condition: form.condition.value, note: form.note.value.trim() }); },
            onDone,
        });
    }

    // Repaired (note), Ask to retire (reason) or Report lost (reason).
    function openSimple(t, act, onDone) {
        const cfg = {
            repaired: ['Repaired', t.state === 'issued' ? 'It stays with ' + t.holder_name + ' · ' + t.folder_name + ', now in good condition — it can be handed over.'
                                                        : 'It is available again, in good condition.', 'Note (optional)', false,
                       (op, text) => RA.rpc('tl_repaired', { p_op: op, p_tool: t.id, p_note: text })],
            retire: ['Ask to retire ' + t.label, 'The main owner decides. Until then it cannot be issued.', 'Reason', true,
                     (op, text) => RA.rpc('tl_request_retire', { p_op: op, p_tool: t.id, p_reason: text })],
            lost: ['Report ' + t.label + ' lost', (t.holder_name ? 'Last with ' + t.holder_name + '. ' : '') +
                       'The main owner decides; until then it cannot be issued, handed over or returned.', 'What happened', true,
                   (op, text) => RA.rpc('tl_report_lost', { p_op: op, p_tool: t.id, p_reason: text })],
        }[act];
        const send = sendOnce(cfg[4]);
        RA.modal({
            title: cfg[0], sub: cfg[1], warn: act !== 'repaired',
            body: '<div class="stk-form"><label class="att-label">' + cfg[2] + '<input class="att-input" name="text" maxlength="500"></label></div>',
            submitLabel: act === 'repaired' ? 'Repaired' : 'Send to the owner',
            errorMessage,
            onSubmit: async (form) => {
                if (cfg[3] && !form.text.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.text.value.trim());
            },
            onDone,
        });
    }

    function openReverse(r, onDone) {
        const pending = r.status === 'pending';
        const send = sendOnce((opId, reason) => RA.rpc('tl_reverse', { p_op: opId, p_record: r.id, p_reason: reason }));
        RA.modal({
            title: pending ? 'Withdraw' : 'Reverse',
            sub: r.label + ': ' + recordText(r) + (pending ? '. The tool goes back to where it was.'
                : r.kind === 'register' ? '. The tool is cancelled; its number is never used again.'
                : '. The record stays, marked reversed; the tool goes back to where it was before it.'),
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
        const send = sendOnce((opId, note) => RA.rpc('tl_decide', { p_op: opId, p_record: r.id, p_approve: approve, p_note: note }));
        const outcome = r.kind === 'lost'
            ? (approve ? 'It is marked lost; who had it stays recorded. If it turns up, record Found.' : 'It goes back exactly where it was before the report.')
            : (approve ? 'It is retired for good; its number is never used again.' : 'It stays under repair — repair it, or ask again.');
        RA.modal({
            title: (approve ? 'Confirm' : 'Reject') + ' — ' + r.label,
            sub: recordText(r) + (r.note ? ' · ' + r.note : '') + '. ' + outcome,
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

    // ── Screens ─────────────────────────────────────────────────────

    function tabs(ov) {
        const n = (x) => x && x.length ? ' (' + x.length + ')' : '';
        const t = (id, label) => '<button type="button" class="att-seg-btn' + (ui.tab === id ? ' is-on' : '') + '" data-tab="' + id + '">' + label + '</button>';
        return '<div class="att-seg" role="tablist" aria-label="Tools">' +
            t('tools', 'Tools') + t('out', 'Out' + n(ov && ov.out)) + t('register', 'To register' + n(ov && ov.to_register)) +
            t('pending', 'Waiting for owner' + n(ov && ov.pending)) + '</div>';
    }

    function toolCard(t) {
        return '<div class="att-card stk-item tl-tool" data-tool="' + esc(t.id) + '"><div class="att-card-body">' +
            '<div class="stk-item-head"><strong>' + esc(t.label) + '</strong> ' + esc(t.item_name) +
              (t.details ? ' <span class="req-muted">' + esc(t.details) + '</span>' : '') +
              '<span class="tl-state">' + statePill(t.state) + '</span></div>' +
            (whereText(t) ? '<div class="stk-places">' + esc(whereText(t)) + '</div>' : '') +
            '</div></div>';
    }

    function outRow(t) {
        const broken = t.condition && t.condition !== 'good';
        return '<div class="stk-rec" data-tool-row="' + esc(t.id) + '">' +
            '<div class="stk-rec-main"><strong>' + esc(t.label) + '</strong> ' + esc(t.item_name) +
              (broken ? ' ' + pill(conditionLabel(t.condition) + ' — not usable', 'abandoned') : '') +
              '<div>' + esc(t.holder_name) + ' · ' + esc(t.folder_name) + '</div>' +
              '<div class="req-muted">Out ' + esc(daysText(t.days)) + '</div></div>' +
            '<div class="stk-rec-acts">' +
              (broken ? '<button type="button" class="att-btn att-btn--sm" data-out-act="repaired">Repaired…</button>'
                      : '<button type="button" class="att-btn att-btn--sm" data-out-act="handover">Hand over…</button>') +
              '<button type="button" class="att-btn att-btn--sm" data-out-act="return">Return…</button></div></div>';
    }

    function lineCard(l) {
        return '<div class="att-card stk-line"><div class="att-card-body">' +
            '<div><strong>' + esc(l.item_name) + '</strong> · ' + esc(String(Number(l.quantity))) + ' ' + esc(l.unit) +
              ' <span class="req-muted">bought ' + esc(RA.formatDay(l.purchase_date)) +
              (l.destination === 'warehouse' ? ' for the warehouse' : ' for ' + esc(l.folder_name || 'a project')) + '</span></div>' +
            '<div class="req-muted">Registered ' + esc(String(l.registered)) + ' of ' + esc(String(Math.floor(Number(l.quantity)))) + '</div>' +
            '<div class="stk-line-acts" data-line="' + esc(l.purchase_id + ':' + l.line_no) + '">' +
              '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-line-act="register">Register…</button></div>' +
            '</div></div>';
    }

    function recordRow(r, m) {
        return '<div class="stk-rec' + (r.reversed ? ' is-reversed' : '') + '" data-record="' + esc(r.id) + '">' +
            '<div class="stk-rec-main"><strong>' + esc(r.label ? r.label + ' · ' : '') + esc(KIND_LABEL[r.kind] || r.kind) + '</strong>' +
              (r.status === 'pending' ? ' ' + pill('Waiting for the owner', 'abandoned') : r.status === 'rejected' ? ' ' + pill('Rejected', 'cancelled')
                : r.status === 'withdrawn' ? ' ' + pill('Withdrawn', 'cancelled') : r.reversed ? ' ' + pill('Reversed', 'cancelled') : '') +
              '<div>' + esc(recordText(r)) + '</div>' +
              (r.request_description ? '<div class="req-muted">Request: ' + esc(r.request_description) +
                (r.fills_request ? '' : ' (bought for it — counted through its purchase)') + '</div>' : '') +
              (r.note ? '<div class="req-muted">Note: ' + esc(r.note) + '</div>' : '') +
              (r.photo_path ? '<img class="tl-photo" alt="Photo" data-sign-bucket="uploads" data-sign-path="' + esc(r.photo_path) + '">' : '') +
              '<div class="req-muted">' + esc(r.recorded_by_name) + ' · ' + esc(RA.cutoffLabel(r.recorded_at)) +
                (r.decided_by_name ? ' · ' + esc(r.status === 'rejected' ? 'rejected' : r.status === 'withdrawn' ? 'withdrawn' : 'confirmed') + ' by ' +
                  esc(r.decided_by_name) + (r.decision_note ? ': ' + esc(r.decision_note) : '') : '') +
                (r.reversed ? ' · reversed by ' + esc(r.reversed_by_name) + ': ' + esc(r.reverse_reason) : '') + '</div>' +
            '</div>' +
            '<div class="stk-rec-acts">' +
              (r.status === 'pending' && m.isMainOwner ? '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-rec-act="confirm">Confirm</button>' +
                '<button type="button" class="att-btn att-btn--sm" data-rec-act="reject">Reject</button>' : '') +
              (canReverse(r, m) ? '<button type="button" class="att-btn att-btn--sm" data-rec-act="reverse">' + (r.status === 'pending' ? 'Withdraw' : 'Reverse') + '</button>' : '') +
            '</div></div>';
    }

    function wireRecords(scope, records, reload) {
        scope.querySelectorAll('[data-rec-act]').forEach(b => b.addEventListener('click', () => {
            const r = records.find(x => x.id === b.closest('[data-record]').dataset.record);
            if (!r) return;
            if (b.dataset.recAct === 'confirm') return openDecide(r, true, reload);
            if (b.dataset.recAct === 'reject') return openDecide(r, false, reload);
            return openReverse(r, reload);
        }));
    }

    const ACTION_LABEL = { issue: 'Issue…', handover: 'Hand over…', return: 'Return…', repaired: 'Repaired…', retire: 'Ask to retire…',
                           lost: 'Report lost…', found: 'Found…' };
    function runAction(act, t, reload) {
        if (act === 'issue') return openIssue(t, reload);
        if (act === 'handover') return openHandover(t, reload);
        if (act === 'return') return openReturn(t, reload);
        if (act === 'found') return openFound(t, reload);
        return openSimple(t, act, reload);
    }

    async function renderTool(body, toolId, reload) {
        body.innerHTML = '<div class="att-empty">Loading…</div>';
        let t;
        try { t = await RA.rpc('tl_tool', { p_tool: toolId }); } catch (e) { RA.fail(body, e); return; }
        const m = me();
        body.innerHTML =
            '<button type="button" class="att-btn att-btn--sm" data-back>← All tools</button>' +
            '<h3 class="stk-h">' + esc(t.label) + ' · ' + esc(t.item_name) + ' ' + statePill(t.state) + '</h3>' +
            (t.photo_path ? '<img class="tl-photo tl-photo--lg" alt="' + esc(t.label) + '" data-sign-bucket="uploads" data-sign-path="' + esc(t.photo_path) + '">' : '') +
            '<div class="req-muted">' + esc([t.details, whereText(t), t.purchase_id ? 'Bought ' + RA.formatDay(t.purchase_date) : 'Opening register'].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="stk-actions" style="margin-top:12px">' + actionsFor(t).map((a, i) =>
              '<button type="button" class="att-btn att-btn--sm' + (i === 0 ? ' att-btn--primary' : '') + '" data-tool-act="' + a + '">' + ACTION_LABEL[a] + '</button>').join('') + '</div>' +
            '<h3 class="stk-h">History</h3>' +
            '<div class="stk-recs">' + (t.records.map(r => recordRow(Object.assign({ label: '' }, r), m)).join('') || '<div class="att-empty">Nothing yet.</div>') + '</div>';
        body.querySelector('[data-back]').addEventListener('click', () => { ui.toolId = null; reload(); });
        body.querySelectorAll('[data-tool-act]').forEach(b => b.addEventListener('click', () => runAction(b.dataset.toolAct, t, reload)));
        wireRecords(body, t.records.map(r => Object.assign({ label: t.label }, r)), reload);
        RA.signImages(body);
    }

    async function render(host) {
        host.innerHTML = '<div class="att-stack stk-tab req-detail"><div class="att-empty">Loading…</div></div>';
        let status;
        try { status = await RA.rpc('tl_status'); } catch (e) { RA.fail(host, e); return; }
        cache.status = status;
        if (!status || !status.enabled) return renderOff(host, status);
        const reload = () => render(host);
        cache.choices = null;
        let ov = null;
        if (!(ui.tab === 'tools' && ui.toolId)) {
            try { ov = await RA.rpc('tl_overview'); } catch (e) { RA.fail(host, e); return; }
        }
        host.innerHTML =
            '<div class="att-stack stk-tab req-detail">' +
              RA.head('Tools', 'Every tool by number, and who answers for it. No prices here — a tool\'s cost stays with its purchase.', tabs(ov)) +
              '<div class="stk-actions"><button type="button" class="att-btn att-btn--primary" data-register><i data-lucide="plus"></i> Register tools</button></div>' +
              '<div data-body></div>' +
              (status.is_main_owner ? '<div class="stk-switch-off"><button type="button" class="att-btn att-btn--sm att-btn--ghost" data-switch-off>Switch tools off…</button></div>' : '') +
            '</div>';
        host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            if (ui.tab === b.dataset.tab && !ui.toolId) return;
            ui.tab = b.dataset.tab; ui.toolId = null;
            render(host);
        }));
        host.querySelector('[data-register]').addEventListener('click', () => openRegister(null, reload));
        const off = host.querySelector('[data-switch-off]');
        if (off) off.addEventListener('click', () => openSwitchOff());
        const body = host.querySelector('[data-body]');
        const m = me();
        if (ui.tab === 'tools' && ui.toolId) { await renderTool(body, ui.toolId, reload); RA.icons(); return; }
        const openTool = (id) => { ui.tab = 'tools'; ui.toolId = id; render(host); };
        if (ui.tab === 'out') {
            body.innerHTML = ov.out.length ? '<div class="stk-recs">' + ov.out.map(outRow).join('') + '</div>'
                : '<div class="att-empty">No tool is out.</div>';
            body.querySelectorAll('[data-out-act]').forEach(b => b.addEventListener('click', () => {
                const t = ov.out.find(x => x.id === b.closest('[data-tool-row]').dataset.toolRow);
                if (t) runAction(b.dataset.outAct, t, reload);
            }));
        } else if (ui.tab === 'register') {
            body.innerHTML = ov.to_register.length ? ov.to_register.map(lineCard).join('')
                : '<div class="att-empty">No purchase of tools is waiting to be registered.</div>';
            body.querySelectorAll('[data-line-act]').forEach(b => b.addEventListener('click', () => {
                const key = b.closest('[data-line]').dataset.line;
                const l = ov.to_register.find(x => x.purchase_id + ':' + x.line_no === key);
                if (l) openRegister({ line: l }, reload);
            }));
        } else if (ui.tab === 'pending') {
            body.innerHTML = (ov.pending.length ? '<div class="stk-recs">' + ov.pending.map(r => recordRow(r, m)).join('') + '</div>'
                : '<div class="att-empty">Nothing is waiting for the owner.</div>') +
                (m.isMainOwner ? '' : '<p class="req-muted">Only the main owner confirms or rejects a Lost report or a Retire request.</p>');
            wireRecords(body, ov.pending, reload);
            RA.signImages(body);
        } else {
            body.innerHTML = ov.tools.length ? ov.tools.map(toolCard).join('')
                : '<div class="att-empty">No tools yet. Register the tools the company owns, or a purchase of tools.</div>';
            body.querySelectorAll('[data-tool]').forEach(c => c.addEventListener('click', () => openTool(c.dataset.tool)));
        }
        RA.icons();
    }

    // Switch tools off again: the ZZ pilot failed. Records stay; nothing is undone.
    function openSwitchOff() {
        return RA.modal({
            title: 'Switch tools off',
            sub: 'Type OFF to confirm. Only if the pilot failed.',
            warn: true,
            body: '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
                'Every tool and record stays as it is — nothing is undone or deleted. Recording stops, and the Tools tab goes for everyone but you.</div></div>' +
                '<div class="stk-form"><label class="att-label">Type OFF<input class="att-input" name="word" autocomplete="off"></label></div>',
            submitLabel: 'Switch off',
            errorMessage,
            onSubmit: async (form) => {
                if (form.word.value.trim() !== 'OFF') throw new Error('Type OFF to confirm.');
                await RA.rpc('tl_set_enabled', { p_on: false });
                root.currentToolsOn = false;
            },
            onDone: () => root.location.reload(),
        });
    }

    // Until switched on: nobody sees the tab except the main owner, who sees the switch.
    function renderOff(host, status) {
        if (!status || !status.is_main_owner) {
            host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' +
                esc(ERRORS.TOOLS_OFF) + '</div></div></div>';
            RA.icons();
            return;
        }
        host.innerHTML =
            '<div class="att-stack stk-tab">' +
              RA.head('Tools', 'Not switched on yet.', '') +
              '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
                'Switch tools on for the <strong>ZZ pilot</strong>, then keep them on (launch) — or switch them off again if the pilot fails. ' +
                'Once on, the office registers tools and records who has each one here.</div></div>' +
              '<button type="button" class="att-btn att-btn--warn" data-switch>Switch tools on…</button>' +
            '</div>';
        host.querySelector('[data-switch]').addEventListener('click', () => RA.modal({
            title: 'Switch tools on',
            sub: 'Type TOOLS to confirm.',
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Type TOOLS<input class="att-input" name="word" autocomplete="off"></label></div>',
            submitLabel: 'Switch on',
            errorMessage,
            onSubmit: async (form) => {
                if (form.word.value.trim() !== 'TOOLS') throw new Error('Type TOOLS to confirm.');
                await RA.rpc('tl_set_enabled', { p_on: true });
                root.currentToolsOn = true;
            },
            onDone: () => root.location.reload(),
        }));
        RA.icons();
    }

    root.ToolsAdmin = Object.assign({}, pure, { render });
    RA.views.reqTools = render;
})(typeof window !== 'undefined' ? window : globalThis);
