/* ══════════════════════════════════════════════════════════
   PM → PROFIT SHARING dashboard (window.PMShareDash)
   Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md §7
   Layout: "Direction 1a — Split first" (2026-10-19).

   Completed projects only. Owner-role accounts only — staff get an empty
   view and nothing is fetched. Every figure comes from PMShare.project /
   PMShare.combine; hero, sum, table, detail, print and CSV all read ONE
   model. Internal allocation — never a payout or an amount owed.

   The list page renders into three holders so typing in search never
   rebuilds the search box:
     #pmSharingRoot     shell: header, toolbar (search, partner chips, dates)
     #pmSharingSummary  hero split, sum, "need a look" cards   (filter-driven)
     #pmSharingResults  unmapped notice, project table, footer (filter-driven)
   An open project replaces the whole list with #pmSharingDetail.
   ══════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    const S = {
        seq: 0, loading: false, error: null, data: null, results: [], asOf: null, openId: null, dateOpen: false,
        filters: { from: '', to: '', undatedOnly: false, partner: 'all', q: '' },
    };
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const canSee = () => window.currentUserRole === 'owner';

    // ── fetch: mapped projects of MY company first, then records only for those ──
    async function defaultFetch() {
        const read = await window.PMShare.load(null);
        const mapped = new Set((read.projects || []).map(r => r.project_id));
        const snap = await db.collection('constructionProjects').get();
        const completed = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.status === 'completed');
        const projects = completed.filter(p => mapped.has(p.id));
        const unmappedCompleted = completed.length - projects.length;   // sharing locked — surfaced as a notice
        const ids = projects.map(p => p.id);
        const [pairs, reserves] = await Promise.all([
            Promise.all(projects.map(async p => {
                const [b, r] = await Promise.all([
                    db.collection('constructionProjects').doc(p.id).collection('weeklyBills').get(),
                    db.collection('paymentRequests').where('constructionProjectId', '==', p.id).get(),
                ]);
                return [p.id, { bills: b.docs.map(d => ({ id: d.id, ...d.data() })),
                                reqs: r.docs.map(d => ({ id: d.id, ...d.data() })) }];
            })),
            window.WF.reserveFor(ids),
        ]);
        return { read, projects, perProject: Object.fromEntries(pairs), reserves, unmappedCompleted };
    }
    let fetchFn = defaultFetch;

    function toResults(d) {
        const rows = {};
        (d.read.projects || []).forEach(r => { rows[r.project_id] = r; });
        return d.projects.filter(p => rows[p.id]).map(p => window.PMShare.project({
            id: p.id, name: p.projectName, clientName: p.clientName, partnerEmail: p.partnerEmail,
            status: p.status, terminatedAt: p.terminatedAt,
            bills: (d.perProject[p.id] || {}).bills || [], reqs: (d.perProject[p.id] || {}).reqs || [],
            reserveRow: d.reserves[p.id] || null, partnerPct: Number(rows[p.id].partner_pct),
        }));
    }

    async function load() {
        const my = ++S.seq;
        S.loading = true; S.error = null; render();
        try {
            const d = await fetchFn();
            if (my !== S.seq) return;              // a newer load started — drop this one
            S.data = d; S.results = toResults(d); S.asOf = new Date();
        } catch (e) {
            if (my !== S.seq) return;
            S.data = null; S.results = []; S.error = e.message || 'Load failed';
        }
        S.loading = false; render();
    }

    // ── pure model ─────────────────────────────────────────────────────
    function applyFilters(results, f) {
        const q = String(f.q || '').trim().toLowerCase();
        return results.filter(r => {
            if (f.partner === 'unassigned') { if (r.partnerEmail) return false; }
            else if (f.partner && f.partner !== 'all' && r.partnerEmail !== f.partner) return false;
            const key = r.completionKey;
            if (f.undatedOnly) { if (key) return false; }
            else if (f.from || f.to) {
                if (!key) return false;
                if (f.from && key < f.from) return false;
                if (f.to && key > f.to) return false;
            }
            if (q && (r.name + ' ' + r.clientName).toLowerCase().indexOf(q) === -1) return false;
            return true;
        });
    }
    function labelFor(r, all) {
        const dup = all.filter(x => x.name === r.name).length > 1;
        return dup ? r.name + ' · ' + (r.completionKey || 'undated') + ' · ' + String(r.id).slice(0, 6) : r.name;
    }
    // Status words (owner decision D-A, 2026-10-19). PRIORITY picks the ONE main pill (D-B).
    const PRIORITY = ['reserve_review', 'shortfall', 'unpaid_balance', 'changed_since_closeout'];
    const CHIP = { reserve_review: 'Not counted yet', shortfall: 'Loss',
                   unpaid_balance: 'Client still owes', changed_since_closeout: 'Edited after closeout' };
    const TONE = { ready: 'ready', reserve_review: 'review', shortfall: 'loss',
                   unpaid_balance: 'unpaid', changed_since_closeout: 'changed' };
    const flagsOf = (r) => PRIORITY.filter(f => (r.flags || []).indexOf(f) !== -1);
    function mainStatus(r) { return flagsOf(r)[0] || 'ready'; }
    function chipsFor(r) {
        const c = flagsOf(r).map(f => CHIP[f]);
        return c.length ? c : ['Ready'];
    }
    function buildModel(results, filters) {
        const picked = applyFilters(results, filters);
        const c = window.PMShare.combine(picked);
        const partners = Array.from(new Set(results.map(r => r.partnerEmail).filter(Boolean))).sort();
        return { rows: c.confirmed, review: c.review, totals: c.totals, partners, all: results };
    }

    // ── small view helpers ─────────────────────────────────────────────
    const P = () => window.PMShare;
    const peso = (c) => esc(P().pesos(c));
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
    const clampPct = (n) => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);
    // 'YYYY-MM-DD' → "Aug 2, 2026", built from local parts (never toISOString).
    function fmtKey(key, withYear) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
        if (!m) return '';
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        const o = { month: 'short', day: 'numeric' };
        if (withYear !== false) o.year = 'numeric';
        return d.toLocaleDateString('en-PH', o);
    }
    const completedText = (r) => r.completionKey ? fmtKey(r.completionKey) : 'No completion date';
    const fmtWhen = (v) => {
        const d = new Date(v);
        return isNaN(d) ? '' : d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    };
    // Inline SVG (lucide shapes) — no runtime icon fetch, survives every re-render.
    const ICON = {
        printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
        refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
        search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
        down: '<path d="m6 9 6 6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', left: '<path d="m15 18-6-6 6-6"/>',
    };
    const icon = (n, size) => '<svg class="pms-ico" width="' + (size || 15) + '" height="' + (size || 15) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
        + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>';
    const pill = (flag, minor) => '<span class="pms-pill pms-pill--' + (minor ? 'minor' : TONE[flag]) + '">'
        + esc(flag === 'ready' ? 'Ready' : CHIP[flag]) + '</span>';
    function pillsFor(r) {
        const f = flagsOf(r);
        if (!f.length) return pill('ready');
        return pill(f[0]) + f.slice(1).map(x => pill(x, true)).join('');
    }
    // One-line reason on the attention cards (main status only).
    function shortText(r) {
        switch (mainStatus(r)) {
            case 'reserve_review': return "Warranty reserve wasn't recorded at closeout. Left out of the totals.";
            case 'shortfall': return 'Lost ' + P().pesos(-r.balanceCents) + ' after costs and reserve. The loss lowers both shares.';
            case 'unpaid_balance': return 'Client still owes ' + P().pesos(r.outstandingCents) + '. Counted with what has been paid so far.';
            case 'changed_since_closeout': return 'Payments or costs changed after closeout. Check the change is correct.';
            default: return '';
        }
    }
    const STATUS_BOX = {
        ready: ['Ready', 'Payments, costs and the warranty reserve are final. This project is counted in the totals.'],
        reserve_review: ['Not counted yet', 'No warranty reserve was recorded at closeout, so the reserve shown is an estimate. This project stays out of the totals until the reserve is recorded.'],
        shortfall: ['This project lost money', 'Costs plus the warranty reserve are more than the client paid. The loss is split with the same percentages and lowers both shares.'],
        unpaid_balance: ['Client still owes money', 'Counted using only what the client has paid so far. The amount to share grows once the remaining balance is collected.'],
        changed_since_closeout: ['Edited after closeout', 'Payments or costs changed after the project was closed out. Still counted, but check that the change is correct.'],
    };
    const INTERNAL = 'Internal allocation — not a payout or amount owed.';

    // ── list: header + toolbar (shell) ─────────────────────────────────
    function dateLabel(f) {
        if (f.undatedOnly) return 'Undated only';
        if (f.from && f.to) {
            const sameYear = f.from.slice(0, 4) === f.to.slice(0, 4);
            return fmtKey(f.from, !sameYear) + ' – ' + fmtKey(f.to);
        }
        if (f.from) return 'From ' + fmtKey(f.from);
        if (f.to) return 'Until ' + fmtKey(f.to);
        return 'Any completion date';
    }
    function headHtml() {
        const when = S.asOf ? S.asOf.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
        return '<div class="pms-head"><div class="pms-head-l"><h1 class="pms-title">Profit Sharing</h1>'
            + '<div class="pms-head-sub">Completed projects · Updated ' + esc(when) + '</div></div>'
            + '<div class="pms-actions">'
            + '<button type="button" class="pms-btn" onclick="PMShareDash.print()">' + icon('printer') + 'Print / PDF</button>'
            + '<button type="button" class="pms-btn" onclick="PMShareDash.downloadCsv()">' + icon('download') + 'CSV</button>'
            + '<button type="button" class="pms-btn pms-btn--icon" onclick="PMShareDash.load()" title="Refresh" aria-label="Refresh">' + icon('refresh') + '</button>'
            + '</div></div>';
    }
    function toolbarHtml(m) {
        const f = S.filters;
        const chip = (val, label, title) => '<button type="button" class="pms-chip' + (f.partner === val ? ' is-on' : '') + '"'
            + ' aria-pressed="' + (f.partner === val) + '" data-pms-partner="' + esc(val) + '"' + (title ? ' title="' + esc(title) + '"' : '')
            + '>' + esc(label) + '</button>';
        const dateOn = !!(f.undatedOnly || f.from || f.to);
        return '<div class="pms-toolbar">'
            + '<div class="pms-section-h pms-toolbar-h">All completed projects</div>'
            + '<label class="pms-search">' + icon('search') + '<input type="search" placeholder="Search project or client"'
            +   ' aria-label="Search project or client" value="' + esc(f.q) + '" oninput="PMShareDash.setFilter(\'q\', this.value)"></label>'
            + '<div class="pms-chips" role="group" aria-label="Partner">'
            +   chip('all', 'All partners')
            +   m.partners.map(p => chip(p, p.split('@')[0] || p, p)).join('')
            +   chip('unassigned', 'No partner')
            + '</div>'
            + '<div class="pms-date">'
            +   '<button type="button" id="pmSharingDateBtn" class="pms-btn pms-date-btn' + (dateOn ? ' is-on' : '') + '" aria-haspopup="true"'
            +     ' aria-expanded="' + S.dateOpen + '" onclick="PMShareDash.toggleDates()"><span>' + esc(dateLabel(f)) + '</span>' + icon('down', 14) + '</button>'
            +   '<div id="pmSharingDatePop" class="pms-pop"' + (S.dateOpen ? '' : ' hidden') + '>'
            +     '<label>From <input type="date" value="' + esc(f.from) + '" onchange="PMShareDash.setFilter(\'from\', this.value)"' + (f.undatedOnly ? ' disabled' : '') + '></label>'
            +     '<label>To <input type="date" value="' + esc(f.to) + '" onchange="PMShareDash.setFilter(\'to\', this.value)"' + (f.undatedOnly ? ' disabled' : '') + '></label>'
            +     '<label class="pms-check"><input type="checkbox"' + (f.undatedOnly ? ' checked' : '') + ' onchange="PMShareDash.setFilter(\'undatedOnly\', this.checked)"> Undated only</label>'
            +     '<div class="pms-pop-actions"><button type="button" class="pms-link" onclick="PMShareDash.clearDates()">Clear</button>'
            +     '<button type="button" class="pms-btn" onclick="PMShareDash.toggleDates()">Done</button></div>'
            +   '</div>'
            + '</div>'
            + '</div>';
    }

    // ── list: summary (hero, sum, attention) ───────────────────────────
    // ONE rule for the % split (hero and printed statement): only for a positive amount to share
    // AND an owner part inside 0-100; otherwise no % and an empty bar.
    function shareSplit(t) {
        const raw = t.count > 0 && t.netCents > 0 ? Math.round(t.ownerCents / t.netCents * 10000) / 100 : NaN;
        const share = Number.isFinite(raw) && raw >= 0 && raw <= 100;
        return { share, ownPct: share ? raw : null, parPct: share ? Math.round((100 - raw) * 100) / 100 : null };
    }
    function heroHtml(m) {
        const t = m.totals, p = P();
        const partners = new Set(m.rows.map(r => r.partnerEmail).filter(Boolean)).size;
        // A % is shown only when it means something: a positive amount to share AND an owner part
        // inside 0–100. Mixed profit/loss projects can push it outside (e.g. 130% / −30%); then the
        // bar falls back to "No positive amount to share" and only the amounts are shown.
        const { share, ownPct, parPct } = shareSplit(t);
        return '<div class="pms-hero">'
            + '<div class="pms-hero-split">'
            +   '<div class="pms-hero-side"><div class="pms-hero-k"><span class="pms-key pms-key--own"></span>Your share</div>'
            +     '<div class="pms-hero-v pms-hero-v--own' + (t.ownerCents < 0 ? ' pms-neg' : '') + '">' + peso(t.ownerCents) + '</div>'
            +     '<div class="pms-hero-s">' + (share ? esc(p.fmtPct(ownPct)) + '% of the amount left to share' : 'Your part of the amount left to share') + '</div></div>'
            +   '<div class="pms-hero-side pms-hero-side--par"><div class="pms-hero-k">Partners\' share<span class="pms-key pms-key--par"></span></div>'
            +     '<div class="pms-hero-v' + (t.partnerCents < 0 ? ' pms-neg' : '') + '">' + peso(t.partnerCents) + '</div>'
            +     '<div class="pms-hero-s">' + (share ? esc(p.fmtPct(parPct)) + '% · ' : '') + esc(plural(partners, 'partner', 'partners')) + '</div></div>'
            + '</div>'
            + (share
                ? '<div class="pms-hero-bar" role="img" aria-label="Your share ' + esc(p.fmtPct(ownPct)) + '%, partners ' + esc(p.fmtPct(parPct)) + '%">'
                  + '<div class="pms-hero-own" style="width:' + clampPct(ownPct) + '%"></div></div>'
                : '<div class="pms-hero-bar pms-hero-bar--empty"></div><div class="pms-hero-empty">No positive amount to share</div>')
            + '<p class="pms-hero-p">From ' + esc(plural(t.count, 'completed project', 'completed projects')) + ', <b>' + peso(t.netCents)
            + '</b> is left after costs and warranty reserves. That amount is split project by project, using each project\'s agreed'
            + ' percentage. These are internal figures, not payouts or amounts owed.</p>'
            + '</div>';
    }
    function sumHtml(m) {
        const t = m.totals;
        const losses = m.rows.filter(r => r.balanceCents < 0).length;
        const box = (sign, label, cents, sub, cls) => '<div class="pms-sum-box' + (cls ? ' ' + cls : '') + '">'
            + '<div class="pms-sum-l">' + (sign ? '<span class="pms-sum-sign">' + sign + ' </span>' : '') + label + '</div>'
            + '<div class="pms-sum-v' + (cents < 0 ? ' pms-neg' : '') + '">' + peso(cents) + '</div>'
            + '<div class="pms-sum-s">' + esc(sub) + '</div></div>';
        const op = (s) => '<div class="pms-sum-op" aria-hidden="true">' + s + '</div>';
        return '<section class="pms-block"><div class="pms-section-h">How the amount to share is worked out</div>'
            + '<div class="pms-sum">'
            + box('', 'Client paid', t.paidCents, 'All payments received')
            + op('−') + box('−', 'Project costs', t.costCents, 'Labor, materials, site overhead')
            + op('−') + box('−', 'Warranty reserve', t.reserveCents, 'Set aside at closeout for repairs')
            + op('=') + box('=', 'Left to share', t.netCents,
                  t.shortfallCents < 0 ? 'Includes ' + P().pesos(-t.shortfallCents) + ' loss on ' + plural(losses, 'project', 'projects')
                                       : 'After costs and reserve', 'pms-sum-box--net')
            + '</div></section>';
    }
    function attentionHtml(m) {
        const flagged = m.rows.concat(m.review).filter(r => flagsOf(r).length)
            .map((r, i) => [r, i])
            .sort((a, b) => (PRIORITY.indexOf(mainStatus(a[0])) - PRIORITY.indexOf(mainStatus(b[0]))) || (a[1] - b[1]))
            .map(x => x[0]);
        if (!flagged.length) return '';
        return '<section class="pms-block"><div class="pms-section-h">'
            + esc(flagged.length === 1 ? '1 project needs a look' : flagged.length + ' projects need a look') + '</div>'
            + '<div class="pms-attn">' + flagged.map(r =>
                '<div class="pms-attn-card" role="button" tabindex="0" data-pms-id="' + esc(r.id) + '">'
                + '<div class="pms-pills">' + pill(mainStatus(r)) + '</div>'
                + '<div class="pms-attn-name">' + esc(labelFor(r, m.all)) + '</div>'
                + '<div class="pms-attn-text">' + esc(shortText(r)) + '</div></div>').join('')
            + '</div></section>';
    }

    // ── list: table ────────────────────────────────────────────────────
    function rowHtml(r, all, provisional) {
        const p = P(), neg = r.balanceCents < 0 ? ' pms-neg' : '';
        const w = clampPct(r.ownerPct);
        const aria = labelFor(r, all) + ', ' + (r.balanceCents < 0 ? 'loss to split ' : 'left to share ') + p.pesos(r.balanceCents)
            + (provisional ? ', provisional' : '') + ', ' + chipsFor(r).join(', ');
        return '<div class="pms-trow pms-row" role="button" tabindex="0" aria-label="' + esc(aria) + '" data-pms-id="' + esc(r.id) + '">'
            + '<div class="pms-c-proj"><div class="pms-name">' + esc(labelFor(r, all)) + '</div>'
            +   '<div class="pms-sub">' + esc(r.clientName) + ' · ' + esc(completedText(r)) + '</div></div>'
            + '<div class="pms-c-partner' + (r.partnerEmail ? '' : ' pms-none') + '">' + esc(r.partnerEmail || 'No partner assigned') + '</div>'
            + '<div class="pms-c-bal pms-n' + neg + '">' + peso(r.balanceCents)
            +   (provisional ? '<div class="pms-prov">Provisional</div>' : '') + '</div>'
            + '<div class="pms-c-own pms-n' + neg + '"><span class="pms-m-only">You </span>' + peso(r.ownerCents) + '</div>'
            + '<div class="pms-c-par pms-n' + neg + '"><span class="pms-m-only">· Partner </span>' + peso(r.partnerCents) + '</div>'
            + '<div class="pms-c-split"><div class="pms-bar"><div class="pms-bar-own" style="width:' + w + '%"></div></div>'
            +   '<div class="pms-split-t">' + esc(p.fmtPct(r.ownerPct)) + ' / ' + esc(p.fmtPct(r.partnerPct)) + '</div></div>'
            + '<div class="pms-c-status"><div class="pms-pills">' + pillsFor(r) + '</div></div>'
            + '<div class="pms-c-chev">' + icon('right', 16) + '</div>'
            + '</div>';
    }
    function tableHtml(m) {
        const t = m.totals;
        const rows = m.rows.map(r => rowHtml(r, m.all, false)).join('') + m.review.map(r => rowHtml(r, m.all, true)).join('');
        const empty = !m.rows.length && !m.review.length;
        return '<div class="pms-table">'
            + '<div class="pms-trow pms-thead" aria-hidden="true"><div>Project</div><div>Partner</div><div class="pms-n">Left to share</div>'
            + '<div class="pms-n">Your share</div><div class="pms-n">Partner share</div><div>Split</div><div>Status</div><div></div></div>'
            + (empty ? '<div class="pms-empty">No completed projects match.</div>' : rows)
            + (empty ? '' : '<div class="pms-trow pms-total">'
                + '<div class="pms-c-proj">Total · ' + esc(t.count) + ' counted</div><div class="pms-c-partner"></div>'
                + '<div class="pms-c-bal pms-n' + (t.netCents < 0 ? ' pms-neg' : '') + '">' + peso(t.netCents) + '</div>'
                + '<div class="pms-c-own pms-n pms-own-t' + (t.ownerCents < 0 ? ' pms-neg' : '') + '"><span class="pms-m-only">You </span>' + peso(t.ownerCents) + '</div>'
                + '<div class="pms-c-par pms-n' + (t.partnerCents < 0 ? ' pms-neg' : '') + '"><span class="pms-m-only">· Partner </span>' + peso(t.partnerCents) + '</div>'
                + '<div class="pms-total-note">“Not counted yet” is left out</div></div>')
            + '</div>';
    }

    function bindRows(root) {
        if (root.__pmsBound) return;
        root.__pmsBound = true;
        const D = () => window.PMShareDash;
        root.addEventListener('click', function (ev) {
            const t = ev.target;
            if (!t || !t.closest) return;
            const chip = t.closest('[data-pms-partner]');
            if (chip) { if (D() && typeof D().setFilter === 'function') D().setFilter('partner', chip.getAttribute('data-pms-partner')); return; }
            const el = t.closest('[data-pms-id]');
            if (el && D() && typeof D().open === 'function') D().open(el.getAttribute('data-pms-id'));
        });
        root.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            const t = ev.target;
            if (!t || !t.matches || !t.matches('[data-pms-id]')) return;
            ev.preventDefault();
            if (D() && typeof D().open === 'function') D().open(t.getAttribute('data-pms-id'));
        });
    }
    // Filter-driven parts only: the toolbar is NOT rebuilt, so typing keeps focus.
    function renderResults() {
        const sum = document.getElementById('pmSharingSummary');
        const box = document.getElementById('pmSharingResults');
        if (!box) return;
        const m = buildModel(S.results, S.filters);
        if (sum) sum.innerHTML = heroHtml(m) + sumHtml(m) + attentionHtml(m);
        const un = Number(S.data && S.data.unmappedCompleted) || 0;
        const notice = un > 0
            ? '<div class="pms-notice">' + un + ' completed project' + (un === 1 ? '' : 's')
              + ' not linked to a company — sharing locked (not shown).</div>'
            : '';
        box.innerHTML = notice + tableHtml(m) + '<div class="pms-foot">' + esc(INTERNAL) + '</div>';
    }
    // Shell: on load / error / filter-bar change / open / close.
    function render() {
        const root = document.getElementById('pmSharingRoot');
        if (!root) return;
        bindRows(root);
        if (!canSee()) { root.innerHTML = ''; return; }
        if (S.loading && !S.data) { root.innerHTML = '<div class="pms-state">Loading Profit Sharing…</div>'; return; }
        if (S.error) {
            root.innerHTML = '<div class="pms-state pms-err">Could not load Profit Sharing: ' + esc(P().errorText(S.error))
                           + ' <button type="button" class="pms-btn" onclick="PMShareDash.load()">Retry</button></div>';
            return;
        }
        if (S.openId != null) {
            if (S.results.some(x => x.id === S.openId)) {
                root.innerHTML = '<div id="pmSharingDetail" class="pms-page"></div>';
                renderDetail();
                return;
            }
            S.openId = null;                         // project gone after a refresh — back to the list
        }
        const m = buildModel(S.results, S.filters);
        root.innerHTML = '<div class="pms-page">' + headHtml() + '<div id="pmSharingSummary" class="pms-summary"></div>'
            + '<section class="pms-block">' + toolbarHtml(m) + '<div id="pmSharingResults"></div></section></div>';
        renderResults();
    }

    function setFilter(k, v) {
        S.filters[k] = v;
        if (k === 'q') renderResults(); else render();   // search keeps its input; others refresh the bar (chips, date label)
    }
    // Date popover: Escape or a click outside closes it. One document listener pair, added on
    // open and removed on close (never stacked across re-renders).
    let docBound = false;
    const inside = (el, t) => !!(el && t && typeof el.contains === 'function' && el.contains(t));
    function onDocClick(ev) {
        const t = ev && ev.target;
        if (inside(document.getElementById('pmSharingDatePop'), t) || inside(document.getElementById('pmSharingDateBtn'), t)) return;
        setDateOpen(false);
    }
    function onDocKey(ev) {
        if (!ev || ev.key !== 'Escape') return;
        setDateOpen(false);
        const btn = document.getElementById('pmSharingDateBtn');
        if (btn && typeof btn.focus === 'function') btn.focus();
    }
    function setDateOpen(open) {
        S.dateOpen = !!open;
        const pop = document.getElementById('pmSharingDatePop');
        const btn = document.getElementById('pmSharingDateBtn');
        if (pop) pop.hidden = !S.dateOpen;
        if (btn && btn.setAttribute) btn.setAttribute('aria-expanded', String(S.dateOpen));
        if (S.dateOpen && !docBound) {
            document.addEventListener('click', onDocClick); document.addEventListener('keydown', onDocKey); docBound = true;
        } else if (!S.dateOpen && docBound) {
            document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onDocKey); docBound = false;
        }
    }
    function toggleDates() { setDateOpen(!S.dateOpen); }
    function clearDates() {
        S.filters.from = ''; S.filters.to = ''; S.filters.undatedOnly = false;
        render();
    }
    function scrollTop() {
        const root = document.getElementById('pmSharingRoot');
        if (root && typeof root.scrollIntoView === 'function') root.scrollIntoView({ block: 'start' });
    }

    // ── detail page (read-only: Back and Print are the only controls) ──
    function open(id) { S.openId = id; setDateOpen(false); render(); scrollTop(); }
    function close() { S.openId = null; render(); scrollTop(); }
    function renderDetail() {
        const el = document.getElementById('pmSharingDetail');
        const r = S.results.find(x => x.id === S.openId);
        if (!el || !r || !S.data) return;
        const p = P();
        const pp = S.data.perProject[r.id] || { bills: [], reqs: [] };
        const bd = (typeof _pmOvBreakdown === 'function') ? _pmOvBreakdown(pp.bills)
                 : { labor: 0, materials: 0, combined: 0, overhead: 0 };
        const rec = S.data.reserves[r.id];
        const hist = (S.data.read.history || []).filter(h => h.project_id === r.id);
        const facts = p.acceptanceFacts(r.partnerEmail, S.data.read.partners, hist.length ? hist[0].changed_at : null);
        const main = mainStatus(r), loss = r.balanceCents < 0;
        const line = (k, cents) => '<div class="pms-line"><span>' + esc(k) + '</span><span class="pms-n">' + peso(cents) + '</span></div>';
        const step = (n, title, amount, body, cls) => '<div class="pms-step' + (cls ? ' ' + cls : '') + '"><div class="pms-step-n">' + n + '</div>'
            + '<div class="pms-step-t">' + esc(title) + '</div><div class="pms-step-v pms-n">' + amount + '</div>'
            + (body ? '<div class="pms-step-b">' + body + '</div>' : '') + '</div>';
        const pays = pp.reqs.map(q => line((fmtKey(q.weekEndingDate) || q.weekEndingDate || 'No date') + ' · ' + ((q.status || '').replace(/^./, c => c.toUpperCase()) || '—'),
                                           p.toCents(p.paid([q])))).join('');
        const costs = line('Labor', p.toCents(bd.labor)) + line('Pure materials', p.toCents(bd.materials))
                    + line('Supply & install', p.toCents(bd.combined)) + line('Site overhead', p.toCents(bd.overhead));
        const recorded = r.reserve.kind === 'recorded';
        const resNote = (recorded
                ? 'Set aside at closeout' + (rec && rec.refNo ? ' (' + esc(rec.refNo) + ')' : '')
                  + ' to cover repairs during the warranty period. Frozen at that point, so later edits don\'t change it.'
                : 'Estimate only. No reserve was recorded at closeout, so this uses 5% of the cash left after costs.'
                  + ' Record it in Project Closeout to count this project.')
            + (recorded && rec ? '<div class="pms-muted">At closeout: paid ' + peso(p.toCents(rec.totalPaid)) + ' · costs ' + peso(p.toCents(rec.directCost)) + '</div>' : '')
            + (r.reserve.changedSinceCloseout ? '<div class="pms-warn">Collections/costs changed since closeout.</div>' : '');
        const minor = flagsOf(r).slice(1);
        const box = STATUS_BOX[main];
        el.innerHTML = '<button type="button" class="pms-back" onclick="PMShareDash.close()">' + icon('left', 16) + 'Profit Sharing</button>'
            + '<div class="pms-head"><div class="pms-head-l"><div class="pms-dtitle"><h1 class="pms-title">' + esc(labelFor(r, S.results)) + '</h1>'
            +   '<div class="pms-pills">' + pillsFor(r) + '</div></div>'
            +   '<div class="pms-head-sub">' + esc(r.clientName) + ' · ' + esc(r.completionKey ? 'Completed ' + fmtKey(r.completionKey) : 'No completion date')
            +   ' · Partner ' + esc(r.partnerEmail || 'No partner assigned') + '</div></div>'
            +   '<div class="pms-actions"><button type="button" class="pms-btn" onclick="PMShareDash.print()">' + icon('printer') + 'Print</button></div></div>'
            + '<div class="pms-dgrid">'
            + '<section class="pms-card pms-work"><h2 class="pms-card-h">How this project\'s share was worked out</h2>'
            +   step(1, 'Client paid', peso(r.paidCents), pays || '<div class="pms-muted">No payment records.</div>')
            +   step(2, 'Minus project costs', (r.costCents > 0 ? '−' : '') + peso(r.costCents), costs)
            +   '<div class="pms-step pms-step--sub"><div></div><div class="pms-step-t">Cash left after costs</div><div class="pms-step-v pms-n' + (r.remainingCents < 0 ? ' pms-neg' : '') + '">' + peso(r.remainingCents) + '</div></div>'
            +   step(3, 'Minus warranty reserve', (r.reserve.cents > 0 ? '−' : '') + peso(r.reserve.cents), resNote)
            +   '<div class="pms-step4' + (loss ? ' pms-neg' : '') + '">'
            +     '<div class="pms-step"><div class="pms-step-n">4</div><div class="pms-step-t">' + (loss ? 'Loss to split' : 'Left to share') + '</div>'
            +       '<div class="pms-step-v pms-n">' + peso(r.balanceCents) + '</div></div>'
            +     '<div class="pms-bar pms-bar--lg"><div class="pms-bar-own" style="width:' + clampPct(r.ownerPct) + '%"></div></div>'
            +     '<div class="pms-parts"><div class="pms-part pms-part--own"><div class="pms-part-k">You · ' + esc(p.fmtPct(r.ownerPct)) + '%</div>'
            +       '<div class="pms-part-v' + (r.ownerCents < 0 ? ' pms-neg' : '') + '">' + peso(r.ownerCents) + '</div></div>'
            +     '<div class="pms-part"><div class="pms-part-k">Partner · ' + esc(p.fmtPct(r.partnerPct)) + '%</div>'
            +       '<div class="pms-part-v' + (r.partnerCents < 0 ? ' pms-neg' : '') + '">' + peso(r.partnerCents) + '</div></div></div>'
            +   '</div>'
            + '</section>'
            + '<aside class="pms-side">'
            +   '<div class="pms-status pms-status--' + TONE[main] + '"><div class="pms-status-t">' + esc(box[0]) + '</div><div class="pms-status-x">' + esc(box[1]) + '</div>'
            +     minor.map(f => '<div class="pms-status-more"><b>' + esc(CHIP[f]) + '.</b> ' + esc(STATUS_BOX[f][1]) + '</div>').join('')
            +   '</div>'
            +   '<div class="pms-card pms-card--row"><div><div class="pms-card-t">Client balance</div><div class="pms-muted">Unpaid and partial requests</div></div>'
            +     '<div class="pms-card-v">' + peso(r.outstandingCents) + '</div></div>'
            +   '<div class="pms-card"><div class="pms-card-t">Split history</div>'
            +     (hist.length ? hist.map(h => '<div class="pms-hist">'
                    + '<div class="pms-hist-t">' + (h.old_pct == null ? 'Partner set to ' + esc(p.fmtPct(h.new_pct)) + '%'
                        : 'Partner ' + esc(p.fmtPct(h.old_pct)) + '% → ' + esc(p.fmtPct(h.new_pct)) + '%') + '</div>'
                    + (h.reason ? '<div class="pms-hist-r">“' + esc(h.reason) + '”</div>' : '')
                    + '<div class="pms-muted">' + esc([fmtWhen(h.changed_at), h.actor_email || ''].filter(Boolean).join(' · ')) + '</div></div>').join('')
                  : '<div class="pms-muted">No changes. This is the original split.</div>')
            +   '</div>'
            +   '<div class="pms-card"><div class="pms-card-t">Partner agreement</div>'
            +     facts.map(f => '<div class="pms-fact">' + esc(f) + '</div>').join('') + '</div>'
            +   '<div class="pms-foot">' + esc(INTERNAL) + '</div>'
            + '</aside></div>';
    }

    // ── print + CSV: built from the SAME model as the screen ───────────
    function metaLines() {
        const f = S.filters;
        const range = f.undatedOnly ? 'Undated only' : (f.from || f.to) ? (f.from || '…') + ' to ' + (f.to || '…') : 'All completion dates';
        const partner = f.partner === 'all' ? 'All partners' : f.partner === 'unassigned' ? 'Partner unassigned' : f.partner;
        return ['Profit Sharing — completed projects',
                INTERNAL,
                'As of,' + (S.asOf ? S.asOf.toLocaleString('en-PH') : ''),
                'Filters,' + [range, partner, f.q ? 'search "' + f.q + '"' : ''].filter(Boolean).join(' · '),
                'Basis,Remaining cash = collected − costs; sharing balance = remaining − recorded warranty reserve; split per project'];
    }
    function csvCell(v) {
        if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
        let s = String(v == null ? '' : v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function toCsv(m, meta) {
        const peso = (c) => c / 100;
        const cols = ['Project', 'Client', 'Partner', 'Completed', 'Collected', 'Costs', 'Remaining cash', 'Warranty reserve',
                      'Reserve basis', 'Sharing balance', 'Your %', 'Your amount', 'Partner %', 'Partner amount', 'Client balance', 'Review'];
        const row = (r, provisional) => [labelFor(r, m.all), r.clientName, r.partnerEmail || 'Partner unassigned',
            r.completionKey || 'Undated', peso(r.paidCents), peso(r.costCents), peso(r.remainingCents), peso(r.reserve.cents),
            provisional ? 'Provisional — not counted yet' : (r.reserve.kind === 'recorded' ? 'Recorded at closeout' : 'Estimate'),
            peso(r.balanceCents), r.ownerPct, peso(r.ownerCents), r.partnerPct, peso(r.partnerCents),
            peso(r.outstandingCents), chipsFor(r).join(' · ')];
        const t = m.totals;
        const lines = meta.map(l => l.split(',').length > 1
            ? csvCell(l.slice(0, l.indexOf(','))) + ',' + csvCell(l.slice(l.indexOf(',') + 1)) : csvCell(l));
        if (t.shortfallCents < 0) lines.push('Cash shortfall,' + csvCell(peso(t.shortfallCents)));   // confirmed projects only, a real (negative) number
        lines.push('');
        lines.push(cols.map(csvCell).join(','));
        m.rows.forEach(r => lines.push(row(r, false).map(csvCell).join(',')));
        m.review.forEach(r => lines.push(row(r, true).map(csvCell).join(',')));
        lines.push(['Totals (confirmed)', '', '', '', peso(t.paidCents), peso(t.costCents), peso(t.paidCents - t.costCents),
                    peso(t.reserveCents), '', peso(t.netCents), '', peso(t.ownerCents), '', peso(t.partnerCents),
                    peso(t.outstandingCents), t.reviewCount + ' not counted yet (not in totals)'].map(csvCell).join(','));
        return lines.join('\r\n');
    }
    function downloadCsv() {
        if (!canSee() || !S.data) return;
        const csv = toCsv(buildModel(S.results, S.filters), metaLines());
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        const d = new Date();
        a.href = URL.createObjectURL(blob);
        a.download = 'profit-sharing-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    // Printed project name: the name, plus a short id only when the name is duplicated (the date lives in the subline).
    const printTitle = (r, all) => r.name + (all.filter(x => x.name === r.name).length > 1 ? ' · ' + String(r.id).slice(0, 6) : '');
    function print() {
        if (!canSee() || !S.data) return;
        const m = buildModel(S.results, S.filters), t = m.totals, p = P(), f = S.filters;
        const when = S.asOf ? fmtWhen(S.asOf) : '';
        const dateText = f.undatedOnly ? 'Undated only'
            : (f.from && f.to) ? fmtKey(f.from) + ' – ' + fmtKey(f.to) : f.from ? 'From ' + fmtKey(f.from) : f.to ? 'Until ' + fmtKey(f.to) : 'All dates';
        const partnerText = f.partner === 'all' ? 'All partners' : f.partner === 'unassigned' ? 'No partner' : f.partner;
        const TONES = { ready: ['#EAF2EC', '#1A5C3A'], reserve_review: ['#FBF2DC', '#8A5F0C'], unpaid_balance: ['#FBF2DC', '#8A5F0C'],
                        shortfall: ['#F8E7E4', '#8F352C'], changed_since_closeout: ['#EEF2F6', '#44525F'] };
        const ppill = (fl) => '<span class="pill" style="background:' + TONES[fl][0] + ';color:' + TONES[fl][1] + '">' + esc(fl === 'ready' ? 'Ready' : CHIP[fl]) + '</span>';
        const money = (c, cls) => '<span class="n' + (cls ? ' ' + cls : '') + '">' + esc(p.pesos(c)) + '</span>';
        const line = (l, c, cls) => '<div class="ln' + (cls ? ' ' + cls : '') + '"><span>' + esc(l) + '</span>' + money(c) + '</div>';
        const sub = (r) => esc(r.clientName || '') + ' · ' + esc(completedText(r)) + ' · ' + esc(r.partnerEmail || 'No partner assigned');
        const { share, ownPct, parPct } = shareSplit(t);   // same rule as the screen hero
        const hasRows = m.rows.length + m.review.length > 0;
        // by-partner (confirmed rows only)
        const byPartner = new Map();
        m.rows.forEach(r => {
            const k = r.partnerEmail || '';
            const g = byPartner.get(k) || { n: 0, cents: 0, loss: false };
            g.n++; g.cents += r.partnerCents; if (r.balanceCents < 0) g.loss = true;
            byPartner.set(k, g);
        });
        const partnerKeys = Array.from(byPartner.keys()).sort((a, b) => (a === '') - (b === '') || (a < b ? -1 : a > b ? 1 : 0));
        const partnerHtml = partnerKeys.map(k => {
            const g = byPartner.get(k);
            return '<span>' + esc((k || 'No partner assigned') + ' · ' + plural(g.n, 'project', 'projects') + (g.loss ? ', includes a loss' : '')) + '</span>'
                + '<span class="n b right' + (g.cents < 0 ? ' negc' : '') + '">' + esc(p.pesos(g.cents)) + '</span>';
        }).join('');
        const lossRows = m.rows.filter(r => r.balanceCents < 0).length;
        const net = t.netCents < 0;
        // counted table
        const th = (l, left) => '<th class="' + (left ? 'l' : 'r') + (l === 'Project' ? ' pc' : '') + '">' + l + '</th>';
        const shareCell = (c, pct) => '<td class="r' + (c < 0 ? ' negc' : '') + '">' + esc(p.pesos(c)) + '<div class="grey pct">' + esc(p.fmtPct(pct)) + '%</div></td>';
        const rowHtml = (r) => {
            const fl = flagsOf(r);
            return '<tr><td class="pc"><div class="nm"><b>' + esc(printTitle(r, m.all)) + '</b></div><div class="grey sb">' + sub(r) + '</div></td>'
                + '<td class="r">' + esc(p.pesos(r.paidCents)) + '</td><td class="r">' + esc(p.pesos(r.costCents)) + '</td><td class="r">' + esc(p.pesos(r.reserve.cents)) + '</td>'
                + '<td class="r b' + (r.balanceCents < 0 ? ' negc' : '') + '">' + esc(p.pesos(r.balanceCents)) + '</td>'
                + shareCell(r.ownerCents, r.ownerPct) + shareCell(r.partnerCents, r.partnerPct)
                + '<td>' + (fl.length ? fl.map(ppill).join(' ') : ppill('ready')) + '</td></tr>';
        };
        const counted = '<h2>Counted projects</h2><table class="grid"><thead><tr>' + th('Project', true) + th('Client paid') + th('Costs') + th('Reserve') + th('Left to share')
            + th('Your share') + th('Partner share') + th('Status', true) + '</tr></thead><tbody>'
            + (m.rows.length ? m.rows.map(rowHtml).join('') : '<tr><td colspan="8">No counted projects.</td></tr>')
            + '<tr class="total"><td>' + esc('Total · ' + plural(t.count, 'project', 'projects')) + '</td><td class="r">' + esc(p.pesos(t.paidCents)) + '</td><td class="r">' + esc(p.pesos(t.costCents))
            + '</td><td class="r">' + esc(p.pesos(t.reserveCents)) + '</td><td class="r' + (net ? ' negc' : '') + '">' + esc(p.pesos(t.netCents)) + '</td><td class="r green">' + esc(p.pesos(t.ownerCents))
            + '</td><td class="r">' + esc(p.pesos(t.partnerCents)) + '</td><td></td></tr></tbody></table>';
        // not counted yet
        const reviewHtml = m.review.length ? '<div class="avoid"><h2 class="tight">Not counted yet</h2>' + m.review.map(r =>
            '<div class="rcard"><div class="ln"><b>' + esc(printTitle(r, m.all)) + '</b><span class="n">' + esc(p.pesos(r.balanceCents)) + ' estimated</span></div>'
            + '<div class="grey">' + sub(r) + '</div>'
            + '<div class="grey">' + esc('Paid ' + p.pesos(r.paidCents) + ' − costs ' + p.pesos(r.costCents) + ' − estimated reserve ' + p.pesos(r.reserve.cents)
              + '. No warranty reserve was recorded at closeout, so this project is left out of the totals until it is.') + '</div></div>').join('') + '</div>' : '';
        // legend: Ready + statuses present
        const all = m.rows.concat(m.review);
        const present = (fl) => all.some(r => flagsOf(r).indexOf(fl) !== -1);
        const MEAN = { unpaid_balance: 'Counted with what has been paid so far.', shortfall: 'Costs and reserve exceed what was paid. The loss lowers both shares.',
                       changed_since_closeout: 'Payments or costs changed after closeout. Check the change.', reserve_review: 'No warranty reserve recorded at closeout; left out of the totals.' };
        const legendRows = [['ready', 'Payments, costs and reserve are final.']].concat(['unpaid_balance', 'shortfall', 'changed_since_closeout', 'reserve_review']
            .filter(present).map(fl => [fl, MEAN[fl] + (fl === 'unpaid_balance' ? all.filter(r => flagsOf(r).indexOf(fl) !== -1)
                .map(r => ' ' + printTitle(r, m.all) + ': ' + p.pesos(r.outstandingCents) + ' unpaid.').join('') : '')]));
        const legend = '<div class="avoid"><h2 class="tight">What the statuses mean</h2><div class="legend">' + legendRows.map(x =>
            '<b style="color:' + TONES[x[0]][1] + '">' + esc(x[0] === 'ready' ? 'Ready' : CHIP[x[0]]) + '</b><span>' + esc(x[1]) + '</span>').join('') + '</div></div>';
        const css = '@page{size:letter landscape;margin:0.5in}*{box-sizing:border-box}'
            + 'body{margin:0;font-family:Barlow,Helvetica,Arial,sans-serif;font-size:12pt;color:#1C1C1E;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + 'h2{font-family:"Playfair Display",Georgia,serif;font-size:16pt;font-weight:600;margin:18px 0 6px}h2.tight{margin-top:0}'
            + '.head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:10px;border-bottom:2px solid #1A5C3A}'
            + '.brand{display:flex;align-items:center;gap:12px;line-height:1.15}.brand .t{font-family:"Playfair Display",Georgia,serif;font-size:24pt;font-weight:600}'
            + '.logo{width:44px;height:44px;border-radius:10px;border:1px solid #e7e6e2;display:grid;place-items:center}.logo img{width:34px;height:34px;object-fit:contain}'
            + '.meta{display:grid;grid-template-columns:auto auto;gap:2px 12px;text-align:right}.meta .k{color:#6C6C70}.meta .v{font-weight:600}'
            + '.grey{color:#3A3A3C}.green{color:#1A5C3A}.negc,.neg{color:#8F352C}.b{font-weight:700}.right,.r{text-align:right}.l{text-align:left}'
            + '.top{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:12px;break-inside:avoid}.left{display:flex;flex-direction:column;gap:8px}'
            + '.sh{display:flex;justify-content:space-between;align-items:flex-end}.sh .k{font-weight:600;color:#3A3A3C;display:flex;align-items:center;gap:6px}.sh .v{font-size:26pt;font-weight:700;font-variant-numeric:tabular-nums}'
            + '.sh .r .k{justify-content:flex-end}.dot{width:10px;height:10px;border-radius:3px;display:inline-block}'
            + '.bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:#9DC9B4}.bar div{background:#1A5C3A}.bar.empty{background:#E5E5E5}'
            + '.plist{display:grid;grid-template-columns:1fr auto;gap:4px 12px}'
            + '.box{background:#F5F5F5;border-radius:12px;padding:10px 16px;display:flex;flex-direction:column;gap:4px}'
            + '.ln{display:flex;justify-content:space-between;gap:8px}.n{font-variant-numeric:tabular-nums;white-space:nowrap}.box .tot{border-top:1px solid #D6D6D2;padding-top:6px;font-weight:700}'
            + 'table.grid{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:11pt}th.pc{width:30%}table.grid td.r,table.grid th.r{white-space:nowrap}.nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:3.2in}.sb,.pct{font-size:10.5pt}.pct{white-space:nowrap}'
            + 'table.grid thead{display:table-header-group}'
            + 'table.grid th{padding:6px 7px;border-bottom:1px solid #D6D6D2;font-weight:600;background:#FAFAF8}table.grid td{padding:6px 7px;border-bottom:1px solid #EEEEEE;vertical-align:top}'
            + 'table.grid tr{break-inside:avoid}table.grid tr.total td{background:#FAFAF8;font-weight:700;border-top:1px solid #D6D6D2}'
            + '.pill{font-weight:700;padding:2px 8px;border-radius:99px;white-space:nowrap;display:inline-block}'
            + '.two{display:grid;gap:24px;margin-top:14px}.avoid{break-inside:avoid}'
            + '.rcard{border:1px solid #E5E5E5;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;margin-bottom:8px}'
            + '.legend{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:baseline}.basis{margin-top:12px;color:#3A3A3C;break-inside:avoid}'
            + '.sheet{width:100%;border-collapse:collapse}.sheet>thead>tr>td,.sheet>tbody>tr>td,.sheet>tfoot>tr>td{display:block;padding:0}.foot-space{height:0.55in}'
            + '.foot{display:flex;justify-content:space-between;gap:12px;color:#6C6C70;padding-top:8px;border-top:1px solid #E5E5E5;margin-top:24px;background:#fff}.foot-space{display:block}'
            + '@media screen{body{background:#E9E9E6;padding:24px 0}.page{max-width:11in;min-height:8.5in;margin:0 auto;padding:0.5in;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.12)}}'
            + '@media print{.foot{position:fixed;bottom:0;left:0;right:0;margin-top:0;height:0.45in;overflow:hidden}.sheet{display:table}.sheet>thead{display:table-header-group}.sheet>tfoot{display:table-footer-group}.sheet>thead>tr>td,.sheet>tbody>tr>td,.sheet>tfoot>tr>td{display:table-cell}}';
        const logo = window.location.origin + '/assets/images/DACS-TRANSPARENT.png';
        const header = '<div class="head"><div class="brand"><div class="logo"><img id="pmsLogo" src="' + esc(logo) + '" alt="DAC\'s"></div>'
            + '<div><div class="t">Profit Sharing</div><div class="grey">Completed projects · DAC\'s Building Design Services</div></div></div>'
            + '<div class="meta"><span class="k">As of</span><span class="v">' + esc(when) + '</span><span class="k">Completed</span><span class="v">' + esc(dateText) + '</span>'
            + '<span class="k">Partners</span><span class="v">' + esc(partnerText) + '</span>'
            + (f.q ? '<span class="k">Search</span><span class="v">' + esc(f.q) + '</span>' : '') + '</div></div>';
        const top = '<div class="top"><div class="left"><div class="sh">'
            + '<div><div class="k"><span class="dot" style="background:#1A5C3A"></span>Your share' + (share ? ' · ' + esc(p.fmtPct(ownPct)) + '%' : '') + '</div><div class="v green">' + esc(p.pesos(t.ownerCents)) + '</div></div>'
            + '<div class="r"><div class="k">Partners\' share' + (share ? ' · ' + esc(p.fmtPct(parPct)) + '%' : '') + '<span class="dot" style="background:#9DC9B4"></span></div><div class="v">' + esc(p.pesos(t.partnerCents)) + '</div></div></div>'
            + '<div class="bar' + (share ? '' : ' empty') + '">' + (share ? '<div style="width:' + clampPct(ownPct) + '%"></div>' : '') + '</div>'
            + '<div class="plist">' + partnerHtml + '</div></div>'
            + '<div class="box"><b>How the amount to share is worked out</b>' + line('Client paid', t.paidCents) + line('− Project costs (labor, materials, site overhead)', t.costCents)
            + line('− Warranty reserve (set aside at closeout)', t.reserveCents)
            + '<div class="ln tot ' + (net ? 'neg' : 'green') + '"><span>' + esc((net ? '= Loss to split · ' : '= Left to share · ') + plural(t.count, 'project', 'projects')) + '</span>' + money(t.netCents) + '</div>'
            + '<div class="grey">' + esc("Split project by project, using each project's agreed percentage."
              + (t.shortfallCents < 0 ? ' Includes a ' + p.pesos(-t.shortfallCents) + ' loss on ' + plural(lossRows, 'project', 'projects') + '.' : '')) + '</div></div></div>';
        const content = !hasRows ? '<p>No completed projects match these filters.</p>'
            : top + counted + '<div class="two" style="grid-template-columns:' + (m.review.length ? '1fr 1fr' : '1fr') + '">' + reviewHtml + legend + '</div>'
              + '<div class="basis">Basis: left to share = client paid − project costs − warranty reserve recorded at closeout. Each project is split with its own percentage, then the results are added up. These are internal figures, not payouts or amounts owed.</div>';
        const body = '<div class="page"><table class="sheet"><thead><tr><td></td></tr></thead><tbody><tr><td>' + header + content
            + '</td></tr></tbody><tfoot><tr><td><div class="foot-space"></div></td></tr></tfoot></table>'
            + '<div class="foot"><span>Profit Sharing · DAC\'s Building Design Services · As of ' + esc(when) + '</span><span>' + esc(INTERNAL) + '</span></div></div>';
        const w = window.open('', '_blank', 'width=1100,height=800');
        if (!w) return;
        w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Profit Sharing</title>'
            + '<link rel="preconnect" href="https://fonts.googleapis.com">'
            + '<link id="pmsFonts" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">'
            + '<style>' + css + '</style></head><body>' + body + '</body></html>');
        w.document.close();
        // Print once, after the font stylesheet, the logo and document.fonts are all settled; a hard cap
        // guarantees it never hangs. Everything is guarded so a stub popup cannot throw.
        let done = false;
        const go = () => { if (done) return; done = true; try { if (typeof w.print === 'function') w.print(); } catch (e) { /* popup closed */ } };
        const once = (el, isReady) => new Promise((res) => {
            try {
                if (!el || isReady(el)) return res();
                el.addEventListener('load', () => res());
                el.addEventListener('error', () => res());
            } catch (e) { res(); }
        });
        // Order matters: the stylesheet must be parsed first, THEN the faces are requested, THEN fonts.ready
        // (read earlier it is an already-resolved promise and waits for nothing).
        const fontsDone = (d) => {
            const link = typeof d.getElementById === 'function' ? d.getElementById('pmsFonts') : null;
            return once(link, (el) => !!el.sheet).then(() => {
                const fs = d.fonts;
                if (!fs) return;
                const ld = (spec) => { try { return Promise.resolve(typeof fs.load === 'function' ? fs.load(spec) : null).catch(() => {}); } catch (e) { return Promise.resolve(); } };
                return Promise.all([ld('600 30pt "Playfair Display"'), ld('400 12pt Barlow'), ld('700 12pt Barlow')])
                    .then(() => (fs.ready && typeof fs.ready.then === 'function' ? fs.ready.catch(() => {}) : undefined));
            });
        };
        try {
            const d = w.document;
            const logo = typeof d.getElementById === 'function' ? d.getElementById('pmsLogo') : null;
            Promise.all([fontsDone(d), once(logo, (el) => !!el.complete)]).then(go, go);
        } catch (e) { go(); }
        setTimeout(go, 1500);
    }

    async function init() {
        const root = document.getElementById('pmSharingRoot');
        if (!canSee()) { if (root) root.innerHTML = ''; return; }
        await load();
    }

    window.PMShareDash = { init, load, render, applyFilters, buildModel, labelFor, chipsFor, mainStatus, setFilter,
                           toggleDates, clearDates, _state: S, _setFetch: (fn) => { fetchFn = fn || defaultFetch; } };
    Object.assign(window.PMShareDash, { open, close, renderDetail, csvCell, toCsv, metaLines, print, downloadCsv });
    window.initPMSharingDashboard = init;
})();
