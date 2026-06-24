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
let _pmRevolvingData  = null;
let _pmExpenses       = [];
let _pmPayRequests    = [];
let _pmCompanyBuyItemData = null;
let _pmCompanyReceiptFile = null;
let _pmProcFilter     = 'all';   // materials status filter: all | pending | bought
let _pmOvBills        = [];       // weekly bills for the active project (overview date filter)
// ── This-week inline bill builder ──
let _pmWeekBills      = [];       // all weeklyBills docs for the active project
let _pmWeekEntries    = [];       // current draft line entries {id,type,details,amount}
let _pmWeekDate       = null;     // selected Friday (YYYY-MM-DD)
let _pmWeekEditingId  = null;     // doc id when the selected week already has a saved bill
let _pmWeekCat        = 'labor';  // active category tab: 'labor' | 'materials' | 'both'
let _pmWeekStagedReceipt = null;  // { file, dataUrl } staged in the add-row, attached to the next line
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
    const statusBadge = { active:'pm-badge-paid', 'on-hold':'pm-badge-partial', completed:'pm-badge-client', terminated:'pm-badge-terminated' };
    const statusLabel = { active:'Active', 'on-hold':'On Hold', completed:'Completed', terminated:'Terminated' };
    const el = document.getElementById('ws-status-badge');
    if (el) el.innerHTML = `<span class="pm-badge ${statusBadge[p.status]||'pm-badge-paid'}">${statusLabel[p.status]||'Active'}</span>`;
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
            <div style="font:600 10px 'IBM Plex Sans';color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:.06em;">Total paid</div>
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
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:16px;">
      ${tile('#c6e6d5', '#eaf4ef', 'Progress', '#0f6342', progress + '%', '', progress)}
      ${tile('#d6dde4', '#eef0f3', 'Direct cost', '#44525f', _fmt(directCost), (feeTotal > 0 ? _pmOvShort(feeTotal) + ' fee on top' : 'labor + materials'), null)}
      ${tile('#f0cdc8', '#f8ecea', 'Outstanding balance', '#8f352c', _fmt(outstanding), 'client still owes', null)}
      ${tile('#c6e6d5', '#eaf4ef', 'Total paid', '#0f6342', _fmt(paid), 'collected to date', null)}
      ${tile('#f0e2c5', '#fbf3e2', 'Net cash', netColor, _fmt(netCash), netSub, null)}
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

    const donutBg = payTotal > 0
        ? `conic-gradient(#157a52 0% ${paidPct}%, #b4453a ${paidPct}% 100%)`
        : '#eeede9';
    const charts = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:stretch;margin-bottom:16px;">
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
              <span class="num" style="font:700 19px 'IBM Plex Sans';color:#0f6342;">${paidPct}%</span>
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
              <div style="flex:1;"><div style="font:500 11.5px 'IBM Plex Sans';color:#3a3a36;">Outstanding</div><div class="num" style="font:700 13px 'IBM Plex Sans';color:#1c1c1a;">${_fmt(outstanding)}</div></div>
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
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
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
      <div style="flex:1;min-width:200px;display:flex;align-items:center;gap:13px;padding:14px 16px;background:${bg};border:1px solid ${border};border-radius:13px;">
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
    <div style="border:1px solid #e7e6e2;border-radius:16px;background:#fff;padding:20px 22px;margin-bottom:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;">
        <div>
          <div style="font:600 14.5px 'IBM Plex Sans';">Direct cost breakdown</div>
          <div id="pm-ov-range-note" style="font:400 11.5px 'IBM Plex Sans';color:#9b9a94;margin-top:2px;">All time · ${bills.length} week${bills.length === 1 ? '' : 's'} · management fee excluded</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:11px;">
          <div style="display:flex;align-items:baseline;gap:7px;">
            <span class="num" id="pm-ov-direct" style="font:700 21px 'IBM Plex Sans';color:#1c1c1a;line-height:1;white-space:nowrap;">${_fmt(bd.direct)}</span>
            <span style="font:600 11px 'IBM Plex Sans';color:#9b9a94;">total</span>
          </div>
          <select id="pm-ov-range" onchange="pmOvApplyRange()" style="${selStyle}">
            <option value="all">All time</option>
            <option value="month">This month</option>
            <option value="latest">Latest week</option>
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
      <div style="display:flex;gap:13px;flex-wrap:wrap;">
        ${legendBox('Labor',             '#157a52', '#0f6342', '#f3faf6', '#d8ebe0', '#7c9d8b', 'pm-ov-labor',     'pm-ov-labor-pct',     bd.labor,     bd.laborPct)}
        ${legendBox('Materials',         '#c79024', '#8a6310', '#fdf8ec', '#f0e2c5', '#a98f5f', 'pm-ov-materials', 'pm-ov-materials-pct', bd.materials, bd.matPct)}
        ${legendBox('Materials + labor', '#8b6fc4', '#6b4ea8', '#f5f2fc', '#ddd5ef', '#9a86c4', 'pm-ov-combined',  'pm-ov-combined-pct',  bd.combined,  bd.combinedPct)}
      </div>
    </div>`;

    // ════════════════════════════════════════════════════════════
    // Redesigned Overview layout (desktop design · brand green)
    // 5 KPI tiles → breakdown bars + payment donut → billing trend + next-due card.
    // Reuses the existing data + the #pm-ov-* IDs so pmOvApplyRange keeps working.
    // ════════════════════════════════════════════════════════════
    // Custom date-range dropdown (native <select> can't style its option list).
    const _ddChevron = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const _ddFixed = [['all', 'All time'], ['month', 'This month'], ['latest', 'Latest week'], ['last4', 'Last 4 weeks']]
        .map(([v, l], i) => `<button class="pmw-dd-opt${i === 0 ? ' active' : ''}" onclick="pmOvPickRange(this,'${v}','${l}')"><span>${l}</span><span class="pmw-dd-check">✓</span></button>`).join('');
    const _ddWeeks = _ovWeeks.map(b => {
        const l = _pmOvWeekLabel(b.weekEndingDate);
        return `<button class="pmw-dd-opt" onclick="pmOvPickRange(this,'${_esc(b.weekEndingDate)}','${_esc(l)}')"><span>Week ending</span><span class="num">${_esc(l)}</span></button>`;
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
          ${_ddWeeks ? '<div class="pmw-dd-sep"></div>' + _ddWeeks : ''}
        </div>
        <input type="hidden" id="pm-ov-range" value="all">
      </div>
    </div>`;

    // New design layout, but the ORIGINAL tinted KPI colors (bg / border / value).
    const kpi = (label, val, valColor, bg, border) => `
      <div style="flex:1;min-width:150px;background:${bg};border:1px solid ${border};border-radius:16px;padding:15px 17px;">
        <div style="font:600 11.5px 'IBM Plex Sans';color:#7c7b75;">${label}</div>
        <div class="num" style="font:700 22px 'IBM Plex Sans';color:${valColor};margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${val}</div>
      </div>`;
    const ovTiles = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
      ${kpi('Progress', progress + '%', '#0f6342', '#eaf4ef', '#c6e6d5')}
      ${kpi('Direct cost', _fmt(directCost), '#44525f', '#eef0f3', '#d6dde4')}
      ${kpi('Total paid', _fmt(paid), '#0f6342', '#eaf4ef', '#c6e6d5')}
      ${kpi('Outstanding', _fmt(outstanding), '#8f352c', '#f8ecea', '#f0cdc8')}
      ${kpi('Net cash', (netCash < 0 ? '−' : '+') + _fmt(Math.abs(netCash)), netColor, '#fbf3e2', '#f0e2c5')}
    </div>`;

    // Direct-cost breakdown — one bar per category (keeps the #pm-ov-* IDs).
    const bdRow = (label, color, amtId, pctId, segId, val, pct) => `
      <div style="margin-bottom:13px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font:600 12.5px 'IBM Plex Sans';color:#3a3a36;">${label}</span>
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
        <span id="pm-ov-range-note" style="font:400 11px 'IBM Plex Sans';color:#9b9a94;">All time · ${bills.length} week${bills.length === 1 ? '' : 's'}</span>
      </div>
      ${bdRow('Labor', '#157a52', 'pm-ov-labor', 'pm-ov-labor-pct', 'pm-ov-seg-labor', bd.labor, bd.laborPct)}
      ${bdRow('Materials', '#c79024', 'pm-ov-materials', 'pm-ov-materials-pct', 'pm-ov-seg-materials', bd.materials, bd.matPct)}
      ${bdRow('Materials + Labor', '#8b6fc4', 'pm-ov-combined', 'pm-ov-combined-pct', 'pm-ov-seg-combined', bd.combined, bd.combinedPct)}
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #f0efec;margin-top:4px;padding-top:13px;">
        <span style="font:600 12.5px 'IBM Plex Sans';color:#3a3a36;">Direct cost total</span>
        <span class="num" id="pm-ov-direct" style="font:800 16px 'IBM Plex Sans';color:#1c1c1a;">${_fmt(bd.direct)}</span>
      </div>
    </div>`;

    const ovDonutBg = payTotal > 0 ? `conic-gradient(#157a52 0% ${paidPct}%, #e6c878 ${paidPct}% 100%)` : '#eeede9';
    const ovDonut = `
    <div style="flex:1;min-width:240px;border:1px solid #e7e6e2;border-radius:16px;background:#fff;padding:20px 22px;">
      <div style="font:600 14.5px 'IBM Plex Sans';margin-bottom:16px;">Payment status</div>
      <div style="display:flex;align-items:center;gap:18px;">
        <div style="position:relative;width:104px;height:104px;flex:none;">
          <div style="position:absolute;inset:0;border-radius:50%;background:${ovDonutBg};"></div>
          <div style="position:absolute;inset:15px;border-radius:50%;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <span class="num" style="font:700 18px 'IBM Plex Sans';color:#0f6342;">${paidPct}%</span>
            <span style="font:500 8.5px 'IBM Plex Sans';color:#9b9a94;text-transform:uppercase;letter-spacing:.04em;">paid</span>
          </div>
        </div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;"><span style="width:10px;height:10px;border-radius:3px;background:#157a52;flex:none;"></span><div><div style="font:500 11px 'IBM Plex Sans';color:#3a3a36;">Paid</div><div class="num" style="font:700 12.5px 'IBM Plex Sans';">${_fmt(paid)}</div></div></div>
          <div style="display:flex;align-items:center;gap:8px;"><span style="width:10px;height:10px;border-radius:3px;background:#c79024;flex:none;"></span><div><div style="font:500 11px 'IBM Plex Sans';color:#3a3a36;">Outstanding</div><div class="num" style="font:700 12.5px 'IBM Plex Sans';">${_fmt(outstanding)}</div></div></div>
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
        labor     += b.labor || 0;
        combined  += c;
        materials += Math.max(0, (b.materials || 0) - c);
    });
    const direct = labor + materials + combined;
    const pct = v => direct > 0 ? Math.round(v / direct * 100) : 0;
    return { labor, materials, combined, direct,
             laborPct: pct(labor), matPct: pct(materials), combinedPct: pct(combined) };
}

// Format a week-ending date for the breakdown filter, e.g. "Jun 26, 2026".
function _pmOvWeekLabel(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d) ? dateStr : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Filter the stored bills by the selected billing-week mode.
function _pmOvFilterBills(mode) {
    if (mode === 'all') return _pmOvBills;
    if (mode === 'month') {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return _pmOvBills.filter(b => (b.weekEndingDate || '').startsWith(ym));
    }
    const dated = _pmOvBills.filter(b => b.weekEndingDate)
        .slice().sort((a, b) => b.weekEndingDate.localeCompare(a.weekEndingDate));
    if (mode === 'latest') return dated.slice(0, 1);
    if (mode === 'last4')  return dated.slice(0, 4);
    return _pmOvBills.filter(b => b.weekEndingDate === mode);   // a specific week
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
    const bd = _pmOvBreakdown(bills);
    const setAmt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = _fmt(val); };
    const setSeg = (id, pct, show) => { const el = document.getElementById(id); if (el) { el.style.width = pct + '%'; el.style.minWidth = show ? '6px' : '0'; } };
    setAmt('pm-ov-direct',    bd.direct);
    setAmt('pm-ov-labor',     bd.labor);
    setAmt('pm-ov-materials', bd.materials);
    setAmt('pm-ov-combined',  bd.combined);
    _pmSet('pm-ov-labor-pct',     String(bd.laborPct));
    _pmSet('pm-ov-materials-pct', String(bd.matPct));
    _pmSet('pm-ov-combined-pct',  String(bd.combinedPct));
    setSeg('pm-ov-seg-labor',     bd.laborPct,    bd.labor > 0);
    setSeg('pm-ov-seg-materials', bd.matPct,      bd.materials > 0);
    setSeg('pm-ov-seg-combined',  bd.combinedPct, bd.combined > 0);

    const note = document.getElementById('pm-ov-range-note');
    if (note) {
        const wk = bills.length + ' week' + (bills.length === 1 ? '' : 's');
        const label = mode === 'all'    ? 'All time'
            : mode === 'month'  ? 'This month'
            : mode === 'latest' ? 'Latest week'
            : mode === 'last4'  ? 'Last 4 weeks'
            : 'Week ending ' + _pmOvWeekLabel(mode);
        note.textContent = label + ' · ' + wk + ' · management fee excluded';
    }
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
        const [msSnap, paySnap] = await Promise.all([
            db.collection('constructionProjects').doc(p.id).collection('milestones').get(),
            db.collection('paymentRequests').where('constructionProjectId', '==', p.id).get()
        ]);

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
          <div style="margin-top:13px;">${cadenceBadge[m.cadence] || cadenceBadge.ontrack}</div>
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
            }
        });
    }
    if (window.lucide) lucide.createIcons();
}

window.pmOpenProject = function(p) {
    _pmActiveProject = _pmProjects.find(pr => pr.id === p.id) || p;
    localStorage.setItem('pm_selected_project', p.id);
    // Fresh "This Week" draft for the newly opened project.
    _pmWeekDate = null; _pmWeekBills = []; _pmWeekEntries = []; _pmWeekEditingId = null; _pmWeekCat = 'labor'; _pmWeekStagedReceipt = null; _pmWeekEditEntryId = null; _pmWeekViewFilter = 'all'; _pmWeekViewDay = null;
    // Reset workspace to weekly tab
    document.querySelectorAll('.pm-ws-tab').forEach((t,i)  => t.classList.toggle('active', i===0));
    document.querySelectorAll('.pm-ws-panel').forEach((pn,i) => pn.classList.toggle('active', i===0));
    switchView('pmWorkspace');
};

window.pmOpenProjectModal = function() {
    document.getElementById('pmProjectModalTitle').textContent = 'Add Construction Project';
    document.getElementById('pmProjectId').value        = '';
    document.getElementById('pmProjectClientName').value = '';
    document.getElementById('pmProjectName').value       = '';
    document.getElementById('pmProjectEmail').value      = '';
    document.getElementById('pmProjectStatus').value     = 'active';
    document.getElementById('pmProjectStartDate').value  = '';
    document.getElementById('pmProjectAddress').value    = '';
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
    document.getElementById('pmProjectStatus').value     = p.status      || 'active';
    document.getElementById('pmProjectStartDate').value  = p.startDate   || '';
    document.getElementById('pmProjectAddress').value    = p.address     || '';
    document.getElementById('pmProjectBudget').value     = (p.budget != null ? p.budget : '');
    document.getElementById('pmProjectEndDate').value    = p.plannedEndDate || '';
    document.getElementById('pmProjectFeePct').value     = (p.managementFeePct != null ? p.managementFeePct : 15);
    ['err-pmProjectClientName','err-pmProjectName'].forEach(_pmClearErr);
    document.getElementById('pmProjectModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveProject = async function() {
    const projectId  = document.getElementById('pmProjectId').value;
    const clientName = document.getElementById('pmProjectClientName').value.trim();
    const projectName= document.getElementById('pmProjectName').value.trim();
    const clientEmail= document.getElementById('pmProjectEmail').value.trim();
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

    let valid = true;
    if (!clientName)  { _pmShowErr('err-pmProjectClientName','Client name is required.'); valid = false; }
    if (!projectName) { _pmShowErr('err-pmProjectName','Project name is required.');      valid = false; }
    if (!valid) return;

    const data = { clientName, projectName, clientEmail, status, startDate, address, budget, plannedEndDate, managementFeePct,
                   updatedAt: firebase.firestore.FieldValue.serverTimestamp() };

    // Detect a fee-rate change so we can re-bill unpaid weeks at the new rate.
    const existing  = projectId ? _pmProjects.find(p => p.id === projectId) : null;
    const oldFeePct = existing ? (existing.managementFeePct != null ? Number(existing.managementFeePct) : 15) : null;
    const feeChanged = projectId && oldFeePct !== managementFeePct;

    const btn = document.querySelector('#pmProjectModal .pm-btn-primary');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (projectId) {
            await db.collection('constructionProjects').doc(projectId).update(data);
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
            await db.collection('constructionProjects').add(data);
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
}

// Load the saved bill for the selected Friday into the draft (or start empty).
function _pmWeekSyncDraft() {
    // Switching the loaded bill cancels any in-progress line edit.
    _pmWeekEditEntryId = null; _pmWeekStagedReceipt = null;
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
                receiptUrl: e.receiptUrl || '',
                receiptDataUrl: '',
                receiptFile: null
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
    if (e && e.receiptUrl) pmViewReceipt(e.receiptUrl, e.details);
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
    const rc = _receiptFromStaged(_pmWeekStagedReceipt);
    if (_pmWeekEditEntryId) {
        // Update the line in place.
        const en = _pmWeekEntries.find(e => e.id === _pmWeekEditEntryId);
        if (en) {
            en.type = type; en.details = details || fallbackDetails; en.amount = amount;
            en.days = days; en.qty = qty; en.unit = unit;
            en.receiptFile = rc.receiptFile; en.receiptDataUrl = rc.receiptDataUrl; en.receiptUrl = rc.receiptUrl;
        }
        _pmWeekEditEntryId = null;
    } else {
        _pmWeekEntries.push({ id:_pmUid('we_'), type, details: details || fallbackDetails, amount, days, qty, unit, ...rc });
    }
    if (detEl)  detEl.value = '';
    if (amtEl)  amtEl.value = '';
    if (daysEl) daysEl.value = '';
    if (qtyEl)  qtyEl.value = '';
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
    if (addLabel) addLabel.textContent = cat === 'both' ? 'New mat + labor entry'
        : cat === 'materials' ? 'New materials entry' : 'New labor entry';
    const addDot = document.getElementById('pmw-addcard-dot');
    if (addDot) addDot.style.background = cat === 'both' ? '#7a5bb5'
        : cat === 'materials' ? '#5b6b7e' : '#157a52';
    // Days is Labor-only; quantity + unit is Materials-only; Mat + Labor has neither.
    const daysWrap = document.getElementById('pm-week-days-wrap');
    if (daysWrap) daysWrap.style.display = cat === 'labor' ? '' : 'none';
    const qtyWrap = document.getElementById('pm-week-qty-wrap');
    if (qtyWrap) qtyWrap.style.display = cat === 'materials' ? '' : 'none';
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

// Stage the chosen image in the add-row; it gets attached to the next line added.
window.pmWeekStageReceipt = function(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { _pmToast('Please choose an image file.', true); input.value = ''; return; }
    const reader = new FileReader();
    reader.onload = e => { _pmWeekStagedReceipt = { file, dataUrl: e.target.result }; _pmWeekRenderAttach(); };
    reader.readAsDataURL(file);
};

window.pmWeekClearReceipt = function() {
    _pmWeekStagedReceipt = null;
    const input = document.getElementById('pm-week-receipt-input');
    if (input) input.value = '';
    _pmWeekRenderAttach();
};

function _pmWeekRenderAttach() {
    const btn   = document.getElementById('pm-week-attach-btn');
    const label = document.getElementById('pmw-receipt-label');
    const thumb = document.getElementById('pm-week-attach-thumb');
    const has = !!_pmWeekStagedReceipt;
    if (btn) btn.classList.toggle('attached', has);
    if (label) label.textContent = has ? 'Receipt attached' : 'Attach receipt';
    if (thumb) {
        if (has) {
            thumb.style.display = 'flex';
            thumb.innerHTML = `<img src="${_pmWeekStagedReceipt.dataUrl}" alt="receipt"><button type="button" class="pmw-attach-x" title="Remove receipt" onclick="pmWeekClearReceipt()">×</button>`;
        } else {
            thumb.style.display = 'none';
            thumb.innerHTML = '';
        }
    }
}

// View an entry's receipt (works for both not-yet-saved data URLs and saved URLs).
window.pmWeekViewEntryReceipt = function(id) {
    const e = _pmWeekEntries.find(x => x.id === id);
    if (!e) return;
    const src = e.receiptDataUrl || e.receiptUrl;
    if (src) pmViewReceipt(src, e.details);
};

// Resolve the staged add-row receipt into an entry's three receipt fields.
function _receiptFromStaged(s) {
    if (!s) return { receiptFile: null, receiptDataUrl: '', receiptUrl: '' };
    if (s.file) return { receiptFile: s.file, receiptDataUrl: s.dataUrl, receiptUrl: '' };
    // No new file chosen — keep whatever the line already had.
    return {
        receiptFile:    s.existingFile || null,
        receiptDataUrl: s.existingFile ? s.dataUrl : '',
        receiptUrl:     s.existingUrl || ''
    };
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
    _pmWeekStagedReceipt = (en.receiptUrl || en.receiptDataUrl || en.receiptFile)
        ? { file: null, dataUrl: en.receiptDataUrl || en.receiptUrl, existingUrl: en.receiptUrl || '', existingFile: en.receiptFile || null }
        : null;
    _pmWeekApplyCat();   // tab highlight, field visibility, list, attach thumb
    const detEl  = document.getElementById('pm-week-details'); if (detEl)  detEl.value  = en.details || '';
    const amtEl  = document.getElementById('pm-week-amount');  if (amtEl)  amtEl.value  = en.amount || '';
    const daysEl = document.getElementById('pm-week-days');    if (daysEl) daysEl.value = en.days || '';
    const qtyEl  = document.getElementById('pm-week-qty');     if (qtyEl)  qtyEl.value  = en.qty || '';
    const unitEl = document.getElementById('pm-week-unit');    if (unitEl && en.unit) unitEl.value = en.unit;
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
    if (type === 'both')      return { name: 'MAT + LABOR', tag: 'MAT+LABOR', accent: '#7a5bb5', headBg: '#efeaf8', headBorder: '#e0d5f3', text: '#5b3f96', count: '#9882bd' };
    return { name: 'LABOR', tag: 'LABOR', accent: '#157a52', headBg: '#eaf4ef', headBorder: '#c6e6d5', text: '#0f6342', count: '#5e9d80' };
}

const _PMW_GROUP_TYPES = ['labor', 'materials', 'both'];

function _pmWeekEntryRow(e) {
    const st = _pmWeekCatStyle(e.type);
    const meta = _pmWeekMeta(e);
    const rcpt = (e.receiptDataUrl || e.receiptUrl)
        ? `${meta ? ' · ' : ''}<span class="pmw-rcpt-txt" onclick="pmWeekViewEntryReceipt('${e.id}')">RCPT ✓</span>`
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
        html += `<div class="pmw-grp-card">${list.map(_pmWeekEntryRow).join('')}</div>`;
        first = false;
    });
    if (!html) html = '<div class="pmw-empty-box">No entries in this view.</div>';
    host.innerHTML = html;
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
    const rcpt = e.receiptUrl
        ? `<button class="pmw-entry-rcpt" title="View receipt" onclick="pmWeekViewPastReceipt('${_esc(billId)}',${idx})"><img src="${_esc(e.receiptUrl)}" alt="receipt"></button>`
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
        const tabs = [['all', 'All'], ['labor', 'Labor'], ['materials', 'Materials'], ['both', 'Mat + Labor']];
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
    const label  = t === 'both' ? 'Materials + Labor' : t === 'materials' ? 'Materials' : 'Labor';
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
        return `<div class="pmcv-row">
            <div class="pmcv-date"><div class="pmcv-date-day">${b.day}</div><div class="pmcv-date-mon">${_esc(b.mon)}</div></div>
            <div class="pmcv-main"><div class="pmcv-title">${_esc(r.details || '—')}</div><div class="pmcv-sub">${meta}</div></div>
            <div class="pmcv-amt num">${_pmPeso(r.amount)}</div>
        </div>`;
    }).join('') : `<div class="pmcv-empty">No ${label.toLowerCase()} entries recorded yet.</div>`;

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
        <div class="pmst-list">
          <div class="pmst-listhead"><span class="pmst-c-date">Date</span><span class="pmst-c-details">Details</span><span class="pmst-c-amt">Amount</span></div>
          ${list}
        </div>
        <div class="pmst-total"><span>Total · ${label}</span><span class="num" style="color:${accent};">${_pmPeso(total)}</span></div>
      </div>
      <button class="pmst-foot-pdf" type="button" onclick="pmCatSOA('${t}')">${_pdfIcon} Generate PDF</button>`;
    _pmStatementShow(true);
    if (window.innerWidth <= 700) window.scrollTo({ top: 0, behavior: 'auto' });
};

