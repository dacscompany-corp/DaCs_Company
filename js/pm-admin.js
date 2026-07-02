/* ══════════════════════════════════════════════════════════
   Project Management — Admin Module
   Handles: Weekly Summary, Procurement List, Revolving Fund, Payment
══════════════════════════════════════════════════════════ */

'use strict';

// ── State ────────────────────────────────────────────────
let _pmCurrentView    = null;
let _pmProjects       = [];   // { id, clientName, projectName, ... }
let _pmActiveProject  = null;
let _pmWeeklyEntries  = [];
let _pmProcItems      = [];
let _pmMilestones     = [];
let _pmReports        = [];
let _pmFundRequests   = [];       // weekly fund-to-collect-from-partner entries
let _pmFundBills      = [];       // weeklyBills, for the per-week fund-vs-spent compare
let _pmPayRequests    = [];
let _pmCompanyBuyItemData = null;
let _pmCompanyReceiptFile = null;
let _pmTermsPdfFile   = null;     // newly-picked Terms & Conditions PDF (pending upload)
let _pmTermsPdfUrl    = '';       // existing Terms PDF url when editing (kept if not replaced)
let _pmTermsPdfName   = '';       // existing Terms PDF display name when editing
let _pmProcFilter     = 'all';   // materials status filter: all | pending | bought
let _pmOvBills        = [];       // weekly bills for the active project (overview date filter)
let _pmOvReqs         = [];       // payment requests for the active project (overview date filter)
let _pmOvContractVal  = 0;        // contract value (range-independent) for the KPI refresh
let _pmOvProgressVal  = 0;        // milestone progress % (range-independent) for the KPI refresh
// ── This-week inline bill builder ──
let _pmWeekBills      = [];       // all weeklyBills docs for the active project
let _pmWeekEntries    = [];       // current draft line entries {id,type,details,amount}
let _pmWeekDate       = null;     // selected Friday (YYYY-MM-DD)
let _pmWeekEditingId  = null;     // doc id when the selected week already has a saved bill
let _pmWeekCat        = 'labor';  // active category tab: 'labor' | 'materials' | 'both'
let _pmWeekStagedReceipts = [];  // [{ file, dataUrl, url }] staged in the add-row, attached to the next line
let _pmWeekEditEntryId   = null;  // id of the entry currently loaded into the add-row for editing
let _pmWeekViewFilter    = 'all'; // entry list view filter: 'all' | 'labor' | 'materials'
let _pmWeekViewDay       = null;  // null = editable builder; a bill id = read-only past view

// ── Init ────────────────────────────────────────────────
window.initPMModule = async function(view) {
    _pmCurrentView = view;
    await _pmLoadProjects();
    if (!_pmActiveProject) {
        const savedId = localStorage.getItem('pm_selected_project');
        if (savedId) {
            const found = _pmProjects.find(p => p.id === savedId);
            if (found) _pmActiveProject = found;
        }
    }
    _pmRenderCurrentView();
};

async function _pmLoadProjects() {
    if (_pmProjects.length) return; // already loaded
    if (typeof db === 'undefined') return;
    try {
        const snap = await db.collection('constructionProjects').orderBy('clientName').get();
        _pmProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.warn('PM: load projects', e.message);
    }
}

function _pmRenderCurrentView() {
    switch(_pmCurrentView) {
        case 'pmProjects':   _pmLoadProjectsList(); break;
        case 'pmWorkspace':  _pmInitWorkspace();    break;
    }
}

// ── Workspace init ────────────────────────────────────
function _pmInitWorkspace() {
    if (!_pmActiveProject) { switchView('pmProjects'); return; }
    const p = _pmActiveProject;
    _pmSet('ws-client-name', p.clientName || '—');
    _pmSet('ws-project-name', p.projectName || '');
    const statusBadge = { pending_agreement:'pm-badge-pending', ready:'pm-badge-client', active:'pm-badge-paid', 'on-hold':'pm-badge-partial', completed:'pm-badge-client', terminated:'pm-badge-terminated' };
    const statusLabel = { pending_agreement:'Pending Agreement', ready:'Ready to Start', active:'Active', 'on-hold':'On Hold', completed:'Completed', terminated:'Terminated' };
    const el = document.getElementById('ws-status-badge');
    if (el) el.innerHTML = `<span class="pm-badge ${statusBadge[p.status]||'pm-badge-paid'}">${statusLabel[p.status]||'Active'}</span>`;
    // Reflect this project's nightly-notification state on the bell toggle.
    if (window.pmPushRefreshBell) pmPushRefreshBell(p.id, p.clientName || p.projectName || 'this project');
    // Load the active tab's data
    const activePanel = document.querySelector('.pm-ws-panel.active');
    if (activePanel) _pmLoadWsPanel(activePanel.id);
    if (window.lucide) lucide.createIcons();
}

window.pmWsTab = function(tab, btn) {
    // Sync the active highlight on BOTH the desktop top tabs and the mobile bottom nav.
    document.querySelectorAll('.pm-ws-tab, .pm-mnav-item').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pm-ws-panel').forEach(p => p.classList.remove('active'));
    const top = document.getElementById('pm-ws-tab-' + tab);
    const mnav = document.getElementById('pm-mnav-' + tab);
    if (top) top.classList.add('active');
    if (mnav) mnav.classList.add('active');
    const panel = document.getElementById('ws-panel-' + tab);
    if (panel) { panel.classList.add('active'); _pmLoadWsPanel(panel.id); }
    // On mobile, jump back to the top of the panel when switching tabs.
    if (window.innerWidth <= 700) window.scrollTo({ top: 0, behavior: 'auto' });
};

// The redesigned workspace groups the six functional areas under five tabs.
function _pmLoadWsPanel(panelId) {
    switch(panelId) {
        case 'ws-panel-overview':  _pmLoadOverview();                    break;
        case 'ws-panel-week':      _pmLoadWeekBuilder();                  break;
        case 'ws-panel-contracts': _pmLoadContractsTab();                 break;
        case 'ws-panel-materials': _pmLoadProcItems();                    break;
        case 'ws-panel-progress':  _pmLoadMilestones(); _pmLoadReports(); break;
        case 'ws-panel-money':     _pmLoadPayments();   _pmLoadRevolving(); break;
    }
}


// ══════════════════════════════════════════════════════════
// 0a. OVERVIEW — per-project dashboard (default workspace tab)
//   Lively redesign (from the PM Workspace design): gradient hero
//   with a progress ring, 5 KPI tiles, a CSS bar chart + donut,
//   and pill-badged milestone / payment-request lists. Rendered
//   as one self-contained HTML string into #pm-ov-root.
// ══════════════════════════════════════════════════════════

const _PM_OV_PILLS = {
    green:   { bg: '#eaf4ef', color: '#0f6342', border: '#c6e6d5', dot: '#157a52' },
    yellow:  { bg: '#fbf3e2', color: '#8a6310', border: '#f0e2c5', dot: '#c79024' },
    red:     { bg: '#f8ecea', color: '#8f352c', border: '#f0cdc8', dot: '#b4453a' },
    neutral: { bg: '#f3f2ef', color: '#6f6e69', border: '#e2e1dc', dot: '#b3b1a8' },
};
function _pmOvPill(tone, label) {
    const p = _PM_OV_PILLS[tone] || _PM_OV_PILLS.neutral;
    return `<span style="display:inline-flex;align-items:center;gap:6px;font:700 10px 'IBM Plex Sans';padding:4px 11px;border-radius:99px;background:${p.bg};color:${p.color};border:1px solid ${p.border};"><span style="width:6px;height:6px;border-radius:50%;background:${p.dot};"></span>${label}</span>`;
}
// Compact peso (₱1.2M / ₱94k / ₱500) for chart labels & subtitles.
function _pmOvShort(n) {
    n = Number(n) || 0; const sign = n < 0 ? '-' : ''; n = Math.abs(n);
    if (n >= 1000000) return sign + '₱' + (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M';
    if (n >= 1000)    return sign + '₱' + Math.round(n / 1000) + 'k';
    return sign + '₱' + Math.round(n);
}

async function _pmLoadOverview() {
    if (!_pmActiveProject) { switchView('pmProjects'); return; }
    const root = document.getElementById('pm-ov-root');
    if (!root || typeof db === 'undefined') return;
    const pid = _pmActiveProject.id;
    try {
        const base = db.collection('constructionProjects').doc(pid);
        const [msSnap, billsSnap, paySnap] = await Promise.all([
            base.collection('milestones').get(),
            base.collection('weeklyBills').get(),
            db.collection('paymentRequests').where('constructionProjectId', '==', pid).get(),
        ]);
        const ms    = msSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const bills = billsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const reqs  = paySnap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmOvBills = bills;
        _pmOvReqs  = reqs;
        _pmOvContractVal = Number(_pmActiveProject.budget) || 0;
        _pmOvProgressVal = _pmOvProgress(ms);
        root.innerHTML = _pmOvHtml(_pmActiveProject, ms, bills, reqs);
    } catch(e) {
        console.warn('PM: overview load failed', e.message);
        root.innerHTML = `<div class="pm-empty-row" style="color:#9b9a94;padding:40px 0;text-align:center;">Could not load overview: ${_esc(e.message)}</div>`;
    }
    if (window.lucide) lucide.createIcons();
}

// Progress % — weighted by completed milestone `percentage`, else completed/total.
function _pmOvProgress(ms) {
    if (!ms.length) return 0;
    const hasPct = ms.some(x => x.percentage != null && x.percentage !== '' && !isNaN(x.percentage));
    let pct;
    if (hasPct) pct = ms.filter(x => x.status === 'completed').reduce((s, x) => s + (Number(x.percentage) || 0), 0);
    else        pct = Math.round(ms.filter(x => x.status === 'completed').length / ms.length * 100);
    return Math.max(0, Math.min(100, Math.round(pct)));
}
function _pmOvOutstanding(reqs) {
    return reqs.filter(r => r.status === 'unpaid' || r.status === 'partial')
        .reduce((s, r) => s + ((r.totalAmount || 0) - (r.amountPaid || 0)), 0);
}
function _pmOvPaid(reqs) {
    return reqs.reduce((s, r) => {
        if (r.status === 'verified') return s + (r.amountPaid || r.paidAmount || r.totalAmount || 0);
        return s + (r.amountPaid || 0);
    }, 0);
}

function _pmOvHtml(p, ms, bills, reqs) {
    // ── metrics ──
    const progress    = _pmOvProgress(ms);
    const outstanding = _pmOvOutstanding(reqs);
    const paid        = _pmOvPaid(reqs);
    const payTotal    = paid + outstanding;
    const paidPct     = payTotal > 0 ? Math.round(paid / payTotal * 100) : 0;

    // Payment-status donut uses the contract basis: Outstanding = Project Budget
    // (contract value) − Total cash receipt. Clamp at 0 so an over-collection
    // doesn't render a negative slice.
    const donutContract    = Number(_pmActiveProject?.budget) || 0;
    const donutOutstanding = Math.max(0, donutContract - paid);
    const donutTotal       = donutContract > 0 ? donutContract : paid;
    const donutPaidPct     = donutTotal > 0 ? Math.round(paid / donutTotal * 100) : 0;

    const open = reqs.filter(r => r.status === 'unpaid' || r.status === 'partial');
    const next = open.slice().sort((a, b) => (a.weekEndingDate || '').localeCompare(b.weekEndingDate || ''))[0];
    const today = new Date().toISOString().slice(0, 10);
    let cadence = 'ontrack';
    if (reqs.some(r => r.status === 'partial')) cadence = 'partial';
    else if (open.some(r => r.status === 'unpaid' && r.weekEndingDate && r.weekEndingDate < today)) cadence = 'overdue';
    const cadenceLabel = { ontrack: 'On track', partial: 'Partial last week', overdue: 'Overdue' }[cadence];

    // Direct cost = cumulative labor + materials across all weekly bills
    // (the grand total before the management fee). Falls back to
    // grandTotal − managementFee for older bills missing the split.
    // Treat 0 as "missing" too: a `default 0` column or the legacy weekly-entry
    // modal can leave directCostTotal at 0 on bills that really have labor/materials.
    const directCost = bills.reduce((s, b) => {
        const dct = Number(b.directCostTotal) || 0;
        if (dct) return s + dct;
        const lm = (Number(b.labor) || 0) + (Number(b.materials) || 0);
        if (lm) return s + lm;
        return s + ((Number(b.grandTotal) || 0) - (Number(b.managementFee) || 0));
    }, 0);
    const feeTotal = bills.reduce((s, b) => s + (b.managementFee || 0), 0);

    // Direct-cost breakdown. The stored `materials` field is client-facing and
    // already includes any 'Materials & Labor' (supply & install) amount, so the
    // pure materials figure subtracts the separately-tracked `combined` bucket.
    const bd = _pmOvBreakdown(bills);

    // Net cash = what the client has paid minus what's actually been spent
    // on labor + materials (direct cost). Positive = cash buffer in hand;
    // negative = costs have outrun collections (real exposure).
    const netCash  = paid - directCost;
    const netColor = netCash >= 0 ? '#0f6342' : '#8f352c';
    const netSub   = netCash >= 0 ? 'paid over direct cost' : 'over by ' + _pmOvShort(-netCash);

    const initial = (p.clientName || p.projectName || '?').trim().charAt(0).toUpperCase() || '?';
    const subBits = [p.projectName, (p.budget ? _pmOvShort(p.budget) + ' contract' : '')].filter(Boolean);

    // ── hero ──
    const hero = `
    <div style="position:relative;border-radius:18px;background:linear-gradient(120deg,#0f5d3d 0%,#157a52 48%,#1f9d63 100%);padding:22px 26px;margin-bottom:16px;overflow:hidden;box-shadow:0 12px 30px rgba(21,122,82,0.24);">
      <div style="position:absolute;top:-40px;right:-30px;width:200px;height:200px;border-radius:50%;background:rgba(255,255,255,0.07);"></div>
      <div style="position:absolute;bottom:-60px;right:90px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,0.05);"></div>
      <div style="position:relative;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:16px;">
          <div style="width:54px;height:54px;border-radius:15px;flex:none;background:rgba(255,255,255,0.16);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,0.3);display:flex;align-items:center;justify-content:center;font:700 22px 'IBM Plex Sans';color:#fff;">${_esc(initial)}</div>
          <div>
            <div style="font:700 21px 'IBM Plex Sans';color:#fff;line-height:1.1;">${_esc(p.clientName || p.projectName || 'Project')}</div>
            <div style="font:400 12.5px 'IBM Plex Sans';color:rgba(255,255,255,0.85);margin-top:3px;">${_esc(subBits.join(' · ') || '—')}</div>
            <div style="display:inline-flex;align-items:center;gap:6px;margin-top:9px;font:700 10.5px 'IBM Plex Sans';padding:4px 11px;border-radius:99px;background:rgba(255,255,255,0.18);color:#fff;"><span style="width:6px;height:6px;border-radius:50%;background:#aef0cd;"></span>${cadenceLabel}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:24px;">
          <div style="text-align:right;">
            <div style="font:600 10px 'IBM Plex Sans';color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:.06em;">Total cash receipt</div>
            <div class="num" style="font:700 19px 'IBM Plex Sans';color:#fff;margin-top:3px;">${_fmt(paid)}</div>
          </div>
          <div style="width:1px;height:46px;background:rgba(255,255,255,0.22);"></div>
          <div style="position:relative;width:84px;height:84px;flex:none;">
            <div style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(#fff 0% ${progress}%, rgba(255,255,255,0.22) ${progress}% 100%);"></div>
            <div style="position:absolute;inset:9px;border-radius:50%;background:#157a52;display:flex;flex-direction:column;align-items:center;justify-content:center;">
              <span class="num" style="font:700 20px 'IBM Plex Sans';color:#fff;line-height:1;">${progress}%</span>
              <span style="font:500 8px 'IBM Plex Sans';color:rgba(255,255,255,0.8);text-transform:uppercase;letter-spacing:.06em;margin-top:2px;">complete</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    // ── KPI tiles ──
    const tile = (border, bg, label, valColor, val, sub, bar) => `
      <div style="border:1px solid ${border};border-radius:14px;padding:16px 18px;background:${bg};min-width:0;">
        <div style="font:600 10.5px 'IBM Plex Sans';color:#7c7b75;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</div>
        <div class="num" style="font:700 20px 'IBM Plex Sans';margin-top:8px;color:${valColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${val}</div>
        ${bar != null
            ? `<div style="height:6px;background:#d8ebe0;border-radius:99px;overflow:hidden;margin-top:10px;"><div style="height:100%;border-radius:99px;width:${bar}%;background:#1f8a5b;"></div></div>`
            : `<div style="font:400 11px 'IBM Plex Sans';color:#8a8983;margin-top:3px;">${sub}</div>`}
      </div>`;
    const nextDueDate = next?.weekEndingDate
        ? new Date(next.weekEndingDate + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'None scheduled';
    const nextDueSub = next ? _pmOvShort(next.totalAmount || next.amount || 0) + ' due' : 'all settled';
    const tiles = `
    <div class="pm-ov-kpis" style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px;">
      ${tile('#c6e6d5', '#eaf4ef', 'Progress', '#0f6342', progress + '%', '', progress)}
      ${tile('#d6dde4', '#eef0f3', 'Direct cost', '#44525f', _fmt(directCost), (feeTotal > 0 ? _pmOvShort(feeTotal) + ' fee on top' : 'labor + materials'), null)}
      ${tile('#f0cdc8', '#f8ecea', 'Outstanding balance', '#8f352c', _fmt(outstanding), 'client still owes', null)}
      ${tile('#c6e6d5', '#eaf4ef', 'Total cash receipt', '#0f6342', _fmt(paid), 'collected to date', null)}
      ${tile('#f0e2c5', '#fbf3e2', 'Remaining cash receipt', netColor, _fmt(netCash), netSub, null)}
      <div style="border:1px solid #d6e0f4;border-radius:14px;padding:16px 18px;background:#eef2fb;min-width:0;">
        <div style="font:600 10.5px 'IBM Plex Sans';color:#7c7b75;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Next payment due</div>
        <div style="font:700 16px 'IBM Plex Sans';margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(nextDueDate)}</div>
        <div style="font:400 11px 'IBM Plex Sans';color:#8a8983;margin-top:3px;">${nextDueSub}</div>
      </div>
    </div>`;

    // ── charts: weekly billing trend (bars) + payment-status donut ──
    const weeks = bills.filter(b => b.weekEndingDate)
        .sort((a, b) => a.weekEndingDate.localeCompare(b.weekEndingDate))
        .slice(-8);
    const maxAmt = Math.max(1, ...weeks.map(w => w.grandTotal || 0));
    const bars = weeks.length
        ? weeks.map(w => {
            const amt = w.grandTotal || 0;
            const h = Math.max(6, Math.round(amt / maxAmt * 118));
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;height:100%;justify-content:flex-end;">
              <span class="num" style="font:600 9.5px 'IBM Plex Sans';color:#9b9a94;">${_pmOvShort(amt)}</span>
              <div title="${_fmt(amt)}" style="width:100%;max-width:30px;height:${h}px;border-radius:6px 6px 0 0;background:#157a52;"></div>
              <span style="font:500 10px 'IBM Plex Sans';color:#9b9a94;">${_esc(_pmShortDate(w.weekEndingDate))}</span>
            </div>`;
          }).join('')
        : '<div style="flex:1;text-align:center;align-self:center;font:400 12px \'IBM Plex Sans\';color:#a8a79f;">No weekly bills yet.</div>';

    const donutBg = donutTotal > 0
        ? `conic-gradient(#157a52 0% ${donutPaidPct}%, #b4453a ${donutPaidPct}% 100%)`
        : '#eeede9';
    const charts = `
    <div class="pm-ov-charts" style="display:flex;gap:16px;flex-wrap:wrap;align-items:stretch;margin-bottom:16px;">
      <div style="flex:1.6;min-width:360px;border:1px solid #e7e6e2;border-radius:16px;background:#fff;padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
          <div style="font:600 14px 'IBM Plex Sans';">Weekly billing trend</div>
          <span style="font:400 11.5px 'IBM Plex Sans';color:#9b9a94;">Grand total per week</span>
        </div>
        <div style="font:400 11.5px 'IBM Plex Sans';color:#9b9a94;margin-bottom:18px;">Last ${weeks.length} billing period${weeks.length === 1 ? '' : 's'}</div>
        <div style="display:flex;align-items:flex-end;gap:10px;height:140px;padding-bottom:2px;">${bars}</div>
      </div>
      <div style="flex:1;min-width:260px;border:1px solid #e7e6e2;border-radius:16px;background:#fff;padding:18px 20px;">
        <div style="font:600 14px 'IBM Plex Sans';margin-bottom:2px;">Payment status</div>
        <div style="font:400 11.5px 'IBM Plex Sans';color:#9b9a94;margin-bottom:14px;">Paid vs outstanding</div>
        <div style="display:flex;align-items:center;gap:18px;">
          <div style="position:relative;width:118px;height:118px;flex:none;">
            <div style="position:absolute;inset:0;border-radius:50%;background:${donutBg};"></div>
            <div style="position:absolute;inset:17px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;">
              <span class="num" style="font:700 19px 'IBM Plex Sans';color:#0f6342;">${donutPaidPct}%</span>
              <span style="font:500 9px 'IBM Plex Sans';color:#9b9a94;text-transform:uppercase;letter-spacing:.04em;">paid</span>
            </div>
          </div>
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px;">
              <span style="width:11px;height:11px;border-radius:3px;background:#157a52;flex:none;"></span>
              <div style="flex:1;"><div style="font:500 11.5px 'IBM Plex Sans';color:#3a3a36;">Paid</div><div class="num" style="font:700 13px 'IBM Plex Sans';color:#1c1c1a;">${_fmt(paid)}</div></div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="width:11px;height:11px;border-radius:3px;background:#b4453a;flex:none;"></span>
              <div style="flex:1;"><div style="font:500 11.5px 'IBM Plex Sans';color:#3a3a36;">Outstanding</div><div class="num" style="font:700 13px 'IBM Plex Sans';color:#1c1c1a;">${_fmt(donutOutstanding)}</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

    // ── milestones + recent requests ──
    const msTone = { completed: 'green', 'in-progress': 'yellow', pending: 'neutral' };
    const msLabel = { completed: 'Done', 'in-progress': 'In progress', pending: 'Pending' };
    const msRows = ms.length
        ? ms.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, 5).map(m => `
          <div style="display:flex;align-items:center;gap:12px;padding:13px 20px;border-bottom:1px solid #f3f2ef;">
            <div style="flex:1;min-width:0;">
              <div style="font:600 12.5px 'IBM Plex Sans';color:#1c1c1a;">${_esc(m.name || 'Milestone')}</div>
              <div style="font:400 11px 'IBM Plex Sans';color:#9b9a94;margin-top:1px;">${(m.percentage != null && m.percentage !== '') ? _esc(m.percentage) + '% weight' : '—'}</div>
            </div>
            ${_pmOvPill(msTone[m.status] || 'neutral', msLabel[m.status] || _esc(m.status || '—'))}
          </div>`).join('')
        : '<div style="padding:24px 20px;text-align:center;font:400 12px \'IBM Plex Sans\';color:#a8a79f;">No milestones yet.</div>';

    const reqTone = { paid: 'green', verified: 'green', partial: 'red', unpaid: 'yellow', submitted: 'yellow', rejected: 'red' };
    const reqLabel = { paid: 'Paid', verified: 'Paid', partial: 'Partial', unpaid: 'Unpaid', submitted: 'Pending', rejected: 'Rejected' };
    const reqSorted = reqs.slice().sort((a, b) => (b.weekEndingDate || '').localeCompare(a.weekEndingDate || '')).slice(0, 5);
    const reqRows = reqSorted.length
        ? reqSorted.map(r => `
          <div style="display:flex;align-items:center;gap:12px;padding:13px 20px;border-bottom:1px solid #f3f2ef;">
            <div style="flex:1;min-width:0;">
              <div style="font:600 12.5px 'IBM Plex Sans';color:#1c1c1a;">Week of ${_esc(r.weekEndingDate ? _pmShortDate(r.weekEndingDate) : '—')}</div>
              <div class="num" style="font:400 11px 'IBM Plex Sans';color:#9b9a94;margin-top:1px;">${_fmt(r.totalAmount || ((r.amount || 0) + (r.carryover || 0)))}</div>
            </div>
            ${_pmOvPill(reqTone[r.status] || 'neutral', reqLabel[r.status] || _esc(r.status || '—'))}
          </div>`).join('')
        : '<div style="padding:24px 20px;text-align:center;font:400 12px \'IBM Plex Sans\';color:#a8a79f;">No payment requests yet.</div>';

    const vall = (tab, tabBtnId) => `<button onclick="pmWsTab('${tab}', document.getElementById('${tabBtnId}'))" class="pm-ov-vall" style="background:#fff;border:1px solid #e2e1dc;border-radius:8px;padding:6px 12px;font:600 11.5px 'IBM Plex Sans';color:#5b5a55;cursor:pointer;">View all</button>`;
    const lists = `
    <div class="pm-ov-lists" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
      <div style="flex:1;min-width:320px;border:1px solid #e7e6e2;border-radius:16px;background:#fff;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:17px 20px 13px;">
          <div style="font:600 14px 'IBM Plex Sans';">Milestones</div>${vall('progress', 'pm-ws-tab-progress')}
        </div>
        <div style="border-top:1px solid #f0efec;">${msRows}</div>
      </div>
      <div style="flex:1;min-width:320px;border:1px solid #e7e6e2;border-radius:16px;background:#fff;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:17px 20px 13px;">
          <div style="font:600 14px 'IBM Plex Sans';">Recent payment requests</div>${vall('money', 'pm-ws-tab-money')}
        </div>
        <div style="border-top:1px solid #f0efec;">${reqRows}</div>
      </div>
    </div>`;

    // ── direct-cost breakdown (segmented bar + legend boxes) + date filter ──
    const selStyle  = "font:600 11.5px 'IBM Plex Sans';color:#3a3a36;border:1px solid #d8ded8;border-radius:8px;padding:6px 10px;background:#fff;cursor:pointer;";
    const _ovWeeks = bills.filter(b => b.weekEndingDate)
        .slice().sort((a, b) => b.weekEndingDate.localeCompare(a.weekEndingDate));
    const _ovWeekOpts = _ovWeeks.map(b =>
        `<option value="${_esc(b.weekEndingDate)}">Week ending ${_esc(_pmOvWeekLabel(b.weekEndingDate))}</option>`).join('');
    const legendBox = (label, swatch, amtColor, bg, border, subColor, amtId, pctId, val, pct) => `
      <div class="pm-bd-box" style="flex:1;min-width:200px;display:flex;align-items:center;gap:13px;padding:14px 16px;background:${bg};border:1px solid ${border};border-radius:13px;">
        <span style="width:11px;height:11px;border-radius:3px;background:${swatch};flex:none;"></span>
        <div style="flex:1;min-width:0;">
          <div style="font:600 12.5px 'IBM Plex Sans';color:#1c1c1a;">${label}</div>
          <div style="font:400 10.5px 'IBM Plex Sans';color:${subColor};margin-top:1px;"><span id="${pctId}">${pct}</span>% of direct cost</div>
        </div>
        <div style="text-align:right;">
          <div class="num" id="${amtId}" style="font:700 16px 'IBM Plex Sans';color:${amtColor};line-height:1;white-space:nowrap;">${_fmt(val)}</div>
        </div>
      </div>`;
    const breakdown = `
    <div class="pm-bd-card" style="border:1px solid #e7e6e2;border-radius:16px;background:#fff;padding:20px 22px;margin-bottom:16px;">
      <div class="pm-bd-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;">
        <div>
          <div style="font:600 14.5px 'IBM Plex Sans';">Direct cost breakdown</div>
          <div id="pm-ov-range-note" style="font:400 11.5px 'IBM Plex Sans';color:#9b9a94;margin-top:2px;">All time · ${bills.length} week${bills.length === 1 ? '' : 's'} · management fee excluded</div>
        </div>
        <div class="pm-bd-head-right" style="display:flex;flex-direction:column;align-items:flex-end;gap:11px;">
          <div style="display:flex;align-items:baseline;gap:7px;">
            <span class="num" id="pm-ov-direct" style="font:700 21px 'IBM Plex Sans';color:#1c1c1a;line-height:1;white-space:nowrap;">${_fmt(bd.direct)}</span>
            <span style="font:600 11px 'IBM Plex Sans';color:#9b9a94;">total</span>
          </div>
          <select id="pm-ov-range" onchange="pmOvApplyRange()" style="${selStyle}">
            <option value="all">All time</option>
            <option value="month">This month</option>
            <option value="latest">This week</option>
            <option value="last4">Last 4 weeks</option>
            ${_ovWeeks.length ? '<option disabled>──────────</option>' + _ovWeekOpts : ''}
          </select>
        </div>
      </div>

      <!-- segmented proportion bar -->
      <div style="display:flex;height:16px;gap:3px;margin-bottom:16px;">
        <div id="pm-ov-seg-labor"     style="width:${bd.laborPct}%;background:#157a52;border-radius:99px;${bd.labor    > 0 ? 'min-width:6px;' : ''}transition:width .25s ease;"></div>
        <div id="pm-ov-seg-materials" style="width:${bd.matPct}%;background:#c79024;border-radius:99px;${bd.materials > 0 ? 'min-width:6px;' : ''}transition:width .25s ease;"></div>
        <div id="pm-ov-seg-combined"  style="width:${bd.combinedPct}%;background:#8b6fc4;border-radius:99px;${bd.combined > 0 ? 'min-width:6px;' : ''}transition:width .25s ease;"></div>
      </div>

      <!-- legend stat boxes -->
      <div class="pm-bd-legend" style="display:flex;gap:13px;flex-wrap:wrap;">
        ${legendBox('Labor',             '#157a52', '#0f6342', '#f3faf6', '#d8ebe0', '#7c9d8b', 'pm-ov-labor',     'pm-ov-labor-pct',     bd.labor,     bd.laborPct)}
        ${legendBox('Materials',         '#c79024', '#8a6310', '#fdf8ec', '#f0e2c5', '#a98f5f', 'pm-ov-materials', 'pm-ov-materials-pct', bd.materials, bd.matPct)}
        ${legendBox('Out Source', '#8b6fc4', '#6b4ea8', '#f5f2fc', '#ddd5ef', '#9a86c4', 'pm-ov-combined',  'pm-ov-combined-pct',  bd.combined,  bd.combinedPct)}
      </div>
    </div>`;

    // ════════════════════════════════════════════════════════════
    // Redesigned Overview layout (desktop design · brand green)
    // 5 KPI tiles → breakdown bars + payment donut → billing trend + next-due card.
    // Reuses the existing data + the #pm-ov-* IDs so pmOvApplyRange keeps working.
    // ════════════════════════════════════════════════════════════
    // Custom date-range dropdown (native <select> can't style its option list).
    const _ddChevron = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const _ddFixed = [['all', 'All time'], ['month', 'This month'], ['latest', 'This week'], ['last4', 'Last 4 weeks']]
        .map(([v, l], i) => `<button class="pmw-dd-opt${i === 0 ? ' active' : ''}" onclick="pmOvPickRange(this,'${v}','${l}')"><span>${l}</span><span class="pmw-dd-check">✓</span></button>`).join('');
    // Per-week rows: each calendar week (Sun–Sat) present in the bills, so a whole
    // week of the month can be viewed at once. Mode is "wk:<sunday>".
    const _ddWeekGroups = _pmOvWeekGroups().map(ws => {
        const l = _pmWeekRangeLabel(ws);
        return `<button class="pmw-dd-opt" onclick="pmOvPickRange(this,'wk:${_esc(ws)}','${_esc(l)}')"><span>${_esc(_pmWeekOfMonthLabel(ws))}</span><span class="num">${_esc(l)}</span></button>`;
    }).join('');
    const ovHeader = `
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:16px;">
      <div>
        <div style="font:800 23px 'IBM Plex Sans';letter-spacing:-.02em;color:#1c1c1a;">Overview</div>
        <div style="font:400 13px 'IBM Plex Sans';color:#8a8983;margin-top:3px;">Cost-Plus contract · ${_pmFeePct()}% management fee</div>
      </div>
      <div class="pmw-dd" id="pm-ov-dd">
        <button class="pmw-dd-btn" onclick="pmOvToggleRange(event)"><span id="pm-ov-dd-label">All time</span>${_ddChevron}</button>
        <div class="pmw-dd-menu" id="pm-ov-dd-menu" style="display:none;">
          ${_ddFixed}
          ${_ddWeekGroups ? '<div class="pmw-dd-sep"></div>' + _ddWeekGroups : ''}
        </div>
        <input type="hidden" id="pm-ov-range" value="all">
      </div>
    </div>`;

    // New design layout, but the ORIGINAL tinted KPI colors (bg / border / value).
    // `valId` lets pmOvApplyRange() update the value when the date range changes.
    const kpi = (label, val, valColor, bg, border, valId) => `
      <div style="flex:1;min-width:150px;background:${bg};border:1px solid ${border};border-radius:16px;padding:15px 17px;">
        <div style="font:600 11.5px 'IBM Plex Sans';color:#7c7b75;">${label}</div>
        <div class="num"${valId ? ` id="${valId}"` : ''} style="font:700 22px 'IBM Plex Sans';color:${valColor};margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${val}</div>
      </div>`;
    // Contract value (confidential) lives on the construction-project doc itself.
    const contractValue = Number(p.budget) || 0;
    const ovTiles = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
      ${kpi('Project Budget', contractValue > 0 ? _fmt(contractValue) : '—', '#0f6342', '#eaf4ef', '#c6e6d5', 'pm-ov-kpi-contract')}
      ${kpi('Progress', progress + '%', '#0f6342', '#eaf4ef', '#c6e6d5', 'pm-ov-kpi-progress')}
      ${kpi('Direct cost', _fmt(directCost), '#44525f', '#eef0f3', '#d6dde4', 'pm-ov-kpi-direct')}
      ${kpi('Remaining cash receipt', (netCash < 0 ? '−' : '+') + _fmt(Math.abs(netCash)), netColor, '#fbf3e2', '#f0e2c5', 'pm-ov-kpi-net')}
    </div>`;

    // Direct-cost breakdown — one bar per category (keeps the #pm-ov-* IDs).
    const bdRow = (label, color, amtId, pctId, segId, val, pct, count, countId) => `
      <div style="margin-bottom:13px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font:600 12.5px 'IBM Plex Sans';color:#3a3a36;">${label}<span id="${countId}" style="font:500 11px 'IBM Plex Sans';color:#9b9a94;margin-left:7px;">${count} ${count === 1 ? 'entry' : 'entries'}</span></span>
          <span class="num" id="${amtId}" style="font:700 12.5px 'IBM Plex Sans';color:#1c1c1a;">${_fmt(val)}</span>
        </div>
        <div style="height:9px;background:#f0efec;border-radius:99px;overflow:hidden;">
          <div id="${segId}" style="width:${pct}%;${val > 0 ? 'min-width:6px;' : ''}height:100%;background:${color};border-radius:99px;transition:width .25s ease;"></div>
        </div>
        <span id="${pctId}" style="display:none;">${pct}</span>
      </div>`;
    const ovBreakdown = `
    <div style="flex:1.6;min-width:340px;border:1px solid #e7e6e2;border-radius:16px;background:#fff;padding:20px 22px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div style="font:600 14.5px 'IBM Plex Sans';">Direct-cost breakdown</div>
        <div style="display:flex;align-items:center;gap:12px;">
          <span id="pm-ov-range-note" style="font:400 11px 'IBM Plex Sans';color:#9b9a94;">All time · ${_pmOvWeekGroups().length} week${_pmOvWeekGroups().length === 1 ? '' : 's'}</span>
          <button onclick="pmOvViewData()" style="display:inline-flex;align-items:center;gap:5px;font:600 11.5px 'IBM Plex Sans';color:#0f6342;background:#eaf4ef;border:1px solid #c6e6d5;border-radius:8px;padding:5px 11px;cursor:pointer;">View</button>
        </div>
      </div>
      ${bdRow('Labor', '#157a52', 'pm-ov-labor', 'pm-ov-labor-pct', 'pm-ov-seg-labor', bd.labor, bd.laborPct, bd.laborCount, 'pm-ov-labor-cnt')}
      ${bdRow('Materials', '#c79024', 'pm-ov-materials', 'pm-ov-materials-pct', 'pm-ov-seg-materials', bd.materials, bd.matPct, bd.matCount, 'pm-ov-materials-cnt')}
      ${bdRow('Out Source', '#8b6fc4', 'pm-ov-combined', 'pm-ov-combined-pct', 'pm-ov-seg-combined', bd.combined, bd.combinedPct, bd.combinedCount, 'pm-ov-combined-cnt')}
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #f0efec;margin-top:4px;padding-top:13px;">
        <span style="font:600 12.5px 'IBM Plex Sans';color:#3a3a36;">Direct cost total</span>
        <span class="num" id="pm-ov-direct" style="font:800 16px 'IBM Plex Sans';color:#1c1c1a;">${_fmt(bd.direct)}</span>
      </div>
    </div>`;

    const ovDonutBg = donutTotal > 0 ? `conic-gradient(#157a52 0% ${donutPaidPct}%, #e6c878 ${donutPaidPct}% 100%)` : '#eeede9';
    const ovDonut = `
    <div style="flex:1;min-width:240px;border:1px solid #e7e6e2;border-radius:16px;background:#fff;padding:20px 22px;">
      <div style="font:600 14.5px 'IBM Plex Sans';margin-bottom:16px;">Payment status</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:36px;">
        <div style="position:relative;width:150px;height:150px;flex:none;">
          <div style="position:absolute;inset:0;border-radius:50%;background:${ovDonutBg};"></div>
          <div style="position:absolute;inset:22px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <span class="num" style="font:700 26px 'IBM Plex Sans';color:#0f6342;">${donutPaidPct}%</span>
            <span style="font:500 10px 'IBM Plex Sans';color:#9b9a94;text-transform:uppercase;letter-spacing:.04em;">paid</span>
          </div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:22px;"><span style="width:10px;height:10px;border-radius:3px;background:#157a52;flex:none;"></span><div><div style="font:500 11px 'IBM Plex Sans';color:#3a3a36;">Paid</div><div class="num" style="font:700 12.5px 'IBM Plex Sans';">${_fmt(paid)}</div></div></div>
          <div style="display:flex;align-items:center;gap:10px;"><span style="width:10px;height:10px;border-radius:3px;background:#c79024;flex:none;"></span><div><div style="font:500 11px 'IBM Plex Sans';color:#3a3a36;">Outstanding</div><div class="num" style="font:700 12.5px 'IBM Plex Sans';">${_fmt(donutOutstanding)}</div></div></div>
        </div>
      </div>
    </div>`;

    const ovTrend = `
    <div style="flex:1.6;min-width:340px;border:1px solid #e7e6e2;border-radius:16px;background:#fff;padding:20px 22px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
        <div style="font:600 14.5px 'IBM Plex Sans';">Billing trend</div>
        <span style="font:400 11px 'IBM Plex Sans';color:#9b9a94;">last ${weeks.length} week${weeks.length === 1 ? '' : 's'}</span>
      </div>
      <div style="display:flex;align-items:flex-end;gap:10px;height:130px;">${bars}</div>
    </div>`;

    const nextAmt  = next ? (next.totalAmount || next.amount || 0) : 0;
    const isStrict = !!(next && (next.strict || next.isStrict || next.mode === 'strict'));
    const ovNextDue = `
    <div style="flex:1;min-width:240px;border-radius:16px;background:#1c1c1a;color:#fff;padding:20px 22px;display:flex;flex-direction:column;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <span style="font:700 10px 'IBM Plex Sans';letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.55);">Next payment due</span>
        ${isStrict ? '<span style="font:700 9.5px \'IBM Plex Sans\';background:#b4892a;color:#fff;padding:3px 9px;border-radius:6px;letter-spacing:.04em;">STRICT</span>' : ''}
      </div>
      <div class="num" style="font:800 30px 'IBM Plex Sans';margin-top:10px;letter-spacing:-.01em;">${next ? _fmt(nextAmt) : '—'}</div>
      <div style="font:400 12px 'IBM Plex Sans';color:rgba(255,255,255,.6);margin-top:5px;">${next ? _esc(nextDueDate) + ' · ' + _esc(nextDueSub) : 'No payment scheduled'}</div>
      <div style="display:flex;gap:9px;margin-top:auto;padding-top:18px;">
        <button onclick="pmWsTab('money')" style="flex:1;background:#157a52;border:none;border-radius:11px;padding:11px;font:700 12.5px 'IBM Plex Sans';color:#fff;cursor:pointer;">Send request</button>
        <button onclick="pmWsTab('money')" style="background:rgba(255,255,255,.12);border:none;border-radius:11px;padding:11px 16px;font:700 12.5px 'IBM Plex Sans';color:#fff;cursor:pointer;">Edit</button>
      </div>
    </div>`;

    return ovHeader + ovTiles
        + `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch;margin-bottom:14px;">${ovBreakdown}${ovDonut}</div>`
        + `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch;margin-bottom:16px;">${ovTrend}${ovNextDue}</div>`
        + lists;
}

