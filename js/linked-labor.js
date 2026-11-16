// ════════════════════════════════════════════════════════════════════
// Linked Labor (WorkMate, migration 0113) — the office side.
//
// A Project Control labor contract can be linked to a worker's WorkMate
// account, so that worker sees their own agreement on the phone. Only the main
// owner links, relinks or unlinks; nothing links by name. Every contract keeps
// a history (lc_events): once a contract is signed or paid, changing its terms
// needs a reason, daily↔fixed is locked, and it is ended rather than deleted
// while linked. Ending marks nothing paid and moves no payment.
//
// This file is the ONLY caller of the lc_* server functions. It holds:
//   · identity: contracts group by linked account first, then by typed name,
//     so two linked people who share a name never share a card, a statement,
//     an agreement print or a merge (cardKey / sameIdentity);
//   · the New Contract account picker (main owner) and the reason box;
//   · the link, reason and history dialogs.
//
// NO MONEY MOVES here. Nothing writes payroll, an expense or a bill, and
// nothing feeds _projSpent / _projEarned / _projMargin / _recognisedProfit.
// Staff never see the picker, the link controls or the history (it holds
// amounts); the server refuses them anyway.
//
// Works in a browser (window.LinkedLabor) and in Node for
// tests/linked-labor-web.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    // ── Pure half ───────────────────────────────────────────────────

    const workerNo = (n) => (n === null || n === undefined || n === '') ? '' : 'W-' + String(n).padStart(4, '0');
    const trimName = (c) => String((c && c.workerName) || '').trim();

    // The key a contract groups under: its linked account, else its typed name.
    // Unlinked contracts keep exactly today's key (the trimmed name), so nothing
    // unlinked regroups.
    function identityKey(c) {
        if (!c) return '';
        return c.workerId ? 'acct:' + c.workerId : trimName(c);
    }
    // Project Control's worker cards: the same, with today's "—" for no name.
    function cardKey(c) {
        return (c && c.workerId) ? 'acct:' + c.workerId : (trimName(c) || '—');
    }
    const isAccountKey = (k) => typeof k === 'string' && k.indexOf('acct:') === 0;
    const accountOfKey = (k) => isAccountKey(k) ? k.slice(5) : null;
    function sameIdentity(a, b) {
        const ka = identityKey(a);
        return ka !== '' && ka === identityKey(b);
    }

    // Signed, or paid at least once (the server's own test is final).
    function isEstablished(c, payroll) {
        if (!c) return false;
        if (c.agreementSigned) return true;
        return (payroll || []).some(p => p && p.contractId === c.id);
    }

    // The office form's camelCase fields → lc_edit's snake_case keys. Anything
    // else (updatedAt, …) is dropped: the server stamps updated_at itself.
    const CHANGE_KEYS = {
        workerName: 'worker_name', scope: 'scope', trade: 'trade', agreedAmount: 'agreed_amount',
        payType: 'pay_type', payBasis: 'pay_basis', category: 'category', works: 'works', notes: 'notes',
        capHistory: 'cap_history', orientationDate: 'orientation_date',
        agreementSigned: 'agreement_signed', agreementSignedAt: 'agreement_signed_at',
        agreementSignature: 'agreement_signature', agreementPdfUrl: 'agreement_pdf_url',
        agreementPdfName: 'agreement_pdf_name',
    };
    function toChanges(update) {
        const out = {};
        Object.keys(update || {}).forEach(k => {
            if (!CHANGE_KEYS[k]) return;
            let v = update[k];
            if (v instanceof Date) v = v.toISOString();
            out[CHANGE_KEYS[k]] = v === undefined ? null : v;
        });
        return out;
    }

    // The client-side mirror of lc_merge's refusals, so the dialog can say why
    // before anything is sent. The server checks again.
    function mergeProblem(cs) {
        const list = (cs || []).filter(Boolean);
        if (list.length < 2) return 'FEW';
        // One project only (a project's Additional Works is a project of its own).
        if (new Set(list.map(c => c.folderId || '-')).size > 1) return 'FOLDER';
        const keys = new Set(list.map(identityKey));
        const cats = new Set(list.map(c => c.category === 'outsource' ? 'outsource' : 'labor'));
        if (keys.size > 1 || keys.has('') || cats.size > 1) return 'MIXED';
        const bases = new Set(list.map(c => c.payBasis === 'daily' ? 'daily' : 'fixed'));
        if (bases.size > 1) return 'BASIS';
        return null;
    }

    const MESSAGES = {
        OWNER_ONLY: 'Only the main owner can link or change a WorkMate account.',
        OWNER_ROLE_ONLY: 'Only an owner account can do this.',
        OFFICE_ONLY: 'Only the office can change a contract.',
        INACTIVE: 'This account is switched off.',
        NOT_SIGNED_IN: 'Please sign in again.',
        NOT_ELIGIBLE: 'That account can’t be linked: it must be an active worker or team leader of this company.',
        WORKER_NO_MISMATCH: 'The worker number doesn’t match that account. Pick the person again.',
        LABOR_ONLY: 'Only labor contracts can be linked to a WorkMate account (not Out Source).',
        REASON_REQUIRED: 'This contract is signed or paid. Give a reason for the change.',
        LC_REASON_NEEDED: 'This contract is signed or paid. Give a reason for the change.',
        REASON_TOO_LONG: 'Keep the reason under 500 characters.',
        LC_BASIS_LOCKED: 'This contract is signed or paid, so daily↔fixed and Out Source can’t change. End it and make a new one.',
        LC_FIELD_LOCKED: 'That part of a contract can’t be changed here.',
        LC_USE_FUNCTION: 'That change goes through its own button.',
        LC_HISTORY_APPEND_ONLY: 'The contract’s history can only be added to.',
        LC_LINKED: 'This contract is linked to a WorkMate account. End it instead, or unlink the account first.',
        LC_NOT_FOUND: 'This contract wasn’t found. Refresh and try again.',
        LC_MERGE_MIXED: 'These contracts belong to different people (or kinds). Only one person’s contracts can be merged.',
        LC_MERGE_BASIS: 'Daily and fixed contracts can’t be merged together.',
        LC_MERGE_FOLDER: 'Only contracts on the same project can be merged (Additional Works counts as its own project).',
        BAD_MERGE: 'Pick at least two of this person’s contracts to merge.',
        BAD_CHANGE: 'That change isn’t allowed.',
        NOT_A_REQUESTER: 'Only a worker can see this.',
    };
    function codeOf(e) {
        const m = String((e && (e.code === 'P0001' ? e.message : (e.message || e))) || '');
        const hit = m.match(/\b(LC_[A-Z_]+|OWNER_ONLY|OWNER_ROLE_ONLY|OFFICE_ONLY|INACTIVE|NOT_SIGNED_IN|NOT_ELIGIBLE|WORKER_NO_MISMATCH|LABOR_ONLY|REASON_REQUIRED|REASON_TOO_LONG|BAD_MERGE|BAD_CHANGE|NOT_A_REQUESTER)\b/);
        return hit ? hit[1] : null;
    }
    function errorText(e) {
        const code = codeOf(e);
        if (code && MESSAGES[code]) return MESSAGES[code];
        if (/column .*(worker_id|ended_at)|function .*lc_(link|edit|end|merge|delete)/i.test(String((e && e.message) || e))) {
            return 'Linked Labor needs migration 0113 applied first.';
        }
        return 'Something went wrong: ' + String((e && e.message) || e || 'unknown error');
    }

    const KIND_LABEL = {
        created: 'Created', linked: 'Linked to a WorkMate account', relinked: 'WorkMate account changed',
        unlinked: 'WorkMate account removed', edited: 'Terms changed', ended: 'Ended', reopened: 'Reopened',
        merged: 'Merged into another contract', deleted: 'Deleted',
    };
    const FIELD_LABEL = {
        worker_name: 'Name', scope: 'Scope', trade: 'Trade', agreed_amount: 'Agreed amount', pay_type: 'Pay type',
        pay_basis: 'Basis', category: 'Kind', works: 'Works', folder_id: 'Project', orientation_date: 'Orientation date',
        agreement_signed: 'Signed', agreement_signed_at: 'Signed on', agreement_signature: 'Signed by',
        agreement_signature_image: 'Signature', agreement_terms_snapshot: 'Terms text',
        agreement_pdf_url: 'Agreement PDF', agreement_pdf_name: 'Agreement file',
    };
    const showVal = (v) => {
        if (v === null || v === undefined || v === '') return '—';
        if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? x : ((x && x.name) || '')).filter(Boolean).join(', ') || '—';
        if (typeof v === 'boolean') return v ? 'yes' : 'no';
        return String(v);
    };
    const personText = (p) => p && p.worker_id ? (p.name || 'Worker') + (p.worker_no != null ? ' · ' + workerNo(p.worker_no) : '') : 'no account';
    // One readable line per history event.
    function historyLine(ev) {
        const b = ev.before || {}, a = ev.after || {};
        let what = '';
        if (ev.kind === 'linked' || ev.kind === 'relinked' || ev.kind === 'unlinked') {
            what = ev.kind === 'linked' ? personText(a) : personText(b) + ' → ' + personText(a);
        } else if (ev.kind === 'edited') {
            what = Object.keys(a).concat(Object.keys(b).filter(k => !(k in a)))
                .filter(k => k !== 'agreement_signature_image' && k !== 'agreement_terms_snapshot')
                .map(k => (FIELD_LABEL[k] || k) + ': ' + showVal(b[k]) + ' → ' + showVal(a[k])).join('; ');
        } else if (ev.kind === 'deleted' || ev.kind === 'merged') {
            what = (b.scope ? b.scope : '') + (b.payments ? ' · ' + b.payments + ' payment' + (b.payments === 1 ? '' : 's') : '');
        }
        return { label: KIND_LABEL[ev.kind] || ev.kind, what, reason: ev.reason || '', at: ev.at };
    }

    const pure = { workerNo, identityKey, cardKey, isAccountKey, accountOfKey, sameIdentity, isEstablished,
                   toChanges, mergeProblem, codeOf, errorText, historyLine, CHANGE_KEYS, MESSAGES };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser half ────────────────────────────────────────────────

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const sb = () => root.sbClient;
    const isStaff = () => root.currentUserRole === 'staff';
    const isOwnerRole = () => root.currentUserRole === 'owner';

    async function rpc(name, args) {
        const client = sb();
        if (!client) throw new Error('Not connected.');
        const { data, error } = await client.rpc(name, args || {});
        if (error) { const e = new Error(errorText(error)); e.code = codeOf(error); e.raw = error; throw e; }
        return data;
    }

    // Main owner? Asked once; the server decides every action anyway.
    let _me = null;
    async function me() {
        if (_me) return _me;
        try {
            const { data } = await sb().rpc('wk_me');
            _me = { isMainOwner: !!(data && data.is_main_owner) };
        } catch (_) { _me = { isMainOwner: false }; }
        return _me;
    }
    const isMainOwnerNow = () => !!(_me && _me.isMainOwner);

    // Linked accounts' names and worker numbers (profiles are readable by any
    // signed-in account). Cached; a 'll:people' event tells screens to redraw.
    const _people = {};
    async function people(ids) {
        const want = Array.from(new Set((ids || []).filter(id => id && !_people[id])));
        if (want.length && sb()) {
            try {
                const { data } = await sb().from('profiles')
                    .select('id, worker_no, display_name, first_name, last_name').in('id', want);
                (data || []).forEach(p => {
                    const name = String(p.display_name || '').trim()
                        || [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || workerNo(p.worker_no) || 'Worker';
                    _people[p.id] = { name, no: p.worker_no };
                });
                root.dispatchEvent && root.dispatchEvent(new CustomEvent('ll:people'));
            } catch (_) { /* labels fall back to the typed name */ }
        }
        return _people;
    }
    const personOf = (id) => _people[id] || null;
    // " · W-0013" for a linked contract, '' otherwise.
    function tagOf(c) {
        if (!c || !c.workerId) return '';
        const p = personOf(c.workerId);
        return p && p.no != null ? ' · ' + workerNo(p.no) : ' · linked';
    }
    // A card / statement label: the recorded typed name, plus the worker number.
    function labelOf(c) {
        return (trimName(c) || '—') + tagOf(c);
    }

    const candidates = () => rpc('lc_link_candidates');
    const link = (contractId, workerId, workerNumber, reason) =>
        rpc('lc_link', { p_contract: contractId, p_worker: workerId || null, p_worker_no: workerNumber == null ? null : Number(workerNumber), p_reason: reason || '' });
    const edit = (contractId, update, reason) =>
        rpc('lc_edit', { p_contract: contractId, p_changes: toChanges(update), p_reason: reason || '' });
    const end = (contractId, reason) => rpc('lc_end', { p_contract: contractId, p_reason: reason || '' });
    const reopen = (contractId, reason) => rpc('lc_reopen', { p_contract: contractId, p_reason: reason || '' });
    const remove = (contractId, reason) => rpc('lc_delete', { p_contract: contractId, p_reason: reason || '' });
    const merge = (ids, keeper, title, reason) =>
        rpc('lc_merge', { p_contracts: ids, p_keeper: keeper, p_title: title || '', p_reason: reason || '' });
    async function history(contractId) {
        const { data, error } = await sb().from('lc_events').select('*').eq('contract_id', contractId).order('id');
        if (error) throw new Error(errorText(error));
        return data || [];
    }

    // ── Dialogs (the module's own small overlay, in the lcm- style) ──
    function overlay(id, title, sub, bodyHtml, footHtml) {
        const old = document.getElementById(id);
        if (old) old.remove();
        const ov = document.createElement('div');
        ov.id = id;
        ov.className = 'lcm-ov';
        ov.innerHTML = '<div class="lcm-card" style="max-width:480px;">'
            + '<div class="lcm-head"><div><h3 class="lcm-title">' + esc(title) + '</h3>'
            + (sub ? '<div class="lcm-sub">' + esc(sub) + '</div>' : '') + '</div>'
            + '<button type="button" class="lcm-x" data-ll-close aria-label="Close">&times;</button></div>'
            + '<div class="lcm-body">' + bodyHtml + '</div>'
            + '<div class="lcm-foot">' + footHtml + '</div></div>';
        document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        ov.querySelectorAll('[data-ll-close]').forEach(b => b.addEventListener('click', close));
        return { ov, close };
    }
    const reasonBox = (id, required, placeholder) =>
        '<label for="' + id + '" style="display:block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A1A1A6;margin:14px 0 6px;">Reason'
        + (required ? ' <span style="color:#B4453A;">(required)</span>' : ' <span style="font-weight:500;text-transform:none;letter-spacing:0;">(optional)</span>') + '</label>'
        + '<textarea id="' + id + '" rows="2" maxlength="500" placeholder="' + esc(placeholder || 'Why is this changing?') + '" '
        + 'style="width:100%;border:1.5px solid #D1D5DB;border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;"></textarea>';
    const errorLine = '<div data-ll-err style="display:none;margin-top:10px;font-size:12.5px;font-weight:600;color:#B4453A;"></div>';
    function showErr(ov, msg) { const el = ov.querySelector('[data-ll-err]'); if (el) { el.textContent = msg; el.style.display = ''; } }

    // Ask for a reason. Resolves to the text, or null when cancelled.
    function askReason(opts) {
        const o = opts || {};
        return new Promise(resolve => {
            const { ov, close } = overlay('llReasonOverlay', o.title || 'Give a reason', o.sub || '',
                (o.body ? '<div style="font-size:13px;line-height:1.55;color:#3A3A3C;">' + o.body + '</div>' : '')
                + reasonBox('llReasonText', o.required !== false, o.placeholder) + errorLine,
                '<button type="button" class="lcm-btn" data-ll-close>Cancel</button>'
                + '<button type="button" class="lcm-btn primary" id="llReasonGo">' + esc(o.action || 'Save') + '</button>');
            let done = false;
            const finish = (v) => { if (!done) { done = true; close(); resolve(v); } };
            ov.querySelectorAll('[data-ll-close]').forEach(b => b.addEventListener('click', () => finish(null)));
            ov.addEventListener('click', e => { if (e.target === ov) finish(null); });
            ov.querySelector('#llReasonGo').addEventListener('click', () => {
                const v = String(ov.querySelector('#llReasonText').value || '').trim();
                if (o.required !== false && !v) { showErr(ov, 'Write a short reason first.'); return; }
                finish(v);
            });
            const t = ov.querySelector('#llReasonText'); if (t) t.focus();
        });
    }

    // Link, change or remove the WorkMate account of one contract. Main owner.
    async function openLinkDialog(c, projectName) {
        if (!c) return;
        await me();
        if (!isMainOwnerNow()) { notify(MESSAGES.OWNER_ONLY, 'error'); return; }
        if (c.category === 'outsource') { notify(MESSAGES.LABOR_ONLY, 'error'); return; }
        let list;
        try { list = await candidates(); } catch (e) { notify(e.message, 'error'); return; }
        await people([c.workerId]);
        const cur = c.workerId ? personOf(c.workerId) : null;
        const opts = '<option value="">— Choose a worker —</option>' + (list || []).map(p =>
            '<option value="' + esc(p.id) + '" data-no="' + esc(p.worker_no) + '" data-name="' + esc(p.name) + '"'
            + (p.id === c.workerId ? ' disabled' : '') + '>'
            + esc(p.name) + ' · ' + esc(workerNo(p.worker_no)) + (p.position ? ' — ' + esc(p.position) : '')
            + (p.role === 'teamLeader' ? ' (team leader)' : '') + '</option>').join('');
        const body =
            '<div style="font-size:13px;line-height:1.6;color:#3A3A3C;">'
            + '<b>' + esc(c.scope || 'Untitled job') + '</b>' + (projectName ? ' · ' + esc(projectName) : '') + '<br>'
            + 'Recorded name: <b>' + esc(trimName(c) || '—') + '</b><br>'
            + 'Now: <b>' + (cur ? esc(cur.name) + ' · ' + esc(workerNo(cur.no)) : 'not linked') + '</b></div>'
            + '<label for="llPick" style="display:block;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#A1A1A6;margin:16px 0 6px;">WorkMate account</label>'
            + '<select id="llPick" style="width:100%;border:1.5px solid #D1D5DB;border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;">' + opts + '</select>'
            + '<div id="llConfirm" style="display:none;margin-top:12px;padding:11px 13px;border-radius:10px;background:#FFF8E6;border:1px solid #F1D48A;font-size:12.5px;line-height:1.55;color:#5C4813;"></div>'
            + reasonBox('llLinkReason', !!c.workerId, c.workerId ? 'Why is the account changing?' : 'Optional note')
            + errorLine;
        const foot = '<button type="button" class="lcm-btn" data-ll-close>Cancel</button>'
            + (c.workerId ? '<button type="button" class="lcm-btn" id="llUnlink" style="color:#B4453A;">Unlink</button>' : '')
            + '<button type="button" class="lcm-btn primary" id="llLinkGo">' + (c.workerId ? 'Change account' : 'Link account') + '</button>';
        const { ov, close } = overlay('llLinkOverlay', c.workerId ? 'Change WorkMate account' : 'Link a WorkMate account',
            'Main owner only · nothing is linked by name', body, foot);
        const pick = ov.querySelector('#llPick');
        const confirmBox = ov.querySelector('#llConfirm');
        pick.addEventListener('change', () => {
            const o = pick.selectedOptions[0];
            if (!o || !o.value) { confirmBox.style.display = 'none'; return; }
            confirmBox.innerHTML = '<b>' + esc(o.dataset.name) + ' · ' + esc(workerNo(o.dataset.no)) + '</b> will see this agreement’s '
                + 'scope, agreed amount, payments and balance in WorkMate. Nothing else changes: not the recorded name, '
                + 'the payments, or any other contract.';
            confirmBox.style.display = '';
        });
        const run = async (workerId, no) => {
            const reason = String(ov.querySelector('#llLinkReason').value || '').trim();
            if (c.workerId && !reason) { showErr(ov, 'Write a short reason first.'); return; }
            try {
                await link(c.id, workerId, no, reason);
                close();
                notify(workerId ? 'WorkMate account linked ✓' : 'WorkMate account removed ✓', 'success');
            } catch (e) { showErr(ov, e.message); }
        };
        ov.querySelector('#llLinkGo').addEventListener('click', () => {
            const o = pick.selectedOptions[0];
            if (!o || !o.value) { showErr(ov, 'Choose the worker first.'); return; }
            run(o.value, o.dataset.no);
        });
        const un = ov.querySelector('#llUnlink');
        if (un) un.addEventListener('click', () => run(null, null));
    }

    async function confirmEnd(c) {
        const reason = await askReason({
            title: 'End this contract', sub: c.scope || '', action: 'End contract',
            body: 'Ending marks nothing as paid and moves no payment. Its payments and balance stay, and it can still be paid to settle it. '
                + 'To change how it is paid, end it and make a new contract.',
            placeholder: 'e.g. Replaced by a daily contract' });
        if (reason === null) return;
        try { await end(c.id, reason); notify('Contract ended ✓', 'success'); } catch (e) { notify(e.message, 'error'); }
    }
    async function confirmReopen(c) {
        const reason = await askReason({ title: 'Reopen this contract', sub: c.scope || '', action: 'Reopen',
                                         placeholder: 'e.g. Ended by mistake' });
        if (reason === null) return;
        try { await reopen(c.id, reason); notify('Contract reopened ✓', 'success'); } catch (e) { notify(e.message, 'error'); }
    }

    async function openHistory(c) {
        const { ov } = overlay('llHistoryOverlay', 'Contract history', (c.scope || 'Untitled job') + ' · ' + (trimName(c) || '—'),
            '<div id="llHistBody" style="font-size:13px;color:#6C6C70;">Loading…</div>',
            '<button type="button" class="lcm-btn" data-ll-close>Close</button>');
        try {
            const evs = await history(c.id);
            const rowsHtml = evs.slice().reverse().map(ev => {
                const h = historyLine(ev);
                const when = ev.at ? new Date(ev.at).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
                return '<div style="padding:9px 0;border-top:1px solid #F0F0F0;">'
                    + '<div style="font-size:13px;font-weight:700;color:#1C1C1E;">' + esc(h.label) + '</div>'
                    + (h.what ? '<div style="font-size:12.5px;color:#3A3A3C;margin-top:2px;">' + esc(h.what) + '</div>' : '')
                    + (h.reason ? '<div style="font-size:12.5px;color:#6C6C70;margin-top:2px;">Reason: ' + esc(h.reason) + '</div>' : '')
                    + '<div style="font-size:11.5px;color:#A1A1A6;margin-top:2px;">' + esc(when) + '</div></div>';
            }).join('');
            ov.querySelector('#llHistBody').innerHTML = rowsHtml || 'No history recorded yet.';
        } catch (e) {
            ov.querySelector('#llHistBody').textContent = e.message;
        }
    }

    function notify(msg, kind) {
        if (typeof root.showExpNotif === 'function') root.showExpNotif(msg, kind);
        else if (kind === 'error') root.alert(msg);
    }

    // ── The New / Edit Labor Contract form ──────────────────────────
    // New + main owner + labor: the optional account picker. Edit: the reason
    // box, and the daily option locked once the contract is signed or paid.
    let _formContract = null;
    async function formOpened(c, payroll) {
        _formContract = c || null;
        const grp = document.getElementById('lcAccountGroup');
        const sel = document.getElementById('lcAccount');
        const note = document.getElementById('lcAccountNote');
        const rg = document.getElementById('lcReasonGroup');
        const rIn = document.getElementById('lcReason');
        if (rIn) rIn.value = '';
        if (note) { note.textContent = ''; note.style.display = 'none'; }
        if (sel) sel.innerHTML = '<option value="">— Not linked (typed name only) —</option>';
        if (grp) grp.style.display = 'none';
        const est = !!c && isEstablished(c, payroll);
        if (rg) rg.style.display = c ? '' : 'none';
        const rLbl = document.getElementById('lcReasonLabel');
        if (rLbl) rLbl.textContent = est ? 'Reason for this change (required: this contract is signed or paid)'
                                         : 'Reason for this change (optional)';
        // Daily ↔ fixed is locked once established (Q4).
        document.querySelectorAll('input[name="lcShape"]').forEach(r => {
            const lockIt = est && ((r.value === 'daily') !== (c.payBasis === 'daily'));
            r.disabled = lockIt;
            const lab = r.closest('label'); if (lab) lab.style.opacity = lockIt ? '.45' : '';
        });
        const lockNote = document.getElementById('lcBasisLockNote');
        if (lockNote) lockNote.style.display = est ? '' : 'none';
        if (c) return;                                   // linking an existing contract: the card's Account button
        const cat = (document.getElementById('lcCategory') || {}).value;
        if (isStaff() || cat === 'outsource') return;
        await me();
        if (!isMainOwnerNow() || !grp || !sel) return;
        try {
            const list = await candidates();
            sel.innerHTML = '<option value="">— Not linked (typed name only) —</option>' + (list || []).map(p =>
                '<option value="' + esc(p.id) + '" data-no="' + esc(p.worker_no) + '" data-name="' + esc(p.name) + '" data-trade="' + esc(p.position) + '">'
                + esc(p.name) + ' · ' + esc(workerNo(p.worker_no)) + (p.position ? ' — ' + esc(p.position) : '') + '</option>').join('');
            grp.style.display = '';
        } catch (_) { /* the picker stays hidden: typed names work as always */ }
    }
    // Choosing an account fills the name and trade as editable defaults and
    // says who will see the money. The profile is never written.
    function onFormAccountChange() {
        const sel = document.getElementById('lcAccount');
        const note = document.getElementById('lcAccountNote');
        const o = sel && sel.selectedOptions[0];
        if (!o || !o.value) { if (note) { note.textContent = ''; note.style.display = 'none'; } return; }
        const w = document.getElementById('lcWorker');
        if (w && !w.value.trim()) { w.value = o.dataset.name || ''; if (typeof root.lcAgrSyncWorkerName === 'function') root.lcAgrSyncWorkerName(); }
        const t = document.getElementById('lcTrade');
        if (t && !t.value.trim() && o.dataset.trade) t.value = o.dataset.trade;
        if (note) {
            note.innerHTML = '<b>' + esc(o.dataset.name) + ' · ' + esc(workerNo(o.dataset.no)) + '</b> will see this agreement’s amounts and payments in WorkMate.';
            note.style.display = '';
        }
    }
    function formAccountId() {
        const grp = document.getElementById('lcAccountGroup');
        const sel = document.getElementById('lcAccount');
        if (!grp || grp.style.display === 'none' || !sel) return null;
        return sel.value || null;
    }
    const formReason = () => String((document.getElementById('lcReason') || {}).value || '').trim();

    root.LinkedLabor = Object.assign({}, pure, {
        me, isMainOwnerNow, people, personOf, tagOf, labelOf,
        candidates, link, edit, end, reopen, remove, merge, history,
        askReason, openLinkDialog, confirmEnd, confirmReopen, openHistory,
        formOpened, onFormAccountChange, formAccountId, formReason,
    });
})(typeof window !== 'undefined' ? window : globalThis);