window.pmCatSOA = function(type) {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    const t = (type === 'materials' || type === 'both') ? type : 'labor';
    const label = t === 'both' ? 'Materials + Labor' : t === 'materials' ? 'Materials' : 'Labor';
    const code  = t === 'both' ? 'MLB' : t === 'materials' ? 'MAT' : 'LAB';
    const rows = _pmCatRows(t);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const client  = _pmActiveProject.clientName || _pmActiveProject.projectName || '—';
    const project = _pmActiveProject.projectName || '—';
    const location = _pmActiveProject.location || _pmActiveProject.address || '';
    const today = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
    const fmtDate = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }); } catch (e) { return d || '—'; } };
    const metaOf = r => t === 'labor' ? (r.days ? r.days + (r.days === 1 ? ' day' : ' days') : '')
        : t === 'materials' ? (r.qty ? r.qty + ' ' + (r.unit || 'pcs') : '')
        : 'supply & install';
    const descOf = r => (r.details || '—') + (metaOf(r) ? ' · ' + metaOf(r) : '');
    const fmtN = n => Math.round(Number(n) || 0).toLocaleString('en-US');
    const dates = rows.map(r => r.date).filter(Boolean).sort();
    const period = dates.length
        ? new Date(dates[0] + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' – ' +
          new Date(dates[dates.length - 1] + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'All bills';
    const ref = 'SOA-' + code + '-' + String(rows.length).padStart(3, '0');

    const rowsHtml = rows.length
        ? rows.map((r, i) => `<tr style="background:${i % 2 ? '#f4f8f5' : '#fff'};">
            <td class="d">${_esc(fmtDate(r.date))}</td>
            <td class="desc">${_esc(descOf(r))}</td>
            <td class="amt">${fmtN(r.amount)}</td>
          </tr>`).join('')
        : `<tr><td colspan="3" style="text-align:center;color:#9aa8a0;padding:26px;">No ${label.toLowerCase()} entries yet.</td></tr>`;

    const pdfData = {
        label, client, project, location, today, period, ref,
        body: rows.map(r => [fmtDate(r.date), descOf(r), fmtN(r.amount)]),
        total: fmtN(total),
        fname: `${ref}-${(String(project).replace(/[^A-Za-z0-9]+/g, '') || 'project')}.pdf`
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
            <div class="docsub">${_esc(label)} &middot; project-wide</div>
          </div>
          <div class="meta">
            <div><div class="meta-l">Project</div><div class="meta-v">${_esc(project)}</div></div>
            <div><div class="meta-l">Client</div><div class="meta-v">${_esc(client)}</div></div>
            <div><div class="meta-l">Period</div><div class="meta-v">${_esc(period)}</div></div>
            <div><div class="meta-l">Ref no.</div><div class="meta-v mono">${_esc(ref)}</div></div>
          </div>
          <table>
            <thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot><tr><td class="lbl" colspan="2">Total (PHP)</td><td class="tot">${fmtN(total)}</td></tr></tfoot>
          </table>
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
          doc.text(D.label + " - project-wide", pw/2, 38, {align:'center'});
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
    const pending = _pmWeekEntries.filter(e => e.receiptFile && !e.receiptUrl).length;
    if (btn) { btn.disabled = true; btn.textContent = pending ? 'Uploading receipts…' : 'Saving…'; }
    let rcptFails = 0;
    try {
        // Upload any newly-attached receipt images to storage, fill in their URLs.
        // A failed upload must NOT abort the save — the bill (line data) is what
        // matters most, so we skip the failed image and warn afterward.
        if (pending && typeof storage !== 'undefined') {
            for (let i = 0; i < _pmWeekEntries.length; i++) {
                const en = _pmWeekEntries[i];
                if (en.receiptFile && !en.receiptUrl) {
                    try {
                        const ext = (en.receiptFile.name.split('.').pop() || 'jpg').toLowerCase();
                        const path = `weeklyBillReceipts/${_pmActiveProject.id}/${_pmWeekDate}_${i}_${Date.now()}.${ext}`;
                        const ref = storage.ref(path);
                        await ref.put(en.receiptFile);
                        en.receiptUrl = await ref.getDownloadURL();
                    } catch (upErr) {
                        console.warn('Receipt upload failed for line', i, '—', upErr.message);
                        rcptFails++;
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
            entries: _pmWeekEntries.map(e => ({ type:e.type, details:e.details, amount:e.amount,
                ...(e.days ? { days:e.days } : {}),
                ...(e.qty  ? { qty:e.qty, unit:e.unit || 'pcs' } : {}),
                ...(e.receiptUrl ? { receiptUrl:e.receiptUrl } : {}) })),
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

function _pmTsDateStr(ts) {
    const ms = ts && ts.toMillis ? ts.toMillis() : (ts ? new Date(ts).getTime() : 0);
    if (!ms || isNaN(ms)) return '—';
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

async function _pmLoadRevolving() {
    if (!_pmActiveProject) {
        _pmRevolvingData = null;
        _pmExpenses = [];
        _pmRevUpdateKPIs();
        _pmRevRenderTable([]);
        return;
    }
    try {
        const [fundSnap, expSnap] = await Promise.all([
            db.collection('constructionProjects').doc(_pmActiveProject.id)
              .collection('revolvingFund').doc('summary').get(),
            db.collection('constructionProjects').doc(_pmActiveProject.id)
              .collection('revolvingFundExpenses').orderBy('date','desc').get()
        ]);
        _pmRevolvingData = fundSnap.exists ? fundSnap.data() : { initialFund: 0, totalReplenished: 0 };
        _pmExpenses = expSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        _pmRevUpdateKPIs();
        _pmRevRenderTable(_pmExpenses);
    } catch(e) {
        console.warn('PM revolving load:', e.message);
    }
}

function _pmRevUpdateKPIs() {
    const initial    = _pmRevolvingData?.initialFund || 0;
    const replenished = _pmRevolvingData?.totalReplenished || 0;
    const totalFund  = initial + replenished;
    const spent      = _pmExpenses.reduce((s,e) => s + (e.amount||0), 0);
    const balance    = totalFund - spent;
    _pmSet('pm-rev-initial',    _fmt(initial));
    _pmSet('pm-rev-spent',      _fmt(spent));
    _pmSet('pm-rev-balance',    _fmt(Math.max(0, balance)));
    _pmSet('pm-rev-replenish',  _fmt(Math.max(0, spent)));
}

function _pmRevRenderTable(expenses) {
    const tbody = document.getElementById('pm-rev-tbody');
    if (!tbody) return;
    if (!expenses.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="pm-empty-row">No expenses recorded yet.</td></tr>';
        return;
    }
    tbody.innerHTML = expenses.map(e => {
        const dateStr = e.date ? new Date(e.date+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
        return `<tr>
            <td>${_esc(dateStr)}</td>
            <td><strong>${_esc(e.description||'—')}</strong></td>
            <td style="font-weight:600;color:#dc2626;">${_fmt(e.amount)}</td>
            <td style="color:#6b7280;">${_esc(e.notes||'—')}</td>
            <td>
              <button class="pm-tbl-btn pm-tbl-btn-delete" onclick="pmDeleteExpense('${_esc(e.id)}')"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
            </td>
        </tr>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

window.pmOpenSetFundModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    document.getElementById('pmSetFundAmount').value = _pmRevolvingData?.initialFund || '';
    document.getElementById('pmSetFundNotes').value  = '';
    _pmClearErr('err-pmSetFundAmount');
    document.getElementById('pmSetFundModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveInitialFund = async function() {
    const amount = parseFloat(document.getElementById('pmSetFundAmount').value) || 0;
    const notes  = document.getElementById('pmSetFundNotes').value.trim();
    if (amount <= 0) { _pmShowErr('err-pmSetFundAmount','Enter a valid amount.'); return; }
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFund').doc('summary')
          .set({ initialFund: amount, notes, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        pmCloseModal('pmSetFundModal');
        _pmLoadRevolving();
    } catch(e) { alert('Error: ' + e.message); }
};

window.pmOpenExpenseModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    document.getElementById('pmExpenseDate').value   = new Date().toISOString().slice(0,10);
    document.getElementById('pmExpenseAmount').value = '';
    document.getElementById('pmExpenseDesc').value   = '';
    document.getElementById('pmExpenseNotes').value  = '';
    ['err-pmExpenseDate','err-pmExpenseAmount','err-pmExpenseDesc'].forEach(_pmClearErr);
    document.getElementById('pmExpenseModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveExpense = async function() {
    const date   = document.getElementById('pmExpenseDate').value;
    const amount = parseFloat(document.getElementById('pmExpenseAmount').value) || 0;
    const desc   = document.getElementById('pmExpenseDesc').value.trim();
    const notes  = document.getElementById('pmExpenseNotes').value.trim();
    let valid = true;
    if (!date)    { _pmShowErr('err-pmExpenseDate','Select a date.'); valid = false; }
    if (amount<=0){ _pmShowErr('err-pmExpenseAmount','Enter amount.'); valid = false; }
    if (!desc)    { _pmShowErr('err-pmExpenseDesc','Enter description.'); valid = false; }
    if (!valid) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFundExpenses')
          .add({ date, amount, description: desc, notes, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        pmCloseModal('pmExpenseModal');
        _pmLoadRevolving();
    } catch(e) { alert('Error: ' + e.message); }
};

window.pmDeleteExpense = async function(id) {
    if (!confirm('Delete this expense?')) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFundExpenses').doc(id).delete();
        _pmLoadRevolving();
    } catch(e) { alert('Delete failed: ' + e.message); }
};

window.pmOpenReplenishModal = function() {
    if (!_pmActiveProject) { alert('Select a project first.'); return; }
    document.getElementById('pmReplenishDate').value   = _nextFriday();
    document.getElementById('pmReplenishAmount').value = '';
    document.getElementById('pmReplenishNotes').value  = '';
    ['err-pmReplenishDate','err-pmReplenishAmount'].forEach(_pmClearErr);
    document.getElementById('pmReplenishModal').style.display = 'flex';
    if (window.lucide) lucide.createIcons();
};

window.pmSaveReplenishment = async function() {
    const date   = document.getElementById('pmReplenishDate').value;
    const amount = parseFloat(document.getElementById('pmReplenishAmount').value) || 0;
    const notes  = document.getElementById('pmReplenishNotes').value.trim();
    let valid = true;
    if (!date)    { _pmShowErr('err-pmReplenishDate','Select a date.'); valid = false; }
    if (amount<=0){ _pmShowErr('err-pmReplenishAmount','Enter amount.'); valid = false; }
    if (!valid) return;
    try {
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFundReplenishments')
          .add({ date, amount, notes, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        // Update totalReplenished in summary
        const prev = _pmRevolvingData?.totalReplenished || 0;
        await db.collection('constructionProjects').doc(_pmActiveProject.id)
          .collection('revolvingFund').doc('summary')
          .set({ totalReplenished: prev + amount, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        pmCloseModal('pmReplenishModal');
        _pmLoadRevolving();
    } catch(e) { alert('Error: ' + e.message); }
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
