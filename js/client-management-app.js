// ════════════════════════════════════════════════════════════════
// CLIENT MANAGEMENT PORTAL — Construction Cost-Plus System
// Separate from client-app.js (design services portal).
// Uses the `constructionClientUsers` Firestore collection.
// ════════════════════════════════════════════════════════════════

'use strict';

// Send an admin-side notification to the owner AND every staff account under
// that owner (each in their own inbox). Use only for staff-accessible modules.
async function cmNotifyOwnerAndStaff(ownerUid, payload) {
    if (!ownerUid) return;
    const writes = [db.collection('notifications').doc(ownerUid).collection('items').add(payload)];
    try {
        const staff = await db.collection('users').where('ownerUid', '==', ownerUid).get();
        staff.forEach(d => {
            if (d.data().role === 'staff') {
                writes.push(db.collection('notifications').doc(d.id).collection('items').add(payload));
            }
        });
    } catch (e) { console.warn('staff notify lookup failed:', e); }
    await Promise.allSettled(writes);
}

// ── State ────────────────────────────────────────────────────────
let cmCurrentUser          = null;
let cmCurrentProfile       = null;
let cmProjectData          = null;   // linked construction project
let cmWeeklyBills          = [];
let cmProgressLogs         = [];
let cmRevolvingFund        = null;
let cmMilestones           = [];
let cmAccomplishmentReports= [];
let _cmNotifUnsub          = null;
let _cmBillUnsub           = null;
let _cmNotifications       = [];
let _cmFirestoreNotifs     = [];
let cmSidebarOpen          = true;

const CM_COLLECTION = 'constructionClientUsers';

// ── Helpers ──────────────────────────────────────────────────────
function cmFmt(n) {
    return '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function cmEsc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function cmSet(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function cmErr(id, v) { const el = document.getElementById(id); if (!el) return; el.textContent = v; el.classList.add('show'); }
function cmClear(id) { const el = document.getElementById(id); if (!el) return; el.textContent = ''; el.classList.remove('show'); }
function cmIsValid(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// ── Auth State ───────────────────────────────────────────────────
auth.onAuthStateChanged(async function(user) {
    if (user) {
        try {
            const doc = await db.collection(CM_COLLECTION).doc(user.uid).get();
            if (!doc.exists) {
                await auth.signOut();
                cmCurrentUser = null; window.currentUser = null;
                cmShowLogin();
                cmShowLoginError('Access denied. Client accounts are provisioned by DACS admin. Contact your project manager if you need access.');
                return;
            }
        } catch (err) {
            console.error('CM auth check:', err);
            await auth.signOut();
            cmCurrentUser = null; window.currentUser = null;
            cmShowLogin();
            cmShowLoginError('Unable to verify your account. Please try again.');
            return;
        }

        cmCurrentUser = user; window.currentUser = user;
        try {
            await Promise.all([cmLoadProfile(user), cmLoadProjectData(user)]);
            cmCheckAgreement();
        } catch (err) {
            console.error('CM portal load error:', err);
            cmShowToast('Error loading data. Please refresh.');
        }
    } else {
        cmCurrentUser = null; window.currentUser = null;
        cmShowLogin();
    }
});

// ── Show Login ───────────────────────────────────────────────────
function cmShowLogin() {
    document.getElementById('dashboard-page').classList.remove('active');
    document.getElementById('login-page').classList.add('active');
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    cmClearLoginErrors();
    switchToLogin();
    if (_cmBillUnsub)   { _cmBillUnsub();   _cmBillUnsub   = null; }
    if (_cmNotifUnsub)  { _cmNotifUnsub();  _cmNotifUnsub  = null; }
    cmCurrentUser = null; cmCurrentProfile = null; cmProjectData = null;
    cmWeeklyBills = []; cmProgressLogs = []; cmMilestones = []; cmAccomplishmentReports = [];
}

function cmShowLoginError(msg) {
    const el = document.getElementById('login-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
}

function cmClearLoginErrors() {
    ['login-error','err-login-email','err-login-password'].forEach(cmClear);
}

// ── Login ────────────────────────────────────────────────────────
window.doLogin = async function() {
    cmClearLoginErrors();
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    let valid = true;

    if (!email)              { cmErr('err-login-email',    'Please enter your email address.');               valid = false; }
    else if (!cmIsValid(email)){ cmErr('err-login-email',  'That email doesn\'t look right.');                valid = false; }
    if (!pass)               { cmErr('err-login-password', 'Please enter your password.');                    valid = false; }
    if (!valid) return;


    const btn = document.getElementById('btn-login');
    btn.disabled = true; btn.textContent = 'Signing in…';

    try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        await auth.signInWithEmailAndPassword(email, pass);
        // onAuthStateChanged handles the rest
    } catch (err) {
        const el = document.getElementById('login-error');
        if (err.code === 'auth/user-not-found')      el.textContent = 'No account found with that email.';
        else if (err.code === 'auth/wrong-password')  el.textContent = 'Wrong password. Please try again.';
        else if (err.code === 'auth/too-many-requests') el.textContent = 'Too many failed attempts. Please wait.';
        else if (err.code === 'auth/invalid-credential') el.textContent = 'Incorrect email or password. Please try again.';
        else                                          el.textContent = 'Incorrect email or password. Please try again.';
        if (el) el.classList.add('show');
        btn.disabled = false; btn.textContent = 'Sign In';
    }
};

// ── Logout ───────────────────────────────────────────────────────
window.confirmLogout = function() { document.getElementById('logout-modal').classList.add('show'); };
window.closeLogoutModal = function(e) {
    if (e && e.target !== document.getElementById('logout-modal')) return;
    document.getElementById('logout-modal').classList.remove('show');
};
window.doLogout = async function() {
    window.closeLogoutModal();
    if (_cmBillUnsub)  { _cmBillUnsub();  _cmBillUnsub  = null; }
    if (_cmNotifUnsub) { _cmNotifUnsub(); _cmNotifUnsub = null; }
    try { await auth.signOut(); } catch (err) { console.error(err); }
};

// ── Load Profile ─────────────────────────────────────────────────
async function cmLoadProfile(user) {
    try {
        const doc = await db.collection(CM_COLLECTION).doc(user.uid).get();
        cmCurrentProfile = doc.exists ? doc.data() : { firstName: 'Client', lastName: '', email: user.email };
    } catch (err) {
        cmCurrentProfile = { firstName: 'Client', lastName: '', email: user.email };
    }
}

// ── Load Project Data ─────────────────────────────────────────────
async function cmLoadProjectData(user) {
    try {
        // Find construction project(s) linked to this client email
        const snap = await db.collection('constructionProjects')
            .where('clientEmail', '==', user.email)
            .limit(1)
            .get();
        cmProjectData = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };

        if (cmProjectData) {
            // Load weekly bills (exclude drafts)
            const billSnap = await db.collection('constructionProjects')
                .doc(cmProjectData.id)
                .collection('weeklyBills')
                .where('status', 'in', ['Submitted', 'Paid', 'Overdue', 'Partial'])
                .get();
            cmWeeklyBills = billSnap.docs.map(d => {
                const data = { id: d.id, ...d.data() };
                if (!data.totalDue && data.grandTotal) data.totalDue = data.grandTotal;
                return data;
            }).sort((a, b) => {
                const ta = a.weekEndingDate?.toMillis?.() ?? (a.weekEndingDate ? new Date(a.weekEndingDate).getTime() : 0);
                const tb = b.weekEndingDate?.toMillis?.() ?? (b.weekEndingDate ? new Date(b.weekEndingDate).getTime() : 0);
                return tb - ta;
            });

            // Load revolving fund
            const rfSnap = await db.collection('constructionProjects')
                .doc(cmProjectData.id)
                .collection('revolvingFund')
                .limit(1)
                .get();
            cmRevolvingFund = rfSnap.empty ? null : rfSnap.docs[0].data();

            // Load progress logs visible to client
            const logSnap = await db.collection('constructionProjects')
                .doc(cmProjectData.id)
                .collection('dailyLogs')
                .where('visibleToClient', '==', true)
                .orderBy('date', 'desc')
                .limit(30)
                .get();
            cmProgressLogs = logSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            // Load milestones
            try {
                const msSnap = await db.collection('constructionProjects')
                    .doc(cmProjectData.id)
                    .collection('milestones')
                    .orderBy('order', 'asc')
                    .get();
                cmMilestones = msSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) { cmMilestones = []; }

            // Load accomplishment reports (submitted or approved, visible to client)
            try {
                const arSnap = await db.collection('constructionProjects')
                    .doc(cmProjectData.id)
                    .collection('accomplishmentReports')
                    .where('status', 'in', ['approved', 'submitted'])
                    .orderBy('date', 'desc')
                    .limit(50)
                    .get();
                cmAccomplishmentReports = arSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) { cmAccomplishmentReports = []; }
        }
    } catch (err) {
        console.warn('CM project data load:', err.message);
        // Non-blocking — dashboard will show empty state
    }
}

// ── Enter Dashboard ──────────────────────────────────────────────
function cmEnterDashboard() {
    document.getElementById('login-page').classList.remove('active');
    document.getElementById('dashboard-page').classList.add('active');

    cmRefreshUserDisplay();

    if (window.innerWidth > 768) {
        document.getElementById('sidebar').classList.remove('closed');
        document.getElementById('main-content').classList.remove('expanded');
        cmSidebarOpen = true;
    }

    cmShowSection('kpi-dashboard');
    cmPopulateKPIDashboard();
    cmPopulateAccomplishmentReports();
    cmPopulateMilestones();
    cmPopulateWeeklyBilling();
    cmPopulateProcurementList();
    cmPopulateProgress();
    cmPopulateRevolvingFund();
    cmSubscribeNotifications();

    if (localStorage.getItem('dac-dark') === '1') {
        document.body.classList.add('dark-mode');
        document.getElementById('icon-moon').style.display = 'none';
        document.getElementById('icon-sun').style.display  = '';
    }
}

// ── Refresh User Display ─────────────────────────────────────────
function cmRefreshUserDisplay() {
    const p  = cmCurrentProfile || {};
    const fn = p.firstName || 'Client';
    const ln = p.lastName  || '';
    const em = p.email || (cmCurrentUser?.email || '');
    const fullName = (fn + ' ' + ln).trim();
    const initials = ((fn[0] || '') + (ln[0] || '')).toUpperCase() || 'CL';

    const setAvatar = (id, ini, photo) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = photo ? '' : ini;
        if (photo) el.innerHTML = `<img src="${photo}" alt="avatar" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.parentElement.textContent='${ini}'">`;
    };

    setAvatar('sidebar-avatar',    initials, p.photoURL);
    cmSet('sidebar-name',  fullName);
    cmSet('sidebar-email', em);
    setAvatar('topbar-avatar',     initials, p.photoURL);
    cmSet('topbar-name',   fn);
    setAvatar('profile-avatar-lg', initials, p.photoURL);
    cmSet('profile-fullname',      fullName);
    cmSet('profile-email-display', em);
    cmSet('pf-name',  fullName);
    cmSet('pf-email', em);

    // Sidebar folder name — shows the assigned project name
    const folderNameEl = document.getElementById('sidebar-folder-name');
    if (folderNameEl) {
        folderNameEl.textContent = cmProjectData?.projectName || 'My Project';
    }

    const since = p.createdAt?.toDate
        ? p.createdAt.toDate().toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' })
        : '—';
    cmSet('pf-since', since);
}

// ── Section Navigation ───────────────────────────────────────────
const CM_SECTION_TITLES = {
    billing             : 'Statement of Account (SOA)',
    'kpi-dashboard'     : 'Project Dashboard',
    'weekly-billing'    : 'Weekly Summary',
    'procurement-list'  : 'Materials Procurement List',
    'revolving-fund'    : 'Revolving Fund',
    accomplishment      : 'Accomplishment Reports',
    milestones          : 'Milestone Progress Tracking',
    progress            : 'Progress & Photos',
    notifications       : 'Notifications',
    profile             : 'Profile'
};

window.showSection = function(id) {
    document.querySelectorAll('.sub-page').forEach(el => el.classList.remove('active'));
    const target = document.getElementById('section-' + id);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
        const oc = el.getAttribute('onclick') || '';
        if (oc.includes("'" + id + "'") || oc.includes('"' + id + '"')) el.classList.add('active');
    });
    const title = CM_SECTION_TITLES[id] || id;
    cmSet('topbar-title', title);

    if (id === 'kpi-dashboard')  cmPopulateKPIDashboard();
    if (id === 'weekly-billing') cmPopulateWeeklyBilling();
    if (id === 'procurement-list')  cmPopulateProcurementList();
    if (id === 'progress')          cmPopulateProgress();
    if (id === 'revolving-fund')    cmPopulateRevolvingFund();
    if (id === 'notifications')     renderNotifHistory();
    if (id === 'accomplishment')    cmPopulateAccomplishmentReports();
    if (id === 'milestones')        cmPopulateMilestones();
    if (id === 'billing' && typeof initClientPayment === 'function') initClientPayment();

    if (window.innerWidth <= 768) cmCloseSidebar();
};

function cmShowSection(id) { window.showSection(id); }

