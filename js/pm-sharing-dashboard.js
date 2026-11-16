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
            id: p.id, name: p.projectName, address: p.address, clientName: p.clientName, partnerEmail: p.partnerEmail,
            status: p.status, terminatedAt: p.terminatedAt,
            bills: (d.perProject[p.id] || {}).bills || [], reqs: (d.perProject[p.id] || {}).reqs || [],
            reserveRow: d.reserves[p.id] || null, partnerPct: Number(rows[p.id].partner_pct),
            items: (d.read.items || []).filter(i => i.project_id === p.id),
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
            if (q && (r.name + ' ' + (r.address || '') + ' ' + r.clientName).toLowerCase().indexOf(q) === -1) return false;
            return true;
        });
    }
    // "Project · Address" (same as the project lists). Date + short id only when that still collides.
    const baseLabel = (r) => r.address ? r.name + ' · ' + r.address : r.name;
    function labelFor(r, all) {
        const base = baseLabel(r);
        const dup = all.filter(x => baseLabel(x) === base).length > 1;
        return dup ? base + ' · ' + (r.completionKey || 'undated') + ' · ' + String(r.id).slice(0, 6) : base;
    }
    // Status words (owner decision D-A, 2026-10-19). PRIORITY picks the ONE main pill (D-B).
    const PRIORITY = ['reserve_review', 'shortfall', 'unpaid_balance', 'changed_since_closeout', 'items_exceed_share'];
    const CHIP = { reserve_review: 'Not counted yet', shortfall: 'Loss',
                   unpaid_balance: 'Client still owes', changed_since_closeout: 'Edited after closeout',
                   items_exceed_share: 'Items exceed share' };
    const TONE = { ready: 'ready', reserve_review: 'review', shortfall: 'loss',
                   unpaid_balance: 'unpaid', changed_since_closeout: 'changed', items_exceed_share: 'loss' };
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
    // "after ₱X items" under a share, only when that person has items.
    const itemsSub = (cents) => cents ? '<div class="pms-sub">after ' + peso(cents) + ' items</div>' : '';
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
        file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
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
            case 'items_exceed_share': return "Personal items are more than one person's share.";
            default: return '';
        }
    }
    const STATUS_BOX = {
        ready: ['Ready', 'Payments, costs and the warranty reserve are final. This project is counted in the totals.'],
        reserve_review: ['Not counted yet', 'No warranty reserve was recorded at closeout, so the reserve shown is an estimate. This project stays out of the totals until the reserve is recorded.'],
        shortfall: ['This project lost money', 'Costs plus the warranty reserve are more than the client paid. The loss is split with the same percentages and lowers both shares.'],
        unpaid_balance: ['Client still owes money', 'Counted using only what the client has paid so far. The amount to share grows once the remaining balance is collected.'],
        changed_since_closeout: ['Edited after closeout', 'Payments or costs changed after the project was closed out. Still counted, but check that the change is correct.'],
        items_exceed_share: ['Items exceed a share', "One person's personal items are more than their share of this project. Their figure shows as a minus; the other person's share is not touched."],
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
            + '<button type="button" class="pms-btn" onclick="PMShareDash.print()">' + icon('printer') + 'Print</button>'
            + '<button type="button" class="pms-btn" onclick="PMShareDash.downloadPdf()" title="Download a PDF file">' + icon('file') + 'PDF</button>'
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
            +     '<div class="pms-hero-v pms-hero-v--own' + (t.ownerAfterCents < 0 ? ' pms-neg' : '') + '">' + peso(t.ownerAfterCents) + '</div>'
            +     '<div class="pms-hero-s">' + (share ? esc(p.fmtPct(ownPct)) + '% of the amount left to share' : 'Your part of the amount left to share') + '</div>' + itemsSub(t.ownerItemsCents) + '</div>'
            +   '<div class="pms-hero-side pms-hero-side--par"><div class="pms-hero-k">Partners\' share<span class="pms-key pms-key--par"></span></div>'
            +     '<div class="pms-hero-v' + (t.partnerAfterCents < 0 ? ' pms-neg' : '') + '">' + peso(t.partnerAfterCents) + '</div>'
            +     '<div class="pms-hero-s">' + (share ? esc(p.fmtPct(parPct)) + '% · ' : '') + esc(plural(partners, 'partner', 'partners')) + '</div>' + itemsSub(t.partnerItemsCents) + '</div>'
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
            + '<div class="pms-c-own pms-n' + (r.ownerAfterCents < 0 ? ' pms-neg' : '') + '"><span class="pms-m-only">You </span>' + peso(r.ownerAfterCents) + itemsSub(r.ownerItemsCents) + '</div>'
            + '<div class="pms-c-par pms-n' + (r.partnerAfterCents < 0 ? ' pms-neg' : '') + '"><span class="pms-m-only">· Partner </span>' + peso(r.partnerAfterCents) + itemsSub(r.partnerItemsCents) + '</div>'
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
                + '<div class="pms-c-own pms-n pms-own-t' + (t.ownerAfterCents < 0 ? ' pms-neg' : '') + '"><span class="pms-m-only">You </span>' + peso(t.ownerAfterCents) + itemsSub(t.ownerItemsCents) + '</div>'
                + '<div class="pms-c-par pms-n' + (t.partnerAfterCents < 0 ? ' pms-neg' : '') + '"><span class="pms-m-only">· Partner </span>' + peso(t.partnerAfterCents) + itemsSub(t.partnerItemsCents) + '</div>'
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
        const its = (S.data.read.items || []).filter(i => i.project_id === r.id);
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
            +       '<div class="pms-part-v' + (r.ownerAfterCents < 0 ? ' pms-neg' : '') + '">' + peso(r.ownerAfterCents) + itemsSub(r.ownerItemsCents) + '</div></div>'
            +     '<div class="pms-part"><div class="pms-part-k">Partner · ' + esc(p.fmtPct(r.partnerPct)) + '%</div>'
            +       '<div class="pms-part-v' + (r.partnerAfterCents < 0 ? ' pms-neg' : '') + '">' + peso(r.partnerAfterCents) + itemsSub(r.partnerItemsCents) + '</div></div></div>'
            +   '</div>'
            +   step(5, 'Personal items', '', '<div id="pmSharingItems"></div>')
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
        // Personal items (0110): owner-role only (mount renders nothing otherwise); a save re-runs load(),
        // and render() keeps S.openId, so the page reopens on this project with the new figures.
        if (window.PMShareItems) {
            window.PMShareItems.mount(document.getElementById('pmSharingItems'), {
                projectId: r.id, items: its, canEdit: !!S.data.read.can_edit,
                companyId: window.currentDataUserId, onChange: load });
        }
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
                      'Reserve basis', 'Sharing balance', 'Your %', 'Your amount', 'Partner %', 'Partner amount',
                      'Your items', 'Your amount after items', 'Partner items', 'Partner amount after items', 'Client balance', 'Review'];
        const row = (r, provisional) => [labelFor(r, m.all), r.clientName, r.partnerEmail || 'Partner unassigned',
            r.completionKey || 'Undated', peso(r.paidCents), peso(r.costCents), peso(r.remainingCents), peso(r.reserve.cents),
            provisional ? 'Provisional — not counted yet' : (r.reserve.kind === 'recorded' ? 'Recorded at closeout' : 'Estimate'),
            peso(r.balanceCents), r.ownerPct, peso(r.ownerCents), r.partnerPct, peso(r.partnerCents),
            peso(r.ownerItemsCents), peso(r.ownerAfterCents), peso(r.partnerItemsCents), peso(r.partnerAfterCents),
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
                    peso(t.ownerItemsCents), peso(t.ownerAfterCents), peso(t.partnerItemsCents), peso(t.partnerAfterCents),
                    peso(t.outstandingCents), t.reviewCount + ' not counted yet (not in totals)'].map(csvCell).join(','));
        return lines.join('\r\n');
    }
    function downloadCsv() {
        if (!canSee() || !S.data) return;
        const csv = toCsv(buildModel(S.results, S.filters), metaLines());
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'profit-sharing-' + fileDate() + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    // Printed project name: the name, plus a short id only when the name is duplicated (the date lives in the subline).
    const printTitle = (r, all) => baseLabel(r) + (all.filter(x => baseLabel(x) === baseLabel(r)).length > 1 ? ' · ' + String(r.id).slice(0, 6) : '');
    // Status pill colours [background, text] and legend wording, shared by the printed sheet and the PDF file.
    const TONES = { ready: ['#EAF2EC', '#1A5C3A'], reserve_review: ['#FBF2DC', '#8A5F0C'], unpaid_balance: ['#FBF2DC', '#8A5F0C'],
                    shortfall: ['#F8E7E4', '#8F352C'], changed_since_closeout: ['#EEF2F6', '#44525F'],
                    items_exceed_share: ['#F8E7E4', '#8F352C'] };
    const MEAN = { unpaid_balance: 'Counted with what has been paid so far.', shortfall: 'Costs and reserve exceed what was paid. The loss lowers both shares.',
                   changed_since_closeout: 'Payments or costs changed after closeout. Check the change.',
                   items_exceed_share: "Personal items are more than one person's share; that figure is a minus.", reserve_review: 'No warranty reserve recorded at closeout; left out of the totals.' };
    const BASIS = 'Net share = client paid − project costs − warranty reserve recorded at closeout, split per project at its agreed percentage. Amounts in PHP.';
    const REVIEW_NOTE = '. No warranty reserve was recorded at closeout, so this project is left out of the totals until it is.';
    // ONE model for the printed sheet AND the downloaded PDF, so the two can never show different figures.
    function sheetModel() {
        const m = buildModel(S.results, S.filters), t = m.totals, p = P(), f = S.filters;
        const when = S.asOf ? fmtWhen(S.asOf) : '';
        const dateText = f.undatedOnly ? 'Undated only'
            : (f.from && f.to) ? fmtKey(f.from) + ' – ' + fmtKey(f.to) : f.from ? 'From ' + fmtKey(f.from) : f.to ? 'Until ' + fmtKey(f.to) : 'All dates';
        const partnerText = f.partner === 'all' ? 'All partners' : f.partner === 'unassigned' ? 'No partner' : f.partner;
        const { share, ownPct, parPct } = shareSplit(t);   // same rule as the screen hero
        const netLabel = t.netCents < 0 ? 'Net loss' : 'Net share';
        const lossRows = m.rows.filter(r => r.balanceCents < 0).length;
        // by partner (confirmed rows only)
        const byPartner = new Map();
        m.rows.forEach(r => {
            const k = r.partnerEmail || '';
            const g = byPartner.get(k) || { n: 0, cents: 0, loss: false };
            g.n++; g.cents += r.partnerAfterCents; if (r.balanceCents < 0) g.loss = true;
            byPartner.set(k, g);
        });
        const partnerKeys = Array.from(byPartner.keys()).sort((a, b) => (a === '') - (b === '') || (a < b ? -1 : a > b ? 1 : 0));
        const partnerLines = partnerKeys.length > 1 ? partnerKeys.map(k => {
            const g = byPartner.get(k);
            return { label: (k || 'No partner assigned') + ' · ' + plural(g.n, 'project', 'projects') + (g.loss ? ', includes a loss' : ''), cents: g.cents };
        }) : [];
        const subline = (r) => (r.clientName || '') + ' · ' + (r.completionKey ? 'Completed ' : '') + completedText(r)
            + (byPartner.size > 1 || !r.partnerEmail ? ' · ' + (r.partnerEmail || 'No partner assigned') : '');
        // legend: Ready + statuses present
        const all = m.rows.concat(m.review);
        const present = (fl) => all.some(r => flagsOf(r).indexOf(fl) !== -1);
        const legendRows = [['ready', 'Payments, costs and reserve are final.']].concat(['unpaid_balance', 'shortfall', 'changed_since_closeout', 'reserve_review', 'items_exceed_share']
            .filter(present).map(fl => [fl, MEAN[fl] + (fl === 'unpaid_balance' ? all.filter(r => flagsOf(r).indexOf(fl) !== -1)
                .map(r => ' ' + printTitle(r, m.all) + ': ' + p.pesos(r.outstandingCents) + ' unpaid.').join('') : '')]));
        return { m, t, p, f, when, dateText, partnerText, share, ownPct, parPct, netLabel, lossRows, partnerLines, subline, legendRows,
                 hasRows: m.rows.length + m.review.length > 0,
                 paidPct: t.paidCents ? (t.netCents / t.paidCents * 100).toFixed(1) + '%' : '—',
                 title: (r) => printTitle(r, m.all) };
    }
    const statusWord = (fl) => fl === 'ready' ? 'Ready' : CHIP[fl];
    // Layout 2a (side panel): green summary panel on the left, one block per project on the right.
    function print() {
        if (!canSee() || !S.data) return;
        const { m, t, p, f, when, dateText, partnerText, share, ownPct, parPct, netLabel, lossRows, partnerLines, subline, legendRows, hasRows, paidPct } = sheetModel();
        const ppill = (fl) => '<span class="pill" style="background:' + TONES[fl][0] + ';color:' + TONES[fl][1] + '">' + esc(statusWord(fl)) + '</span>';
        const amt = (c) => esc(p.pesos(c)).replace('₱', '');                  // table figures: no peso sign (also after a minus)
        const partnerList = partnerLines.length ? '<div class="plist">' + partnerLines.map(l =>
            '<span>' + esc(l.label) + '</span><span class="n' + (l.cents < 0 ? ' negc' : '') + '">' + esc(p.pesos(l.cents)) + '</span>').join('') + '</div>' : '';

        // ── left panel ──
        const logo = window.location.origin + '/assets/images/DACS-TRANSPARENT.png';
        const meta = '<div class="pmeta"><span>As of</span><b>' + esc(when) + '</b><span>Completed</span><b>' + esc(dateText) + '</b>'
            + '<span>Partners</span><b>' + esc(partnerText) + '</b>' + (f.q ? '<span>Search</span><b>' + esc(f.q) + '</b>' : '') + '</div>';
        const brand = '<div class="brand"><div class="logo"><img id="pmsLogo" src="' + esc(logo) + '" alt="DAC\'s"></div>'
            + '<div><div class="eyebrow">DAC\'s Building Design Services</div><div class="t">Profit Sharing</div></div></div>';
        const panel = '<aside class="panel">' + brand
            + '<div class="split"><div class="bar' + (share ? '' : ' empty') + '">' + (share ? '<div style="width:' + clampPct(ownPct) + '%"></div>' : '') + '</div>'
            + '<div class="ln"><span class="k">Dacs' + (share ? ' · ' + esc(p.fmtPct(ownPct)) + '%' : '') + '</span><span class="v green' + (t.ownerAfterCents < 0 ? ' negc' : '') + '">' + esc(p.pesos(t.ownerAfterCents)) + '</span></div>'
            + (t.ownerItemsCents ? '<div class="note">' + esc(p.pesos(t.ownerAfterCents + t.ownerItemsCents) + ' less ' + p.pesos(t.ownerItemsCents) + ' personal items') + '</div>' : '')
            + '<div class="sep">' + (t.partnerItemsCents
                ? '<span class="k">Partners' + (share ? ' · ' + esc(p.fmtPct(parPct)) + '%' : '') + '</span>'
                  + '<div class="ln sm"><span class="grey">Share</span><span class="n">' + esc(p.pesos(t.partnerAfterCents + t.partnerItemsCents)) + '</span></div>'
                  + '<div class="ln sm ded"><span>− Partner expenses</span><span class="n">(' + esc(p.pesos(t.partnerItemsCents)) + ')</span></div>'
                  + '<div class="ln netln"><span class="k b">Net to partners</span><span class="v' + (t.partnerAfterCents < 0 ? ' negc' : '') + '">' + esc(p.pesos(t.partnerAfterCents)) + '</span></div>'
                : '<div class="ln"><span class="k">Partners' + (share ? ' · ' + esc(p.fmtPct(parPct)) + '%' : '') + '</span><span class="v' + (t.partnerAfterCents < 0 ? ' negc' : '') + '">' + esc(p.pesos(t.partnerAfterCents)) + '</span></div>')
            + partnerList + '</div></div>'
            + '<div class="calc"><div class="ln"><span>Client paid</span><span class="n">' + esc(p.pesos(t.paidCents)) + '</span></div>'
            + '<div class="ln"><span>− Project costs</span><span class="n">' + amt(t.costCents) + '</span></div>'
            + '<div class="ln"><span>− Warranty reserve</span><span class="n">' + amt(t.reserveCents) + '</span></div>'
            + '<div class="ln tot"><span>= ' + netLabel + '</span><span class="n">' + esc(p.pesos(t.netCents)) + '</span></div></div>'
            + '<div class="hero"><div class="eyebrow">' + netLabel + '</div><div class="big">' + esc(p.pesos(t.netCents)) + '</div>'
            + '<div class="soft">' + esc(paidPct + ' of client payments · ' + plural(t.count, 'project', 'projects')) + '</div>'
            + (t.shortfallCents < 0 ? '<div class="soft">' + esc('Includes a ' + p.pesos(-t.shortfallCents) + ' loss on ' + plural(lossRows, 'project', 'projects') + '.') + '</div>' : '')
            + '</div>' + meta + '</aside>';

        // ── project blocks ──
        const cell = (k, v, cls, extra) => '<div class="c' + (cls ? ' ' + cls : '') + '"><span class="k">' + k + '</span><span class="n">' + v + '</span>' + (extra || '') + '</div>';
        const shareCell = (label, after, items) => !items
            ? cell(label, amt(after), 'r' + (after < 0 ? ' negc' : ''))
            : '<div class="c brk"><span class="k r">' + label + '</span>'
              + '<div class="ln"><span class="grey">Share</span><span class="n">' + amt(after + items) + '</span></div>'
              + '<div class="ln ded"><span>− Expenses</span><span class="n">(' + amt(items) + ')</span></div>'
              + '<div class="ln netln' + (after < 0 ? ' negc' : '') + '"><span>Net</span><span class="n">' + amt(after) + '</span></div></div>';
        const projHtml = (r) => {
            const fl = flagsOf(r);
            const neg = r.balanceCents < 0;
            return '<div class="proj"><div class="ph"><div><div class="nm">' + esc(printTitle(r, m.all)) + '</div>'
                + '<div class="sb">' + esc(subline(r)) + '</div></div>'
                + '<div class="pills">' + (fl.length ? fl.map(ppill).join(' ') : ppill('ready')) + '</div></div>'
                + '<div class="row">' + cell('Client paid', amt(r.paidCents)) + cell('Costs', amt(r.costCents)) + cell('Reserve', amt(r.reserve.cents))
                + cell(neg ? 'Net loss' : 'Net share', amt(r.balanceCents), 'hl' + (neg ? ' negc' : ''))
                + shareCell('Dacs ' + esc(p.fmtPct(r.ownerPct)) + '%', r.ownerAfterCents, r.ownerItemsCents)
                + shareCell('Partner ' + esc(p.fmtPct(r.partnerPct)) + '%', r.partnerAfterCents, r.partnerItemsCents)
                + '</div></div>';
        };
        const totals = '<div class="row totrow">' + cell('Total paid', amt(t.paidCents)) + cell('Total costs', amt(t.costCents)) + cell('Total reserve', amt(t.reserveCents))
            + cell(netLabel, amt(t.netCents), 'solid') + cell('Dacs', amt(t.ownerAfterCents), 'r green') + cell('Partners' + (t.partnerItemsCents ? ', net of expenses' : ''), amt(t.partnerAfterCents), 'r') + '</div>';

        const reviewHtml = m.review.length ? '<div class="avoid"><h3>Not counted yet</h3>' + m.review.map(r =>
            '<div class="rcard"><div class="ln"><b>' + esc(printTitle(r, m.all)) + '</b><span class="n">' + esc(p.pesos(r.balanceCents)) + ' estimated</span></div>'
            + '<div class="grey">' + esc('Paid ' + p.pesos(r.paidCents) + ' − costs ' + p.pesos(r.costCents) + ' − estimated reserve ' + p.pesos(r.reserve.cents)
              + REVIEW_NOTE) + '</div></div>').join('') + '</div>' : '';

        const legend = '<div class="legend avoid">' + legendRows.map(x =>
            '<b style="color:' + TONES[x[0]][1] + '">' + esc(statusWord(x[0])) + '</b><span>' + esc(x[1]) + '</span>').join('')
            + '<b>Basis</b><span>' + esc(BASIS) + '</span></div>';

        const main = '<main class="main"><div class="mh"><span class="h">Results by project</span><span class="grey">Amounts in PHP</span></div>'
            + (m.rows.length ? m.rows.map(projHtml).join('') + totals : '<p class="grey">No counted projects.</p>')
            + reviewHtml + legend + '</main>';

        // Any paper, either orientation: no forced @page size. The layout follows the printable width
        // through container queries (print media-width queries missed Letter portrait):
        //   wide   (≥ 9in, landscape)  green panel on the left, projects on the right
        //   medium (portrait)          panel becomes a two-column band across the top
        //   narrow (< 5.6in, A5 etc.)  panel stacks
        // Every project row is a subgrid of .main, so all rows share ONE set of columns that grow to the
        // widest figure (a long "− Expenses (400,000.00)" never spills). Below 7in of room the shares
        // drop to a second line (4 columns).
        const FOUR = '.main{grid-template-columns:repeat(4,minmax(min-content,1fr))}'
            + '.row{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-columns:subgrid}.row>.c:nth-child(n+5){grid-column:span 2}';
        const css = '@page{margin:10mm 10mm 14mm}*{box-sizing:border-box}'
            + 'body{margin:0;font-family:Barlow,Helvetica,Arial,sans-serif;font-size:10pt;color:#1C1C1E;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
            + '.n{white-space:nowrap}.grey{color:#6C6C70}.green{color:#1A5C3A}.negc{color:#8F352C!important}.avoid{break-inside:avoid}'
            + '.layout{display:grid;grid-template-columns:minmax(2.6in,30%) minmax(0,1fr);gap:0.3in;align-items:start}'
            + '.panel{background:#1A5C3A;color:#fff;border-radius:6px;padding:0.32in 0.26in;display:flex;flex-direction:column;gap:18px;break-inside:avoid;container:panel/inline-size}'
            + '.panel .eyebrow{font-size:7.5pt;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#CFE3D7}'
            + '.brand{display:flex;align-items:center;gap:10px}.brand .t{font-family:"Playfair Display",Georgia,serif;font-size:17pt;font-weight:600;line-height:1.1}'
            + '.logo{width:40px;height:40px;background:#fff;border-radius:7px;display:grid;place-items:center;flex:none}.logo img{width:31px;height:31px;object-fit:contain}'
            + '.hero{display:flex;flex-direction:column;gap:2px}.hero .big{font-size:min(27pt,10.5cqi);white-space:nowrap;font-weight:700;line-height:1.1}.soft{font-size:9.5pt;color:#CFE3D7}'
            + '.ln{display:flex;justify-content:space-between;gap:10px;align-items:baseline}'
            + '.calc{border-top:1px solid rgba(255,255,255,.3)}.calc .ln{padding:5px 0;border-top:1px solid rgba(255,255,255,.14)}.calc .ln:first-child{border-top:none}'
            + '.calc .tot{border-top:1.5px solid #fff;font-weight:700}'
            + '.split{background:#fff;color:#1C1C1E;border-radius:6px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}'
            + '.split .k{font-weight:600;color:#3A3A3C;white-space:nowrap}.split .v{font-size:min(13pt,6cqi);font-weight:700;white-space:nowrap}.split .note{font-size:8.5pt;color:#6C6C70}'
            + '.split .sep{border-top:1px solid #EEEEEE;padding-top:6px;display:flex;flex-direction:column;gap:2px}'
            + '.bar{display:flex;height:6px;background:#9DC9B4}.bar div{background:#1A5C3A}.bar.empty{background:#E5E5E5}'
            + '.plist{display:grid;grid-template-columns:1fr auto;gap:2px 10px;font-size:8.5pt;margin-top:4px}'
            + '.pmeta{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:8.5pt;color:#CFE3D7}.pmeta b{color:#fff;font-weight:600}'
            + '.main{min-width:0;display:grid;grid-template-columns:repeat(3,minmax(min-content,1fr)) minmax(min-content,1.15fr) minmax(min-content,0.9fr) minmax(min-content,1.3fr);column-gap:10px;align-content:start}.main>*{grid-column:1/-1}'
            + '.mh{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:6px;border-bottom:2px solid #1C1C1E;break-after:avoid}'
            + '.mh .h{font-family:"Playfair Display",Georgia,serif;font-size:15pt;font-weight:600}.mh .grey{font-size:8.5pt}'
            + '.proj{padding:10px 0;border-bottom:1px solid #E5E5E5;display:grid;grid-template-columns:minmax(0,1fr);grid-template-columns:subgrid;row-gap:6px;break-inside:avoid}.ph{grid-column:1/-1}'
            + '.ph{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.nm{font-size:10.5pt;font-weight:700}.sb{font-size:8.5pt;color:#6C6C70}'
            + '.pills{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}.pill{font-size:8.5pt;font-weight:700;padding:1px 8px;border-radius:99px;white-space:nowrap}'
            + '.row{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1.15fr) minmax(0,0.9fr) minmax(0,1.3fr);grid-template-columns:subgrid;row-gap:6px;font-size:9.5pt}'
            + '.c{display:flex;flex-direction:column}.c .k{font-size:7.5pt;color:#6C6C70}.c.r{text-align:right}.c .note{font-size:7.5pt;color:#6C6C70}'
            + '.c.hl{background:#EAF2EC;padding:2px 7px;margin:-2px 0;font-weight:700;color:#1A5C3A}.c.hl .k{color:#1A5C3A;font-weight:700}'
            + '.c.brk{font-size:9pt;gap:1px}.c.brk .k.r{text-align:right}.c.brk .ln>span:first-child{white-space:nowrap}.ded{color:#8F352C}.netln{border-top:1px solid #1C1C1E;padding-top:1px;font-weight:700}.ln.sm{font-size:9pt}.b{font-weight:700}'
            + '.totrow{font-weight:700;padding:8px 0;border-bottom:3px double #1C1C1E;break-inside:avoid}'
            + '.c.solid{background:#1A5C3A;color:#fff;padding:2px 7px;margin:-2px 0}.c.solid .k{color:#fff}'
            + 'h3{font-family:"Playfair Display",Georgia,serif;font-size:12pt;font-weight:600;margin:14px 0 6px}'
            + '.rcard{border:1px solid #E5E5E5;border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:3px;margin-bottom:6px;font-size:9pt}'
            + '.legend{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin-top:12px;font-size:8.5pt;color:#3A3A3C;line-height:1.4}'
            + '.foot{display:flex;justify-content:space-between;gap:12px;font-size:8pt;color:#6C6C70;padding-top:6px;border-top:1px solid #E5E5E5;margin-top:18px}'
            + '.sheet{width:100%;border-collapse:collapse;table-layout:fixed}.sheet>thead>tr>td,.sheet>tbody>tr>td,.sheet>tfoot>tr>td{display:block;padding:0}.foot-space{height:0.6in}'
            + '@media screen{body{background:#E9E9E6;padding:24px 0}.page{max-width:11in;min-height:8.5in;margin:0 auto;padding:0.4in;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.12)}}'
            + '@media print{.foot{position:fixed;bottom:4mm;left:0;right:0;margin:0;background:#fff}.sheet{display:table}.sheet>thead{display:table-header-group}'
            +   '.sheet>tfoot{display:table-footer-group}.sheet>thead>tr>td,.sheet>tbody>tr>td,.sheet>tfoot>tr>td{display:table-cell}}@media screen{.foot-space{display:none}}'
            + '.page{container:page/inline-size}'
            + '@container page (max-width:9in){.layout{grid-template-columns:minmax(0,1fr);gap:0.22in}'
            +   '.panel{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"brand split" "hero split" "meta calc";gap:14px 0.3in;align-items:start;padding:0.24in 0.26in}'
            +   '.brand{grid-area:brand}.split{grid-area:split}.calc{grid-area:calc}.hero{grid-area:hero}.pmeta{grid-area:meta}.panel.bare{display:flex}}'
            + '@container page (max-width:5.6in){.panel{display:flex;align-items:stretch}}'
            + '@container page (max-width:7in){' + FOUR + '}@container page (min-width:9in) and (max-width:10in){' + FOUR + '}';

        // Empty state keeps the brand and the filters, so the page still says what was asked for.
        const content = '<div class="layout">' + (hasRows ? panel + main
            : '<aside class="panel bare">' + brand + meta + '</aside><main class="main"><p>No completed projects match these filters.</p></main>') + '</div>';
        const body = '<div class="page"><table class="sheet"><thead><tr><td></td></tr></thead><tbody><tr><td>' + content
            + '</td></tr></tbody><tfoot><tr><td><div class="foot-space"></div></td></tr></tfoot></table><div class="foot"><span>Profit Sharing · DAC\'s Building Design Services · As of ' + esc(when) + '</span><span>' + esc(INTERNAL) + '</span></div></div>';
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

    // ── Download PDF: a real file, layout 2a on Legal (8.5 × 14) landscape, scaled to fill it ──
    // Print / PDF goes through the browser's dialog; this saves the file straight away, the way the
    // invoice and PM report downloads do. Drawn from sheetModel(), so every figure matches the print.
    // jsPDF and the Roboto faces (jsPDF's own fonts have no ₱) load on first use only. If the font
    // cannot be fetched the file still downloads, spelling "PHP" and a plain hyphen instead.
    const PDF_FONT_BASE = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/';
    let pdfFont = null;                     // null = untried, false = tried and failed
    let pdfBusy = false;
    const toast = (msg, isErr) => { if (typeof window._pmToast === 'function') window._pmToast(msg, !!isErr); };
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('failed to load ' + src));
            document.head.appendChild(s);
        });
    }
    function ensureJsPdf() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
        return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js').then(() => window.jspdf.jsPDF);
    }
    function fetchB64(url) {
        return fetch(url)
            .then(r => { if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status); return r.arrayBuffer(); })
            .then(buf => {
                const bytes = new Uint8Array(buf);
                let s = '';
                for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                return btoa(s);
            });
    }
    async function ensurePdfFont() {
        if (pdfFont !== null) return pdfFont;
        try {
            const [regular, bold] = await Promise.all([fetchB64(PDF_FONT_BASE + 'Roboto_400Regular.ttf'), fetchB64(PDF_FONT_BASE + 'Roboto_700Bold.ttf')]);
            pdfFont = { regular, bold };
        } catch (e) { pdfFont = false; }
        return pdfFont;
    }
    // The logo through a canvas, so jsPDF gets pixel data. null on ANY failure — never blocks the file.
    function pdfImg(src) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth; c.height = img.naturalHeight;
                    c.getContext('2d').drawImage(img, 0, 0);
                    resolve({ url: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
                } catch (e) { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }
    const fileDate = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

    async function downloadPdf() {
        if (!canSee() || !S.data || pdfBusy) return;
        pdfBusy = true;
        try {
            let jsPDF;
            try { jsPDF = await ensureJsPdf(); }
            catch (e) { toast('Could not load the PDF generator. Check your internet connection and try again.', true); return; }
            const [font, logo] = await Promise.all([ensurePdfFont(), pdfImg(window.location.origin + '/assets/images/DACS-TRANSPARENT.png')]);
            const model = sheetModel();
            // Legal (8.5 × 14 in) landscape, filled: the sheet is laid out in "virtual mm" and the
            // unit is scaled so the content grows to the paper. The largest scale that still fits ONE
            // page wins; when it cannot fit one page even at 1×, a standard scale runs onto more pages.
            const probe = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'legal' });
            registerPdfFonts(probe, font);
            const fitsOnePage = (s) => drawSheet(probe, model, font, null, { s: 1, pw: LEGAL_W / s, ph: LEGAL_H / s, measureOnly: true }).onePage;
            let s = PDF_SCALE_MULTI;
            for (let c = PDF_SCALE_MAX; c >= 1 - 1e-9; c -= 0.025) if (fitsOnePage(c)) { s = c; break; }
            const doc = new jsPDF({ orientation: 'landscape', unit: 72 / 25.4 * s, format: 'legal' });
            registerPdfFonts(doc, font);
            drawSheet(doc, model, font, logo, { s, pw: LEGAL_W / s, ph: LEGAL_H / s });
            doc.save('profit-sharing-' + fileDate() + '.pdf');
        } catch (e) {
            toast('Could not make the PDF: ' + (e && e.message || e), true);
        } finally { pdfBusy = false; }
    }

    const LEGAL_W = 355.6, LEGAL_H = 215.9;      // 14 × 8.5 in, landscape, in mm
    const PDF_SCALE_MAX = 1.5;                   // never larger than this, however short the sheet
    const PDF_SCALE_MULTI = 1.1;                 // the scale used when the sheet needs more than one page
    function registerPdfFonts(doc, font) {
        if (!font) return;
        doc.addFileToVFS('Roboto-Regular.ttf', font.regular); doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
        doc.addFileToVFS('Roboto-Bold.ttf', font.bold); doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
    }
    // Draws the sheet in "virtual mm" on a pw × ph page; the doc's unit carries the scale (o.s), and font
    // sizes (points) are multiplied by it so text grows with everything else. Every block is measured
    // first (a "dry" pass that only advances y), so a background can go under its content and a project
    // block never splits across two pages. measureOnly draws nothing and reports whether it fits one page.
    function drawSheet(doc, d, font, logo, o) {
        const { m, t, p } = d;
        const F = font ? 'Roboto' : 'helvetica';
        const GREEN = '#1A5C3A', INK = '#1C1C1E', GREY = '#6C6C70', SOFT = '#CFE3D7', RED = '#8F352C', WHITE = '#FFFFFF';
        const PW = o.pw, PH = o.ph, ML = 10, MR = 10, TOP = 10, BOTTOM = PH - 17;   // the footer sits below BOTTOM
        const PX = ML, PWID = Math.round((PW - ML - MR) * 0.3), MX = PX + PWID + 8, MW = PW - MR - MX;
        // jsPDF's built-in faces are WinAnsi: no ₱ and no − (U+2212).
        const tx = (s) => font ? String(s) : String(s).replace(/₱/g, 'PHP ').replace(/−/g, '-');
        const peso = (c) => p.pesos(c);
        const amt = (c) => p.pesos(c).replace('₱', '');                        // table figures: no peso sign
        const lh = (size) => size * 0.3528 * 1.3;                               // line height in mm
        let dry = !!o.measureOnly;
        const set = (size, style, color, fam) => { doc.setFont(fam || F, style || 'normal'); doc.setFontSize(size * o.s); doc.setTextColor(color || INK); };
        const W = (s) => doc.getTextWidth(tx(s));
        const wrap = (s, w) => doc.splitTextToSize(tx(s), w);
        const text = (s, x, y, o) => { if (!dry) doc.text(Array.isArray(s) ? s : tx(s), x, y, o || {}); };
        const right = (s, x, y) => text(s, x, y, { align: 'right' });
        const fill = (hex, x, y, w, h, r) => {
            if (dry) return;
            doc.setFillColor(hex);
            if (r) doc.roundedRect(x, y, w, h, r, r, 'F'); else doc.rect(x, y, w, h, 'F');
        };
        const rule = (hex, x1, y, x2, lw) => { if (dry) return; doc.setDrawColor(hex); doc.setLineWidth(lw || 0.2); doc.line(x1, y, x2, y); };
        const measure = (fn, y) => { const was = dry; dry = true; const end = fn(y); dry = was; return end - y; };
        const memo = {};                                                        // heights found by the dry pass

        // ── left panel (page 1) ──
        function meta(x, y, w) {
            const rows = [['As of', d.when], ['Completed', d.dateText], ['Partners', d.partnerText]].concat(d.f.q ? [['Search', d.f.q]] : []);
            rows.forEach(([k, v]) => {
                set(7, 'bold', WHITE);
                const lines = wrap(v, w - 18);
                text(lines, x + 18, y);
                set(7, 'normal', SOFT); text(k, x, y);
                y += lines.length * lh(7) + 0.6;
            });
            return y;
        }
        function panel(y0) {
            const x = PX + 7, w = PWID - 14;
            let y = y0 + 8;
            fill(WHITE, x, y, 11, 11, 1.8);
            if (logo && !dry) {
                const k = Math.min(8.5 / logo.w, 8.5 / logo.h);
                doc.addImage(logo.url, 'PNG', x + 5.5 - logo.w * k / 2, y + 5.5 - logo.h * k / 2, logo.w * k, logo.h * k);
            }
            set(5.8, 'bold', SOFT); text("DAC'S BUILDING DESIGN SERVICES", x + 14, y + 3.8, { charSpace: 0.25 });
            set(15, 'bold', WHITE, 'times'); text('Profit Sharing', x + 14, y + 9.8);
            y += 17;
            if (!d.hasRows) return meta(x, y + 2, w) + 5;

            // split card (white)
            const cx = x + 3.5, cw = w - 7, cy = y;
            if (memo.card) fill(WHITE, x, cy, w, memo.card, 1.8);
            let yy = cy + 3.5;
            fill(d.share ? '#9DC9B4' : '#E5E5E5', cx, yy, cw, 1.6);
            if (d.share) fill(GREEN, cx, yy, cw * clampPct(d.ownPct) / 100, 1.6);
            yy += 6.5;
            set(8.5, 'bold', '#3A3A3C'); text('Dacs' + (d.share ? ' · ' + p.fmtPct(d.ownPct) + '%' : ''), cx, yy);
            set(11, 'bold', t.ownerAfterCents < 0 ? RED : GREEN); right(peso(t.ownerAfterCents), cx + cw, yy);
            if (t.ownerItemsCents) {
                yy += 4; set(7, 'normal', GREY);
                text(peso(t.ownerAfterCents + t.ownerItemsCents) + ' less ' + peso(t.ownerItemsCents) + ' personal items', cx, yy);
            }
            yy += 2.5; rule('#EEEEEE', cx, yy, cx + cw); yy += 4.5;
            const parLabel = 'Partners' + (d.share ? ' · ' + p.fmtPct(d.parPct) + '%' : '');
            if (t.partnerItemsCents) {
                set(8.5, 'bold', '#3A3A3C'); text(parLabel, cx, yy); yy += 4;
                set(7.5, 'normal', GREY); text('Share', cx, yy); set(7.5, 'normal', INK); right(peso(t.partnerAfterCents + t.partnerItemsCents), cx + cw, yy); yy += 3.6;
                set(7.5, 'normal', RED); text('− Partner expenses', cx, yy); right('(' + peso(t.partnerItemsCents) + ')', cx + cw, yy);
                yy += 1.4; rule(INK, cx, yy, cx + cw, 0.3); yy += 4.4;
                set(8.5, 'bold', '#3A3A3C'); text('Net to partners', cx, yy);
            } else {
                set(8.5, 'bold', '#3A3A3C'); text(parLabel, cx, yy);
            }
            set(11, 'bold', t.partnerAfterCents < 0 ? RED : INK); right(peso(t.partnerAfterCents), cx + cw, yy);
            if (d.partnerLines.length) {
                yy += 1.5;
                d.partnerLines.forEach(l => {
                    set(7, 'normal', INK);
                    const v = peso(l.cents), lines = wrap(l.label, cw - W(v) - 3);
                    yy += lh(7);
                    text(lines, cx, yy);
                    set(7, 'normal', l.cents < 0 ? RED : INK); right(v, cx + cw, yy);
                    yy += (lines.length - 1) * lh(7);
                });
            }
            yy += 3;
            if (dry) memo.card = yy - cy;
            y = yy + 5;

            // the worked-out lines
            rule('#5F8C73', x, y, x + w, 0.2);
            [['Client paid', peso(t.paidCents)], ['− Project costs', amt(t.costCents)], ['− Warranty reserve', amt(t.reserveCents)]].forEach(([k, v], i) => {
                if (i) rule('#3C7455', x, y, x + w, 0.2);
                set(8.5, 'normal', WHITE); text(k, x, y + 4.6); right(v, x + w, y + 4.6);
                y += 6.6;
            });
            rule(WHITE, x, y, x + w, 0.4);
            set(8.5, 'bold', WHITE); text('= ' + d.netLabel, x, y + 4.6); right(peso(t.netCents), x + w, y + 4.6);
            y += 11;

            // hero
            set(6, 'bold', SOFT); text(d.netLabel.toUpperCase(), x, y, { charSpace: 0.3 });
            let size = 24;
            set(size, 'bold', WHITE);
            while (W(peso(t.netCents)) > w && size > 12) set(--size, 'bold', WHITE);
            y += lh(size) * 0.95; text(peso(t.netCents), x, y);
            y += 5; set(8, 'normal', SOFT); text(d.paidPct + ' of client payments · ' + plural(t.count, 'project', 'projects'), x, y);
            if (t.shortfallCents < 0) { y += 4; text('Includes a ' + peso(-t.shortfallCents) + ' loss on ' + plural(d.lossRows, 'project', 'projects') + '.', x, y); }
            y += 8;
            return meta(x, y, w) + 5;
        }

        // ── project blocks: one set of columns for every row, as wide as the widest figure ──
        const FR = [1, 1, 1, 1.15, 0.9, 1.3], CG = 3.5;
        const shareCell = (k, after, items) => items
            ? { k, right: true, brk: { share: amt(after + items), items: '(' + amt(items) + ')', net: amt(after) }, neg: after < 0 }
            : { k, right: true, v: amt(after), neg: after < 0 };
        const rowCells = (r) => [{ k: 'Client paid', v: amt(r.paidCents) }, { k: 'Costs', v: amt(r.costCents) }, { k: 'Reserve', v: amt(r.reserve.cents) },
            { k: r.balanceCents < 0 ? 'Net loss' : 'Net share', v: amt(r.balanceCents), hl: true, neg: r.balanceCents < 0 },
            shareCell('Dacs ' + p.fmtPct(r.ownerPct) + '%', r.ownerAfterCents, r.ownerItemsCents),
            shareCell('Partner ' + p.fmtPct(r.partnerPct) + '%', r.partnerAfterCents, r.partnerItemsCents)];
        const totalCells = [{ k: 'Total paid', v: amt(t.paidCents) }, { k: 'Total costs', v: amt(t.costCents) }, { k: 'Total reserve', v: amt(t.reserveCents) },
            { k: d.netLabel, v: amt(t.netCents), solid: true }, { k: 'Dacs', v: amt(t.ownerAfterCents), right: true, green: true },
            { k: 'Partners' + (t.partnerItemsCents ? ', net of expenses' : ''), v: amt(t.partnerAfterCents), right: true }];
        const cellWidth = (c, bold) => {
            set(6.5, bold ? 'bold' : 'normal'); let w = W(c.k);
            if (c.brk) {
                set(8); w = Math.max(w, W('Share') + 3 + W(c.brk.share), W('− Expenses') + 3 + W(c.brk.items));
                set(8, 'bold'); w = Math.max(w, W('Net') + 3 + W(c.brk.net));
            } else { set(8.5, bold || c.hl ? 'bold' : 'normal'); w = Math.max(w, W(c.v)); }
            return w + (c.hl || c.solid ? 4 : 0) + 0.5;
        };
        const allRows = m.rows.map(rowCells).concat(m.rows.length ? [totalCells] : []);
        const needW = FR.map((_, i) => Math.max(0, ...allRows.map((cells, ri) => cellWidth(cells[i], cells === totalCells))));
        let unit = (MW - CG * 5) / FR.reduce((a, b) => a + b, 0);
        for (let pass = 0; pass < 6; pass++) {                                  // columns that need more than their share keep what they need
            const fixed = FR.map((fr, i) => needW[i] > fr * unit);
            const freeFr = FR.reduce((a, fr, i) => a + (fixed[i] ? 0 : fr), 0);
            const fixedW = needW.reduce((a, w, i) => a + (fixed[i] ? w : 0), 0);
            if (!freeFr) break;
            unit = Math.max(0, (MW - CG * 5 - fixedW) / freeFr);
        }
        const colW = FR.map((fr, i) => Math.max(needW[i], fr * unit));
        const colX = colW.map((_, i) => MX + colW.slice(0, i).reduce((a, b) => a + b, 0) + CG * i);

        function cellsRow(cells, top, bold) {
            const h = cells.some(c => c.brk) ? 15 : 7.8;
            cells.forEach((c, i) => {
                const x = colX[i], w = colW[i], pad = c.hl || c.solid ? 2 : 0;
                if (c.hl) fill('#EAF2EC', x, top - 0.8, w, h + 0.4);
                if (c.solid) fill(GREEN, x, top - 0.8, w, h + 0.4);
                const tx0 = x + pad, tx1 = x + w - pad;
                const put = (s, yy) => c.right ? right(s, tx1, yy) : text(s, tx0, yy);
                set(6.5, bold || c.hl ? 'bold' : 'normal', c.solid ? WHITE : c.hl ? GREEN : GREY); put(c.k, top + 2.4);
                if (c.brk) {
                    set(8, 'normal', GREY); text('Share', tx0, top + 6.2); set(8, 'normal', INK); right(c.brk.share, tx1, top + 6.2);
                    set(8, 'normal', RED); text('− Expenses', tx0, top + 9.6); right(c.brk.items, tx1, top + 9.6);
                    rule(INK, tx0, top + 10.7, tx1, 0.25);
                    set(8, 'bold', c.neg ? RED : INK); text('Net', tx0, top + 13.8); right(c.brk.net, tx1, top + 13.8);
                } else {
                    const color = c.neg ? RED : c.solid ? WHITE : c.hl || c.green ? GREEN : INK;
                    set(8.5, bold || c.hl ? 'bold' : 'normal', color); put(c.v, top + 6.2);
                }
            });
            return top + h;
        }
        function heading(y) {
            set(14, 'bold', INK, 'times'); text('Results by project', MX, y + 5.5);
            set(7, 'normal', GREY); right('Amounts in PHP', MX + MW, y + 5.5);
            y += 7.5; rule(INK, MX, y, MX + MW, 0.6);
            return y;
        }
        function projBlock(r, y) {
            const flags = flagsOf(r).length ? flagsOf(r) : ['ready'];
            set(7, 'bold');
            const pills = flags.map(fl => ({ fl, word: statusWord(fl), w: W(statusWord(fl)) + 4 }));
            const pillsW = pills.reduce((a, q) => a + q.w + 1.5, 0);
            y += 5.2;
            let xr = MX + MW;
            pills.slice().reverse().forEach(q => {
                fill(TONES[q.fl][0], xr - q.w, y - 3.4, q.w, 4.3, 2.1);
                set(7, 'bold', TONES[q.fl][1]); text(q.word, xr - q.w + 2, y - 0.3);
                xr -= q.w + 1.5;
            });
            set(9.5, 'bold', INK);
            const name = wrap(d.title(r), MW - pillsW - 3);
            text(name, MX, y); y += (name.length - 1) * lh(9.5) + 3.6;
            set(7, 'normal', GREY);
            const sub = wrap(d.subline(r), MW - pillsW - 3);
            text(sub, MX, y); y += (sub.length - 1) * lh(7) + 2.6;
            y = cellsRow(rowCells(r), y) + 2.6;
            rule('#E5E5E5', MX, y, MX + MW, 0.25);
            return y;
        }
        function totalsBlock(y) {
            y = cellsRow(totalCells, y + 2.6, true) + 2.2;
            rule(INK, MX, y, MX + MW, 0.35); rule(INK, MX, y + 0.8, MX + MW, 0.35);
            return y + 0.8;
        }
        function reviewCard(r, y) {
            set(7.5, 'normal', GREY);
            const lines = wrap('Paid ' + peso(r.paidCents) + ' − costs ' + peso(r.costCents) + ' − estimated reserve ' + peso(r.reserve.cents) + REVIEW_NOTE, MW - 7);
            const h = 7.4 + lines.length * lh(7.5) + 1.6;
            if (!dry) { doc.setDrawColor('#E5E5E5'); doc.setLineWidth(0.25); doc.roundedRect(MX, y, MW, h, 1.6, 1.6, 'S'); }
            set(8.5, 'bold', INK); text(d.title(r), MX + 3.5, y + 4.6);
            set(8.5, 'normal', INK); right(peso(r.balanceCents) + ' estimated', MX + MW - 3.5, y + 4.6);
            set(7.5, 'normal', GREY); text(lines, MX + 3.5, y + 8.4);
            return y + h + 2;
        }
        function legendBlock(y) {
            set(7.5, 'bold');
            const rows = d.legendRows.map(([fl, s]) => [statusWord(fl), s, TONES[fl][1]]).concat([['Basis', BASIS, INK]]);
            const lw = Math.max(...rows.map(x => W(x[0]))) + 4;
            y += 4;
            rows.forEach(([k, s, color]) => {
                set(7.5, 'normal', '#3A3A3C');
                const lines = wrap(s, MW - lw);
                y += lh(7.5);
                text(lines, MX + lw, y);
                set(7.5, 'bold', color); text(k, MX, y);
                y += (lines.length - 1) * lh(7.5) + 0.6;
            });
            return y;
        }

        // ── page flow ──
        const panelH = measure(panel, TOP);                                    // the dry pass also records memo.card
        fill(GREEN, PX, TOP, PWID, panelH, 2.2);
        panel(TOP);
        let y = TOP, pages = 1;
        const fit = (h) => { if (y + h > BOTTOM) { pages++; if (!o.measureOnly) doc.addPage(); y = TOP; } };
        if (!d.hasRows) {
            set(10, 'normal', INK); text('No completed projects match these filters.', MX, y + 6);
        } else {
            y = heading(y);
            if (!m.rows.length) { set(9, 'normal', GREY); text('No counted projects.', MX, y + 6); y += 9; }
            m.rows.forEach(r => { fit(measure(yy => projBlock(r, yy), y)); y = projBlock(r, y); });
            if (m.rows.length) { fit(measure(totalsBlock, y)); y = totalsBlock(y); }
            if (m.review.length) {
                const head = (yy) => { set(11.5, 'bold', INK, 'times'); text('Not counted yet', MX, yy + 8); return yy + 11; };
                fit(measure(head, y) + measure(yy => reviewCard(m.review[0], yy), y));
                y = head(y);
                m.review.forEach(r => { fit(measure(yy => reviewCard(r, yy), y)); y = reviewCard(r, y); });
            }
            fit(measure(legendBlock, y)); y = legendBlock(y);
        }

        if (o.measureOnly) return { onePage: pages === 1 && TOP + panelH <= BOTTOM };

        // ── footer on every page ──
        for (let i = 1; i <= pages; i++) {
            doc.setPage(i);
            rule('#E5E5E5', ML, PH - 12, PW - MR, 0.2);
            set(6.5, 'normal', GREY);
            text("Profit Sharing · DAC's Building Design Services · As of " + d.when, ML, PH - 8);
            right(INTERNAL + (pages > 1 ? '   ·   Page ' + i + ' of ' + pages : ''), PW - MR, PH - 8);
        }
        return { onePage: pages === 1 };
    }

    async function init() {
        const root = document.getElementById('pmSharingRoot');
        if (!canSee()) { if (root) root.innerHTML = ''; return; }
        await load();
    }

    window.PMShareDash = { init, load, render, applyFilters, buildModel, labelFor, chipsFor, mainStatus, setFilter,
                           toggleDates, clearDates, _state: S, _setFetch: (fn) => { fetchFn = fn || defaultFetch; } };
    Object.assign(window.PMShareDash, { open, close, renderDetail, csvCell, toCsv, metaLines, print, downloadCsv, downloadPdf });
    window.initPMSharingDashboard = init;
})();