// Sum a bill list into the direct-cost breakdown buckets. `materials` is stored
// client-inclusive of any combined (supply & install) amount, so pure materials
// = materials − combined; the combined bucket is reported on its own.
function _pmOvBreakdown(bills) {
    let labor = 0, materials = 0, combined = 0;
    // Per-category ENTRY counts. Prefer the per-line `entries` array (each line is
    // one entry, typed labor/materials/both); else fall back to counting a bill as
    // one entry per category it has a nonzero amount in.
    let laborCount = 0, matCount = 0, combinedCount = 0;
    bills.forEach(b => {
        // Prefer the stored `combined` field; for bills saved before it existed,
        // derive it from the 'both' line entries (the stored `materials` folds it in).
        // 0 is treated as "missing" (a `default 0` column leaves old bills at 0),
        // so we still derive the supply & install portion from the 'both' entries.
        let c = Number(b.combined) || 0;
        if (!c && Array.isArray(b.entries)) {
            c = b.entries.filter(e => e.type === 'both').reduce((s, e) => s + (Number(e.amount) || 0), 0);
        }
        c = c || 0;
        const matPure = Math.max(0, (b.materials || 0) - c);
        labor     += b.labor || 0;
        combined  += c;
        materials += matPure;

        if (Array.isArray(b.entries) && b.entries.length) {
            laborCount    += b.entries.filter(e => e.type === 'labor').length;
            matCount      += b.entries.filter(e => e.type === 'materials').length;
            combinedCount += b.entries.filter(e => e.type === 'both').length;
        } else {
            // Legacy bills with no line items: count the bill once per nonzero category.
            if ((b.labor || 0) > 0) laborCount++;
            if (matPure > 0)        matCount++;
            if (c > 0)              combinedCount++;
        }
    });
    const direct = labor + materials + combined;
    const pct = v => direct > 0 ? Math.round(v / direct * 100) : 0;
    return { labor, materials, combined, direct,
             laborPct: pct(labor), matPct: pct(materials), combinedPct: pct(combined),
             laborCount, matCount, combinedCount };
}

// Format a week-ending date for the breakdown filter, e.g. "Jun 26, 2026".
function _pmOvWeekLabel(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d) ? dateStr : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Weekly grouping for the range dropdown ───────────────────────────────
// The daily bills are grouped into calendar weeks (Sun–Sat). Each group is
// addressable by the mode "wk:<YYYY-MM-DD of that Sunday>" so a whole week can
// be viewed at once, alongside the per-day rows.
function _pmWeekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    const day = d.getDay();                 // 0=Sun … 6=Sat
    d.setDate(d.getDate() - day);           // back to the week's Sunday
    // Serialize from LOCAL parts, NOT toISOString(): toISOString() converts to
    // UTC, and in PH (UTC+8) local midnight becomes the previous day, which
    // shifted every Sun–Sat week a day early (showing "Jun 20 – Jun 26" for the
    // Jun 21–27 week, and "3rd week of June" against the wrong dates).
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
function _pmWeekRangeLabel(sundayStr) {
    const start = new Date(sundayStr + 'T00:00:00');
    if (isNaN(start)) return sundayStr;
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const o = { month: 'short', day: 'numeric' };
    const sameYear = start.getFullYear() === end.getFullYear();
    return start.toLocaleDateString('en-PH', o) + ' – ' +
        end.toLocaleDateString('en-PH', sameYear ? o : { ...o, year: 'numeric' });
}
function _pmOrdinal(n) {
    const suffix = (n % 10 === 1 && n !== 11) ? 'st'
        : (n % 10 === 2 && n !== 12) ? 'nd'
        : (n % 10 === 3 && n !== 13) ? 'rd' : 'th';
    return n + suffix;
}
// "1st Week" — which week OF THE PROJECT this Sun–Sat week is, counting from the
// week the project's start date falls in (so the first billed week reads "1st Week"
// instead of a calendar position like "3rd week of June"). Falls back to the
// calendar label if the project has no start date / the week predates it.
function _pmWeekOfMonthLabel(sundayStr) {
    const start = new Date(sundayStr + 'T00:00:00');
    if (isNaN(start)) return 'Per week';
    const startRaw = _pmActiveProject && _pmActiveProject.startDate;
    if (startRaw) {
        const projSun = new Date(_pmWeekStart(startRaw) + 'T00:00:00');
        if (!isNaN(projSun)) {
            const weeks = Math.round((start - projSun) / (7 * 24 * 60 * 60 * 1000)) + 1;
            if (weeks >= 1) return _pmOrdinal(weeks) + ' Week';
        }
    }
    // Fallback: calendar "Nth week of <Month>".
    return _pmOrdinal(Math.ceil(start.getDate() / 7)) + ' week of '
        + start.toLocaleDateString('en-PH', { month: 'long' });
}
// Distinct week-starts present in the bills, newest first.
function _pmOvWeekGroups() {
    const set = new Set((_pmOvBills || [])
        .filter(b => b.weekEndingDate)
        .map(b => _pmWeekStart(b.weekEndingDate)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
}

// Filter the stored bills by the selected billing-week mode.
function _pmOvFilterBills(mode) {
    if (mode === 'all') return _pmOvBills;
    if (mode === 'month') {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return _pmOvBills.filter(b => (b.weekEndingDate || '').startsWith(ym));
    }
    // "wk:<monday>" → every bill whose date falls in that Mon–Sun week.
    if (mode && mode.indexOf('wk:') === 0) {
        const ws = mode.slice(3);
        return _pmOvBills.filter(b => b.weekEndingDate && _pmWeekStart(b.weekEndingDate) === ws);
    }
    const dated = _pmOvBills.filter(b => b.weekEndingDate)
        .slice().sort((a, b) => b.weekEndingDate.localeCompare(a.weekEndingDate));
    if (mode === 'latest') return dated.slice(0, 1);
    if (mode === 'last4')  return dated.slice(0, 4);
    return _pmOvBills.filter(b => b.weekEndingDate === mode);   // a specific week
}

// Filter payment requests by the same billing-week range (keyed on weekEndingDate),
// so the cash KPIs match the selected period. For 'latest' / 'last4' we reuse the
// bills' week set so requests align with the same weeks shown in the breakdown.
function _pmOvFilterReqs(mode) {
    if (mode === 'all') return _pmOvReqs;
    if (mode === 'month') {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return _pmOvReqs.filter(r => (r.weekEndingDate || '').startsWith(ym));
    }
    if (mode && mode.indexOf('wk:') === 0) {
        const ws = mode.slice(3);
        return _pmOvReqs.filter(r => r.weekEndingDate && _pmWeekStart(r.weekEndingDate) === ws);
    }
    if (mode === 'latest' || mode === 'last4') {
        const weeks = new Set(_pmOvFilterBills(mode).map(b => b.weekEndingDate).filter(Boolean));
        return _pmOvReqs.filter(r => weeks.has(r.weekEndingDate));
    }
    return _pmOvReqs.filter(r => r.weekEndingDate === mode);    // a specific week
}

// Custom date-range dropdown (Overview) — open/close + pick.
window.pmOvToggleRange = function(ev) {
    if (ev) ev.stopPropagation();
    const dd = document.getElementById('pm-ov-dd');
    const menu = document.getElementById('pm-ov-dd-menu');
    if (!dd || !menu) return;
    if (menu.style.display !== 'none') { menu.style.display = 'none'; dd.classList.remove('open'); return; }
    menu.style.display = 'block'; dd.classList.add('open');
    const close = (e) => { if (!dd.contains(e.target)) { menu.style.display = 'none'; dd.classList.remove('open'); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
};
window.pmOvPickRange = function(el, val, label) {
    const input = document.getElementById('pm-ov-range');
    if (input) input.value = val;
    const lbl = document.getElementById('pm-ov-dd-label');
    if (lbl) lbl.textContent = label;
    document.querySelectorAll('#pm-ov-dd-menu .pmw-dd-opt').forEach(o => o.classList.remove('active'));
    if (el) el.classList.add('active');
    const menu = document.getElementById('pm-ov-dd-menu');
    const dd = document.getElementById('pm-ov-dd');
    if (menu) menu.style.display = 'none';
    if (dd) dd.classList.remove('open');
    pmOvApplyRange();
};

// Recompute the breakdown tiles for the selected date range.
window.pmOvApplyRange = function() {
    const sel = document.getElementById('pm-ov-range');
    if (!sel) return;
    const mode = sel.value;
    const bills = _pmOvFilterBills(mode);
    const reqs  = _pmOvFilterReqs(mode);
    const bd = _pmOvBreakdown(bills);
    const setAmt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = _fmt(val); };
    const setSeg = (id, pct, show) => { const el = document.getElementById(id); if (el) { el.style.width = pct + '%'; el.style.minWidth = show ? '6px' : '0'; } };

    // ── Top KPI cards (recomputed for the selected range) ──
    // Direct cost = labor + materials for the bills in range (matches the breakdown).
    const directCost = bills.reduce((s, b) => {
        const dct = Number(b.directCostTotal) || 0;
        if (dct) return s + dct;
        const lm = (Number(b.labor) || 0) + (Number(b.materials) || 0);
        if (lm) return s + lm;
        return s + ((Number(b.grandTotal) || 0) - (Number(b.managementFee) || 0));
    }, 0);
    // Paid is intentionally all-time (matches the Payment status donut, which
    // isn't range-filtered) so the tile doesn't flip negative just because the
    // selected week happened to collect no payment. Direct cost stays per-range.
    const paid    = _pmOvPaid(_pmOvReqs);
    const netCash = paid - directCost;
    const netColor = netCash >= 0 ? '#0f6342' : '#8f352c';
    // Contract value & progress are range-independent — re-set so they stay correct.
    const cv = document.getElementById('pm-ov-kpi-contract');
    if (cv) cv.textContent = _pmOvContractVal > 0 ? _fmt(_pmOvContractVal) : '—';
    const pr = document.getElementById('pm-ov-kpi-progress');
    if (pr) pr.textContent = _pmOvProgressVal + '%';
    setAmt('pm-ov-kpi-direct', directCost);
    const netEl = document.getElementById('pm-ov-kpi-net');
    if (netEl) {
        netEl.textContent = (netCash < 0 ? '−' : '+') + _fmt(Math.abs(netCash));
        netEl.style.color = netColor;
    }

    setAmt('pm-ov-direct',    bd.direct);
    setAmt('pm-ov-labor',     bd.labor);
    setAmt('pm-ov-materials', bd.materials);
    setAmt('pm-ov-combined',  bd.combined);
    const setCnt = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n + ' ' + (n === 1 ? 'entry' : 'entries'); };
    setCnt('pm-ov-labor-cnt',     bd.laborCount);
    setCnt('pm-ov-materials-cnt', bd.matCount);
    setCnt('pm-ov-combined-cnt',  bd.combinedCount);
    _pmSet('pm-ov-labor-pct',     String(bd.laborPct));
    _pmSet('pm-ov-materials-pct', String(bd.matPct));
    _pmSet('pm-ov-combined-pct',  String(bd.combinedPct));
    setSeg('pm-ov-seg-labor',     bd.laborPct,    bd.labor > 0);
    setSeg('pm-ov-seg-materials', bd.matPct,      bd.materials > 0);
    setSeg('pm-ov-seg-combined',  bd.combinedPct, bd.combined > 0);

    const note = document.getElementById('pm-ov-range-note');
    if (note) {
        const isWeek = mode && mode.indexOf('wk:') === 0;
        const unit = isWeek ? 'day' : 'week';
        const wk = bills.length + ' ' + unit + (bills.length === 1 ? '' : 's');
        const label = mode === 'all'    ? 'All time'
            : mode === 'month'  ? 'This month'
            : mode === 'latest' ? 'This week'
            : mode === 'last4'  ? 'Last 4 weeks'
            : isWeek            ? 'Week of ' + _pmWeekRangeLabel(mode.slice(3))
            : 'Daily ' + _pmOvWeekLabel(mode);
        note.textContent = label + ' · ' + wk;
    }
};

// ══════════════════════════════════════════════════════════════════════════
// Direct-cost data input — redesigned sub-page (imported from Claude Design).
// Green summary hero (category split + %), live search, category filter chips,
// per-day cards with a proportion bar, styled range dropdown, and Print.
// ══════════════════════════════════════════════════════════════════════════
let _pmDvFilter = 'all';      // all | labor | materials | both
let _pmDvQuery  = '';         // search text
let _pmDvResizeBound = false; // one-time resize listener guard

// Entries of a bill (synthesize from labor/materials totals for legacy bills).
function _pmBillEntries(b) {
    if (Array.isArray(b.entries) && b.entries.length) return b.entries;
    const synth = [];
    if (b.labor)     synth.push({ type: 'labor',     details: 'Labor total',     amount: Number(b.labor) });
    if (b.materials) synth.push({ type: 'materials', details: 'Materials total', amount: Number(b.materials) });
    return synth;
}
function _pmDvCat(e)      { return e.type === 'both' ? 'both' : (e.type === 'materials' ? 'materials' : 'labor'); }
function _pmDvDateLabel(s){ const d = new Date(s + 'T00:00:00'); return isNaN(d) ? (s || '—') : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); }
function _pmDvWeekday(s)  { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString('en-PH', { weekday: 'long' }); }
function _pmDvRangeLabel(mode) {
    if (mode === 'month')  return 'This month';
    if (mode === 'latest') return 'This week';
    if (mode === 'last4')  return 'Last 4 weeks';
    if (mode && mode.indexOf('wk:') === 0) return _pmWeekOfMonthLabel(mode.slice(3));
    return 'All time';
}

// "View" — open the redesigned data-input sub-page (fresh: filters reset).
window.pmOvViewData = function() {
    _pmDvFilter = 'all';
    _pmDvQuery  = '';
    // Re-render across the mobile/desktop breakpoint when the window resizes.
    if (!_pmDvResizeBound) {
        _pmDvResizeBound = true;
        let t;
        window.addEventListener('resize', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                const p = document.getElementById('ws-panel-dataview');
                if (p && p.classList.contains('active')) _pmDvRender();
            }, 160);
        });
    }
    _pmDvRender();
    document.querySelectorAll('.pm-ws-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('ws-panel-dataview');
    if (panel) panel.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'auto' });
};

// Render/re-render the page body for the current range + filter + search.
// Branches to a phone layout under a narrow viewport (mirrors the mobile design).
function _pmDvRender() {
    const root = document.getElementById('pm-ov-dataview-root');
    if (!root) return;
    const isMobile = (window.innerWidth || 9999) <= 560;
    const sel  = document.getElementById('pm-ov-range');
    const mode = sel ? sel.value : 'all';
    const rangeLabel = _pmDvRangeLabel(mode);
    const bills = _pmOvFilterBills(mode).slice()
        .sort((a, b) => (b.weekEndingDate || '').localeCompare(a.weekEndingDate || ''));
    const CAT = { labor: '#157a52', materials: '#c79024', both: '#8b6fc4' };

    // Range totals + counts (ignore filter/search) — feed the hero + chip counts.
    let gL = 0, gM = 0, gB = 0, cL = 0, cM = 0, cB = 0;
    bills.forEach(b => _pmBillEntries(b).forEach(e => {
        const t = _pmDvCat(e), a = Number(e.amount) || 0;
        if (t === 'labor') { gL += a; cL++; } else if (t === 'both') { gB += a; cB++; } else { gM += a; cM++; }
    }));
    const grand = gL + gM + gB;
    const pr = v => grand ? Math.round(v / grand * 100) + '%' : '0%';

    // Filtered/searched day cards (each bill = a day).
    const q = _pmDvQuery.trim().toLowerCase();
    let shownTotal = 0;
    const dayHtml = bills.map(b => {
        let dl = 0, dm = 0, db = 0;
        const ents = _pmBillEntries(b)
            .filter(e => _pmDvFilter === 'all' || _pmDvCat(e) === _pmDvFilter)
            .filter(e => !q || (e.details || '').toLowerCase().includes(q) || String(e.amount || '').includes(q));
        if (!ents.length) return '';
        const rows = ents.map(e => {
            const t = _pmDvCat(e), a = Number(e.amount) || 0;
            if (t === 'labor') dl += a; else if (t === 'both') db += a; else dm += a;
            const urls = (typeof _pmEntryReceiptList === 'function' ? _pmEntryReceiptList(e) : []).map(r => r.url || r.dataUrl).filter(Boolean);
            const rcpt = urls.map((u, i) => `<a href="${_esc(u)}" target="_blank" rel="noopener" class="pm-dv-noprint" style="display:inline-flex;align-items:center;gap:4px;font:600 11px 'IBM Plex Sans';color:#0f6342;text-decoration:none;background:#eaf4ef;border-radius:6px;padding:${isMobile ? '3px 8px;margin-top:6px;margin-right:6px;' : '4px 9px;'}white-space:nowrap;flex:none;">↗ receipt${urls.length > 1 ? ' ' + (i + 1) : ''}</a>`).join('');
            if (isMobile) {
                return `<div style="display:flex;align-items:center;gap:11px;padding:12px 16px;border-top:1px solid #f4f3f0;">
                    <span style="width:9px;height:9px;border-radius:50%;background:${CAT[t]};flex:none;"></span>
                    <div style="flex:1;min-width:0;">
                      <div style="font:500 13.5px 'IBM Plex Sans';color:#2c2c28;line-height:1.25;">${_esc(e.details || '—')}</div>
                      ${rcpt}
                    </div>
                    <span class="num" style="font:700 13.5px 'IBM Plex Sans';color:#1c1c1a;flex:none;">${_fmt(a)}</span>
                  </div>`;
            }
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-top:1px solid #f4f3f0;">
                <span style="width:9px;height:9px;border-radius:50%;background:${CAT[t]};flex:none;"></span>
                <span style="flex:1;min-width:0;font:500 13px 'IBM Plex Sans';color:#2c2c28;">${_esc(e.details || '—')}</span>
                ${rcpt}
                <span class="num" style="min-width:92px;text-align:right;font:700 13px 'IBM Plex Sans';color:#1c1c1a;flex:none;">${_fmt(a)}</span>
              </div>`;
        }).join('');
        const dt = dl + dm + db; shownTotal += dt;
        const p = v => dt ? (v / dt * 100).toFixed(1) + '%' : '0%';
        const cnt = ents.length + (ents.length === 1 ? ' entry' : ' entries');
        const cardStyle = isMobile ? 'margin:12px 14px 0;background:#fff;' : 'margin-top:14px;';
        const pad = isMobile ? '13px 16px 11px' : '14px 18px 12px';
        const barMargin = isMobile ? '0 16px 2px' : '0 18px 4px';
        return `<div style="border:1px solid #e7e6e2;border-radius:14px;${cardStyle}overflow:hidden;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:${pad};">
              <div><div style="font:700 13px 'IBM Plex Sans';color:#1c1c1a;">${_esc(_pmDvDateLabel(b.weekEndingDate))}</div><div style="font:400 11px 'IBM Plex Sans';color:#9b9a94;margin-top:1px;">${_esc(_pmDvWeekday(b.weekEndingDate))} · ${cnt}</div></div>
              <span class="num" style="font:700 14px 'IBM Plex Sans';color:#1c1c1a;">${_fmt(dt)}</span>
            </div>
            <div class="pm-dv-bar" style="height:6px;display:flex;margin:${barMargin};border-radius:4px;overflow:hidden;background:#f0efec;">
              <div style="width:${p(dm)};background:#c79024;"></div>
              <div style="width:${p(dl)};background:#157a52;"></div>
              <div style="width:${p(db)};background:#8b6fc4;"></div>
            </div>
            ${rows}
          </div>`;
    }).join('');
    const isEmpty = !dayHtml.trim();
    const emptyMsg = (q || _pmDvFilter !== 'all') ? 'No entries match your search.' : 'No entries in this range yet.';

    const filterName = { all: 'all categories', labor: 'Labor', materials: 'Materials', both: 'Out Source' }[_pmDvFilter];
    const totalLabel = (_pmDvFilter === 'all' ? 'Total spent · ' + rangeLabel : 'Total · ' + filterName) + (q ? ' · filtered' : '');

    // Hero — desktop shows 3 columns; mobile stacks 3 rows (label+% left, amount right).
    let heroInner;
    if (isMobile) {
        const heroRow = (dot, label, amt, pct, last) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;${last ? '' : 'border-bottom:1px solid rgba(255,255,255,.12);'}">
            <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:${dot};"></span><span style="font:600 12.5px 'IBM Plex Sans';opacity:.9;">${label}</span><span style="font:500 10.5px 'IBM Plex Sans';opacity:.6;">${pct}</span></div>
            <span class="num" style="font:700 14px 'IBM Plex Sans';">${_fmt(amt)}</span>
          </div>`;
        heroInner = `<div class="pm-dv-hero-split" style="margin-top:16px;border-top:1px solid rgba(255,255,255,.18);padding-top:6px;">
            ${heroRow('#f0c674', 'Materials', gM, pr(gM), false)}
            ${heroRow('#7ed3a8', 'Labor', gL, pr(gL), false)}
            ${heroRow('#c3aef0', 'Out Source', gB, pr(gB), true)}
          </div>`;
    } else {
        const heroCol = (dot, label, amt, pct) => `<div style="flex:1;"><div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:50%;background:${dot};"></span><span style="font:600 11px 'IBM Plex Sans';opacity:.88;">${label}</span></div><div class="num" style="font:700 15px 'IBM Plex Sans';margin-top:6px;">${_fmt(amt)}</div><div style="font:500 10.5px 'IBM Plex Sans';opacity:.7;margin-top:2px;">${pct} of total</div></div>`;
        heroInner = `<div class="pm-dv-hero-split" style="display:flex;margin-top:18px;border-top:1px solid rgba(255,255,255,.18);padding-top:16px;gap:8px;">
            ${heroCol('#f0c674', 'Materials', gM, pr(gM))}
            ${heroCol('#7ed3a8', 'Labor', gL, pr(gL))}
            ${heroCol('#c3aef0', 'Out Source', gB, pr(gB))}
          </div>`;
    }
    const hero = `<div class="pm-dv-hero" style="border-radius:16px;background:#0f6342;color:#fff;padding:${isMobile ? '20px' : '22px 24px'};">
        <div style="font:600 ${isMobile ? '10.5px' : '11px'} 'IBM Plex Sans';opacity:.78;text-transform:uppercase;letter-spacing:.07em;">${_esc(totalLabel)}</div>
        <div class="num pm-dv-total" style="font:800 ${isMobile ? '30px' : '32px'} 'IBM Plex Sans';letter-spacing:-.02em;margin-top:4px;">${_fmt(shownTotal)}</div>
        ${heroInner}
      </div>`;

    // Filter chips.
    const chip = (key, label, count, dot) => {
        const active = _pmDvFilter === key;
        const base = "display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:" + (isMobile ? '8px 14px' : '7px 14px') + ";cursor:pointer;white-space:nowrap;flex:none;font:600 12px 'IBM Plex Sans';";
        const style = active ? base + 'color:#fff;background:#0f6342;border:1px solid #0f6342;' : base + 'color:#3a3a36;background:#fff;border:1px solid #e7e6e2;';
        const cStyle = active ? "font:700 11px 'IBM Plex Sans';opacity:.82;" : "font:700 11px 'IBM Plex Sans';color:#9b9a94;";
        const dotHtml = dot ? `<span style="width:8px;height:8px;border-radius:50%;background:${dot};flex:none;"></span>` : '';
        return `<button onclick="pmDvSetFilter('${key}')" style="${style}">${dotHtml}${label} <span style="${cStyle}">${count}</span></button>`;
    };
    const chips = [chip('all', 'All', cL + cM + cB, null), chip('labor', 'Labor', cL, '#157a52'), chip('materials', 'Materials', cM, '#c79024'), chip('both', 'Out Source', cB, '#8b6fc4')].join('');

    // Styled range dropdown — full-width on mobile, right-aligned 260px on desktop.
    const caret = '<svg width="' + (isMobile ? '12' : '11') + '" height="' + (isMobile ? '12' : '11') + '" viewBox="0 0 24 24" fill="none" stroke="#9b9a94" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const opts = [['all', 'All time', ''], ['month', 'This month', ''], ['latest', 'This week', ''], ['last4', 'Last 4 weeks', '']]
        .concat(_pmOvWeekGroups().map(ws => ['wk:' + ws, _pmWeekOfMonthLabel(ws), _pmWeekRangeLabel(ws)]));
    const menuRows = opts.map(([v, l, h]) => {
        const s = v === mode;
        const rowStyle = `display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;cursor:pointer;border-radius:9px;padding:11px 12px;background:${s ? '#eaf4ef' : 'transparent'};`;
        const labelStyle = `flex:1;font:${s ? '700' : '500'} 13px 'IBM Plex Sans';color:${s ? '#0f6342' : '#2c2c28'};`;
        const check = s ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0f6342" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '';
        return `<button onclick="pmDvPickRange('${_esc(v)}')" style="${rowStyle}"><span style="${labelStyle}">${_esc(l)}</span>${check}<span style="font:700 12.5px 'IBM Plex Sans';color:#1c1c1a;white-space:nowrap;">${_esc(h)}</span></button>`;
    }).join('');
    const ddWrapStyle  = isMobile ? 'position:relative;flex:1;' : 'position:relative;';
    const ddBtnStyle   = isMobile
        ? "display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;border:1px solid #e7e6e2;border-radius:10px;padding:11px 13px;font:600 12.5px 'IBM Plex Sans';color:#3a3a36;background:#fff;cursor:pointer;"
        : "display:inline-flex;align-items:center;gap:8px;border:1px solid #e7e6e2;border-radius:10px;padding:9px 13px;font:600 12.5px 'IBM Plex Sans';color:#3a3a36;background:#fff;cursor:pointer;white-space:nowrap;";
    const ddMenuStyle  = isMobile
        ? "display:none;position:absolute;left:0;right:0;top:calc(100% + 6px);background:#fff;border:1px solid #e7e6e2;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.16);padding:6px;z-index:30;"
        : "display:none;position:absolute;right:0;top:calc(100% + 6px);width:260px;background:#fff;border:1px solid #e7e6e2;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.12);padding:6px;z-index:20;";
    const dropdown = `<div style="${ddWrapStyle}" id="pm-dv-dd">
        <button onclick="pmDvToggleRange(event)" style="${ddBtnStyle}">${_esc(rangeLabel)}${caret}</button>
        <div id="pm-dv-dd-menu" style="${ddMenuStyle}">${menuRows}</div>
      </div>`;

    // Search box (no outer margin — applied by the layout wrapper).
    const search = `<div class="pm-dv-noprint" style="display:flex;align-items:center;gap:10px;border:1px solid #e7e6e2;border-radius:11px;padding:11px ${isMobile ? '13px' : '14px'};background:#fff;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9b9a94" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
        <input id="pm-dv-search" value="${_esc(_pmDvQuery)}" oninput="pmDvSearch(this.value)" placeholder="Search a name or amount…" style="flex:1;min-width:0;border:none;outline:none;font:400 13.5px 'IBM Plex Sans';color:#2c2c28;background:transparent;" />
        ${q ? '<button onclick="pmDvClearSearch()" style="border:none;background:#f0efec;color:#6b6a64;border-radius:6px;font:600 11px \'IBM Plex Sans\';padding:4px 9px;cursor:pointer;flex:none;">Clear</button>' : ''}
      </div>`;

    const printSvg = '<svg width="' + (isMobile ? '16' : '14') + '" height="' + (isMobile ? '16' : '14') + '" viewBox="0 0 24 24" fill="none" stroke="#0f6342" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
    const printBtn = isMobile
        ? `<button onclick="pmDvPrint()" title="Print" style="display:inline-flex;align-items:center;justify-content:center;border:1px solid #e7e6e2;border-radius:10px;padding:11px 14px;background:#fff;cursor:pointer;flex:none;">${printSvg}</button>`
        : `<button onclick="pmDvPrint()" title="Print" style="display:inline-flex;align-items:center;gap:7px;border:1px solid #e7e6e2;border-radius:10px;padding:9px 13px;font:600 12.5px 'IBM Plex Sans';color:#3a3a36;background:#fff;cursor:pointer;white-space:nowrap;">${printSvg}Print</button>`;

    if (isMobile) {
        root.innerHTML = `<div style="max-width:480px;margin:0 auto;">
          <div style="padding:6px 16px 0;">
            <button onclick="pmOvCloseDataview()" class="pm-dv-noprint" style="display:inline-flex;align-items:center;gap:6px;font:600 12.5px 'IBM Plex Sans';color:#0f6342;background:#eaf4ef;border:1px solid #c6e6d5;border-radius:9px;padding:8px 13px;cursor:pointer;">← Back to overview</button>
            <div style="font:800 20px 'IBM Plex Sans';letter-spacing:-.02em;color:#1c1c1a;margin-top:16px;">Direct-cost data input</div>
            <div style="font:400 12px 'IBM Plex Sans';color:#9b9a94;margin-top:2px;">${_esc(rangeLabel)} · all line entries</div>
            <div class="pm-dv-noprint" style="display:flex;gap:8px;margin-top:14px;">${dropdown}${printBtn}</div>
          </div>
          <div style="margin:14px 14px 0;">${hero}</div>
          <div class="pm-dv-noprint" style="margin:12px 14px 0;">${search}</div>
          <div class="pm-dv-noprint pm-dv-chipscroll" style="display:flex;gap:8px;margin-top:12px;padding:0 14px 2px;overflow-x:auto;">${chips}</div>
          ${isEmpty ? `<div style="margin:12px 14px 0;text-align:center;padding:40px 20px;color:#9b9a94;font:500 13px 'IBM Plex Sans';">${emptyMsg}</div>` : dayHtml}
        </div>`;
        return;
    }

    root.innerHTML = `<div style="max-width:1180px;margin:0 auto;">
      <div style="background:#fff;border:1px solid #e7e6e2;border-radius:18px;box-shadow:0 1px 3px rgba(0,0,0,.05);padding:24px 26px;">
        <button onclick="pmOvCloseDataview()" class="pm-dv-noprint" style="display:inline-flex;align-items:center;gap:6px;font:600 12.5px 'IBM Plex Sans';color:#0f6342;background:#eaf4ef;border:1px solid #c6e6d5;border-radius:9px;padding:8px 14px;cursor:pointer;margin-bottom:18px;">← Back to overview</button>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;">
          <div>
            <div style="font:800 22px 'IBM Plex Sans';letter-spacing:-.02em;color:#1c1c1a;">Direct-cost data input</div>
            <div style="font:400 12.5px 'IBM Plex Sans';color:#9b9a94;margin-top:3px;">${_esc(rangeLabel)} · all line entries</div>
          </div>
          <div class="pm-dv-noprint" style="display:flex;align-items:center;gap:8px;flex:none;">${dropdown}${printBtn}</div>
        </div>
        ${hero}
        <div style="margin-top:16px;">${search}</div>
        <div class="pm-dv-noprint" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">${chips}</div>
        ${isEmpty ? `<div style="text-align:center;padding:40px 20px;color:#9b9a94;font:500 13px 'IBM Plex Sans';">${emptyMsg}</div>` : dayHtml}
      </div>
    </div>`;
}

// Return from the data-input sub-page to the overview without re-fetching it.
window.pmOvCloseDataview = function() {
    document.querySelectorAll('.pm-ws-panel').forEach(p => p.classList.remove('active'));
    const ov = document.getElementById('ws-panel-overview');
    if (ov) ov.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'auto' });
};

// Category filter chips.
window.pmDvSetFilter = function(key) { _pmDvFilter = key; _pmDvRender(); };

// Live search — re-render, then restore focus + caret to the search box.
window.pmDvSearch = function(v) {
    _pmDvQuery = v;
    _pmDvRender();
    const el = document.getElementById('pm-dv-search');
    if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (_) {} }
};
window.pmDvClearSearch = function() {
    _pmDvQuery = '';
    _pmDvRender();
    const el = document.getElementById('pm-dv-search');
    if (el) el.focus();
};