// ── Dashboard ─────────────────────────────────────────────────────
function cmPopulateDashboard() {
    const proj = cmProjectData;

    if (!proj) {
        const noProj = document.getElementById('no-project-state');
        const projContent = document.getElementById('project-content');
        if (noProj) noProj.style.display = '';
        if (projContent) projContent.style.display = 'none';
        cmSet('hero-design-pct', '₱0');
        cmSet('hero-design-sub', 'no overdue bills');
        cmSet('hero-billed-pct', '₱0');
        cmSet('hero-billed-sub', '0 bills paid');
        cmSet('hero-activity-count', '0');
        cmSet('kpi-labor-value', '₱0');
        cmSet('kpi-procurement-value', '₱0');
        cmSet('kpi-site-value', '₱0');
        return;
    }

    const noProj = document.getElementById('no-project-state');
    const projContent = document.getElementById('project-content');
    if (noProj) noProj.style.display = 'none';
    if (projContent) projContent.style.display = '';

    cmSet('dash-project-title', proj.projectName || 'Construction Project');
    cmSet('dash-project-sub', (proj.location || '') + (proj.startDate ? ' · Started ' + proj.startDate : ''));

    // Compute billing totals from weekly bills
    const paidBills = cmWeeklyBills.filter(b => b.status === 'Paid');
    const overdueBills = cmWeeklyBills.filter(b => b.status === 'Overdue');
    const totalBilled = cmWeeklyBills.reduce((s, b) => s + (b.totalDue || 0), 0);
    const totalPaid   = paidBills.reduce((s, b) => s + (b.totalDue || 0), 0);
    const outstanding = totalBilled - totalPaid;

    // Hero KPIs
    cmSet('hero-design-pct', cmFmt(outstanding));
    cmSet('hero-design-sub', overdueBills.length ? overdueBills.length + ' overdue bill(s)' : 'no overdue bills');
    cmSet('hero-billed-pct', cmFmt(totalPaid));
    cmSet('hero-billed-sub', paidBills.length + ' bill(s) paid');
    cmSet('hero-activity-count', cmWeeklyBills.length);
    cmSet('hero-activity-last', cmWeeklyBills.length ? 'latest: week of ' + (cmWeeklyBills[0].weekEndingDate || '—') : '—');

    // Stat cards
    cmSet('stat-budget', cmFmt(totalBilled));
    cmSet('stat-budget-sub', 'Total billed to date');
    cmSet('stat-usage', cmFmt(totalPaid));
    cmSet('stat-usage-sub', cmFmt(outstanding) + ' outstanding');
    cmSet('stat-progress', cmWeeklyBills.length + ' weeks');
    cmSet('stat-progress-sub', paidBills.length + ' paid · ' + overdueBills.length + ' overdue');

    // Scope of Services KPIs
    const totalLabor       = cmWeeklyBills.reduce((s, b) => s + (b.labor || 0), 0);
    const totalProcurement = cmWeeklyBills.reduce((s, b) =>
        s + (b.materials || 0) + (b.delivery || 0) + (b.consumables || 0) + (b.other || 0), 0);
    const totalSiteSupervision = totalLabor + totalProcurement;
    cmSet('kpi-labor-value', cmFmt(totalLabor));
    cmSet('kpi-labor-sub', cmWeeklyBills.length + ' week(s) of labor recorded');
    cmSet('kpi-procurement-value', cmFmt(totalProcurement));
    cmSet('kpi-procurement-sub', 'Materials, delivery & supplies');
    cmSet('kpi-site-value', cmFmt(totalSiteSupervision));
    cmSet('kpi-site-sub', 'Labor + Procurement total');

    // Bar — % paid
    const pctPaid = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;
    const barUsage = document.getElementById('bar-usage');
    if (barUsage) barUsage.style.width = pctPaid + '%';

    // Recent activity list
    const actList = document.getElementById('activity-list');
    if (actList) {
        if (!cmWeeklyBills.length) {
            actList.innerHTML = '<div class="empty-state"><p>No activity yet.</p></div>';
        } else {
            actList.innerHTML = cmWeeklyBills.slice(0, 5).map(b => {
                const statusColor = b.status === 'Paid' ? '#15803d' : b.status === 'Overdue' ? '#dc2626' : '#2563eb';
                return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f1f5f9;">
                    <div>
                        <div style="font-weight:600;font-size:14px;color:#1f2937;">Week ending ${cmEsc(b.weekEndingDate || '—')}</div>
                        <div style="font-size:12.5px;color:#9ca3af;margin-top:2px;">Direct costs + 15% mgmt fee</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:700;color:#1f2937;">${cmFmt(b.totalDue || 0)}</div>
                        <span style="font-size:11px;font-weight:700;color:${statusColor};">${cmEsc(b.status || '—')}</span>
                    </div>
                </div>`;
            }).join('');
        }
    }
}

// ── Weekly Billing ────────────────────────────────────────────────
function cmPopulateWeeklyBilling() {
    if (!cmProjectData) {
        cmSet('wb-sum-billed', '₱0');
        cmSet('wb-sum-paid', '₱0');
        cmSet('wb-sum-outstanding', '₱0');
        cmSet('wb-sum-fees', '₱0');
        const tbody = document.getElementById('wb-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No project assigned yet.</td></tr>';
        return;
    }

    const bills = cmWeeklyBills;
    const totalBilled     = bills.reduce((s, b) => s + (b.totalDue || 0), 0);
    const totalPaid       = bills.filter(b => b.status === 'Paid').reduce((s, b) => s + (b.totalDue || 0), 0);
    const outstanding     = totalBilled - totalPaid;
    const totalFees       = bills.reduce((s, b) => s + (b.managementFee || 0), 0);
    const overdueBills    = bills.filter(b => b.status === 'Overdue');

    cmSet('wb-sum-billed',      cmFmt(totalBilled));
    cmSet('wb-sum-paid',        cmFmt(totalPaid));
    cmSet('wb-sum-outstanding', cmFmt(outstanding));
    cmSet('wb-sum-fees',        cmFmt(totalFees));

    // Populate week filter dropdown
    const weekFilter = document.getElementById('wb-week-filter');
    if (weekFilter) {
        const currentVal = weekFilter.value;
        weekFilter.innerHTML = '<option value="">All Weeks</option>' +
            bills.map(b => `<option value="${cmEsc(b.weekEndingDate || '')}">${cmEsc(b.weekEndingDate || '—')}</option>`).join('');
        if (currentVal) weekFilter.value = currentVal;
    }

    // Overdue alert
    const alert = document.getElementById('wb-overdue-alert');
    const alertMsg = document.getElementById('wb-overdue-msg');
    if (alert && alertMsg) {
        if (overdueBills.length) {
            alertMsg.textContent = overdueBills.length + ' overdue bill(s). Payment was due within 24 hours of submission. Please settle immediately.';
            alert.style.display = 'flex';
            const badge = document.getElementById('weekly-overdue-badge');
            if (badge) { badge.textContent = overdueBills.length; badge.style.display = ''; }
        } else {
            alert.style.display = 'none';
        }
    }

    const tbody = document.getElementById('wb-tbody');
    if (!tbody) return;

    if (!bills.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No billing entries submitted yet.</td></tr>';
        return;
    }

    const statusStyles = {
        Paid:      { bg: '#dcfce7', color: '#15803d' },
        Submitted: { bg: '#dbeafe', color: '#1d4ed8' },
        Overdue:   { bg: '#fee2e2', color: '#dc2626' }
    };

    tbody.innerHTML = bills.map((b, i) => {
        const ss = statusStyles[b.status] || { bg: '#f3f4f6', color: '#6b7280' };
        const labor       = b.labor       || 0;
        const materials   = b.materials   || 0;
        const otherCosts  = (b.delivery   || 0) + (b.consumables || 0) + (b.other || 0);
        const directTotal = b.directCostTotal || (labor + materials + otherCosts);
        const mgmtFee     = b.managementFee   || (directTotal * (b.managementFeeRate || 0.15));
        const totalDue    = b.totalDue         || (directTotal + mgmtFee);

        return `<tr>
            <td><strong>${cmEsc(b.weekEndingDate || '—')}</strong><div style="font-size:11px;color:#9ca3af;">Week ${bills.length - i}</div></td>
            <td>${cmFmt(labor)}</td>
            <td>${cmFmt(materials)}</td>
            <td>${cmFmt(otherCosts)}</td>
            <td><strong>${cmFmt(directTotal)}</strong></td>
            <td style="color:#7c3aed;font-weight:600;">${cmFmt(mgmtFee)}</td>
            <td><strong style="font-size:15px;">${cmFmt(totalDue)}</strong></td>
            <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${ss.bg};color:${ss.color};">${cmEsc(b.status)}</span></td>
            <td><button onclick="openWBDetail(${JSON.stringify(b).replace(/'/g,'&#39;')})" style="padding:5px 12px;border-radius:7px;border:1.5px solid #d1fae5;background:#f0fdf4;color:#059669;font-size:12px;font-weight:600;cursor:pointer;">View</button></td>
        </tr>`;
    }).join('');
}

// ── Progress & Photos ─────────────────────────────────────────────
function cmPopulateProgress() {
    // Daily logs
    const logList = document.getElementById('progress-logs-list');
    if (logList) {
        if (!cmProgressLogs.length) {
            logList.innerHTML = '<div style="padding:40px;text-align:center;color:#9ca3af;font-size:14px;">No site logs shared yet.</div>';
        } else {
            logList.innerHTML = cmProgressLogs.map(log => `
                <div class="progress-log-item" style="padding:16px 22px;border-bottom:1px solid #f1f5f9;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <strong style="font-size:14px;color:#1f2937;">${cmEsc(log.date || '—')}</strong>
                        <span style="font-size:12px;color:#9ca3af;">${cmEsc(log.weather || '')}</span>
                    </div>
                    <div style="font-size:13.5px;color:#374151;margin-bottom:6px;">${cmEsc(log.workDone || 'No details provided.')}</div>
                    ${log.materialsUsed ? `<div style="font-size:12.5px;color:#6b7280;">Materials used: ${cmEsc(log.materialsUsed)}</div>` : ''}
                    ${log.nextDayPlan  ? `<div style="font-size:12.5px;color:#6b7280;margin-top:4px;">Tomorrow: ${cmEsc(log.nextDayPlan)}</div>` : ''}
                </div>`).join('');
        }
    }

    // Photos
    const photoGrid = document.getElementById('progress-photos-grid');
    if (photoGrid) {
        const photos = cmProgressLogs.flatMap(l => (l.photos || []).map(p => ({ url: p, date: l.date })));
        cmSet('photo-count-badge', photos.length + ' Photo' + (photos.length !== 1 ? 's' : ''));
        if (!photos.length) {
            photoGrid.innerHTML = '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:14px;grid-column:1/-1;">No progress photos yet.</div>';
        } else {
            photoGrid.innerHTML = photos.map(p => `
                <div onclick="openPhotoViewer('${cmEsc(p.url)}','${cmEsc(p.date)}')" style="cursor:pointer;border-radius:10px;overflow:hidden;aspect-ratio:1;background:#f3f4f6;">
                    <img src="${cmEsc(p.url)}" alt="Site photo" style="width:100%;height:100%;object-fit:cover;" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\'display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;\'>📷</div>'">
                </div>`).join('');
        }
    }

    // Walkthroughs
    const walkList = document.getElementById('walkthrough-list');
    if (walkList && cmProjectData) {
        db.collection('constructionProjects').doc(cmProjectData.id)
            .collection('walkthroughs')
            .orderBy('date', 'desc')
            .limit(10)
            .get()
            .then(snap => {
                if (snap.empty) {
                    walkList.innerHTML = '<div style="padding:32px;text-align:center;color:#9ca3af;font-size:14px;">No walkthroughs recorded yet.</div>';
                    return;
                }
                walkList.innerHTML = snap.docs.map(d => {
                    const w = d.data();
                    return `<div style="padding:16px 22px;border-bottom:1px solid #f1f5f9;">
                        <div style="font-weight:600;color:#1f2937;margin-bottom:4px;">${cmEsc(w.milestone || '—')} <span style="font-size:12px;color:#9ca3af;font-weight:400;">· ${cmEsc(w.date || '')}</span></div>
                        <div style="font-size:13.5px;color:#374151;margin-bottom:4px;">${cmEsc(w.discussed || '')}</div>
                        ${w.agreed ? `<div style="font-size:12.5px;color:#059669;font-weight:600;">Agreed: ${cmEsc(w.agreed)}</div>` : ''}
                    </div>`;
                }).join('');
            })
            .catch(() => { walkList.innerHTML = '<div style="padding:32px;text-align:center;color:#9ca3af;">Unable to load walkthroughs.</div>'; });
    }
}

// ── Revolving Fund ────────────────────────────────────────────────
function cmPopulateRevolvingFund() {
    const rf = cmRevolvingFund;
    const fundTotal   = rf ? (rf.fundAmount || 0) : 0;
    const spent       = rf ? (rf.totalSpent || 0) : 0;
    const balance     = rf ? (rf.currentBalance !== undefined ? rf.currentBalance : fundTotal - spent) : 0;
    const balancePct  = fundTotal > 0 ? Math.round((balance / fundTotal) * 100) : 0;

    cmSet('rf-balance',     cmFmt(balance));
    cmSet('rf-balance-pct', balancePct + '% of fund remaining');
    cmSet('rf-spent',       cmFmt(spent));
    cmSet('rf-total',       cmFmt(fundTotal));

    // Low balance alert (below 20%)
    const lowAlert = document.getElementById('rf-low-alert');
    const navBadge = document.getElementById('rf-low-badge');
    if (lowAlert) lowAlert.style.display = (fundTotal > 0 && balancePct < 20) ? 'flex' : 'none';
    if (navBadge) navBadge.style.display = (fundTotal > 0 && balancePct < 20) ? '' : 'none';

    if (!cmProjectData) {
        ['rf-replenish-tbody','rf-expense-tbody'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#b0c8bc;font-style:italic;">No project assigned.</td></tr>';
        });
        return;
    }

    // Replenishments
    db.collection('constructionProjects').doc(cmProjectData.id)
        .collection('revolvingFundReplenishments')
        .orderBy('date', 'desc')
        .get()
        .then(snap => {
            const tbody = document.getElementById('rf-replenish-tbody');
            if (!tbody) return;
            if (snap.empty) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#b0c8bc;font-style:italic;">No replenishments yet.</td></tr>';
                return;
            }
            tbody.innerHTML = snap.docs.map(d => {
                const r = d.data();
                return `<tr>
                    <td>${cmEsc(r.date || '—')}</td>
                    <td style="font-weight:600;color:#15803d;">${cmFmt(r.amount || 0)}</td>
                    <td>${r.receiptsCount ? r.receiptsCount + ' receipt(s)' : '—'}</td>
                    <td>${cmEsc(r.remarks || '—')}</td>
                </tr>`;
            }).join('');
        }).catch(() => {});

    // Expenses
    db.collection('constructionProjects').doc(cmProjectData.id)
        .collection('revolvingFundExpenses')
        .orderBy('date', 'desc')
        .get()
        .then(snap => {
            const tbody = document.getElementById('rf-expense-tbody');
            if (!tbody) return;
            if (snap.empty) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#b0c8bc;font-style:italic;">No expenses recorded yet.</td></tr>';
                return;
            }
            tbody.innerHTML = snap.docs.map(d => {
                const e = d.data();
                return `<tr>
                    <td>${cmEsc(e.date || '—')}</td>
                    <td>${cmEsc(e.item || '—')}</td>
                    <td style="font-weight:600;">${cmFmt(e.amount || 0)}</td>
                    <td>${e.receiptUrl ? `<button onclick="openPhotoViewer('${cmEsc(e.receiptUrl)}','Receipt: ${cmEsc(e.item)}')" style="padding:4px 10px;border-radius:6px;border:1px solid #d1fae5;background:#f0fdf4;color:#059669;font-size:12px;cursor:pointer;">View</button>` : '—'}</td>
                </tr>`;
            }).join('');
        }).catch(() => {});
}

// ── Notifications ─────────────────────────────────────────────────
function cmSubscribeNotifications() {
    if (!cmCurrentUser) return;
    if (_cmNotifUnsub) { _cmNotifUnsub(); _cmNotifUnsub = null; }

    // Notifications are nested at notifications/{uid}/items/{notifId} — the
    // previous top-level `.where('userId','==',...)` query was hitting the
    // wrong path (no userId field exists on items) and silently returning
    // nothing, which is why the CM bell never lit up.
    _cmNotifUnsub = db.collection('notifications')
        .doc(cmCurrentUser.uid)
        .collection('items')
        .orderBy('createdAt', 'desc')
        .limit(30)
        .onSnapshot(snap => {
            _cmFirestoreNotifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            cmUpdateNotifBadge();
            cmRenderNotifDropdown();
            // Lazy field migration: any doc with `read` but no `isRead` gets
            // the canonical field added. Idempotent; runs once per session.
            _cmMigrateNotifFields(snap.docs);
        }, err => { console.warn('CM notif subscribe:', err.message); });
}

let _cmNotifMigrationDone = false;
function _cmMigrateNotifFields(docs) {
    if (_cmNotifMigrationDone || !cmCurrentUser) return;
    _cmNotifMigrationDone = true;
    const fix = docs.filter(d => {
        const data = d.data();
        return 'read' in data && !('isRead' in data);
    });
    if (!fix.length) return;
    const batch = db.batch();
    fix.forEach(d => batch.update(d.ref, { isRead: d.data().read === true }));
    batch.commit()
        .then(() => console.log('[notif-migration] CM normalized', fix.length, 'doc(s)'))
        .catch(e => console.warn('[notif-migration] CM batch error:', e));
}

function cmUpdateNotifBadge() {
    const unread = _cmFirestoreNotifs.filter(n => !n.isRead && !n.read).length;
    const dot = document.getElementById('notif-dot');
    const navBadge = document.getElementById('notif-nav-badge');
    if (dot)      { dot.style.display      = unread ? '' : 'none'; }
    if (navBadge) { navBadge.style.display = unread ? '' : 'none'; navBadge.textContent = unread; }
}

function cmRenderNotifDropdown() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    const notifs = _cmFirestoreNotifs.slice(0, 8);
    if (!notifs.length) {
        list.innerHTML = '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:13px;">No notifications yet.</div>';
        return;
    }
    list.innerHTML = notifs.map(n => {
        // Defensive: accept either field name. Most producers write `isRead`,
        // a couple of legacy ones use `read`.
        const isUnread = !n.isRead && !n.read;
        return `
        <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;${isUnread ? 'background:#f0fdf4;' : ''}cursor:pointer;" onclick="cmMarkRead('${n.id}')">
            <div style="font-size:13px;font-weight:${isUnread ? '600' : '400'};color:#1f2937;">${cmEsc(n.message || n.title || '—')}</div>
            <div style="font-size:11.5px;color:#9ca3af;margin-top:3px;">${n.createdAt?.toDate ? n.createdAt.toDate().toLocaleDateString('en-PH') : '—'}</div>
        </div>`;
    }).join('');
}

async function cmMarkRead(notifId) {
    // Correct path is notifications/{userId}/items/{notifId} — the previous
    // version was hitting notifications/{notifId} which silently 404s.
    // `isRead` is canonical; lazy migration ensures legacy `read`-only docs
    // have `isRead` written before they can be clicked. Renderer keeps the
    // defensive read fallback as permanent insurance.
    if (!cmCurrentUser || !notifId) return;
    try {
        await db.collection('notifications')
            .doc(cmCurrentUser.uid)
            .collection('items')
            .doc(notifId)
            .update({ isRead: true });
    } catch (e) { console.warn('cmMarkRead error:', e); }
}

window.markAllRead = async function() {
    const unread = _cmFirestoreNotifs.filter(n => !n.isRead && !n.read);
    await Promise.all(unread.map(n => cmMarkRead(n.id)));
};

window.renderNotifHistory = function cmRenderNotifHistory() {
    const el = document.getElementById('notif-history-list');
    if (!el) return;
    if (!_cmFirestoreNotifs.length) {
        el.innerHTML = '<div style="padding:48px;text-align:center;color:#9ca3af;"><div style="font-size:32px;margin-bottom:10px;">🔔</div><div style="font-weight:600;font-size:14px;">No notifications yet.</div></div>';
        return;
    }
    el.innerHTML = _cmFirestoreNotifs.map(n => `
        <div style="padding:16px 22px;border-bottom:1px solid #f1f5f9;${n.read ? '' : 'background:#f0fdf4;'}">
            <div style="font-size:13.5px;font-weight:${n.read ? '400' : '700'};color:#1f2937;">${cmEsc(n.message || n.title || '—')}</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${n.createdAt?.toDate ? n.createdAt.toDate().toLocaleDateString('en-PH', {year:'numeric',month:'long',day:'numeric'}) : '—'}</div>
        </div>`).join('');
};

// ── Sidebar / Topbar ──────────────────────────────────────────────
window.toggleSidebar = function() {
    const sidebar = document.getElementById('sidebar');
    const main    = document.getElementById('main-content');
    const overlay = document.getElementById('overlay');
    const burger  = document.getElementById('burger');
    if (window.innerWidth <= 768) {
        const open = sidebar.classList.toggle('open');
        overlay.classList.toggle('show', open);
        burger.classList.toggle('open', open);
    } else {
        cmSidebarOpen = !cmSidebarOpen;
        sidebar.classList.toggle('closed', !cmSidebarOpen);
        main.classList.toggle('expanded', !cmSidebarOpen);
    }
};

window.closeSidebar = function() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
    document.getElementById('burger').classList.remove('open');
};
function cmCloseSidebar() { window.closeSidebar(); }

window.toggleNotifications = function() {
    document.getElementById('notif-dropdown').classList.toggle('show');
};

window.toggleDarkMode = function() {
    document.body.classList.toggle('dark-mode');
    const dark = document.body.classList.contains('dark-mode');
    localStorage.setItem('dac-dark', dark ? '1' : '0');
    document.getElementById('icon-moon').style.display = dark ? 'none' : '';
    document.getElementById('icon-sun').style.display  = dark ? '' : 'none';
    // Re-render combined KPI grid so status colors update for the new mode
    cmRenderFinancialKPIs();
};

// ── Profile ───────────────────────────────────────────────────────
window.toggleEditProfile = function() {
    const view = document.getElementById('profile-view-mode');
    const edit = document.getElementById('profile-edit-mode');
    if (!view || !edit) return;
    const editing = edit.style.display !== 'none';
    view.style.display = editing ? '' : 'none';
    edit.style.display = editing ? 'none' : '';
    if (!editing) {
        document.getElementById('edit-firstname').value = cmCurrentProfile?.firstName || '';
        document.getElementById('edit-lastname').value  = cmCurrentProfile?.lastName  || '';
    }
    document.getElementById('btn-edit-profile').textContent = editing ? 'Edit Profile' : 'Cancel';
};

window.cancelEditProfile = function() { window.toggleEditProfile(); };

window.saveProfile = async function() {
    const fn = document.getElementById('edit-firstname').value.trim();
    const ln = document.getElementById('edit-lastname').value.trim();
    if (!fn) { cmErr('err-edit-firstname', 'First name is required.'); return; }
    try {
        await db.collection(CM_COLLECTION).doc(cmCurrentUser.uid).update({ firstName: fn, lastName: ln });
        cmCurrentProfile.firstName = fn;
        cmCurrentProfile.lastName  = ln;
        cmRefreshUserDisplay();
        window.toggleEditProfile();
        cmShowToast('Profile updated ✓');
    } catch (err) { cmShowToast('Error saving profile.'); }
};

window.triggerAvatarUpload = function() { document.getElementById('avatar-file-input')?.click(); };
window.handleAvatarUpload  = function(event) {
    const file = event.target.files?.[0];
    if (!file || !cmCurrentUser) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            await db.collection(CM_COLLECTION).doc(cmCurrentUser.uid).update({ photoURL: e.target.result });
            cmCurrentProfile.photoURL = e.target.result;
            cmRefreshUserDisplay();
            cmShowToast('Photo updated ✓');
        } catch (err) { cmShowToast('Error uploading photo.'); }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
};

// ── Change Password ───────────────────────────────────────────────
window.toggleChangePassword = function() {
    const form  = document.getElementById('change-pw-form');
    const ph    = document.getElementById('change-pw-placeholder');
    const open  = form && form.style.display !== 'none';
    if (form) form.style.display  = open ? 'none' : '';
    if (ph)   ph.style.display    = open ? '' : 'none';
};

window.doChangePassword = async function() {
    const cur  = document.getElementById('pw-current').value;
    const nw   = document.getElementById('pw-new').value;
    const conf = document.getElementById('pw-confirm-new').value;
    cmClear('err-pw-current'); cmClear('err-pw-new'); cmClear('err-pw-confirm-new');
    if (!cur)              { cmErr('err-pw-current',    'Enter your current password.');          return; }
    if (!nw || nw.length < 8){ cmErr('err-pw-new',     'New password must be at least 8 chars.'); return; }
    if (nw !== conf)       { cmErr('err-pw-confirm-new','Passwords don\'t match.');               return; }
    try {
        const cred = firebase.auth.EmailAuthProvider.credential(cmCurrentUser.email, cur);
        await cmCurrentUser.reauthenticateWithCredential(cred);
        await cmCurrentUser.updatePassword(nw);
        cmShowToast('Password changed ✓');
        window.toggleChangePassword();
    } catch (err) {
        if (err.code === 'auth/wrong-password') cmErr('err-pw-current', 'Current password is incorrect.');
        else cmShowToast('Error changing password: ' + err.message);
    }
};

// ── Auth helpers (used by login form) ────────────────────────────
window.switchToLogin = function switchToLogin() {
    const fl = document.getElementById('form-login');
    if (fl) fl.style.display = '';
};

// ── Password toggle / strength ────────────────────────────────────
window.togglePassword = function(inputId, eyeId) {
    const inp = document.getElementById(inputId);
    const eye = document.getElementById(eyeId);
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    if (eye) {
        eye.style.opacity = inp.type === 'text' ? '0.5' : '1';
    }
};

window.updateNewPwStrength = function() {
    const val  = document.getElementById('pw-new')?.value || '';
    const wrap  = document.getElementById('new-pw-strength-wrap');
    const fill  = document.getElementById('new-pw-strength-fill');
    const label = document.getElementById('new-pw-strength-label');
    if (!wrap || !fill || !label) return;
    if (!val) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    let score = 0;
    if (val.length >= 8)              score++;
    if (/[A-Z]/.test(val))            score++;
    if (/[0-9]/.test(val))            score++;
    if (/[^A-Za-z0-9]/.test(val))     score++;
    const levels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', '#ef4444', '#f59e0b', '#22c55e', '#16a34a'];
    fill.style.width  = (score * 25) + '%';
    fill.style.background = colors[score] || '#ef4444';
    label.textContent = levels[score] || 'Weak';
    label.style.color = colors[score] || '#ef4444';
};

// ── Toast ─────────────────────────────────────────────────────────
function cmShowToast(msg, duration) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), duration || 3000);
}
window.showToast = cmShowToast;

// ── Forgot Password ───────────────────────────────────────────────
window.doForgotPassword = function() {
    const modal = document.getElementById('forgotPasswordModal');
    const input = document.getElementById('forgotEmailInput');
    const msg   = document.getElementById('forgotPasswordMsg');
    const loginEmail = (document.getElementById('login-email') || {}).value || '';
    if (input) input.value = loginEmail;
    if (msg)   { msg.style.display = 'none'; }
    if (modal) modal.style.display = 'flex';
};
window.closeForgotPasswordModal = function() {
    const m = document.getElementById('forgotPasswordModal'); if (m) m.style.display = 'none';
};
window.sendResetEmail = async function() {
    const input = document.getElementById('forgotEmailInput');
    const msg   = document.getElementById('forgotPasswordMsg');
    const btn   = document.getElementById('sendResetBtn');
    const email = (input ? input.value : '').trim();
    const show  = (text, err) => {
        if (!msg) return;
        msg.textContent = text; msg.style.display = 'block';
        msg.style.background = err ? '#fef2f2' : '#f0fdf4';
        msg.style.color      = err ? '#b91c1c' : '#065f46';
        msg.style.border     = '1px solid ' + (err ? '#fecaca' : '#a7f3d0');
    };
    if (!email) { show('Please enter your email.', true); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
        await firebase.auth().sendPasswordResetEmail(email);
        show('Reset link sent! Check your inbox.', false);
        if (input) input.value = '';
        setTimeout(window.closeForgotPasswordModal, 3000);
    } catch (e) {
        show(e.code === 'auth/user-not-found' ? 'No account found.' : 'Failed to send email.', true);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; }
    }
};

// Close notification dropdown when clicking outside
document.addEventListener('click', function(e) {
    const wrap = document.getElementById('notif-wrap');
    if (wrap && !wrap.contains(e.target)) {
        const dd = document.getElementById('notif-dropdown');
        if (dd) dd.classList.remove('show');
    }
});

// ══════════════════════════════════════════════════════════════════
// ACCOMPLISHMENT REPORTS
// ══════════════════════════════════════════════════════════════════

function cmPopulateAccomplishmentReports() {
    const tbody = document.getElementById('reports-tbody');
    if (!cmProjectData) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No project assigned yet.</td></tr>';
        return;
    }

    // Progress summary bar
    const approved   = cmAccomplishmentReports.filter(r => r.status === 'approved');
    const latest     = [...approved].sort((a,b) => (b.date||'').localeCompare(a.date||''))[0];
    const overallPct = latest?.progressPercentage ?? 0;
    const summaryEl  = document.getElementById('ar-summary-bar');
    if (summaryEl) {
        summaryEl.style.display = '';
        const fill  = summaryEl.querySelector('.ar-progress-fill');
        const label = summaryEl.querySelector('.ar-progress-label');
        const pctEl = summaryEl.querySelector('.ar-progress-pct');
        if (fill)  fill.style.width = overallPct + '%';
        if (label) label.textContent = 'Overall Project Progress (latest approved report)';
        if (pctEl) pctEl.textContent = overallPct + '%';
    }

    cmRenderAccomplishmentTable(cmAccomplishmentReports);
}

function cmRenderAccomplishmentTable(reports) {
    const tbody = document.getElementById('reports-tbody');
    if (!tbody) return;
    if (!reports || !reports.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#9ca3af;font-style:italic;">No accomplishment reports available yet.</td></tr>';
        return;
    }
    const SS = {
        approved:  { bg:'#dcfce7', color:'#15803d', label:'Approved' },
        submitted: { bg:'#dbeafe', color:'#1d4ed8', label:'For Review' },
        draft:     { bg:'#f3f4f6', color:'#6b7280', label:'Draft' }
    };
    tbody.innerHTML = reports.map(r => {
        const ss    = SS[r.status] || SS.draft;
        const tasks = Array.isArray(r.completedTasks) ? r.completedTasks : (r.completedTasks ? [r.completedTasks] : []);
        const taskText = tasks.length
            ? tasks.slice(0,2).map(t => cmEsc(t)).join('; ') + (tasks.length > 2 ? ` <em>+${tasks.length-2} more</em>` : '')
            : '<em style="color:#9ca3af;">No tasks listed</em>';
        const pct      = r.progressPercentage != null ? r.progressPercentage + '%' : '—';
        const pctColor = r.progressPercentage >= 80 ? '#15803d' : r.progressPercentage >= 50 ? '#d97706' : '#374151';
        return `<tr>
            <td>
                <div style="font-weight:600;color:#1f2937;font-size:13.5px;">${cmEsc(r.title || 'Report')}</div>
                ${r.approvedBy ? `<div style="font-size:11px;color:#059669;margin-top:2px;">✓ Validated by ${cmEsc(r.approvedBy)}</div>` : '<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Pending validation</div>'}
            </td>
            <td style="font-size:13px;color:#374151;white-space:nowrap;">${cmEsc(r.date || '—')}</td>
            <td style="font-size:12.5px;color:#6b7280;">${cmEsc(r.milestone || '—')}</td>
            <td style="font-size:12.5px;color:#374151;max-width:200px;">${taskText}</td>
            <td style="text-align:center;"><span style="font-weight:700;font-size:14px;color:${pctColor};">${pct}</span></td>
            <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${ss.bg};color:${ss.color};">${ss.label}</span></td>
            <td><button onclick="cmViewAccomplishmentReport(${JSON.stringify(r).replace(/'/g,'&#39;').replace(/</g,'&lt;')})" style="padding:5px 12px;border-radius:7px;border:1.5px solid #d1fae5;background:#f0fdf4;color:#059669;font-size:12px;font-weight:600;cursor:pointer;">View</button></td>
        </tr>`;
    }).join('');
}

window.filterReports = function() {
    const q = (document.getElementById('report-search')?.value || '').toLowerCase().trim();
    const filtered = !q ? cmAccomplishmentReports
        : cmAccomplishmentReports.filter(r =>
            (r.title     ||'').toLowerCase().includes(q) ||
            (r.milestone ||'').toLowerCase().includes(q) ||
            (r.notes     ||'').toLowerCase().includes(q)
        );
    cmRenderAccomplishmentTable(filtered);
};

window.cmViewAccomplishmentReport = function(r) {
    const modal   = document.getElementById('report-modal');
    if (!modal) return;
    const titleEl = document.getElementById('rmd-title');
    const metaEl  = document.getElementById('rmd-meta');
    const bodyEl  = document.getElementById('rmd-body');
    const footerEl= document.getElementById('rmd-footer');
    if (titleEl) titleEl.textContent = r.title || 'Accomplishment Report';
    if (metaEl)  metaEl.textContent  = (r.date || '') + (r.milestone ? '  ·  ' + r.milestone : '');
    const tasks = Array.isArray(r.completedTasks) ? r.completedTasks : (r.completedTasks ? [r.completedTasks] : []);
    const SM    = { approved:{label:'Approved by DACS',color:'#15803d'}, submitted:{label:'For Admin Review',color:'#1d4ed8'}, draft:{label:'Draft',color:'#6b7280'} };
    const ss    = SM[r.status] || SM.draft;
    if (bodyEl) bodyEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
            ${r.progressPercentage != null ? `<div style="display:flex;align-items:center;gap:8px;background:#f0fdf4;border:1px solid #a7f3d0;border-radius:8px;padding:8px 14px;">
                <div style="font-size:24px;font-weight:800;color:#059669;">${r.progressPercentage}%</div>
                <div style="font-size:12px;color:#065f46;line-height:1.3;">Overall<br>Progress</div>
            </div>` : ''}
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;">
                <div style="font-size:11px;color:#9ca3af;margin-bottom:2px;text-transform:uppercase;letter-spacing:.4px;">Status</div>
                <div style="font-size:13px;font-weight:700;color:${ss.color};">${ss.label}</div>
            </div>
            ${r.milestone ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;">
                <div style="font-size:11px;color:#9ca3af;margin-bottom:2px;text-transform:uppercase;letter-spacing:.4px;">Milestone</div>
                <div style="font-size:13px;font-weight:600;color:#374151;">${cmEsc(r.milestone)}</div>
            </div>` : ''}
        </div>
        ${tasks.length ? `<div style="margin-bottom:18px;">
            <div style="font-weight:700;font-size:13px;color:#1f2937;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;">Completed Tasks</div>
            <ul style="margin:0;padding-left:20px;">${tasks.map(t=>`<li style="font-size:13.5px;color:#374151;margin-bottom:6px;">${cmEsc(t)}</li>`).join('')}</ul>
        </div>` : ''}
        ${r.notes ? `<div style="background:#f8fafc;border-radius:8px;padding:14px;border:1px solid #e2e8f0;">
            <div style="font-weight:700;font-size:11.5px;color:#9ca3af;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">Notes</div>
            <div style="font-size:13.5px;color:#374151;line-height:1.6;">${cmEsc(r.notes)}</div>
        </div>` : ''}`;
    if (footerEl) footerEl.innerHTML = r.approvedBy
        ? `<div style="font-size:12.5px;color:#059669;">✓ Validated and approved by ${cmEsc(r.approvedBy)} — visible to client</div>`
        : `<div style="font-size:12.5px;color:#9ca3af;">Pending admin validation before final approval.</div>`;
    modal.classList.add('show');
};

// ── Report Modal close ────────────────────────────────────────────
window.closeReportModal = function(e) {
    const m = document.getElementById('report-modal');
    if (m && (!e || e.target === m)) m.classList.remove('show');
};

// ══════════════════════════════════════════════════════════════════
// MILESTONE TRACKING
// ══════════════════════════════════════════════════════════════════

const MS_SC = {
    completed : { label:'Completed',   dot:'#16a34a', bg:'#dcfce7', color:'#15803d', barColor:'#16a34a' },
    in_progress:{ label:'In Progress', dot:'#2563eb', bg:'#dbeafe', color:'#1d4ed8', barColor:'#2563eb' },
    pending   : { label:'Pending',     dot:'#9ca3af', bg:'#f3f4f6', color:'#6b7280', barColor:'#d1d5db' }
};

function cmPopulateMilestones() {
    const panel = document.getElementById('milestones-panel');
    const empty  = document.getElementById('milestone-empty');
    const stats  = document.getElementById('milestone-stats-row');

    if (!cmProjectData) {
        if (panel) panel.style.display = 'none';
        if (empty) empty.style.display = 'none';
        if (stats) stats.style.display = 'none';
        return;
    }
    if (!cmMilestones.length) {
        if (panel) panel.style.display = 'none';
        if (empty) empty.style.display = '';
        if (stats) stats.style.display = 'none';
        return;
    }

    if (empty) empty.style.display = 'none';
    if (panel) panel.style.display = '';

    const total       = cmMilestones.length;
    const completedMs = cmMilestones.filter(m => m.status === 'completed').length;
    const inProgMs    = cmMilestones.filter(m => m.status === 'in_progress').length;
    const pendingMs   = total - completedMs - inProgMs;
    const doneWeight  = cmMilestones.filter(m => m.status === 'completed').reduce((s,m) => s + (m.percentage||0), 0);

    const badge = document.getElementById('milestone-active-badge');
    if (badge) { badge.textContent = inProgMs; badge.style.display = inProgMs ? '' : 'none'; }

    if (stats) {
        stats.style.display = '';
        stats.innerHTML = `
            <div class="ms-stat-card ms-stat-green"><div class="ms-stat-value">${completedMs}</div><div class="ms-stat-label">Completed</div></div>
            <div class="ms-stat-card ms-stat-blue"><div class="ms-stat-value">${inProgMs}</div><div class="ms-stat-label">In Progress</div></div>
            <div class="ms-stat-card ms-stat-gray"><div class="ms-stat-value">${pendingMs}</div><div class="ms-stat-label">Pending</div></div>
            <div class="ms-stat-card ms-stat-purple"><div class="ms-stat-value">${doneWeight}%</div><div class="ms-stat-label">Work Done</div></div>`;
    }

    cmRenderMilestonesTable(cmMilestones);
}

function cmRenderMilestonesTable(milestones) {
    const tbody = document.getElementById('milestones-tbody');
    if (!tbody) return;
    if (!milestones.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:#9ca3af;font-style:italic;">No milestones match your search.</td></tr>';
        return;
    }
    const today = new Date().toISOString().split('T')[0];
    tbody.innerHTML = milestones.map((m, idx) => {
        const sc        = MS_SC[m.status] || MS_SC.pending;
        const isDelayed = m.status !== 'completed' && m.plannedDate && m.plannedDate < today;

        // Compute accomplishment % from related reports
        const relatedReports = cmAccomplishmentReports
            .filter(r => r.milestone === m.name && r.status === 'approved')
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const pct = m.status === 'completed' ? 100
            : relatedReports[0]?.progressPercentage ?? (m.status === 'in_progress' ? null : 0);
        const pctDisplay = pct != null ? pct + '%' : '—';
        const barW       = pct != null ? Math.min(pct, 100) : 0;
        const reportCount = cmAccomplishmentReports.filter(r => r.milestone === m.name).length;

        return `<tr>
            <td>
                <div style="font-weight:600;color:#1f2937;font-size:13.5px;">${cmEsc(m.name || 'Milestone')}</div>
                ${m.description ? `<div style="font-size:11.5px;color:#9ca3af;margin-top:2px;">${cmEsc(m.description)}</div>` : ''}
                ${isDelayed ? `<div style="font-size:11px;color:#dc2626;font-weight:600;margin-top:3px;">⚠ Delayed</div>` : ''}
                ${reportCount ? `<div style="font-size:11px;color:#059669;margin-top:2px;">${reportCount} report(s)</div>` : ''}
            </td>
            <td style="font-size:13px;color:#6b7280;white-space:nowrap;">Phase ${cmEsc(String(m.order || idx + 1))}</td>
            <td style="font-size:13px;color:#374151;white-space:nowrap;">${cmEsc(m.plannedDate || '—')}</td>
            <td style="min-width:160px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <div style="flex:1;height:7px;background:#f1f5f9;border-radius:99px;overflow:hidden;min-width:70px;">
                        <div style="height:100%;width:${barW}%;background:${sc.barColor};border-radius:99px;transition:width .5s;"></div>
                    </div>
                    <span style="font-size:13px;font-weight:700;color:${sc.color};min-width:32px;text-align:right;">${pctDisplay}</span>
                </div>
            </td>
            <td>
                <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:99px;font-size:11.5px;font-weight:700;background:${sc.bg};color:${sc.color};">
                    <span style="width:6px;height:6px;border-radius:50%;background:${sc.dot};flex-shrink:0;"></span>
                    ${sc.label}
                </span>
            </td>
            <td style="text-align:center;">
                <button onclick="cmViewMilestoneDetail('${cmEsc(m.id || m.name)}')"
                    style="padding:5px 14px;border-radius:7px;border:1.5px solid #d1fae5;background:#f0fdf4;color:#059669;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">
                    View
                </button>
            </td>
        </tr>`;
    }).join('');
}

window.cmFilterMilestones = function() {
    const q = (document.getElementById('milestone-search')?.value || '').toLowerCase().trim();
    const filtered = !q ? cmMilestones
        : cmMilestones.filter(m =>
            (m.name        || '').toLowerCase().includes(q) ||
            (m.description || '').toLowerCase().includes(q) ||
            (m.status      || '').toLowerCase().includes(q)
        );
    cmRenderMilestonesTable(filtered);
};

// ── Milestone Detail Modal ────────────────────────────────────────
window.cmViewMilestoneDetail = function(milestoneId) {
    const m = cmMilestones.find(ms => ms.id === milestoneId || ms.name === milestoneId);
    if (!m) return;

    const modal    = document.getElementById('milestone-detail-modal');
    const titleEl  = document.getElementById('msd-title');
    const metaEl   = document.getElementById('msd-meta');
    const bodyEl   = document.getElementById('msd-body');
    const footerEl = document.getElementById('msd-footer');
    const badgeEl  = document.getElementById('msd-status-badge');
    if (!modal) return;

    const sc = MS_SC[m.status] || MS_SC.pending;
    if (titleEl) titleEl.textContent = m.name || 'Milestone';
    if (metaEl) {
        const parts = [];
        if (m.order)        parts.push('Phase ' + m.order);
        if (m.plannedDate)  parts.push('Planned: ' + m.plannedDate);
        if (m.actualDate)   parts.push('Completed: ' + m.actualDate);
        if (m.percentage)   parts.push(m.percentage + '% project weight');
        metaEl.textContent = parts.join('  ·  ');
    }
    if (badgeEl) {
        badgeEl.className   = 'badge badge-' + (m.status === 'completed' ? 'approved' : m.status === 'in_progress' ? 'submitted' : 'draft');
        badgeEl.textContent = sc.label;
    }

    // Related accomplishment reports for this milestone
    const relatedReports = cmAccomplishmentReports
        .filter(r => r.milestone === m.name)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    const allTasks = relatedReports.flatMap(r =>
        Array.isArray(r.completedTasks) ? r.completedTasks : (r.completedTasks ? [r.completedTasks] : [])
    );

    const latestApproved = relatedReports.filter(r => r.status === 'approved')[0];
    const overallPct = m.status === 'completed' ? 100
        : (latestApproved?.progressPercentage ?? (m.status === 'in_progress' ? '—' : 0));

    // Build BOQ-style table
    let html = `<table class="boq-view-table">
        <thead>
            <tr>
                <th class="col-num">ITEM NO.</th>
                <th>DESCRIPTIONS</th>
                <th class="col-qty">DATE</th>
                <th class="col-pct">% OF COMPLETION</th>
                <th class="col-ref">STATUS</th>
            </tr>
        </thead>
        <tbody>`;

    if (relatedReports.length) {
        relatedReports.forEach((r, ri) => {
            const rSC  = { approved:{ bg:'#dcfce7', color:'#15803d', label:'Approved' }, submitted:{ bg:'#dbeafe', color:'#1d4ed8', label:'For Review' }, draft:{ bg:'#f3f4f6', color:'#6b7280', label:'Draft' } };
            const rss  = rSC[r.status] || rSC.draft;
            const pct  = r.progressPercentage != null ? r.progressPercentage : 0;
            const tasks = Array.isArray(r.completedTasks) ? r.completedTasks : (r.completedTasks ? [r.completedTasks] : []);

            html += `<tr class="boq-section-row">
                <td class="col-num">${ri + 1}.</td>
                <td>${cmEsc(r.title || 'Report ' + (ri + 1))}</td>
                <td class="col-qty" style="font-size:12px;color:#6b7280;">${cmEsc(r.date || '—')}</td>
                <td class="col-pct"></td>
                <td class="col-ref"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;background:${rss.bg};color:${rss.color};">${rss.label}</span></td>
            </tr>`;

            tasks.forEach((task, ti) => {
                html += `<tr class="boq-view-sub-header-row">
                    <td class="col-num">${String.fromCharCode(65 + ti)}.</td>
                    <td style="font-size:13px;">${cmEsc(task)}</td>
                    <td class="col-qty"></td>
                    <td class="col-pct"></td>
                    <td class="col-ref"></td>
                </tr>`;
            });

            if (pct > 0) {
                html += `<tr class="boq-line-row">
                    <td class="col-num"></td>
                    <td style="font-size:12px;color:#6b7280;">Progress as of this report</td>
                    <td class="col-qty"></td>
                    <td class="col-pct">
                        <div style="display:flex;align-items:center;gap:6px;justify-content:center;">
                            <div class="boq-pct-bar-wrap"><div class="boq-pct-bar" style="width:${Math.min(pct,100)}%"></div></div>
                            <span style="font-size:11px;font-weight:700;">${pct}%</span>
                        </div>
                    </td>
                    <td class="col-ref"></td>
                </tr>`;
            }

            html += `<tr class="boq-subtotal-row"><td colspan="5">Subtotal &mdash; ${cmEsc(r.title || 'Report ' + (ri + 1))}</td></tr>`;
        });
    } else {
        html += `<tr><td colspan="5" style="text-align:center;padding:28px;color:#9ca3af;font-style:italic;">No accomplishment reports linked to this milestone yet.</td></tr>`;
    }

    html += `</tbody></table>`;

    // Overall completion footer
    html += `<div class="boq-grand-total">
        <span class="boq-grand-total-label">Overall Completion</span>
        <div class="boq-grand-total-group">
            <div class="boq-total-item">
                <div class="boq-total-item-value accent" style="font-size:1.6rem;">${overallPct}%</div>
            </div>
        </div>
    </div>`;

    // Description section if present
    if (m.description) {
        html += `<div style="padding:16px 20px;border-top:1px solid #f1f5f9;font-size:13.5px;color:#374151;line-height:1.6;">
            <div style="font-weight:700;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Milestone Description</div>
            ${cmEsc(m.description)}
        </div>`;
    }

    if (bodyEl) bodyEl.innerHTML = html;

    if (footerEl) {
        const validatedBy = relatedReports.filter(r => r.status === 'approved' && r.approvedBy).map(r => r.approvedBy)[0];
        footerEl.style.display = '';
        footerEl.innerHTML = validatedBy
            ? `<div style="font-size:12.5px;color:#059669;">✓ Validated and approved by ${cmEsc(validatedBy)} — visible to client</div>`
            : `<div style="font-size:12.5px;color:#9ca3af;">Pending admin validation before final approval.</div>`;
    }

    modal.classList.add('show');
};

window.cmCloseMilestoneModal = function(e) {
    const m = document.getElementById('milestone-detail-modal');
    if (m && (!e || e.target === m)) m.classList.remove('show');
};

function populateBilling() {
    // Populate bsum-total from project budget
    const budget = cmProjectData?.budget || 0;
    const totalEl = document.getElementById('bsum-total');
    if (totalEl) totalEl.textContent = cmFmt(budget);

    // Populate billing history table from weekly bills
    const tbody = document.getElementById('billing-tbody');
    if (tbody) {
        if (!cmWeeklyBills.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No billing periods available yet.</td></tr>';
        } else {
            tbody.innerHTML = cmWeeklyBills.map((b, i) => `
                <tr>
                    <td>${cmWeeklyBills.length - i}</td>
                    <td>${cmEsc(b.weekEndingDate || '—')}</td>
                    <td>Labor + Materials + 15% Fee</td>
                    <td>${cmFmt(b.totalDue || 0)}</td>
                    <td><span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${b.status==='Paid'?'#dcfce7':b.status==='Overdue'?'#fee2e2':'#dbeafe'};color:${b.status==='Paid'?'#15803d':b.status==='Overdue'?'#dc2626':'#1d4ed8'};">${cmEsc(b.status||'—')}</span></td>
                </tr>`).join('');
        }
    }

    if (typeof initClientPayment === 'function') initClientPayment();
}

// Populates bsum-billed and bsum-count once payment requests are loaded
window.refreshBilledKPI = function() {
    const reqs = window._clientPayRequests || [];
    const totalBilled = reqs
        .filter(r => r.status === 'verified')
        .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const billedEl = document.getElementById('bsum-billed');
    if (billedEl) billedEl.textContent = cmFmt(totalBilled);
    const countEl = document.getElementById('bsum-count');
    if (countEl) countEl.textContent = reqs.length;
};

// ── Project Manager Contact ───────────────────────────────────────
function cmPopulateProjectManager() {
    const card = document.getElementById('pm-contact-card');
    if (!card) return;

    const p   = cmProjectData || {};
    const name  = p.pmName  || 'DACS Project Manager';
    const title = p.pmTitle || 'Project Manager';
    const email = p.pmEmail || 'info@dacsbuilding.com';
    const phone = p.pmPhone || null;
    const photo = p.pmPhotoURL || null;
    const proj  = p.projectName || '—';

    const avatarHTML = photo
        ? `<img src="${cmEsc(photo)}" alt="${cmEsc(name)}" class="pm-card-avatar-img"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="pm-card-avatar-initials" style="display:none;">${cmEsc((name.split(' ').map(w=>w[0]||'').join('').toUpperCase()).slice(0,2))}</div>`
        : `<div class="pm-card-avatar-initials">${cmEsc((name.split(' ').map(w=>w[0]||'').join('').toUpperCase()).slice(0,2))}</div>`;

    card.innerHTML = `
        <div class="pm-card-inner">
            <div class="pm-card-avatar-wrap">
                ${avatarHTML}
            </div>
            <div class="pm-card-info">
                <div class="pm-card-name">${cmEsc(name)}</div>
                <div class="pm-card-title">${cmEsc(title)}</div>
                <div class="pm-card-project">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    Managing: ${cmEsc(proj)}
                </div>
            </div>
            <div class="pm-card-badge">
                <span class="pm-card-badge-dot"></span> On Duty
            </div>
        </div>
        <div class="pm-card-contacts">
            <a class="pm-contact-btn pm-contact-email" href="mailto:${cmEsc(email)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <div>
                    <div class="pm-contact-btn-label">Email</div>
                    <div class="pm-contact-btn-value">${cmEsc(email)}</div>
                </div>
            </a>
            ${phone ? `<a class="pm-contact-btn pm-contact-phone" href="tel:${cmEsc(phone)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.6a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <div>
                    <div class="pm-contact-btn-label">Phone / Viber</div>
                    <div class="pm-contact-btn-value">${cmEsc(phone)}</div>
                </div>
            </a>` : ''}
        </div>
        <div class="pm-card-note">
            For urgent site concerns, reach out directly to your project manager. Response time is typically within 1 business day.
        </div>
    `;
}

// ══════════════════════════════════════════════════════════════════
// MATERIALS PROCUREMENT LIST
// ══════════════════════════════════════════════════════════════════

let _plItems = [];
let _plBuyItemData = null;
let _plReceiptFile = null;

async function cmPopulateProcurementList() {
    if (!cmProjectData) {
        const tbody = document.getElementById('pl-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No project assigned yet.</td></tr>';
        return;
    }

    try {
        const snap = await db.collection('constructionProjects')
            .doc(cmProjectData.id)
            .collection('procurementList')
            .orderBy('createdAt', 'desc')
            .get();
        _plItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        plRenderTable(_plItems);
        plUpdateSummary(_plItems);
    } catch (err) {
        console.warn('Procurement list load:', err.message);
        const tbody = document.getElementById('pl-tbody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">Unable to load items.</td></tr>';
    }
}

function plUpdateSummary(items) {
    const total   = items.length;
    const pending = items.filter(i => i.status === 'Pending').length;
    const client  = items.filter(i => i.status === 'Assigned to Client' || i.boughtBy === 'client').length;
    const company = items.filter(i => i.status === 'Assigned to Admin'  || i.boughtBy === 'company').length;
    cmSet('pl-total-items',   total);
    cmSet('pl-pending-items', pending);
    cmSet('pl-client-items',  client);
    cmSet('pl-company-items', company);
    const badge = document.getElementById('procurement-pending-badge');
    if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
}

function plRenderTable(items) {
    const tbody = document.getElementById('pl-tbody');
    if (!tbody) return;
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No items on the procurement list yet.</td></tr>';
        return;
    }

    const statusBadgeClass = {
        'Pending'           : 'pm-badge pm-badge-pending',
        'Assigned to Client': 'pm-badge pm-badge-assigned-client',
        'Assigned to Admin' : 'pm-badge pm-badge-assigned-admin',
        'Bought by Client'  : 'pm-badge pm-badge-client',
        'Bought by Company' : 'pm-badge pm-badge-company',
    };
    const rowClass = {
        'Pending'           : 'pl-row-pending',
        'Assigned to Client': 'pl-row-assigned-client',
        'Assigned to Admin' : 'pl-row-assigned-admin',
        'Bought by Client'  : 'pl-row-client',
        'Bought by Company' : 'pl-row-company',
    };

    tbody.innerHTML = items.map(it => {
        const badgeClass = statusBadgeClass[it.status] || 'pm-badge';
        const trClass    = rowClass[it.status] || '';
        const estFmt     = it.estPrice    ? cmFmt(it.estPrice)    : '—';
        const actFmt     = it.actualAmount ? cmFmt(it.actualAmount) : '—';
        const buyerLabel = it.boughtBy === 'client'       ? 'You'
                         : it.boughtBy === 'company'      ? 'Company'
                         : it.status === 'Assigned to Client' ? '<span style="color:#1d4ed8;font-weight:600;">You</span>'
                         : it.status === 'Assigned to Admin'  ? '<span style="color:#6d28d9;font-weight:600;">Admin</span>'
                         : '—';

        const receiptBtn = it.receiptUrl
            ? `<button class="pl-action-btn pl-btn-view-receipt" onclick="plViewReceipt('${cmEsc(it.receiptUrl)}','${cmEsc(it.item)}')">
                 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                 View
               </button>`
            : '<span style="color:#d1d5db;font-size:13px;">—</span>';

        const itJson = JSON.stringify(it).replace(/'/g, "&#39;");
        const actionBtn = it.status === 'Pending'
            ? `<button class="pl-action-btn pl-btn-decide" onclick="plOpenDecisionModal(${itJson})">
                 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                 Decide
               </button>`
            : it.status === 'Assigned to Client'
            ? `<button class="pl-submit-receipt-btn" onclick="plOpenBuyModal(${itJson})">
                 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="21 15 21 19 3 19 3 15"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                 Submit Receipt
               </button>`
            : it.status === 'Assigned to Admin'
            ? `<span class="pl-assigned-admin-note">Admin will handle</span>`
            : `<span class="pl-done-label">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                 Done
               </span>`;

        return `<tr class="${trClass}">
            <td><strong>${cmEsc(it.item || '—')}</strong></td>
            <td style="color:#6b7280;">${cmEsc(it.qty || '—')}</td>
            <td>${estFmt}</td>
            <td><span class="${badgeClass}">${cmEsc(it.status || '—')}</span></td>
            <td style="font-weight:600;">${actFmt}</td>
            <td>${buyerLabel}</td>
            <td>${receiptBtn}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }).join('');
}

window.filterProcurementList = function() {
    const q = (document.getElementById('pl-search')?.value || '').toLowerCase();
    const filtered = _plItems.filter(i => (i.item || '').toLowerCase().includes(q));
    plRenderTable(filtered);
};

// ── Mark as Bought Modal ──────────────────────────────────────────
window.plOpenBuyModal = function(item) {
    _plBuyItemData = item;
    _plReceiptFile = null;
    document.getElementById('plBuyItemId').value   = item.id;
    document.getElementById('plBuyItemName').textContent = item.item || '—';
    document.getElementById('plBuyItemQty').textContent  = item.qty  || '—';
    document.getElementById('plBuyItemEst').textContent  = item.estPrice ? cmFmt(item.estPrice) : '—';
    document.getElementById('plBuyAmount').value   = '';
    document.getElementById('plBuyNotes').value    = '';
    document.getElementById('plReceiptPreview').style.display = 'none';
    document.getElementById('plReceiptPreview').innerHTML = '';
    document.getElementById('plReceiptFile').value = '';
    ['err-plBuyAmount','err-plReceipt'].forEach(cmClear);
    document.getElementById('plBuyModal').style.display = 'flex';
};

window.plCloseBuyModal = function() {
    document.getElementById('plBuyModal').style.display = 'none';
    _plBuyItemData = null;
    _plReceiptFile = null;
};

window.plPreviewReceipt = function(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    _plReceiptFile = file;
    const preview = document.getElementById('plReceiptPreview');
    preview.style.display = '';
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = e => {
            preview.innerHTML = `<img src="${e.target.result}" alt="receipt preview" style="max-width:100%;max-height:200px;border-radius:10px;border:1.5px solid #e5e7eb;display:block;"/>`;
        };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = `<div class="pm-receipt-file-chip">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            ${cmEsc(file.name)}
        </div>`;
    }
    cmClear('err-plReceipt');
};

