// ════════════════════════════════════════════════════════════════════
// Requests (WorkMate, 0085/0086) — shared core for the office screens.
//
// Workers and team leaders request materials and tools in DAC'S WorkMate.
// The office (owner + staff) processes them in the Requests section:
//   js/requests-admin-queue.js  — the queue and one request's detail
//   js/requests-admin-setup.js  — weekly batches, teams, catalogue, projects
//   js/requests-admin-history.js — Item history: search, item page, references (0090)
//   js/requests-admin-gallery.js — Item history: product photos and photo review (0090)
// Every change goes through a 0086/0090 office RPC; nothing here writes a table.
// NO MONEY: quantities only — no price, amount or cost anywhere.
//
// Works in a browser (window.RequestsAdmin, window.initRequestsModule) and
// in Node for tests/requests-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Asia/Manila has no daylight saving: always UTC+8. Computing from UTC
    // parts keeps every browser on Manila time, whatever its own zone.
    const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

    // ── Dates ───────────────────────────────────────────────────────

    function manilaParts(iso) {
        const t = Date.parse(iso);
        if (!iso || isNaN(t)) return null;
        const d = new Date(t + MANILA_OFFSET_MS);
        return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(),
                 h: d.getUTCHours(), min: d.getUTCMinutes() };
    }

    function clock(h, min) {
        if (h === 12 && min === 0) return '12:00 noon';
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return h12 + ':' + String(min).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
    }

    function formatManila(iso) {
        const p = manilaParts(iso);
        if (!p) return '—';
        return DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m] + ' ' + p.y + ', ' + clock(p.h, p.min);
    }

    function shortDay(iso) {
        const p = manilaParts(iso);
        return p ? DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m] : '—';
    }

    function cutoffLabel(iso) {
        const p = manilaParts(iso);
        return p ? DAYS[p.dow] + ' ' + p.d + ' ' + MONTHS[p.m] + ', ' + clock(p.h, p.min) : '—';
    }

    // A date-only value ('2026-10-12') is a calendar day, not an instant:
    // read its parts, never pass it through a time zone.
    function formatDay(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
        if (!m) return '—';
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return DAYS[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MONTHS[+m[2] - 1];
    }

    function batchLabel(b) {
        return 'Cutoff ' + cutoffLabel(b.cutoff_at) + ' · Buy ' + formatDay(b.purchase_on) + ' · Deliver ' + formatDay(b.delivery_on);
    }

    function validateDates(purchase, delivery) {
        const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
        if (!ok(purchase) || !ok(delivery)) return 'Enter both dates.';
        if (delivery < purchase) return 'Delivery cannot be before purchasing.';
        return null;
    }

    // ── Quantities ──────────────────────────────────────────────────

    function formatQty(n) {
        if (n === null || n === undefined || n === '') return '—';
        const x = Number(n);
        if (!isFinite(x)) return '—';
        return x.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }

    // Same bounds as the server (0085/0086): > 0, <= 1,000,000, 3 decimals.
    function parseQty(text) {
        const s = String(text === null || text === undefined ? '' : text).trim();
        if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
        const x = Number(s);
        return x > 0 && x <= 1000000 ? x : null;
    }

    // ── Line and request states ─────────────────────────────────────

    // Order matters: something the office must resolve outranks the rest.
    // A CANCELLED line with arranged quantity still shows 'reduction' —
    // the order may already be placed, and only the office can settle it.
    function lineState(line) {
        const portions = line.portions || [];
        if ((line.open_conflicts || []).length) return 'conflict';
        if (portions.some(p => Number(p.pending_reduction) > 0)) return 'reduction';
        if (line.status === 'cancelled') return 'cancelled';
        const arranged = portions.filter(p => p.arranged).length;
        if (arranged === 0) return 'unarranged';
        return arranged === portions.length ? 'arranged' : 'partly';
    }

    const STATE_LABEL = {
        conflict: 'Needs resolution',
        reduction: 'Reduction to resolve',
        cancelled: 'Cancelled',
        unarranged: 'To arrange',
        partly: 'Partly arranged',
        arranged: 'Arranged',
    };
    const STATE_PILL = {
        conflict: 'att-pill--abandoned',
        reduction: 'att-pill--abandoned',
        cancelled: 'att-pill--hidden',
        unarranged: 'att-pill--none',
        partly: 'att-pill--working',
        arranged: 'att-pill--done',
    };
    const ACTION_STATES = ['conflict', 'reduction', 'unarranged', 'partly'];

    function needsAction(line) {
        return ACTION_STATES.includes(lineState(line));
    }

    function requestSummary(req) {
        const lines = req.lines || [];
        const open = lines.filter(l => l.status === 'open');
        const urgent = open.filter(l => l.urgent);
        const neededBy = urgent.map(l => l.needed_by).filter(Boolean).sort()[0] || null;
        const cutoffs = [];
        const batchIds = [];
        // Batches and cutoffs come from what the office still works on: open
        // lines, plus any portion (even on a cancelled line) with a reduction
        // to resolve — that order may already be placed.
        lines.forEach(l => (l.portions || []).forEach(p => {
            const pending = Number(p.pending_reduction) > 0;
            if (l.status !== 'open' && !pending) return;
            if (((l.status === 'open' && !p.arranged) || pending) && p.cutoff_at) cutoffs.push(p.cutoff_at);
            if (!batchIds.includes(p.batch_id)) batchIds.push(p.batch_id);
        }));
        cutoffs.sort((a, b) => Date.parse(a) - Date.parse(b));
        const states = lines.map(lineState);
        return {
            urgent: urgent.length > 0,
            neededBy,
            openLines: open.length,
            totalLines: lines.length,
            actionLines: states.filter(s => ACTION_STATES.includes(s)).length,
            conflicts: states.filter(s => s === 'conflict').length,
            reductions: states.filter(s => s === 'reduction').length,
            firstCutoff: cutoffs[0] || null,
            batchIds,
        };
    }

    function cmpNullLast(a, b, key) {
        if (a === b) return 0;
        if (a === null || a === undefined) return 1;
        if (b === null || b === undefined) return -1;
        return key(a) - key(b);
    }

    // Urgent first (earliest needed-by first), then the earliest weekly
    // batch still to arrange, then first come first served.
    function sortQueue(reqs) {
        const day = (s) => Date.parse(s + 'T00:00:00Z');
        return (reqs || []).map(r => ({ r, s: requestSummary(r) })).sort((a, b) => {
            if (a.s.urgent !== b.s.urgent) return a.s.urgent ? -1 : 1;
            if (a.s.urgent) {
                const n = cmpNullLast(a.s.neededBy, b.s.neededBy, day);
                if (n) return n;
            }
            const c = cmpNullLast(a.s.firstCutoff, b.s.firstCutoff, Date.parse);
            if (c) return c;
            return Date.parse(a.r.received_at) - Date.parse(b.r.received_at);
        }).map(x => x.r);
    }

    function filterQueue(reqs, opts) {
        const o = opts || {};
        const text = String(o.text || '').trim().toLowerCase();
        return (reqs || []).filter(r => {
            const s = requestSummary(r);
            if (o.batchId && !s.batchIds.includes(o.batchId)) return false;
            if (o.actionOnly && s.actionLines === 0) return false;
            if (!text) return true;
            const hay = [r.requester_name, r.project_name, r.work_name, r.team_name, r.note]
                .concat((r.lines || []).map(l => [l.description, l.spec, l.catalog_name].join(' ')))
                .join(' ').toLowerCase();
            return hay.includes(text);
        });
    }

    // ── History ─────────────────────────────────────────────────────

    function withNote(d) {
        return d && d.note ? ' — ' + d.note : '';
    }

    function eventText(ev) {
        const d = (ev && ev.detail) || {};
        const q = formatQty;
        switch (ev && ev.kind) {
            case 'submitted':               return 'Sent the request';
            case 'quantity_changed':        return 'Changed the quantity ' + q(d.from) + ' → ' + q(d.to);
            case 'quantity_conflict':       return 'Offline edit to ' + q(d.proposed) + ' arrived after the quantity had changed to ' + q(d.current) + ' — needs resolution';
            case 'line_cancelled':          return 'Cancelled the item';
            case 'request_cancelled':       return 'Cancelled the request';
            case 'photo_attached':          return 'Added a photo';
            case 'portion_arranged':        return 'Marked ' + q(d.quantity) + ' arranged';
            case 'portion_unarranged':      return 'Undid "arranged" on ' + q(d.quantity);
            case 'reduction_resolved':      return (d.outcome === 'order_reduced' ? 'Reduced the order by ' + q(d.quantity) : 'Kept ' + q(d.quantity) + ' as surplus') + withNote(d);
            case 'office_quantity_changed': return 'Office changed the quantity ' + q(d.from) + ' → ' + q(d.to) + ' — ' + (d.reason || '');
            case 'office_line_cancelled':   return 'Office cancelled the item — ' + (d.reason || '');
            case 'conflict_resolved':       return (d.applied ? 'Applied the offline edit (' + q(d.proposed) + ')' : 'Kept the current quantity; offline edit (' + q(d.proposed) + ') not applied') + withNote(d);
            case 'item_matched':            return d.catalog_item_id ? 'Matched to a catalogue item' : 'Removed the catalogue match';
            case 'portion_moved':           return 'Moved ' + q(d.quantity) + ' to another weekly batch' + withNote(d);
            default:                        return String((ev && ev.kind) || '');
        }
    }

    // ── Server error codes → sentences ─────────────────────────────

    const ERRORS = {
        OFFICE_ONLY: 'Only the office (owner or staff accounts) can do this.',
        NOT_FOUND: 'This record no longer exists or belongs to another company. Reload the page.',
        LINE_CLOSED: 'This item is already cancelled.',
        REDUCTION_PENDING: 'A reduction is waiting on this quantity. Resolve it first.',
        NOTHING_PENDING: 'There is no reduction left to resolve. Reload the page.',
        ALREADY_RESOLVED: 'Someone already resolved this. Reload the page.',
        BAD_QUANTITY: 'Enter a quantity above 0 (up to 1,000,000, at most 3 decimals).',
        REASON_REQUIRED: 'Write a short reason. It is saved in the item\'s history.',
        BAD_CATALOG_ITEM: 'Pick an active catalogue item of the same kind (material or tool).',
        BAD_BATCH: 'That weekly batch is not available. Reload the page.',
        BAD_DATES: 'Delivery cannot be before purchasing. Check both dates.',
        ARRANGED: 'Arranged quantity cannot be moved. Undo "arranged" first.',
        NOT_A_TEAM_LEADER: 'Only an account with the Team Leader role can lead a team.',
        NOT_IN_TEAM: 'Add this person to the team first.',
        DUPLICATE_ITEM: 'This item (same name, size/spec and unit) is already in the catalogue.',
        DUPLICATE_TEAM: 'An active team already has this name.',
        BAD_ITEM: 'Fill in the item name and unit, choose Material or Tool, and keep other names to 20 or fewer, each up to 60 characters.',
        BAD_OUTCOME: 'Choose what happened to the order.',
        BAD_TEAM: 'Give the team a name. To change members, the team must be active — reload the page if it still fails.',
        BAD_WORKER: 'Only active workers and team leaders of your company can join a team.',
        // 0090 — item history
        HISTORY_NOT_AVAILABLE: 'This item has no history to show. Reload the page.',
        BAD_REFERENCE: 'Write what was used, and give a date unless you choose "Date unknown".',
        BAD_DESTINATION: 'Pick the project, then Main Contract or one of that project\'s own Additional Works.',
        CHECKLIST_REQUIRED: 'Tick all three checks before a photo goes to the workers\' gallery.',
        BAD_PATH: 'The photo was stored in the wrong place. Try again.',
        FILE_MISSING: 'The photo upload did not finish. Try again.',
        ALREADY_IN_GALLERY: 'This photo is already in the gallery.',
        ALREADY_REVIEWED: 'Someone already reviewed this photo. Reload the page.',
        NOT_MATCHED: 'Match the request line to a catalogue item first (open the request).',
        PHOTO_RETIRED: 'This photo is retired. Pick an approved photo.',
        TOO_MANY_ITEMS: 'Too many items at once. Try again with fewer.',
        // Browser-side (never sent by the server)
        NO_PHOTO: 'Choose a photo first.',
        UPLOAD_FAILED: 'The photo upload failed. Check the connection and try again.',
    };

    function errorMessage(error) {
        const text = String((error && (error.message || error.error_description || error.error)) || (typeof error === 'string' ? error : '') || '');
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) return ERRORS[code];
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    // ── People ──────────────────────────────────────────────────────

    // The roster number the crew and the Attendance screens use (W-0007).
    // Two workers can share a display name; the number tells them apart.
    function workerNo(n) {
        const x = Number(n);
        return n !== null && n !== undefined && n !== '' && Number.isInteger(x) && x > 0
            ? 'W-' + String(x).padStart(4, '0') : '';
    }

    // ── Catalogue ───────────────────────────────────────────────────

    function itemLabel(item) {
        return item.name + (item.spec ? ' · ' + item.spec : '') + ' (' + item.unit + ')';
    }

    function catalogMatches(items, kind, text) {
        const t = String(text || '').trim().toLowerCase();
        return (items || [])
            .filter(i => i.active && i.kind === kind)
            .filter(i => !t || [i.name, i.spec, i.unit, i.category].join(' ').toLowerCase().includes(t))
            .sort((a, b) => a.name.localeCompare(b.name) || String(a.spec).localeCompare(String(b.spec)));
    }

    // ── Item history (0090) ─────────────────────────────────────────

    // Workers' own words for an item, comma or new-line separated: trimmed,
    // blanks dropped, one per spelling. The server cleans the same way.
    function parseAliases(text) {
        const seen = new Set();
        const out = [];
        String(text || '').split(/[,\n]/).forEach(s => {
            const a = s.trim();
            if (a && !seen.has(a.toLowerCase())) { seen.add(a.toLowerCase()); out.push(a); }
        });
        return out;
    }

    // pr_office_save_item's caps: at most 20 aliases, 60 characters each.
    function aliasesProblem(list) {
        return (list || []).length > 20 || (list || []).some(a => a.length > 60) ? 'BAD_ITEM' : null;
    }

    // A history entry's date is a calendar day (or a month, or unknown):
    // read its parts, never pass it through a time zone.
    function entryDateLabel(e) {
        if (!e || e.date_precision === 'unknown') return 'Date unknown';
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(e.date || ''));
        if (!m) return 'Date unknown';
        if (e.date_precision === 'approximate') return 'around ' + MONTHS[+m[2] - 1] + ' ' + m[1];
        return (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
    }

    const ENTRY_PILL = {
        'Requested': 'att-pill--done',
        'Requested — cancelled': 'att-pill--hidden',
        'Historical reference': 'att-pill--pc',
    };
    function entryPill(e) {
        if (!e || e.retired) return 'att-pill--hidden';
        return ENTRY_PILL[e.label] || 'att-pill--none';
    }

    // pr_office_add_ref's rule: a description, a known precision, and a
    // date exactly when the precision is not 'unknown'.
    function refProblem(r) {
        const v = r || {};
        if (!String(v.description || '').trim()) return 'BAD_REFERENCE';
        if (!['exact', 'approximate', 'unknown'].includes(v.precision)) return 'BAD_REFERENCE';
        const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(String(v.date || ''));
        return (v.precision === 'unknown') === hasDate ? 'BAD_REFERENCE' : null;
    }

    // <company>/<item>/<uuid>.jpg in lower case — the only shape
    // pr_gallery_check_path accepts.
    function galleryPath(ownerId, itemId, id) {
        if (!ownerId) throw new Error('No company account to file the photo under — sign in again.');
        if (!itemId || !id) throw new Error('Missing the item or the photo id.');
        return [ownerId, itemId, id].map(x => String(x).toLowerCase()).join('/') + '.jpg';
    }

    const pure = { formatQty, parseQty, manilaParts, formatManila, formatDay, shortDay, cutoffLabel, batchLabel,
                   validateDates, lineState, STATE_LABEL, STATE_PILL, needsAction, requestSummary, sortQueue,
                   filterQueue, eventText, ERRORS, errorMessage, workerNo, itemLabel, catalogMatches,
                   parseAliases, aliasesProblem, entryDateLabel, entryPill, refProblem, galleryPath };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser helpers ─────────────────────────────────────────────

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function icons() {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }

    async function rpc(name, args) {
        const { data, error } = await root.sbClient.rpc(name, args || {});
        if (error) throw error;
        return data;
    }

    function fail(host, error) {
        host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
            esc(errorMessage(error)) + '</div></div></div>';
        icons();
    }

    // One modal at a time, in a host appended to <body>. onSubmit throws to
    // keep the modal open with the message; on success the modal closes and
    // onDone runs (usually: re-render the view).
    function modal(opts) {
        let host = document.getElementById('reqModalHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'reqModalHost';
            document.body.appendChild(host);
        }
        host.innerHTML =
            '<div class="att-modal" id="reqModal">' +
              '<div class="att-modal-box att-modal-box--narrow" role="dialog" aria-modal="true" aria-labelledby="reqModalTitle">' +
                '<div class="att-modal-head"><div>' +
                  '<h3 class="att-modal-title" id="reqModalTitle">' + esc(opts.title) + '</h3>' +
                  (opts.sub ? '<p class="att-modal-sub">' + esc(opts.sub) + '</p>' : '') +
                '</div><button class="att-modal-x" type="button" data-close aria-label="Close">&times;</button></div>' +
                '<form class="att-modal-form" autocomplete="off">' +
                  '<div class="att-modal-body att-modal-body--single">' + (opts.body || '') +
                    '<div class="att-err att-err--general att-span" data-error style="display:none"></div>' +
                  '</div>' +
                  '<div class="att-modal-foot">' +
                    '<button class="att-btn" type="button" data-close>Cancel</button>' +
                    '<button class="att-btn ' + (opts.warn ? 'att-btn--warn' : 'att-btn--primary') + '" type="submit" data-submit>' +
                      esc(opts.submitLabel || 'Save') + '</button>' +
                  '</div>' +
                '</form>' +
              '</div>' +
            '</div>';
        const form = host.querySelector('form');
        const errorBox = host.querySelector('[data-error]');
        const submit = host.querySelector('[data-submit]');
        function onKey(e) { if (e.key === 'Escape') close(); }
        function close() {
            document.removeEventListener('keydown', onKey);
            host.innerHTML = '';
        }
        document.addEventListener('keydown', onKey);
        host.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        host.querySelector('#reqModal').addEventListener('click', e => { if (e.target.id === 'reqModal') close(); });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorBox.style.display = 'none';
            submit.disabled = true;
            try {
                await opts.onSubmit(form);
                close();
                if (opts.onDone) opts.onDone();
            } catch (err) {
                errorBox.textContent = errorMessage(err);
                errorBox.style.display = 'block';
                submit.disabled = false;
            }
        });
        if (opts.onOpen) opts.onOpen(form);
        const first = form.querySelector('input:not([type=hidden]):not([type=radio]), select, textarea');
        if (first) first.focus();
        icons();
        return { close };
    }

    function head(title, sub, actions) {
        return '<div class="att-head"><div><h2 class="att-title">' + esc(title) + '</h2>' +
            '<p class="att-sub">' + esc(sub) + '</p></div>' +
            (actions ? '<div class="att-head-actions">' + actions + '</div>' : '') + '</div>';
    }

    // <img data-sign-bucket="item-gallery" data-sign-path="…"> → a 10-minute
    // signed link to a PRIVATE bucket; a click opens the full-size photo.
    async function signImages(scope) {
        for (const img of scope.querySelectorAll('img[data-sign-path]')) {
            const { data, error } = await root.sbClient.storage.from(img.dataset.signBucket)
                .createSignedUrl(img.dataset.signPath, 600);
            if (error || !data) { img.alt = 'Photo unavailable'; continue; }
            img.src = data.signedUrl;
            img.addEventListener('click', () => root.open(data.signedUrl, '_blank', 'noopener'));
        }
    }

    const state = { detailId: null };
    const views = {};

    function openRequest(id) {
        state.detailId = id;
        root.switchView('reqDetail');
    }

    root.RequestsAdmin = Object.assign({}, pure, { esc, icons, rpc, fail, modal, head, signImages, openRequest, state, views });

    root.initRequestsModule = function (view) {
        const host = document.getElementById(view + 'View');
        const render = views[view];
        if (host && render) render(host);
    };
})(typeof window !== 'undefined' ? window : globalThis);