window.pmDvPrint = function() {
    const menu = document.getElementById('pm-dv-dd-menu');
    if (menu) menu.style.display = 'none';
    setTimeout(() => window.print(), 60);
};

// Open/close the styled range dropdown.
window.pmDvToggleRange = function(ev) {
    if (ev) ev.stopPropagation();
    const dd = document.getElementById('pm-dv-dd');
    const menu = document.getElementById('pm-dv-dd-menu');
    if (!dd || !menu) return;
    if (menu.style.display !== 'none') { menu.style.display = 'none'; return; }
    menu.style.display = 'block';
    const close = (e) => { if (!dd.contains(e.target)) { menu.style.display = 'none'; document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
};

// Pick a range: update the shared input, keep the overview in sync, re-render.
window.pmDvPickRange = function(val) {
    const input = document.getElementById('pm-ov-range');
    if (input) input.value = val;
    const ovLbl = document.getElementById('pm-ov-dd-label');
    if (ovLbl) ovLbl.textContent = _pmDvRangeLabel(val);
    if (typeof pmOvApplyRange === 'function') pmOvApplyRange();
    _pmDvRender();
};

// ══════════════════════════════════════════════════════════
// 0. CONSTRUCTION PROJECTS (CRUD)
// ══════════════════════════════════════════════════════════

async function _pmLoadProjectsList() {
    const grid = document.getElementById('pm-cards-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="pm-cards-empty"><div class="pm-cards-empty-icon">⏳</div>Loading projects…</div>';
    try {
        const snap = await db.collection('constructionProjects').orderBy('clientName').get();
        _pmProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Enrich each card with real progress / balance / cadence before rendering.
        await Promise.all(_pmProjects.map(_pmComputeProjectMetrics));
        _pmRenderProjectCards(_pmProjects);
    } catch(e) {
        grid.innerHTML = `<div class="pm-cards-empty">Error loading projects: ${_esc(e.message)}</div>`;
    }
}

// Compute card metrics (progress %, balance due, this Friday, cadence) from the
// project's milestones + payment requests. Mutates the project object with `_m`.
// Any failure falls back to safe zeros so one bad project never blanks the grid.
async function _pmComputeProjectMetrics(p) {
    const m = { progressPct: 0, balanceDue: 0, thisFriday: 0, cadence: 'ontrack' };
    p._m = m;
    try {
        const [msSnap, paySnap, paSnap] = await Promise.all([
            db.collection('constructionProjects').doc(p.id).collection('milestones').get(),
            db.collection('paymentRequests').where('constructionProjectId', '==', p.id).get(),
            db.collection('constructionProjects').doc(p.id).collection('partnerAgreements').get()
                .catch(() => ({ docs: [] }))   // never break the card if this read fails
        ]);

        // Partner agreement: has any partner signed this project's terms?
        const paDocs = (paSnap.docs || []).map(d => ({ id: d.id, ...d.data() }));
        p._partner = paDocs.length
            ? paDocs.sort((a, b) => (_pmTsMs(b.acceptedAt) - _pmTsMs(a.acceptedAt)))[0]
            : null;

        // Progress: weighted by `percentage` of completed milestones; fall back to count.
        const ms = msSnap.docs.map(d => d.data());
        if (ms.length) {
            const hasPct = ms.some(x => x.percentage != null && x.percentage !== '' && !isNaN(x.percentage));
            if (hasPct) {
                m.progressPct = ms.filter(x => x.status === 'completed')
                    .reduce((s, x) => s + (Number(x.percentage) || 0), 0);
            } else {
                const done = ms.filter(x => x.status === 'completed').length;
                m.progressPct = Math.round(done / ms.length * 100);
            }
            m.progressPct = Math.max(0, Math.min(100, Math.round(m.progressPct)));
        }

        // Balance + this Friday + cadence from payment requests (mirrors _pmPayUpdateKPIs).
        const reqs = paySnap.docs.map(d => d.data());
        const open = reqs.filter(r => r.status === 'unpaid' || r.status === 'partial');
        m.balanceDue = open.reduce((s, r) => s + ((r.totalAmount || r.amount || 0) - (r.amountPaid || 0)), 0);
        const next = open.slice().sort((a, b) => (a.weekEndingDate || '').localeCompare(b.weekEndingDate || ''))[0];
        m.thisFriday = next ? (next.totalAmount || next.amount || 0) : 0;

        const today = new Date().toISOString().slice(0, 10);
        if (reqs.some(r => r.status === 'partial')) m.cadence = 'partial';
        else if (open.some(r => r.status === 'unpaid' && r.weekEndingDate && r.weekEndingDate < today)) m.cadence = 'overdue';
        else m.cadence = 'ontrack';
    } catch(e) {
        console.warn('PM: metrics failed for', p.id, e.message);
    }
    return p;
}

function _pmRenderProjectCards(projects) {
    const grid = document.getElementById('pm-cards-grid');
    if (!grid) return;
    if (!projects.length) {
        grid.innerHTML = '<div class="pm-cards-empty"><div class="pm-cards-empty-icon">🏗️</div>No projects yet. Click <strong>Add Project</strong> to create your first one.</div>';
        return;
    }
    // Render uses data-pm-id on the card + data-pm-action on each button.
    // The previous version interpolated JSON.stringify(p) into inline onclick
    // handlers — that escaped " but NOT ' or backticks, so a client name like
    // "O'Brien" or a malicious "'); alert(1); //" would break out. Now the
    // full project object is fetched from _pmProjects at click-time via the
    // delegated handler below (attached once via _handlerAttached flag).
    const cadenceBadge = {
        ontrack:  '<span class="pm-badge pm-badge-paid">On track</span>',
        partial:  '<span class="pm-badge pm-badge-partial">Partial last week</span>',
        overdue:  '<span class="pm-badge pm-badge-strict">Overdue</span>',
    };
    grid.innerHTML = projects.map(p => {
        const m       = p._m || { progressPct: 0, balanceDue: 0, thisFriday: 0, cadence: 'ontrack' };
        const balCls  = m.balanceDue > 0 ? 'color:var(--pm-danger);' : '';
        const contractVal = Number(p.budget) || 0;
        return `<div class="pm-project-card" data-pm-id="${_esc(p.id)}">
          <div class="pm-card-top">
            <div class="pm-card-names">
              <div class="pm-card-client">${_esc(p.clientName||'Unnamed Client')}</div>
              <div class="pm-card-project">${_esc(p.projectName||'—')}${p.address ? ' · ' + _esc(p.address) : ''}</div>
            </div>
            <div class="pm-card-actions">
              <button class="pm-card-icon-btn" data-pm-action="edit" title="Edit"><i data-lucide="pencil" style="width:13px;height:13px;"></i></button>
              <button class="pm-card-icon-btn del" data-pm-action="delete" title="Delete"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
            </div>
          </div>
          <div class="pm-card-progress"><div class="pm-card-progress-fill" style="width:${m.progressPct}%;"></div></div>
          <div class="pm-card-progress-pct">${m.progressPct}% complete</div>
          <div class="pm-card-contract">
            <span class="pm-card-contract-label">Project Budget</span>
            <span class="pm-card-contract-value num">${contractVal > 0 ? _fmt(contractVal) : '—'}</span>
          </div>
          <div class="pm-card-stats">
            <div class="pm-card-stat">
              <div class="pm-card-stat-label">Balance due</div>
              <div class="pm-card-stat-value num" style="${balCls}">${_fmt(m.balanceDue)}</div>
            </div>
            <div class="pm-card-stat">
              <div class="pm-card-stat-label">This Friday</div>
              <div class="pm-card-stat-value num">${_fmt(m.thisFriday)}</div>
            </div>
          </div>
          <div style="margin-top:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${cadenceBadge[m.cadence] || cadenceBadge.ontrack}
            ${p._partner
                ? `<span title="Partner signed the project terms on ${_esc(_pmTsDateStr(p._partner.acceptedAt))}${p._partner.signature ? ' — ' + _esc(p._partner.signature) : ''}" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#15803d;background:#dcfce7;padding:3px 9px;border-radius:20px;"><i data-lucide="check-circle" style="width:12px;height:12px;"></i> Partner signed · ${_esc(_pmTsDateStr(p._partner.acceptedAt))}</span>
                   <button data-pm-action="partner-agreement" style="font-size:11px;font-weight:600;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;padding:3px 9px;cursor:pointer;"><i data-lucide="file-text" style="width:11px;height:11px;vertical-align:-1px;"></i> View</button>`
                : `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;padding:3px 9px;border-radius:20px;"><i data-lucide="clock" style="width:12px;height:12px;"></i> Partner: pending</span>`}
          </div>
          <button class="pm-card-open-btn" data-pm-action="open">
            <i data-lucide="arrow-right" style="width:14px;height:14px;"></i> Open Project
          </button>
        </div>`;
    }).join('');
    if (!grid._handlerAttached) {
        grid._handlerAttached = true;
        grid.addEventListener('click', e => {
            const btn  = e.target.closest('[data-pm-action]');
            if (!btn) return;
            const card = btn.closest('[data-pm-id]');
            if (!card) return;
            const id   = card.getAttribute('data-pm-id');
            const p    = _pmProjects.find(x => x.id === id);
            if (!p) return;
            switch (btn.getAttribute('data-pm-action')) {
                case 'edit':   pmEditProject(p);     break;
                case 'delete': pmDeleteProject(p.id); break;
                case 'open':   pmOpenProject(p);     break;
                case 'partner-agreement': _pmViewPartnerAgreement(p); break;
            }
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmOpenProject = function(p) {
    _pmActiveProject = _pmProjects.find(pr => pr.id === p.id) || p;
    localStorage.setItem('pm_selected_project', p.id);
    // Fresh "This Week" draft for the newly opened project.
    _pmWeekDate = null; _pmWeekBills = []; _pmWeekEntries = []; _pmWeekEditingId = null; _pmWeekCat = 'labor'; _pmWeekStagedReceipts = []; _pmWeekEditEntryId = null; _pmWeekViewFilter = 'all'; _pmWeekViewDay = null;
    // Reset workspace to weekly tab
    document.querySelectorAll('.pm-ws-tab').forEach((t,i)  => t.classList.toggle('active', i===0));
    document.querySelectorAll('.pm-ws-panel').forEach((pn,i) => pn.classList.toggle('active', i===0));
    switchView('pmWorkspace');
};

// Deep-link target (from a push notification): open a project by id, then a tab.
window.pmOpenProjectById = async function(id, tab) {
    if (!id) return false;
    try {
        await _pmLoadProjects();   // idempotent — ensures _pmProjects is populated
        const p = (_pmProjects || []).find(pr => pr.id === id);
        if (!p) return false;
        pmOpenProject(p);          // opens the workspace (overview tab)
        if (tab && tab !== 'overview') setTimeout(() => { try { pmWsTab(tab); } catch (_) {} }, 90);
        return true;
    } catch (_) { return false; }
};

// ── Terms & Conditions PDF (per-project) ─────────────────────────
// Reflect the current PDF state (newly picked / existing / none) in the modal.
function _pmRenderTermsPdfState() {
    const nameEl = document.getElementById('pmProjectTermsPdfName');
    const rmEl   = document.getElementById('pmProjectTermsPdfRemove');
    if (!nameEl) return;
    if (_pmTermsPdfFile) {
        nameEl.textContent = _pmTermsPdfFile.name + ' (new — will upload on save)';
        nameEl.style.color = '#111827';
        if (rmEl) rmEl.style.display = '';
    } else if (_pmTermsPdfUrl) {
        nameEl.textContent = _pmTermsPdfName || 'Attached PDF';
        nameEl.style.color = '#111827';
        if (rmEl) rmEl.style.display = '';
    } else {
        nameEl.textContent = 'No PDF attached.';
        nameEl.style.color = '#6b7280';
        if (rmEl) rmEl.style.display = 'none';
    }
}

window.pmOnTermsPdfPick = function(input) {
    const f = input && input.files && input.files[0];
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
        alert('Please choose a PDF file.');
        input.value = '';
        return;
    }
    _pmTermsPdfFile = f;
    _pmRenderTermsPdfState();
};

// Upload a Terms PDF for a project → { url, name }. Path is namespaced by project.
async function _pmUploadTermsPdf(projectId, file) {
    if (typeof storage === 'undefined') throw new Error('Storage unavailable');
    const safe = String(file.name || 'terms.pdf').replace(/[^\w.\-]+/g, '_');
    const path = `projectTerms/${projectId}/${Date.now()}_${safe}`;
    const ref  = storage.ref(path);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    return { url, name: file.name || 'Terms & Conditions.pdf' };
}

window.pmRemoveTermsPdf = function() {
    _pmTermsPdfFile = null;
    _pmTermsPdfUrl  = '';
    _pmTermsPdfName = '';
    const input = document.getElementById('pmProjectTermsPdfInput');
    if (input) input.value = '';
    _pmRenderTermsPdfState();
};

window.pmOpenProjectModal = function() {
    document.getElementById('pmProjectModalTitle').textContent = 'Add Construction Project';
    document.getElementById('pmProjectId').value        = '';
    document.getElementById('pmProjectClientName').value = '';
    document.getElementById('pmProjectName').value       = '';
    document.getElementById('pmProjectEmail').value      = '';
    const _npe = document.getElementById('pmProjectPartnerEmail'); if (_npe) _npe.value = '';
    document.getElementById('pmProjectStatus').value     = 'pending_agreement';
    document.getElementById('pmProjectStartDate').value  = '';
    document.getElementById('pmProjectAddress').value    = '';
    if (document.getElementById('pmProjectPartnerTerms')) document.getElementById('pmProjectPartnerTerms').value = '';
    _pmTermsPdfFile = null; _pmTermsPdfUrl = ''; _pmTermsPdfName = '';
    const _tpi = document.getElementById('pmProjectTermsPdfInput'); if (_tpi) _tpi.value = '';
    _pmRenderTermsPdfState();
    document.getElementById('pmProjectBudget').value     = '';
    document.getElementById('pmProjectEndDate').value    = '';
    document.getElementById('pmProjectFeePct').value     = '15';
    ['err-pmProjectClientName','err-pmProjectName'].forEach(_pmClearErr);
    document.getElementById('pmProjectModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditProject = function(p) {
    document.getElementById('pmProjectModalTitle').textContent = 'Edit Construction Project';
    document.getElementById('pmProjectId').value        = p.id;
    document.getElementById('pmProjectClientName').value = p.clientName  || '';
    document.getElementById('pmProjectName').value       = p.projectName || '';
    document.getElementById('pmProjectEmail').value      = p.clientEmail || '';
    const _epe = document.getElementById('pmProjectPartnerEmail'); if (_epe) _epe.value = p.partnerEmail || '';
    document.getElementById('pmProjectStatus').value     = p.status      || 'active';
    document.getElementById('pmProjectStartDate').value  = p.startDate   || '';
    document.getElementById('pmProjectAddress').value    = p.address     || '';
    document.getElementById('pmProjectBudget').value     = (p.budget != null ? p.budget : '');
    document.getElementById('pmProjectEndDate').value    = p.plannedEndDate || '';
    document.getElementById('pmProjectFeePct').value     = (p.managementFeePct != null ? p.managementFeePct : 15);
    if (document.getElementById('pmProjectPartnerTerms')) document.getElementById('pmProjectPartnerTerms').value = p.partnerTerms || '';
    _pmTermsPdfFile = null;
    _pmTermsPdfUrl  = p.partnerTermsPdfUrl  || '';
    _pmTermsPdfName = p.partnerTermsPdfName || (p.partnerTermsPdfUrl ? 'Attached PDF' : '');
    const _tpiE = document.getElementById('pmProjectTermsPdfInput'); if (_tpiE) _tpiE.value = '';
    _pmRenderTermsPdfState();
    ['err-pmProjectClientName','err-pmProjectName'].forEach(_pmClearErr);
    document.getElementById('pmProjectModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveProject = async function() {
    const projectId  = document.getElementById('pmProjectId').value;
    const clientName = document.getElementById('pmProjectClientName').value.trim();
    const projectName= document.getElementById('pmProjectName').value.trim();
    const clientEmail= document.getElementById('pmProjectEmail').value.trim();
    const partnerEmail = (document.getElementById('pmProjectPartnerEmail')?.value || '').trim();
    const status     = document.getElementById('pmProjectStatus').value;
    const startDate  = document.getElementById('pmProjectStartDate').value;
    const address    = document.getElementById('pmProjectAddress').value.trim();
    const budgetRaw  = document.getElementById('pmProjectBudget').value.trim();
    const budget     = budgetRaw === '' ? 0 : Number(budgetRaw);
    const plannedEndDate = document.getElementById('pmProjectEndDate').value || null;
    const feePctRaw  = document.getElementById('pmProjectFeePct').value.trim();
    let   managementFeePct = feePctRaw === '' ? 15 : Number(feePctRaw);
    if (isNaN(managementFeePct) || managementFeePct < 0) managementFeePct = 15;
    if (managementFeePct > 100) managementFeePct = 100;
    const partnerTermsEl = document.getElementById('pmProjectPartnerTerms');
    const partnerTerms   = partnerTermsEl ? partnerTermsEl.value.trim() : '';

    let valid = true;
    if (!clientName)  { _pmShowErr('err-pmProjectClientName','Client name is required.'); valid = false; }
    if (!projectName) { _pmShowErr('err-pmProjectName','Project name is required.');      valid = false; }
    if (!valid) return;

    const data = { clientName, projectName, clientEmail, partnerEmail, status, startDate, address, budget, plannedEndDate, managementFeePct,
                   partnerTerms,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    // Terms PDF: if the admin removed it (no new file + no kept url), clear the
    // fields; otherwise keep the existing url (a newly-picked file is uploaded
    // after we know the project id, then written below).
    if (!_pmTermsPdfFile && !_pmTermsPdfUrl) {
        data.partnerTermsPdfUrl  = '';
        data.partnerTermsPdfName = '';
    } else if (!_pmTermsPdfFile && _pmTermsPdfUrl) {
        data.partnerTermsPdfUrl  = _pmTermsPdfUrl;
        data.partnerTermsPdfName = _pmTermsPdfName || 'Attached PDF';
    }

    // Detect a fee-rate change so we can re-bill unpaid weeks at the new rate.
    const existing  = projectId ? _pmProjects.find(p => p.id === projectId) : null;
    const oldFeePct = existing ? (existing.managementFeePct != null ? Number(existing.managementFeePct) : 15) : null;
    const feeChanged = projectId && oldFeePct !== managementFeePct;

    const btn = document.querySelector('#pmProjectModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (projectId) {
            await db.collection('constructionProjects').doc(projectId).update(data);
            // A newly-picked Terms PDF is uploaded now that we have the project id.
            if (_pmTermsPdfFile) {
                btn.textContent = 'Uploading PDF…';
                const up = await _pmUploadTermsPdf(projectId, _pmTermsPdfFile);
                await db.collection('constructionProjects').doc(projectId)
                    .update({ partnerTermsPdfUrl: up.url, partnerTermsPdfName: up.name });
            }
            // Keep the active-project copy in sync so This Week uses the new rate.
            if (_pmActiveProject && _pmActiveProject.id === projectId) _pmActiveProject.managementFeePct = managementFeePct;
            let reBilled = 0;
            if (feeChanged) {
                try { reBilled = await _pmRecomputeUnpaidBills(projectId, managementFeePct); }
                catch(e) { console.warn('PM: re-bill unpaid weeks failed', e.message); }
            }
            if (feeChanged && reBilled > 0) _pmToast(`Fee set to ${managementFeePct}% · re-billed ${reBilled} unpaid week${reBilled > 1 ? 's' : ''}`);
            else _pmToast('Project saved');
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await db.collection('constructionProjects').add(data);
            // Upload the Terms PDF against the brand-new project id, then link it.
            if (_pmTermsPdfFile && ref && ref.id) {
                btn.textContent = 'Uploading PDF…';
                const up = await _pmUploadTermsPdf(ref.id, _pmTermsPdfFile);
                await db.collection('constructionProjects').doc(ref.id)
                    .update({ partnerTermsPdfUrl: up.url, partnerTermsPdfName: up.name });
            }
            _pmToast('Project created');
        }
        _pmProjects = [];
        pmCloseModal('pmProjectModal');
        _pmLoadProjectsList();
    } catch(e) {
        _pmToast('Save failed: ' + e.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Project';
        if (window.lucide) lucide.createIcons();
    }
};

// Re-bill a project's UNPAID weekly bills at a new management-fee rate.
// Skips anything already paid or partially paid (status Paid / Partial) so money
// already collected is never altered. Only writes columns that exist on weekly_bills
// (management_fee, grand_total). Returns the number of bills updated.
async function _pmRecomputeUnpaidBills(projectId, ratePct) {
    const rate = (Number(ratePct) || 0) / 100;
    const col  = db.collection('constructionProjects').doc(projectId).collection('weeklyBills');
    const snap = await col.get();
    const writes = [];
    snap.docs.forEach(d => {
        const b = d.data();
        if (b.status === 'Paid' || b.status === 'Partial') return;   // leave settled money alone
        const direct = (b.labor || 0) + (b.materials || 0);
        const fee    = direct * rate;
        const grand  = direct + fee;
        if (Math.round(b.managementFee || 0) === Math.round(fee) &&
            Math.round(b.grandTotal   || 0) === Math.round(grand)) return;   // already current
        writes.push(col.doc(d.id).update({
            managementFee: fee,
            grandTotal:    grand,
            updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
        }));
    });
    await Promise.all(writes);
    return writes.length;
}

window.pmDeleteProject = async function(id) {
    if (!confirm('Delete this project? This removes the project from the list but does NOT delete subcollection data (weekly bills, procurement, etc.).')) return;
    try {
        await db.collection('constructionProjects').doc(id).delete();
        if (_pmActiveProject?.id === id) {
            _pmActiveProject = null;
            localStorage.removeItem('pm_selected_project');
        }
        _pmProjects = [];
        _pmLoadProjectsList();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 1. WEEKLY SUMMARY
// ══════════════════════════════════════════════════════════

async function _pmLoadWeeklyEntries() {
    const tbody = document.getElementById('pm-weekly-tbody');
    if (!tbody) return;
    if (!_pmActiveProject) {
        tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row">Select a client project above.</td></tr>';
        _pmWeeklyUpdateKPIs([]);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row" style="color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('weeklyBills')
            .orderBy('weekEndingDate', 'desc')
            .get();
        _pmWeeklyEntries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmWeeklyRenderTable(_pmWeeklyEntries);
        _pmWeeklyUpdateKPIs(_pmWeeklyEntries);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-row">Error: ${_esc(e.message)}</td></tr>`;
    }
}

function _pmWeeklyUpdateKPIs(entries) {
    const labor     = entries.reduce((s,e) => s + (e.labor     || 0), 0);
    const materials = entries.reduce((s,e) => s + (e.materials || 0), 0);
    const fee       = entries.reduce((s,e) => s + (e.managementFee || 0), 0);
    const grand     = entries.reduce((s,e) => s + (e.grandTotal    || 0), 0);
    _pmSet('pm-kpi-labor',     _fmt(labor));
    _pmSet('pm-kpi-materials', _fmt(materials));
    _pmSet('pm-kpi-fee',       _fmt(fee));
    _pmSet('pm-kpi-grand',     _fmt(grand));
}

function _pmWeeklyRenderTable(entries) {
    const tbody = document.getElementById('pm-weekly-tbody');
    if (!tbody) return;
    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="pm-empty-row">No weekly entries yet. Click "New Entry" to add one.</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(e => {
        const dateStr = e.weekEndingDate ? new Date(e.weekEndingDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
        const statusBadge = e.status === 'Paid'
            ? '<span class="pm-badge pm-badge-paid">Paid</span>'
            : e.status === 'Partial'
            ? '<span class="pm-badge pm-badge-partial">Partial</span>'
            : '<span class="pm-badge pm-badge-unpaid">Submitted</span>';
        return `<tr data-pm-id="${_esc(e.id)}">
            <td><strong>${_esc(dateStr)}</strong></td>
            <td>${_fmt(e.labor)}</td>
            <td>${_fmt(e.materials)}</td>
            <td>${_fmt(e.managementFee)}</td>
            <td><strong>${_fmt(e.grandTotal)}</strong></td>
            <td>${statusBadge}</td>
            <td>
              <button class="pm-tbl-btn pm-tbl-btn-invoice" data-pm-action="invoice"><i data-lucide="file-text" style="width:12px;height:12px;"></i> Invoice</button>
            </td>
            <td>
              <button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i> Edit</button>
              <button class="pm-tbl-btn pm-tbl-btn-delete" data-pm-action="delete"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
            </td>
        </tr>`;
    }).join('');
    if (!tbody._handlerAttached) {
        tbody._handlerAttached = true;
        tbody.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-pm-action]');
            if (!btn) return;
            const tr  = btn.closest('[data-pm-id]');
            if (!tr) return;
            const id  = tr.getAttribute('data-pm-id');
            const entry = _pmWeeklyEntries.find(x => x.id === id);
            if (!entry) return;
            if (btn.getAttribute('data-pm-action') === 'edit')    pmEditWeeklyEntry(entry);
            if (btn.getAttribute('data-pm-action') === 'delete')  pmDeleteWeeklyEntry(entry.id);
            if (btn.getAttribute('data-pm-action') === 'invoice') _pmOpenLaborInvoiceForEntry(entry);
        });
    }
    if (window.lucide) lucide.createIcons();
}

function _pmOpenLaborInvoiceForEntry(entry) {
    if (typeof switchView !== 'function' || typeof initLaborInvoiceModule !== 'function') {
        alert('Labor Invoice module is not available.');
        return;
    }
    switchView('laborInvoices');
    // Wait for the module to initialise then open a pre-filled new form
    setTimeout(async function () {
        const proj = _pmActiveProject;
        if (!proj) return;
        // Pre-load weekly entries for this project inside the labor invoice module
        if (typeof window._labInvPreFill === 'function') {
            window._labInvPreFill(proj, entry);
        }
    }, 300);
}

window.pmOpenWeeklyModal = function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    document.getElementById('pmWeeklyModalTitle').textContent = 'New Weekly Entry';
    document.getElementById('pmWeeklyEntryId').value = '';
    document.getElementById('pmWeeklyDate').value     = _nextFriday();
    document.getElementById('pmWeeklyLabor').value    = '';
    document.getElementById('pmWeeklyMaterials').value = '';
    document.getElementById('pmWeeklyNotes').value    = '';
    document.getElementById('pm-calc-fee').textContent   = '₱0.00';
    document.getElementById('pm-calc-total').textContent = '₱0.00';
    ['err-pmWeeklyDate','err-pmWeeklyLabor','err-pmWeeklyMaterials'].forEach(_pmClearErr);
    document.getElementById('pmWeeklyModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditWeeklyEntry = function(entry) {
    document.getElementById('pmWeeklyModalTitle').textContent = 'Edit Weekly Entry';
    document.getElementById('pmWeeklyEntryId').value       = entry.id;
    document.getElementById('pmWeeklyDate').value          = entry.weekEndingDate || '';
    document.getElementById('pmWeeklyLabor').value         = entry.labor    || '';
    document.getElementById('pmWeeklyMaterials').value     = entry.materials || '';
    document.getElementById('pmWeeklyNotes').value         = entry.notes   || '';
    pmWeeklyCompute();
    ['err-pmWeeklyDate','err-pmWeeklyLabor','err-pmWeeklyMaterials'].forEach(_pmClearErr);
    document.getElementById('pmWeeklyModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmWeeklyCompute = function() {
    const labor     = parseFloat(document.getElementById('pmWeeklyLabor')?.value)     || 0;
    const materials = parseFloat(document.getElementById('pmWeeklyMaterials')?.value) || 0;
    const fee   = (labor + materials) * (_pmFeePct()/100);
    const total = labor + materials + fee;
    const feeLabel = document.getElementById('pm-calc-fee-label');
    if (feeLabel) feeLabel.textContent = `Management Fee (${_pmFeePct()}%)`;
    document.getElementById('pm-calc-fee').textContent   = '₱' + fee.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
    document.getElementById('pm-calc-total').textContent = '₱' + total.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
};

window.pmSaveWeeklyEntry = async function() {
    const entryId   = document.getElementById('pmWeeklyEntryId').value;
    const weekEndingDate = document.getElementById('pmWeeklyDate').value;
    const labor     = parseFloat(document.getElementById('pmWeeklyLabor').value)     || 0;
    const materials = parseFloat(document.getElementById('pmWeeklyMaterials').value) || 0;
    const notes     = document.getElementById('pmWeeklyNotes').value.trim();

    let valid = true;
    if (!weekEndingDate) { _pmShowErr('err-pmWeeklyDate','Please select the week date.'); valid = false; }
    if (labor <= 0 && materials <= 0) { _pmShowErr('err-pmWeeklyLabor','Enter labor or materials amount.'); valid = false; }
    if (!valid) return;

    const managementFee = (labor + materials) * (_pmFeePct()/100);
    const grandTotal    = labor + materials + managementFee;
    const data = { weekEndingDate, labor, materials, managementFee, grandTotal, notes,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    const btn = document.querySelector('#pmWeeklyModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('weeklyBills');
        if (entryId) {
            await col.doc(entryId).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            data.status = 'Submitted';
            await col.add(data);
        }
        pmCloseModal('pmWeeklyModal');
        _pmLoadWeeklyEntries();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Entry';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmDeleteWeeklyEntry = async function(id) {
    if (!confirm('Delete this weekly entry? This cannot be undone.')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id).collection('weeklyBills').doc(id).delete();
        _pmLoadWeekBuilder();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 1b. THIS WEEK — inline bill builder
//   Builds one weeklyBills doc per Friday from labor/materials
//   line entries. Sums into the existing labor/materials/fee/
//   grandTotal schema (+ a new `entries` array) so the partner
//   portal KPIs, Money tab and labor-invoice prefill keep
//   reading exactly what they read before.
// ══════════════════════════════════════════════════════════
const PM_FEE_PCT = 15;   // management fee — default; editable per project

// Active project's management fee %, falling back to the 15% default.
function _pmFeePct() {
    const v = _pmActiveProject && _pmActiveProject.managementFeePct;
    return (v == null || v === '' || isNaN(v)) ? PM_FEE_PCT : Number(v);
}

function _pmPeso(n) { return '₱' + Math.round(Number(n) || 0).toLocaleString('en-US'); }
function _pmFriLabel(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-PH', { weekday:'short', month:'short', day:'numeric' });
}
function _pmShortDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-PH', { month:'short', day:'numeric' });
}
function _pmDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function _pmToday() {
    return _pmDateStr(new Date());
}
function _pmShiftDateStr(dateStr, days) {
    const d = new Date((dateStr || _pmToday()) + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return _pmDateStr(d);
}

async function _pmLoadWeekBuilder() {
    _pmStatementShow(false);   // re-entering the tab always shows the builder, not a stale statement
    if (!_pmActiveProject) {
        _pmWeekBills = []; _pmWeekEntries = []; _pmWeekEditingId = null;
        _pmSet('pm-week-date', '—');
        _pmWeekRecompute();
        const hist = document.getElementById('pm-week-history');
        if (hist) hist.innerHTML = '<div class="pmw-empty">Select a project first.</div>';
        _pmWeekShowBuilder(true);
        _pmWeekApplyCat();
        return;
    }
    _pmWeekViewDay = null;            // always land on the editable builder
    if (!_pmWeekDate) _pmWeekDate = _pmToday();
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('weeklyBills')
            .orderBy('weekEndingDate', 'desc')
            .get();
        _pmWeekBills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.warn('PM week load:', e.message);
        _pmWeekBills = [];
    }
    _pmWeekSyncDraft();
    _pmWeekRenderHistory();
    _pmWeekApplyCat();
    _pmWeekShowBuilder(true);
    _pmLoadLaborContracts();     // labor contracts picker (drawdown reads _pmWeekBills)
    _pmLoadOutsourceContracts(); // out source contracts picker (same _pmWeekBills)
}

// Load the saved bill for the selected Friday into the draft (or start empty).
function _pmWeekSyncDraft() {
    // Switching the loaded bill cancels any in-progress line edit.
    _pmWeekEditEntryId = null; _pmWeekStagedReceipts = [];
    _pmWeekSyncAddBtn();
    const bill = _pmWeekBills.find(b => b.weekEndingDate === _pmWeekDate);
    if (bill) {
        _pmWeekEditingId = bill.id;
        if (Array.isArray(bill.entries) && bill.entries.length) {
            _pmWeekEntries = bill.entries.map(e => ({
                id: _pmUid('we_'),
                type: (e.type === 'materials' || e.type === 'both') ? e.type : 'labor',
                details: e.details || '',
                amount: Number(e.amount) || 0,
                days: Number(e.days) || 0,
                qty: Number(e.qty) || 0,
                unit: e.unit || '',
                receipts: _pmEntryReceiptList(e)
            }));
        } else {
            // Legacy doc with only labor/materials totals — synthesize two lines.
            _pmWeekEntries = [];
            if (bill.labor)     _pmWeekEntries.push({ id:_pmUid('we_'), type:'labor',     details:'Labor total',     amount:Number(bill.labor)     });
            if (bill.materials) _pmWeekEntries.push({ id:_pmUid('we_'), type:'materials', details:'Materials total', amount:Number(bill.materials) });
        }
    } else {
        _pmWeekEditingId = null;
        _pmWeekEntries = [];
    }
    _pmSet('pm-week-date', _pmFriLabel(_pmWeekDate));
    const saveBtn = document.getElementById('pm-week-save-btn');
    if (saveBtn) saveBtn.textContent = _pmWeekEditingId ? 'Update daily bill' : 'Save & send to client →';
    const badge = document.getElementById('pmw-status-badge');
    if (badge) {
        const sent = !!_pmWeekEditingId;
        badge.textContent = sent ? 'SENT' : 'DRAFT';
        badge.classList.toggle('sent', sent);
    }
    _pmWeekRenderEntries();
    _pmWeekRecompute();
}

window.pmWeekShift = function(delta) {
    _pmWeekViewDay = null;               // day nav returns to the editable builder
    _pmWeekShowBuilder(true);
    _pmWeekDate = _pmShiftDateStr(_pmWeekDate, delta);
    _pmWeekSyncDraft();
    _pmWeekRenderHistory();
};

// Toggle between the editable builder and the read-only past-bill view.
function _pmWeekShowBuilder(show) {
    const b = document.getElementById('pmw-build');
    const r = document.getElementById('pmw-readonly');
    // The rail's grand total + Save belong to the editable draft; a past bill
    // renders its own totals in the read-only view, so hide the rail action then.
    const action = document.getElementById('pmw-rail-action');
    if (b) b.style.display = show ? '' : 'none';
    if (r) r.style.display = show ? 'none' : '';
    if (action) action.style.display = show ? '' : 'none';
}

// Collapse / expand a summary-rail section ('bills' or 'soa').
window.pmRailToggle = function(which) {
    const body = document.getElementById('pmw-rail-' + which + '-body');
    const chev = document.getElementById('pmw-rail-' + which + '-chev');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chev) chev.classList.toggle('open', !open);
};

// Open a past saved bill read-only (from the History sidebar).
window.pmWeekViewBill = function(id) {
    const bill = _pmWeekBills.find(b => b.id === id);
    if (!bill) return;
    _pmWeekViewDay = id;
    _pmWeekViewFilter = 'all';          // open a past bill showing everything
    _pmWeekShowBuilder(false);
    _pmWeekRenderReadonly(bill);
    _pmWeekRenderHistory();
};

window.pmWeekBackToToday = function() {
    _pmWeekViewDay = null;
    _pmWeekViewFilter = 'all';
    _pmWeekShowBuilder(true);
    _pmWeekRenderEntries();
    _pmWeekRenderHistory();
};

// Open a receipt stored on a past (read-only) bill entry.
window.pmWeekViewPastReceipt = function(billId, idx) {
    const bill = _pmWeekBills.find(b => b.id === billId);
    if (!bill || !Array.isArray(bill.entries)) return;
    const e = bill.entries[idx];
    if (!e) return;
    const srcs = _pmEntryReceiptList(e).map(r => r.url || r.dataUrl).filter(Boolean);
    if (srcs.length) pmViewReceiptList(srcs, e.details);
};

window.pmWeekAddEntry = function() {
    const detEl  = document.getElementById('pm-week-details');
    const amtEl  = document.getElementById('pm-week-amount');
    const daysEl = document.getElementById('pm-week-days');
    const qtyEl  = document.getElementById('pm-week-qty');
    const unitEl = document.getElementById('pm-week-unit');
    const type   = (_pmWeekCat === 'materials' || _pmWeekCat === 'both') ? _pmWeekCat : 'labor';   // from the segmented control
    const details= (detEl ? detEl.value : '').trim();
    const amount = amtEl ? (parseInt(String(amtEl.value).replace(/[^0-9]/g,''), 10) || 0) : 0;
    // Days is Labor-only; quantity + unit is Materials-only. Both are purely
    // informational and don't affect the amount/totals.
    const days   = (type === 'labor' && daysEl) ? (parseInt(String(daysEl.value).replace(/[^0-9]/g,''), 10) || 0) : 0;
    const qty    = (type === 'materials' && qtyEl) ? (parseInt(String(qtyEl.value).replace(/[^0-9]/g,''), 10) || 0) : 0;
    const unit   = (type === 'materials' && unitEl) ? unitEl.value : '';
    if (amount <= 0) { if (amtEl) amtEl.focus(); return; }
    const fallbackDetails = type === 'labor' ? 'Labor cost' : type === 'both' ? 'Materials & labor' : 'Materials';
    const receipts = _receiptsFromStaged(_pmWeekStagedReceipts);
    // Labor lines draw down a labor contract; Out Source ('both') lines draw down an
    // outsource contract. Materials have no contract.
    const contractId = (type === 'labor') ? ((document.getElementById('pm-week-contract') || {}).value || '')
        : (type === 'both') ? ((document.getElementById('pm-week-outsource') || {}).value || '')
        : '';
    if (_pmWeekEditEntryId) {
        // Update the line in place.
        const en = _pmWeekEntries.find(e => e.id === _pmWeekEditEntryId);
        if (en) {
            en.type = type; en.details = details || fallbackDetails; en.amount = amount;
            en.days = days; en.qty = qty; en.unit = unit;
            en.receipts = receipts; en.contractId = contractId;
        }
        _pmWeekEditEntryId = null;
    } else {
        _pmWeekEntries.push({ id:_pmUid('we_'), type, details: details || fallbackDetails, amount, days, qty, unit, receipts, contractId });
    }
    if (detEl)  detEl.value = '';
    if (amtEl)  amtEl.value = '';
    if (daysEl) daysEl.value = '';
    if (qtyEl)  qtyEl.value = '';
    const cSel = document.getElementById('pm-week-contract'); if (cSel) cSel.value = '';
    if (typeof pmWeekContractHint === 'function') pmWeekContractHint();
    const oSel = document.getElementById('pm-week-outsource'); if (oSel) oSel.value = '';
    if (typeof pmWeekOutsourceHint === 'function') pmWeekOutsourceHint();
    pmWeekClearReceipt();
    _pmWeekSyncAddBtn();
    _pmWeekRenderEntries();
    _pmWeekRecompute();
    if (detEl) detEl.focus();
};

window.pmWeekRemoveEntry = function(id) {
    if (id === _pmWeekEditEntryId) pmWeekCancelEdit();  // abort edit if we're deleting that line
    _pmWeekEntries = _pmWeekEntries.filter(e => e.id !== id);
    _pmWeekRenderEntries();
    _pmWeekRecompute();
};

// Meta line for an entry: "6 days" (labor) or "50 bags" (materials).
function _pmWeekMeta(e) {
    if (e.type === 'labor') return e.days ? (e.days + (e.days === 1 ? ' day' : ' days')) : '';
    const q = e.qty ? String(e.qty) : '';
    return q + (e.qty && e.unit ? ' ' + e.unit : (e.unit || ''));
}

// Switch the active category in the segmented control (Labor / Materials / Mat + Labor).
window.pmWeekSetCat = function(cat) {
    _pmWeekCat = (cat === 'materials' || cat === 'both') ? cat : 'labor';
    _pmWeekApplyCat();
    const det = document.getElementById('pm-week-details');
    if (det) det.focus();
};

// Reflect _pmWeekCat in the UI (segmented highlight, prompt, adaptive fields).
function _pmWeekApplyCat() {
    const cat = _pmWeekCat;
    [['labor', 'pmw-seg-labor'], ['materials', 'pmw-seg-materials'], ['both', 'pmw-seg-both']].forEach(([c, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', cat === c);
    });
    const det = document.getElementById('pm-week-details');
    if (det) det.placeholder = cat === 'labor' ? 'Labor details (e.g. Masonry crew)'
        : cat === 'both' ? 'Supply & install (e.g. Aluminum windows)'
        : 'Materials details (e.g. Cement)';
    // Add-card header reflects the active category (label + colored dot).
    const addLabel = document.getElementById('pmw-addcard-label');
    if (addLabel) addLabel.textContent = cat === 'both' ? 'New out source entry'
        : cat === 'materials' ? 'New materials entry' : 'New labor entry';
    const addDot = document.getElementById('pmw-addcard-dot');
    if (addDot) addDot.style.background = cat === 'both' ? '#7a5bb5'
        : cat === 'materials' ? '#5b6b7e' : '#157a52';
    // Days is Labor-only; quantity + unit is Materials-only; Mat + Labor has neither.
    const daysWrap = document.getElementById('pm-week-days-wrap');
    if (daysWrap) daysWrap.style.display = cat === 'labor' ? '' : 'none';
    const qtyWrap = document.getElementById('pm-week-qty-wrap');
    if (qtyWrap) qtyWrap.style.display = cat === 'materials' ? '' : 'none';
    // "Pay against contract" picker is Labor-only; the Out Source one is 'both'-only.
    const contractWrap = document.getElementById('pm-week-contract-wrap');
    if (contractWrap) contractWrap.style.display = cat === 'labor' ? '' : 'none';
    if (typeof pmWeekContractHint === 'function') pmWeekContractHint();
    const outsourceWrap = document.getElementById('pm-week-outsource-wrap');
    if (outsourceWrap) outsourceWrap.style.display = cat === 'both' ? '' : 'none';
    if (typeof pmWeekOutsourceHint === 'function') pmWeekOutsourceHint();
    _pmWeekRenderEntries();
    _pmWeekRenderAttach();
}

// Highlight the active view-filter pill (All / Labor / Materials / Mat + Labor).
function _pmWeekApplyViewFilter() {
    ['all', 'labor', 'materials', 'both'].forEach(f => {
        const b = document.getElementById('pmw-vf-' + f);
        if (b) b.classList.toggle('active', _pmWeekViewFilter === f);
    });
}

window.pmWeekViewFilter = function(f) {
    _pmWeekViewFilter = (f === 'labor' || f === 'materials' || f === 'both') ? f : 'all';
    if (_pmWeekViewDay) {
        const bill = _pmWeekBills.find(b => b.id === _pmWeekViewDay);
        if (bill) _pmWeekRenderReadonly(bill);
    } else {
        _pmWeekRenderEntries();
    }
};

// ── per-line receipt image (Labor / Materials / Mat + Labor all support it) ──

// Stage the chosen image(s) in the add-row; they get attached to the next line added.
// Multiple files can be picked at once, and picking again appends rather than replaces.
window.pmWeekStageReceipt = function(input) {
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) return;
    let skipped = 0, pending = 0;
    files.forEach(file => {
        if (!file.type.startsWith('image/')) { skipped++; return; }
        pending++;
        const reader = new FileReader();
        reader.onload = e => {
            _pmWeekStagedReceipts.push({ file, dataUrl: e.target.result, url: '' });
            _pmWeekRenderAttach();
        };
        reader.readAsDataURL(file);
    });
    if (skipped) _pmToast(`${skipped} file${skipped === 1 ? '' : 's'} skipped — receipts must be images.`, true);
    input.value = '';   // allow re-picking the same file later
    if (!pending) _pmWeekRenderAttach();
};

// Remove one staged receipt by index.
window.pmWeekRemoveStagedReceipt = function(idx) {
    _pmWeekStagedReceipts.splice(idx, 1);
    _pmWeekRenderAttach();
};

window.pmWeekClearReceipt = function() {
    _pmWeekStagedReceipts = [];
    const input = document.getElementById('pm-week-receipt-input');
    if (input) input.value = '';
    _pmWeekRenderAttach();
};

function _pmWeekRenderAttach() {
    const btn   = document.getElementById('pm-week-attach-btn');
    const label = document.getElementById('pmw-receipt-label');
    const thumb = document.getElementById('pm-week-attach-thumb');
    const n = _pmWeekStagedReceipts.length;
    if (btn) btn.classList.toggle('attached', n > 0);
    if (label) label.textContent = n > 0 ? (n === 1 ? '1 receipt' : n + ' receipts') : 'Attach receipt';
    if (thumb) {
        if (n > 0) {
            thumb.style.display = 'flex';
            thumb.innerHTML = _pmWeekStagedReceipts.map((r, i) =>
                `<span class="pmw-attach-thumb-item"><img src="${_esc(r.dataUrl || r.url)}" alt="receipt"><button type="button" class="pmw-attach-x" title="Remove receipt" onclick="pmWeekRemoveStagedReceipt(${i})">×</button></span>`
            ).join('');
        } else {
            thumb.style.display = 'none';
            thumb.innerHTML = '';
        }
    }
}

// View an entry's receipts (works for both not-yet-saved data URLs and saved URLs).
window.pmWeekViewEntryReceipt = function(id) {
    const e = _pmWeekEntries.find(x => x.id === id);
    if (!e) return;
    const srcs = _pmEntryReceiptList(e).map(r => r.dataUrl || r.url).filter(Boolean);
    if (srcs.length) pmViewReceiptList(srcs, e.details);
};

// Normalize an entry's receipts into [{ file, dataUrl, url }], tolerating both the
// new receipts[] shape (array of url strings or objects) and the legacy single
// receiptUrl/receiptDataUrl/receiptFile fields on older bills.
function _pmEntryReceiptList(e) {
    if (Array.isArray(e.receipts) && e.receipts.length) {
        return e.receipts.map(r => typeof r === 'string'
            ? { file: null, dataUrl: '', url: r }
            : { file: r.file || null, dataUrl: r.dataUrl || '', url: r.url || '' });
    }
    if (e.receiptUrl || e.receiptDataUrl || e.receiptFile) {
        return [{ file: e.receiptFile || null, dataUrl: e.receiptDataUrl || '', url: e.receiptUrl || '' }];
    }
    return [];
}

// Copy the staged add-row receipts into an entry's receipts[] (fresh array).
function _receiptsFromStaged(arr) {
    return (arr || []).map(s => ({ file: s.file || null, dataUrl: s.dataUrl || '', url: s.url || '' }));
}

// Reflect add/edit mode on the action button (+ Add ↔ Save) and the Cancel button.
function _pmWeekSyncAddBtn() {
    const addBtn = document.getElementById('pm-week-add-btn');
    const cancel = document.getElementById('pm-week-cancel-btn');
    if (addBtn) addBtn.textContent = _pmWeekEditEntryId ? 'Save changes' : '+ Add to bill';
    if (cancel) cancel.style.display = _pmWeekEditEntryId ? '' : 'none';
}

// Load an existing line back into the add-row for editing.
window.pmWeekEditEntry = function(id) {
    const en = _pmWeekEntries.find(e => e.id === id);
    if (!en) return;
    _pmWeekEditEntryId = id;
    _pmWeekCat = (en.type === 'materials' || en.type === 'both') ? en.type : 'labor';
    _pmWeekStagedReceipts = _pmEntryReceiptList(en).map(r => ({ file: r.file || null, dataUrl: r.dataUrl || '', url: r.url || '' }));
    _pmWeekApplyCat();   // tab highlight, field visibility, list, attach thumb
    const detEl  = document.getElementById('pm-week-details'); if (detEl)  detEl.value  = en.details || '';
    const amtEl  = document.getElementById('pm-week-amount');  if (amtEl)  amtEl.value  = en.amount || '';
    const daysEl = document.getElementById('pm-week-days');    if (daysEl) daysEl.value = en.days || '';
    const qtyEl  = document.getElementById('pm-week-qty');     if (qtyEl)  qtyEl.value  = en.qty || '';
    const unitEl = document.getElementById('pm-week-unit');    if (unitEl && en.unit) unitEl.value = en.unit;
    const cSel = document.getElementById('pm-week-contract'); if (cSel) cSel.value = (en.type === 'labor' ? (en.contractId || '') : '');
    if (typeof pmWeekContractHint === 'function') pmWeekContractHint();
    const oSel = document.getElementById('pm-week-outsource'); if (oSel) oSel.value = (en.type === 'both' ? (en.contractId || '') : '');
    if (typeof pmWeekOutsourceHint === 'function') pmWeekOutsourceHint();
    _pmWeekSyncAddBtn();
    if (detEl) { detEl.focus(); detEl.scrollIntoView({ block: 'nearest' }); }
};

window.pmWeekCancelEdit = function() {
    _pmWeekEditEntryId = null;
    ['pm-week-details','pm-week-amount','pm-week-days','pm-week-qty'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    pmWeekClearReceipt();   // clears staged + re-renders the attach control
    _pmWeekSyncAddBtn();
};

// Per-category visual tokens for the grouped entry list (header chip + row accent).
function _pmWeekCatStyle(type) {
    if (type === 'materials') return { name: 'MATERIALS',   tag: 'MATERIAL',  accent: '#5b6b7e', headBg: '#eef0f3', headBorder: '#d8dee6', text: '#3f4d5e', count: '#7e8a98' };
    if (type === 'both')      return { name: 'OUT SOURCE', tag: 'OUTSOURCE', accent: '#7a5bb5', headBg: '#efeaf8', headBorder: '#e0d5f3', text: '#5b3f96', count: '#9882bd' };
    return { name: 'LABOR', tag: 'LABOR', accent: '#157a52', headBg: '#eaf4ef', headBorder: '#c6e6d5', text: '#0f6342', count: '#5e9d80' };
}

const _PMW_GROUP_TYPES = ['labor', 'materials', 'both'];

function _pmWeekEntryRow(e) {
    const st = _pmWeekCatStyle(e.type);
    const meta = _pmWeekMeta(e);
    const rcptN = _pmEntryReceiptList(e).length;
    const rcpt = rcptN
        ? `${meta ? ' · ' : ''}<span class="pmw-rcpt-txt" onclick="pmWeekViewEntryReceipt('${e.id}')">RCPT ✓${rcptN > 1 ? ' ×' + rcptN : ''}</span>`
        : '';
    const metaHtml = (meta || rcpt) ? `<div class="pmw-entry-meta">${meta ? _esc(meta) : ''}${rcpt}</div>` : '';
    return `<div class="pmw-entry" style="border-left:3px solid ${st.accent};">
        <div class="pmw-entry-main">
          <div class="pmw-entry-details">${_esc(e.details)}</div>
          ${metaHtml}
        </div>
        <span class="pmw-entry-amt num">${_pmPeso(e.amount)}</span>
        <button class="pmw-entry-edit-txt" onclick="pmWeekEditEntry('${e.id}')">Edit</button>
        <button class="pmw-entry-del" aria-label="Remove" title="Remove" onclick="pmWeekRemoveEntry('${e.id}')">×</button>
      </div>`;
}

// Group header line above a category card: "LABOR · 2 lines" + subtotal (design style).
function _pmWeekGroupHead(type, count, sum, topGap) {
    const st = _pmWeekCatStyle(type);
    const cnt = count != null ? ' · ' + count + ' line' + (count === 1 ? '' : 's') : '';
    return `<div class="pmw-grp-line"${topGap ? ' style="margin-top:16px;"' : ''}>
        <span class="pmw-grp-tag" style="color:${st.text};">${st.name}${cnt}</span>
        <span class="pmw-grp-sum num">${_pmPeso(sum)}</span>
      </div>`;
}

function _pmWeekRenderEntries() {
    _pmWeekApplyViewFilter();
    const host = document.getElementById('pm-week-entries');
    if (!host) return;
    if (!_pmWeekEntries.length) {
        host.innerHTML = '<div class="pmw-empty-box">Nothing logged yet — add your first labor or materials cost above.</div>';
        return;
    }
    const f = _pmWeekViewFilter;
    let html = '', first = true;
    _PMW_GROUP_TYPES.forEach(type => {
        const list = _pmWeekEntries.filter(e => e.type === type);
        if (!list.length || (f !== 'all' && f !== type)) return;
        const sum = list.reduce((s, e) => s + e.amount, 0);
        html += _pmWeekGroupHead(type, list.length, sum, !first);
        // Per-category search box — only when there's enough to search (2+ lines).
        if (list.length > 1) html += _pmWeekGroupSearch(type);
        html += `<div class="pmw-grp-card" data-pmw-grp="${type}">${list.map(_pmWeekEntryRow).join('')}</div>`;
        first = false;
    });
    if (!html) html = '<div class="pmw-empty-box">No entries in this view.</div>';
    host.innerHTML = html;
    _pmWeekWireGroupSearch(host);
}

// Per-category search box shown under a group header. `data-pmw-search`
// identifies which group card it filters.
function _pmWeekGroupSearch(type) {
    const noun = type === 'both' ? 'out source' : type;
    return `<div class="pmw-grp-search">
        <svg class="pmw-grp-search-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="pmw-grp-search-input" data-pmw-search="${type}" placeholder="Search ${_esc(noun)}…" aria-label="Search ${_esc(noun)} entries" autocomplete="off">
      </div>`;
}

// Wire each per-category search box to filter its group's rows by name/details.
function _pmWeekWireGroupSearch(host) {
    host.querySelectorAll('.pmw-grp-search-input').forEach(input => {
        const type = input.getAttribute('data-pmw-search');
        const card = host.querySelector(`.pmw-grp-card[data-pmw-grp="${type}"]`);
        if (!card) return;
        const rows = [...card.querySelectorAll('.pmw-entry')];
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            let shown = 0;
            rows.forEach(row => {
                const name = (row.querySelector('.pmw-entry-details')?.textContent || '').toLowerCase();
                const hit = !q || name.includes(q);
                row.style.display = hit ? '' : 'none';
                if (hit) shown++;
            });
            let empty = card.querySelector('.pmw-grp-noresult');
            if (shown === 0) {
                if (!empty) {
                    empty = document.createElement('div');
                    empty.className = 'pmw-grp-noresult';
                    empty.textContent = 'No matching entries.';
                    card.appendChild(empty);
                }
                empty.style.display = '';
            } else if (empty) {
                empty.style.display = 'none';
            }
        });
    });
}

function _pmWeekTotals() {
    const labor    = _pmWeekEntries.filter(e=>e.type==='labor').reduce((s,e)=>s+e.amount,0);
    const matsPure = _pmWeekEntries.filter(e=>e.type==='materials').reduce((s,e)=>s+e.amount,0);
    const combined = _pmWeekEntries.filter(e=>e.type==='both').reduce((s,e)=>s+e.amount,0);
    // `mats` is the client-facing materials figure and folds in combined (supply &
    // install) so all client/billing code stays correct. The admin overview reads
    // the separate `combined` field to report pure materials vs combined.
    const mats   = matsPure + combined;
    const direct = labor + mats;
    const fee = direct * (_pmFeePct()/100);
    return { labor, matsPure, combined, mats, direct, fee, grand: direct + fee };
}

function _pmWeekRecompute() {
    const t = _pmWeekTotals();
    _pmSet('pm-week-direct',  _pmPeso(t.direct));
    _pmSet('pm-week-fee-amt', _pmPeso(t.fee));
    _pmSet('pm-week-grand',   _pmPeso(t.grand));
    _pmSet('pm-week-fee-pct', _pmFeePct());
    // "Today so far" sidebar summary (Materials shown pure; combined gets its own row).
    _pmSet('pmw-today-labor',     _pmPeso(t.labor));
    _pmSet('pmw-today-materials', _pmPeso(t.matsPure));
    _pmSet('pmw-today-both',      _pmPeso(t.combined));
    _pmSet('pmw-today-grand',     _pmPeso(t.grand));
    const bothRow = document.getElementById('pmw-today-both-row');
    if (bothRow) bothRow.style.display = t.combined > 0 ? '' : 'none';
}

function _pmWeekStatusMeta(status) {
    if (status === 'Paid')    return { label: 'Paid',    bg: '#eaf4ef', color: '#0f6342', border: '#c6e6d5', dot: '#157a52' };
    if (status === 'Partial') return { label: 'Partial', bg: '#f8ecea', color: '#8f352c', border: '#f0cdc8', dot: '#b4453a' };
    return { label: 'Sent', bg: '#f6f3ec', color: '#7c6a45', border: '#e6ddcb', dot: '#9a8a6b' };
}

function _pmWeekRenderHistory() {
    const host = document.getElementById('pm-week-history');
    const countEl = document.getElementById('pmw-hist-count');
    const monthEl = document.getElementById('pmw-month-total');
    if (!host) return;
    const bills = _pmWeekBills.slice().sort((a, b) => (b.weekEndingDate || '').localeCompare(a.weekEndingDate || ''));
    if (countEl) countEl.textContent = bills.length + ' bill' + (bills.length === 1 ? '' : 's');
    if (monthEl) monthEl.textContent = _pmPeso(bills.reduce((s, b) => s + (Number(b.grandTotal) || 0), 0));
    _pmWeekRenderSOATotals();
    if (!bills.length) { host.innerHTML = '<div class="pmw-empty">No bills sent yet.</div>'; return; }
    host.innerHTML = bills.map(b => {
        const m = _pmWeekStatusMeta(b.status);
        const n = Array.isArray(b.entries) ? b.entries.length : 0;
        const active = _pmWeekViewDay === b.id;
        return `<button class="pmw-hist-row${active ? ' active' : ''}" onclick="pmWeekViewBill('${_esc(b.id)}')">
            <div class="pmw-hist-main">
              <div class="pmw-hist-date">${_esc(_pmFriLabel(b.weekEndingDate))}</div>
              <div class="pmw-hist-sub num">${_pmPeso(b.grandTotal || 0)} · ${n} item${n === 1 ? '' : 's'}</div>
            </div>
            <span class="pmw-hist-pill" style="background:${m.bg};color:${m.color};border-color:${m.border};"><span class="pmw-hist-dot" style="background:${m.dot};"></span>${m.label}</span>
            <span class="pmw-hist-chev">›</span>
          </button>`;
    }).join('');
}

// Per-category all-bills totals shown beside each Statement of Account row.
function _pmWeekRenderSOATotals() {
    [['labor', 'pmw-soa-labor'], ['materials', 'pmw-soa-materials'], ['both', 'pmw-soa-both']].forEach(([t, id]) => {
        const total = _pmCatRows(t).reduce((s, r) => s + (Number(r.amount) || 0), 0);
        _pmSet(id, _pmPeso(total));
    });
}

// Read-only render of a past, already-sent bill.
function _pmWeekRoRow(e, billId, idx) {
    const st = _pmWeekCatStyle(e.type);
    const meta = _pmWeekMeta(e);
    const metaHtml = meta ? `<div class="pmw-entry-meta">${_esc(meta)}</div>` : '';
    const rcList = _pmEntryReceiptList(e);
    const rcN = rcList.length;
    const rcpt = rcN
        ? `<button class="pmw-entry-rcpt" title="View receipt${rcN > 1 ? 's' : ''}" onclick="pmWeekViewPastReceipt('${_esc(billId)}',${idx})"><img src="${_esc(rcList[0].url || rcList[0].dataUrl)}" alt="receipt">${rcN > 1 ? `<span class="pmw-rcpt-count">${rcN}</span>` : ''}</button>`
        : '';
    return `<div class="pmw-entry ro" style="border-left:3px solid ${st.accent};">
        <div class="pmw-entry-main">
          <div class="pmw-entry-titlerow"><span class="pmw-entry-tag" style="background:${st.headBg};color:${st.text};">${st.tag}</span><span class="pmw-entry-details">${_esc(e.details)}</span></div>
          ${metaHtml}
        </div>
        ${rcpt}
        <span class="pmw-entry-amt num">${_pmPeso(e.amount)}</span>
      </div>`;
}

function _pmWeekRenderReadonly(bill) {
    const host = document.getElementById('pmw-readonly');
    if (!host) return;
    const entries = Array.isArray(bill.entries) ? bill.entries : [];
    const entriesSum = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const fee = Number(bill.managementFee) || 0;
    const direct = Number(bill.directCostTotal) || entriesSum || ((Number(bill.grandTotal) || 0) - fee);
    const grand = Number(bill.grandTotal) || (direct + fee);
    const feePct = direct > 0 ? Math.round(fee / direct * 100) : _pmFeePct();
    const m = _pmWeekStatusMeta(bill.status);
    let html = `<div class="pmw-ro-bar">
        <button class="pmw-ro-back" onclick="pmWeekBackToToday()" aria-label="Back to today"><span style="font-size:18px;line-height:1;">‹</span></button>
        <div class="pmw-ro-bar-main">
          <div class="pmw-ro-bar-title">${_esc(_pmFriLabel(bill.weekEndingDate))}</div>
          <div class="pmw-ro-bar-sub">Bill already sent — view only</div>
        </div>
        <span class="pmw-hist-pill" style="background:${m.bg};color:${m.color};border-color:${m.border};"><span class="pmw-hist-dot" style="background:${m.dot};"></span>${m.label}</span>
      </div>
      <div class="pmw-ro-total">
        <div class="pmw-ro-total-label">Grand total · ${m.label}</div>
        <div class="pmw-ro-total-amt num">${_pmPeso(grand)}</div>
        <div class="pmw-ro-total-sub">Direct ${_pmPeso(direct)} · Fee ${_pmPeso(fee)}</div>
      </div>
      <div class="pmw-ro-body">`;
    // category filter tabs (same behaviour as the editable view)
    if (entries.length) {
        const tabs = [['all', 'All'], ['labor', 'Labor'], ['materials', 'Materials'], ['both', 'Out Source']];
        const tcol = { all: '#1c1c1a', labor: '#0f6342', materials: '#3f4d5e', both: '#5b3f96' };
        html += '<div class="pmw-viewtabs" style="margin:4px 0 14px;">' + tabs.map(([f, l]) => {
            const a = _pmWeekViewFilter === f;
            return `<button class="${a ? 'active' : ''}"${a ? ` style="color:${tcol[f]};"` : ''} onclick="pmWeekViewFilter('${f}')">${l}</button>`;
        }).join('') + '</div>';
    }
    let first = true, shown = 0;
    _PMW_GROUP_TYPES.forEach(type => {
        const list = entries.map((e, i) => ({ e, i })).filter(x => x.e.type === type);
        if (!list.length || (_pmWeekViewFilter !== 'all' && _pmWeekViewFilter !== type)) return;
        const sum = list.reduce((s, x) => s + (Number(x.e.amount) || 0), 0);
        html += _pmWeekGroupHead(type, null, sum, !first);
        html += list.map(x => _pmWeekRoRow(x.e, bill.id, x.i)).join('');
        first = false; shown++;
    });
    if (entries.length && !shown) html += '<div class="pmw-empty-box">No entries in this view.</div>';
    if (!entries.length) {  // legacy bill without an entries[] array
        if (bill.labor)     { html += _pmWeekGroupHead('labor', null, Number(bill.labor) || 0, false) + `<div class="pmw-entry ro" style="border-left:3px solid #157a52;"><div class="pmw-entry-main"><div class="pmw-entry-details">Labor total</div></div><span class="pmw-entry-amt num">${_pmPeso(bill.labor)}</span></div>`; }
        if (bill.materials) { html += _pmWeekGroupHead('materials', null, Number(bill.materials) || 0, !!bill.labor) + `<div class="pmw-entry ro" style="border-left:3px solid #5b6b7e;"><div class="pmw-entry-main"><div class="pmw-entry-details">Materials total</div></div><span class="pmw-entry-amt num">${_pmPeso(bill.materials)}</span></div>`; }
    }
    html += `<button class="pmw-print" onclick="window.print()">Print this bill</button></div>`;
    host.innerHTML = html;
}

// ── Per-category Statement of Account (project-wide) ──────────────────
// Gathers every entry of one category across all the project's bills.
function _pmCatRows(type) {
    const rows = [];
    (_pmWeekBills || []).slice()
        .sort((a, b) => (a.weekEndingDate || '').localeCompare(b.weekEndingDate || ''))
        .forEach(b => {
            if (Array.isArray(b.entries) && b.entries.length) {
                b.entries.filter(e => e.type === type).forEach(e => rows.push({
                    date: b.weekEndingDate, details: e.details, amount: Number(e.amount) || 0,
                    days: Number(e.days) || 0, qty: Number(e.qty) || 0, unit: e.unit || ''
                }));
            } else {
                // Legacy bill without an entries[] array — synthesize from totals.
                if (type === 'labor' && b.labor)         rows.push({ date: b.weekEndingDate, details: 'Labor total',     amount: Number(b.labor) || 0 });
                else if (type === 'materials' && b.materials) rows.push({ date: b.weekEndingDate, details: 'Materials total', amount: Number(b.materials) || 0 });
                else if (type === 'both' && b.combined)  rows.push({ date: b.weekEndingDate, details: 'Materials & labor', amount: Number(b.combined) || 0 });
            }
        });
    return rows;
}

// View every entry that makes up a category's Statement-of-Account total.
// Opens a modal listing each Labor / Materials / Mat+Labor entry across all the
// project's daily bills (date · details · qty/days · amount), with a shortcut to
// still generate the PDF. Triggered by clicking a Statement-of-account row.
// Toggle the full-page statement view against the Daily Expenses builder.
function _pmStatementShow(show) {
    const panel = document.getElementById('ws-panel-week');
    if (!panel) return;
    const head = panel.querySelector('.pmw-pagehead');
    const grid = panel.querySelector('.pmw-grid');
    const stmt = document.getElementById('pmw-statement');
    if (head) head.style.display = show ? 'none' : '';
    if (grid) grid.style.display = show ? 'none' : '';
    if (stmt) stmt.style.display = show ? '' : 'none';
}
window.pmCatViewClose = function() {
    _pmStatementShow(false);
    if (window.innerWidth <= 700) window.scrollTo({ top: 0, behavior: 'auto' });
};

window.pmCatView = function(type) {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    const host = document.getElementById('pmw-statement');
    if (!host) return;
    const t      = (type === 'materials' || type === 'both') ? type : 'labor';
    const label  = t === 'both' ? 'Out Source' : t === 'materials' ? 'Materials' : 'Labor';
    const accent = t === 'both' ? '#7a5bb5' : t === 'materials' ? '#5b6b7e' : '#157a52';
    const code   = t === 'both' ? 'MLB' : t === 'materials' ? 'MAT' : 'LAB';
    const rows   = _pmCatRows(t);
    const total  = rows.reduce((s, r) => s + r.amount, 0);

    // Period (earliest–latest entry date) for the summary band.
    const dates  = rows.map(r => r.date).filter(Boolean).slice().sort();
    const period = dates.length
        ? (dates[0] === dates[dates.length - 1]
            ? _pmShortDate(dates[0])
            : _pmShortDate(dates[0]) + ' – ' + _pmShortDate(dates[dates.length - 1]))
        : '—';

    // Split a YYYY-MM-DD date into a day-number + month badge.
    const badge = (d) => {
        const dt = d ? new Date(d + 'T00:00:00') : null;
        if (!dt || isNaN(dt.getTime())) return { day: '–', mon: '' };
        return { day: dt.getDate(), mon: dt.toLocaleDateString('en-US', { month: 'short' }) };
    };

    const list = rows.length ? rows.map(r => {
        const b = badge(r.date);
        const meta = r.days ? `${r.days} day${r.days === 1 ? '' : 's'}`
                   : (r.qty ? `${r.qty}${r.unit ? ' ' + _esc(r.unit) : ''}`
                   : `Daily bill · ${_esc(_pmShortDate(r.date))}`);
        const search = `${r.details || ''} ${_pmShortDate(r.date)}`.toLowerCase();
        return `<div class="pmcv-row" data-pmcv-search="${_esc(search)}">
            <div class="pmcv-date"><div class="pmcv-date-day">${b.day}</div><div class="pmcv-date-mon">${_esc(b.mon)}</div></div>
            <div class="pmcv-main"><div class="pmcv-title">${_esc(r.details || '—')}</div><div class="pmcv-sub">${meta}</div></div>
            <div class="pmcv-amt num">${_pmPeso(r.amount)}</div>
        </div>`;
    }).join('') : `<div class="pmcv-empty">No ${label.toLowerCase()} entries recorded yet.</div>`;

    const noun = t === 'both' ? 'out source' : t === 'materials' ? 'materials' : 'labor';

    const _pdfIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>';

    host.innerHTML = `
      <div class="pmst-card">
        <div class="pmst-head">
          <div class="pmst-head-left">
            <button class="pmst-back" type="button" onclick="pmCatViewClose()"><span class="pmst-back-ico">‹</span><span class="pmst-back-txt">Back to Daily Expenses</span></button>
            <div class="pmst-head-title"><span class="pmst-dot" style="background:${accent};"></span><span>${label} — all entries</span></div>
          </div>
          <button class="pmst-pdf" type="button" onclick="pmCatSOA('${t}')">${_pdfIcon} Generate PDF</button>
        </div>
        <!-- desktop summary: 4 tiles -->
        <div class="pmst-summary">
          <div class="pmst-tile"><div class="pmst-tile-label">Total · ${label}</div><div class="pmst-tile-val num" style="color:${accent};">${_pmPeso(total)}</div></div>
          <div class="pmst-tile"><div class="pmst-tile-label">Entries</div><div class="pmst-tile-val num">${rows.length}</div></div>
          <div class="pmst-tile"><div class="pmst-tile-label">Period</div><div class="pmst-tile-val2">${_esc(period)}</div></div>
          <div class="pmst-tile"><div class="pmst-tile-label">Reference</div><div class="pmst-tile-val2">SOA-${code}</div></div>
        </div>
        <!-- mobile summary: total leads + pills -->
        <div class="pmst-summary-m">
          <div class="pmst-m-label">Total · ${label}</div>
          <div class="pmst-m-val num" style="color:${accent};">${_pmPeso(total)}</div>
          <div class="pmst-m-pills">
            <span class="pmst-pill">${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}</span>
            <span class="pmst-pill">${_esc(period)}</span>
            <span class="pmst-pill">SOA-${code}</span>
          </div>
        </div>
        ${rows.length > 1 ? `<div class="pmst-search">
          <svg class="pmst-search-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" id="pmcv-search" class="pmst-search-input" placeholder="Search ${_esc(noun)} entries…" aria-label="Search ${_esc(noun)} entries" autocomplete="off">
        </div>` : ''}
        <div class="pmst-list">
          <div class="pmst-listhead"><span class="pmst-c-date">Date</span><span class="pmst-c-details">Details</span><span class="pmst-c-amt">Amount</span></div>
          ${list}
          <div class="pmcv-noresult" style="display:none;">No matching entries.</div>
        </div>
        <div class="pmst-total"><span>Total · ${label}</span><span class="num" style="color:${accent};">${_pmPeso(total)}</span></div>
      </div>
      <button class="pmst-foot-pdf" type="button" onclick="pmCatSOA('${t}')">${_pdfIcon} Generate PDF</button>`;

    // Live search: filter the entry rows by name / date.
    const search = host.querySelector('#pmcv-search');
    if (search) {
        const rowEls = [...host.querySelectorAll('.pmcv-row')];
        const noRes  = host.querySelector('.pmcv-noresult');
        search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase();
            let shown = 0;
            rowEls.forEach(row => {
                const hit = !q || (row.getAttribute('data-pmcv-search') || '').includes(q);
                row.style.display = hit ? '' : 'none';
                if (hit) shown++;
            });
            if (noRes) noRes.style.display = (q && shown === 0) ? '' : 'none';
        });
    }

    _pmStatementShow(true);
    if (window.innerWidth <= 700) window.scrollTo({ top: 0, behavior: 'auto' });
};

// Normalize a labor name for fuzzy comparison: lowercase, trim, collapse inner
// whitespace, drop punctuation. 'Francis ' / 'francis' / 'Francis.' all match.
function _pmNameKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Levenshtein edit distance — used to catch typo variants like Franics/Francis.
function _pmEditDistance(a, b) {
    a = a || ''; b = b || '';
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let cur = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[b.length];
}

// Two names are "the same person" when their normalized keys are within a small
// edit distance (scaled to length) — merges typos like Franics ≈ Francis while
// keeping clearly different names (Francis vs Danilo) apart.
function _pmNamesSimilar(a, b) {
    const ka = _pmNameKey(a), kb = _pmNameKey(b);
    if (!ka || !kb) return ka === kb;
    if (ka === kb) return true;
    const d = _pmEditDistance(ka, kb);
    const maxLen = Math.max(ka.length, kb.length);
    // Allow 1 typo for short names, ~15% of length for longer ones; require a
    // shared first letter so unrelated short names don't collapse together.
    const threshold = maxLen <= 5 ? 1 : Math.max(2, Math.round(maxLen * 0.15));
    return d <= threshold && ka[0] === kb[0];
}

// Group a project's labor rows into one entry per person, merging fuzzy name
// variants. Returns [{ canonical, variants:[names], total, count }] where
// `canonical` is the most-used (then longest) spelling — the display + filter key.
function _pmLaborNameGroups(rows) {
    // First, exact aggregate per raw name (preserves per-spelling totals/counts).
    const exact = new Map();
    rows.forEach(r => {
        const name = (r.details || '').trim() || 'Labor cost';
        const cur = exact.get(name) || { name, total: 0, count: 0 };
        cur.total += Number(r.amount) || 0; cur.count += 1;
        exact.set(name, cur);
    });

    // Then cluster those raw names by fuzzy similarity.
    const groups = [];
    [...exact.values()].forEach(item => {
        const g = groups.find(grp => grp.variants.some(v => _pmNamesSimilar(v.name, item.name)));
        if (g) { g.variants.push(item); g.total += item.total; g.count += item.count; }
        else   { groups.push({ variants: [item], total: item.total, count: item.count }); }
    });

    // Canonical spelling = highest count, tie-break by longest string.
    groups.forEach(g => {
        const best = g.variants.slice().sort((a, b) =>
            (b.count - a.count) || (b.name.length - a.name.length))[0];
        g.canonical = best.name;
        g.names = g.variants.map(v => v.name);
    });
    return groups;
}

// Group rows by EXACT label (case/space-insensitive) — used for materials,
// where similar names (Pipe 1in vs Pipe 2in) are genuinely different items.
// Same return shape as _pmLaborNameGroups so the picker can use either.
function _pmExactNameGroups(rows, blankLabel) {
    const map = new Map();
    rows.forEach(r => {
        const name = (r.details || '').trim() || blankLabel;
        const k = _pmNameKey(name);
        const cur = map.get(k) || { canonical: name, names: [name], total: 0, count: 0 };
        // Keep the most-used spelling as canonical; collect any case variants.
        if (!cur.names.includes(name)) cur.names.push(name);
        cur.total += Number(r.amount) || 0; cur.count += 1;
        map.set(k, cur);
    });
    return [...map.values()];
}

// Per-type config for the SOA picker.
function _pmSOAPickCfg(type) {
    if (type === 'materials')
        return { title: 'Materials Statement of Account', desc: 'Choose a material label to print, or all labels.',
            aria: 'Choose material label for statement', allLabel: 'All labels', blank: 'Materials', noun: 'material',
            groupsOf: rows => _pmExactNameGroups(rows, 'Materials') };
    if (type === 'both')
        return { title: 'Out Source Statement of Account', desc: 'Choose an out source label to print, or all labels.',
            aria: 'Choose out source label for statement', allLabel: 'All labels', blank: 'Materials & labor', noun: 'out source',
            groupsOf: rows => _pmExactNameGroups(rows, 'Materials & labor') };
    return { title: 'Labor Statement of Account', desc: 'Choose a worker / crew name to print, or all names.',
        aria: 'Choose worker for Labor statement', allLabel: 'All names', blank: 'Labor cost', noun: 'labor',
        groupsOf: rows => _pmLaborNameGroups(rows) };
}

// Name/label-picker overlay for the Labor or Materials SOA. Lists one entry per
// distinct name (labor: fuzzy-merged; materials: exact) with the combined total,
// plus an "All" option. Picking one calls pmCatSOA(type, canonicalName).
function _pmSOAPicker(type) {
    const t = (type === 'materials' || type === 'both') ? type : 'labor';
    const cfg = _pmSOAPickCfg(t);
    const rows = _pmCatRows(t);
    if (!rows.length) { alert(`No ${cfg.noun} entries recorded yet.`); return; }

    const groups = cfg.groupsOf(rows);
    const grandTotal = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    // Only one name on this project — skip the picker and print it directly.
    if (groups.length === 1) { pmCatSOA(t, groups[0].canonical); return; }

    // Remove any stale picker first.
    const old = document.getElementById('pmLaborSOAPicker');
    if (old) old.remove();

    // data-soa-search holds the lowercased canonical + any merged spellings, so
    // typing a typo variant still surfaces the row.
    const optBtn = (val, title, sub, search) => `
        <button type="button" class="pm-soa-pick-opt" data-soa-name="${_esc(val)}" data-soa-search="${_esc(search || '')}">
          <span class="pm-soa-pick-name">${_esc(title)}</span>
          <span class="pm-soa-pick-sub">${sub}</span>
        </button>`;

    const allOpt = optBtn('__all__', cfg.allLabel,
        `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} · ${_pmPeso(grandTotal)}`, '');
    const nameOpts = groups.map(g => {
        // Note any merged alternate spellings so the merge is transparent.
        const alts = (g.names || []).filter(n => n !== g.canonical);
        const altNote = alts.length ? ` · incl. ${_esc(alts.join(', '))}` : '';
        const search = (g.names || [g.canonical]).join(' ').toLowerCase();
        return optBtn(g.canonical, g.canonical,
            `${g.count} entr${g.count === 1 ? 'y' : 'ies'} · ${_pmPeso(g.total)}${altNote}`, search);
    }).join('');

    const ov = document.createElement('div');
    ov.id = 'pmLaborSOAPicker';
    ov.className = 'pm-soa-pick-overlay';
    ov.innerHTML = `
      <div class="pm-soa-pick-card" role="dialog" aria-modal="true" aria-label="${_esc(cfg.aria)}">
        <div class="pm-soa-pick-head">
          <div>
            <div class="pm-soa-pick-title">${_esc(cfg.title)}</div>
            <div class="pm-soa-pick-desc">${_esc(cfg.desc)}</div>
          </div>
          <button type="button" class="pm-soa-pick-x" aria-label="Close">×</button>
        </div>
        <div class="pm-soa-pick-search">
          <svg class="pm-soa-pick-search-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="pm-soa-pick-input" placeholder="Search ${_esc(cfg.noun)}…" aria-label="Search ${_esc(cfg.noun)}" autocomplete="off">
        </div>
        <div class="pm-soa-pick-list">
          ${allOpt}
          ${nameOpts}
          <div class="pm-soa-pick-empty" style="display:none;">No matches.</div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const close = () => ov.remove();
    ov.addEventListener('click', e => {
        if (e.target === ov) { close(); return; }                 // click backdrop
        if (e.target.closest('.pm-soa-pick-x')) { close(); return; }
        const opt = e.target.closest('.pm-soa-pick-opt');
        if (!opt) return;
        const name = opt.getAttribute('data-soa-name');
        close();
        pmCatSOA(t, name);
    });

    // Live search: filter the named options; the "All" row always stays.
    const input = ov.querySelector('.pm-soa-pick-input');
    const emptyEl = ov.querySelector('.pm-soa-pick-empty');
    const nameBtns = [...ov.querySelectorAll('.pm-soa-pick-opt[data-soa-name]:not([data-soa-name="__all__"])')];
    if (input) {
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            let shown = 0;
            nameBtns.forEach(btn => {
                const hit = !q || (btn.getAttribute('data-soa-search') || '').includes(q);
                btn.style.display = hit ? '' : 'none';
                if (hit) shown++;
            });
            if (emptyEl) emptyEl.style.display = (q && shown === 0) ? '' : 'none';
        });
        // Focus the search as the picker opens.
        setTimeout(() => input.focus(), 0);
    }

    document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });
}
// Back-compat alias.
function _pmLaborSOAPicker() { return _pmSOAPicker('labor'); }

// Labor, Materials & Out Source SOAs get a name/label-picker first: choose one
// worker / material / out-source label (or all) before printing.
window.pmCatSOA = function(type, nameFilter) {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    const t = (type === 'materials' || type === 'both') ? type : 'labor';
    if (nameFilter === undefined) { _pmSOAPicker(t); return; }
    const label = t === 'both' ? 'Out Source' : t === 'materials' ? 'Materials' : 'Labor';
    const code  = t === 'both' ? 'MLB' : t === 'materials' ? 'MAT' : 'LAB';
    const blank = t === 'both' ? 'Materials & labor' : t === 'materials' ? 'Materials' : 'Labor cost';
    let rows = _pmCatRows(t);
    // A specific name/label was chosen — keep its entries. For labor this merges
    // fuzzy spelling variants (Franics ≈ Francis); for materials / out source it's
    // exact label. Blank details normalize to the picker's fallback label.
    const picked = (nameFilter && nameFilter !== '__all__') ? String(nameFilter) : '';
    if (picked) {
        const grp = (t === 'labor') ? _pmLaborNameGroups(rows).find(g => g.canonical === picked || g.names.includes(picked))
                                    : _pmExactNameGroups(rows, blank).find(g => g.canonical === picked || g.names.includes(picked));
        const variants = grp ? grp.names : [picked];
        rows = rows.filter(r => variants.includes((r.details || '').trim() || blank));
    }
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const client  = _pmActiveProject.clientName || _pmActiveProject.projectName || '—';
    const project = _pmActiveProject.projectName || '—';
    const location = _pmActiveProject.location || _pmActiveProject.address || '';
    const today = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
    const fmtDate = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }); } catch (e) { return d || '—'; } };
    const metaOf = r => t === 'labor' ? (r.days ? r.days + (r.days === 1 ? ' day' : ' days') : '')
        : t === 'materials' ? (r.qty ? r.qty + ' ' + (r.unit || 'pcs') : '')
        : 'supply & install';
    // When a single worker is printed, show the canonical name on every row so
    // merged spellings (Franics/Francis) all read the same on the statement.
    const nameOf = r => picked ? picked : (r.details || '—');
    const descOf = r => nameOf(r) + (metaOf(r) ? ' · ' + metaOf(r) : '');
    const fmtN = n => Math.round(Number(n) || 0).toLocaleString('en-US');
    const dates = rows.map(r => r.date).filter(Boolean).sort();
    const period = dates.length
        ? new Date(dates[0] + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' – ' +
          new Date(dates[dates.length - 1] + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'All bills';
    const ref = 'SOA-' + code + '-' + String(rows.length).padStart(3, '0');
    // Subject of the statement: the chosen worker name, or project-wide.
    const subject = picked || 'project-wide';

    const rowsHtml = rows.length
        ? rows.map((r, i) => `<tr style="background:${i % 2 ? '#f4f8f5' : '#fff'};">
            <td class="d">${_esc(fmtDate(r.date))}</td>
            <td class="desc">${_esc(descOf(r))}</td>
            <td class="amt">${fmtN(r.amount)}</td>
          </tr>`).join('')
        : `<tr><td colspan="3" style="text-align:center;color:#9aa8a0;padding:26px;">No ${label.toLowerCase()} entries yet.</td></tr>`;

    const pdfData = {
        label, client, project, location, today, period, ref, subject,
        body: rows.map(r => [fmtDate(r.date), descOf(r), fmtN(r.amount)]),
        total: fmtN(total),
        ack: t === 'labor',
        ackName: picked || '',
        fname: `${ref}-${(picked ? String(picked).replace(/[^A-Za-z0-9]+/g, '') + '-' : '')}${(String(project).replace(/[^A-Za-z0-9]+/g, '') || 'project')}.pdf`
    };
    const pdfJson = JSON.stringify(pdfData).replace(/</g, '\\u003c');

    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to open the statement.'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${_esc(ref)} — ${_esc(label)} — ${_esc(client)}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"><\/script>
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,Helvetica,sans-serif;color:#1a2620;background:#e9ece9;padding:32px;}
      .sheet{max-width:720px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 20px 60px -20px rgba(0,0,0,.3);overflow:hidden;}
      .body{padding:34px 44px;}
      .head{text-align:center;border-bottom:2px solid #14532d;padding-bottom:18px;}
      .company{font-size:21px;font-weight:800;color:#15803d;letter-spacing:.01em;}
      .subtitle{font-size:11px;color:#7b8a82;margin-top:4px;letter-spacing:.04em;}
      .doctitle{font-size:15px;font-weight:700;color:#14532d;letter-spacing:.1em;margin-top:18px;}
      .docsub{font-size:12px;color:#7b8a82;margin-top:3px;}
      .meta{display:flex;flex-wrap:wrap;padding:18px 0;border-bottom:1px solid #e6ece8;}
      .meta>div{width:50%;margin-bottom:14px;}
      .meta-l{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#a3b0a8;}
      .meta-v{font-size:13px;font-weight:700;color:#1a2620;margin-top:3px;}
      .meta-v.mono{font-family:'Courier New',monospace;}
      table{width:100%;border-collapse:collapse;margin-top:18px;}
      thead th{background:#14532d;color:#fff;font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:11px 8px;text-align:left;}
      thead th.r{text-align:right;padding-right:16px;} thead th:first-child{padding-left:16px;}
      tbody td{font-size:12.5px;color:#26342c;padding:11px 8px;border-bottom:1px solid #eef3f0;}
      td.d{width:90px;padding-left:16px;color:#5b6b62;font-family:'Courier New',monospace;}
      td.amt{width:130px;text-align:right;padding-right:16px;font-family:'Courier New',monospace;font-weight:700;}
      tfoot td{background:#14532d;color:#fff;font-weight:700;}
      tfoot .lbl{padding:14px 8px 14px 16px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;}
      tfoot .tot{text-align:right;padding:14px 16px;font-family:'Courier New',monospace;font-size:17px;}
      .note{padding:16px 0 0;font-size:10px;color:#a3b0a8;line-height:1.6;}
      .ack{margin-top:24px;padding:18px 20px;border:1px solid #d7e3db;border-radius:8px;background:#f9fbfa;}
      .ack-title{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#14532d;margin-bottom:8px;}
      .ack-text{font-size:12px;color:#3a4a41;line-height:1.7;}
      .sig-row{display:flex;gap:28px;margin-top:34px;}
      .sig-block{flex:1;text-align:center;}
      .sig-space{height:30px;}
      .sig-line{border-top:1px solid #6b7b72;padding-top:5px;font-size:10px;color:#5b6b62;letter-spacing:.04em;}
      .sig-name{font-size:11px;font-weight:700;color:#1a2620;margin-top:3px;}
      .foot{border-top:1px solid #e6ece8;background:#f6f8f7;padding:14px 44px;display:flex;justify-content:flex-end;gap:12px;}
      .btn-print{background:#fff;color:#14532d;border:1.5px solid #14532d;border-radius:11px;padding:12px 22px;font:700 13px Arial;cursor:pointer;}
      .btn-pdf{background:#15803d;color:#fff;border:none;border-radius:11px;padding:12px 26px;font:700 13px Arial;cursor:pointer;}
      @media print{body{background:#fff;padding:0;}.sheet{box-shadow:none;border-radius:0;max-width:none;}.foot{display:none;}}
    </style></head><body>
      <div class="sheet">
        <div class="body">
          <div class="head">
            <div class="company">DAC'S BUILDING DESIGN SERVICES</div>
            <div class="subtitle">Building Design &middot; Construction Management${location ? ' &middot; ' + _esc(location) : ''}</div>
            <div class="doctitle">STATEMENT OF ACCOUNT</div>
            <div class="docsub">${_esc(label)} &middot; ${_esc(subject)}</div>
          </div>
          <div class="meta">
            <div><div class="meta-l">Project</div><div class="meta-v">${_esc(project)}</div></div>
            <div><div class="meta-l">Client</div><div class="meta-v">${_esc(client)}</div></div>
            ${picked ? `<div><div class="meta-l">${t === 'both' ? 'Out Source' : t === 'materials' ? 'Material' : 'Worker / Crew'}</div><div class="meta-v">${_esc(picked)}</div></div>` : ''}
            <div><div class="meta-l">Period</div><div class="meta-v">${_esc(period)}</div></div>
            <div><div class="meta-l">Ref no.</div><div class="meta-v mono">${_esc(ref)}</div></div>
          </div>
          <table>
            <thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot><tr><td class="lbl" colspan="2">Total (PHP)</td><td class="tot">${fmtN(total)}</td></tr></tfoot>
          </table>
          ${t === 'labor' ? `<div class="ack">
            <div class="ack-title">Acknowledgment</div>
            <div class="ack-text">I, <strong>${_esc(picked || 'the undersigned')}</strong>, hereby acknowledge receipt of the amount of <strong>PHP ${fmtN(total)}</strong> as full payment for labor rendered on the above project.</div>
            <div class="sig-row">
              <div class="sig-block"><div class="sig-space"></div><div class="sig-line">Worker's Signature</div><div class="sig-name">${_esc(picked || '—')}</div></div>
              <div class="sig-block"><div class="sig-space"></div><div class="sig-line">Prepared by</div></div>
              <div class="sig-block"><div class="sig-space"></div><div class="sig-line">Approved by</div></div>
            </div>
          </div>` : ''}
          <div class="note">Amounts in PHP. This statement lists every ${_esc(label)} entry across all daily bills for the period. Generated ${_esc(today)} &middot; DAC'S admin portal.</div>
        </div>
        <div class="foot">
          <button class="btn-print" onclick="window.print()">Print</button>
          <button class="btn-pdf" onclick="downloadPDF()">Download PDF</button>
        </div>
      </div>
      <script>
        var D = ${pdfJson};
        function downloadPDF(){
          if(!window.jspdf || !window.jspdf.jsPDF){ alert('PDF library still loading — try again in a moment.'); return; }
          var doc = new window.jspdf.jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
          var pw = doc.internal.pageSize.getWidth();
          doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(21,128,61);
          doc.text("DAC'S BUILDING DESIGN SERVICES", pw/2, 18, {align:'center'});
          doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(123,138,130);
          doc.text("Building Design - Construction Management" + (D.location ? " - " + D.location : ""), pw/2, 24, {align:'center'});
          doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.setTextColor(20,83,45);
          doc.text("STATEMENT OF ACCOUNT", pw/2, 33, {align:'center'});
          doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(123,138,130);
          doc.text(D.label + " - " + (D.subject || "project-wide"), pw/2, 38, {align:'center'});
          doc.setFontSize(7.5); doc.setTextColor(150,160,152);
          doc.text("PROJECT", 14, 50); doc.text("CLIENT", pw/2, 50);
          doc.text("PERIOD", 14, 63); doc.text("REF NO.", pw/2, 63);
          doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(26,38,32);
          doc.text(String(D.project), 14, 56); doc.text(String(D.client), pw/2, 56);
          doc.text(String(D.period), 14, 69); doc.text(String(D.ref), pw/2, 69);
          doc.autoTable({
            startY: 76,
            head: [['DATE','DESCRIPTION','AMOUNT']],
            body: D.body,
            foot: [[ {content:'TOTAL (PHP)', colSpan:2, styles:{halign:'left'}}, {content:D.total, styles:{halign:'right'}} ]],
            theme:'grid',
            headStyles:{ fillColor:[20,83,45], textColor:255, fontStyle:'bold', fontSize:8.5 },
            footStyles:{ fillColor:[20,83,45], textColor:255, fontStyle:'bold', fontSize:11 },
            styles:{ fontSize:9, cellPadding:2.6, textColor:[38,52,44], lineColor:[238,243,240], lineWidth:0.1 },
            alternateRowStyles:{ fillColor:[244,248,245] },
            columnStyles:{ 0:{cellWidth:28}, 2:{halign:'right',cellWidth:36,fontStyle:'bold'} }
          });
          var fy = doc.lastAutoTable.finalY + 8;
          if (D.ack) {
            var ackName = D.ackName || 'the undersigned';
            doc.setDrawColor(215,227,219); doc.setFillColor(249,251,250);
            doc.roundedRect(14, fy, pw - 28, 50, 2, 2, 'FD');
            doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(20,83,45);
            doc.text("ACKNOWLEDGMENT", 20, fy + 9);
            doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(58,74,65);
            doc.text(doc.splitTextToSize("I, " + ackName + ", hereby acknowledge receipt of the amount of PHP " + D.total + " as full payment for labor rendered on the above project.", pw - 40), 20, fy + 16);
            var sy = fy + 42, colW = (pw - 28) / 3;
            doc.setDrawColor(107,123,114);
            [["Worker's Signature", D.ackName || ''], ["Prepared by", ""], ["Approved by", ""]].forEach(function(c, i){
              var cx = 14 + colW * i + 8, cw = colW - 16;
              doc.line(cx, sy, cx + cw, sy);
              doc.setFontSize(7.5); doc.setTextColor(91,107,98);
              doc.text(c[0], cx + cw / 2, sy + 4, {align:'center'});
              if (c[1]) { doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(26,38,32); doc.text(c[1], cx + cw / 2, sy + 8, {align:'center'}); doc.setFont('helvetica','normal'); }
            });
            fy += 58;
          }
          doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(150,160,152);
          doc.text(doc.splitTextToSize("Amounts in PHP. This statement lists every " + D.label + " entry across all daily bills for the period. Generated " + D.today + " - DAC'S admin portal.", pw - 28), 14, fy);
          doc.save(D.fname);
        }
      <\/script>
    </body></html>`);
    w.document.close();
};

