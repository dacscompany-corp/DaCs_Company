/* ══════════════════════════════════════════════════════════
   PM → PROFIT SHARING dashboard (window.PMShareDash)
   Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md §7

   Completed projects only. Owner-role accounts only — staff get an empty
   view and nothing is fetched. Every figure comes from PMShare.project /
   PMShare.combine; cards, table, chart, print and CSV all read ONE model.
   Internal allocation — never a payout or an amount owed.
   ══════════════════════════════════════════════════════════ */
(function () {
    'use strict';
    const S = {
        seq: 0, loading: false, error: null, data: null, results: [], asOf: null, openId: null,
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
    const CHIP = { unpaid_balance: 'Unpaid client balance', shortfall: 'Shortfall',
                   reserve_review: 'Reserve needs review', changed_since_closeout: 'Changed since closeout' };
    function chipsFor(r) {
        const c = r.flags.map(f => CHIP[f]).filter(Boolean);
        return c.length ? c : ['Ready'];
    }
    function buildModel(results, filters) {
        const picked = applyFilters(results, filters);
        const c = window.PMShare.combine(picked);
        const partners = Array.from(new Set(results.map(r => r.partnerEmail).filter(Boolean))).sort();
        return { rows: c.confirmed, review: c.review, totals: c.totals, partners, all: results };
    }

    // ── render ─────────────────────────────────────────────────────────
    const P = () => window.PMShare;
    function card(label, value, sub, tone) {
        return '<div class="pms-card' + (tone ? ' pms-' + tone : '') + '"><div class="pms-card-l">' + esc(label) + '</div>'
             + '<div class="pms-card-v">' + esc(value) + '</div>' + (sub ? '<div class="pms-card-s">' + esc(sub) + '</div>' : '') + '</div>';
    }
    function filtersHtml(m) {
        const f = S.filters;
        return '<div class="pms-filters">'
            + '<input type="search" placeholder="Search project or client" value="' + esc(f.q) + '" oninput="PMShareDash.setFilter(\'q\', this.value)">'
            + '<select onchange="PMShareDash.setFilter(\'partner\', this.value)">'
            +   '<option value="all"' + (f.partner === 'all' ? ' selected' : '') + '>All partners</option>'
            +   '<option value="unassigned"' + (f.partner === 'unassigned' ? ' selected' : '') + '>Partner unassigned</option>'
            +   m.partners.map(p => '<option value="' + esc(p) + '"' + (f.partner === p ? ' selected' : '') + '>' + esc(p) + '</option>').join('')
            + '</select>'
            + '<label>From <input type="date" value="' + esc(f.from) + '" onchange="PMShareDash.setFilter(\'from\', this.value)"' + (f.undatedOnly ? ' disabled' : '') + '></label>'
            + '<label>To <input type="date" value="' + esc(f.to) + '" onchange="PMShareDash.setFilter(\'to\', this.value)"' + (f.undatedOnly ? ' disabled' : '') + '></label>'
            + '<label><input type="checkbox"' + (f.undatedOnly ? ' checked' : '') + ' onchange="PMShareDash.setFilter(\'undatedOnly\', this.checked)"> Undated only</label>'
            + '<button type="button" onclick="PMShareDash.print()">Print / PDF</button>'
            + '<button type="button" onclick="PMShareDash.downloadCsv()">CSV</button>'
            + '<button type="button" onclick="PMShareDash.load()">Refresh</button>'
            + '</div>';
    }
    function rowHtml(r, all, provisional) {
        const p = P();
        return '<tr data-pms-id="' + esc(r.id) + '" class="pms-row">'
            + '<td>' + esc(labelFor(r, all)) + '<div class="pms-sub">' + esc(r.clientName) + '</div></td>'
            + '<td>' + (r.partnerEmail ? esc(r.partnerEmail) : '<em>Partner unassigned</em>') + '</td>'
            + '<td>' + esc(r.completionKey || 'Undated') + '</td>'
            + '<td class="n">' + p.pesos(r.paidCents) + '</td>'
            + '<td class="n">' + p.pesos(r.costCents) + '</td>'
            + '<td class="n">' + p.pesos(r.remainingCents) + '</td>'
            + '<td class="n">' + p.pesos(r.reserve.cents) + (provisional ? ' <span class="pms-tag">Provisional</span>' : '') + '</td>'
            + '<td class="n' + (r.balanceCents < 0 ? ' pms-neg' : '') + '">' + p.pesos(r.balanceCents) + '</td>'
            + '<td class="n">' + p.fmtPct(r.ownerPct) + '% · ' + p.pesos(r.ownerCents) + '</td>'
            + '<td class="n">' + p.fmtPct(r.partnerPct) + '% · ' + p.pesos(r.partnerCents) + '</td>'
            + '<td class="n">' + p.pesos(r.outstandingCents) + '</td>'
            + '<td>' + chipsFor(r).map(c => '<span class="pms-chip">' + esc(c) + '</span>').join(' ') + '</td>'
            + '</tr>';
    }
    const HEAD = '<tr><th>Project / client</th><th>Partner</th><th>Completed</th><th>Collected</th><th>Costs</th>'
               + '<th>Remaining cash</th><th>Warranty reserve</th><th>Sharing balance</th><th>Your % / amount</th>'
               + '<th>Partner % / amount</th><th title="Client still owes: unpaid + partial requests">Client balance</th><th>Review</th></tr>';
    function chartHtml(rows) {
        if (!rows.length) return '';
        const max = Math.max(1, ...rows.map(r => Math.abs(r.balanceCents)));
        return '<div class="pms-chart" aria-label="Sharing balance per project">' + rows.map(r => {
            const w = Math.abs(r.balanceCents) / max * 50;
            const ow = r.balanceCents === 0 ? 0 : Math.abs(r.ownerCents) / Math.abs(r.balanceCents) * w;
            const bar = r.balanceCents >= 0
                ? '<div class="pms-bar" style="left:50%;width:' + w + '%"><span class="pms-own" style="width:' + (w ? ow / w * 100 : 0) + '%"></span></div>'
                : '<div class="pms-bar pms-short" style="left:' + (50 - w) + '%;width:' + w + '%"></div>';
            return '<div class="pms-chart-row"><div class="pms-chart-l">' + esc(labelFor(r, S.results)) + '</div>'
                 + '<div class="pms-chart-t"><div class="pms-axis"></div>' + bar + '</div>'
                 + '<div class="pms-chart-v">' + P().pesos(r.balanceCents) + '</div></div>';
        }).join('') + '<div class="pms-legend"><span class="pms-own-k"></span> Your part <span class="pms-par-k"></span> Partner part <span class="pms-short-k"></span> Shortfall</div></div>';
    }
    function bindRows(root) {
        if (root.__pmsBound) return;
        root.__pmsBound = true;
        root.addEventListener('click', function (ev) {
            const el = ev.target && ev.target.closest ? ev.target.closest('[data-pms-id]') : null;
            if (el && window.PMShareDash && typeof window.PMShareDash.open === 'function') {
                window.PMShareDash.open(el.getAttribute('data-pms-id'));
            }
        });
    }
    // Results only (cards, chart, tables): the filter bar is NOT rebuilt, so typing keeps focus.
    function renderResults() {
        const box = document.getElementById('pmSharingResults');
        if (!box) return;
        const m = buildModel(S.results, S.filters);
        const t = m.totals, p = P();
        const un = Number(S.data && S.data.unmappedCompleted) || 0;
        const notice = un > 0
            ? '<div class="pms-state pms-warn">' + un + ' completed project' + (un === 1 ? '' : 's')
              + ' not linked to a company — sharing locked (not shown).</div>'
            : '';
        if (!m.rows.length && !m.review.length) {
            box.innerHTML = notice + '<div class="pms-state">No completed projects match these filters.</div>';
            return;
        }
        box.innerHTML = notice + '<div class="pms-cards">'
            + card('Projects', t.count + ' confirmed · ' + t.reviewCount + ' with reserve needing review', '')
            + card('Client cash collected', p.pesos(t.paidCents), 'Lifetime eligible receipts')
            + card('Project costs', p.pesos(t.costCents), 'Lifetime, incl. billable site overhead')
            + card('Recorded warranty reserve', p.pesos(t.reserveCents), 'Frozen at closeout')
            + card('Available for sharing', p.pesos(t.availableCents), 'Projects with a positive balance')
            + card('Cash shortfall', p.pesos(t.shortfallCents), 'Projects with a negative balance', t.shortfallCents < 0 ? 'neg' : '')
            + card('Net sharing balance', p.pesos(t.netCents), 'Available + shortfall')
            + card('Your allocation', p.pesos(t.ownerCents), t.ownerShortfallCents ? 'Includes shortfall ' + p.pesos(t.ownerShortfallCents) : '')
            + card('Partner allocation', p.pesos(t.partnerCents), t.partnerShortfallCents ? 'Includes shortfall ' + p.pesos(t.partnerShortfallCents) : '')
            + card('Outstanding client balance', p.pesos(t.outstandingCents), 'Unpaid + partial requests')
            + '</div>'
            + '<div class="pms-caption">Internal allocation — not a payout or amount owed.</div>'
            + chartHtml(m.rows)
            + '<div class="pms-tablewrap"><table class="pms-table"><thead>' + HEAD + '</thead><tbody>'
            + m.rows.map(r => rowHtml(r, m.all, false)).join('')
            + '</tbody></table></div>'
            + (m.review.length
                ? '<h3 class="pms-review-h">Reserve needs review — not in the totals above</h3>'
                  + '<div class="pms-tablewrap"><table class="pms-table"><thead>' + HEAD + '</thead><tbody>'
                  + m.review.map(r => rowHtml(r, m.all, true)).join('') + '</tbody></table></div>'
                : '');
    }
    // Shell (header + filter bar + result/detail holders): only on load / error / initial render.
    function render() {
        const root = document.getElementById('pmSharingRoot');
        if (!root) return;
        bindRows(root);
        if (!canSee()) { root.innerHTML = ''; return; }
        if (S.loading && !S.data) { root.innerHTML = '<div class="pms-state">Loading Profit Sharing…</div>'; return; }
        if (S.error) {
            root.innerHTML = '<div class="pms-state pms-err">Could not load Profit Sharing: ' + esc(P().errorText(S.error))
                           + ' <button type="button" onclick="PMShareDash.load()">Retry</button></div>';
            return;
        }
        const m = buildModel(S.results, S.filters);
        const head = '<div class="pms-head"><h2>Profit Sharing</h2><div class="pms-note">Completed projects · '
                   + 'Internal allocation — not a payout or amount owed. As of ' + esc(S.asOf ? S.asOf.toLocaleString('en-PH') : '') + '</div></div>';
        root.innerHTML = head + filtersHtml(m) + '<div id="pmSharingResults"></div><div id="pmSharingDetail"></div>';
        renderResults();
        if (S.openId) renderDetail();
    }

    function setFilter(k, v) {
        S.filters[k] = v;
        if (k === 'q') renderResults(); else render();   // search keeps its input; others refresh the bar (disabled dates)
    }
    // ── details panel (read-only: no control here creates any record) ──
    function open(id) { S.openId = id; renderDetail(); }
    function close() { S.openId = null; const el = document.getElementById('pmSharingDetail'); if (el) el.innerHTML = ''; }
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
        const line = (k, v) => '<div class="pms-dl"><span>' + esc(k) + '</span><b>' + v + '</b></div>';
        el.innerHTML = '<div class="pms-detail"><div class="pms-detail-h"><h3>' + esc(labelFor(r, S.results)) + '</h3>'
            + '<button type="button" onclick="PMShareDash.close()">Close</button></div>'
            + '<div class="pms-note">Internal allocation — not a payout or amount owed.</div>'
            + '<h4>1. Collected</h4>' + line('Collected', p.pesos(r.paidCents))
            + pp.reqs.map(q => line((q.weekEndingDate || 'No date') + ' · ' + (q.status || ''),
                                    p.pesos(p.toCents(p.paid([q]))))).join('')
            + '<h4>2. Costs</h4>' + line('Labor', p.pesos(p.toCents(bd.labor))) + line('Pure materials', p.pesos(p.toCents(bd.materials)))
            + line('Supply & install', p.pesos(p.toCents(bd.combined))) + line('Site overhead', p.pesos(p.toCents(bd.overhead)))
            + line('Project costs', p.pesos(r.costCents))
            + '<h4>3. Remaining cash</h4>' + line('Collected − costs', p.pesos(r.remainingCents))
            + '<h4>4. Warranty reserve</h4>'
            + line(r.reserve.kind === 'recorded' ? 'Recorded at closeout' : 'Provisional · Reserve needs review', p.pesos(r.reserve.cents))
            + (rec ? line('Closeout basis', esc(rec.refNo || '') + ' · paid ' + p.pesos(p.toCents(rec.totalPaid)) + ' · cost ' + p.pesos(p.toCents(rec.directCost))) : '')
            + (r.reserve.changedSinceCloseout ? '<div class="pms-warn">Collections/costs changed since closeout.</div>' : '')
            + '<h4>5. Sharing</h4>' + line(r.balanceCents < 0 ? 'Shortfall' : 'Sharing balance', p.pesos(r.balanceCents))
            + line('You (' + p.fmtPct(r.ownerPct) + '%)', p.pesos(r.ownerCents))
            + line('Partner (' + p.fmtPct(r.partnerPct) + '%)', p.pesos(r.partnerCents))
            + '<h4>6. Client balance</h4>' + line('Outstanding', p.pesos(r.outstandingCents))
            + '<h4>7. Split history</h4>'
            + (hist.length ? hist.map(h => '<div class="pms-hist">' + esc(new Date(h.changed_at).toLocaleString('en-PH')) + ' · '
                  + esc(h.actor_email || '') + ' · partner ' + esc(p.fmtPct(h.old_pct)) + '% → ' + esc(p.fmtPct(h.new_pct)) + '% · '
                  + esc(h.reason) + '</div>').join('') : '<div class="pms-hist">No changes — the original setting.</div>')
            + '<h4>8. Partner acceptance</h4>' + facts.map(f => '<div class="pms-hist">' + esc(f) + '</div>').join('')
            + '</div>';
    }

    // ── print + CSV: built from the SAME model as the screen ───────────
    function metaLines() {
        const f = S.filters;
        const range = f.undatedOnly ? 'Undated only' : (f.from || f.to) ? (f.from || '…') + ' to ' + (f.to || '…') : 'All completion dates';
        const partner = f.partner === 'all' ? 'All partners' : f.partner === 'unassigned' ? 'Partner unassigned' : f.partner;
        return ['Profit Sharing — completed projects',
                'Internal allocation — not a payout or amount owed.',
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
            provisional ? 'Provisional — reserve needs review' : (r.reserve.kind === 'recorded' ? 'Recorded at closeout' : 'Estimate'),
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
                    peso(t.outstandingCents), t.reviewCount + ' with reserve needing review (not in totals)'].map(csvCell).join(','));
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
    function print() {
        if (!canSee() || !S.data) return;
        const m = buildModel(S.results, S.filters), t = m.totals, p = P();
        const meta = metaLines();
        const tr = (r, prov) => '<tr><td>' + esc(labelFor(r, m.all)) + '</td><td>' + esc(r.partnerEmail || 'Partner unassigned') + '</td><td>'
            + esc(r.completionKey || 'Undated') + '</td><td>' + p.pesos(r.paidCents) + '</td><td>' + p.pesos(r.costCents) + '</td><td>'
            + p.pesos(r.reserve.cents) + (prov ? ' (Provisional)' : '') + '</td><td>' + p.pesos(r.balanceCents) + '</td><td>'
            + p.fmtPct(r.ownerPct) + '% ' + p.pesos(r.ownerCents) + '</td><td>' + p.fmtPct(r.partnerPct) + '% ' + p.pesos(r.partnerCents)
            + '</td><td>' + esc(chipsFor(r).join(' · ')) + '</td></tr>';
        const th = '<tr><th>Project</th><th>Partner</th><th>Completed</th><th>Collected</th><th>Costs</th><th>Reserve</th>'
                 + '<th>Sharing balance</th><th>You</th><th>Partner</th><th>Review</th></tr>';
        const w = window.open('', '_blank', 'width=1100,height=800');
        if (!w) return;
        w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Profit Sharing</title><style>'
            + 'body{font:12px Helvetica,Arial,sans-serif;margin:24px;color:#1f2420}h1{font-size:20px;margin:0}'
            + 'table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #ddd;padding:5px;text-align:left}'
            + '.k{display:inline-block;margin:6px 14px 0 0}.k b{display:block;font-size:14px}</style></head><body>'
            + '<h1>Profit Sharing</h1><div>' + meta.map(l => esc(l.replace(',', ': '))).join('<br>') + '</div>'
            + '<div><span class="k">Projects<b>' + t.count + ' confirmed · ' + t.reviewCount + ' with reserve needing review</b></span>'
            + '<span class="k">Net sharing balance<b>' + p.pesos(t.netCents) + '</b></span>'
            + '<span class="k">Your allocation<b>' + p.pesos(t.ownerCents) + '</b></span>'
            + '<span class="k">Partner allocation<b>' + p.pesos(t.partnerCents) + '</b></span>'
            + '<span class="k">Cash shortfall<b>' + p.pesos(t.shortfallCents) + '</b></span></div>'
            + '<table><thead>' + th + '</thead><tbody>' + m.rows.map(r => tr(r, false)).join('') + '</tbody></table>'
            + (m.review.length ? '<h3>Reserve needs review — not in the totals above</h3><table><thead>' + th + '</thead><tbody>'
                + m.review.map(r => tr(r, true)).join('') + '</tbody></table>' : '')
            + '<script>window.onload=function(){window.print();}<\/script></body></html>');
        w.document.close();
    }

    async function init() {
        const root = document.getElementById('pmSharingRoot');
        if (!canSee()) { if (root) root.innerHTML = ''; return; }
        await load();
    }

    window.PMShareDash = { init, load, render, applyFilters, buildModel, labelFor, chipsFor, setFilter,
                           _state: S, _setFetch: (fn) => { fetchFn = fn || defaultFetch; } };
    Object.assign(window.PMShareDash, { open, close, renderDetail, csvCell, toCsv, metaLines, print, downloadCsv });
    window.initPMSharingDashboard = init;
})();