window.plHandleReceiptDrop = function(event) {
    event.preventDefault();
    document.getElementById('plReceiptUploadWrap').style.borderColor = '#d1d5db';
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('plReceiptFile').files = dt.files;
    plPreviewReceipt({ target: { files: [file] } });
};

window.plSubmitBought = async function() {
    const amount = parseFloat(document.getElementById('plBuyAmount').value);
    let valid = true;

    cmClear('err-plBuyAmount');
    cmClear('err-plReceipt');

    if (!amount || amount <= 0) { cmErr('err-plBuyAmount', 'Please enter the actual amount paid.'); valid = false; }
    if (!_plReceiptFile)        { cmErr('err-plReceipt',   'Please upload your proof of receipt.'); valid = false; }
    if (!valid) return;

    const btn = document.getElementById('plBuySubmitBtn');
    btn.disabled = true; btn.textContent = 'Submitting…';

    try {
        const itemId = document.getElementById('plBuyItemId').value;
        const notes  = document.getElementById('plBuyNotes').value.trim();
        let receiptUrl = null;

        // Upload receipt to Firebase Storage
        if (_plReceiptFile && cmCurrentUser) {
            const ext  = _plReceiptFile.name.split('.').pop();
            const path = `procurementReceipts/${cmProjectData.id}/${itemId}_client_${Date.now()}.${ext}`;
            const ref  = firebase.storage().ref(path);
            await ref.put(_plReceiptFile);
            receiptUrl = await ref.getDownloadURL();
        }

        const updateData = {
            status      : 'Bought by Client',
            boughtBy    : 'client',
            actualAmount: amount,
            receiptUrl  : receiptUrl,
            notes       : notes,
            boughtAt    : firebase.firestore.FieldValue.serverTimestamp(),
            boughtByUid : cmCurrentUser.uid
        };

        await db.collection('constructionProjects')
            .doc(cmProjectData.id)
            .collection('procurementList')
            .doc(itemId)
            .update(updateData);

        // Update local state
        const idx = _plItems.findIndex(i => i.id === itemId);
        if (idx !== -1) Object.assign(_plItems[idx], { ...updateData, status: 'Bought by Client' });

        plRenderTable(_plItems);
        plUpdateSummary(_plItems);
        plCloseBuyModal();
        cmShowToast('Item marked as bought successfully.');
    } catch (err) {
        console.error('plSubmitBought:', err);
        cmShowToast('Error submitting. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Confirm Purchase';
    }
};

// ── Receipt Viewer ────────────────────────────────────────────────
window.plViewReceipt = function(url, itemName) {
    document.getElementById('plReceiptViewTitle').textContent = 'Receipt — ' + itemName;
    const img = document.getElementById('plReceiptViewImg');
    const pdf = document.getElementById('plReceiptViewPdf');
    if (url.toLowerCase().includes('.pdf') || url.startsWith('data:application/pdf')) {
        img.style.display = 'none';
        pdf.src = url; pdf.style.display = '';
    } else {
        pdf.style.display = 'none';
        img.src = url; img.style.display = '';
    }
    document.getElementById('plReceiptViewModal').style.display = 'flex';
};

window.plCloseReceiptView = function() {
    document.getElementById('plReceiptViewModal').style.display = 'none';
    document.getElementById('plReceiptViewImg').src = '';
    document.getElementById('plReceiptViewPdf').src = '';
};

// ══════════════════════════════════════════════════════════════════
// PROCUREMENT — DECISION MODAL (Client accepts or declines item)
// ══════════════════════════════════════════════════════════════════

let _plDecisionItem = null;

window.plOpenDecisionModal = function(item) {
    _plDecisionItem = item;
    document.getElementById('plDecItemName').textContent  = item.item || '—';
    document.getElementById('plDecItemQty').textContent   = item.qty  || '—';
    document.getElementById('plDecItemEst').textContent   = item.estPrice ? cmFmt(item.estPrice) : '—';
    const notesEl = document.getElementById('plDecItemNotes');
    if (notesEl) notesEl.textContent = item.notes || '';
    const btn1 = document.getElementById('plDecAcceptBtn');
    const btn2 = document.getElementById('plDecDeclineBtn');
    if (btn1) { btn1.disabled = false; btn1.innerHTML = '<div class="pl-decision-option-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></div><div class="pl-decision-option-text"><div class="pl-decision-option-title">I\'ll Purchase This</div><div class="pl-decision-option-sub">You agree to buy this item and submit the receipt</div></div>'; }
    if (btn2) { btn2.disabled = false; btn2.innerHTML = '<div class="pl-decision-option-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg></div><div class="pl-decision-option-text"><div class="pl-decision-option-title">Admin Will Handle</div><div class="pl-decision-option-sub">The company/admin will purchase this item instead</div></div>'; }
    document.getElementById('plDecisionModal').style.display = 'flex';
};

window.plCloseDecisionModal = function() {
    document.getElementById('plDecisionModal').style.display = 'none';
    _plDecisionItem = null;
};

window.plClientAcceptItem = async function() {
    if (!_plDecisionItem) return;
    const item = _plDecisionItem;
    const btn  = document.getElementById('plDecAcceptBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

    try {
        await db.collection('constructionProjects')
            .doc(cmProjectData.id)
            .collection('procurementList')
            .doc(item.id)
            .update({
                status       : 'Assigned to Client',
                assignedTo   : 'client',
                assignedAt   : firebase.firestore.FieldValue.serverTimestamp(),
                assignedByUid: cmCurrentUser.uid
            });
        const idx = _plItems.findIndex(i => i.id === item.id);
        if (idx !== -1) Object.assign(_plItems[idx], { status: 'Assigned to Client', assignedTo: 'client' });
        plCloseDecisionModal();
        plRenderTable(_plItems);
        plUpdateSummary(_plItems);
        cmShowToast('You\'ve accepted to purchase this item. Submit your receipt when done.');
    } catch (err) {
        console.error('plClientAcceptItem:', err);
        cmShowToast('Error updating item. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'I\'ll Purchase This'; }
    }
};

window.plClientDeclineItem = async function() {
    if (!_plDecisionItem) return;
    const item = _plDecisionItem;
    const btn  = document.getElementById('plDecDeclineBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

    try {
        await db.collection('constructionProjects')
            .doc(cmProjectData.id)
            .collection('procurementList')
            .doc(item.id)
            .update({
                status    : 'Assigned to Admin',
                assignedTo: 'admin',
                assignedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        const idx = _plItems.findIndex(i => i.id === item.id);
        if (idx !== -1) Object.assign(_plItems[idx], { status: 'Assigned to Admin', assignedTo: 'admin' });
        plCloseDecisionModal();
        plRenderTable(_plItems);
        plUpdateSummary(_plItems);
        cmShowToast('Item left for the admin to handle.');
    } catch (err) {
        console.error('plClientDeclineItem:', err);
        cmShowToast('Error updating item. Please try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'Admin Will Handle'; }
    }
};

// ══════════════════════════════════════════════════════════════════
// WEEKLY BILLING — FILTER BY WEEK
// ══════════════════════════════════════════════════════════════════

window.filterWeeklyBills = function() {
    const sel   = document.getElementById('wb-week-filter');
    const week  = sel ? sel.value : '';
    const bills = week ? cmWeeklyBills.filter(b => b.weekEndingDate === week) : cmWeeklyBills;

    const tbody = document.getElementById('wb-tbody');
    if (!tbody) return;
    if (!bills.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No entries for the selected week.</td></tr>';
        return;
    }

    const statusStyles = {
        Paid:      { bg: '#dcfce7', color: '#15803d' },
        Submitted: { bg: '#dbeafe', color: '#1d4ed8' },
        Overdue:   { bg: '#fee2e2', color: '#dc2626' }
    };
    tbody.innerHTML = bills.map((b, i) => {
        const ss        = statusStyles[b.status] || { bg: '#f3f4f6', color: '#6b7280' };
        const labor     = b.labor       || 0;
        const materials = b.materials   || 0;
        const otherCosts= (b.delivery||0) + (b.consumables||0) + (b.other||0);
        const directTotal = b.directCostTotal || (labor + materials + otherCosts);
        const mgmtFee   = b.managementFee    || (directTotal * (b.managementFeeRate || 0.15));
        const totalDue  = b.totalDue          || (directTotal + mgmtFee);
        return `<tr>
            <td><strong>${cmEsc(b.weekEndingDate || '—')}</strong><div style="font-size:11px;color:#9ca3af;">Week ${bills.length - i}</div></td>
            <td>${cmFmt(labor)}</td>
            <td>${cmFmt(materials)}</td>
            <td>${cmFmt(otherCosts)}</td>
            <td><strong>${cmFmt(directTotal)}</strong></td>
            <td style="color:#7c3aed;font-weight:600;">${cmFmt(mgmtFee)}</td>
            <td><strong style="font-size:15px;">${cmFmt(totalDue)}</strong></td>
            <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${ss.bg};color:${ss.color};">${cmEsc(b.status)}</span></td>
            <td><button onclick="openWBDetail(${JSON.stringify(b).replace(/'/g,'&#39;')})" style="padding:5px 12px;border-radius:7px;border:1.5px solid #d1fae5;background:#f0fdf4;color:#059669;font-size:12px;font-weight:600;cursor:pointer;">View</button></td>
        </tr>`;
    }).join('');
};

// ══════════════════════════════════════════════════════════════════
// WEEKLY BILLING — PRINT REPORT
// ══════════════════════════════════════════════════════════════════

window.printWeeklyReport = function() {
    const proj        = cmProjectData;
    const weekFilter  = document.getElementById('wb-week-filter');
    const filterWeek  = weekFilter ? weekFilter.value : '';
    const bills       = filterWeek ? cmWeeklyBills.filter(b => b.weekEndingDate === filterWeek) : cmWeeklyBills;

    const clientName  = ((cmCurrentProfile?.firstName || '') + ' ' + (cmCurrentProfile?.lastName || '')).trim() || '—';
    const projectName = proj?.projectName || 'Construction Project';
    const address     = proj?.location || proj?.address || '—';
    const startDate   = proj?.startDate || '—';
    const today       = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    const reportScope = filterWeek ? ('Week ending ' + filterWeek) : 'All Weeks';

    const fmt = n => '&#8369;' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const totalBilled   = bills.reduce((s, b) => s + (b.totalDue       || 0), 0);
    const totalPaid     = bills.filter(b => b.status === 'Paid').reduce((s, b) => s + (b.totalDue || 0), 0);
    const outstanding   = totalBilled - totalPaid;
    const totalFees     = bills.reduce((s, b) => s + (b.managementFee  || 0), 0);

    const statusColor = s => s === 'Paid' ? '#15803d' : s === 'Overdue' ? '#dc2626' : '#1d4ed8';
    const statusBg    = s => s === 'Paid' ? '#dcfce7' : s === 'Overdue' ? '#fee2e2' : '#dbeafe';

    const rows = bills.map((b, i) => {
        const labor     = b.labor       || 0;
        const materials = b.materials   || 0;
        const other     = (b.delivery||0) + (b.consumables||0) + (b.other||0);
        const direct    = b.directCostTotal  || (labor + materials + other);
        const fee       = b.managementFee    || (direct * (b.managementFeeRate || 0.15));
        const total     = b.totalDue          || (direct + fee);
        const status    = b.status || '—';
        const sc        = statusColor(status);
        const sb        = statusBg(status);
        const weekLabel = 'Week ' + (bills.length - i);
        return `<tr style="border-bottom:1px solid #f1f5f9;${i % 2 === 1 ? 'background:#f9fafb;' : ''}">
          <td style="padding:10px 12px;"><strong>${b.weekEndingDate || '—'}</strong><br><span style="font-size:11px;color:#9ca3af;">${weekLabel}</span></td>
          <td style="padding:10px 12px;text-align:right;">${fmt(labor)}</td>
          <td style="padding:10px 12px;text-align:right;">${fmt(materials)}</td>
          <td style="padding:10px 12px;text-align:right;">${fmt(other)}</td>
          <td style="padding:10px 12px;text-align:right;font-weight:600;">${fmt(direct)}</td>
          <td style="padding:10px 12px;text-align:right;color:#6d28d9;font-weight:600;">${fmt(fee)}</td>
          <td style="padding:10px 12px;text-align:right;font-weight:700;font-size:15px;">${fmt(total)}</td>
          <td style="padding:10px 12px;text-align:center;"><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${sb};color:${sc};">${status}</span></td>
        </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Weekly Billing Report — ${projectName}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; color:#1f2937; background:#fff; padding:32px; font-size:13px; }
    .report-meta { font-size:12px; color:#6b7280; line-height:1.7; text-align:right; }
    .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:16px 20px; margin-bottom:22px; }
    .info-item .label { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#6b7280; }
    .info-item .value { font-size:13.5px; font-weight:600; color:#1f2937; margin-top:2px; }
    .summary-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
    .sum-card { border-radius:10px; padding:14px 16px; text-align:center; }
    .sum-label { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:#6b7280; margin-bottom:6px; }
    .sum-value { font-size:18px; font-weight:700; }
    .sum-green { background:#f0fdf4; border:1px solid #bbf7d0; }
    .sum-green .sum-value { color:#15803d; }
    .sum-blue  { background:#eff6ff; border:1px solid #bfdbfe; }
    .sum-blue  .sum-value { color:#1d4ed8; }
    .sum-amber { background:#fffbeb; border:1px solid #fde68a; }
    .sum-amber .sum-value { color:#b45309; }
    .sum-purple{ background:#f5f3ff; border:1px solid #ddd6fe; }
    .sum-purple .sum-value { color:#6d28d9; }
    table { width:100%; border-collapse:collapse; margin-bottom:24px; }
    thead th { background:#1a5c3a; color:#fff; padding:10px 12px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
    thead th:not(:first-child) { text-align:right; }
    .no-data { text-align:center; padding:48px; color:#9ca3af; font-size:14px; border:1px solid #e5e7eb; border-radius:10px; }
    .footer { border-top:1px solid #e5e7eb; padding-top:14px; display:flex; justify-content:space-between; font-size:11px; color:#9ca3af; margin-top:8px; }
    @media print { body { padding:16px; } .sum-card, table { page-break-inside: avoid; } tr { page-break-inside: avoid; } }
  </style>
</head>
<body>
  ${window.dacsPrintHeader('Weekly Billing Report', `Generated: ${today}<br>Scope: ${reportScope}`)}

  <div class="info-grid">
    <div class="info-item"><div class="label">Client Name</div><div class="value">${clientName}</div></div>
    <div class="info-item"><div class="label">Project Name</div><div class="value">${projectName}</div></div>
    <div class="info-item"><div class="label">Project Address</div><div class="value">${address}</div></div>
    <div class="info-item"><div class="label">Start Date</div><div class="value">${startDate}</div></div>
    <div class="info-item"><div class="label">Billing Model</div><div class="value">Cost-Plus — Direct Costs + 15% Management Fee</div></div>
    <div class="info-item"><div class="label">Total Weeks</div><div class="value">${bills.length} week(s)</div></div>
  </div>

  <div class="summary-row">
    <div class="sum-card sum-green"><div class="sum-label">Total Billed</div><div class="sum-value">${fmt(totalBilled)}</div></div>
    <div class="sum-card sum-blue"><div class="sum-label">Total Paid</div><div class="sum-value">${fmt(totalPaid)}</div></div>
    <div class="sum-card sum-amber"><div class="sum-label">Outstanding</div><div class="sum-value">${fmt(outstanding)}</div></div>
    <div class="sum-card sum-purple"><div class="sum-label">Mgmt Fees (15%)</div><div class="sum-value">${fmt(totalFees)}</div></div>
  </div>

  ${bills.length ? `
  <table>
    <thead>
      <tr>
        <th>Week Ending</th>
        <th style="text-align:right;">Labor</th>
        <th style="text-align:right;">Materials</th>
        <th style="text-align:right;">Other</th>
        <th style="text-align:right;">Direct Total</th>
        <th style="text-align:right;">Mgmt Fee (15%)</th>
        <th style="text-align:right;">Total Due</th>
        <th style="text-align:center;">Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>` : '<div class="no-data">No billing records for the selected period.</div>'}

  <div class="footer">
    <div>DAC's Building Design Services &mdash; Confidential Client Billing Report</div>
    <div>Printed: ${today}</div>
  </div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=1050,height=720');
    if (!win) { cmShowToast('Please allow pop-ups to print the report.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(function() { win.focus(); win.print(); }, 600);
};

// ══════════════════════════════════════════════════════════════════
// KPI FINANCIAL DASHBOARD
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// KPI PERFORMANCE INDICATORS
// ══════════════════════════════════════════════════════════════════

function cmComputeKPIs() {
    const budget       = Number(cmProjectData?.budget) || 0;
    const totalExpenses= cmWeeklyBills.reduce((s, b) => s + (b.totalDue || 0), 0);

    // 1. Project Completion Rate
    const totalMs     = cmMilestones.length;
    const completedMs = cmMilestones.filter(m => m.status === 'completed').length;
    const completionRate = totalMs > 0 ? Math.round((completedMs / totalMs) * 100) : null;

    // 2. Budget Utilization Rate
    const budgetUtilization = budget > 0 ? Math.round((totalExpenses / budget) * 100) : null;

    // 3. Schedule Performance Indicator
    const approvedReports = cmAccomplishmentReports
        .filter(r => r.status === 'approved' && r.progressPercentage != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const actualProgress  = approvedReports[0]?.progressPercentage ?? 0;
    const plannedProgress = cmEstimatePlannedProgress();
    const spi = plannedProgress > 0 ? Math.round((actualProgress / plannedProgress) * 100) : null;

    // 4. Cost Variance
    const costVariance = budget > 0 ? budget - totalExpenses : null;

    // 5. Weekly Progress Growth
    const weeklyGrowth = approvedReports.length >= 2
        ? approvedReports[0].progressPercentage - approvedReports[1].progressPercentage
        : null;

    return { completionRate, budgetUtilization, spi, costVariance, weeklyGrowth,
             actualProgress, plannedProgress, totalExpenses, budget, totalMs, completedMs };
}

function cmEstimatePlannedProgress() {
    if (!cmProjectData?.startDate) return 0;
    const today = new Date();
    const start = new Date(cmProjectData.startDate);
    const endStr = cmProjectData.plannedEndDate ||
        ([...cmMilestones].sort((a, b) => (b.plannedDate || '').localeCompare(a.plannedDate || ''))[0]?.plannedDate);
    if (!endStr) return 0;
    const end = new Date(endStr);
    if (end <= start) return 0;
    return Math.min(Math.round(Math.max((today - start) / (end - start), 0) * 100), 100);
}

function cmRenderKPIPerformance() {
    const section = document.getElementById('kpi-perf-section');
    if (!section) return;
    if (!cmProjectData) { section.style.display = 'none'; return; }
    section.style.display = '';

    const k  = cmComputeKPIs();
    const grid   = document.getElementById('kpi-perf-grid');
    const alerts = document.getElementById('kpi-perf-alerts');
    if (!grid) return;

    const dark = document.body.classList.contains('dark-mode');
    const SC = dark ? {
        // Eye-friendly dark mode — muted, not neon; values must contrast against #1e2822
        green:   { dot:'#4db87e', bg:'rgba(77,184,126,0.10)',  border:'rgba(77,184,126,0.22)',  val:'#5cbf88' },
        yellow:  { dot:'#c89840', bg:'rgba(200,152,64,0.10)',  border:'rgba(200,152,64,0.22)',  val:'#d4aa4c' },
        red:     { dot:'#c06868', bg:'rgba(192,104,104,0.10)', border:'rgba(192,104,104,0.22)', val:'#c97878' },
        neutral: { dot:'#5e7870', bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.08)', val:'#7d9a8c' }
    } : {
        // Light mode — standard vivid status colors
        green:   { dot:'#16a34a', bg:'#f0fdf4', border:'#a7f3d0', val:'#15803d' },
        yellow:  { dot:'#d97706', bg:'#fffbeb', border:'#fcd34d', val:'#b45309' },
        red:     { dot:'#dc2626', bg:'#fef2f2', border:'#fecaca', val:'#b91c1c' },
        neutral: { dot:'#9ca3af', bg:'#f9fafb', border:'#e5e7eb', val:'#374151' }
    };

    const cards = [
        {
            label  : 'Project Completion Rate',
            formula: '(Completed Milestones ÷ Total) × 100',
            value  : k.completionRate != null ? k.completionRate + '%' : '—',
            sub    : k.completionRate != null ? k.completedMs + ' of ' + k.totalMs + ' milestones done' : 'No milestones defined',
            status : k.completionRate == null ? 'neutral' : k.completionRate >= 80 ? 'green' : k.completionRate >= 40 ? 'yellow' : 'red',
            icon   : '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'
        },
        {
            label  : 'Budget Utilization Rate',
            formula: '(Total Expenses ÷ Budget) × 100',
            value  : k.budgetUtilization != null ? k.budgetUtilization + '%' : '—',
            sub    : k.budgetUtilization != null ? cmFmt(k.totalExpenses) + ' spent of ' + cmFmt(k.budget) : 'Budget not set on project',
            status : k.budgetUtilization == null ? 'neutral' : k.budgetUtilization <= 85 ? 'green' : k.budgetUtilization <= 100 ? 'yellow' : 'red',
            icon   : '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
        },
        {
            label  : 'Schedule Performance Indicator',
            formula: '(Actual Progress ÷ Planned Progress) × 100',
            value  : k.spi != null ? k.spi + '%' : '—',
            sub    : k.spi != null ? k.actualProgress + '% actual vs ' + k.plannedProgress + '% planned' : 'Need approved reports',
            status : k.spi == null ? 'neutral' : k.spi >= 90 ? 'green' : k.spi >= 70 ? 'yellow' : 'red',
            icon   : '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'
        },
        {
            label  : 'Cost Variance',
            formula: 'Budget − Actual Cost',
            value  : k.costVariance != null ? cmFmt(Math.abs(k.costVariance)) : '—',
            sub    : k.costVariance != null ? (k.costVariance >= 0 ? 'Under budget ✓' : 'Over budget') : 'Budget not set on project',
            status : k.costVariance == null ? 'neutral' : k.costVariance >= 0 ? 'green' : 'red',
            icon   : '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'
        },
        {
            label  : 'Weekly Progress Growth',
            formula: 'Current Progress − Previous Progress',
            value  : k.weeklyGrowth != null ? (k.weeklyGrowth >= 0 ? '+' : '') + k.weeklyGrowth + '%' : '—',
            sub    : k.weeklyGrowth != null ? 'Change since last approved report' : 'Need ≥ 2 approved reports',
            status : k.weeklyGrowth == null ? 'neutral' : k.weeklyGrowth > 0 ? 'green' : k.weeklyGrowth === 0 ? 'yellow' : 'red',
            icon   : '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
        }
    ];

    grid.innerHTML = cards.map(c => {
        const sc = SC[c.status];
        return `<div class="kpi-perf-card" style="background:${sc.bg};border:1.5px solid ${sc.border};">
            <div class="kpi-perf-card-top">
                <div class="kpi-perf-icon-wrap">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
                </div>
                <span class="kpi-perf-dot" style="background:${sc.dot};" title="${c.status === 'green' ? 'On Track' : c.status === 'yellow' ? 'Warning' : c.status === 'red' ? 'Critical' : 'No Data'}"></span>
            </div>
            <div class="kpi-perf-value" style="color:${sc.val};">${cmEsc(c.value)}</div>
            <div class="kpi-perf-label">${cmEsc(c.label)}</div>
            <div class="kpi-perf-sub">${cmEsc(c.sub)}</div>
            <div class="kpi-perf-formula">${cmEsc(c.formula)}</div>
        </div>`;
    }).join('');

    // KPI Alerts
    const alertItems = [];
    if (k.budgetUtilization != null && k.budgetUtilization > 100)
        alertItems.push('💸 Budget Exceeded — Actual costs have surpassed the allocated project budget.');
    if (k.spi != null && k.spi < 70)
        alertItems.push('⚠️ Schedule Delay — Project is significantly behind the planned schedule (SPI < 70%).');
    if (k.weeklyGrowth === 0)
        alertItems.push('📊 No Progress Growth — No new progress recorded compared to the previous report.');
    if (k.completionRate != null && k.completionRate === 0 && k.totalMs > 0)
        alertItems.push('🚩 No Milestones Completed — Work has started but no milestone has been marked complete.');

    if (alerts) {
        if (alertItems.length) {
            alerts.style.display = '';
            alerts.innerHTML = `<div class="kpi-alert-box">
                <div class="kpi-alert-title">⚡ KPI Alerts</div>
                ${alertItems.map(a => `<div class="kpi-alert-item">${cmEsc(a)}</div>`).join('')}
            </div>`;
        } else {
            alerts.style.display = 'none';
        }
    }
}

function cmPopulateKPIDashboard() {
    const noData  = document.getElementById('kpi-no-data');
    const folder  = document.getElementById('kpi-project-folder');
    if (!cmProjectData) {
        if (noData)  noData.style.display  = '';
        if (folder)  folder.style.display  = 'none';
        return;
    }
    if (noData)  noData.style.display  = 'none';
    if (folder)  folder.style.display  = '';
    // Keep sidebar folder name in sync after project data loads
    const folderNameEl = document.getElementById('sidebar-folder-name');
    if (folderNameEl) folderNameEl.textContent = cmProjectData.projectName || 'My Project';
    cmRenderProjectFolderHeader();
    cmRenderCostChart();
    cmRenderFinancialKPIs();
    cmRenderWeeklyPreview();
}

// ── Project Folder Header ─────────────────────────────────────────
function cmRenderProjectFolderHeader() {
    const el = document.getElementById('pf-project-header');
    if (!el || !cmProjectData) return;
    const p = cmProjectData;
    const status = p.status || 'Active';
    const statusMap = {
        'Active':    { bg:'#dcfce7', color:'#15803d', dot:'#22c55e' },
        'Completed': { bg:'#dbeafe', color:'#1d4ed8', dot:'#3b82f6' },
        'On Hold':   { bg:'#fef3c7', color:'#b45309', dot:'#f59e0b' },
        'Cancelled': { bg:'#fee2e2', color:'#dc2626', dot:'#ef4444' }
    };
    const ss = statusMap[status] || statusMap['Active'];

    const fmtDate = s => s ? new Date(s).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' }) : '—';

    const coverSrc = p.coverImage || p.sitePhoto || p.photoURL || '';
    const iconHTML = coverSrc
        ? `<img src="${cmEsc(coverSrc)}" alt="Project photo"
               class="pf-header-cover-img"
               loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
           <div class="pf-header-icon-fallback" style="display:none;">
               <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
           </div>`
        : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

    el.innerHTML = `
        <div class="pf-header-top">
            <div class="pf-header-icon${coverSrc ? ' pf-header-icon--photo' : ''}">
                ${iconHTML}
            </div>
            <div class="pf-header-info">
                <div class="pf-header-name">${cmEsc(p.projectName || 'Construction Project')}</div>
                <div class="pf-header-meta">
                    ${p.location ? `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${cmEsc(p.location)}</span>` : ''}
                    ${p.startDate ? `<span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Started ${cmEsc(fmtDate(p.startDate))}</span>` : ''}
                    ${p.plannedEndDate ? `<span>Target: ${cmEsc(fmtDate(p.plannedEndDate))}</span>` : ''}
                </div>
            </div>
            <span class="pf-status-badge" style="background:${ss.bg};color:${ss.color};">
                <span style="width:7px;height:7px;border-radius:50%;background:${ss.dot};display:inline-block;flex-shrink:0;"></span>
                ${cmEsc(status)}
            </span>
        </div>
        ${p.id ? `<div class="pf-header-id">Project ID: ${cmEsc(p.id)}</div>` : ''}
    `;
}

// ── Cost Distribution Pie Chart ───────────────────────────────────
function cmRenderCostChart() {
    const el = document.getElementById('pf-cost-chart');
    if (!el || !cmProjectData) return;

    const totalMaterials = cmWeeklyBills.reduce((s, b) =>
        s + (b.materials || 0) + (b.delivery || 0) + (b.consumables || 0) + (b.other || 0), 0);
    const totalLabor = cmWeeklyBills.reduce((s, b) => s + (b.labor || 0), 0);
    const total      = totalMaterials + totalLabor;

    const cx = 80, cy = 80, r = 58, sw = 30;
    const circ = 2 * Math.PI * r;

    let segments = '';
    let centerHTML = '';

    if (total === 0) {
        segments = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
            stroke="rgba(255,255,255,0.10)" stroke-width="${sw}"/>`;
        centerHTML = `
            <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="rgba(255,255,255,0.35)"
                font-size="11" font-family="DM Sans,sans-serif">No data</text>
            <text x="${cx}" y="${cy + 9}" text-anchor="middle" fill="rgba(255,255,255,0.20)"
                font-size="10" font-family="DM Sans,sans-serif">yet</text>`;
    } else {
        const matPct   = totalMaterials / total;
        const labPct   = 1 - matPct;
        const matDash  = matPct * circ;
        const labDash  = labPct * circ;
        const matAngle = matPct * 360;

        if (matDash > 0) {
            segments += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#3b82f6"
                stroke-width="${sw}" stroke-dasharray="${matDash} ${circ}"
                stroke-dashoffset="0" transform="rotate(-90 ${cx} ${cy})"/>`;
        }
        if (labDash > 0) {
            segments += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#7c3aed"
                stroke-width="${sw}" stroke-dasharray="${labDash} ${circ}"
                stroke-dashoffset="0" transform="rotate(${-90 + matAngle} ${cx} ${cy})"/>`;
        }

        const pct = Math.round(matPct * 100);
        centerHTML = `
            <text x="${cx}" y="${cy - 9}" text-anchor="middle" fill="#fff"
                font-size="18" font-weight="700" font-family="DM Sans,sans-serif">${pct}%</text>
            <text x="${cx}" y="${cy + 9}" text-anchor="middle" fill="rgba(255,255,255,0.50)"
                font-size="10" font-family="DM Sans,sans-serif">Materials</text>`;
    }

    const matPct = total > 0 ? Math.round(totalMaterials / total * 100) : 0;
    const labPct = total > 0 ? 100 - matPct : 0;

    el.innerHTML = `
        <div class="pf-cost-chart-card">
            <div class="pf-chart-donut">
                <svg width="160" height="160" viewBox="0 0 160 160">
                    <!-- track -->
                    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
                        stroke="rgba(255,255,255,0.07)" stroke-width="${sw}"/>
                    ${segments}
                    ${centerHTML}
                </svg>
            </div>
            <div class="pf-chart-info">
                <div class="pf-chart-title">Cost Distribution</div>
                <div class="pf-chart-sub">Material vs. Labor breakdown</div>
                <div class="pf-chart-legend">
                    <div class="pf-chart-legend-row">
                        <span class="pf-chart-dot" style="background:#3b82f6;"></span>
                        <div class="pf-chart-legend-text">
                            <span class="pf-chart-legend-name">Material Costs</span>
                            <span class="pf-chart-legend-val">${cmFmt(totalMaterials)} <em>${matPct}%</em></span>
                        </div>
                    </div>
                    <div class="pf-chart-legend-row">
                        <span class="pf-chart-dot" style="background:#7c3aed;"></span>
                        <div class="pf-chart-legend-text">
                            <span class="pf-chart-legend-name">Labor Costs</span>
                            <span class="pf-chart-legend-val">${cmFmt(totalLabor)} <em>${labPct}%</em></span>
                        </div>
                    </div>
                    <div class="pf-chart-total-row">
                        <span class="pf-chart-legend-name">Total Expenses</span>
                        <span class="pf-chart-total-val">${cmFmt(total)}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ── Combined KPI Cards (Financial + Performance) ──────────────────
function cmRenderFinancialKPIs() {
    const grid = document.getElementById('pf-kpi-grid');
    if (!grid) return;

    // Financial data
    const totalMaterials = cmWeeklyBills.reduce((s, b) =>
        s + (b.materials || 0) + (b.delivery || 0) + (b.consumables || 0) + (b.other || 0), 0);
    const totalLabor    = cmWeeklyBills.reduce((s, b) => s + (b.labor || 0), 0);
    const totalExpenses = totalMaterials + totalLabor;
    const budget        = cmProjectData?.budget || 0;

    // Performance data
    const k = cmComputeKPIs();

    // Status → full card palette (explicit gradients, same approach as revolving fund cards)
    const PALETTE = {
        blue:    { color:'#1d4ed8', bgL:'linear-gradient(135deg,#eff6ff,#dbeafe)', bdL:'#bfdbfe', bgD:'linear-gradient(135deg,rgba(29,78,216,0.2),rgba(37,99,235,0.13))',   bdD:'rgba(147,197,253,0.22)' },
        purple:  { color:'#6d28d9', bgL:'linear-gradient(135deg,#faf5ff,#ede9fe)', bdL:'#ddd6fe', bgD:'linear-gradient(135deg,rgba(109,40,217,0.2),rgba(139,92,246,0.13))', bdD:'rgba(196,181,253,0.22)' },
        teal:    { color:'#0f766e', bgL:'linear-gradient(135deg,#f0fdfa,#ccfbf1)', bdL:'#99f6e4', bgD:'linear-gradient(135deg,rgba(15,118,110,0.2),rgba(20,184,166,0.13))', bdD:'rgba(94,234,212,0.22)' },
        green:   { color:'#15803d', bgL:'linear-gradient(135deg,#f0fdf4,#dcfce7)', bdL:'#bbf7d0', bgD:'linear-gradient(135deg,rgba(21,128,61,0.2),rgba(22,163,74,0.13))',   bdD:'rgba(34,197,94,0.22)'  },
        yellow:  { color:'#b45309', bgL:'linear-gradient(135deg,#fffbeb,#fef3c7)', bdL:'#fde68a', bgD:'linear-gradient(135deg,rgba(180,83,9,0.2),rgba(217,119,6,0.13))',    bdD:'rgba(253,230,138,0.22)' },
        red:     { color:'#b91c1c', bgL:'linear-gradient(135deg,#fef2f2,#fee2e2)', bdL:'#fecaca', bgD:'linear-gradient(135deg,rgba(185,28,28,0.2),rgba(220,38,38,0.13))',   bdD:'rgba(252,165,165,0.22)' },
        neutral: { color:'#6b7280', bgL:'#f9fafb',                                 bdL:'#e5e7eb', bgD:'rgba(75,85,99,0.15)',                                                bdD:'rgba(156,163,175,0.2)'  }
    };
    const sc = (status) => PALETTE[status] || PALETTE.neutral;

    const completionStatus = k.completionRate == null ? 'neutral' : k.completionRate >= 80 ? 'green' : k.completionRate >= 40 ? 'yellow' : 'red';
    const spiStatus        = k.spi == null           ? 'neutral' : k.spi >= 90              ? 'green' : k.spi >= 70              ? 'yellow' : 'red';
    const cvStatus         = k.costVariance == null  ? 'neutral' : k.costVariance >= 0       ? 'green' : 'red';
    const budgetStatus     = k.budgetUtilization == null ? 'neutral' : k.budgetUtilization <= 85 ? 'green' : k.budgetUtilization <= 100 ? 'yellow' : 'red';

    const kpis = [
        // ── Financial ──
        {
            label: 'Total Material Costs',
            value: cmFmt(totalMaterials),
            sub:   cmWeeklyBills.length + ' billing period(s)',
            ...PALETTE.blue,
            icon:  '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'
        },
        {
            label: 'Total Labor Costs',
            value: cmFmt(totalLabor),
            sub:   'Workers & site supervision',
            ...PALETTE.purple,
            icon:  '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
        },
        {
            label: 'Overall Project Expenses',
            value: cmFmt(totalExpenses),
            sub:   'Materials + Labor combined',
            ...PALETTE.teal,
            icon:  '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
        },
        {
            label: 'Budget Status',
            value: k.budgetUtilization != null ? k.budgetUtilization + '%' : '—',
            sub:   k.budgetUtilization == null ? 'Budget not set'
                 : k.budgetUtilization <= 85   ? 'Within Budget'
                 : k.budgetUtilization <= 100  ? 'Nearing Limit'
                 :                               'Budget Exceeded',
            ...sc(budgetStatus),
            icon:  '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>'
        },
        // ── Performance ──
        {
            label: 'Project Completion',
            value: k.completionRate != null ? k.completionRate + '%' : '—',
            sub:   k.completionRate != null ? k.completedMs + ' of ' + k.totalMs + ' milestones done' : 'No milestones defined',
            ...sc(completionStatus),
            icon:  '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'
        },
        {
            label: 'Schedule Performance',
            value: k.spi != null ? k.spi + '%' : '—',
            sub:   k.spi != null ? k.actualProgress + '% actual vs ' + k.plannedProgress + '% planned' : 'Need approved reports',
            ...sc(spiStatus),
            icon:  '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'
        },
        {
            label: 'Cost Variance',
            value: k.costVariance != null ? cmFmt(Math.abs(k.costVariance)) : '—',
            sub:   k.costVariance != null ? (k.costVariance >= 0 ? 'Under budget ✓' : 'Over budget') : 'Budget not set',
            ...sc(cvStatus),
            icon:  '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'
        }
    ];

    const isDark = document.body.classList.contains('dark-mode');

    grid.innerHTML = kpis.map(c => `
        <div class="pf-kpi-card" style="background:${isDark ? c.bgD : c.bgL};border:1.5px solid ${isDark ? c.bdD : c.bdL};">
            <div class="pf-kpi-icon" style="color:${c.color};background:${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.45)'};">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${c.icon}</svg>
            </div>
            <div class="pf-kpi-label" style="color:${c.color};">${cmEsc(c.label)}</div>
            <div class="pf-kpi-value" style="color:${isDark ? '#f0fdf4' : c.color};">${cmEsc(c.value)}</div>
            <div class="pf-kpi-sub" style="color:${isDark ? 'rgba(255,255,255,0.45)' : c.color};opacity:${isDark ? '1' : '0.65'};">${cmEsc(c.sub)}</div>
        </div>
    `).join('');

    // KPI Alerts
    const alertsEl  = document.getElementById('kpi-alerts-standalone');
    const alertItems = [];
    if (k.spi != null && k.spi < 70)
        alertItems.push('⚠️ Schedule Delay — Project is significantly behind the planned schedule (SPI < 70%).');
    if (k.completionRate != null && k.completionRate === 0 && k.totalMs > 0)
        alertItems.push('🚩 No Milestones Completed — Work has started but no milestone has been marked complete.');
    if (alertsEl) {
        if (alertItems.length) {
            alertsEl.style.display = '';
            alertsEl.innerHTML = `<div class="kpi-alert-box">
                <div class="kpi-alert-title">⚡ KPI Alerts</div>
                ${alertItems.map(a => `<div class="kpi-alert-item">${cmEsc(a)}</div>`).join('')}
            </div>`;
        } else {
            alertsEl.style.display = 'none';
        }
    }
}

// ── Category Folder Cards ─────────────────────────────────────────
function cmRenderFolderCards() {
    const grid = document.getElementById('pf-folder-grid');
    if (!grid) return;

    const overdueCount    = cmWeeklyBills.filter(b => b.status === 'Overdue').length;
    const unreadNotifs    = _cmFirestoreNotifs.filter(n => !n.read).length;
    const activeMs        = cmMilestones.filter(m => m.status === 'in_progress').length;
    const pendingReports  = cmAccomplishmentReports.filter(r => r.status === 'submitted').length;
    const approvedReports = cmAccomplishmentReports.filter(r => r.status === 'approved').length;

    const folders = [
        {
            id:     'accomplishment',
            label:  'Reports',
            sub:    approvedReports + ' approved report(s)',
            color:  '#059669',
            bg:     '#f0fdf4',
            border: '#a7f3d0',
            badge:  pendingReports || null,
            icon:   '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><polyline points="9 12 11 14 15 10"/>'
        },
        {
            id:     'billing',
            label:  'Payments',
            sub:    'Statement of account',
            color:  '#b45309',
            bg:     '#fffbeb',
            border: '#fde68a',
            badge:  overdueCount || null,
            icon:   '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>'
        },
        {
            id:     'procurement-list',
            label:  'Materials',
            sub:    'Procurement records',
            color:  '#1d4ed8',
            bg:     '#eff6ff',
            border: '#bfdbfe',
            badge:  null,
            icon:   '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>'
        },
        {
            id:     'weekly-billing',
            label:  'Labor & Billing',
            sub:    cmWeeklyBills.length + ' weekly record(s)',
            color:  '#6d28d9',
            bg:     '#faf5ff',
            border: '#ddd6fe',
            badge:  overdueCount || null,
            icon:   '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/>'
        },
        {
            id:     'milestones',
            label:  'Milestones',
            sub:    activeMs + ' in progress',
            color:  '#0891b2',
            bg:     '#ecfeff',
            border: '#a5f3fc',
            badge:  activeMs || null,
            icon:   '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>'
        },
        {
            id:     'notifications',
            label:  'Notifications',
            sub:    unreadNotifs + ' unread message(s)',
            color:  '#be185d',
            bg:     '#fdf2f8',
            border: '#fbcfe8',
            badge:  unreadNotifs || null,
            icon:   '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'
        }
    ];

    grid.innerHTML = folders.map(f => `
        <div class="pf-folder-card" onclick="showSection('${f.id}')" style="border-color:${f.border};">
            <div class="pf-folder-icon-wrap" style="background:${f.bg};color:${f.color};">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${f.icon}</svg>
            </div>
            ${f.badge ? `<span class="pf-folder-badge">${f.badge}</span>` : ''}
            <div class="pf-folder-label">${cmEsc(f.label)}</div>
            <div class="pf-folder-sub">${cmEsc(f.sub)}</div>
        </div>
    `).join('');
}

// ── Weekly Preview (last 4 weeks) ─────────────────────────────────
function cmRenderWeeklyPreview() {
    const el = document.getElementById('pf-weekly-preview');
    if (!el) return;

    const bills = cmWeeklyBills.slice(0, 4);
    if (!bills.length) {
        el.innerHTML = '<div style="padding:28px;text-align:center;color:#9ca3af;font-size:13.5px;">No weekly billing records yet.</div>';
        return;
    }

    const statusStyles = {
        Paid:      { bg:'#dcfce7', color:'#15803d' },
        Submitted: { bg:'#dbeafe', color:'#1d4ed8' },
        Overdue:   { bg:'#fee2e2', color:'#dc2626' }
    };

    el.innerHTML = `<div class="table-scroll"><table class="data-table">
        <thead><tr>
            <th>Week Ending</th>
            <th>Labor</th>
            <th>Materials</th>
            <th>Total Due</th>
            <th>Status</th>
        </tr></thead>
        <tbody>
            ${bills.map(b => {
                const ss = statusStyles[b.status] || { bg:'#f3f4f6', color:'#6b7280' };
                const matCost = (b.materials || 0) + (b.delivery || 0) + (b.consumables || 0) + (b.other || 0);
                return `<tr>
                    <td><strong>${cmEsc(b.weekEndingDate || '—')}</strong></td>
                    <td>${cmFmt(b.labor || 0)}</td>
                    <td>${cmFmt(matCost)}</td>
                    <td><strong>${cmFmt(b.totalDue || 0)}</strong></td>
                    <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${ss.bg};color:${ss.color};">${cmEsc(b.status)}</span></td>
                </tr>`;
            }).join('')}
        </tbody>
    </table></div>`;
}

// ══════════════════════════════════════════════════════════════════
// COST-PLUS AGREEMENT
// ══════════════════════════════════════════════════════════════════

function cmCheckAgreement() {
    const accepted = cmCurrentProfile?.agreementAccepted === true;
    if (accepted) {
        cmEnterDashboard();
    } else {
        const modal = document.getElementById('cm-agreement-modal');
        if (modal) modal.style.display = '';
    }
}

window.cmOpenMvpModal = function() {
    const el = document.getElementById('cm-mvp-modal');
    if (el) { el.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
};
window.cmCloseMvpModal = function() {
    const el = document.getElementById('cm-mvp-modal');
    if (el) { el.style.display = 'none'; document.body.style.overflow = ''; }
};

window.cmToggleAgreementBtn = function() {
    const cb  = document.getElementById('cm-agreement-checkbox');
    const btn = document.getElementById('cm-agreement-accept-btn');
    if (btn) btn.disabled = !(cb && cb.checked);
};

window.cmAcceptAgreement = async function() {
    const cb = document.getElementById('cm-agreement-checkbox');
    if (!cb?.checked) return;

    const btn = document.getElementById('cm-agreement-accept-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    let saveError = null;
    try {
        if (cmCurrentUser) {
            // Write to the SAME collection the agreement is read from on next
            // login (cmCurrentProfile is loaded from CM_COLLECTION =
            // 'constructionClientUsers'). The previous version wrote to
            // 'clientUsers', which is the design-portal collection — so the
            // acceptance never registered and the modal re-appeared every
            // session. user-navigator.js:714 also seeds the field here when
            // the construction client account is created.
            await db.collection(CM_COLLECTION).doc(cmCurrentUser.uid).update({
                agreementAccepted   : true,
                agreementAcceptedAt : firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        if (cmCurrentProfile) cmCurrentProfile.agreementAccepted = true;
    } catch (e) {
        saveError = e;
        console.warn('Agreement save error:', e.message);
    }

    if (saveError) {
        // Don't let the user past the modal if persistence failed — otherwise
        // they'll see it again next login and assume the system is broken.
        if (btn) { btn.disabled = false; btn.textContent = 'Accept Agreement'; }
        alert('Could not save your acceptance: ' + (saveError.message || saveError) + '\n\nPlease try again, or contact support if this persists.');
        return;
    }

    const modal = document.getElementById('cm-agreement-modal');
    if (modal) modal.style.display = 'none';
    cmEnterDashboard();
};

// ══════════════════════════════════════════════════════════════════
// TERMINATION REQUEST
// ══════════════════════════════════════════════════════════════════

window.cmOpenTerminationModal = function() {
    const totalLabor     = cmWeeklyBills.reduce((s, b) => s + (b.labor || 0), 0);
    const totalMaterials = cmWeeklyBills.reduce((s, b) =>
        s + (b.materials || 0) + (b.delivery || 0) + (b.consumables || 0) + (b.other || 0), 0);
    const directCosts    = totalLabor + totalMaterials;
    const mgmtFee        = directCosts * 0.15;
    const grandTotal     = directCosts + mgmtFee;
    const totalPaid      = cmWeeklyBills
        .filter(b => b.status === 'Paid')
        .reduce((s, b) => s + (b.totalDue || 0), 0);
    const remaining      = Math.max(0, grandTotal - totalPaid);

    const breakdown = document.getElementById('cm-term-cost-breakdown');
    if (breakdown) {
        breakdown.innerHTML = `
            <div class="cm-term-cost-row">
                <span class="cm-term-cost-label">Total Labor Costs</span>
                <span class="cm-term-cost-value">${cmFmt(totalLabor)}</span>
            </div>
            <div class="cm-term-cost-row">
                <span class="cm-term-cost-label">Total Materials &amp; Supplies</span>
                <span class="cm-term-cost-value">${cmFmt(totalMaterials)}</span>
            </div>
            <div class="cm-term-cost-row">
                <span class="cm-term-cost-label">Management Fee (15%)</span>
                <span class="cm-term-cost-value">${cmFmt(mgmtFee)}</span>
            </div>
            <div class="cm-term-cost-row">
                <span class="cm-term-cost-label">Total Already Paid</span>
                <span class="cm-term-cost-value" style="color:#15803d;">− ${cmFmt(totalPaid)}</span>
            </div>
            <div class="cm-term-total-row">
                <span class="cm-term-total-label">Final Balance Due</span>
                <span class="cm-term-total-value">${cmFmt(remaining)}</span>
            </div>`;
    }

    const modal = document.getElementById('cm-termination-modal');
    if (modal) modal.style.display = '';
};

window.cmCloseTerminationModal = function() {
    const modal = document.getElementById('cm-termination-modal');
    if (modal) modal.style.display = 'none';
};

window.cmConfirmTermination = async function() {
    const confirmBtn = document.querySelector('.cm-term-confirm-btn');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Submitting…'; }

    try {
        if (cmCurrentUser && cmProjectData) {
            const totalLabor     = cmWeeklyBills.reduce((s, b) => s + (b.labor || 0), 0);
            const totalMaterials = cmWeeklyBills.reduce((s, b) =>
                s + (b.materials || 0) + (b.delivery || 0) + (b.consumables || 0) + (b.other || 0), 0);
            const directCosts    = totalLabor + totalMaterials;
            const mgmtFee        = directCosts * 0.15;
            const grandTotal     = directCosts + mgmtFee;
            const totalPaid      = cmWeeklyBills
                .filter(b => b.status === 'Paid')
                .reduce((s, b) => s + (b.totalDue || 0), 0);

            const trRef = await db.collection('terminationRequests').add({
                clientUid        : cmCurrentUser.uid,
                clientEmail      : cmCurrentUser.email,
                clientName       : (cmCurrentProfile?.firstName || '') + ' ' + (cmCurrentProfile?.lastName || ''),
                projectId        : cmProjectData.id,
                projectName      : cmProjectData.projectName || '',
                totalLabor,
                totalMaterials,
                managementFee    : mgmtFee,
                grandTotal,
                totalPaid,
                remainingBalance : Math.max(0, grandTotal - totalPaid),
                status           : 'pending',
                requestedAt      : firebase.firestore.FieldValue.serverTimestamp()
            });

            // Notify admin via notification. `isRead` is canonical (last task)
            // and `relatedId` lets the admin bell jump straight to this request
            // in the Termination Requests review screen.
            const ownerUid = cmProjectData.userId || cmProjectData.ownerUid;
            if (ownerUid) {
                await cmNotifyOwnerAndStaff(ownerUid, {
                    title      : 'Termination Request',
                    message    : `Client ${cmCurrentUser.email} has requested project termination for "${cmProjectData.projectName || 'project'}".`,
                    type       : 'termination',
                    isRead     : false,
                    relatedId  : trRef.id,
                    createdAt  : firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }

        cmCloseTerminationModal();
        const statusEl  = document.getElementById('cm-term-status');
        const openBtn   = document.getElementById('cm-term-open-btn');
        if (statusEl) statusEl.style.display = '';
        if (openBtn)  openBtn.style.display  = 'none';
        cmShowToast('Termination request submitted. The admin will review and contact you.');

    } catch (e) {
        console.error('Termination request error:', e.message);
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Submit Request'; }
        cmShowToast('Failed to submit request. Please try again.');
    }
};