window.pmWeekSave = async function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    if (!_pmWeekEntries.length) { alert('Add at least one labor or materials line first.'); return; }
    const btn = document.getElementById('pm-week-save-btn');
    // Normalize every entry to a receipts[] of { file, dataUrl, url } so old and new
    // lines share one upload path.
    _pmWeekEntries.forEach(e => { e.receipts = _pmEntryReceiptList(e); });
    const pending = _pmWeekEntries.reduce((n, e) => n + e.receipts.filter(r => r.file && !r.url).length, 0);
    if (btn) { btn.disabled = true; btn.textContent = pending ? 'Uploading receipts…' : 'Saving…'; }
    let rcptFails = 0;
    try {
        // Upload any newly-attached receipt images to storage, fill in their URLs.
        // A failed upload must NOT abort the save — the bill (line data) is what
        // matters most, so we skip the failed image and warn afterward.
        if (pending && typeof storage !== 'undefined') {
            for (let i = 0; i < _pmWeekEntries.length; i++) {
                const en = _pmWeekEntries[i];
                for (let j = 0; j < en.receipts.length; j++) {
                    const r = en.receipts[j];
                    if (r.file && !r.url) {
                        try {
                            const ext = (r.file.name.split('.').pop() || 'jpg').toLowerCase();
                            const path = `weeklyBillReceipts/${_pmActiveProject.id}/${_pmWeekDate}_${i}_${j}_${Date.now()}.${ext}`;
                            const ref = storage.ref(path);
                            await ref.put(r.file);
                            r.url = await ref.getDownloadURL();
                        } catch (upErr) {
                            console.warn('Receipt upload failed for line', i, 'receipt', j, '—', upErr.message);
                            rcptFails++;
                        }
                    }
                }
            }
        }
        const t = _pmWeekTotals();
        const data = {
            weekEndingDate: _pmWeekDate,
            labor: t.labor,
            materials: t.mats,              // client-facing, includes combined
            combined: t.combined,          // supply & install portion (admin breakdown)
            directCostTotal: t.direct,     // labor + materials; client prefers this field
            managementFee: t.fee,
            grandTotal: t.grand,
            entries: _pmWeekEntries.map(e => {
                const urls = (e.receipts || []).map(r => r.url).filter(Boolean);
                return { type:e.type, details:e.details, amount:e.amount,
                    ...(e.days ? { days:e.days } : {}),
                    ...(e.qty  ? { qty:e.qty, unit:e.unit || 'pcs' } : {}),
                    ...(e.contractId ? { contractId: e.contractId } : {}),   // pakyaw/contract drawdown link
                    ...(urls.length ? { receipts: urls, receiptUrl: urls[0] } : {}) };  // receiptUrl kept for legacy readers
            }),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('weeklyBills');
        if (_pmWeekEditingId) {
            await col.doc(_pmWeekEditingId).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            data.status = 'Submitted';
            await col.add(data);
        }
        const wasEdit = !!_pmWeekEditingId;
        await _pmLoadWeekBuilder();
        if (rcptFails) {
            _pmToast(`Bill saved — but ${rcptFails} receipt${rcptFails === 1 ? '' : 's'} couldn't upload (storage permissions). Line data is safe.`, true);
        } else {
            _pmToast(wasEdit ? 'Daily bill updated' : 'Daily bill saved & sent to client');
        }
    } catch(e) {
        _pmToast('Save failed: ' + e.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
};

// Minimalist toast — white card, thin accent, soft shadow (matches the PM design).
function _pmToast(msg, isError = false) {
    const color = isError ? 'var(--pm-danger, #b4453a)' : 'var(--pm-green, #157a52)';
    const t = document.createElement('div');
    t.className = 'pm-toast';
    t.innerHTML = `<span style="color:${color};font-weight:700;">${isError ? '✕' : '✓'}</span><span>${_esc(msg)}</span>`;
    t.style.borderLeftColor = isError ? '#b4453a' : '#157a52';
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 220); }, 2400);
}

// ══════════════════════════════════════════════════════════
// 2. MATERIALS PROCUREMENT LIST
// ══════════════════════════════════════════════════════════

async function _pmLoadProcItems() {
    const tbody = document.getElementById('pm-proc-tbody');
    if (!tbody) return;
    if (!_pmActiveProject) {
        tbody.innerHTML = '<tr><td colspan="8" class="pm-empty-row">Select a client project above.</td></tr>';
        _pmProcUpdateStats([]);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="8" class="pm-empty-row" style="color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('procurementList')
            .orderBy('createdAt','desc')
            .get();
        _pmProcItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmProcApplyFilters();
        _pmProcUpdateStats(_pmProcItems);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="8" class="pm-empty-row">Error: ${_esc(e.message)}</td></tr>`;
    }
}

function _pmProcUpdateStats(items) {
    const unresolved = items.filter(i => ['Pending','Assigned to Client','Assigned to Admin'].includes(i.status)).length;
    _pmSet('pm-proc-total',   items.length);
    _pmSet('pm-proc-pending', unresolved);
    _pmSet('pm-proc-company', items.filter(i => i.boughtBy === 'company').length);
    _pmSet('pm-proc-client',  items.filter(i => i.boughtBy === 'client').length);
    const badge = document.getElementById('pm-proc-badge');
    if (badge) { badge.textContent = unresolved; badge.style.display = unresolved ? '' : 'none'; }
}

function _pmProcRenderTable(items) {
    const tbody = document.getElementById('pm-proc-tbody');
    if (!tbody) return;
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="pm-empty-row">No items yet. Click "Add Item" to create the procurement list.</td></tr>';
        return;
    }
    const rowClass = {
        'Pending'           : 'pm-row-pending',
        'Assigned to Client': 'pm-row-pending',
        'Assigned to Admin' : 'pm-row-pending',
        'Bought by Company' : 'pm-row-company',
        'Bought by Client'  : 'pm-row-client'
    };
    const badgeClass = {
        'Pending'           : 'pm-badge pm-badge-pending',
        'Assigned to Client': 'pm-badge pm-badge-partial',
        'Assigned to Admin' : 'pm-badge pm-badge-partial',
        'Bought by Company' : 'pm-badge pm-badge-company',
        'Bought by Client'  : 'pm-badge pm-badge-client'
    };

    tbody.innerHTML = items.map(it => {
        const rc  = rowClass[it.status]  || '';
        const bc  = badgeClass[it.status] || 'pm-badge';
        const est = it.estPrice    ? _fmt(it.estPrice)    : '—';
        const act = it.actualAmount ? _fmt(it.actualAmount) : '—';
        const buyer = it.boughtBy === 'client'         ? 'Client'
                    : it.boughtBy === 'company'        ? 'Company (Admin)'
                    : it.status === 'Assigned to Client' ? 'Client (pending)'
                    : it.status === 'Assigned to Admin'  ? 'Admin (pending)'
                    : '—';

        const receiptBtn = it.receiptUrl
            ? `<button class="pm-tbl-btn pm-tbl-btn-view" data-pm-action="receipt"><i data-lucide="eye" style="width:12px;height:12px;"></i> View</button>`
            : '<span style="color:#d1d5db;font-size:12px;">—</span>';

        const isUnresolved = ['Pending','Assigned to Client','Assigned to Admin'].includes(it.status);
        const actionBtn = isUnresolved
            ? `<button class="pm-tbl-btn pm-tbl-btn-buy" data-pm-action="buy"><i data-lucide="check" style="width:12px;height:12px;"></i> Mark Bought</button>
               <button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i></button>
               <button class="pm-tbl-btn pm-tbl-btn-delete" data-pm-action="delete"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>`
            : `<span style="color:#9ca3af;font-size:12px;font-style:italic;">Done</span>`;

        return `<tr class="${rc}" data-pm-id="${_esc(it.id)}">
            <td><strong>${_esc(it.item||'—')}</strong>${it.notes ? `<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">${_esc(it.notes)}</div>`:''}</td>
            <td style="color:#6b7280;">${_esc(it.qty||'—')}</td>
            <td>${est}</td>
            <td><span class="${bc}">${_esc(it.status||'—')}</span></td>
            <td style="font-weight:600;">${act}</td>
            <td>${_esc(buyer)}</td>
            <td>${receiptBtn}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }).join('');
    if (!tbody._handlerAttached) {
        tbody._handlerAttached = true;
        tbody.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-pm-action]');
            if (!btn) return;
            const tr  = btn.closest('[data-pm-id]');
            if (!tr) return;
            const it  = _pmProcItems.find(x => x.id === tr.getAttribute('data-pm-id'));
            if (!it) return;
            switch (btn.getAttribute('data-pm-action')) {
                case 'receipt': pmViewReceipt(it.receiptUrl, it.item); break;
                case 'buy':     pmOpenCompanyBuyModal(it); break;
                case 'edit':    pmEditProcItem(it); break;
                case 'delete':  pmDeleteProcItem(it.id); break;
            }
        });
    }
    if (window.lucide) lucide.createIcons();
}

// Combine the status pill (all/pending/bought) with the free-text search.
function _pmProcApplyFilters() {
    const q = (document.getElementById('pm-proc-search')?.value || '').toLowerCase();
    const pendingSet = ['Pending','Assigned to Client','Assigned to Admin'];
    const boughtSet  = ['Bought by Company','Bought by Client'];
    const rows = _pmProcItems.filter(it => {
        if (_pmProcFilter === 'pending' && !pendingSet.includes(it.status)) return false;
        if (_pmProcFilter === 'bought'  && !boughtSet.includes(it.status))  return false;
        return (it.item || '').toLowerCase().includes(q);
    });
    _pmProcRenderTable(rows);
}
window.pmProcFilter = function() { _pmProcApplyFilters(); };
window.pmProcSetFilter = function(f, btn) {
    _pmProcFilter = f;
    document.querySelectorAll('#ws-panel-materials .pm-filter-pill').forEach(p => p.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _pmProcApplyFilters();
};

window.pmOpenAddItemModal = function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    document.getElementById('pmAddItemTitle').textContent = 'Add Procurement Item';
    document.getElementById('pmAddItemId').value    = '';
    document.getElementById('pmAddItemName').value  = '';
    document.getElementById('pmAddItemQty').value   = '';
    document.getElementById('pmAddItemEst').value   = '';
    document.getElementById('pmAddItemNotes').value = '';
    ['err-pmAddItemName','err-pmAddItemQty'].forEach(_pmClearErr);
    document.getElementById('pmAddItemModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditProcItem = function(item) {
    document.getElementById('pmAddItemTitle').textContent   = 'Edit Item';
    document.getElementById('pmAddItemId').value    = item.id;
    document.getElementById('pmAddItemName').value  = item.item  || '';
    document.getElementById('pmAddItemQty').value   = item.qty   || '';
    document.getElementById('pmAddItemEst').value   = item.estPrice || '';
    document.getElementById('pmAddItemNotes').value = item.notes || '';
    ['err-pmAddItemName','err-pmAddItemQty'].forEach(_pmClearErr);
    document.getElementById('pmAddItemModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveProcItem = async function() {
    const itemId = document.getElementById('pmAddItemId').value;
    const name   = document.getElementById('pmAddItemName').value.trim();
    const qty    = document.getElementById('pmAddItemQty').value.trim();
    const est    = parseFloat(document.getElementById('pmAddItemEst').value) || null;
    const notes  = document.getElementById('pmAddItemNotes').value.trim();

    let valid = true;
    if (!name) { _pmShowErr('err-pmAddItemName','Item name is required.'); valid = false; }
    if (!qty)  { _pmShowErr('err-pmAddItemQty','Quantity is required.'); valid = false; }
    if (!valid) return;

    const data = { item: name, qty, estPrice: est, notes,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    const btn = document.querySelector('#pmAddItemModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('procurementList');
        if (itemId) {
            await col.doc(itemId).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            data.status    = 'Pending';
            data.boughtBy  = null;
            data.actualAmount = null;
            data.receiptUrl   = null;
            await col.add(data);
        }
        pmCloseModal('pmAddItemModal');
        _pmLoadProcItems();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Item';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmDeleteProcItem = async function(id) {
    if (!confirm('Delete this procurement item?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id).collection('procurementList').doc(id).delete();
        _pmLoadProcItems();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ── Company Buy Modal ─────────────────────────────────────
window.pmOpenCompanyBuyModal = function(item) {
    _pmCompanyBuyItemData = item;
    _pmCompanyReceiptFile = null;
    document.getElementById('pmCompanyBuyItemId').value        = item.id;
    document.getElementById('pmCompanyBuyItemName').textContent = item.item || '—';
    document.getElementById('pmCompanyBuyItemQty').textContent  = item.qty  || '—';
    document.getElementById('pmCompanyBuyItemEst').textContent  = item.estPrice ? _fmt(item.estPrice) : '—';
    document.getElementById('pmCompanyBuyAmount').value         = '';
    document.getElementById('pmCompanyBuyNotes').value          = '';
    document.getElementById('pmCompanyReceiptFile').value       = '';
    document.getElementById('pmCompanyReceiptPreview').style.display = 'none';
    document.getElementById('pmCompanyReceiptPreview').innerHTML = '';
    ['err-pmCompanyBuyAmount','err-pmCompanyReceipt'].forEach(_pmClearErr);
    document.getElementById('pmCompanyBuyModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmCompanyHandleDrop = function(e) {
    e.preventDefault();
    document.getElementById('pmCompanyUploadZone').classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) { _pmCompanyReceiptFile = file; _pmCompanyPreviewFile_direct(file); }
};

window.pmCompanyPreviewFile = function(input) {
    if (input.files[0]) { _pmCompanyReceiptFile = input.files[0]; _pmCompanyPreviewFile_direct(input.files[0]); }
};

function _pmCompanyPreviewFile_direct(file) {
    const preview = document.getElementById('pmCompanyReceiptPreview');
    preview.style.display = 'block';
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = e => { preview.innerHTML = `<img src="${e.target.result}" class="pm-receipt-preview-img" alt="receipt">`; };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = `<div class="pm-file-chip"><i data-lucide="file-text" style="width:16px;height:16px;"></i> ${_esc(file.name)}</div>`;
        if (window.lucide) lucide.createIcons();
    }
}

window.pmSubmitCompanyBuy = async function() {
    const amount = parseFloat(document.getElementById('pmCompanyBuyAmount').value) || 0;
    const notes  = document.getElementById('pmCompanyBuyNotes').value.trim();
    const itemId = document.getElementById('pmCompanyBuyItemId').value;

    let valid = true;
    if (amount <= 0) { _pmShowErr('err-pmCompanyBuyAmount','Enter the actual amount paid.'); valid = false; }
    if (!_pmCompanyReceiptFile) { _pmShowErr('err-pmCompanyReceipt','Please upload a proof of receipt.'); valid = false; }
    if (!valid) return;

    const btn = document.getElementById('pmCompanyBuySubmitBtn');
    btn.disabled = true; btn.textContent = 'Uploading…';

    try {
        let receiptUrl = null;
        if (_pmCompanyReceiptFile && typeof storage !== 'undefined') {
            const ext = _pmCompanyReceiptFile.name.split('.').pop();
            const path = `procurementReceipts/${_pmActiveProject.id}/${itemId}_company_${Date.now()}.${ext}`;
            const ref = storage.ref(path);
            await ref.put(_pmCompanyReceiptFile);
            receiptUrl = await ref.getDownloadURL();
        }

        await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('procurementList')
            .doc(itemId)
            .update({
                status: 'Bought by Company',
                boughtBy: 'company',
                actualAmount: amount,
                receiptUrl: receiptUrl,
                notes: notes,
                boughtAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });

        pmCloseModal('pmCompanyBuyModal');
        _pmLoadProcItems();
    } catch(e) {
        alert('Error: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;"></i> Confirm Purchase';
        if (window.lucide) lucide.createIcons();
    }
};

// ── Receipt Viewer ────────────────────────────────────────
window.pmViewReceipt = function(url, itemName) {
    document.getElementById('pmReceiptViewTitle').textContent = (itemName || 'Receipt') + ' — Receipt';
    const content = document.getElementById('pmReceiptViewContent');
    const dl = document.getElementById('pmReceiptDownloadLink');
    dl.href = url;
    if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url) || url.includes('image')) {
        content.innerHTML = `<img src="${_esc(url)}" class="pm-receipt-preview-img" style="max-height:400px;" alt="receipt">`;
    } else {
        content.innerHTML = `<div class="pm-file-chip" style="display:inline-flex;"><i data-lucide="file-text" style="width:18px;height:18px;"></i> PDF Receipt — use "Open in New Tab" to view</div>`;
    }
    document.getElementById('pmReceiptViewModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

// Show one or more receipts in the viewer (stacked). Falls back to the single
// viewer for a lone receipt so the download link still points at it.
window.pmViewReceiptList = function(srcs, itemName) {
    srcs = (srcs || []).filter(Boolean);
    if (!srcs.length) return;
    if (srcs.length === 1) return pmViewReceipt(srcs[0], itemName);
    document.getElementById('pmReceiptViewTitle').textContent = (itemName || 'Receipt') + ` — Receipts (${srcs.length})`;
    const content = document.getElementById('pmReceiptViewContent');
    const dl = document.getElementById('pmReceiptDownloadLink');
    dl.href = srcs[0];
    content.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto;">${
        srcs.map((s, i) => (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(s) || s.includes('image'))
            ? `<img src="${_esc(s)}" class="pm-receipt-preview-img" style="max-height:340px;" alt="receipt ${i + 1}">`
            : `<a href="${_esc(s)}" target="_blank" rel="noopener" class="pm-file-chip" style="display:inline-flex;"><i data-lucide="file-text" style="width:18px;height:18px;"></i> Receipt ${i + 1} — open in new tab</a>`
        ).join('')
    }</div>`;
    document.getElementById('pmReceiptViewModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

// ══════════════════════════════════════════════════════════
// 2b. MILESTONES
//   Writes constructionProjects/{id}/milestones — the exact
//   subcollection the partner portal reads for its Project
//   Completion KPI (status==='completed' ÷ total).
// ══════════════════════════════════════════════════════════

async function _pmLoadMilestones() {
    const tbody = document.getElementById('pm-ms-tbody');
    if (!tbody) return;
    if (!_pmActiveProject) {
        tbody.innerHTML = '<tr><td colspan="6" class="pm-empty-row">Select a client project above.</td></tr>';
        _pmMsUpdateStats([]);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="6" class="pm-empty-row" style="color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('milestones')
            .orderBy('order','asc')
            .get();
        _pmMilestones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmMsRenderTable(_pmMilestones);
        _pmMsUpdateStats(_pmMilestones);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="6" class="pm-empty-row">Error: ${_esc(e.message)}</td></tr>`;
    }
}

function _pmMsUpdateStats(items) {
    _pmSet('pm-ms-completed', items.filter(m => m.status === 'completed').length);
    _pmSet('pm-ms-progress',  items.filter(m => m.status === 'in_progress').length);
    _pmSet('pm-ms-pending',   items.filter(m => !m.status || m.status === 'pending').length);
    _pmSet('pm-ms-total',     items.length);
}

function _pmMsRenderTable(items) {
    const tbody = document.getElementById('pm-ms-tbody');
    if (!tbody) return;
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="pm-empty-row">No milestones yet. Click "Add Milestone" to define the project phases.</td></tr>';
        return;
    }
    const badgeClass = {
        completed:   'pm-badge pm-badge-paid',
        in_progress: 'pm-badge pm-badge-partial',
        pending:     'pm-badge pm-badge-pending'
    };
    const statusLabel = { completed:'Completed', in_progress:'In Progress', pending:'Pending' };

    tbody.innerHTML = items.map(m => {
        const st = m.status || 'pending';
        const bc = badgeClass[st] || 'pm-badge pm-badge-pending';
        const completeBtn = st !== 'completed'
            ? `<button class="pm-tbl-btn pm-tbl-btn-buy" data-pm-action="complete"><i data-lucide="check" style="width:12px;height:12px;"></i> Mark Done</button>`
            : '';
        return `<tr data-pm-id="${_esc(m.id)}">
            <td style="color:#6b7280;white-space:nowrap;">Phase ${_esc(String(m.order || '—'))}</td>
            <td><strong>${_esc(m.name||'—')}</strong>${m.description ? `<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">${_esc(m.description)}</div>`:''}</td>
            <td style="color:#374151;white-space:nowrap;">${_esc(m.plannedDate||'—')}</td>
            <td style="font-weight:600;">${m.percentage != null && m.percentage !== '' ? _esc(String(m.percentage)) + '%' : '—'}</td>
            <td><span class="${bc}">${_esc(statusLabel[st]||'Pending')}</span></td>
            <td>
                ${completeBtn}
                <button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i></button>
                <button class="pm-tbl-btn pm-tbl-btn-delete" data-pm-action="delete"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
            </td>
        </tr>`;
    }).join('');
    if (!tbody._handlerAttached) {
        tbody._handlerAttached = true;
        tbody.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-pm-action]');
            if (!btn) return;
            const tr  = btn.closest('[data-pm-id]');
            if (!tr) return;
            const m   = _pmMilestones.find(x => x.id === tr.getAttribute('data-pm-id'));
            if (!m) return;
            switch (btn.getAttribute('data-pm-action')) {
                case 'complete': pmCompleteMilestone(m.id); break;
                case 'edit':     pmEditMilestone(m); break;
                case 'delete':   pmDeleteMilestone(m.id); break;
            }
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmOpenMilestoneModal = function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    document.getElementById('pmMilestoneTitle').textContent = 'Add Milestone';
    document.getElementById('pmMilestoneId').value     = '';
    document.getElementById('pmMilestoneName').value   = '';
    document.getElementById('pmMilestoneOrder').value  = (_pmMilestones.length + 1);
    document.getElementById('pmMilestonePct').value    = '';
    document.getElementById('pmMilestoneStatus').value = 'pending';
    document.getElementById('pmMilestoneDate').value   = '';
    document.getElementById('pmMilestoneDesc').value   = '';
    ['err-pmMilestoneName','err-pmMilestoneOrder'].forEach(_pmClearErr);
    document.getElementById('pmMilestoneModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditMilestone = function(m) {
    document.getElementById('pmMilestoneTitle').textContent = 'Edit Milestone';
    document.getElementById('pmMilestoneId').value     = m.id;
    document.getElementById('pmMilestoneName').value   = m.name || '';
    document.getElementById('pmMilestoneOrder').value  = (m.order != null ? m.order : '');
    document.getElementById('pmMilestonePct').value    = (m.percentage != null ? m.percentage : '');
    document.getElementById('pmMilestoneStatus').value = m.status || 'pending';
    document.getElementById('pmMilestoneDate').value   = m.plannedDate || '';
    document.getElementById('pmMilestoneDesc').value   = m.description || '';
    ['err-pmMilestoneName','err-pmMilestoneOrder'].forEach(_pmClearErr);
    document.getElementById('pmMilestoneModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveMilestone = async function() {
    const id     = document.getElementById('pmMilestoneId').value;
    const name   = document.getElementById('pmMilestoneName').value.trim();
    const orderV = document.getElementById('pmMilestoneOrder').value.trim();
    const pctRaw = document.getElementById('pmMilestonePct').value.trim();
    const status = document.getElementById('pmMilestoneStatus').value;
    const date   = document.getElementById('pmMilestoneDate').value;
    const desc   = document.getElementById('pmMilestoneDesc').value.trim();

    let valid = true;
    if (!name)   { _pmShowErr('err-pmMilestoneName','Milestone name is required.'); valid = false; }
    if (!orderV) { _pmShowErr('err-pmMilestoneOrder','Phase / order is required.'); valid = false; }
    if (!valid) return;

    const data = {
        name,
        order: Number(orderV),
        percentage: pctRaw === '' ? 0 : Number(pctRaw),
        status,
        plannedDate: date || null,
        description: desc,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    const btn = document.querySelector('#pmMilestoneModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('milestones');
        if (id) {
            await col.doc(id).update(data);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await col.add(data);
        }
        pmCloseModal('pmMilestoneModal');
        _pmLoadMilestones();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Milestone';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmCompleteMilestone = async function(id) {
    if (!_pmActiveProject) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('milestones').doc(id)
            .update({ status: 'completed', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        _pmLoadMilestones();
    } catch(e) { alert('Update failed: ' + e.message); }
};

window.pmDeleteMilestone = async function(id) {
    if (!confirm('Delete this milestone?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('milestones').doc(id).delete();
        _pmLoadMilestones();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 2c. ACCOMPLISHMENT REPORTS — self-contained BOQ-style builder
//   A copy of the BOQ's design + workflow (cost items → sub-items
//   → line items, each with % completion + live totals), but its
//   own feature with its own data stored under the construction
//   project (constructionProjects/{id}/accomplishmentReports).
//   A report's overall % (accomplishment ÷ grand total) feeds the
//   partner portal's Schedule Performance KPI.
// ══════════════════════════════════════════════════════════

let _pmRpDoc = null;   // the report currently open in the builder

// ── BOQ progress math (mirrors boq-module's stateless helpers) ──
function _pmNum(v) { return Number(String(v == null ? '' : v).replace(/,/g,'')) || 0; }
function _pmLiTotal(li) { return _pmNum(li.qty) * (_pmNum(li.materialRate) + _pmNum(li.laborRate)); }
function _pmLiAcc(li)   { return _pmLiTotal(li) * (_pmNum(li.percentCompletion) / 100); }
function _pmBoqGrand(costItems) {
    return (costItems || []).reduce((s, ci) =>
        s + (ci.subItems || []).reduce((s2, si) =>
            s2 + (si.lineItems || []).reduce((s3, li) => s3 + _pmLiTotal(li), 0), 0), 0);
}
function _pmBoqAcc(costItems) {
    return (costItems || []).reduce((s, ci) =>
        s + (ci.subItems || []).reduce((s2, si) =>
            s2 + (si.lineItems || []).reduce((s3, li) => s3 + _pmLiAcc(li), 0), 0), 0);
}
function _pmBoqPct(doc) {
    const grand = _pmBoqGrand(doc.costItems);
    if (grand <= 0) return 0;
    return Math.round((_pmBoqAcc(doc.costItems) / grand) * 100);
}
function _pmCiSub(ci) { return (ci.subItems || []).reduce((s, si) => s + (si.lineItems || []).reduce((s2, li) => s2 + _pmLiTotal(li), 0), 0); }
function _pmCiAcc(ci) { return (ci.subItems || []).reduce((s, si) => s + (si.lineItems || []).reduce((s2, li) => s2 + _pmLiAcc(li), 0), 0); }

function _pmTsMs(ts) {
    const ms = ts && ts.toMillis ? ts.toMillis() : (ts ? new Date(ts).getTime() : 0);
    return (!ms || isNaN(ms)) ? 0 : ms;
}
// Print/download the signed PER-PROJECT partner agreement (admin view) —
// styled as a formal, letterhead-style agreement document with the DAC's logo.
function _pmViewPartnerAgreement(p) {
    const pa = p && p._partner;
    if (!pa) { alert('The partner has not signed this project\'s terms yet.'); return; }
    if (typeof window.dacsAgreementPdf !== 'function') { alert('Print utility not loaded.'); return; }
    const at = _pmTsMs(pa.acceptedAt);
    const dateStr = at ? new Date(at).toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
    const dayStr  = at ? new Date(at).toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' }) : '';
    const partner = pa.signature || pa.partnerEmail || 'the Partner';
    const contract = p.budget != null ? '₱' + Number(p.budget).toLocaleString('en-PH', {minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    const ref = 'PA-' + String(p.id || '').slice(0, 6).toUpperCase();
    const terms = (p.partnerTerms && p.partnerTerms.trim())
        ? p.partnerTerms
        : 'By viewing this project the Partner agrees to keep its information strictly confidential, to use it only for the purposes of this partnership, and to abide by DAC’s Building Design Services’ standard Cost-Plus terms and policies. Prices may vary with market conditions; all figures reflect actual recorded costs.';
    window.dacsAgreementPdf({
        title: 'Project Partnership Agreement',
        subtitle: 'Cost-Plus Terms & Conditions',
        ref,
        preamble: 'This Agreement is entered into on ' + (dayStr || '____________') + ' between DAC’s Building Design Services (the “Manager”) and ' + partner + ' (the “Partner”), in connection with the project identified below. By electronically signing this Agreement, the Partner acknowledges having read, understood, and voluntarily accepted all terms and conditions herein prior to accessing the project’s information.',
        parties: [
            { label: 'Project', value: p.projectName || '—' },
            { label: 'Client', value: p.clientName || '—' },
            { label: 'Partner', value: pa.partnerEmail || partner },
            { label: 'Contract Value', value: contract },
            { label: 'Reference No.', value: ref },
            { label: 'Date Executed', value: dayStr || '—' }
        ],
        sections: [{ heading: 'Terms & Conditions', body: terms }],
        signature: pa.signature || '',
        signatureImage: pa.signatureImage || '',
        dateStr,
        signerLabel: 'Partner',
        ip: pa.ip || ''
    });
}
function _pmTsDateStr(ts) {
    const ms = _pmTsMs(ts);
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
}
function _pmUid(p) { return p + Math.random().toString(36).slice(2, 9); }

// ── List view ──────────────────────────────────────────────
function _pmRpShowList()    { const l=document.getElementById('pm-rp-list'), b=document.getElementById('pm-rp-builder'); if(l)l.style.display=''; if(b){b.style.display='none'; b.innerHTML='';} }
function _pmRpShowBuilder() { const l=document.getElementById('pm-rp-list'), b=document.getElementById('pm-rp-builder'); if(l)l.style.display='none'; if(b)b.style.display=''; }

async function _pmLoadReports() {
    _pmRpShowList();
    const wrap = document.getElementById('pm-rp-cards');
    if (!wrap) return;
    if (!_pmActiveProject) {
        wrap.innerHTML = '<div class="pm-empty-row" style="color:#9ca3af;">Select a client project above.</div>';
        _pmSet('pm-rp-count', 0); _pmSet('pm-rp-latest', '0%');
        return;
    }
    wrap.innerHTML = '<div class="pm-empty-row" style="color:#9ca3af;">Loading…</div>';
    try {
        const snap = await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('accomplishmentReports').orderBy('updatedAt','desc').get();
        _pmReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmRpRenderCards(_pmReports);
        _pmRpStats(_pmReports);
    } catch(e) {
        wrap.innerHTML = `<div class="pm-empty-row">Error: ${_esc(e.message)}</div>`;
    }
}

function _pmRpStats(items) {
    _pmSet('pm-rp-count', items.length);
    _pmSet('pm-rp-approved', items.filter(r => r.status === 'approved').length);
    const latest = items[0]; // newest-first
    _pmSet('pm-rp-latest', (latest ? _pmBoqPct(latest) : 0) + '%');
    _pmSet('pm-rp-cost',   _fmt(latest ? _pmBoqGrand(latest.costItems) : 0));
}

function _pmRpRenderCards(items) {
    const wrap = document.getElementById('pm-rp-cards');
    if (!wrap) return;
    if (!items.length) {
        wrap.innerHTML = '<div class="pm-empty-row" style="grid-column:1/-1;text-align:center;color:#9ca3af;">No accomplishment report yet. Click "New Report" to create one.</div>';
        return;
    }
    wrap.innerHTML = items.map(d => {
        const grand = _pmBoqGrand(d.costItems);
        const acc   = _pmBoqAcc(d.costItems);
        const pct   = _pmBoqPct(d);
        const subject = d.subject || d.projectName || 'Accomplishment Report';
        const statusBadge = d.status === 'approved'
            ? '<span class="boq-status-badge boq-status-saved">Approved</span>'
            : '<span class="boq-status-badge boq-status-new">Draft</span>';
        return `
        <div class="ov-folder-card boq-proj-card" data-pm-id="${_esc(d.id)}" style="cursor:pointer;">
            <div class="ov-folder-card__title-row">
                <div class="ov-folder-card__name">${_esc(subject)}</div>
                ${statusBadge}
            </div>
            <div class="ov-folder-card__desc">${_esc(d.date || '')}</div>
            <div class="ov-folder-card__stat-list" style="margin-top:0.9rem;">
                <div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Total Project Cost</span><span class="ov-folder-card__stat-value">${_fmt(grand)}</span></div>
                <div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Total Accomplishment</span><span class="ov-folder-card__stat-value ov-folder-card__stat-value--positive">${_fmt(acc)}</span></div>
                <div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Progress</span><span class="ov-folder-card__stat-value">${pct}%</span></div>
                <div class="ov-folder-card__stat-row"><span class="ov-folder-card__stat-label">Last Updated</span><span class="ov-folder-card__stat-value">${_pmTsDateStr(d.updatedAt)}</span></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:1.1rem;">
                <button class="ov-folder-card__view-btn" data-pm-action="open" style="flex:1;">Open Report &rarr;</button>
                <button class="pm-tbl-btn pm-tbl-btn-delete" data-pm-action="delete" title="Delete"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
            </div>
        </div>`;
    }).join('');
    if (!wrap._handlerAttached) {
        wrap._handlerAttached = true;
        wrap.addEventListener('click', ev => {
            const btn  = ev.target.closest('[data-pm-action]');
            const card = ev.target.closest('[data-pm-id]');
            if (!card) return;
            const id = card.getAttribute('data-pm-id');
            const action = btn ? btn.getAttribute('data-pm-action') : 'open';
            if (action === 'delete') pmRpDelete(id);
            else pmRpOpen(id);
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmRpDelete = async function(id) {
    if (!confirm('Delete this accomplishment report?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('accomplishmentReports').doc(id).delete();
        _pmLoadReports();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ── Builder ────────────────────────────────────────────────
window.pmRpNew = function() {
    if (!_pmActiveProject) { alert('Please select a client project first.'); return; }
    _pmRpDoc = {
        id: null,
        date: new Date().toISOString().slice(0,10),
        projectName: _pmActiveProject.projectName || '',
        area: '', ownerName: _pmActiveProject.clientName || '', location: _pmActiveProject.address || '',
        subject: 'Accomplishment Report',
        status: 'draft',
        costItems: []
    };
    _pmRpRenderBuilder();
};

window.pmRpOpen = function(id) {
    const d = _pmReports.find(r => r.id === id);
    if (!d) return;
    // Deep clone so edits aren't applied to the list copy until saved.
    _pmRpDoc = JSON.parse(JSON.stringify({
        id: d.id,
        date: d.date || '', projectName: d.projectName || '', area: d.area || '',
        ownerName: d.ownerName || '', location: d.location || '', subject: d.subject || 'Accomplishment Report',
        status: d.status || 'draft',
        costItems: d.costItems || []
    }));
    _pmRpRenderBuilder();
};

function _pmRpRenderBuilder() {
    const root = document.getElementById('pm-rp-builder');
    if (!root || !_pmRpDoc) return;
    _pmRpShowBuilder();
    const d = _pmRpDoc;
    const isSaved = !!d.id;
    root.innerHTML = `
    <div class="boq-builder">
      <div class="boq-toolbar">
        <div class="boq-toolbar-left">
          <button class="boq-back-btn" onclick="pmRpBack()"><i data-lucide="arrow-left"></i> Reports</button>
          <span class="boq-breadcrumb-sep">/</span>
          <h3 class="boq-project-title">${_esc(d.projectName || 'Accomplishment Report')}</h3>
          <span class="boq-badge ${isSaved ? 'boq-badge-saved' : 'boq-badge-new'}">${isSaved ? 'Saved' : 'New'}</span>
        </div>
        <div class="boq-toolbar-right">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#374151;">
            Status
            <select id="rp-status" class="pm-select" style="width:auto;">
              <option value="draft" ${d.status!=='approved'?'selected':''}>Draft</option>
              <option value="approved" ${d.status==='approved'?'selected':''}>Approved (visible to partner)</option>
            </select>
          </label>
          <button class="pm-btn pm-btn-primary" onclick="pmRpSave()"><i data-lucide="save" style="width:14px;height:14px;"></i> Save Report</button>
        </div>
      </div>

      <div class="boq-header-form">
        <div class="boq-section-title">Document Info</div>
        <div class="boq-form-grid">
          <div class="boq-form-group"><label>Date</label><input type="date" id="rp-date" value="${_esc(d.date)}"></div>
          <div class="boq-form-group"><label>Project Name</label><input type="text" id="rp-projectName" value="${_esc(d.projectName)}" placeholder="Project name"></div>
          <div class="boq-form-group"><label>Area (sqm)</label><input type="text" id="rp-area" value="${_esc(d.area)}" placeholder="e.g. 120"></div>
          <div class="boq-form-group"><label>Owner Name</label><input type="text" id="rp-ownerName" value="${_esc(d.ownerName)}" placeholder="Owner / client"></div>
          <div class="boq-form-group"><label>Location</label><input type="text" id="rp-location" value="${_esc(d.location)}" placeholder="Project location"></div>
          <div class="boq-form-group"><label>Subject</label><input type="text" id="rp-subject" value="${_esc(d.subject)}" placeholder="Subject"></div>
        </div>
      </div>

      <div id="rp-costitems">${_pmRpCostItemsHtml(d)}</div>

      <div style="margin-top:14px;">
        <button class="pm-btn pm-btn-secondary" onclick="pmRpAddCost()"><i data-lucide="plus" style="width:14px;height:14px;"></i> Add Cost Item</button>
      </div>

      <div class="pm-kpi-row" style="margin-top:18px;">
        <div class="pm-kpi-card"><div class="pm-kpi-body"><div class="pm-kpi-label">Total Project Cost</div><div class="pm-kpi-value" id="rp-grand">₱0.00</div></div></div>
        <div class="pm-kpi-card"><div class="pm-kpi-body"><div class="pm-kpi-label">Total Accomplishment</div><div class="pm-kpi-value" id="rp-acc">₱0.00</div></div></div>
        <div class="pm-kpi-card pm-kpi-total"><div class="pm-kpi-body"><div class="pm-kpi-label">Overall Progress</div><div class="pm-kpi-value" id="rp-pct">0%</div></div></div>
      </div>
    </div>`;
    _pmRpRefreshTotals();
    if (window.lucide) lucide.createIcons();
}

function _pmRpCostItemsHtml(d) {
    if (!d.costItems.length) {
        return '<div class="pm-empty-row" style="color:#9ca3af;border:1px dashed #e5e7eb;border-radius:10px;margin-top:14px;">No cost items yet. Click "Add Cost Item" to start building the report.</div>';
    }
    return d.costItems.map((ci, ciIdx) => `
      <div class="boq-cost-item" style="border:1px solid #e5e7eb;border-radius:12px;padding:14px;margin-top:14px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <strong style="color:#6b7280;white-space:nowrap;">${ciIdx + 1}.</strong>
          <input type="text" class="pm-input" style="font-weight:600;" placeholder="Cost item name (e.g. Civil Works)" value="${_esc(ci.name || '')}" oninput="pmRpSet('ci','${ci.id}','name',this.value)">
          <button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmRpDelCost('${ci.id}')" title="Remove cost item"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
        </div>
        ${(ci.subItems || []).map(si => `
          <div style="margin:8px 0 8px 18px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <input type="text" class="pm-input" style="font-size:13px;" placeholder="Sub-item name (e.g. Earthworks)" value="${_esc(si.name || '')}" oninput="pmRpSet('si','${si.id}','name',this.value)">
              <button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmRpDelSub('${ci.id}','${si.id}')" title="Remove sub-item"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
            </div>
            <div class="pm-table-wrap">
              <table class="pm-table">
                <thead><tr><th>Description</th><th>Unit</th><th>Qty</th><th>Material Rate</th><th>Labor Rate</th><th>Total</th><th>% Done</th><th>Accomplishment</th><th></th></tr></thead>
                <tbody>
                  ${(si.lineItems || []).map(li => `
                    <tr>
                      <td><input type="text" class="pm-input" value="${_esc(li.description || '')}" placeholder="Description" oninput="pmRpSet('li','${li.id}','description',this.value)"></td>
                      <td><input type="text" class="pm-input" style="width:64px;" value="${_esc(li.unit || '')}" placeholder="unit" oninput="pmRpSet('li','${li.id}','unit',this.value)"></td>
                      <td><input type="number" class="pm-input" style="width:72px;" value="${_esc(li.qty != null ? li.qty : '')}" min="0" step="any" oninput="pmRpSet('li','${li.id}','qty',this.value)"></td>
                      <td><input type="number" class="pm-input" style="width:96px;" value="${_esc(li.materialRate != null ? li.materialRate : '')}" min="0" step="any" oninput="pmRpSet('li','${li.id}','materialRate',this.value)"></td>
                      <td><input type="number" class="pm-input" style="width:96px;" value="${_esc(li.laborRate != null ? li.laborRate : '')}" min="0" step="any" oninput="pmRpSet('li','${li.id}','laborRate',this.value)"></td>
                      <td style="white-space:nowrap;font-weight:600;" id="rp-li-total-${li.id}">₱0.00</td>
                      <td><input type="number" class="pm-input" style="width:64px;" value="${_esc(li.percentCompletion != null ? li.percentCompletion : '')}" min="0" max="100" step="any" oninput="pmRpSet('li','${li.id}','percentCompletion',this.value)"></td>
                      <td style="white-space:nowrap;font-weight:600;color:#059669;" id="rp-li-acc-${li.id}">₱0.00</td>
                      <td><button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmRpDelLine('${ci.id}','${si.id}','${li.id}')"><i data-lucide="x" style="width:12px;height:12px;"></i></button></td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <button class="pm-btn pm-btn-secondary" style="margin-top:6px;" onclick="pmRpAddLine('${ci.id}','${si.id}')"><i data-lucide="plus" style="width:13px;height:13px;"></i> Add Line</button>
          </div>
        `).join('')}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;margin-left:18px;">
          <button class="pm-btn pm-btn-secondary" onclick="pmRpAddSub('${ci.id}')"><i data-lucide="plus" style="width:13px;height:13px;"></i> Add Sub-item</button>
          <div style="font-size:13px;color:#374151;">Subtotal: <strong id="rp-ci-sub-${ci.id}">₱0.00</strong> · Accomplished: <strong id="rp-ci-acc-${ci.id}" style="color:#059669;">₱0.00</strong></div>
        </div>
      </div>`).join('');
}

// ── Model lookups + mutations ──────────────────────────────
function _pmRpFindCost(id) { return _pmRpDoc.costItems.find(ci => ci.id === id); }
function _pmRpFindSub(id)  { for (const ci of _pmRpDoc.costItems) { const si = (ci.subItems||[]).find(s => s.id === id); if (si) return si; } return null; }
function _pmRpFindLine(id) { for (const ci of _pmRpDoc.costItems) for (const si of (ci.subItems||[])) { const li = (si.lineItems||[]).find(l => l.id === id); if (li) return li; } return null; }

window.pmRpSet = function(kind, id, field, value) {
    const obj = kind === 'ci' ? _pmRpFindCost(id) : kind === 'si' ? _pmRpFindSub(id) : _pmRpFindLine(id);
    if (!obj) return;
    obj[field] = value;
    // Numeric fields affect totals — refresh without re-rendering (keeps focus).
    if (kind === 'li' && ['qty','materialRate','laborRate','percentCompletion'].includes(field)) _pmRpRefreshTotals();
};

window.pmRpAddCost = function() { _pmRpDoc.costItems.push({ id: _pmUid('ci_'), name: '', subItems: [] }); _pmRpRerenderItems(); };
window.pmRpDelCost = function(id) { _pmRpDoc.costItems = _pmRpDoc.costItems.filter(ci => ci.id !== id); _pmRpRerenderItems(); };
window.pmRpAddSub = function(ciId) { const ci = _pmRpFindCost(ciId); if (!ci) return; (ci.subItems = ci.subItems || []).push({ id: _pmUid('si_'), name: '', lineItems: [] }); _pmRpRerenderItems(); };
window.pmRpDelSub = function(ciId, siId) { const ci = _pmRpFindCost(ciId); if (!ci) return; ci.subItems = (ci.subItems||[]).filter(si => si.id !== siId); _pmRpRerenderItems(); };
window.pmRpAddLine = function(ciId, siId) { const si = _pmRpFindSub(siId); if (!si) return; (si.lineItems = si.lineItems || []).push({ id: _pmUid('li_'), description: '', unit: '', qty: '', materialRate: '', laborRate: '', percentCompletion: '' }); _pmRpRerenderItems(); };
window.pmRpDelLine = function(ciId, siId, liId) { const si = _pmRpFindSub(siId); if (!si) return; si.lineItems = (si.lineItems||[]).filter(li => li.id !== liId); _pmRpRerenderItems(); };

// Re-render just the cost-items area (preserves header input values in the DOM).
function _pmRpRerenderItems() {
    _pmRpSyncHeaderFromDom();
    const host = document.getElementById('rp-costitems');
    if (host) host.innerHTML = _pmRpCostItemsHtml(_pmRpDoc);
    _pmRpRefreshTotals();
    if (window.lucide) lucide.createIcons();
}

function _pmRpRefreshTotals() {
    const d = _pmRpDoc;
    d.costItems.forEach(ci => {
        (ci.subItems||[]).forEach(si => (si.lineItems||[]).forEach(li => {
            _pmSet('rp-li-total-' + li.id, _fmt(_pmLiTotal(li)));
            _pmSet('rp-li-acc-' + li.id,   _fmt(_pmLiAcc(li)));
        }));
        _pmSet('rp-ci-sub-' + ci.id, _fmt(_pmCiSub(ci)));
        _pmSet('rp-ci-acc-' + ci.id, _fmt(_pmCiAcc(ci)));
    });
    _pmSet('rp-grand', _fmt(_pmBoqGrand(d.costItems)));
    _pmSet('rp-acc',   _fmt(_pmBoqAcc(d.costItems)));
    _pmSet('rp-pct',   _pmBoqPct(d) + '%');
}

function _pmRpSyncHeaderFromDom() {
    const g = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
    const d = _pmRpDoc;
    if (g('rp-date')        !== undefined) d.date        = g('rp-date');
    if (g('rp-projectName') !== undefined) d.projectName = g('rp-projectName');
    if (g('rp-area')        !== undefined) d.area        = g('rp-area');
    if (g('rp-ownerName')   !== undefined) d.ownerName   = g('rp-ownerName');
    if (g('rp-location')    !== undefined) d.location    = g('rp-location');
    if (g('rp-subject')     !== undefined) d.subject     = g('rp-subject');
    if (g('rp-status')      !== undefined) d.status      = g('rp-status');
}

window.pmRpBack = function() {
    if (_pmRpDoc) { _pmRpSyncHeaderFromDom(); }
    _pmRpDoc = null;
    _pmLoadReports();
};

window.pmRpSave = async function() {
    if (!_pmActiveProject || !_pmRpDoc) return;
    _pmRpSyncHeaderFromDom();
    const d = _pmRpDoc;
    const adminEmail = (firebase.auth().currentUser && firebase.auth().currentUser.email) || 'DACS Admin';
    const payload = {
        date: d.date || '', projectName: d.projectName || '', area: d.area || '',
        ownerName: d.ownerName || '', location: d.location || '', subject: d.subject || 'Accomplishment Report',
        status: d.status || 'draft',
        costItems: d.costItems || [],
        // Cached overall progress so the partner KPI / list don't have to recompute.
        progressPercentage: _pmBoqPct(d),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (d.status === 'approved') { payload.approvedBy = adminEmail; payload.approvedAt = firebase.firestore.FieldValue.serverTimestamp(); }

    const btn = document.querySelector('#pm-rp-builder .pm-btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('accomplishmentReports');
        if (d.id) {
            await col.doc(d.id).update(payload);
        } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const ref = await col.add(payload);
            d.id = ref.id;
        }
        _pmRpDoc = null;
        _pmLoadReports();
    } catch(e) {
        alert('Save failed: ' + e.message);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Report'; if (window.lucide) lucide.createIcons(); }
    }
};

// ══════════════════════════════════════════════════════════
// 3. REVOLVING FUND
// ══════════════════════════════════════════════════════════

// ── Revolving Fund — weekly fund the admin collects from the partner ───────
// Each entry is one week: an amount to collect, plus a received flag. Stored in
// constructionProjects/{id}/revolvingFundRequests/{id} (keyed by `weekStart`,
// the week's Sunday). No expense/spend tracking — it's a collection checklist.
async function _pmLoadRevolving() {
    if (!_pmActiveProject) {
        _pmFundRequests = [];
        _pmFundBills = [];
        _pmRevUpdateKPIs();
        _pmRevRenderTable([]);
        return;
    }
    // Weekly bills (best-effort — used only for the fund-vs-spent compare).
    try {
        const billSnap = await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('weeklyBills').get();
        _pmFundBills = billSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        _pmFundBills = [];
    }
    // Fund entries — render even if this fails so the panel never hangs on "Loading…".
    try {
        const reqSnap = await db.collection('constructionProjects').doc(_pmActiveProject.id)
            .collection('revolvingFundRequests').get();
        _pmFundRequests = reqSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.weekStart || '').localeCompare(a.weekStart || ''));   // newest first
        _pmRevUpdateKPIs();
        _pmRevRenderTable(_pmFundRequests);
    } catch(e) {
        console.warn('PM revolving load:', e.message);
        _pmFundRequests = [];
        _pmRevUpdateKPIs();
        const tbody = document.getElementById('pm-rev-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row" style="color:#9ca3af;">Couldn’t load the weekly fund — the database table may not be set up yet.</td></tr>';
    }
}

// Direct cost (labor + materials + out-source) of the bills that fall inside a
// fund week's Sun–Sat range. Mirrors the overview's direct-cost formula.
function _pmWeekDirectCost(weekStart) {
    if (!weekStart) return 0;
    const end = new Date(weekStart + 'T00:00:00'); end.setDate(end.getDate() + 6);
    const pad = n => String(n).padStart(2, '0');
    const endStr = end.getFullYear() + '-' + pad(end.getMonth() + 1) + '-' + pad(end.getDate());
    return _pmFundBills
        .filter(b => b.weekEndingDate && b.weekEndingDate >= weekStart && b.weekEndingDate <= endStr)
        .reduce((s, b) => {
            const dct = Number(b.directCostTotal) || 0;
            if (dct) return s + dct;
            const lm = (Number(b.labor) || 0) + (Number(b.materials) || 0);
            if (lm) return s + lm;
            return s + ((Number(b.grandTotal) || 0) - (Number(b.managementFee) || 0));
        }, 0);
}

function _pmRevUpdateKPIs() {
    const total    = _pmFundRequests.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const received = _pmFundRequests.filter(r => r.received).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const spent    = _pmFundRequests.reduce((s, r) => s + _pmWeekDirectCost(r.weekStart), 0);
    const net      = total - spent;
    _pmSet('pm-rev-total',    _fmt(total));
    _pmSet('pm-rev-received', _fmt(received));
    _pmSet('pm-rev-spent',    _fmt(spent));
    _pmSet('pm-rev-net',      (net < 0 ? '−' : '') + _fmt(Math.abs(net)));
    const netEl = document.getElementById('pm-rev-net');
    if (netEl) netEl.style.color = net < 0 ? '#dc2626' : '#15803d';
}

function _pmRevRenderTable(items) {
    const tbody = document.getElementById('pm-rev-tbody');
    if (!tbody) return;
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row">No weekly fund set yet.</td></tr>';
        return;
    }
    // Running balance: walk oldest→newest, carry (fund − spent) forward like a
    // wallet, and remember the cumulative total at each week.
    const balById = {};
    let run = 0;
    items.slice().sort((a, b) => (a.weekStart || '').localeCompare(b.weekStart || ''))
        .forEach(r => { run += (Number(r.amount) || 0) - _pmWeekDirectCost(r.weekStart); balById[r.id] = run; });

    tbody.innerHTML = items.map(r => {
        const week  = r.weekStart ? _pmWeekOfMonthLabel(r.weekStart) : '—';
        const range = r.weekStart ? _pmWeekRangeLabel(r.weekStart) : '—';
        const fund  = Number(r.amount) || 0;
        const spent = _pmWeekDirectCost(r.weekStart);
        const diff  = fund - spent;
        const bal   = balById[r.id] || 0;
        const balHtml = `<span style="font-weight:700;color:${bal < 0 ? '#dc2626' : '#15803d'};">${bal < 0 ? '−' : ''}${_fmt(Math.abs(bal))}</span>`;
        // Difference: green surplus / red shortfall, with a plain-words hint.
        const diffHtml = spent === 0
            ? '<span style="color:#9ca3af;">—</span>'
            : `<span style="font-weight:700;color:${diff < 0 ? '#dc2626' : '#15803d'};">${diff < 0 ? '−' : '+'}${_fmt(Math.abs(diff))}</span>`
              + `<div style="font-size:11px;color:#9ca3af;margin-top:1px;">${diff < 0 ? 'short' : 'left over'}</div>`;
        const got   = !!r.received;
        const badge = got
            ? '<span class="pm-badge" style="background:#dcfce7;color:#15803d;">Received</span>'
            : '<span class="pm-badge" style="background:#fef3c7;color:#b45309;">Pending</span>';
        const markBtn = got
            ? `<button class="pm-tbl-btn" title="Mark as not received" onclick="pmToggleFundReceived('${_esc(r.id)}')"><i data-lucide="rotate-ccw" style="width:12px;height:12px;"></i></button>`
            : `<button class="pm-tbl-btn" title="Mark as received" style="color:#15803d;" onclick="pmToggleFundReceived('${_esc(r.id)}')"><i data-lucide="check" style="width:12px;height:12px;"></i> Received</button>`;
        return `<tr>
            <td><strong>${_esc(week)}</strong><div style="font-size:11.5px;color:#9ca3af;margin-top:2px;">${_esc(range)}</div>${r.notes ? `<div style="font-size:11.5px;color:#6b7280;margin-top:2px;">${_esc(r.notes)}</div>` : ''}</td>
            <td style="font-weight:600;">${_fmt(fund)}</td>
            <td style="color:#6b7280;">${spent === 0 ? '<span style="color:#9ca3af;">—</span>' : _fmt(spent)}</td>
            <td>${diffHtml}</td>
            <td>${balHtml}</td>
            <td>${badge}</td>
            <td style="display:flex;gap:6px;align-items:center;">
              ${markBtn}
              <button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmDeleteFundRequest('${_esc(r.id)}')"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
            </td>
        </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

// Build the week <select> options: a few weeks back through several ahead, each
// labelled "Nth week of <Month> (date range)". Value is the week's Sunday.
function _pmFundWeekOptions(selected) {
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const sun = new Date();
    sun.setHours(0, 0, 0, 0);
    sun.setDate(sun.getDate() - sun.getDay());   // this week's Sunday
    const opts = [];
    for (let i = -4; i <= 20; i++) {
        const d = new Date(sun); d.setDate(d.getDate() + i * 7);
        const ws = fmt(d);
        const label = _pmWeekOfMonthLabel(ws) + ' (' + _pmWeekRangeLabel(ws) + ')';
        opts.push(`<option value="${ws}"${ws === selected ? ' selected' : ''}>${_esc(label)}</option>`);
    }
    return opts.join('');
}

window.pmOpenFundRequestModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    // Default to this week's Sunday.
    const now = new Date(); now.setHours(0, 0, 0, 0); now.setDate(now.getDate() - now.getDay());
    const pad = n => String(n).padStart(2, '0');
    const thisWeek = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    document.getElementById('pmFundWeek').innerHTML = _pmFundWeekOptions(thisWeek);
    document.getElementById('pmFundAmount').value = '';
    document.getElementById('pmFundNotes').value  = '';
    ['err-pmFundWeek', 'err-pmFundAmount'].forEach(_pmClearErr);
    document.getElementById('pmFundRequestModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveFundRequest = async function() {
    const weekStart = document.getElementById('pmFundWeek').value;
    const amount    = parseFloat(document.getElementById('pmFundAmount').value) || 0;
    const notes     = document.getElementById('pmFundNotes').value.trim();
    let valid = true;
    if (!weekStart) { _pmShowErr('err-pmFundWeek', 'Pick a week.'); valid = false; }
    if (amount <= 0) { _pmShowErr('err-pmFundAmount', 'Enter an amount.'); valid = false; }
    if (!valid) return;
    // One entry per week — if the week already exists, update its amount/notes.
    const existing = _pmFundRequests.find(r => r.weekStart === weekStart);
    try {
        const col = db.collection('constructionProjects').doc(_pmActiveProject.id).collection('revolvingFundRequests');
        if (existing) {
            await col.doc(existing.id).set({ amount, notes, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        } else {
            await col.add({ weekStart, amount, notes, received: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        pmCloseModal('pmFundRequestModal');
        _pmLoadRevolving();
    } catch(e) { alert('Error: ' + e.message); }
};

window.pmToggleFundReceived = async function(id) {
    const item = _pmFundRequests.find(r => r.id === id);
    if (!item) return;
    const next = !item.received;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFundRequests').doc(id)
          .set({ received: next, receivedAt: next ? firebase.firestore.FieldValue.serverTimestamp() : null }, { merge: true });
        _pmLoadRevolving();
    } catch(e) { alert('Error: ' + e.message); }
};

window.pmDeleteFundRequest = async function(id) {
    if (!confirm('Delete this weekly fund entry?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFundRequests').doc(id).delete();
        _pmLoadRevolving();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

// ══════════════════════════════════════════════════════════
// 4. PAYMENT
// ══════════════════════════════════════════════════════════

async function _pmLoadPayments() {
    const tbody = document.getElementById('pm-pay-tbody');
    if (!tbody) return;
    if (!_pmActiveProject) {
        tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row">Select a client project above.</td></tr>';
        _pmPayUpdateKPIs([]);
        return;
    }
    tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row" style="color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('paymentRequests')
            .where('constructionProjectId', '==', _pmActiveProject.id)
            .orderBy('weekEndingDate','desc')
            .get();
        _pmPayRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmPayRenderTable(_pmPayRequests);
        _pmPayUpdateKPIs(_pmPayRequests);
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="7" class="pm-empty-row">Error: ${_esc(e.message)}</td></tr>`;
    }
}

function _pmPayUpdateKPIs(reqs) {
    const outstanding = reqs.filter(r => r.status === 'unpaid' || r.status === 'partial')
        .reduce((s,r) => s + ((r.totalAmount || 0) - (r.amountPaid || 0)), 0);
    // Approved client self-payments ('verified') count toward Total Paid even if
    // amount_paid wasn't backfilled, using the client-entered paidAmount/totalAmount.
    const paid = reqs.reduce((s,r) => {
        if (r.status === 'verified') return s + (r.amountPaid || r.paidAmount || r.totalAmount || 0);
        return s + (r.amountPaid || 0);
    }, 0);
    const strictCount = reqs.filter(r => r.strict).length;
    const nextUnpaid = reqs.find(r => r.status === 'unpaid' || r.status === 'partial');
    _pmSet('pm-pay-outstanding', _fmt(outstanding));
    _pmSet('pm-pay-total-paid',  _fmt(paid));
    _pmSet('pm-pay-strict-count', strictCount);
    _pmSet('pm-pay-next-due', nextUnpaid?.weekEndingDate
        ? new Date(nextUnpaid.weekEndingDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
        : '—');

    // Dark "next payment due" banner (design)
    const banner = document.getElementById('pm-pay-banner');
    if (banner) {
        if (nextUnpaid) {
            const due = nextUnpaid.weekEndingDate
                ? new Date(nextUnpaid.weekEndingDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
                : '—';
            const bal = (nextUnpaid.totalAmount || 0) - (nextUnpaid.amountPaid || 0);
            _pmSet('pm-pay-banner-when', 'Friday request · due ' + due);
            _pmSet('pm-pay-banner-amt', _fmt(bal));
            _pmSet('pm-pay-banner-sub', nextUnpaid.strict
                ? 'Exact amount · partial blocked (strict)'
                : 'Partial allowed up to ₱5,000 short');
            const strictEl = document.getElementById('pm-pay-banner-strict');
            if (strictEl) strictEl.style.display = nextUnpaid.strict ? '' : 'none';
            banner.style.display = '';
        } else {
            banner.style.display = 'none';
        }
    }
}

function _pmPayRenderTable(reqs) {
    const tbody = document.getElementById('pm-pay-tbody');
    if (!tbody) return;
    if (!reqs.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="pm-empty-row">No payment requests yet.</td></tr>';
        return;
    }
    const statusBadge = {
        paid:     '<span class="pm-badge pm-badge-paid">Paid</span>',
        verified: '<span class="pm-badge pm-badge-paid">Paid</span>',
        partial:  '<span class="pm-badge pm-badge-partial">Partial</span>',
        unpaid:   '<span class="pm-badge pm-badge-unpaid">Unpaid</span>',
        submitted:'<span class="pm-badge pm-badge-partial">Pending review</span>',
        rejected: '<span class="pm-badge pm-badge-unpaid">Rejected</span>',
    };
    tbody.innerHTML = reqs.map(r => {
        const isSelfPay = r.source === 'self_payment';
        const dateStr = r.weekEndingDate ? new Date(r.weekEndingDate+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
        const carry   = r.carryover ? _fmt(r.carryover) : '₱0';
        const total   = _fmt(r.totalAmount || ((r.amount||0)+(r.carryover||0)));
        const badge   = statusBadge[r.status] || `<span class="pm-badge pm-badge-unpaid">${_esc(r.status||'—')}</span>`;
        // Self-payments are client-initiated and stand-alone — the "Strict" concept
        // (admin-issued weekly bills) doesn't apply, so flag them instead.
        const strictBadge = isSelfPay
            ? '<span class="pm-badge pm-badge-partial">Client paid</span>'
            : (r.strict
                ? '<span class="pm-badge pm-badge-strict">Strict</span>'
                : '<span style="color:#9ca3af;font-size:12px;">—</span>');
        // Self-pay rows get a Review action (see receipt → approve/reject); admin-issued
        // bills keep Edit + Strict.
        const actions = isSelfPay
            ? `<button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="review"><i data-lucide="receipt" style="width:12px;height:12px;"></i> ${r.status === 'submitted' ? 'Review' : 'View'}</button>`
            : `<button class="pm-tbl-btn pm-tbl-btn-edit" data-pm-action="edit"><i data-lucide="pencil" style="width:12px;height:12px;"></i> Edit</button>
               <button class="pm-tbl-btn ${r.strict ? 'pm-tbl-btn-delete' : 'pm-tbl-btn-strict'}" data-pm-action="toggle-strict">
                 <i data-lucide="${r.strict ? 'unlock' : 'lock'}" style="width:12px;height:12px;"></i> ${r.strict ? 'Unstrict' : 'Strict'}
               </button>`;

        return `<tr data-pm-id="${_esc(r.id)}">
            <td><strong>${_esc(dateStr)}</strong>${isSelfPay ? '<div style="font-size:11px;color:#6b7280;">Self payment</div>' : ''}</td>
            <td>${_fmt(r.amount)}</td>
            <td>${carry}</td>
            <td><strong>${total}</strong></td>
            <td>${strictBadge}</td>
            <td>${badge}</td>
            <td>${actions}</td>
        </tr>`;
    }).join('');
    if (!tbody._handlerAttached) {
        tbody._handlerAttached = true;
        tbody.addEventListener('click', ev => {
            const btn = ev.target.closest('[data-pm-action]');
            if (!btn) return;
            const tr  = btn.closest('[data-pm-id]');
            if (!tr) return;
            const r   = _pmPayRequests.find(x => x.id === tr.getAttribute('data-pm-id'));
            if (!r) return;
            if (btn.getAttribute('data-pm-action') === 'edit')          pmEditPayReq(r);
            if (btn.getAttribute('data-pm-action') === 'toggle-strict') pmToggleStrict(r.id, !r.strict);
            if (btn.getAttribute('data-pm-action') === 'review')        pmReviewSelfPay(r);
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmOpenPaymentRequestModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    document.getElementById('pmPayReqId').value        = '';
    document.getElementById('pmPayReqDate').value      = _nextFriday();
    document.getElementById('pmPayReqAmount').value    = '';
    document.getElementById('pmPayReqCarryover').value = '0';
    document.getElementById('pmPayReqStrict').checked  = false;
    document.getElementById('pmPayReqNotes').value     = '';
    ['err-pmPayReqDate','err-pmPayReqAmount'].forEach(_pmClearErr);
    document.getElementById('pmPaymentRequestModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmEditPayReq = function(req) {
    document.getElementById('pmPayReqId').value        = req.id;
    document.getElementById('pmPayReqDate').value      = req.weekEndingDate || '';
    document.getElementById('pmPayReqAmount').value    = req.amount   || '';
    document.getElementById('pmPayReqCarryover').value = req.carryover || '0';
    document.getElementById('pmPayReqStrict').checked  = !!req.strict;
    document.getElementById('pmPayReqNotes').value     = req.notes   || '';
    ['err-pmPayReqDate','err-pmPayReqAmount'].forEach(_pmClearErr);
    document.getElementById('pmPaymentRequestModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSavePaymentRequest = async function() {
    const reqId    = document.getElementById('pmPayReqId').value;
    const weekEndingDate = document.getElementById('pmPayReqDate').value;
    const amount   = parseFloat(document.getElementById('pmPayReqAmount').value)    || 0;
    const carryover= parseFloat(document.getElementById('pmPayReqCarryover').value) || 0;
    const strict   = document.getElementById('pmPayReqStrict').checked;
    const notes    = document.getElementById('pmPayReqNotes').value.trim();
    let valid = true;
    if (!weekEndingDate) { _pmShowErr('err-pmPayReqDate','Select the week date.'); valid = false; }
    if (amount<=0) { _pmShowErr('err-pmPayReqAmount','Enter the amount due.'); valid = false; }
    if (!valid) return;
    const totalAmount = amount + carryover;
    const data = { weekEndingDate, amount, carryover, totalAmount, strict, notes,
                   billingPeriod: 'Week of ' + weekEndingDate,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    const btn = document.querySelector('#pmPaymentRequestModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const col = db.collection('paymentRequests');
        if (reqId) {
            await col.doc(reqId).update(data);
        } else {
            data.createdAt           = firebase.firestore.FieldValue.serverTimestamp();
            data.kind                = 'construction';
            data.status              = 'unpaid';
            data.amountPaid          = 0;
            data.source              = 'pm-admin';
            data.clientEmail         = _pmActiveProject.clientEmail || '';
            data.clientName          = _pmActiveProject.clientName  || '';
            data.projectName         = _pmActiveProject.projectName || '';
            data.constructionProjectId = _pmActiveProject.id;
            await col.add(data);
        }
        pmCloseModal('pmPaymentRequestModal');
        _pmLoadPayments();
    } catch(e) {
        alert('Save failed: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="send" style="width:14px;height:14px;"></i> Send Request';
        if (window.lucide) lucide.createIcons();
    }
};

window.pmToggleStrict = async function(id, makeStrict) {
    try {
        await db.collection('paymentRequests').doc(id)
          .update({ strict: makeStrict, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        _pmLoadPayments();
    } catch(e) { alert('Error: ' + e.message); }
};

// ── Client self-payment review (receipt verify) ───────────────────────────
let _pmReviewReq = null;

window.pmReviewSelfPay = function(r) {
    _pmReviewReq = r;
    const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setTxt('pmSelfPayClient', r.clientName || r.clientEmail || '—');
    setTxt('pmSelfPayAmount', _fmt(r.paidAmount || r.amount || r.totalAmount || 0));
    setTxt('pmSelfPayRef',    r.referenceNumber || '—');
    setTxt('pmSelfPayPeriod', r.billingPeriod || '—');
    const dt = r.submittedAt?.toDate?.() || (r.weekEndingDate ? new Date(r.weekEndingDate + 'T00:00:00') : null);
    setTxt('pmSelfPayDate', dt ? dt.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' }) : '—');

    const img = document.getElementById('pmSelfPayImg');
    if (img) { img.src = r.proofBase64 || ''; img.style.display = r.proofBase64 ? 'block' : 'none'; }
    const noImg = document.getElementById('pmSelfPayNoImg');
    if (noImg) noImg.style.display = r.proofBase64 ? 'none' : 'block';

    const pending = r.status === 'submitted';
    const actions = document.getElementById('pmSelfPayActions');
    if (actions) actions.style.display = pending ? 'flex' : 'none';
    const note = document.getElementById('pmSelfPayStatusNote');
    if (note) {
        if (pending) { note.style.display = 'none'; }
        else {
            note.style.display = 'block';
            note.textContent = r.status === 'verified'
                ? '✓ Approved — recorded as paid.'
                : (r.status === 'rejected'
                    ? ('✕ Rejected' + (r.rejectedReason ? ': ' + r.rejectedReason : ''))
                    : '');
            note.style.color = r.status === 'verified' ? '#15803d' : '#dc2626';
        }
    }
    const rw = document.getElementById('pmSelfPayRejectWrap'); if (rw) rw.style.display = 'none';
    const rt = document.getElementById('pmSelfPayRejectReason'); if (rt) rt.value = '';

    document.getElementById('pmSelfPayReviewModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmApproveSelfPay = async function() {
    if (!_pmReviewReq) return;
    const r = _pmReviewReq;
    const btn = document.getElementById('pmSelfPayApproveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
    try {
        const amt = r.paidAmount || r.amount || r.totalAmount || 0;
        await db.collection('paymentRequests').doc(r.id).update({
            status:      'verified',
            amountPaid:  amt,
            totalAmount: r.totalAmount || amt,
            verifiedAt:  firebase.firestore.FieldValue.serverTimestamp(),
            verifiedBy:  (firebase.auth().currentUser && firebase.auth().currentUser.email) || '',
            updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
        });
        _pmNotifyClientSelfPay(r, true, '');
        pmCloseModal('pmSelfPayReviewModal');
        _pmLoadPayments();
    } catch(e) { alert('Approve failed: ' + e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Approve & Mark Paid'; } }
};

window.pmShowRejectSelfPay = function() {
    const w = document.getElementById('pmSelfPayRejectWrap');
    if (w) w.style.display = 'block';
    document.getElementById('pmSelfPayRejectReason')?.focus();
};

window.pmRejectSelfPay = async function() {
    if (!_pmReviewReq) return;
    const r = _pmReviewReq;
    const reason = (document.getElementById('pmSelfPayRejectReason')?.value || '').trim();
    if (!reason) { alert('Please enter a reason for rejection.'); return; }
    const btn = document.getElementById('pmSelfPayRejectConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Rejecting…'; }
    try {
        await db.collection('paymentRequests').doc(r.id).update({
            status:         'rejected',
            rejectedReason: reason,
            rejectedAt:     firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt:      firebase.firestore.FieldValue.serverTimestamp()
        });
        _pmNotifyClientSelfPay(r, false, reason);
        pmCloseModal('pmSelfPayReviewModal');
        _pmLoadPayments();
    } catch(e) { alert('Reject failed: ' + e.message); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Confirm Reject'; } }
};

async function _pmNotifyClientSelfPay(r, approved, reason) {
    try {
        if (!r.clientUid) return;
        const amt = (r.paidAmount || r.amount || 0).toLocaleString('en-PH');
        await db.collection('notifications').doc(r.clientUid).collection('items').add({
            type:      approved ? 'payment_verified' : 'payment_rejected',
            message:   approved
                ? `Your payment${r.billingPeriod ? ' for "' + r.billingPeriod + '"' : ''} of ₱${amt} has been verified.`
                : `Your payment${r.billingPeriod ? ' for "' + r.billingPeriod + '"' : ''} was rejected${reason ? ': ' + reason : ''}.`,
            isRead:    false,
            relatedId: r.id || '',
            createdAt: firebase.firestore.Timestamp.fromDate(new Date())
        });
    } catch(e) { console.warn('PM: client notify failed', e); }
}

// ══════════════════════════════════════════════════════════
// Utilities
// ══════════════════════════════════════════════════════════
window.pmCloseModal = function(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
};

function _pmSet(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function _pmShowErr(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('visible'); el.style.display = 'block'; }
}
function _pmClearErr(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.remove('visible'); el.style.display = 'none'; }
}
function _esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function _fmt(val) {
    if (val == null || val === '') return '—';
    return '₱' + Number(val).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function _nextFriday() {
    const d = new Date();
    const day = d.getDay(); // 0=Sun,5=Fri
    const diff = (5 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0,10);
}

// ══════════════════════════════════════════════════════════
// LABOR CONTRACTS (PAKYAW / IN-HOUSE CAPPED PAY) — Project Management
// Project-scoped capped agreements in constructionProjects/{id}/laborContracts.
// Drawdown = saved Daily Expenses "Labor" lines (weeklyBills.entries, type 'labor')
// tagged with the contract id. Collapsible panel inside the Daily Expenses tab.
// Admin-only. Mirrors the Project-Control feature against the PM data model.
// ══════════════════════════════════════════════════════════
let _pmLaborContracts = [];

function _pmLcCol() {
    return db.collection('constructionProjects').doc(_pmActiveProject.id).collection('laborContracts');
}
// Labor Contracts now live in their OWN tab (the management home). Opening the tab
// reloads the project's weekly bills first, so "paid-to-date" (summed from the daily
// Labor lines tagged to each contract) is always current. The Daily Expenses tab keeps
// only the "Is this part of a job?" dropdown, populated from the same _pmLaborContracts.
async function _pmLoadLaborTab() {
    if (!_pmActiveProject) { _pmLaborContracts = []; _pmWeekBills = []; _pmRenderContracts(); return; }
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('weeklyBills')
            .orderBy('weekEndingDate', 'desc')
            .get();
        _pmWeekBills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn('PM labor tab bills:', e.message); }
    await _pmLoadLaborContracts();
}
async function _pmLoadLaborContracts() {
    if (!_pmActiveProject) { _pmLaborContracts = []; _pmRenderContracts(); return; }
    try {
        const snap = await _pmLcCol().get();
        _pmLaborContracts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(c => c.category !== 'outsource')   // shared table; labor tab excludes outsource
            .sort((a, b) => (a.workerName || '').localeCompare(b.workerName || '')
                         || (a.scope || '').localeCompare(b.scope || ''));
    } catch (e) { console.warn('PM labor contracts load:', e.message); _pmLaborContracts = []; }
    _pmRenderContracts();
    _pmPopulateContractPicker();
    if (typeof _pmRenderContractsTab === 'function') _pmRenderContractsTab();   // refresh merged Contracts tab
}

// Paid-to-date = every saved Daily Expenses labor line tagged to this contract.
function _pmContractPaid(contractId) {
    if (!contractId) return 0;
    let sum = 0;
    (_pmWeekBills || []).forEach(b => {
        (Array.isArray(b.entries) ? b.entries : []).forEach(e => {
            if (e.type === 'labor' && e.contractId === contractId) sum += (Number(e.amount) || 0);
        });
    });
    return sum;
}
function _pmContractStats(c) {
    const agreed = Number(c.agreedAmount) || 0;
    const paid = _pmContractPaid(c.id);
    const remaining = agreed - paid;
    const pct = agreed > 0 ? (paid / agreed) * 100 : 0;
    let status = 'Ongoing';
    if (agreed > 0 && paid >= agreed) status = paid > agreed ? 'Over' : 'Completed';
    return { agreed, paid, remaining, pct, status };
}

// ── Labor add-row picker ───────────────────────────────────
function _pmPopulateContractPicker() {
    const sel = document.getElementById('pm-week-contract');
    if (sel) {
        const cur = sel.value;
        sel.innerHTML = '<option value="">— None (regular labor) —</option>'
            + _pmLaborContracts.map(c => {
                const st = _pmContractStats(c);
                return '<option value="' + c.id + '">' + _esc(c.workerName || 'Worker') + ' · ' + _esc(c.scope || 'job')
                    + ' (' + _fmt(st.remaining) + ' left)</option>';
            }).join('');
        if (cur && _pmLaborContracts.some(c => c.id === cur)) sel.value = cur;
    }
    const dl = document.getElementById('pmLcWorkerNames');
    if (dl) dl.innerHTML = [...new Set(_pmLaborContracts.map(c => (c.workerName || '').trim()).filter(Boolean))]
        .map(n => '<option value="' + _esc(n) + '">').join('');
}
window.pmWeekContractHint = function() {
    const sel = document.getElementById('pm-week-contract');
    const hint = document.getElementById('pm-week-contract-remaining');
    if (!sel || !hint) return;
    const c = _pmLaborContracts.find(x => x.id === sel.value);
    if (!c) { hint.style.display = 'none'; hint.innerHTML = ''; return; }
    const st = _pmContractStats(c);
    hint.style.display = '';
    hint.innerHTML = st.remaining < 0
        ? '<strong class="pm-lc-neg">' + _fmt(Math.abs(st.remaining)) + ' over</strong> the ' + _fmt(st.agreed) + ' agreed'
        : '<strong>' + _fmt(st.remaining) + ' left</strong> of ' + _fmt(st.agreed) + ' agreed';
};

// ── Worker Tracker panel (collapsible, in Daily Expenses) ──
window.pmContractsToggle = function() {
    const body = document.getElementById('pm-contracts-body');
    const chev = document.getElementById('pm-contracts-chev');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
    // Header summary is for the COLLAPSED state only — when expanded the green
    // banner inside the body already says it, so hide the header copy to avoid repeats.
    const sumEl = document.getElementById('pm-contracts-summary');
    if (sumEl) sumEl.style.display = open ? '' : 'none';
};
// Plain-language statement view for one contract (the "bank statement row").
// Returns the friendly sentence, the right-side amount-left + its label/colour,
// and the progress bar style — shared by the panel rows and the ledger banner.
function _pmLcView(st) {
    const peso = n => '' + _fmt(Math.abs(Math.round(n)));
    let sentence, sentOver = false, rAmt, rLbl, rCls, amtCls, barCls,
        barPct = Math.min(100, Math.max(0, st.pct));
    if (st.status === 'Over') {
        const over = st.paid - st.agreed;
        sentence = 'Paid ' + peso(st.paid) + ' — <b>' + peso(over) + ' more</b> than the ' + peso(st.agreed) + ' agreed';
        sentOver = true; rAmt = '+' + peso(over); rLbl = '⚠ Over agreed';
        rCls = 'pm-lc-stat-over'; amtCls = 'pm-lc-amt-over'; barCls = 'pm-lc-bar-over'; barPct = 100;
    } else if (st.status === 'Completed') {
        sentence = 'Paid ' + peso(st.paid) + ' of ' + peso(st.agreed) + ' — nothing left';
        rAmt = '₱0'; rLbl = '✓ Fully paid';
        rCls = 'pm-lc-stat-done'; amtCls = 'pm-lc-amt-done'; barCls = 'pm-lc-bar-done'; barPct = 100;
    } else {
        sentence = 'Paid ' + peso(st.paid) + ' of ' + peso(st.agreed) + ' — <b>' + peso(st.remaining) + ' to go</b>';
        rAmt = peso(st.remaining); rLbl = 'In progress · ' + st.pct.toFixed(0) + '%';
        rCls = 'pm-lc-stat-on'; amtCls = ''; barCls = 'pm-lc-bar-ok';
    }
    return { sentence, sentOver, rAmt, rLbl, rCls, amtCls, barCls, barPct };
}

function _pmRenderContracts() {
    const sumEl = document.getElementById('pm-contracts-summary');
    const body  = document.getElementById('pm-contracts-body');
    if (!body) return;
    const n = _pmLaborContracts.length;
    let totAgreed = 0, totPaid = 0;
    _pmLaborContracts.forEach(c => { const s = _pmContractStats(c); totAgreed += s.agreed; totPaid += s.paid; });
    const totRem = totAgreed - totPaid;
    if (sumEl) sumEl.textContent = n
        ? (n + ' job' + (n === 1 ? '' : 's') + ' · ' + _fmt(totRem) + ' still to pay')
        : 'No contracts yet';
    if (!n) { body.innerHTML = '<div class="pm-lc-empty">No labor contracts yet. Click "＋ New Contract" to cap a worker’s job (pakyaw or in-house). Then tag a Labor entry to it when you log the day.</div>'; return; }

    // group by worker (avatar sections), count jobs/workers for the banner
    const byW = {};
    _pmLaborContracts.forEach(c => { const w = (c.workerName || '—').trim() || '—'; (byW[w] = byW[w] || []).push(c); });
    const workerNames = Object.keys(byW).sort((a, b) => a.localeCompare(b));
    const totPct = totAgreed > 0 ? Math.min(100, (totPaid / totAgreed) * 100) : 0;

    // ① summary banner — "Across N workers and M jobs, you still owe …"
    const banner = '<div class="pm-lc-summary">'
        + '<div class="pm-lc-sum-left">'
        + '<div class="pm-lc-sum-cap">Across <b>' + workerNames.length + ' worker' + (workerNames.length === 1 ? '' : 's')
        + '</b> and <b>' + n + ' job' + (n === 1 ? '' : 's') + '</b>, you still owe</div>'
        + '<div class="pm-lc-sum-big num">' + _fmt(totRem) + ' <span>of ' + _fmt(totAgreed) + ' agreed</span></div>'
        + '</div>'
        + '<div class="pm-lc-sum-right">'
        + '<div class="pm-lc-sum-bar"><div style="width:' + totPct.toFixed(0) + '%"></div></div>'
        + '<div class="pm-lc-sum-pct">' + totPct.toFixed(0) + '% paid so far</div>'
        + '</div></div>';

    // ② worker sections of statement rows — tap a whole row to open its ledger
    const sections = workerNames.map(w => {
        const cs = byW[w].slice().sort((a, b) => (a.scope || '').localeCompare(b.scope || ''));
        const initial = (w.replace(/[^A-Za-z0-9]/g, '')[0] || '—').toUpperCase();
        const rows = cs.map(c => {
            const st = _pmContractStats(c);
            const v = _pmLcView(st);
            const typeLbl = c.payType === 'inhouse' ? 'In-house' : 'Pakyaw';
            const typeCls = c.payType === 'inhouse' ? 'pm-lc-type-inh' : 'pm-lc-type-pak';
            const overRow = st.status === 'Over' ? ' pm-lc-row-over' : '';
            return '<div class="pm-lc-row' + overRow + '" onclick="pmLcOpenLedger(\'' + c.id + '\')">'
                + '<div class="pm-lc-rmain">'
                + '<div class="pm-lc-rtitle"><span class="pm-lc-rscope">' + _esc(c.scope || 'Untitled job')
                + '</span><span class="pm-lc-type ' + typeCls + '">' + typeLbl + '</span></div>'
                + '<div class="pm-lc-rsent num' + (v.sentOver ? ' pm-lc-rsent-over' : '') + '">' + v.sentence + '</div>'
                + '<div class="pm-lc-rbar"><div class="pm-lc-rbar-fill ' + v.barCls + '" style="width:' + v.barPct.toFixed(1) + '%"></div></div>'
                + '</div>'
                + '<div class="pm-lc-rright"><div class="pm-lc-ramt num ' + v.amtCls + '">' + v.rAmt + '</div>'
                + '<div class="pm-lc-rstat ' + v.rCls + '">' + v.rLbl + '</div></div>'
                + '<svg class="pm-lc-rchev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
                + '</div>';
        }).join('');
        return '<div class="pm-lc-wsec">'
            + '<div class="pm-lc-whead2"><span class="pm-lc-avatar">' + _esc(initial) + '</span>'
            + '<span class="pm-lc-wname2">' + _esc(w) + '</span>'
            + '<span class="pm-lc-wjobs">· ' + cs.length + ' job' + (cs.length === 1 ? '' : 's') + '</span></div>'
            + rows + '</div>';
    }).join('');

    body.innerHTML = banner + sections;
}

// ── Create / edit / raise cap / delete ─────────────────────
window.pmLcOpenNew = function() {
    if (!_pmActiveProject) { _pmToast('Open a project first.', true); return; }
    document.getElementById('pmLcId').value = '';
    document.getElementById('pmLcWorker').value = '';
    document.getElementById('pmLcScope').value = '';
    document.getElementById('pmLcAmount').value = '';
    document.getElementById('pmLcNotes').value = '';
    const pk = document.querySelector('input[name="pmLcPayType"][value="pakyaw"]'); if (pk) pk.checked = true;
    const t = document.getElementById('pmLcModalTitle'); if (t) t.textContent = 'New Labor Contract';
    _pmPopulateContractPicker();
    document.getElementById('pmLaborContractModal').style.display = 'flex';
};
window.pmLcOpenEdit = function(id) {
    const c = _pmLaborContracts.find(x => x.id === id); if (!c) return;
    document.getElementById('pmLcId').value = c.id;
    document.getElementById('pmLcWorker').value = c.workerName || '';
    document.getElementById('pmLcScope').value = c.scope || '';
    document.getElementById('pmLcAmount').value = c.agreedAmount ? Number(c.agreedAmount).toLocaleString('en-PH') : '';
    document.getElementById('pmLcNotes').value = c.notes || '';
    const r = document.querySelector('input[name="pmLcPayType"][value="' + (c.payType === 'inhouse' ? 'inhouse' : 'pakyaw') + '"]'); if (r) r.checked = true;
    const t = document.getElementById('pmLcModalTitle'); if (t) t.textContent = 'Edit Labor Contract';
    _pmPopulateContractPicker();
    document.getElementById('pmLaborContractModal').style.display = 'flex';
};
window.pmLcSave = async function(e) {
    if (e) e.preventDefault();
    if (!_pmActiveProject) { _pmToast('No project selected.', true); return; }
    const id = document.getElementById('pmLcId').value;
    const workerName = document.getElementById('pmLcWorker').value.trim();
    const scope = document.getElementById('pmLcScope').value.trim();
    const agreedAmount = parseFloat((document.getElementById('pmLcAmount').value || '').replace(/,/g, '')) || 0;
    const notes = document.getElementById('pmLcNotes').value.trim();
    const payType = (document.querySelector('input[name="pmLcPayType"]:checked') || {}).value || 'pakyaw';
    if (!workerName) { _pmToast('Enter the worker name.', true); return; }
    if (agreedAmount <= 0) { _pmToast('Enter the agreed amount (cap).', true); return; }
    try {
        if (id) {
            const ex = _pmLaborContracts.find(x => x.id === id);
            const upd = { workerName, scope, agreedAmount, payType, notes, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
            if (ex && (Number(ex.agreedAmount) || 0) !== agreedAmount) {
                const h = Array.isArray(ex.capHistory) ? ex.capHistory.slice() : [];
                h.push({ amount: agreedAmount, at: new Date().toISOString(), note: 'Edited cap' });
                upd.capHistory = h;
            }
            await _pmLcCol().doc(id).update(upd);
        } else {
            await _pmLcCol().add({ workerName, scope, agreedAmount, payType, notes, status: 'ongoing', category: 'labor',
                capHistory: [{ amount: agreedAmount, at: new Date().toISOString(), note: 'Initial cap' }],
                createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        pmCloseModal('pmLaborContractModal');
        _pmToast('Contract saved');
        await _pmLoadLaborContracts();
    } catch (err) { _pmToast('Error: ' + err.message, true); }
};
window.pmLcRaiseCap = async function(id) {
    const c = _pmLaborContracts.find(x => x.id === id); if (!c) return;
    const cur = Number(c.agreedAmount) || 0;
    const input = prompt('Raise cap for ' + (c.workerName || 'worker') + ' — ' + (c.scope || 'job')
        + '\nCurrent agreed: ' + _fmt(cur) + '\n\nEnter the NEW agreed amount:', cur);
    if (input === null) return;
    const next = parseFloat(String(input).replace(/,/g, '')) || 0;
    if (next <= 0) { _pmToast('Enter a valid amount.', true); return; }
    try {
        const h = Array.isArray(c.capHistory) ? c.capHistory.slice() : [];
        h.push({ amount: next, at: new Date().toISOString(), note: next >= cur ? 'Raised cap' : 'Lowered cap' });
        await _pmLcCol().doc(id).update({ agreedAmount: next, capHistory: h, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        _pmToast('Cap updated');
        await _pmLoadLaborContracts();
    } catch (err) { _pmToast('Error: ' + err.message, true); }
};
window.pmLcDelete = async function(id) {
    const paid = _pmContractPaid(id);
    const msg = paid > 0
        ? 'This contract has ' + _fmt(paid) + ' in linked labor lines. Deleting it leaves those lines but un-caps them. Continue?'
        : 'Delete this labor contract?';
    if (!confirm(msg)) return;
    try {
        await _pmLcCol().doc(id).delete();
        _pmToast('Contract deleted');
        await _pmLoadLaborContracts();
    } catch (err) { _pmToast('Error: ' + err.message, true); }
};

// ── Per-contract ledger (the labor lines that drew it down) ─
let _pmLcLedgerId = null;
window.pmLcOpenLedger = function(id) {
    const c = _pmLaborContracts.find(x => x.id === id); if (!c) return;
    _pmLcLedgerId = id;
    const st = _pmContractStats(c);
    const v  = _pmLcView(st);
    const rows = [];
    (_pmWeekBills || []).forEach(b => (Array.isArray(b.entries) ? b.entries : []).forEach(e => {
        if (e.type === 'labor' && e.contractId === id) rows.push({ date: b.weekEndingDate, details: e.details || 'Labor payment', amount: Number(e.amount) || 0 });
    }));
    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const initial = ((c.workerName || '—').replace(/[^A-Za-z0-9]/g, '')[0] || '—').toUpperCase();
    const typeLbl = c.payType === 'inhouse' ? 'In-house' : 'Pakyaw';
    const titleEl = document.getElementById('pmLcLedgerTitle');
    if (titleEl) titleEl.innerHTML =
        '<span class="pm-lc-led-avatar">' + _esc(initial) + '</span>'
        + '<span class="pm-lc-led-htext"><span class="pm-lc-led-hname">' + _esc(c.workerName || 'Worker') + ' — ' + _esc(c.scope || 'Contract')
        + '</span><span class="pm-lc-led-hsub">' + typeLbl + ' · payment history</span></span>';

    const fmtD = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return d || '—'; } };

    // green banner — amount left is the focus
    let bigLbl = 'Still to pay on this job', bigVal = v.rAmt, subLine;
    if (st.status === 'Over')      { bigLbl = 'Over the agreed amount'; subLine = '' + _fmt(st.paid) + ' paid · ' + _fmt(st.paid - st.agreed) + ' more than ' + _fmt(st.agreed) + ' agreed'; }
    else if (st.status === 'Completed') { bigLbl = 'Fully paid — nothing left'; subLine = '' + _fmt(st.paid) + ' paid of ' + _fmt(st.agreed) + ' agreed · 100%'; }
    else { subLine = '' + _fmt(st.paid) + ' paid of ' + _fmt(st.agreed) + ' agreed · ' + st.pct.toFixed(0) + '%'; }
    const overCls = st.status === 'Over' ? ' pm-lc-led-banner-over' : '';

    // timeline of payments with running "left after"
    let running = st.agreed;
    const items = rows.map((r, i) => {
        running -= r.amount;
        const last = i === rows.length - 1;
        return '<div class="pm-lc-tl-item">'
            + '<span class="pm-lc-tl-dot' + (last ? ' pm-lc-tl-dot-on' : '') + '"></span>'
            + '<div class="pm-lc-tl-row"><span class="pm-lc-tl-name">' + _esc(r.details) + '</span>'
            + '<span class="pm-lc-tl-amt num">' + _fmt(r.amount) + '</span></div>'
            + '<div class="pm-lc-tl-meta num' + (running < 0 ? ' pm-lc-neg' : (last ? ' pm-lc-tl-meta-on' : '')) + '">'
            + fmtD(r.date) + ' · ' + _fmt(running) + ' left after</div></div>';
    }).join('');
    const listHtml = rows.length
        ? '<div class="pm-lc-led-cnt">' + rows.length + ' payment' + (rows.length === 1 ? '' : 's') + '</div><div class="pm-lc-timeline">' + items + '</div>'
        : '<div class="pm-lc-empty">No payments yet. Tag a daily Labor entry to this job to start counting it down.</div>';

    const body = document.getElementById('pmLcLedgerBody');
    if (body) body.innerHTML =
        '<div class="pm-lc-led-banner' + overCls + '">'
        + '<div class="pm-lc-led-lbl">' + bigLbl + '</div>'
        + '<div class="pm-lc-led-big num">' + bigVal + '</div>'
        + '<div class="pm-lc-led-pbar"><div class="' + v.barCls + '" style="width:' + v.barPct.toFixed(0) + '%"></div></div>'
        + '<div class="pm-lc-led-sub num">' + subLine + '</div></div>'
        + '<div class="pm-lc-led-list">' + listHtml + '</div>';
    document.getElementById('pmLaborLedgerModal').style.display = 'flex';
};

// In-ledger actions (rows themselves have no buttons — tap row → ledger → manage)
window.pmLcLedgerEdit  = function() { const id = _pmLcLedgerId; if (!id) return; pmCloseModal('pmLaborLedgerModal'); pmLcOpenEdit(id); };
window.pmLcLedgerRaise = function() { if (_pmLcLedgerId) pmLcRaiseCap(_pmLcLedgerId); };
window.pmLcLedgerDelete = async function() { const id = _pmLcLedgerId; if (!id) return; await pmLcDelete(id); if (!_pmLaborContracts.some(c => c.id === id)) pmCloseModal('pmLaborLedgerModal'); };

// ══════════════════════════════════════════════════════════
//  OUTSOURCE CONTRACTS (Out Source = entry type 'both')
//  Parallel of the Labor Contracts feature: same capped-contract
//  workflow, but the cap is paid down by the Daily Expenses
//  "Out Source" lines instead of the "Labor" lines. Stored in the
//  SAME `pm_labor_contracts` table (collection `laborContracts`)
//  with category:'outsource'. Reuses _pmLcView + the .pm-lc-* CSS.
// ══════════════════════════════════════════════════════════
let _pmOutsourceContracts = [];

// Same collection as labor — rows are split by `category`.
function _pmOcCol() { return _pmLcCol(); }

async function _pmLoadOutsourceTab() {
    if (!_pmActiveProject) { _pmOutsourceContracts = []; _pmWeekBills = []; _pmRenderOutsource(); return; }
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('weeklyBills')
            .orderBy('weekEndingDate', 'desc')
            .get();
        _pmWeekBills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn('PM outsource tab bills:', e.message); }
    await _pmLoadOutsourceContracts();
}
async function _pmLoadOutsourceContracts() {
    if (!_pmActiveProject) { _pmOutsourceContracts = []; _pmRenderOutsource(); return; }
    try {
        const snap = await _pmOcCol().get();
        _pmOutsourceContracts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .filter(c => c.category === 'outsource')   // shared table; outsource tab only
            .sort((a, b) => (a.workerName || '').localeCompare(b.workerName || '')
                         || (a.scope || '').localeCompare(b.scope || ''));
    } catch (e) { console.warn('PM outsource contracts load:', e.message); _pmOutsourceContracts = []; }
    _pmRenderOutsource();
    _pmPopulateOutsourcePicker();
    if (typeof _pmRenderContractsTab === 'function') _pmRenderContractsTab();   // refresh merged Contracts tab
}

// Paid-to-date = every saved Daily Expenses Out Source ('both') line tagged here.
function _pmOcPaid(contractId) {
    if (!contractId) return 0;
    let sum = 0;
    (_pmWeekBills || []).forEach(b => {
        (Array.isArray(b.entries) ? b.entries : []).forEach(e => {
            if (e.type === 'both' && e.contractId === contractId) sum += (Number(e.amount) || 0);
        });
    });
    return sum;
}
function _pmOcStats(c) {
    const agreed = Number(c.agreedAmount) || 0;
    const paid = _pmOcPaid(c.id);
    const remaining = agreed - paid;
    const pct = agreed > 0 ? (paid / agreed) * 100 : 0;
    let status = 'Ongoing';
    if (agreed > 0 && paid >= agreed) status = paid > agreed ? 'Over' : 'Completed';
    return { agreed, paid, remaining, pct, status };
}

// ── Out Source add-row picker (shown for the 'both' category) ──
function _pmPopulateOutsourcePicker() {
    const sel = document.getElementById('pm-week-outsource');
    if (sel) {
        const cur = sel.value;
        sel.innerHTML = '<option value="">— None (regular out source) —</option>'
            + _pmOutsourceContracts.map(c => {
                const st = _pmOcStats(c);
                return '<option value="' + c.id + '">' + _esc(c.workerName || 'Vendor') + ' · ' + _esc(c.scope || 'job')
                    + ' (' + _fmt(st.remaining) + ' left)</option>';
            }).join('');
        if (cur && _pmOutsourceContracts.some(c => c.id === cur)) sel.value = cur;
    }
    const dl = document.getElementById('pmOcWorkerNames');
    if (dl) dl.innerHTML = [...new Set(_pmOutsourceContracts.map(c => (c.workerName || '').trim()).filter(Boolean))]
        .map(n => '<option value="' + _esc(n) + '">').join('');
}
window.pmWeekOutsourceHint = function() {
    const sel = document.getElementById('pm-week-outsource');
    const hint = document.getElementById('pm-week-outsource-remaining');
    if (!sel || !hint) return;
    const c = _pmOutsourceContracts.find(x => x.id === sel.value);
    if (!c) { hint.style.display = 'none'; hint.innerHTML = ''; return; }
    const st = _pmOcStats(c);
    hint.style.display = '';
    hint.innerHTML = st.remaining < 0
        ? '<strong class="pm-lc-neg">' + _fmt(Math.abs(st.remaining)) + ' over</strong> the ' + _fmt(st.agreed) + ' agreed'
        : '<strong>' + _fmt(st.remaining) + ' left</strong> of ' + _fmt(st.agreed) + ' agreed';
};

function _pmRenderOutsource() {
    const sumEl = document.getElementById('pm-outsource-summary');
    const body  = document.getElementById('pm-outsource-body');
    if (!body) return;
    const n = _pmOutsourceContracts.length;
    let totAgreed = 0, totPaid = 0;
    _pmOutsourceContracts.forEach(c => { const s = _pmOcStats(c); totAgreed += s.agreed; totPaid += s.paid; });
    const totRem = totAgreed - totPaid;
    if (sumEl) sumEl.textContent = n
        ? (n + ' job' + (n === 1 ? '' : 's') + ' · ' + _fmt(totRem) + ' still to pay')
        : 'No contracts yet';
    if (!n) { body.innerHTML = '<div class="pm-lc-empty">No out source contracts yet. Click "＋ New Contract" to cap a subcontractor / supplier’s job. Then tag an Out Source entry to it when you log the day.</div>'; return; }

    const byW = {};
    _pmOutsourceContracts.forEach(c => { const w = (c.workerName || '—').trim() || '—'; (byW[w] = byW[w] || []).push(c); });
    const workerNames = Object.keys(byW).sort((a, b) => a.localeCompare(b));
    const totPct = totAgreed > 0 ? Math.min(100, (totPaid / totAgreed) * 100) : 0;

    const banner = '<div class="pm-lc-summary">'
        + '<div class="pm-lc-sum-left">'
        + '<div class="pm-lc-sum-cap">Across <b>' + workerNames.length + ' vendor' + (workerNames.length === 1 ? '' : 's')
        + '</b> and <b>' + n + ' job' + (n === 1 ? '' : 's') + '</b>, you still owe</div>'
        + '<div class="pm-lc-sum-big num">' + _fmt(totRem) + ' <span>of ' + _fmt(totAgreed) + ' agreed</span></div>'
        + '</div>'
        + '<div class="pm-lc-sum-right">'
        + '<div class="pm-lc-sum-bar"><div style="width:' + totPct.toFixed(0) + '%"></div></div>'
        + '<div class="pm-lc-sum-pct">' + totPct.toFixed(0) + '% paid so far</div>'
        + '</div></div>';

    const sections = workerNames.map(w => {
        const cs = byW[w].slice().sort((a, b) => (a.scope || '').localeCompare(b.scope || ''));
        const initial = (w.replace(/[^A-Za-z0-9]/g, '')[0] || '—').toUpperCase();
        const rows = cs.map(c => {
            const st = _pmOcStats(c);
            const v = _pmLcView(st);
            const typeLbl = c.payType === 'inhouse' ? 'In-house' : 'Pakyaw';
            const typeCls = c.payType === 'inhouse' ? 'pm-lc-type-inh' : 'pm-lc-type-pak';
            const overRow = st.status === 'Over' ? ' pm-lc-row-over' : '';
            return '<div class="pm-lc-row' + overRow + '" onclick="pmOcOpenLedger(\'' + c.id + '\')">'
                + '<div class="pm-lc-rmain">'
                + '<div class="pm-lc-rtitle"><span class="pm-lc-rscope">' + _esc(c.scope || 'Untitled job')
                + '</span><span class="pm-lc-type ' + typeCls + '">' + typeLbl + '</span></div>'
                + '<div class="pm-lc-rsent num' + (v.sentOver ? ' pm-lc-rsent-over' : '') + '">' + v.sentence + '</div>'
                + '<div class="pm-lc-rbar"><div class="pm-lc-rbar-fill ' + v.barCls + '" style="width:' + v.barPct.toFixed(1) + '%"></div></div>'
                + '</div>'
                + '<div class="pm-lc-rright"><div class="pm-lc-ramt num ' + v.amtCls + '">' + v.rAmt + '</div>'
                + '<div class="pm-lc-rstat ' + v.rCls + '">' + v.rLbl + '</div></div>'
                + '<svg class="pm-lc-rchev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
                + '</div>';
        }).join('');
        return '<div class="pm-lc-wsec">'
            + '<div class="pm-lc-whead2"><span class="pm-lc-avatar">' + _esc(initial) + '</span>'
            + '<span class="pm-lc-wname2">' + _esc(w) + '</span>'
            + '<span class="pm-lc-wjobs">· ' + cs.length + ' job' + (cs.length === 1 ? '' : 's') + '</span></div>'
            + rows + '</div>';
    }).join('');

    body.innerHTML = banner + sections;
}

// ── Create / edit / raise cap / delete ─────────────────────
window.pmOcOpenNew = function() {
    if (!_pmActiveProject) { _pmToast('Open a project first.', true); return; }
    document.getElementById('pmOcId').value = '';
    document.getElementById('pmOcWorker').value = '';
    document.getElementById('pmOcScope').value = '';
    document.getElementById('pmOcAmount').value = '';
    document.getElementById('pmOcNotes').value = '';
    const pk = document.querySelector('input[name="pmOcPayType"][value="pakyaw"]'); if (pk) pk.checked = true;
    const t = document.getElementById('pmOcModalTitle'); if (t) t.textContent = 'New Out Source Contract';
    _pmPopulateOutsourcePicker();
    document.getElementById('pmOutsourceContractModal').style.display = 'flex';
};
window.pmOcOpenEdit = function(id) {
    const c = _pmOutsourceContracts.find(x => x.id === id); if (!c) return;
    document.getElementById('pmOcId').value = c.id;
    document.getElementById('pmOcWorker').value = c.workerName || '';
    document.getElementById('pmOcScope').value = c.scope || '';
    document.getElementById('pmOcAmount').value = c.agreedAmount ? Number(c.agreedAmount).toLocaleString('en-PH') : '';
    document.getElementById('pmOcNotes').value = c.notes || '';
    const r = document.querySelector('input[name="pmOcPayType"][value="' + (c.payType === 'inhouse' ? 'inhouse' : 'pakyaw') + '"]'); if (r) r.checked = true;
    const t = document.getElementById('pmOcModalTitle'); if (t) t.textContent = 'Edit Out Source Contract';
    _pmPopulateOutsourcePicker();
    document.getElementById('pmOutsourceContractModal').style.display = 'flex';
};
window.pmOcSave = async function(e) {
    if (e) e.preventDefault();
    if (!_pmActiveProject) { _pmToast('No project selected.', true); return; }
    const id = document.getElementById('pmOcId').value;
    const workerName = document.getElementById('pmOcWorker').value.trim();
    const scope = document.getElementById('pmOcScope').value.trim();
    const agreedAmount = parseFloat((document.getElementById('pmOcAmount').value || '').replace(/,/g, '')) || 0;
    const notes = document.getElementById('pmOcNotes').value.trim();
    const payType = (document.querySelector('input[name="pmOcPayType"]:checked') || {}).value || 'pakyaw';
    if (!workerName) { _pmToast('Enter the vendor / crew name.', true); return; }
    if (agreedAmount <= 0) { _pmToast('Enter the agreed amount (cap).', true); return; }
    try {
        if (id) {
            const ex = _pmOutsourceContracts.find(x => x.id === id);
            const upd = { workerName, scope, agreedAmount, payType, notes, category: 'outsource', updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
            if (ex && (Number(ex.agreedAmount) || 0) !== agreedAmount) {
                const h = Array.isArray(ex.capHistory) ? ex.capHistory.slice() : [];
                h.push({ amount: agreedAmount, at: new Date().toISOString(), note: 'Edited cap' });
                upd.capHistory = h;
            }
            await _pmOcCol().doc(id).update(upd);
        } else {
            await _pmOcCol().add({ workerName, scope, agreedAmount, payType, notes, status: 'ongoing', category: 'outsource',
                capHistory: [{ amount: agreedAmount, at: new Date().toISOString(), note: 'Initial cap' }],
                createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        pmCloseModal('pmOutsourceContractModal');
        _pmToast('Contract saved');
        await _pmLoadOutsourceContracts();
    } catch (err) { _pmToast('Error: ' + err.message, true); }
};
window.pmOcRaiseCap = async function(id) {
    const c = _pmOutsourceContracts.find(x => x.id === id); if (!c) return;
    const cur = Number(c.agreedAmount) || 0;
    const input = prompt('Raise cap for ' + (c.workerName || 'vendor') + ' — ' + (c.scope || 'job')
        + '\nCurrent agreed: ' + _fmt(cur) + '\n\nEnter the NEW agreed amount:', cur);
    if (input === null) return;
    const next = parseFloat(String(input).replace(/,/g, '')) || 0;
    if (next <= 0) { _pmToast('Enter a valid amount.', true); return; }
    try {
        const h = Array.isArray(c.capHistory) ? c.capHistory.slice() : [];
        h.push({ amount: next, at: new Date().toISOString(), note: next >= cur ? 'Raised cap' : 'Lowered cap' });
        await _pmOcCol().doc(id).update({ agreedAmount: next, capHistory: h, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        _pmToast('Cap updated');
        await _pmLoadOutsourceContracts();
    } catch (err) { _pmToast('Error: ' + err.message, true); }
};
window.pmOcDelete = async function(id) {
    const paid = _pmOcPaid(id);
    const msg = paid > 0
        ? 'This contract has ' + _fmt(paid) + ' in linked out source lines. Deleting it leaves those lines but un-caps them. Continue?'
        : 'Delete this out source contract?';
    if (!confirm(msg)) return;
    try {
        await _pmOcCol().doc(id).delete();
        _pmToast('Contract deleted');
        await _pmLoadOutsourceContracts();
    } catch (err) { _pmToast('Error: ' + err.message, true); }
};

// ── Per-contract ledger (the out source lines that drew it down) ─
let _pmOcLedgerId = null;
window.pmOcOpenLedger = function(id) {
    const c = _pmOutsourceContracts.find(x => x.id === id); if (!c) return;
    _pmOcLedgerId = id;
    const st = _pmOcStats(c);
    const v  = _pmLcView(st);
    const rows = [];
    (_pmWeekBills || []).forEach(b => (Array.isArray(b.entries) ? b.entries : []).forEach(e => {
        if (e.type === 'both' && e.contractId === id) rows.push({ date: b.weekEndingDate, details: e.details || 'Out source payment', amount: Number(e.amount) || 0 });
    }));
    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const initial = ((c.workerName || '—').replace(/[^A-Za-z0-9]/g, '')[0] || '—').toUpperCase();
    const typeLbl = c.payType === 'inhouse' ? 'In-house' : 'Pakyaw';
    const titleEl = document.getElementById('pmOcLedgerTitle');
    if (titleEl) titleEl.innerHTML =
        '<span class="pm-lc-led-avatar">' + _esc(initial) + '</span>'
        + '<span class="pm-lc-led-htext"><span class="pm-lc-led-hname">' + _esc(c.workerName || 'Vendor') + ' — ' + _esc(c.scope || 'Contract')
        + '</span><span class="pm-lc-led-hsub">' + typeLbl + ' · payment history</span></span>';

    const fmtD = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return d || '—'; } };

    let bigLbl = 'Still to pay on this job', bigVal = v.rAmt, subLine;
    if (st.status === 'Over')      { bigLbl = 'Over the agreed amount'; subLine = '' + _fmt(st.paid) + ' paid · ' + _fmt(st.paid - st.agreed) + ' more than ' + _fmt(st.agreed) + ' agreed'; }
    else if (st.status === 'Completed') { bigLbl = 'Fully paid — nothing left'; subLine = '' + _fmt(st.paid) + ' paid of ' + _fmt(st.agreed) + ' agreed · 100%'; }
    else { subLine = '' + _fmt(st.paid) + ' paid of ' + _fmt(st.agreed) + ' agreed · ' + st.pct.toFixed(0) + '%'; }
    const overCls = st.status === 'Over' ? ' pm-lc-led-banner-over' : '';

    let running = st.agreed;
    const items = rows.map((r, i) => {
        running -= r.amount;
        const last = i === rows.length - 1;
        return '<div class="pm-lc-tl-item">'
            + '<span class="pm-lc-tl-dot' + (last ? ' pm-lc-tl-dot-on' : '') + '"></span>'
            + '<div class="pm-lc-tl-row"><span class="pm-lc-tl-name">' + _esc(r.details) + '</span>'
            + '<span class="pm-lc-tl-amt num">' + _fmt(r.amount) + '</span></div>'
            + '<div class="pm-lc-tl-meta num' + (running < 0 ? ' pm-lc-neg' : (last ? ' pm-lc-tl-meta-on' : '')) + '">'
            + fmtD(r.date) + ' · ' + _fmt(running) + ' left after</div></div>';
    }).join('');
    const listHtml = rows.length
        ? '<div class="pm-lc-led-cnt">' + rows.length + ' payment' + (rows.length === 1 ? '' : 's') + '</div><div class="pm-lc-timeline">' + items + '</div>'
        : '<div class="pm-lc-empty">No payments yet. Tag a daily Out Source entry to this job to start counting it down.</div>';

    const body = document.getElementById('pmOcLedgerBody');
    if (body) body.innerHTML =
        '<div class="pm-lc-led-banner' + overCls + '">'
        + '<div class="pm-lc-led-lbl">' + bigLbl + '</div>'
        + '<div class="pm-lc-led-big num">' + bigVal + '</div>'
        + '<div class="pm-lc-led-pbar"><div class="' + v.barCls + '" style="width:' + v.barPct.toFixed(0) + '%"></div></div>'
        + '<div class="pm-lc-led-sub num">' + subLine + '</div></div>'
        + '<div class="pm-lc-led-list">' + listHtml + '</div>';
    document.getElementById('pmOutsourceLedgerModal').style.display = 'flex';
};
window.pmOcLedgerEdit  = function() { const id = _pmOcLedgerId; if (!id) return; pmCloseModal('pmOutsourceLedgerModal'); pmOcOpenEdit(id); };
window.pmOcLedgerRaise = function() { if (_pmOcLedgerId) pmOcRaiseCap(_pmOcLedgerId); };
window.pmOcLedgerDelete = async function() { const id = _pmOcLedgerId; if (!id) return; await pmOcDelete(id); if (!_pmOutsourceContracts.some(c => c.id === id)) pmCloseModal('pmOutsourceLedgerModal'); };

// ══════════════════════════════════════════════════════════
//  CONTRACTS TAB (merged Labor + Out Source, in-tab switch)
//  One "Contracts" tab with a Labor / Out Source segmented
//  toggle (green / purple themed). Rendered as a single HTML
//  string into #pm-contracts-root. Ported from the claude_design
//  project "Minimalist design enhancement" → Contracts Tab.dc.html.
// ══════════════════════════════════════════════════════════
let _pmContractSeg = 'labor';   // 'labor' | 'outsource'

async function _pmLoadContractsTab() {
    if (!_pmActiveProject) { _pmLaborContracts = []; _pmOutsourceContracts = []; _pmWeekBills = []; _pmRenderContractsTab(); return; }
    try {
        const snap = await db.collection('constructionProjects')
            .doc(_pmActiveProject.id)
            .collection('weeklyBills')
            .orderBy('weekEndingDate', 'desc')
            .get();
        _pmWeekBills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn('PM contracts tab bills:', e.message); }
    // Load both contract sets (each also repopulates its Daily Expenses picker).
    await _pmLoadLaborContracts();
    await _pmLoadOutsourceContracts();
    _pmRenderContractsTab();
}

window.pmContractSeg = function(seg) {
    _pmContractSeg = (seg === 'outsource') ? 'outsource' : 'labor';
    _pmRenderContractsTab();
};

function _pmRenderContractsTab() {
    const root = document.getElementById('pm-contracts-root');
    if (!root) return;
    const isLabor = _pmContractSeg !== 'outsource';
    const list    = isLabor ? _pmLaborContracts : _pmOutsourceContracts;
    const statOf  = isLabor ? _pmContractStats : _pmOcStats;
    const laborN  = _pmLaborContracts.length, outN = _pmOutsourceContracts.length;

    // total count badge on the Contracts tab button (design shows it)
    const tabBtn = document.getElementById('pm-ws-tab-contracts');
    if (tabBtn) tabBtn.innerHTML = 'Contracts' + ((laborN + outN) > 0
        ? ' <span style="font-size:10.5px;font-weight:700;color:#157a52;background:#eaf4ef;border-radius:20px;padding:1px 7px;">' + (laborN + outN) + '</span>' : '');

    const t = isLabor
        ? { accent: '#157a52', accentDark: '#0f6342', soft: '#eaf4ef', bannerBg: '#f4f9f6', bannerBorder: '#d8ebe1', barTrack: '#e3efe8' }
        : { accent: '#7a5bb5', accentDark: '#5b3f96', soft: '#efeaf8', bannerBg: '#f7f3fc', bannerBorder: '#e4dbf3', barTrack: '#ece4f6' };

    // group by worker / vendor
    const byW = {};
    list.forEach(c => { const w = (c.workerName || '—').trim() || '—'; (byW[w] = byW[w] || []).push(c); });
    const names = Object.keys(byW).sort((a, b) => a.localeCompare(b));

    let totAgreed = 0, totPaid = 0;
    list.forEach(c => { const s = statOf(c); totAgreed += s.agreed; totPaid += s.paid; });
    const totRem = totAgreed - totPaid;
    const totPct = totAgreed > 0 ? Math.round((totPaid / totAgreed) * 100) : 0;

    const newFn      = isLabor ? 'pmLcOpenNew()' : 'pmOcOpenNew()';
    const ledgerFn   = isLabor ? 'pmLcOpenLedger' : 'pmOcOpenLedger';
    const newBtnLbl  = isLabor ? 'New Labor contract' : 'New Out Source contract';
    const workersLbl = names.length + ' ' + (isLabor ? 'worker' : 'vendor') + (names.length === 1 ? '' : 's');
    const jobsLbl    = list.length + ' job' + (list.length === 1 ? '' : 's');

    // segmented switch styling
    const segOn  = (active, theme) => active
        ? ('background:' + theme.soft + ';border:1.5px solid ' + theme.accent + ';color:' + theme.accentDark + ';')
        : ('background:transparent;border:1.5px solid transparent;color:#7c7b75;');
    const lab = segOn(isLabor, { soft:'#eaf4ef', accent:'#157a52', accentDark:'#0f6342' });
    const out = segOn(!isLabor, { soft:'#efeaf8', accent:'#7a5bb5', accentDark:'#5b3f96' });

    const rowHtml = (c) => {
        const st = statOf(c);
        const agreed = st.agreed, paid = st.paid, remaining = st.remaining;
        const pct = st.pct;
        // type pill (we keep Pakyaw / In-house labels for both kinds)
        const pill = c.payType === 'inhouse'
            ? { lbl: 'IN-HOUSE', bg: '#eef0f3', col: '#5b6b7e' }
            : { lbl: 'PAKYAW',   bg: '#efeaf8', col: '#5b3f96' };
        let sentPre, sentBold, sentSuf = '', sentColor = '#6f6e69', boldColor = '#1c1c1a',
            rightAmt, rightLbl, rightColor, amtColor, barColor, barPct;
        if (st.status === 'Over') {
            const over = paid - agreed;
            sentPre = 'Paid ' + _fmt(paid) + ' — '; sentBold = _fmt(over) + ' more'; sentSuf = ' than the ' + _fmt(agreed) + ' agreed';
            sentColor = '#b4453a'; boldColor = '#b4453a';
            rightAmt = '+' + _fmt(over); rightLbl = '⚠ Over agreed';
            rightColor = '#b4453a'; amtColor = '#b4453a'; barColor = '#b4453a'; barPct = 100;
        } else if (st.status === 'Completed') {
            sentPre = 'Paid ' + _fmt(paid) + ' of ' + _fmt(agreed) + ' — nothing left'; sentBold = '';
            rightAmt = _fmt(0); rightLbl = '✓ Fully paid';
            rightColor = '#0f6342'; amtColor = '#0f6342'; barColor = '#157a52'; barPct = 100;
        } else {
            sentPre = 'Paid ' + _fmt(paid) + ' of ' + _fmt(agreed) + ' — '; sentBold = _fmt(remaining) + ' to go';
            rightAmt = _fmt(remaining); rightLbl = 'In progress · ' + pct.toFixed(0) + '%';
            rightColor = '#1d4ed8'; amtColor = '#1c1c1a'; barColor = '#3b82f6'; barPct = Math.min(100, pct);
        }
        return '<div onclick="' + ledgerFn + '(\'' + c.id + '\')" style="display:flex;align-items:center;gap:16px;padding:14px 6px;border-top:1px solid #f0efec;cursor:pointer;border-radius:8px;transition:background .12s;"'
            + ' onmouseover="this.style.background=\'#faf9f7\'" onmouseout="this.style.background=\'\'">'
            + '<div style="flex:1;min-width:0;">'
            + '<div style="display:flex;align-items:center;gap:9px;">'
            + '<span style="font-size:14.5px;font-weight:700;color:#1c1c1a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(c.scope || 'Untitled job') + '</span>'
            + '<span style="font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:2px 8px;border-radius:20px;flex:none;background:' + pill.bg + ';color:' + pill.col + ';">' + pill.lbl + '</span>'
            + '</div>'
            + '<div style="font-size:12.5px;color:' + sentColor + ';margin-top:6px;">' + sentPre + '<b style="font-weight:700;color:' + boldColor + ';">' + sentBold + '</b>' + sentSuf + '</div>'
            + '<div style="height:6px;max-width:260px;background:#eef0ec;border-radius:4px;overflow:hidden;margin-top:8px;"><div style="height:100%;border-radius:4px;background:' + barColor + ';width:' + barPct.toFixed(1) + '%;"></div></div>'
            + '</div>'
            + '<div style="text-align:right;flex:none;"><div style="font-size:20px;font-weight:700;color:' + amtColor + ';">' + rightAmt + '</div>'
            + '<div style="font-size:11px;font-weight:600;color:' + rightColor + ';margin-top:3px;">' + rightLbl + '</div></div>'
            + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c4c9d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none;"><polyline points="9 18 15 12 9 6"/></svg>'
            + '</div>';
    };

    const sectionsHtml = names.length ? names.map(name => {
        const cs = byW[name].slice().sort((a, b) => (a.scope || '').localeCompare(b.scope || ''));
        const initial = (name.replace(/[^A-Za-z0-9]/g, '')[0] || '—').toUpperCase();
        return '<div style="padding-top:4px;">'
            + '<div style="display:flex;align-items:center;gap:9px;padding:18px 0 2px;">'
            + '<span style="flex:none;width:28px;height:28px;border-radius:50%;background:' + t.soft + ';color:' + t.accentDark + ';font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + _esc(initial) + '</span>'
            + '<span style="font-size:14px;font-weight:700;color:' + t.accentDark + ';">' + _esc(name) + '</span>'
            + '<span style="font-size:12px;font-weight:500;color:#9b9a94;">· ' + cs.length + ' job' + (cs.length === 1 ? '' : 's') + '</span>'
            + '</div>'
            + cs.map(rowHtml).join('')
            + '</div>';
    }).join('') : ('<div style="padding:34px 6px;text-align:center;color:#9b9a94;font-size:13.5px;">No ' + (isLabor ? 'labor' : 'out source') + ' contracts yet. Click “＋ ' + newBtnLbl + '” to cap a ' + (isLabor ? 'worker’s' : 'vendor’s') + ' job — then tag a daily ' + (isLabor ? 'Labor' : 'Out Source') + ' entry to it.</div>');

    root.innerHTML =
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;">'
        + '<div><div style="font-size:22px;font-weight:700;color:#1c1c1a;letter-spacing:-0.01em;">Contracts</div>'
        + '<div style="font-size:13px;color:#8a8983;margin-top:3px;">In-house labor and outsourced jobs — both capped agreements, paid through your daily entries.</div></div>'
        + '<button type="button" onclick="' + newFn + '" style="flex:none;background:' + t.accent + ';color:#fff;border:none;border-radius:9px;padding:10px 16px;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit;transition:filter .15s;" onmouseover="this.style.filter=\'brightness(1.08)\'" onmouseout="this.style.filter=\'\'">＋ ' + newBtnLbl + '</button>'
        + '</div>'
        // segmented switch
        + '<div style="display:flex;gap:8px;background:#f6f5f2;border:1px solid #ecebe6;border-radius:13px;padding:5px;margin-bottom:6px;max-width:480px;">'
        + '<button type="button" onclick="pmContractSeg(\'labor\')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;padding:11px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit;transition:all .15s;' + lab + '">'
        + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>'
        + 'Labor <span style="font-size:11px;font-weight:700;opacity:.85;background:rgba(0,0,0,.06);border-radius:20px;padding:1px 7px;">' + laborN + '</span></button>'
        + '<button type="button" onclick="pmContractSeg(\'outsource\')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;padding:11px;cursor:pointer;font-size:13.5px;font-weight:700;font-family:inherit;transition:all .15s;' + out + '">'
        + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>'
        + 'Out Source <span style="font-size:11px;font-weight:700;opacity:.85;background:rgba(0,0,0,.06);border-radius:20px;padding:1px 7px;">' + outN + '</span></button>'
        + '</div>'
        // summary banner
        + '<div style="margin:16px 0 4px;background:' + t.bannerBg + ';border:1px solid ' + t.bannerBorder + ';border-radius:12px;padding:15px 18px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">'
        + '<div style="flex:1;min-width:220px;">'
        + '<div style="font-size:13px;color:#3a3a36;">Across <b style="color:#1c1c1a;">' + workersLbl + '</b> and <b style="color:#1c1c1a;">' + jobsLbl + '</b>, you still owe</div>'
        + '<div style="font-size:26px;font-weight:700;color:' + t.accentDark + ';margin-top:2px;">' + _fmt(totRem) + ' <span style="font-size:13px;font-weight:500;color:#8a8983;">of ' + _fmt(totAgreed) + ' agreed</span></div>'
        + '</div>'
        + '<div style="flex:none;width:180px;">'
        + '<div style="height:10px;background:' + t.barTrack + ';border-radius:6px;overflow:hidden;"><div style="height:100%;border-radius:6px;background:' + t.accent + ';width:' + totPct + '%;"></div></div>'
        + '<div style="font-size:11.5px;font-weight:600;color:' + t.accentDark + ';margin-top:6px;text-align:right;">' + totPct + '% paid so far</div>'
        + '</div></div>'
        // sections
        + sectionsHtml;
}
