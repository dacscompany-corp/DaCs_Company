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
let cmProjectData          = null;   // active construction project (the one being viewed)
let cmProjects             = [];     // ALL construction projects linked to this account (one account can own several)
let cmWeeklyBills          = [];
let cmPayRequests          = [];
let cmWeekSelId            = null;   // Weekly Summary: which week (Sunday key) is shown in the detail card (null = latest)
let cmProgressLogs         = [];
let cmRevolvingFund        = null;
let cmFundRequests         = [];    // weekly revolving-fund entries (admin collects from partner), keyed by weekStart (Sunday)
let cmMilestones           = [];
let cmAccomplishmentReports= [];
let cmRenderedReports      = [];   // current (possibly filtered) report list shown in the table
let _cmNotifUnsub          = null;
let _cmBillUnsub           = null;
let _cmNotifications       = [];
let _cmFirestoreNotifs     = [];
let cmSidebarOpen          = true;

const CM_COLLECTION = 'constructionClientUsers';

// ── Helpers ──────────────────────────────────────────────────────
// Portal audience: 'partner' = monitoring/viewing only (no 15% mgmt fee,
// no payments); 'client' = full (fee + payments). Set per-HTML-file via
// window.CM_PORTAL_MODE before this script loads; defaults to client.
function cmIsPartner() { return (typeof window !== 'undefined' && window.CM_PORTAL_MODE === 'partner'); }
// Project's management fee % (set by the admin, defaults to 15). Used for labels
// and as the fallback rate when a bill has no stored fee. cmFeeRate() = decimal form.
function cmFeePct() {
    const v = cmProjectData && cmProjectData.managementFeePct;
    return (v == null || v === '' || isNaN(v)) ? 15 : Number(v);
}
function cmFeeRate() { return cmFeePct() / 100; }
// A specific bill's effective fee % — derived from the bill itself (a snapshot),
// so it stays correct even if the project's rate changed after the bill was issued.
function cmBillPct(b) {
    if (!b) return cmFeePct();
    const direct = b.directCostTotal || ((b.labor||0) + (b.materials||0) + (b.delivery||0) + (b.consumables||0) + (b.other||0));
    const fee = b.managementFee != null ? b.managementFee
              : (b.managementFeeRate != null ? direct * b.managementFeeRate : direct * cmFeeRate());
    if (direct > 0) return Math.round(fee / direct * 100);
    if (b.managementFeeRate != null) return Math.round(b.managementFeeRate * 100);
    return cmFeePct();
}
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
            // Portal ↔ account-type enforcement: partner accounts (profiles.role =
            // 'partner') may only enter the Dacs Partnership portal; client accounts
            // only the Client Management portal. Each signs a DIFFERENT agreement, so
            // the person logging in must match the portal's document and money flow.
            const isPartnerAccount = (doc.data() && doc.data().role) === 'partner';
            if (cmIsPartner() !== isPartnerAccount) {
                await auth.signOut();
                cmCurrentUser = null; window.currentUser = null;
                cmShowLogin();
                cmShowLoginError(isPartnerAccount
                    ? 'This is a Partner account — please sign in at the DAC\'s Partnership portal instead.'
                    : 'This is a Client account — please sign in at the Client Management portal instead.');
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
        // In the PARTNER portal, flag this account as a partner in the DB (once) so
        // the per-project gate can be ENFORCED by RLS. Non-blocking + idempotent.
        if (cmIsPartner()) {
            try {
                await db.collection(CM_COLLECTION).doc(user.uid).update({ isPartner: true });
            } catch (e) { console.warn('is_partner flag set skipped:', e.message); }
        }
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
    document.getElementById('project-picker-page')?.classList.remove('active');
    document.getElementById('login-page').classList.add('active');
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    cmClearLoginErrors();
    switchToLogin();
    if (_cmBillUnsub)   { _cmBillUnsub();   _cmBillUnsub   = null; }
    if (_cmNotifUnsub)  { _cmNotifUnsub();  _cmNotifUnsub  = null; }
    cmCurrentUser = null; cmCurrentProfile = null; cmProjectData = null; cmProjects = [];
    cmWeeklyBills = []; cmPayRequests = []; cmWeekSelId = null; cmProgressLogs = []; cmMilestones = []; cmAccomplishmentReports = []; cmFundRequests = [];
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
        await auth.signInWithEmailAndPassword(email, pass);
        // onAuthStateChanged handles the rest
    } catch (err) {
        const el = document.getElementById('login-error');
        if (err.code === 'auth/captcha-failed')      el.textContent = 'Please complete the verification below and try again.';
        else if (err.code === 'auth/user-not-found')  el.textContent = 'No account found with that email.';
        else if (err.code === 'auth/wrong-password')  el.textContent = 'Wrong password. Please try again.';
        else if (err.code === 'auth/too-many-requests') el.textContent = 'Too many failed attempts. Please wait.';
        else if (err.code === 'auth/invalid-credential') el.textContent = 'Incorrect email or password. Please try again.';
        else                                          el.textContent = 'Incorrect email or password. Please try again.';
        if (el) el.classList.add('show');
        btn.disabled = false; btn.textContent = 'Sign In';
    }
};

// Pressing Enter in the email/password field submits the login. The fields aren't
// wrapped in a <form>, so there's no implicit submit — wire it up explicitly.
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (t && (t.id === 'login-email' || t.id === 'login-password')) {
        e.preventDefault();
        if (typeof doLogin === 'function') doLogin();
    }
});

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

// ── Load Project List ─────────────────────────────────────────────
// One account (clientEmail) can own SEVERAL construction projects. Load them
// all here; the picker / switcher decides which one becomes active. When there
// is exactly one we auto-select it so the single-project experience is unchanged.
async function cmLoadProjectData(user) {
    try {
        const emailLc = (user.email || '').toLowerCase();
        let docs;
        if (cmIsPartner()) {
            // Partner portal: projects link their partner via partnerEmail (migration
            // 0018). Legacy setups linked the partner through clientEmail (one shared
            // account) — keep that as a fallback and merge, so nothing disappears.
            const [pSnap, cSnap] = await Promise.all([
                db.collection('constructionProjects').where('partnerEmail', '==', emailLc).get()
                    .catch(() => ({ docs: [] })),   // column absent pre-migration → fallback still works
                db.collection('constructionProjects').where('clientEmail', '==', emailLc).get()
            ]);
            const seen = new Set();
            docs = [...pSnap.docs, ...cSnap.docs].filter(d => !seen.has(d.id) && seen.add(d.id));
        } else {
            const snap = await db.collection('constructionProjects')
                .where('clientEmail', '==', emailLc)
                .get();
            docs = snap.docs;
        }
        cmProjects = docs.map(d => ({ id: d.id, ...d.data() }));
        // Safety net for legacy projects saved with a mixed-case clientEmail /
        // partnerEmail (before emails were normalized): match case-insensitively.
        if (!cmProjects.length) {
            const all = await db.collection('constructionProjects').get();
            cmProjects = all.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(p => (p.clientEmail || '').toLowerCase() === emailLc
                          || (cmIsPartner() && (p.partnerEmail || '').toLowerCase() === emailLc));
        }
        // Newest first so the picker and default selection feel natural.
        cmProjects.sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? (a.createdAt ? new Date(a.createdAt).getTime() : 0);
            const tb = b.createdAt?.toMillis?.() ?? (b.createdAt ? new Date(b.createdAt).getTime() : 0);
            return tb - ta;
        });

        cmProjectData = null;
        // Auto-select when there's nothing to choose between (0 or 1 project).
        if (cmProjects.length === 1) {
            await cmLoadProjectDetails(cmProjects[0].id);
        } else {
            // No active project yet → keep owner UID/state clean until one is picked.
            window._clientOwnerUid = null;
        }
    } catch (err) {
        console.warn('CM project list load:', err.message);
        cmProjects = []; cmProjectData = null;
    }
}

// ── Load One Project's Data ───────────────────────────────────────
// Sets cmProjectData (active project) and loads all of its subcollections.
// Called when auto-selecting the only project, or when the user picks one in
// the project picker / switcher.
async function cmLoadProjectDetails(projectId) {
    // Reset per-project state so a switch never shows the previous project's data.
    cmWeeklyBills = []; cmPayRequests = []; cmWeekSelId = null;
    cmRevolvingFund = null; cmFundRequests = []; cmProgressLogs = [];
    cmMilestones = []; cmAccomplishmentReports = [];
    try {
        const local = cmProjects.find(p => p.id === projectId);
        if (local) {
            cmProjectData = local;
        } else {
            const doc = await db.collection('constructionProjects').doc(projectId).get();
            cmProjectData = doc.exists ? { id: doc.id, ...doc.data() } : null;
        }

        // Expose the owning admin UID so the shared client-payment.js can stamp
        // owner_id on self-initiated payments (else they're orphaned and no admin
        // sees them). Mirrors window._clientOwnerUid set by the cost-plus portal.
        window._clientOwnerUid = cmProjectData ? (cmProjectData.userId || cmProjectData.ownerUid || null) : null;

        if (cmProjectData) {
            // Load weekly bills. Read every bill (matching the admin overview, which
            // applies no status filter) so the direct-cost breakdown — including the
            // "Materials + labor" combined bucket — is identical to the admin's.
            // Genuine drafts (status 'Draft'/'draft') are still excluded client-side.
            const billSnap = await db.collection('constructionProjects')
                .doc(cmProjectData.id)
                .collection('weeklyBills')
                .get();
            cmWeeklyBills = billSnap.docs.map(d => {
                const data = { id: d.id, ...d.data() };
                if (!data.totalDue && data.grandTotal) data.totalDue = data.grandTotal;
                return data;
            }).filter(b => {
                const st = (b.status || '').toLowerCase();
                return st !== 'draft';
            }).sort((a, b) => {
                const ta = a.weekEndingDate?.toMillis?.() ?? (a.weekEndingDate ? new Date(a.weekEndingDate).getTime() : 0);
                const tb = b.weekEndingDate?.toMillis?.() ?? (b.weekEndingDate ? new Date(b.weekEndingDate).getTime() : 0);
                return tb - ta;
            });

            // Load this project's payment requests (for the Net cash KPI — paid to date).
            // Own try/catch so an RLS denial never aborts the rest of the dashboard.
            try {
                const prSnap = await db.collection('paymentRequests')
                    .where('constructionProjectId', '==', cmProjectData.id)
                    .get();
                cmPayRequests = prSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
                console.warn('Payment requests load (net cash):', e.message);
                cmPayRequests = [];
            }

            // Load revolving fund
            const rfSnap = await db.collection('constructionProjects')
                .doc(cmProjectData.id)
                .collection('revolvingFund')
                .limit(1)
                .get();
            cmRevolvingFund = rfSnap.empty ? null : rfSnap.docs[0].data();

            // Load the weekly revolving-fund entries (admin's fund-to-collect-from-partner,
            // one per week keyed by `weekStart` = the week's Sunday). Own try/catch so a
            // permissions error never aborts the rest of the dashboard.
            try {
                const fundSnap = await db.collection('constructionProjects')
                    .doc(cmProjectData.id)
                    .collection('revolvingFundRequests')
                    .get();
                cmFundRequests = fundSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) {
                console.warn('Weekly revolving fund load:', e.message);
                cmFundRequests = [];
            }

            // Load progress logs visible to client (own try/catch so a failure
            // here never aborts the milestone/report loads that follow)
            try {
                const logSnap = await db.collection('constructionProjects')
                    .doc(cmProjectData.id)
                    .collection('dailyLogs')
                    .where('visibleToClient', '==', true)
                    .orderBy('date', 'desc')
                    .limit(30)
                    .get();
                cmProgressLogs = logSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            } catch (e) { cmProgressLogs = []; }

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

// ── Routing after a successful login / agreement ─────────────────
// One account can own several projects. With more than one and none chosen
// yet, show the project picker; otherwise go straight into the dashboard.
async function cmRouteAfterLogin() {
    // NOTE: the global Terms & Conditions layer (settings/constructionClientTerms)
    // was removed 2026-07-03 — never configured in production. The binding
    // document is the Cost-Plus agreement signed in cmCheckAgreement.
    if (cmProjects.length > 1 && !cmProjectData) { cmShowProjectPicker(); return; }
    cmEnterDashboard();
}

// ── Project Picker (landing) ─────────────────────────────────────
// Built entirely in JS so both portal HTML files (client + partner) get it
// without edits. Shown after login when the account owns multiple projects,
// and reachable again from the topbar pill to switch projects.
// Markup imported from the claude_design project "Minimalist design
// enhancement" → Projects Picker.dc.html, variant 1A "Calm List".
function cmPickerInitials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'P';
}

function cmShowProjectPicker() {
    document.getElementById('login-page')?.classList.remove('active');
    document.getElementById('dashboard-page')?.classList.remove('active');

    // Fonts the design uses (Barlow for headings/numbers, DM Sans for body).
    if (!document.getElementById('cm-picker-fonts')) {
        const link = document.createElement('link');
        link.id = 'cm-picker-fonts';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap';
        document.head.appendChild(link);
    }

    let page = document.getElementById('project-picker-page');
    if (!page) {
        page = document.createElement('div');
        page.className = 'page';
        page.id = 'project-picker-page';
        document.body.appendChild(page);
    }
    page.style.cssText = "align-items:flex-start;justify-content:center;background:linear-gradient(rgba(255,255,255,.62),rgba(255,255,255,.62)),url('assets/images/background.jpg') center center / cover no-repeat fixed #f4f5f9;overflow:auto;font-family:'DM Sans',sans-serif;";

    const accent     = '#5b5bd6';
    const accentSoft = 'rgba(91,91,214,0.12)';
    const accentDeep = 'rgb(67,67,158)';   // _darken('#5b5bd6', 0.74) from the design
    const greeting   = cmEsc(cmCurrentProfile?.firstName
        || (cmProjects[0]?.clientName || '').split(/\s+/)[0]
        || 'there');
    const dateStr    = new Date().toLocaleDateString('en-PH', { weekday:'long', month:'long', day:'numeric' });
    const countLabel = cmProjects.length + (cmProjects.length === 1 ? ' active project' : ' active projects');

    const cards = cmProjects.map(cmRenderPickerCard).join('');

    page.innerHTML = `
      <div style="min-height:100vh;width:100%;display:flex;justify-content:center;padding:40px 40px 64px;">
        <div style="width:100%;max-width:1120px;">

          <div style="background:linear-gradient(135deg,${accent} 0%,${accentDeep} 100%);border-radius:22px;padding:34px 38px;color:#fff;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;box-shadow:0 22px 52px -30px rgba(31,41,80,.55);">
            <div>
              <div style="font-family:'Barlow',sans-serif;font-size:13px;font-weight:600;opacity:.82;">${cmEsc(dateStr)}</div>
              <div style="font-family:'Barlow',sans-serif;font-size:32px;font-weight:800;letter-spacing:-0.02em;line-height:1.1;margin-top:5px;">Welcome back, ${greeting}</div>
              <div style="font-size:15.5px;opacity:.9;margin-top:9px;max-width:440px;line-height:1.5;">Choose a project below to ${cmIsPartner() ? 'monitor its progress, budget, and updates' : 'check its progress, budget, and updates'}.</div>
            </div>
            <button type="button" onclick="doLogout()" style="background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);border-radius:12px;padding:11px 20px;font-size:13.5px;font-weight:600;color:#fff;cursor:pointer;font-family:inherit;white-space:nowrap;backdrop-filter:blur(4px);align-self:flex-start;"
                onmouseover="this.style.background='rgba(255,255,255,.26)';" onmouseout="this.style.background='rgba(255,255,255,.16)';">Sign out</button>
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:30px 4px 16px;">
            <div style="display:flex;align-items:baseline;gap:10px;">
              <span style="font-family:'Barlow',sans-serif;font-size:18px;font-weight:800;color:#1a1d24;letter-spacing:-0.01em;">Your projects</span>
              <span id="cm-picker-count" style="font-size:13.5px;font-weight:600;color:#9aa0b2;">${countLabel}</span>
            </div>
            <div style="position:relative;flex:0 1 320px;max-width:100%;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0b2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:14px;top:50%;transform:translateY(-50%);pointer-events:none;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="cm-picker-search" oninput="cmFilterProjects()" placeholder="Search projects…" autocomplete="off"
                style="width:100%;box-sizing:border-box;padding:11px 14px 11px 40px;border:1px solid #e7e9f2;border-radius:12px;font-size:14px;font-family:'DM Sans',sans-serif;color:#1a1d24;background:#fff;outline:none;box-shadow:0 1px 2px rgba(31,41,80,.04);"
                onfocus="this.style.borderColor='${accent}';" onblur="this.style.borderColor='#e7e9f2';">
            </div>
          </div>

          <div id="cm-picker-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:22px;">
            ${cards || '<div style="font-size:14px;color:#8b91a0;">No projects are linked to your account yet.</div>'}
          </div>

        </div>
      </div>`;

    page.classList.add('active');
}

// One project card for the picker grid (reused by the search filter).
function cmRenderPickerCard(p) {
    const accent     = '#5b5bd6';
    const accentSoft = 'rgba(91,91,214,0.12)';
    const name     = cmEsc(p.projectName || p.clientName || 'Project');
    const initials = cmEsc(cmPickerInitials(p.projectName || p.clientName));
    const location = cmEsc(p.location || p.address || p.clientName || '—');
    const status   = cmEsc(p.status || 'Active');
    const budget   = Number(p.budget) || 0;
    const budgetBlock = budget > 0 ? `
          <div>
            <div style="font-size:10.5px;font-weight:700;color:#aeb4c2;letter-spacing:.06em;text-transform:uppercase;">Project Budget</div>
            <div style="font-family:'Barlow',sans-serif;font-size:22px;font-weight:800;color:#1a1d24;margin-top:2px;">${cmFmt(budget)}</div>
          </div>` : '<div></div>';
    return `<div onclick="cmSelectProject('${p.id}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter')cmSelectProject('${p.id}')" style="background:#fff;border:1px solid #e7e9f2;border-radius:20px;padding:24px 24px 20px;cursor:pointer;transition:box-shadow .15s,transform .15s,border-color .15s;display:flex;flex-direction:column;"
            onmouseover="this.style.boxShadow='0 18px 40px -22px rgba(31,41,80,.48)';this.style.transform='translateY(-3px)';this.style.borderColor='#d6d9e8';"
            onmouseout="this.style.boxShadow='none';this.style.transform='none';this.style.borderColor='#e7e9f2';">
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px;">
          <span style="width:52px;height:52px;border-radius:15px;background:${accentSoft};color:${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'Barlow',sans-serif;font-weight:800;font-size:19px;">${initials}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-family:'Barlow',sans-serif;font-size:21px;font-weight:700;color:#1a1d24;letter-spacing:-0.01em;">${name}</div>
            <div style="display:inline-flex;align-items:center;gap:6px;font-size:14px;color:#8b91a0;margin-top:3px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              ${location}
            </div>
          </div>
          <span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:700;color:#16a34a;background:#e7f7ee;padding:3px 10px;border-radius:20px;"><span style="width:6px;height:6px;border-radius:50%;background:#16a34a;"></span>${status}</span>
        </div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:auto;padding-top:18px;border-top:1px solid #f0f1f5;">
          ${budgetBlock}
          <span style="display:inline-flex;align-items:center;gap:8px;background:${accent};color:#fff;border:none;border-radius:12px;padding:12px 20px;font-size:14.5px;font-weight:700;font-family:'Barlow',sans-serif;box-shadow:0 8px 20px -10px ${accent};white-space:nowrap;margin-left:auto;">
            Open project
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </span>
        </div>
    </div>`;
}

// Filter the picker cards by the search box (matches project name + location).
window.cmFilterProjects = function() {
    const q    = (document.getElementById('cm-picker-search')?.value || '').toLowerCase().trim();
    const grid = document.getElementById('cm-picker-grid');
    const cnt  = document.getElementById('cm-picker-count');
    if (!grid) return;
    const matched = cmProjects.filter(p => {
        if (!q) return true;
        const hay = [p.projectName, p.clientName, p.location, p.address, p.status]
            .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    });
    grid.innerHTML = matched.length
        ? matched.map(cmRenderPickerCard).join('')
        : '<div style="font-size:14px;color:#8b91a0;">No projects match “' + cmEsc(q) + '”.</div>';
    if (cnt) {
        cnt.textContent = q
            ? matched.length + ' of ' + cmProjects.length + ' shown'
            : cmProjects.length + (cmProjects.length === 1 ? ' active project' : ' active projects');
    }
};

window.cmSelectProject = async function(id) {
    await cmLoadProjectDetails(id);
    cmEnterDashboard();
};

// ── Enter Dashboard ──────────────────────────────────────────────
async function cmEnterDashboard() {
    // ── Per-project Terms & Conditions gate (CLIENTS only) ──
    // Before viewing a project's information, the client must sign THIS project's
    // Terms & Conditions when the admin attached a per-project PDF/terms and they
    // haven't accepted it yet. PARTNERS are exempt: their binding document is the
    // Partnership Agreement signed once at first login (profiles.partner_agreement_*,
    // gate in cmCheckAgreement) — the per-project sign-off was the OLD partner flow
    // and must not fire a second signature.
    if (!cmIsPartner() && cmProjectData && cmProjectData.id) {
        const hasProjTerms = !!((cmProjectData.partnerTermsPdfUrl && String(cmProjectData.partnerTermsPdfUrl).trim())
                              || (cmProjectData.partnerTerms && String(cmProjectData.partnerTerms).trim()));
        if (hasProjTerms) {
            let accepted = true;
            try { accepted = await cmPartnerHasAcceptedProject(cmProjectData.id); } catch (_) { accepted = true; }
            if (!accepted) { cmOpenProjectTerms(cmProjectData); return; }
        }
    }

    document.getElementById('login-page').classList.remove('active');
    document.getElementById('project-picker-page')?.classList.remove('active');
    document.getElementById('dashboard-page').classList.add('active');
    // Tag the body so partner-only CSS/JS can hide client-only bits (15% fee, payments).
    document.body.classList.toggle('cm-partner', cmIsPartner());

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

    // Topbar project switcher pill + date (redesign)
    cmSet('topbar-project-name', cmProjectData?.projectName || 'My Project');
    cmSet('topbar-date', new Date().toLocaleDateString('en-PH', { weekday:'long', month:'short', day:'numeric' }));

    // When the account owns several projects, make the topbar pill a switcher
    // back to the picker. With only one project it stays a plain label.
    const pill = document.querySelector('#dashboard-page .cm-project-pill');
    if (pill) {
        const multi = cmProjects.length > 1;
        pill.style.cursor = multi ? 'pointer' : '';
        pill.title = multi ? 'Switch project' : '';
        pill.onclick = multi ? function() { cmShowProjectPicker(); } : null;
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
            const partner = cmIsPartner();
            actList.innerHTML = cmWeeklyBills.slice(0, 5).map(b => {
                const statusColor = b.status === 'Paid' ? '#15803d' : b.status === 'Overdue' ? '#dc2626' : '#2563eb';
                const directTotal = b.directCostTotal || ((b.labor||0) + (b.materials||0) + (b.delivery||0) + (b.consumables||0) + (b.other||0));
                const subLabel = partner ? 'Labor + materials' : `Direct costs + ${cmBillPct(b)}% mgmt fee`;
                const amount   = partner ? directTotal : (b.totalDue || 0);
                return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f1f5f9;">
                    <div>
                        <div style="font-weight:600;font-size:14px;color:#1f2937;">Week ending ${cmEsc(b.weekEndingDate || '—')}</div>
                        <div style="font-size:12.5px;color:#9ca3af;margin-top:2px;">${subLabel}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:700;color:#1f2937;">${cmFmt(amount)}</div>
                        ${partner ? '' : `<span style="font-size:11px;font-weight:700;color:${statusColor};">${cmEsc(b.status || '—')}</span>`}
                    </div>
                </div>`;
            }).join('');
        }
    }
}

// ── Weekly Billing ────────────────────────────────────────────────
function cmPopulateWeeklyBilling() { cmRenderWeekly(); }
function _cmWeeklyLegacy() {
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
        const mgmtFee     = b.managementFee   || (directTotal * (b.managementFeeRate || cmFeeRate()));
        const totalDue    = b.totalDue         || (directTotal + mgmtFee);

        return `<tr>
            <td><strong>${cmEsc(b.weekEndingDate || '—')}</strong><div style="font-size:11px;color:#9ca3af;">Week ${bills.length - i}</div></td>
            <td>${cmFmt(labor)}</td>
            <td>${cmFmt(materials)}</td>
            <td>${cmFmt(otherCosts)}</td>
            <td><strong>${cmFmt(directTotal)}</strong></td>
            <td class="cm-client-only" style="color:#7c3aed;font-weight:600;">${cmFmt(mgmtFee)}</td>
            <td class="cm-client-only"><strong style="font-size:15px;">${cmFmt(totalDue)}</strong></td>
            <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${ss.bg};color:${ss.color};">${cmEsc(b.status)}</span></td>
            <td><button onclick="openWBDetail(${JSON.stringify(b).replace(/"/g,'&quot;').replace(/'/g,'&#39;')})" style="padding:5px 12px;border-radius:7px;border:1.5px solid #d1fae5;background:#f0fdf4;color:#059669;font-size:12px;font-weight:600;cursor:pointer;">View</button></td>
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
function cmPopulateRevolvingFund() { cmRenderRevolving(); }
function _cmRevolvingLegacy() {
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
            if (document.getElementById('section-notifications')?.classList.contains('active')) cmRenderNotifPage();
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
        <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;${isUnread ? 'background:#f0fdf4;' : ''}cursor:pointer;display:flex;gap:11px;align-items:flex-start;" onclick="cmMarkRead('${n.id}')">
            <div style="width:32px;height:32px;border-radius:9px;background:#fff;border:1px solid #ececf3;flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden;"><img src="assets/images/DACS-TRANSPARENT.png" alt="DAC's" style="width:22px;height:22px;object-fit:contain;"></div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:${isUnread ? '600' : '400'};color:#1f2937;">${cmEsc(n.message || n.title || '—')}</div>
                <div style="font-size:11.5px;color:#9ca3af;margin-top:3px;">${n.createdAt?.toDate ? n.createdAt.toDate().toLocaleDateString('en-PH') : '—'}</div>
            </div>
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

window.renderNotifHistory = function cmRenderNotifHistory() { cmRenderNotifPage(); };

// ── Notifications page (redesign: activity rows with icon chips) ──
function cmRelTime(ts) {
    const ms = ts && ts.toMillis ? ts.toMillis() : (ts ? new Date(ts).getTime() : 0);
    if (!ms || isNaN(ms)) return '';
    const diff = Date.now() - ms;
    const m = Math.floor(diff/60000), h = Math.floor(m/60), d = Math.floor(h/24);
    return d > 0 ? d+'d ago' : h > 0 ? h+'h ago' : m > 0 ? m+'m ago' : 'just now';
}

// Category-based icon picker. Currently unused — notifications show the DAC's
// logo instead (see cmRenderNotifPage / cmRenderNotifDropdown). Kept for reuse.
function _cmNotifIcon(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('paid') || t.includes('payment received') || t.includes('replenish'))
        return ['#e7f5ed', '#3f9960', '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'];
    if (t.includes('milestone') || t.includes('complete') || t.includes('approved') || t.includes('validated'))
        return ['#e7f5ed', '#3f9960', '<polyline points="20 6 9 17 4 12"/>'];
    if (t.includes('bought') || t.includes('procure') || t.includes('material'))
        return ['#eef1fd', '#5b5bd6', '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>'];
    if (t.includes('reminder'))
        return ['#fdf3e3', '#b4892a', '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'];
    if (t.includes('payment request') || t.includes('bill') || t.includes('due'))
        return ['#eeeefb', '#5b5bd6', '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>'];
    return ['#eeeefb', '#5b5bd6', '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'];
}

function cmRenderNotifPage() {
    const host = document.getElementById('section-notifications');
    if (!host) return;
    const card = 'background:#fff;border-radius:20px;box-shadow:0 1px 3px rgba(20,25,40,0.06);';
    const notifs = _cmFirestoreNotifs || [];
    const anyUnread = notifs.some(n => !n.isRead && !n.read);

    const rows = notifs.map(n => {
        const unread = !n.isRead && !n.read;
        const title = n.title || n.message || '—';
        const sub   = (n.title && n.message && n.title !== n.message) ? n.message : '';
        return `
        <div onclick="cmMarkRead('${n.id}');" style="display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:14px;${unread?'background:#f7f7fd;':''}cursor:pointer;">
            <div style="width:38px;height:38px;border-radius:11px;background:#fff;border:1px solid #ececf3;flex:none;display:flex;align-items:center;justify-content:center;overflow:hidden;"><img src="assets/images/DACS-TRANSPARENT.png" alt="DAC's" style="width:26px;height:26px;object-fit:contain;"></div>
            <div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:#1a1d24;">${cmEsc(title)}</div>${sub?`<div style="font-size:13px;color:#8b91a0;margin-top:2px;">${cmEsc(sub)}</div>`:''}</div>
            <div style="display:flex;align-items:center;gap:10px;flex:none;"><span style="font-size:12px;color:#aeb4c2;">${cmRelTime(n.createdAt)}</span>${unread?'<span style="width:8px;height:8px;background:#5b5bd6;border-radius:50%;"></span>':''}</div>
        </div>`;
    }).join('') || `<div style="padding:48px 20px;text-align:center;color:#aeb4c2;font-size:13px;">No notifications yet.</div>`;

    host.innerHTML = `
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:24px;gap:14px;flex-wrap:wrap;">
        <div>
            <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:#1a1d24;">Notifications</div>
            <div style="font-size:14px;color:#8b91a0;margin-top:3px;">Recent updates across payments, procurement, and progress.</div>
        </div>
        ${anyUnread ? `<button onclick="markAllRead()" style="border:1.5px solid #e3e5ec;background:#fff;color:#1a1d24;font-size:13px;font-weight:700;padding:10px 16px;border-radius:12px;cursor:pointer;">Mark all read</button>` : ''}
    </div>
    <div style="${card}padding:8px 10px;display:flex;flex-direction:column;gap:2px;">${rows}</div>`;
}

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
// Cloudflare Turnstile widget for the change-password form (rendered on demand)
const CM_CPW_SITEKEY = '0x4AAAAAADgIAGT-ZrooN5eY';
let _cmCpwWidgetId = null;
function _cmCpwRenderOrReset() {
    if (!window.turnstile) return;
    try {
        if (_cmCpwWidgetId === null) _cmCpwWidgetId = turnstile.render('#cpw-captcha', { sitekey: CM_CPW_SITEKEY });
        else turnstile.reset(_cmCpwWidgetId);
    } catch (e) {}
}
function _cmCpwToken() {
    try { return (window.turnstile && _cmCpwWidgetId !== null) ? (turnstile.getResponse(_cmCpwWidgetId) || undefined) : undefined; }
    catch (e) { return undefined; }
}

window.toggleChangePassword = function() {
    const form  = document.getElementById('change-pw-form');
    const ph    = document.getElementById('change-pw-placeholder');
    const open  = form && form.style.display !== 'none';
    if (form) form.style.display  = open ? 'none' : '';
    if (ph)   ph.style.display    = open ? '' : 'none';
    // Opening → render/refresh the captcha so a fresh token is ready on submit
    if (!open) _cmCpwRenderOrReset();
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
        cred.captchaToken = _cmCpwToken();
        await cmCurrentUser.reauthenticateWithCredential(cred);
        await cmCurrentUser.updatePassword(nw);
        cmShowToast('Password changed ✓');
        window.toggleChangePassword();
    } catch (err) {
        _cmCpwRenderOrReset(); // refresh captcha so a retry gets a fresh token
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
// Cloudflare Turnstile widget for the forgot-password modal (rendered on demand)
let _cmFpWidgetId = null;
function _cmFpRenderOrReset() {
    if (!window.turnstile) return;
    try {
        if (_cmFpWidgetId === null) _cmFpWidgetId = turnstile.render('#fp-captcha', { sitekey: '0x4AAAAAADgIAGT-ZrooN5eY' });
        else turnstile.reset(_cmFpWidgetId);
    } catch (e) {}
}
function _cmFpToken() {
    try { return (window.turnstile && _cmFpWidgetId !== null) ? (turnstile.getResponse(_cmFpWidgetId) || undefined) : undefined; }
    catch (e) { return undefined; }
}

window.doForgotPassword = function() {
    const modal = document.getElementById('forgotPasswordModal');
    const input = document.getElementById('forgotEmailInput');
    const msg   = document.getElementById('forgotPasswordMsg');
    const loginEmail = (document.getElementById('login-email') || {}).value || '';
    if (input) input.value = loginEmail;
    if (msg)   { msg.style.display = 'none'; }
    if (modal) modal.style.display = 'flex';
    _cmFpRenderOrReset(); // fresh captcha each time the modal opens
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
        await firebase.auth().sendPasswordResetEmail(email, _cmFpToken());
        show('Reset link sent! Check your inbox.', false);
        if (input) input.value = '';
        setTimeout(window.closeForgotPasswordModal, 3000);
    } catch (e) {
        _cmFpRenderOrReset(); // refresh captcha so a retry gets a fresh token
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

function cmPopulateAccomplishmentReports() { cmRenderAccomplishment(); }

// ── Accomplishment Reports (redesign: stacked progress cards) ──
function cmRenderAccomplishment() {
    const host = document.getElementById('section-accomplishment');
    if (!host) return;
    const card = 'background:#fff;border-radius:20px;padding:24px 26px;box-shadow:0 1px 3px rgba(20,25,40,0.06);';

    if (!cmProjectData) {
        host.innerHTML = `<div style="${card}text-align:center;color:#aeb4c2;padding:60px 20px;">No project assigned yet.</div>`;
        return;
    }

    const reports = (cmAccomplishmentReports || []).slice()
        .sort((a, b) => (cmTsMillis(b.updatedAt) - cmTsMillis(a.updatedAt)));
    cmRenderedReports = reports;  // so cmViewAccomplishmentReport(idx) resolves

    const badge = st => st === 'approved'
        ? '<span style="font-size:11px;font-weight:700;background:#e7f5ed;color:#3f9960;padding:3px 10px;border-radius:20px;">PUBLISHED</span>'
        : st === 'submitted'
        ? '<span style="font-size:11px;font-weight:700;background:#eef1fd;color:#5b5bd6;padding:3px 10px;border-radius:20px;">FOR REVIEW</span>'
        : '<span style="font-size:11px;font-weight:700;background:#fdf3e3;color:#b4892a;padding:3px 10px;border-radius:20px;">DRAFT</span>';

    const cards = reports.map((r, idx) => {
        const pct   = r.progressPercentage != null ? r.progressPercentage : cmBoqPct(r);
        const title = r.subject || r.projectName || 'Accomplishment Report';
        const nItems = Array.isArray(r.costItems) ? r.costItems.length : 0;
        const sub = [r.date, nItems ? nItems + ' cost item' + (nItems===1?'':'s') : ''].filter(Boolean).join(' · ');
        return `
        <div onclick="cmViewAccomplishmentReport(${idx})" style="${card}display:flex;align-items:center;gap:16px 24px;flex-wrap:wrap;cursor:pointer;">
            <div style="flex:1;min-width:180px;">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span style="font-size:16px;font-weight:800;color:#1a1d24;">${cmEsc(title)}</span>${badge(r.status)}</div>
                <div style="font-size:13px;color:#8b91a0;margin-top:5px;">${cmEsc(sub || '—')}</div>
            </div>
            <div style="width:200px;flex:none;">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;"><span style="color:#8b91a0;font-weight:600;">Progress</span><span style="font-weight:700;color:#1a1d24;">${pct}%</span></div>
                <div style="height:7px;background:#eceef3;border-radius:4px;overflow:hidden;"><div style="width:${Math.min(100,pct)}%;height:100%;background:#5b5bd6;"></div></div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b6bcc9" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`;
    }).join('') || `<div style="${card}text-align:center;color:#aeb4c2;padding:48px 20px;">No accomplishment reports published yet.</div>`;

    host.innerHTML = `
    <div style="margin-bottom:26px;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:#1a1d24;">Accomplishment Reports</div>
        <div style="font-size:14px;color:#8b91a0;margin-top:3px;">Periodic progress updates validated by DACS. Tap a report to view its full work breakdown.</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px;">${cards}</div>`;
}

function _cmAccomplishmentLegacy() {
    const tbody = document.getElementById('reports-tbody');
    if (!cmProjectData) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No project assigned yet.</td></tr>';
        return;
    }

    // Progress summary bar — latest approved report's overall %
    const approved   = cmAccomplishmentReports.filter(r => r.status === 'approved');
    const latest     = [...approved].sort((a,b) => (cmTsMillis(b.updatedAt) - cmTsMillis(a.updatedAt)))[0];
    const overallPct = latest ? (latest.progressPercentage != null ? latest.progressPercentage : cmBoqPct(latest)) : 0;
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
    tbody.innerHTML = reports.map((r, idx) => {
        const ss     = SS[r.status] || SS.draft;
        const grand  = cmBoqGrand(r.costItems);
        const acc    = cmBoqAccNet(r.costItems, r.discount);
        const pctNum = r.progressPercentage != null ? r.progressPercentage : cmBoqPct(r);
        const pctColor = pctNum >= 80 ? '#15803d' : pctNum >= 50 ? '#d97706' : '#374151';
        const title  = r.subject || r.projectName || r.title || 'Accomplishment Report';
        return `<tr>
            <td>
                <div style="font-weight:600;color:#1f2937;font-size:13.5px;">${cmEsc(title)}</div>
                ${r.approvedBy ? `<div style="font-size:11px;color:#059669;margin-top:2px;">✓ Validated by ${cmEsc(r.approvedBy)}</div>` : '<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Pending validation</div>'}
            </td>
            <td style="font-size:13px;color:#374151;white-space:nowrap;">${cmEsc(r.date || '—')}</td>
            <td style="font-size:13px;color:#374151;text-align:right;white-space:nowrap;">${cmFmt(grand)}</td>
            <td style="font-size:13px;color:#059669;font-weight:600;text-align:right;white-space:nowrap;">${cmFmt(acc)}</td>
            <td style="text-align:center;"><span style="font-weight:700;font-size:14px;color:${pctColor};">${pctNum}%</span></td>
            <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${ss.bg};color:${ss.color};">${ss.label}</span></td>
            <td><button onclick="cmViewAccomplishmentReport(${idx})" style="padding:5px 12px;border-radius:7px;border:1.5px solid #d1fae5;background:#f0fdf4;color:#059669;font-size:12px;font-weight:600;cursor:pointer;">View</button></td>
        </tr>`;
    }).join('');
    cmRenderedReports = reports;
}

window.filterReports = function() {
    const q = (document.getElementById('report-search')?.value || '').toLowerCase().trim();
    const filtered = !q ? cmAccomplishmentReports
        : cmAccomplishmentReports.filter(r =>
            (r.subject     ||'').toLowerCase().includes(q) ||
            (r.projectName ||'').toLowerCase().includes(q) ||
            (r.date        ||'').toLowerCase().includes(q)
        );
    cmRenderAccomplishmentTable(filtered);
};

window.cmViewAccomplishmentReport = function(idx) {
    const r = cmRenderedReports[idx];
    if (!r) return;
    const modal   = document.getElementById('report-modal');
    if (!modal) return;
    const titleEl = document.getElementById('rmd-title');
    const metaEl  = document.getElementById('rmd-meta');
    const bodyEl  = document.getElementById('rmd-body');
    const footerEl= document.getElementById('rmd-footer');

    const grand  = cmBoqGrand(r.costItems);
    const acc    = cmBoqAccNet(r.costItems, r.discount);
    const pctNum = r.progressPercentage != null ? r.progressPercentage : cmBoqPct(r);
    const SM     = { approved:{label:'Approved by DACS',color:'#15803d'}, submitted:{label:'For Admin Review',color:'#1d4ed8'}, draft:{label:'Draft',color:'#6b7280'} };
    const ss     = SM[r.status] || SM.draft;

    if (titleEl) titleEl.textContent = r.subject || r.projectName || 'Accomplishment Report';
    if (metaEl)  metaEl.textContent  = [r.date, r.location].filter(Boolean).join('  ·  ');

    // Document info chips
    const infoChips = [
        ['Date', r.date], ['Area', r.area], ['Owner', r.ownerName], ['Location', r.location]
    ].filter(([, v]) => v).map(([label, v]) => `
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;">
            <div style="font-size:11px;color:#9ca3af;margin-bottom:2px;text-transform:uppercase;letter-spacing:.4px;">${label}</div>
            <div style="font-size:13px;font-weight:600;color:#374151;">${cmEsc(v)}</div>
        </div>`).join('');

    // Read-only BOQ breakdown
    const items = Array.isArray(r.costItems) ? r.costItems : [];
    const breakdown = !items.length
        ? '<div style="font-size:13px;color:#9ca3af;font-style:italic;padding:8px 0;">No cost items recorded for this report.</div>'
        : items.map((ci, ci2) => `
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">
                    <div style="font-weight:700;color:#1f2937;font-size:13.5px;">${ci2 + 1}. ${cmEsc(ci.name || 'Cost Item')}</div>
                    <div style="font-size:12px;color:#374151;white-space:nowrap;">${cmFmt(cmBoqCiSub(ci))} · <span style="color:#059669;">${cmFmt(cmBoqCiAcc(ci))}</span></div>
                </div>
                ${(ci.subItems || []).map(si => `
                    <div style="margin:6px 0 6px 10px;">
                        ${si.name ? `<div style="font-size:12.5px;font-weight:600;color:#475569;margin-bottom:4px;">${cmEsc(si.name)}</div>` : ''}
                        <div style="overflow-x:auto;">
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead><tr style="color:#9ca3af;text-align:left;">
                                <th style="padding:4px 6px;font-weight:600;">Description</th>
                                <th style="padding:4px 6px;font-weight:600;text-align:right;">Qty</th>
                                <th style="padding:4px 6px;font-weight:600;text-align:right;">Total</th>
                                <th style="padding:4px 6px;font-weight:600;text-align:center;">% Done</th>
                                <th style="padding:4px 6px;font-weight:600;text-align:right;">Accomplishment</th>
                            </tr></thead>
                            <tbody>
                            ${(si.lineItems || []).map(li => `
                                <tr style="border-top:1px solid #f1f5f9;">
                                    <td style="padding:4px 6px;color:#374151;">${cmEsc(li.description || '—')}${li.unit ? ` <span style="color:#9ca3af;">(${cmEsc(li.unit)})</span>` : ''}</td>
                                    <td style="padding:4px 6px;text-align:right;color:#6b7280;">${cmEsc(li.qty != null ? String(li.qty) : '—')}</td>
                                    <td style="padding:4px 6px;text-align:right;color:#374151;">${cmFmt(cmBoqLiTotal(li))}</td>
                                    <td style="padding:4px 6px;text-align:center;font-weight:600;color:#374151;">${cmBoqNum(li.percentCompletion)}%</td>
                                    <td style="padding:4px 6px;text-align:right;font-weight:600;color:#059669;">${cmFmt(cmBoqLiTotal(li) * (cmBoqNum(li.percentCompletion)/100))}</td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                        </div>
                    </div>`).join('')}
            </div>`).join('');

    if (bodyEl) bodyEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:8px;background:#f0fdf4;border:1px solid #a7f3d0;border-radius:8px;padding:8px 14px;">
                <div style="font-size:24px;font-weight:800;color:#059669;">${pctNum}%</div>
                <div style="font-size:12px;color:#065f46;line-height:1.3;">Overall<br>Progress</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;">
                <div style="font-size:11px;color:#9ca3af;margin-bottom:2px;text-transform:uppercase;letter-spacing:.4px;">Status</div>
                <div style="font-size:13px;font-weight:700;color:${ss.color};">${ss.label}</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;">
                <div style="font-size:11px;color:#9ca3af;margin-bottom:2px;text-transform:uppercase;letter-spacing:.4px;">Total Project Cost</div>
                <div style="font-size:13px;font-weight:700;color:#374151;">${cmFmt(grand)}</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;">
                <div style="font-size:11px;color:#9ca3af;margin-bottom:2px;text-transform:uppercase;letter-spacing:.4px;">Total Accomplishment</div>
                <div style="font-size:13px;font-weight:700;color:#059669;">${cmFmt(acc)}</div>
            </div>
        </div>
        ${infoChips ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">${infoChips}</div>` : ''}
        <div style="font-weight:700;font-size:13px;color:#1f2937;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;">Work Breakdown</div>
        ${breakdown}`;

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

function cmPopulateMilestones() { cmRenderMilestones(); }

// ── Milestone Progress (redesign: completion hero + vertical timeline) ──
function cmRenderMilestones() {
    const host = document.getElementById('section-milestones');
    if (!host) return;
    const card = 'background:#fff;border-radius:20px;padding:30px 32px;box-shadow:0 1px 3px rgba(20,25,40,0.06);';

    if (!cmProjectData) {
        host.innerHTML = `<div style="${card}text-align:center;color:#aeb4c2;padding:60px 20px;">No project assigned yet.</div>`;
        return;
    }

    const ms = (cmMilestones || []).slice().sort((a,b) => (Number(a.order)||0) - (Number(b.order)||0));
    const total     = ms.length;
    const completed = ms.filter(m => m.status === 'completed').length;
    const inProg    = ms.filter(m => m.status === 'in_progress').length;
    const overall   = total > 0 ? Math.round((completed / total) * 100) : 0;

    const mb = document.getElementById('milestone-active-badge');
    if (mb) { mb.textContent = inProg; mb.style.display = inProg ? '' : 'none'; }

    const SB = {
        completed:   ['COMPLETE',    '#e7f5ed', '#3f9960'],
        in_progress: ['IN PROGRESS', '#eef1fd', '#5b5bd6'],
        pending:     ['PENDING',     '#f0f1f5', '#8b91a0']
    };

    const rows = ms.map((m, i) => {
        const st = m.status || 'pending';
        const last = i === ms.length - 1;
        const connector = last ? '' : `<div style="width:2px;flex:1;min-height:46px;background:${st==='completed'?'#e7f5ed':'#eceef3'};"></div>`;
        const dot = st === 'completed'
            ? `<div style="width:30px;height:30px;border-radius:50%;background:#3f9960;display:flex;align-items:center;justify-content:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>`
            : st === 'in_progress'
            ? `<div style="width:30px;height:30px;border-radius:50%;background:#5b5bd6;border:4px solid #d7d7f6;box-sizing:border-box;"></div>`
            : `<div style="width:30px;height:30px;border-radius:50%;background:#eef0f4;border:2px solid #dfe2ea;box-sizing:border-box;"></div>`;
        const [lbl, bg, fg] = SB[st] || SB.pending;
        const muted = st === 'pending';
        const desc = m.description || (m.plannedDate ? 'Planned ' + cmEsc(m.plannedDate) : '');
        const weightBar = (st === 'in_progress' && m.percentage)
            ? `<div style="height:6px;background:#eceef3;border-radius:4px;overflow:hidden;margin-top:10px;max-width:340px;"><div style="width:${Math.min(100, Number(m.percentage)||0)}%;height:100%;background:#5b5bd6;"></div></div>` : '';
        return `
        <div style="display:flex;gap:16px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;align-items:center;">${dot}${connector}</div>
            <div style="padding-bottom:${last?'0':'30px'};flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <span style="font-size:16px;font-weight:800;color:${muted?'#8b91a0':'#1a1d24'};">${cmEsc(m.name || 'Milestone')}</span>
                    <span style="font-size:11px;font-weight:700;background:${bg};color:${fg};padding:3px 10px;border-radius:20px;">${lbl}</span>
                </div>
                ${desc ? `<div style="font-size:13px;color:${muted?'#aeb4c2':'#8b91a0'};margin-top:4px;">${desc}</div>` : ''}
                ${weightBar}
            </div>
        </div>`;
    }).join('');

    const timeline = ms.length
        ? `<div style="${card}">${rows}</div>`
        : `<div style="${card}text-align:center;color:#aeb4c2;padding:48px 20px;">No milestones defined yet.</div>`;

    host.innerHTML = `
    <div style="margin-bottom:24px;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:#1a1d24;">Milestone Progress</div>
        <div style="font-size:14px;color:#8b91a0;margin-top:3px;">The project broken into defined milestones. Each is validated by DACS before it's marked complete.</div>
    </div>
    <div style="background:#5b5bd6;border-radius:20px;padding:26px 30px;color:#fff;box-shadow:0 18px 36px -18px rgba(91,91,214,0.5);margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:30px;flex-wrap:wrap;">
        <div>
            <div style="font-size:13px;opacity:0.85;font-weight:600;">Overall completion</div>
            <div style="font-size:40px;font-weight:800;letter-spacing:-0.02em;margin-top:4px;">${overall}%</div>
        </div>
        <div style="flex:1;min-width:240px;max-width:520px;">
            <div style="height:10px;background:rgba(255,255,255,0.22);border-radius:6px;overflow:hidden;"><div style="width:${overall}%;height:100%;background:#fff;border-radius:6px;"></div></div>
            <div style="font-size:12.5px;opacity:0.85;margin-top:9px;">${completed} of ${total} milestone${total===1?'':'s'} complete</div>
        </div>
    </div>
    ${timeline}`;
}

function _cmMilestonesLegacy() {
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
                    <td>Labor + Materials + ${cmBillPct(b)}% Fee</td>
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
    if (!cmProjectData) { cmRenderMaterials(); return; }
    try {
        const snap = await db.collection('constructionProjects')
            .doc(cmProjectData.id)
            .collection('procurementList')
            .orderBy('createdAt', 'desc')
            .get();
        _plItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        cmRenderMaterials();
        // Refresh the Overview "To purchase" card if it's the active screen.
        if (document.getElementById('section-kpi-dashboard')?.classList.contains('active')) cmRenderOverview();
    } catch (err) {
        console.warn('Procurement list load:', err.message);
        cmRenderMaterials();
    }
}

// ── Materials Procurement (redesign: filter pills + items table) ──
let _cmMatFilter = 'all';
window.cmMatSetFilter = function(f) { _cmMatFilter = f; cmRenderMaterials(); };

function _cmMatClass(it) {
    if (it.boughtBy === 'client'  || it.status === 'Bought by Client'  || it.status === 'Assigned to Client') return 'client';
    if (it.boughtBy === 'company' || it.status === 'Bought by Company' || it.status === 'Assigned to Admin')  return 'company';
    return 'pending';
}

function cmRenderMaterials() {
    const host = document.getElementById('section-procurement-list');
    if (!host) return;
    const card = 'background:#fff;border-radius:20px;box-shadow:0 1px 3px rgba(20,25,40,0.06);';

    const items = _plItems || [];
    const nAll     = items.length;
    const nPending = items.filter(i => _cmMatClass(i) === 'pending').length;
    const nClient  = items.filter(i => _cmMatClass(i) === 'client').length;
    const nCompany = items.filter(i => _cmMatClass(i) === 'company').length;

    const pb = document.getElementById('procurement-pending-badge');
    if (pb) { pb.textContent = nPending; pb.style.display = nPending ? '' : 'none'; }

    const shown = items.filter(i => _cmMatFilter === 'all' || _cmMatClass(i) === _cmMatFilter);

    const pill = (key, label, n) => {
        const on = _cmMatFilter === key;
        return `<span onclick="cmMatSetFilter('${key}')" style="font-size:13px;font-weight:${on?'700':'600'};background:${on?'#5b5bd6':'#fff'};color:${on?'#fff':'#6b7180'};padding:8px 16px;border-radius:20px;cursor:pointer;${on?'':'box-shadow:0 1px 3px rgba(20,25,40,0.05);'}">${label} · ${n}</span>`;
    };

    const badge = it => {
        const c = _cmMatClass(it);
        if (c === 'client')  return '<span style="font-size:11px;font-weight:700;background:#e7f5ed;color:#3f9960;padding:3px 10px;border-radius:20px;">BY CLIENT</span>';
        if (c === 'company') return '<span style="font-size:11px;font-weight:700;background:#eef1fd;color:#5b5bd6;padding:3px 10px;border-radius:20px;">BY COMPANY</span>';
        return '<span style="font-size:11px;font-weight:700;background:#fdf3e3;color:#b4892a;padding:3px 10px;border-radius:20px;">PENDING</span>';
    };
    const receipt = it => it.receiptUrl
        ? `<svg onclick="window.open('${cmEsc(it.receiptUrl)}','_blank')" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5b5bd6" stroke-width="1.8" style="cursor:pointer;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
        : '<span style="color:#c4c9d4;">—</span>';

    const rows = shown.map(it => `
        <tr style="border-top:1px solid #f0f1f5;">
            <td style="padding:15px 0;font-weight:600;">${cmEsc(it.item || it.name || 'Item')}</td>
            <td style="padding:15px 0;text-align:right;color:#6b7180;">${cmEsc(it.qty || '—')}</td>
            <td style="padding:15px 0;text-align:right;color:#6b7180;">${it.estPrice ? cmFmt(it.estPrice) : '—'}</td>
            <td style="padding:15px 0;text-align:right;${it.actualAmount?'font-weight:700;':'color:#c4c9d4;'}">${it.actualAmount ? cmFmt(it.actualAmount) : '—'}</td>
            <td style="padding:15px 0;text-align:center;">${receipt(it)}</td>
            <td style="padding:15px 0;text-align:right;">${badge(it)}</td>
        </tr>`).join('') || `<tr><td colspan="6" style="padding:20px 0;color:#aeb4c2;font-size:13px;text-align:center;">No items${_cmMatFilter!=='all'?' in this filter':' yet'}.</td></tr>`;

    host.innerHTML = `
    <div style="margin-bottom:24px;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:#1a1d24;">Materials Procurement</div>
        <div style="font-size:14px;color:#8b91a0;margin-top:3px;">Items to purchase. Each is marked bought by client or company, with the actual amount and receipt for transparency.</div>
    </div>
    <div style="display:flex;gap:9px;margin-bottom:18px;flex-wrap:wrap;">
        ${pill('all','All',nAll)}${pill('pending','Pending',nPending)}${pill('client','Bought by client',nClient)}${pill('company','Bought by company',nCompany)}
    </div>
    <div style="${card}padding:8px 24px;">
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;min-width:560px;border-collapse:collapse;">
            <thead><tr style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#aeb4c2;font-weight:700;">
                <th style="text-align:left;padding:14px 0;">Item</th>
                <th style="text-align:right;padding:14px 0;">Qty</th>
                <th style="text-align:right;padding:14px 0;">Est. price</th>
                <th style="text-align:right;padding:14px 0;">Actual paid</th>
                <th style="text-align:center;padding:14px 0;">Receipt</th>
                <th style="text-align:right;padding:14px 0;">Status</th>
            </tr></thead>
            <tbody style="font-size:14px;color:#1a1d24;">${rows}</tbody>
        </table>
      </div>
    </div>`;
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

        // Upload receipt to Supabase Storage (via the storage shim — same pattern as pm-admin.js)
        if (_plReceiptFile && cmCurrentUser) {
            const ext  = _plReceiptFile.name.split('.').pop();
            const path = `procurementReceipts/${cmProjectData.id}/${itemId}_client_${Date.now()}.${ext}`;
            const ref  = storage.ref(path);
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
        const mgmtFee   = b.managementFee    || (directTotal * (b.managementFeeRate || cmFeeRate()));
        const totalDue  = b.totalDue          || (directTotal + mgmtFee);
        return `<tr>
            <td><strong>${cmEsc(b.weekEndingDate || '—')}</strong><div style="font-size:11px;color:#9ca3af;">Week ${bills.length - i}</div></td>
            <td>${cmFmt(labor)}</td>
            <td>${cmFmt(materials)}</td>
            <td>${cmFmt(otherCosts)}</td>
            <td><strong>${cmFmt(directTotal)}</strong></td>
            <td class="cm-client-only" style="color:#7c3aed;font-weight:600;">${cmFmt(mgmtFee)}</td>
            <td class="cm-client-only"><strong style="font-size:15px;">${cmFmt(totalDue)}</strong></td>
            <td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${ss.bg};color:${ss.color};">${cmEsc(b.status)}</span></td>
            <td><button onclick="openWBDetail(${JSON.stringify(b).replace(/"/g,'&quot;').replace(/'/g,'&#39;')})" style="padding:5px 12px;border-radius:7px;border:1.5px solid #d1fae5;background:#f0fdf4;color:#059669;font-size:12px;font-weight:600;cursor:pointer;">View</button></td>
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
    // Blended fee % across the listed bills (handles weeks billed at different rates).
    const totalDirect   = totalBilled - totalFees;
    const blendedFeePct = totalDirect > 0 ? Math.round(totalFees / totalDirect * 100) : cmFeePct();

    const statusColor = s => s === 'Paid' ? '#15803d' : s === 'Overdue' ? '#dc2626' : '#1d4ed8';
    const statusBg    = s => s === 'Paid' ? '#dcfce7' : s === 'Overdue' ? '#fee2e2' : '#dbeafe';

    const rows = bills.map((b, i) => {
        const labor     = b.labor       || 0;
        const materials = b.materials   || 0;
        const other     = (b.delivery||0) + (b.consumables||0) + (b.other||0);
        const direct    = b.directCostTotal  || (labor + materials + other);
        const fee       = b.managementFee    || (direct * (b.managementFeeRate || cmFeeRate()));
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
    <div class="info-item"><div class="label">Billing Model</div><div class="value">Cost-Plus — Direct Costs + ${cmFeePct()}% Management Fee</div></div>
    <div class="info-item"><div class="label">Total Weeks</div><div class="value">${bills.length} week(s)</div></div>
  </div>

  <div class="summary-row">
    <div class="sum-card sum-green"><div class="sum-label">Total Billed</div><div class="sum-value">${fmt(totalBilled)}</div></div>
    <div class="sum-card sum-blue"><div class="sum-label">Total Paid</div><div class="sum-value">${fmt(totalPaid)}</div></div>
    <div class="sum-card sum-amber"><div class="sum-label">Outstanding</div><div class="sum-value">${fmt(outstanding)}</div></div>
    <div class="sum-card sum-purple"><div class="sum-label">Mgmt Fees (${blendedFeePct}%)</div><div class="sum-value">${fmt(totalFees)}</div></div>
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
        <th style="text-align:right;">Mgmt Fee (${blendedFeePct}%)</th>
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

// ── BOQ progress helpers (mirror the admin BOQ module's math) ──────
function cmTsMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.toDate === 'function')   return ts.toDate().getTime();
    const t = new Date(ts).getTime();
    return isNaN(t) ? 0 : t;
}
function cmBoqNum(v) { return Number(String(v == null ? '' : v).replace(/,/g, '')) || 0; }
function cmBoqLiTotal(li) {
    const qty = cmBoqNum(li.qty);
    const mat = li.materialOverride ? 0 : cmBoqNum(li.materialRate);
    const lab = li.laborOverride    ? 0 : cmBoqNum(li.laborRate);
    return qty * (mat + lab);
}
function cmBoqGrand(costItems) {
    return (costItems || []).reduce((s, ci) =>
        s + (ci.subItems || []).reduce((s2, si) =>
            s2 + (si.lineItems || []).reduce((s3, li) => s3 + cmBoqLiTotal(li), 0), 0), 0);
}
function cmBoqAcc(costItems) {
    return (costItems || []).reduce((s, ci) =>
        s + (ci.subItems || []).reduce((s2, si) =>
            s2 + (si.lineItems || []).reduce((s3, li) => s3 + cmBoqLiTotal(li) * (cmBoqNum(li.percentCompletion) / 100), 0), 0), 0);
}
// Accomplishment is claimed against the discounted contract, so the discount is
// spread across it in proportion to work done. cmBoqAcc stays gross because
// cmBoqPct divides it by the gross total to get % complete.
function cmBoqAccNet(costItems, discount) {
    const grand = cmBoqGrand(costItems);
    if (!grand) return 0;
    return cmBoqAcc(costItems) * (Math.max(0, grand - cmBoqNum(discount)) / grand);
}
function cmBoqPct(doc) {
    const grand = cmBoqGrand(doc.costItems);
    if (grand <= 0) return 0;
    return Math.round((cmBoqAcc(doc.costItems) / grand) * 100);
}
function cmBoqCiSub(ci) { return (ci.subItems || []).reduce((s, si) => s + (si.lineItems || []).reduce((s2, li) => s2 + cmBoqLiTotal(li), 0), 0); }
function cmBoqCiAcc(ci) { return (ci.subItems || []).reduce((s, si) => s + (si.lineItems || []).reduce((s2, li) => s2 + cmBoqLiTotal(li) * (cmBoqNum(li.percentCompletion) / 100), 0), 0); }

function cmComputeKPIs() {
    const budget       = Number(cmProjectData?.budget) || 0;
    // Partners see direct costs only (no 15% mgmt fee); clients see the
    // fee-inclusive total due.
    const totalExpenses= cmWeeklyBills.reduce((s, b) => {
        const direct = b.directCostTotal || ((b.labor||0) + (b.materials||0) + (b.delivery||0) + (b.consumables||0) + (b.other||0));
        return s + (cmIsPartner() ? direct : (b.totalDue || direct));
    }, 0);

    // 1. Project Completion Rate
    const totalMs     = cmMilestones.length;
    const completedMs = cmMilestones.filter(m => m.status === 'completed').length;
    const completionRate = totalMs > 0 ? Math.round((completedMs / totalMs) * 100) : null;

    // 2. Budget Utilization Rate
    const budgetUtilization = budget > 0 ? Math.round((totalExpenses / budget) * 100) : null;

    // 3. Schedule Performance Indicator
    // Actual progress = the latest APPROVED accomplishment report's overall %
    // (BOQ-style: accomplishment ÷ grand total). The admin caches that as
    // progressPercentage on save; if missing we recompute it from costItems.
    const approvedReports = cmAccomplishmentReports
        .filter(r => r.status === 'approved')
        .sort((a, b) => (cmTsMillis(b.updatedAt) - cmTsMillis(a.updatedAt)));
    const latestReport    = approvedReports[0];
    const actualProgress  = latestReport
        ? (latestReport.progressPercentage != null ? latestReport.progressPercentage : cmBoqPct(latestReport))
        : 0;
    const plannedProgress = cmEstimatePlannedProgress();
    const spi = (latestReport && plannedProgress > 0)
        ? Math.round((actualProgress / plannedProgress) * 100) : null;

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
    cmRenderOverview();
}

// ── Overview (redesign: bill hero + revolving fund + to-purchase + cadence + recent weeks) ──
function cmWeekRange(end) {
    if (!end) return '—';
    const e = new Date(end);
    if (isNaN(e.getTime())) return cmEsc(String(end));
    const s = new Date(e); s.setDate(s.getDate() - 6);
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return s.getMonth() === e.getMonth()
        ? `${M[s.getMonth()]} ${s.getDate()}–${e.getDate()}`
        : `${M[s.getMonth()]} ${s.getDate()}–${M[e.getMonth()]} ${e.getDate()}`;
}

// ── Direct-cost breakdown (admin parity) ──────────────────────────────
// IDENTICAL to the admin's _pmOvBreakdown so the partnership shows the exact
// same Labor / Materials / "Materials + labor" figures. `materials` is stored
// client-inclusive of any combined (supply & install) amount, so pure
// materials = materials − combined; the combined bucket is reported on its own.
function cmOvBreakdown(bills) {
    let labor = 0, materials = 0, combined = 0, overhead = 0;
    // Per-category ENTRY counts: prefer the per-line `entries` array (each line is
    // one entry, typed labor/materials/both/overhead); else count a bill once per
    // category that has a nonzero amount.
    let laborCount = 0, matCount = 0, combinedCount = 0, overheadCount = 0;
    (bills || []).forEach(b => {
        // Overhead (site rent, utilities, fuel, permits) is a billable direct cost
        // stored in its own field. Older bills predate it and simply contribute 0.
        let ov = Number(b.overhead) || 0;
        if (!ov && Array.isArray(b.entries)) {
            ov = b.entries.filter(e => e.type === 'overhead').reduce((s, e) => s + (Number(e.amount) || 0), 0);
        }
        overhead += ov || 0;
        if (Array.isArray(b.entries) && b.entries.length) {
            overheadCount += b.entries.filter(e => e.type === 'overhead').length;
        } else if (ov > 0) { overheadCount++; }
        // Prefer the stored `combined` field; 0 is treated as "missing" too (a
        // `default 0` column leaves old bills at 0), so we still derive the supply &
        // install portion from the 'both' line entries (the stored `materials` folds it in).
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
            if ((b.labor || 0) > 0) laborCount++;
            if (matPure > 0)        matCount++;
            if (c > 0)              combinedCount++;
        }
    });
    const direct = labor + materials + combined + overhead;
    const pct = v => direct > 0 ? Math.round(v / direct * 100) : 0;
    return { labor, materials, combined, overhead, direct,
             laborPct: pct(labor), matPct: pct(materials), combinedPct: pct(combined),
             overheadPct: pct(overhead),
             laborCount, matCount, combinedCount, overheadCount };
}

function cmOvWeekLabel(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d) ? dateStr : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Weekly grouping for the range dropdown (Sun–Sat) ─────────────────────
// Daily bills group into calendar weeks, addressable by "wk:<YYYY-MM-DD Sunday>".
function cmWeekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    d.setDate(d.getDate() - d.getDay());     // back to the week's Sunday
    // Serialize from LOCAL parts (matches cmWeekStartKey). toISOString() would
    // convert to UTC and, in PH (UTC+8), drop to the previous day — shifting
    // every Sun–Sat week a day early in the dropdown range labels.
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
}
function cmWeekRangeLabel(sundayStr) {
    const start = new Date(sundayStr + 'T00:00:00');
    if (isNaN(start)) return sundayStr;
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const o = { month: 'short', day: 'numeric' };
    const sameYear = start.getFullYear() === end.getFullYear();
    return start.toLocaleDateString('en-PH', o) + ' – ' +
        end.toLocaleDateString('en-PH', sameYear ? o : { ...o, year: 'numeric' });
}
function cmOrdinal(n) {
    const suffix = (n % 10 === 1 && n !== 11) ? 'st'
        : (n % 10 === 2 && n !== 12) ? 'nd'
        : (n % 10 === 3 && n !== 13) ? 'rd' : 'th';
    return n + suffix;
}
// "1st Week" — which week OF THE PROJECT this Sun–Sat week is, counting from the
// week the project's start date falls in (so the first billed week reads "1st Week"
// instead of a calendar position like "3rd week of June"). Mirrors the admin's
// _pmWeekOfMonthLabel. Falls back to the calendar label with no start date.
function cmWeekOfMonthLabel(sundayStr) {
    const start = new Date(sundayStr + 'T00:00:00');
    if (isNaN(start)) return 'Per week';
    const startRaw = cmProjectData && cmProjectData.startDate;
    if (startRaw) {
        const projSun = new Date(cmWeekStart(startRaw) + 'T00:00:00');
        if (!isNaN(projSun)) {
            const weeks = Math.round((start - projSun) / (7 * 24 * 60 * 60 * 1000)) + 1;
            if (weeks >= 1) return cmOrdinal(weeks) + ' Week';
        }
    }
    return cmOrdinal(Math.ceil(start.getDate() / 7)) + ' week of '
        + start.toLocaleDateString('en-PH', { month: 'long' });
}
// Distinct week-starts present in the bills, newest first.
function cmOvWeekGroups() {
    const set = new Set((cmWeeklyBills || [])
        .filter(b => b.weekEndingDate)
        .map(b => cmWeekStart(b.weekEndingDate)));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
}

// Filter the stored weekly bills by the selected billing-week mode.
function cmOvFilterBills(mode) {
    const all = cmWeeklyBills || [];
    if (mode === 'all') return all;
    if (mode === 'month') {
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        return all.filter(b => (b.weekEndingDate || '').startsWith(ym));
    }
    // "wk:<sunday>" → every bill whose date falls in that Sun–Sat week.
    if (mode && mode.indexOf('wk:') === 0) {
        const ws = mode.slice(3);
        return all.filter(b => b.weekEndingDate && cmWeekStart(b.weekEndingDate) === ws);
    }
    const dated = all.filter(b => b.weekEndingDate)
        .slice().sort((a, b) => b.weekEndingDate.localeCompare(a.weekEndingDate));
    if (mode === 'latest') return dated.slice(0, 1);
    if (mode === 'last4')  return dated.slice(0, 4);
    return all.filter(b => b.weekEndingDate === mode);   // a specific week
}

// Inject the custom range-dropdown styles once (purple portal theme).
function cmEnsureDdStyle() {
    if (document.getElementById('cm-dd-style')) return;
    const s = document.createElement('style');
    s.id = 'cm-dd-style';
    s.textContent = `
      .cm-dd-btn{display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.3);border-radius:10px;padding:8px 13px;color:#fff;font:700 12px inherit;cursor:pointer;}
      .cm-dd-btn:hover{background:rgba(255,255,255,0.26);}
      .cm-dd-btn .cm-dd-chev{transition:transform .15s;}
      .cm-dd.open .cm-dd-btn .cm-dd-chev{transform:rotate(180deg);}
      .cm-dd-btn-light{background:#fff;border:1px solid #ebedf2;color:#1a1d24;box-shadow:0 1px 3px rgba(20,25,40,0.06);}
      .cm-dd-btn-light:hover{background:#fafbff;border-color:#c7c8f0;}
      .cm-dd-menu{display:none;position:absolute;top:calc(100% + 6px);right:0;min-width:232px;background:#fff;border:1px solid #ebedf2;border-radius:14px;box-shadow:0 18px 44px -14px rgba(20,25,40,0.3);padding:7px;z-index:60;}
      .cm-dd.open .cm-dd-menu{display:block;}
      .cm-dd-opt{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;text-align:left;background:none;border:none;cursor:pointer;border-radius:9px;padding:10px 12px;font:500 13px inherit;color:#3a3a36;}
      .cm-dd-opt:hover{background:#f5f5fb;}
      .cm-dd-opt.active{background:#eeeefb;color:#4b4bc4;font-weight:700;}
      .cm-dd-wk{color:#1a1d24;font-weight:700;font-family:'Space Mono',monospace;white-space:nowrap;}
      .cm-dd-check{color:#5b5bd6;font-weight:700;opacity:0;}
      .cm-dd-opt.active .cm-dd-check{opacity:1;}
      .cm-dd-sep{height:1px;background:#f0efec;margin:6px 8px;}
      /* Mobile: the Overview range button is left-aligned, so right:0 throws the
         menu off the left edge (clipped). Anchor it left and clamp to viewport. */
      @media (max-width:600px){#cm-ov-dd-menu{left:0;right:auto;min-width:0;max-width:calc(100vw - 40px);max-height:60vh;overflow-y:auto;}}`;
    document.head.appendChild(s);
}
// Generic open/close for a custom dropdown by container id.
window.cmDdToggle = function(id, ev) {
    if (ev) ev.stopPropagation();
    cmEnsureDdStyle();
    const dd = document.getElementById(id);
    if (!dd) return;
    if (dd.classList.contains('open')) { dd.classList.remove('open'); return; }
    dd.classList.add('open');
    const close = (e) => { if (!dd.contains(e.target)) { dd.classList.remove('open'); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
};
window.cmOvToggleRange = function(ev) { cmDdToggle('cm-ov-dd', ev); };
window.cmOvPickRange = function(el, val, label) {
    const input = document.getElementById('cm-ov-range');
    if (input) input.value = val;
    const lbl = document.getElementById('cm-ov-dd-label');
    if (lbl) lbl.textContent = label;
    document.querySelectorAll('#cm-ov-dd-menu .cm-dd-opt').forEach(o => o.classList.remove('active'));
    if (el) el.classList.add('active');
    const dd = document.getElementById('cm-ov-dd');
    if (dd) dd.classList.remove('open');
    cmOvApplyRange();
};

// Recompute the breakdown card for the selected date range (no full re-render).
window.cmOvApplyRange = function() {
    const sel = document.getElementById('cm-ov-range');
    if (!sel) return;
    const mode  = sel.value;
    const bills = cmOvFilterBills(mode);
    const bd    = cmOvBreakdown(bills);
    const setAmt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = cmFmt(val); };
    const setPct = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    const setSeg = (id, pct, show) => { const el = document.getElementById(id); if (el) { el.style.width = pct + '%'; el.style.minWidth = show ? '6px' : '0'; } };
    setAmt('cm-ov-direct',    bd.direct);
    setAmt('cm-ov-labor',     bd.labor);
    setAmt('cm-ov-materials', bd.materials);
    setAmt('cm-ov-combined',  bd.combined);
    // Keep the "% of budget" pills in sync with the range-filtered amounts.
    const _ovBudget = Number(cmProjectData && cmProjectData.budget) || 0;
    const setBpct = (id, val) => {
        const el = document.getElementById(id); if (!el) return;
        if (_ovBudget <= 0) { el.textContent = ''; return; }
        const p = (Number(val) || 0) / _ovBudget * 100;
        el.textContent = (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + '% of budget';
    };
    setBpct('cm-ov-labor-bpct',     bd.labor);
    setBpct('cm-ov-materials-bpct', bd.materials);
    setBpct('cm-ov-combined-bpct',  bd.combined);
    setBpct('cm-ov-direct-bpct',    bd.direct);
    const setCnt = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n + ' ' + (n === 1 ? 'entry' : 'entries'); };
    setCnt('cm-ov-labor-cnt',     bd.laborCount);
    setCnt('cm-ov-materials-cnt', bd.matCount);
    setCnt('cm-ov-combined-cnt',  bd.combinedCount);
    setPct('cm-ov-labor-pct',     bd.laborPct);
    setPct('cm-ov-materials-pct', bd.matPct);
    setPct('cm-ov-combined-pct',  bd.combinedPct);
    setSeg('cm-ov-seg-labor',     bd.laborPct,    bd.labor > 0);
    setSeg('cm-ov-seg-materials', bd.matPct,      bd.materials > 0);
    setSeg('cm-ov-seg-combined',  bd.combinedPct, bd.combined > 0);

    const note = document.getElementById('cm-ov-range-note');
    if (note) {
        const isWeek = mode && mode.indexOf('wk:') === 0;
        const n = bills.length;
        const wk = isWeek
            ? n + ' day' + (n === 1 ? '' : 's')
            : n + ' entr' + (n === 1 ? 'y' : 'ies');
        const label = mode === 'all'    ? 'All time'
            : mode === 'month'  ? 'This month'
            : mode === 'latest' ? 'This week'
            : mode === 'last4'  ? 'Last 4 weeks'
            : isWeek            ? 'Week of ' + cmWeekRangeLabel(mode.slice(3))
            : 'Daily ' + cmOvWeekLabel(mode);
        note.textContent = label + ' · ' + wk;
    }
};

// ── Daily-summary push (partner/client portal) ────────────────────────────
// Opt this device into the nightly 11:59 PM project summary. Stored in Supabase
// (pushSubscriptions, audience='partner') under the logged-in user; the Cloudflare
// cron worker sends the partner-facing push that service-worker.js shows.
const CM_VAPID_PUBLIC_KEY = 'BAB4GutS8XAXmVbWn7SLudzKYukRee_gMEHJ5uX_k7sBRRNi-z59VBIqJzEGO1whgUZJOLBN45nJvHt74zMmApo';

function _cmUrlB64ToUint8(base64) {
    const pad = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64); const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}
async function _cmSwReg() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    try { return await navigator.serviceWorker.register('/service-worker.js', { scope: '/' }); }
    catch (_) { return null; }
}
function _cmSubKeyMatches(sub, appKey) {
    try {
        const cur = sub.options && sub.options.applicationServerKey;
        if (!cur) return false;
        const a = new Uint8Array(cur);
        if (a.length !== appKey.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== appKey[i]) return false;
        return true;
    } catch (_) { return false; }
}
async function cmPushIsEnabled() {
    if (!cmProjectData || typeof Notification === 'undefined' || !('serviceWorker' in navigator) || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    try {
        const snap = await db.collection('pushSubscriptions')
            .where('endpoint', '==', sub.endpoint).where('projectId', '==', cmProjectData.id).get();
        return !snap.empty;
    } catch (_) { return false; }
}
async function _cmStoreSub(sub) {
    const json = sub.toJSON();
    try {
        const snap = await db.collection('pushSubscriptions')
            .where('endpoint', '==', sub.endpoint).where('projectId', '==', cmProjectData.id).get();
        if (!snap.empty) return;
    } catch (_) {}
    await db.collection('pushSubscriptions').add({
        userId:    cmCurrentUser && cmCurrentUser.uid,
        projectId: cmProjectData.id,
        audience:  'partner',
        page:      location.pathname,
        endpoint:  sub.endpoint,
        p256dh:    json.keys && json.keys.p256dh,
        auth:      json.keys && json.keys.auth,
        createdAt: new Date().toISOString(),
    });
}
async function _cmRemoveSub(endpoint) {
    try {
        const snap = await db.collection('pushSubscriptions')
            .where('endpoint', '==', endpoint).where('projectId', '==', cmProjectData.id).get();
        await Promise.all(snap.docs.map(d => db.collection('pushSubscriptions').doc(d.id).delete()));
    } catch (_) {}
}
// True if this device's endpoint is still opted into any other project. The
// browser has one shared push subscription, so don't unsubscribe() it while
// another project still depends on it.
async function _cmEndpointStillUsed(endpoint) {
    try {
        const snap = await db.collection('pushSubscriptions').where('endpoint', '==', endpoint).get();
        return !snap.empty;
    } catch (_) { return true; }
}
window.cmPushToggle = async function() {
    if (!cmProjectData) { alert('No project linked to your account yet.'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
        alert('Notifications are not supported on this browser.'); return;
    }
    if (CM_VAPID_PUBLIC_KEY.indexOf('REPLACE') === 0) {
        alert('Push is not configured yet — add the VAPID public key in the deploy guide.'); return;
    }
    const reg = await _cmSwReg();
    if (!reg) { alert('Could not start notifications on this device.'); return; }
    if (await cmPushIsEnabled()) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await _cmRemoveSub(sub.endpoint);
            if (!(await _cmEndpointStillUsed(sub.endpoint))) { try { await sub.unsubscribe(); } catch (_) {} }
        }
        cmPushRefreshBell(); return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('Allow notifications to get the daily summary.'); cmPushRefreshBell(); return; }
    const appKey = _cmUrlB64ToUint8(CM_VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !_cmSubKeyMatches(sub, appKey)) { try { await sub.unsubscribe(); } catch (_) {} sub = null; }
    if (!sub) {
        try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey }); }
        catch (e) { alert('Could not subscribe to notifications: ' + e.message); return; }
    }
    await _cmStoreSub(sub);
    cmPushRefreshBell();
    alert('Daily 11:59 PM summary enabled for this project.');
};
window.cmPushRefreshBell = async function() {
    const btn = document.getElementById('cm-push-bell');
    if (!btn) return;
    if (!cmProjectData || typeof Notification === 'undefined' || !('serviceWorker' in navigator)) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    let on = false;
    try { on = await cmPushIsEnabled(); } catch (_) {}
    btn.classList.toggle('on', on);
    btn.style.background    = on ? '#ecfdf3' : '#fff';
    btn.style.borderColor   = on ? '#abefc6' : '#e5e7eb';
    btn.style.color         = on ? '#067647' : '#374151';
    btn.textContent = on ? '🔔 Daily summary on' : '🔔 Notify me daily';
};
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { _cmSwReg(); }); }

function cmRenderOverview() {
    const host = document.getElementById('kpi-project-folder');
    if (!host) return;
    cmEnsureDdStyle();   // dropdown styles must exist before the menu renders (else it shows unstyled)

    const bills  = cmWeeklyBills || [];
    const latest = bills[0] || null;

    const first = (cmCurrentProfile && (cmCurrentProfile.firstName ||
        (cmCurrentProfile.fullName || '').split(' ')[0])) || 'there';

    const partner = cmIsPartner();   // monitoring/view-only: no 15% fee, no payments
    const ovContract = Number(cmProjectData?.budget) || 0;   // agreed project contract value

    // Latest WEEK figures — daily bills rolled into a Sun–Sat week so the cadence
    // card matches the Weekly Summary (was showing a single day as a 7-day "week").
    const latestWk  = cmWeekGroups()[0] || null;
    const labor     = latestWk ? latestWk.lab : 0;
    const materials = latestWk ? latestWk.mat : 0;
    const direct    = latestWk ? latestWk.dir : 0;
    const fee       = latestWk ? latestWk.fee : 0;
    const total     = latestWk ? latestWk.tot : 0;
    const range     = latestWk ? latestWk.range : '';
    const status    = latestWk ? latestWk.status : '';
    const duePill   = status === 'Paid' ? 'PAID' : status === 'Overdue' ? 'OVERDUE' : 'DUE';

    // Direct-cost breakdown (admin parity) — all-time across every weekly bill
    const ovBd      = cmOvBreakdown(cmWeeklyBills);
    // Net cash = what the client has paid minus the direct cost spent so far.
    // Paid is summed from payment requests using the admin's exact formula so the
    // KPI matches the admin overview (verified → amountPaid/paidAmount/totalAmount).
    const ovPaid    = (cmPayRequests || []).reduce((s, r) =>
        s + (r.status === 'verified' ? (r.amountPaid || r.paidAmount || r.totalAmount || 0) : (r.amountPaid || 0)), 0);
    const ovNet     = ovPaid - ovBd.direct;
    // Custom range-dropdown option buttons (native <select> can't style its list)
    const ovDdChevron = '<svg class="cm-dd-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const ovDdFixed = [['all', 'All time'], ['month', 'This month'], ['latest', 'This week'], ['last4', 'Last 4 weeks']]
        .map(([v, l], i) => `<button class="cm-dd-opt${i === 0 ? ' active' : ''}" onclick="cmOvPickRange(this,'${v}','${l}')"><span>${l}</span><span class="cm-dd-check">✓</span></button>`).join('');
    // Per-week rows: each calendar week (Sun–Sat) present in the bills.
    const ovDdWeekGroups = cmOvWeekGroups().map(ws => {
        const l = cmWeekRangeLabel(ws);
        return `<button class="cm-dd-opt" onclick="cmOvPickRange(this,'wk:${cmEsc(ws)}','${cmEsc(l)}')"><span>${cmEsc(cmWeekOfMonthLabel(ws))}</span><span class="cm-dd-wk">${cmEsc(l)}</span></button>`;
    }).join('');

    // Revolving fund
    const rf      = cmRevolvingFund;
    const rfTotal = rf ? (rf.fundAmount || 0) : 0;
    const rfSpent = rf ? (rf.totalSpent || 0) : 0;
    const rfBal   = rf ? (rf.currentBalance !== undefined ? rf.currentBalance : rfTotal - rfSpent) : 0;
    const rfPct   = rfTotal > 0 ? Math.max(0, Math.min(100, Math.round((rfBal / rfTotal) * 100))) : 0;

    // To purchase (unresolved procurement)
    const pend = (_plItems || []).filter(i =>
        ['Pending','Assigned to Client','Assigned to Admin'].includes(i.status) ||
        (!i.boughtBy && !['Bought by Company','Bought by Client'].includes(i.status)));
    const pill = it => {
        if (it.boughtBy === 'client' || it.status === 'Assigned to Client') return ['CLIENT', '#3f9960'];
        if (it.boughtBy === 'company' || it.status === 'Assigned to Admin')  return ['COMPANY', '#5b5bd6'];
        return ['PENDING', '#b4892a'];
    };
    const buyRows = pend.slice(0, 4).map(it => {
        const [lbl, col] = pill(it);
        return `<div style="display:flex;justify-content:space-between;align-items:center;">
            <span>${cmEsc(it.item || it.name || 'Item')}</span>
            <span style="font-size:11px;font-weight:700;color:${col};">${lbl}</span>
        </div>`;
    }).join('') || '<div style="font-size:13px;color:#aeb4c2;">Nothing pending — all materials sorted.</div>';

    // Cadence (derived from latest bill status)
    const paid = status === 'Paid';
    const dot = (c, ring) => `<div style="width:11px;height:11px;border-radius:50%;background:${c};${ring?'border:3px solid #d7d7f6;':''}"></div>`;
    const conn = `<div style="width:2px;height:32px;background:#eceef3;"></div>`;
    const cadence = latest ? `
        <div style="display:flex;gap:14px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;align-items:center;">${dot('#5b5bd6')}${conn}</div>
            <div style="margin-top:-3px;"><div style="font-size:13.5px;font-weight:700;">Weekly summary submitted</div><div style="font-size:12px;color:#8b91a0;">Week of ${cmEsc(range)}</div></div>
        </div>
        <div style="display:flex;gap:14px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;align-items:center;">${dot(paid?'#5b5bd6':'#5b5bd6', !paid)}${conn}</div>
            <div style="margin-top:-3px;"><div style="font-size:13.5px;font-weight:700;">Payment request ${paid?'':'<span style="color:#5b5bd6;">(current)</span>'}</div><div style="font-size:12px;color:#8b91a0;">${cmFmt(total)} due</div></div>
        </div>
        <div style="display:flex;gap:14px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;align-items:center;">${dot(paid?'#5b5bd6':'#dfe2ea')}</div>
            <div style="margin-top:-3px;"><div style="font-size:13.5px;font-weight:700;color:${paid?'#1a1d24':'#aeb4c2'};">Paid + fund replenished</div><div style="font-size:12px;color:${paid?'#8b91a0':'#c4c9d4'};">${paid?'Settled':'Awaiting client'}</div></div>
        </div>` : '<div style="font-size:13px;color:#aeb4c2;">No billing activity yet.</div>';

    // Recent entries — each bill shown on its REAL date (no synthetic 7-day range).
    const cmEntryDate = (d) => {
        if (!d) return '—';
        const x = new Date(d);
        if (isNaN(x.getTime())) return cmEsc(String(d));
        const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${M[x.getMonth()]} ${x.getDate()}, ${x.getFullYear()}`;
    };
    const recent = bills.slice(0, 4).map(b => {
        const st = b.status === 'Paid' ? ['PAID','#3f9960','#e7f5ed']
                 : b.status === 'Overdue' ? ['OVERDUE','#b91c1c','#fef2f2']
                 : ['SUBMITTED','#5b5bd6','#eef1fd'];
        const bDirect = b.directCostTotal || ((b.labor||0)+(b.materials||0)+(b.delivery||0)+(b.consumables||0)+(b.other||0));
        const amt = partner ? bDirect : (b.totalDue || 0);
        return `<tr style="border-top:1px solid #f0f1f5;">
            <td style="padding:13px 0;">${cmEsc(cmEntryDate(b.weekEndingDate))}</td>
            <td style="padding:13px 0;text-align:right;font-weight:700;">${cmFmt(amt)}</td>
            ${partner ? '' : `<td style="padding:13px 0;text-align:right;"><span style="font-size:11px;font-weight:700;background:${st[2]};color:${st[1]};padding:3px 10px;border-radius:20px;">${st[0]}</span></td>`}
        </tr>`;
    }).join('') || `<tr><td colspan="${partner?2:3}" style="padding:18px 0;color:#aeb4c2;font-size:13px;">No weekly records yet.</td></tr>`;

    const card = 'background:#fff;border-radius:20px;padding:24px;box-shadow:0 1px 3px rgba(20,25,40,0.06);';

    // ── Direct cost breakdown card (purple hero theme: period selector + proportion bar + 3 split boxes) ──
    const ovSelStyle = "font-size:12px !important;font-weight:700 !important;color:#5b5bd6 !important;border:none !important;border-radius:10px !important;padding:8px 32px 8px 14px !important;background-color:#fff !important;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235b5bd6' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\") !important;background-repeat:no-repeat !important;background-position:right 12px center !important;-webkit-appearance:none !important;-moz-appearance:none !important;appearance:none !important;cursor:pointer;box-shadow:0 2px 6px rgba(20,25,40,0.12);";
    // % of the PROJECT BUDGET consumed by a category (categoryAmount / budget).
    const ovBudget = Number(cmProjectData && cmProjectData.budget) || 0;
    const ovBudgetPctText = (val) => {
        if (ovBudget <= 0) return '';
        const p = (Number(val) || 0) / ovBudget * 100;
        return (p >= 10 ? p.toFixed(0) : p.toFixed(1)) + '% of budget';
    };
    // Bright chip so it stands out on the purple hero card.
    const ovBudgetPill = (val, id) =>
        `<span id="${id}" style="display:inline-block;font-size:11px;font-weight:800;color:#3a2f7a;background:#fff;border-radius:999px;padding:2px 10px;white-space:nowrap;">${ovBudgetPctText(val)}</span>`;

    const ovLegendBox = (label, swatch, amtId, pctId, val, pct, count, countId) => `
        <div class="cm-bd-box" style="flex:1 1 160px;min-width:0;display:flex;flex-direction:column;gap:8px;padding:14px 16px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.22);border-radius:13px;">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                <span style="width:10px;height:10px;border-radius:3px;background:${swatch};flex:none;"></span>
                <span style="font-size:12px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${label}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <div id="${amtId}" style="font-size:18px;font-weight:800;color:#fff;line-height:1;letter-spacing:-0.01em;white-space:nowrap;">${cmFmt(val)}</div>
                ${ovBudget > 0 ? ovBudgetPill(val, amtId + '-bpct') : ''}
            </div>
            <div style="font-size:10.5px;color:rgba(255,255,255,0.72);white-space:nowrap;"><span id="${pctId}">${pct}</span>% of direct cost · <span id="${countId}">${count} ${count === 1 ? 'entry' : 'entries'}</span></div>
        </div>`;
    const breakdownCard = `
    <div class="cm-bd-card" style="background:#5b5bd6;border-radius:20px;padding:24px;color:#fff;box-shadow:0 18px 36px -16px rgba(91,91,214,0.5);">
        <div class="cm-bd-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;">
            <div>
                <div style="font-size:16px;font-weight:800;color:#fff;">Direct cost breakdown</div>
                <div id="cm-ov-range-note" style="font-size:11.5px;color:rgba(255,255,255,0.8);margin-top:2px;">All time · ${(cmWeeklyBills||[]).length} entr${(cmWeeklyBills||[]).length === 1 ? 'y' : 'ies'}</div>
            </div>
            <div class="cm-ov-head-right cm-bd-head-right" style="display:flex;flex-direction:column;gap:11px;">

                <div style="display:flex;align-items:center;gap:7px;">
                    <span id="cm-ov-direct" style="font-size:21px;font-weight:800;color:#fff;line-height:1;white-space:nowrap;">${cmFmt(ovBd.direct)}</span>
                    <span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.8);">total</span>
                    ${ovBudget > 0 ? ovBudgetPill(ovBd.direct, 'cm-ov-direct-bpct') : ''}
                </div>
                <div class="cm-dd" id="cm-ov-dd" style="position:relative;">
                    <button type="button" class="cm-dd-btn" onclick="cmOvToggleRange(event)"><span id="cm-ov-dd-label">All time</span>${ovDdChevron}</button>
                    <div class="cm-dd-menu" id="cm-ov-dd-menu">${ovDdFixed}${ovDdWeekGroups ? '<div class="cm-dd-sep"></div>' + ovDdWeekGroups : ''}</div>
                    <input type="hidden" id="cm-ov-range" value="all">
                </div>
            </div>
        </div>
        <div style="display:flex;height:16px;gap:3px;margin-bottom:16px;background:rgba(255,255,255,0.15);border-radius:99px;padding:0;">
            <div id="cm-ov-seg-labor"     style="width:${ovBd.laborPct}%;background:#5fd0a0;border-radius:99px;${ovBd.labor    > 0 ? 'min-width:6px;' : ''}transition:width .25s ease;"></div>
            <div id="cm-ov-seg-materials" style="width:${ovBd.matPct}%;background:#f5c560;border-radius:99px;${ovBd.materials > 0 ? 'min-width:6px;' : ''}transition:width .25s ease;"></div>
            <div id="cm-ov-seg-combined"  style="width:${ovBd.combinedPct}%;background:#c3adf0;border-radius:99px;${ovBd.combined > 0 ? 'min-width:6px;' : ''}transition:width .25s ease;"></div>
        </div>
        <div class="cm-bd-legend" style="display:flex;gap:13px;flex-wrap:wrap;">
            ${ovLegendBox('Labor',             '#5fd0a0', 'cm-ov-labor',     'cm-ov-labor-pct',     ovBd.labor,     ovBd.laborPct,     ovBd.laborCount,     'cm-ov-labor-cnt')}
            ${ovLegendBox('Materials',         '#f5c560', 'cm-ov-materials', 'cm-ov-materials-pct', ovBd.materials, ovBd.matPct,       ovBd.matCount,       'cm-ov-materials-cnt')}
            ${ovLegendBox('Out Source', '#c3adf0', 'cm-ov-combined',  'cm-ov-combined-pct',  ovBd.combined,  ovBd.combinedPct,  ovBd.combinedCount,  'cm-ov-combined-cnt')}
        </div>
    </div>`;

    host.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:26px;">
        <div>
            <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:#1a1d24;">Overview</div>
            <div style="font-size:14px;color:#8b91a0;margin-top:3px;">Hello, ${cmEsc(first)}. Here's where the project stands today.</div>
        </div>
        <button id="cm-push-bell" onclick="cmPushToggle()" style="display:none;align-self:center;border:1px solid #e5e7eb;border-radius:10px;padding:9px 14px;background:#fff;color:#374151;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">🔔 Notify me daily</button>
    </div>

    ${partner ? `
    <!-- Partner: breakdown hero LEFT + KPI cards RIGHT on desktop; stacks (cards → breakdown) on mobile. -->
    <div class="cm-ov-row1 cm-ov-partner-grid" style="display:grid;gap:24px;align-items:stretch;">
        <div class="ov-cards" style="display:flex;flex-direction:column;gap:24px;justify-content:space-between;">
            <div style="${card}">
                <div style="font-size:13px;color:#8b91a0;font-weight:600;">Project Contract</div>
                <div style="font-size:34px;font-weight:800;margin-top:8px;letter-spacing:-0.02em;color:#1a1d24;">${ovContract > 0 ? cmFmt(ovContract) : '—'}</div>
                <div style="font-size:12px;color:#8b91a0;margin-top:6px;">Total agreed contract</div>
            </div>
            <div style="${card}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:28px;">
                    <span style="font-size:13px;color:#8b91a0;font-weight:600;">Total cash receipt</span>
                    ${ovContract > 0 ? `<span style="font-size:15px;font-weight:800;color:#fff;background:#15a35b;padding:7px 16px;border-radius:999px;white-space:nowrap;line-height:1;letter-spacing:.01em;box-shadow:0 3px 8px rgba(21,163,91,0.35);">${Math.round(ovPaid / ovContract * 100)}%</span>` : ''}
                </div>
                <div style="font-size:30px;font-weight:800;margin-top:6px;letter-spacing:-0.01em;color:#1a1d24;">${ovPaid > 0 ? cmFmt(ovPaid) : '—'}</div>
                ${ovContract > 0 ? `<div style="height:6px;background:#eceef3;border-radius:3px;margin-top:12px;overflow:hidden;"><div style="width:${Math.max(0, Math.min(100, Math.round(ovPaid / ovContract * 100)))}%;height:100%;background:#3f9960;"></div></div>` : ''}
                <div style="font-size:12px;color:#8b91a0;margin-top:${ovContract > 0 ? '9' : '6'}px;">${ovContract > 0 ? Math.round(ovPaid / ovContract * 100) + '% of project contract' : 'Total cash received'}</div>
            </div>
            <div style="${card}">
                <div style="font-size:13px;color:#8b91a0;font-weight:600;">Remaining cash receipt</div>
                <div style="font-size:30px;font-weight:800;margin-top:6px;letter-spacing:-0.01em;color:${ovNet >= 0 ? '#3f9960' : '#b91c1c'};">${ovNet < 0 ? '−' : ''}${cmFmt(Math.abs(ovNet))}</div>
                <div style="font-size:12px;color:#8b91a0;margin-top:6px;">${ovNet >= 0 ? 'paid over cash received' : 'direct cost over collections'}</div>
            </div>
        </div>
        <div class="ov-breakdown">${breakdownCard}</div>
    </div>
    ` : `
    <div class="cm-ov-row1" style="display:grid;grid-template-columns:1.55fr 1fr;gap:24px;align-items:stretch;">
        <div style="background:#5b5bd6;border-radius:20px;padding:22px 24px;color:#fff;box-shadow:0 18px 36px -16px rgba(91,91,214,0.5);">
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <span style="font-size:12.5px;font-weight:600;opacity:0.88;">This week's bill</span>
                ${latest ? `<span style="font-size:10.5px;font-weight:700;background:rgba(255,255,255,0.2);padding:4px 11px;border-radius:20px;">${duePill}</span>` : ''}
            </div>
            <div style="font-size:40px;font-weight:800;letter-spacing:-0.02em;margin-top:10px;">${cmFmt(total)}</div>
            <div style="font-size:12.5px;opacity:0.85;margin-top:4px;">${latest ? 'Week of ' + cmEsc(range) + ' · direct costs + ' + cmBillPct(latest) + '% fee' : 'No bill submitted yet'}</div>
            <div style="display:flex;gap:24px;margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.18);">
                <div><div style="font-size:11px;opacity:0.78;">Labor</div><div style="font-size:15px;font-weight:700;margin-top:2px;">${cmFmt(labor)}</div></div>
                <div><div style="font-size:11px;opacity:0.78;">Materials</div><div style="font-size:15px;font-weight:700;margin-top:2px;">${cmFmt(materials)}</div></div>
                <div><div style="font-size:11px;opacity:0.78;">Fee · ${cmBillPct(latest)}%</div><div style="font-size:15px;font-weight:700;margin-top:2px;">${cmFmt(fee)}</div></div>
            </div>
            <div style="display:flex;gap:10px;margin-top:18px;">
                <button onclick="showSection('weekly-billing')" style="flex:1;border:none;background:#fff;color:#5b5bd6;font-size:13.5px;font-weight:700;padding:12px;border-radius:12px;cursor:pointer;">View Weekly Summary</button>
                <button onclick="showSection('billing')" style="border:1px solid rgba(255,255,255,0.4);background:none;color:#fff;font-size:13.5px;font-weight:700;padding:12px 20px;border-radius:12px;cursor:pointer;">Payments</button>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:24px;">
            <div style="${card}">
                <div style="font-size:13px;color:#8b91a0;font-weight:600;">Revolving fund</div>
                <div style="font-size:30px;font-weight:800;margin-top:6px;letter-spacing:-0.01em;color:#1a1d24;">${cmFmt(rfBal)}</div>
                <div style="height:6px;background:#eceef3;border-radius:3px;margin-top:12px;overflow:hidden;"><div style="width:${rfPct}%;height:100%;background:#5b5bd6;"></div></div>
                <div style="font-size:12px;color:#8b91a0;margin-top:9px;">${cmFmt(rfSpent)} spent of ${cmFmt(rfTotal)}</div>
            </div>
            <div style="${card}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:28px;">
                    <span style="font-size:13px;color:#8b91a0;font-weight:600;">Total cash receipt</span>
                    ${ovContract > 0 ? `<span style="font-size:15px;font-weight:800;color:#fff;background:#15a35b;padding:7px 16px;border-radius:999px;white-space:nowrap;line-height:1;letter-spacing:.01em;box-shadow:0 3px 8px rgba(21,163,91,0.35);">${Math.round(ovPaid / ovContract * 100)}%</span>` : ''}
                </div>
                <div style="font-size:30px;font-weight:800;margin-top:6px;letter-spacing:-0.01em;color:#1a1d24;">${ovPaid > 0 ? cmFmt(ovPaid) : '—'}</div>
                ${ovContract > 0 ? `<div style="height:6px;background:#eceef3;border-radius:3px;margin-top:12px;overflow:hidden;"><div style="width:${Math.max(0, Math.min(100, Math.round(ovPaid / ovContract * 100)))}%;height:100%;background:#3f9960;"></div></div>` : ''}
                <div style="font-size:12px;color:#8b91a0;margin-top:${ovContract > 0 ? '9' : '6'}px;">${ovContract > 0 ? Math.round(ovPaid / ovContract * 100) + '% of project contract' : 'Total cash received'}</div>
            </div>
        </div>
    </div>

    <div style="margin-top:24px;">${breakdownCard}</div>
    `}

    <div class="cm-ov-row2" style="display:grid;grid-template-columns:${partner ? '1fr' : '1fr 1.2fr'};gap:24px;margin-top:24px;">
        ${partner ? '' : `<div style="${card}">
            <div style="font-size:14px;font-weight:700;margin-bottom:18px;color:#1a1d24;">This week's cadence</div>
            <div style="display:flex;flex-direction:column;">${cadence}</div>
        </div>`}
        <div style="${card}">
            <div style="font-size:14px;font-weight:700;margin-bottom:6px;color:#1a1d24;">Recent entries</div>
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#aeb4c2;font-weight:700;">
                    <th style="text-align:left;padding:10px 0;">Date</th>
                    <th style="text-align:right;padding:10px 0;">Total</th>
                    ${partner ? '' : '<th style="text-align:right;padding:10px 0;">Status</th>'}
                </tr></thead>
                <tbody style="font-size:14px;color:#1a1d24;">${recent}</tbody>
            </table>
        </div>
    </div>`;

    if (window.cmPushRefreshBell) cmPushRefreshBell();
}

// ── Revolving Fund (redesign: 3 KPI cards + expense ledger + replenishment) ──
async function cmRenderRevolving() {
    const host = document.getElementById('section-revolving-fund');
    if (!host) return;
    const card = 'background:#fff;border-radius:20px;padding:24px;box-shadow:0 1px 3px rgba(20,25,40,0.06);';

    const rf      = cmRevolvingFund;
    const initial = rf ? (rf.fundAmount || 0) : 0;
    const spent   = rf ? (rf.totalSpent || 0) : 0;
    const balance = rf ? (rf.currentBalance !== undefined ? rf.currentBalance : initial - spent) : 0;
    const pct     = initial > 0 ? Math.max(0, Math.min(100, Math.round((balance / initial) * 100))) : 0;
    const topup   = Math.max(0, initial - balance);

    // Expense ledger (with running balance, newest first)
    let ledger = '<tr><td colspan="4" style="padding:18px 0;color:#aeb4c2;font-size:13px;">No expenses recorded yet.</td></tr>';
    if (cmProjectData) {
        try {
            const snap = await db.collection('constructionProjects').doc(cmProjectData.id)
                .collection('revolvingFundExpenses').orderBy('date','desc').get();
            const exps = snap.docs.map(d => d.data());
            if (exps.length) {
                let running = balance;
                ledger = exps.map(e => {
                    const bal = running;
                    running += (e.amount || 0);
                    return `<tr style="border-top:1px solid #f0f1f5;">
                        <td style="padding:13px 0;color:#6b7180;">${cmEsc(e.date || '—')}</td>
                        <td style="padding:13px 0;font-weight:600;">${cmEsc(e.item || e.description || '—')}</td>
                        <td style="padding:13px 0;text-align:right;color:#b4892a;font-weight:700;">−${cmFmt(e.amount || 0)}</td>
                        <td style="padding:13px 0;text-align:right;">${cmFmt(bal)}</td>
                    </tr>`;
                }).join('');
            }
        } catch (e) { /* keep empty ledger */ }
    }

    host.innerHTML = `
    <div style="margin-bottom:24px;">
        <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:#1a1d24;">Revolving Fund</div>
        <div style="font-size:14px;color:#8b91a0;margin-top:3px;">Petty cash for minor and urgent site purchases — replenished every Friday with the weekly payment.</div>
    </div>

    <div class="cm-rf-kpis" style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;">
        <div style="${card}">
            <div style="font-size:13px;color:#8b91a0;font-weight:600;">Initial fund</div>
            <div style="font-size:28px;font-weight:800;margin-top:6px;letter-spacing:-0.01em;color:#1a1d24;">${cmFmt(initial)}</div>
        </div>
        <div style="${card}">
            <div style="font-size:13px;color:#8b91a0;font-weight:600;">Total spent</div>
            <div style="font-size:28px;font-weight:800;margin-top:6px;letter-spacing:-0.01em;color:#b4892a;">${cmFmt(spent)}</div>
        </div>
        <div style="background:#5b5bd6;border-radius:20px;padding:24px;box-shadow:0 12px 26px -14px rgba(91,91,214,0.5);color:#fff;">
            <div style="font-size:13px;opacity:0.85;font-weight:600;">Remaining balance</div>
            <div style="font-size:28px;font-weight:800;margin-top:6px;letter-spacing:-0.01em;">${cmFmt(balance)}</div>
        </div>
    </div>

    <div class="cm-rf-row" style="display:grid;grid-template-columns:1.5fr 1fr;gap:24px;margin-top:24px;">
        <div style="${card.replace('padding:24px','padding:24px 24px 8px')}">
            <div style="font-size:14px;font-weight:800;margin-bottom:6px;color:#1a1d24;">Expense ledger</div>
            <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
            <table style="width:100%;min-width:480px;border-collapse:collapse;">
                <thead><tr style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#aeb4c2;font-weight:700;">
                    <th style="text-align:left;padding:11px 0;">Date</th>
                    <th style="text-align:left;padding:11px 0;">Description</th>
                    <th style="text-align:right;padding:11px 0;">Amount</th>
                    <th style="text-align:right;padding:11px 0;">Balance</th>
                </tr></thead>
                <tbody style="font-size:14px;color:#1a1d24;">${ledger}</tbody>
            </table>
            </div>
        </div>
        <div style="${card}height:fit-content;">
            <div style="font-size:14px;font-weight:800;margin-bottom:14px;color:#1a1d24;">Replenishment</div>
            <div style="background:#f7f8fb;border-radius:15px;padding:18px;">
                <div style="font-size:12.5px;color:#8b91a0;">This Friday's top-up</div>
                <div style="font-size:26px;font-weight:800;margin-top:4px;letter-spacing:-0.01em;color:#1a1d24;">${cmFmt(topup)}</div>
                <div style="font-size:12px;color:#8b91a0;margin-top:6px;line-height:1.5;">Restores the fund back to ${cmFmt(initial)}, billed alongside the weekly payment.</div>
            </div>
            <div style="height:7px;background:#eceef3;border-radius:4px;margin-top:18px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:#5b5bd6;"></div></div>
            <div style="font-size:12px;color:#8b91a0;margin-top:8px;">${pct}% of fund remaining</div>
        </div>
    </div>`;
}

// Supply & install (Materials + Labor) amount for one bill. Prefers the stored
// `combined` field; 0 is treated as missing (default-0 column), so it falls back to
// the 'both' line entries — same rule as cmOvBreakdown.
function cmBillCombined(b) {
    let c = Number(b && b.combined) || 0;
    if (!c && Array.isArray(b && b.entries)) {
        c = b.entries.filter(e => e.type === 'both').reduce((s, e) => s + (Number(e.amount) || 0), 0);
    }
    return c || 0;
}

// ── Daily → weekly grouping (Sun–Sat) ─────────────────────────────────
// The admin records ONE bill per day; the partner Weekly Summary rolls those
// daily bills up into calendar weeks (Sunday–Saturday) and sums each bucket,
// mirroring the admin overview's _pmWeekStart. Without this, every day rendered
// as its own overlapping 7-day "week" and each row's total was really one day.
function cmWeekStartKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return String(dateStr || '');
    d.setDate(d.getDate() - d.getDay());   // back to that week's Sunday (local time)
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
}

// Roll cmWeeklyBills into [{ key, range, bills, rep, lab, mat, cmb, matP, dir, fee, tot, status }]
// newest week first. Per-bill math matches the old per-row formulas exactly.
function cmWeekGroups() {
    const map = new Map();
    (cmWeeklyBills || []).forEach(b => {
        const k = cmWeekStartKey(b.weekEndingDate);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(b);
    });
    const groups = [...map.entries()].map(([key, list]) => {
        list.sort((a, b) => (a.weekEndingDate || '').localeCompare(b.weekEndingDate || ''));
        let lab = 0, mat = 0, cmb = 0, dir = 0, fee = 0, tot = 0;
        list.forEach(b => {
            const bLab = Number(b.labor) || 0;
            const bMat = (Number(b.materials)||0)+(Number(b.delivery)||0)+(Number(b.consumables)||0)+(Number(b.other)||0);
            const bCmb = cmBillCombined(b);
            const bDir = b.directCostTotal != null ? Number(b.directCostTotal) : (bLab + bMat);
            const bFee = b.managementFee != null ? Number(b.managementFee)
                       : bDir * (b.managementFeeRate != null ? Number(b.managementFeeRate) : cmFeeRate());
            const bTot = b.totalDue != null ? Number(b.totalDue) : (bDir + bFee);
            lab += bLab; mat += bMat; cmb += bCmb; dir += bDir; fee += bFee; tot += bTot;
        });
        const statuses = list.map(b => b.status || 'Submitted');
        const status = statuses.every(s => s === 'Paid') ? 'Paid'
                     : statuses.some(s => s === 'Overdue') ? 'Overdue'
                     : statuses.some(s => s === 'Partial') ? 'Partial'
                     : 'Submitted';
        return { key, bills: list, rep: list[list.length - 1], range: cmWeekRangeLabel(key),
                 lab, mat, cmb, matP: Math.max(0, mat - cmb), dir, fee, tot, status };
    });
    groups.sort((a, b) => b.key.localeCompare(a.key));   // newest week first
    return groups;
}

// The admin's weekly revolving-fund entry for a given week (key = the week's Sunday,
// which matches the admin's `weekStart`). null when no fund was set for that week.
function cmFundForWeek(weekKey) {
    return (cmFundRequests || []).find(r => r.weekStart === weekKey) || null;
}

// Pick which submitted week to show in the Weekly Summary detail card (key = week's Sunday).
window.cmWeekSelect = function(key) {
    cmWeekSelId = key;
    cmRenderWeekly();
    const host = document.getElementById('section-weekly-billing');
    if (host && window.innerWidth <= 700) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ── Weekly Summary (redesign: read-only current week + computed + submitted weeks) ──
function cmRenderWeekly() {
    const host = document.getElementById('section-weekly-billing');
    if (!host) return;
    cmEnsureDdStyle();   // dropdown styles must exist before the menu renders (else it shows unstyled)
    const card = 'background:#fff;border-radius:20px;padding:24px;box-shadow:0 1px 3px rgba(20,25,40,0.06);';

    if (!cmProjectData) {
        host.innerHTML = `<div style="${card}text-align:center;color:#aeb4c2;padding:60px 20px;">No project assigned yet.</div>`;
        return;
    }

    const weeks = cmWeekGroups();   // daily bills rolled into Sun–Sat weeks
    const mostRecent = weeks[0] || null;
    // The detail card shows the selected week (clicked from the table), else the latest.
    const latest = (cmWeekSelId && weeks.find(w => w.key === cmWeekSelId)) || mostRecent;
    const isLatest = !!(latest && mostRecent && latest.key === mostRecent.key);
    const labor     = latest ? latest.lab : 0;
    const materials = latest ? latest.mat : 0;
    const combined  = latest ? latest.cmb : 0;            // Materials + Labor (supply & install)
    const matPure   = latest ? latest.matP : 0;           // materials without the combined amount
    const direct    = latest ? latest.dir : 0;
    const fee       = latest ? latest.fee : 0;
    const total     = latest ? latest.tot : 0;
    const range     = latest ? latest.range : '—';
    const status    = latest ? latest.status : '';
    const partner   = cmIsPartner();   // monitoring/view-only: no 15% fee
    // Week-picker dropdown options (newest first) — selecting one shows that week above.
    const wkOpts = weeks.map(w => {
        const a = latest && w.key === latest.key;
        return `<button class="cm-dd-opt${a ? ' active' : ''}" onclick="cmWeekSelect('${w.key}')"><span>${cmEsc(w.range)}</span><span class="cm-dd-check">✓</span></button>`;
    }).join('');

    const rows = weeks.map(w => {
        const st  = w.status === 'Paid' ? ['PAID','#3f9960','#e7f5ed']
                  : w.status === 'Overdue' ? ['OVERDUE','#b91c1c','#fef2f2']
                  : ['DUE','#5b5bd6','#eef1fd'];
        const sel = latest && w.key === latest.key;
        return `<tr onclick="cmWeekSelect('${cmEsc(w.key)}')" style="border-top:1px solid #f0f1f5;cursor:pointer;background:${sel ? '#f1f1fb' : 'transparent'};">
            <td style="padding:14px 0;font-weight:600;">${cmEsc(w.range)}</td>
            <td style="padding:14px 0;text-align:right;">${cmFmt(w.lab)}</td>
            <td style="padding:14px 0;text-align:right;">${cmFmt(w.matP)}</td>
            <td style="padding:14px 0;text-align:right;">${w.cmb ? cmFmt(w.cmb) : '<span style="color:#c4c9d4;">—</span>'}</td>
            ${partner ? '' : `<td style="padding:14px 0;text-align:right;color:#5b5bd6;">${cmFmt(w.fee)}</td>`}
            <td style="padding:14px 0;text-align:right;font-weight:700;">${cmFmt(partner ? w.dir : w.tot)}</td>
            <td style="padding:14px 0;text-align:right;"><span style="font-size:11px;font-weight:700;background:${st[2]};color:${st[1]};padding:3px 10px;border-radius:20px;">${st[0]}</span></td>
        </tr>`;
    }).join('') || `<tr><td colspan="${partner?6:7}" style="padding:18px 0;color:#aeb4c2;font-size:13px;">No weekly records yet.</td></tr>`;

    // Per-week Statement of Account rows (one Generate button per week).
    const soaRows = weeks.map(w => {
        const tot = partner ? w.dir : w.tot;
        return `<div style="display:flex;align-items:center;gap:12px;padding:14px 0;border-top:1px solid #f0f1f5;">
            <span style="width:4px;height:30px;border-radius:3px;background:#5b5bd6;flex:none;"></span>
            <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:700;color:#1a1d24;">Week of ${cmEsc(w.range)}</div>
                <div style="font-size:12px;color:#aeb4c2;">${cmFmt(tot)} · ${cmEsc(w.status)}</div>
            </div>
            <button onclick="cmWeekSOA('${cmEsc(w.key)}')" style="font-size:12.5px;font-weight:700;color:#fff;background:#5b5bd6;border:none;border-radius:9px;padding:9px 16px;cursor:pointer;flex:none;">Generate</button>
        </div>`;
    }).join('') || `<div style="padding:18px 0;color:#aeb4c2;font-size:13px;border-top:1px solid #f0f1f5;">No submitted weeks yet.</div>`;

    // Top KPI strip. Partners no longer see the revolving fund / difference here
    // (revolving fund is admin-only); their Labor / Materials / Out Source / Direct
    // total live in the breakdown box below. The client keeps the labor/materials KPIs.
    const kpiCell = (label, valHtml) =>
        `<div><div style="font-size:12.5px;font-weight:700;color:#6b7180;">${label}</div><div style="font-size:21px;font-weight:800;margin-top:7px;letter-spacing:-0.01em;">${valHtml}</div></div>`;
    const topGrid = partner
        ? ''
        : `<div style="display:grid;grid-template-columns:${combined > 0 ? 'repeat(3,1fr)' : '1fr 1fr'};gap:18px;">
            ${kpiCell('Total labor', cmFmt(labor))}
            ${kpiCell('Total materials', cmFmt(matPure))}
            ${combined > 0 ? kpiCell('Out Source', cmFmt(combined)) : ''}
          </div>`;

    host.innerHTML = `
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:26px;flex-wrap:wrap;gap:14px;">
        <div>
            <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:#1a1d24;">Weekly Summary</div>
            <div style="font-size:14px;color:#8b91a0;margin-top:3px;">${partner ? 'Total labor and materials recorded each week.' : 'Total labor and materials per week. The ' + cmFeePct() + '% management fee and grand total are computed automatically.'}</div>
        </div>
        ${latest ? `<div class="cm-dd" id="cm-wk-dd" style="position:relative;">
            <button type="button" class="cm-dd-btn cm-dd-btn-light" onclick="cmDdToggle('cm-wk-dd',event)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5b5bd6" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>Week of ${cmEsc(range)}</span>
              <svg class="cm-dd-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="cm-dd-menu" id="cm-wk-dd-menu">${wkOpts}</div>
        </div>` : ''}
    </div>

    <div class="cm-wk-row" style="display:grid;grid-template-columns:1.4fr 1fr;gap:24px;">
        <div style="${card.replace('padding:24px','padding:28px')}">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <div style="font-size:15px;font-weight:800;color:#1a1d24;">${isLatest ? 'This week' : 'Selected week'}</div>
                ${isLatest ? '' : `<button onclick="cmWeekSelect(null)" style="font-size:11.5px;font-weight:700;color:#5b5bd6;background:#eef1fd;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;">← Back to latest</button>`}
            </div>
            <div style="font-size:12.5px;color:#8b91a0;margin-top:2px;margin-bottom:22px;">${latest ? 'Week of ' + cmEsc(range) : 'No bill submitted yet'}</div>
            ${topGrid}
            <div style="margin-top:22px;background:#f7f8fb;border-radius:15px;padding:20px 22px;">
                <div style="display:flex;justify-content:space-between;padding:9px 0;font-size:14px;"><span style="color:#6b7180;">${partner ? 'Labor' : 'Direct costs'}</span><span style="font-weight:700;">${cmFmt(partner ? labor : direct)}</span></div>
                <div style="display:flex;justify-content:space-between;padding:9px 0;font-size:14px;border-top:1px solid #ebedf2;"><span style="color:#6b7180;">${partner ? 'Materials' : 'Management fee · ' + cmBillPct(latest && latest.rep) + '%'}</span><span style="font-weight:700;${partner?'':'color:#5b5bd6;'}">${cmFmt(partner ? matPure : fee)}</span></div>
                ${partner && combined > 0 ? `<div style="display:flex;justify-content:space-between;padding:9px 0;font-size:14px;border-top:1px solid #ebedf2;"><span style="color:#6b7180;">Out Source</span><span style="font-weight:700;">${cmFmt(combined)}</span></div>` : ''}
                <div style="display:flex;justify-content:space-between;align-items:center;padding:13px 0 4px;font-size:14px;border-top:1px solid #ebedf2;margin-top:4px;"><span style="font-weight:700;">${partner ? 'Direct total' : 'Grand total'}</span><span style="font-weight:800;font-size:24px;letter-spacing:-0.01em;">${cmFmt(partner ? direct : total)}</span></div>
            </div>
            ${latest ? `<div style="margin-top:18px;font-size:12.5px;color:#8b91a0;">Status: <strong style="color:${status==='Paid'?'#3f9960':status==='Overdue'?'#b91c1c':'#5b5bd6'};">${cmEsc(status)}</strong> · recorded daily</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:20px;">
            ${partner ? '' : `<div style="${card}">
                <div style="font-size:14px;font-weight:800;margin-bottom:12px;color:#1a1d24;">How it's computed</div>
                <div style="font-family:'Space Mono',monospace;font-size:12.5px;color:#6b7180;background:#f7f8fb;border-radius:12px;padding:14px;line-height:1.7;">(Labor + Materials)<br/>&nbsp;&nbsp;× ${cmBillPct(latest && latest.rep)}% = <span style="color:#5b5bd6;">Fee</span><br/>Direct + Fee = <span style="font-weight:700;color:#1a1d24;">Total</span></div>
            </div>`}
            <div style="${card}">
                <div style="font-size:14px;font-weight:800;margin-bottom:8px;color:#1a1d24;">Cost notice</div>
                <div style="font-size:12.5px;color:#8b91a0;line-height:1.55;">Prices may vary with market conditions and material availability. All figures reflect actual recorded costs at billing time.</div>
            </div>
        </div>
    </div>

    <div style="${card.replace('padding:24px','padding:24px 24px 8px')}margin-top:24px;">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
            <div style="font-size:14px;font-weight:800;color:#1a1d24;">Submitted weeks</div>
            <div style="font-size:11.5px;color:#aeb4c2;">Tap a week to view its details above</div>
        </div>
        <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
        <table style="width:100%;min-width:620px;border-collapse:collapse;">
            <thead><tr style="font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:#aeb4c2;font-weight:700;">
                <th style="text-align:left;padding:11px 0;">Week</th>
                <th style="text-align:right;padding:11px 0;">Labor</th>
                <th style="text-align:right;padding:11px 0;">Materials</th>
                <th style="text-align:right;padding:11px 0;">Out Source</th>
                ${partner ? '' : '<th style="text-align:right;padding:11px 0;">Fee</th>'}
                <th style="text-align:right;padding:11px 0;">Total</th>
                <th style="text-align:right;padding:11px 0;">Status</th>
            </tr></thead>
            <tbody style="font-size:14px;color:#1a1d24;">${rows}</tbody>
        </table>
        </div>
    </div>

    <div style="${card}margin-top:24px;">
        <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
            <div style="font-size:14px;font-weight:800;color:#1a1d24;">Statements of account</div>
            <div style="font-size:11.5px;color:#aeb4c2;">Per week · all categories · PDF</div>
        </div>
        ${soaRows}
    </div>`;
}

// ── Statement of Account (per week, all categories) ───────────────
// Collect every line entry in one week's bill (labor / materials / mat+labor).
function _cmWeekRows(b) {
    const out = [];
    const catName = t => t === 'both' ? 'Out Source' : t === 'materials' ? 'Materials' : 'Labor';
    const metaOf = (t, e) => t === 'labor' ? (Number(e.days) ? Number(e.days) + (Number(e.days) === 1 ? ' day' : ' days') : '')
        : t === 'materials' ? (Number(e.qty) ? Number(e.qty) + ' ' + (e.unit || 'pcs') : '')
        : 'supply & install';
    if (Array.isArray(b.entries) && b.entries.length) {
        ['labor', 'materials', 'both'].forEach(t => {
            b.entries.filter(e => e.type === t).forEach(e => {
                const m = metaOf(t, e);
                out.push({ date: b.weekEndingDate, desc: catName(t) + ' · ' + (e.details || '—') + (m ? ' · ' + m : ''), amount: Number(e.amount) || 0 });
            });
        });
    } else {
        // Legacy bill without an entries[] array — synthesize from totals.
        const c = cmBillCombined(b);
        const matPure = Math.max(0, ((b.materials||0)+(b.delivery||0)+(b.consumables||0)+(b.other||0)) - c);
        if (b.labor) out.push({ date: b.weekEndingDate, desc: 'Labor · total', amount: Number(b.labor) || 0 });
        if (matPure) out.push({ date: b.weekEndingDate, desc: 'Materials · total', amount: matPure });
        if (c)       out.push({ date: b.weekEndingDate, desc: 'Out Source · supply & install', amount: c });
    }
    return out;
}

window.cmWeekSOA = function(weekKey) {
    if (!cmProjectData) { alert('No project assigned yet.'); return; }
    const group = cmWeekGroups().find(w => w.key === weekKey);
    if (!group) { alert('Week not found.'); return; }
    const rangeLabel = group.range;
    const label = 'Week of ' + rangeLabel;
    // Every line across all daily bills in the week, each date-stamped (bills sorted oldest→newest).
    const rows = group.bills.flatMap(b => _cmWeekRows(b));
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const client   = cmProjectData.clientName || cmProjectData.projectName || '—';
    const project  = cmProjectData.projectName || '—';
    const location = cmProjectData.location || cmProjectData.address || '';
    const today = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
    const fmtDate = d => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }); } catch (e) { return d || '—'; } };
    const descOf = r => r.desc;
    const fmtN = n => Math.round(Number(n) || 0).toLocaleString('en-US');
    const period = rangeLabel;
    const ref = 'SOA-WK-' + (group.key ? String(group.key).replace(/-/g, '') : String(rows.length).padStart(3, '0'));

    const rowsHtml = rows.length
        ? rows.map((r, i) => `<tr style="background:${i % 2 ? '#f4f8f5' : '#fff'};">
            <td class="d">${cmEsc(fmtDate(r.date))}</td>
            <td class="desc">${cmEsc(descOf(r))}</td>
            <td class="amt">${fmtN(r.amount)}</td>
          </tr>`).join('')
        : `<tr><td colspan="3" style="text-align:center;color:#9aa8a0;padding:26px;">No entries recorded for this week.</td></tr>`;

    const pdfData = {
        label, client, project, location, today, period, ref,
        body: rows.map(r => [fmtDate(r.date), descOf(r), fmtN(r.amount)]),
        total: fmtN(total),
        fname: `${ref}-${(String(project).replace(/[^A-Za-z0-9]+/g, '') || 'project')}.pdf`
    };
    const pdfJson = JSON.stringify(pdfData).replace(/</g, '\\u003c');

    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to open the statement.'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${cmEsc(ref)} — ${cmEsc(label)} — ${cmEsc(client)}</title>
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
            <div class="subtitle">Building Design &middot; Construction Management${location ? ' &middot; ' + cmEsc(location) : ''}</div>
            <div class="doctitle">STATEMENT OF ACCOUNT</div>
            <div class="docsub">${cmEsc(label)} &middot; weekly statement</div>
          </div>
          <div class="meta">
            <div><div class="meta-l">Project</div><div class="meta-v">${cmEsc(project)}</div></div>
            <div><div class="meta-l">Client</div><div class="meta-v">${cmEsc(client)}</div></div>
            <div><div class="meta-l">Period</div><div class="meta-v">${cmEsc(period)}</div></div>
            <div><div class="meta-l">Ref no.</div><div class="meta-v mono">${cmEsc(ref)}</div></div>
          </div>
          <table>
            <thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
            <tfoot><tr><td class="lbl" colspan="2">Total (PHP)</td><td class="tot">${fmtN(total)}</td></tr></tfoot>
          </table>
          <div class="note">Amounts in PHP. This statement lists every recorded entry for the ${cmEsc(label.toLowerCase())}. Generated ${cmEsc(today)} &middot; DAC'S client portal.</div>
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
          doc.text(D.label + " - weekly statement", pw/2, 38, {align:'center'});
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
          doc.text(doc.splitTextToSize("Amounts in PHP. This statement lists every recorded entry for the " + D.label.toLowerCase() + ". Generated " + D.today + " - DAC'S client portal.", pw - 28), 14, fy);
          doc.save(D.fname);
        }
      <\/script>
    </body></html>`);
    w.document.close();
};

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
        // ── Contract Value — partner monitoring view only.
        //    Hidden on the Cost-Plus client portal, where the contract figure
        //    isn't the client's billing basis.
        ...(cmIsPartner() ? [{
            label: 'Project Budget',
            value: budget > 0 ? cmFmt(budget) : '—',
            sub:   'Total agreed contract',
            ...PALETTE.green,
            icon:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>'
        }] : []),
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

    // Partners don't get Payments (billing / statement of account).
    const visibleFolders = cmIsPartner() ? folders.filter(f => f.id !== 'billing') : folders;
    grid.innerHTML = visibleFolders.map(f => `
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

    const partner = cmIsPartner();
    el.innerHTML = `<div class="table-scroll"><table class="data-table">
        <thead><tr>
            <th>Week Ending</th>
            <th>Labor</th>
            <th>Materials</th>
            <th>${partner ? 'Direct Total' : 'Total Due'}</th>
            ${partner ? '' : '<th>Status</th>'}
        </tr></thead>
        <tbody>
            ${bills.map(b => {
                const ss = statusStyles[b.status] || { bg:'#f3f4f6', color:'#6b7280' };
                const matCost = (b.materials || 0) + (b.delivery || 0) + (b.consumables || 0) + (b.other || 0);
                const directTotal = b.directCostTotal || ((b.labor || 0) + matCost);
                const amount = partner ? directTotal : (b.totalDue || 0);
                return `<tr>
                    <td><strong>${cmEsc(b.weekEndingDate || '—')}</strong></td>
                    <td>${cmFmt(b.labor || 0)}</td>
                    <td>${cmFmt(matCost)}</td>
                    <td><strong>${cmFmt(amount)}</strong></td>
                    ${partner ? '' : `<td><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:700;background:${ss.bg};color:${ss.color};">${cmEsc(b.status)}</span></td>`}
                </tr>`;
            }).join('')}
        </tbody>
    </table></div>`;
}

// ══════════════════════════════════════════════════════════════════
// COST-PLUS AGREEMENT
// ══════════════════════════════════════════════════════════════════

async function cmCheckAgreement() {
    // First-login agreement gate — applies to BOTH clients and partners. The user
    // cannot reach the dashboard until they read it, tick the box, type their name
    // as a digital signature, and Accept.
    // Clients sign the Cost-Plus agreement; partners sign the PARTNERSHIP agreement
    // (different document, different modal content per HTML file) — so acceptance is
    // tracked in separate fields and one signature never covers the other document.
    const accepted = cmIsPartner()
        ? cmCurrentProfile?.partnerAgreementAccepted === true
        : cmCurrentProfile?.agreementAccepted === true;
    if (accepted) {
        cmRouteAfterLogin();
    } else {
        // Make sure the CURRENT (possibly admin-edited) template version is
        // loaded before the document renders — what they read is what they sign.
        try { if (window.dacsLoadAgreementTemplates) await window.dacsLoadAgreementTemplates(); } catch (_) {}
        const modal = document.getElementById('cm-agreement-modal');
        if (modal) modal.style.display = '';
        // Initialise the drawing pad once the modal is visible (needs real size).
        setTimeout(cmInitSignaturePad, 60);
        // Pre-fill the signature hint with the account's name (editable).
        const sig = document.getElementById('cm-agreement-signature');
        if (sig && !sig.value) {
            const nm = cmCurrentProfile
                ? [cmCurrentProfile.firstName, cmCurrentProfile.lastName].filter(Boolean).join(' ').trim()
                : '';
            if (nm) sig.setAttribute('data-expected', nm);
        }
        // Partner portal: the modal is a 3-step gate (read → e-sign → review signed
        // copy). Start it at step 1. Client portal: render the agreement sections
        // from the canonical client document instead.
        if (document.getElementById('cm-agr-step-1')) cmAgrGoStep(1);
        else _cmClientAgrRenderSections();
    }
}

// Fill the CLIENT agreement modal's body from the canonical document
// (dacsClientAgreementDoc in print-utils.js) so what the client reads is
// word-for-word what the signed PDF reprints. Keeps the modal's numbered-chip
// section styling; no-ops on the partner portal (container absent there).
function _cmClientAgrRenderSections() {
    const host = document.getElementById('cm-client-agr-sections');
    if (!host || typeof window.dacsClientAgreementDoc !== 'function') return;
    const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    // Uploaded-PDF agreement: extract its section text and render it in the
    // same numbered-chip design as the standard document.
    const tpl = (typeof window.dacsAgrTemplate === 'function') ? window.dacsAgrTemplate('client') : { mode: 'sections' };
    const renderList = (secsOverride) => {
        const doc = window.dacsClientAgreementDoc(_cmAgrPartnerName(), cmProjectData, '', secsOverride);
        host.innerHTML = (doc.sections || []).map((s, i) => {
            const title = String(s.heading || '').replace(/^\d+\.\s*/, '');
            return (i ? '<div class="cm-agreement-divider"></div>' : '')
                + '<div class="cm-agreement-section">'
                + '<div class="cm-agreement-section-title"><span class="cm-agreement-section-num">' + (i + 1) + '</span> ' + esc(title) + '</div>'
                + '<p style="white-space:pre-wrap;">' + esc(s.body) + '</p>'
                + '</div>';
        }).join('');
    };
    if (tpl.mode === 'pdf' && tpl.pdfUrl && typeof window.dacsAgrPdfSections === 'function') {
        host.innerHTML = '<div style="padding:40px 0;text-align:center;color:#9ca3af;font-size:13px;">Loading the agreement…</div>';
        window.dacsAgrPdfSections(tpl.pdfUrl)
            .then(ps => renderList((ps && ps.length) ? ps : null))
            .catch(() => renderList(null));
        return;
    }
    renderList(null);
}

// ── Partner agreement signing stepper (Dacs Partnership.html only) ─────────
// Step 1: the agreement rendered as the actual PDF document (iframe, no print).
// Step 2: tick the box + draw a signature + type the printed name.
// Step 3: review the SAME document with the e-signature, name & date applied,
//         then Accept (the existing cmAcceptAgreement saves it).
// The document comes from window.dacsPartnerAgreementDoc (print-utils.js) — the
// same definition the portal download and the admin print use, so what the
// partner reads and signs is exactly what reprints later.
let _cmAgrStep = 1;

function _cmAgrPartnerName() {
    return (document.getElementById('cm-agreement-signature')?.value || '').trim()
        || (cmCurrentProfile ? [cmCurrentProfile.firstName, cmCurrentProfile.lastName].filter(Boolean).join(' ').trim() : '')
        || (cmCurrentUser?.email || '');
}

// Render the agreement as an inline paper sheet (Partnership Agreement Gate
// design). Content comes from the canonical dacsPartnerAgreementDoc so the
// gate, the PDF download, and the admin print always show the same document.
function _cmAgrRenderPaper(elId, signed) {
    // Uploaded-PDF agreement: extract its SECTION TEXT and render it in the
    // same elegant paper design as the standard document (raw PDF-page
    // rendering was rejected — it reads small and dense). Falls back to the
    // standard text if the PDF yields no parseable sections.
    const tplP = (typeof window.dacsAgrTemplate === 'function') ? window.dacsAgrTemplate('partner') : { mode: 'sections' };
    if (tplP.mode === 'pdf' && tplP.pdfUrl && typeof window.dacsAgrPdfSections === 'function') {
        const el0 = document.getElementById(elId);
        if (el0 && !el0.dataset.agrLoaded) {
            el0.innerHTML = '<div style="padding:40px 0;text-align:center;color:#9ca3af;font-size:13px;">Loading the agreement…</div>';
        }
        window.dacsAgrPdfSections(tplP.pdfUrl)
            .then(ps => { if (el0) el0.dataset.agrLoaded = '1'; _cmAgrRenderPaperBody(elId, signed, (ps && ps.length) ? ps : null); })
            .catch(() => _cmAgrRenderPaperBody(elId, signed, null));
        return;
    }
    _cmAgrRenderPaperBody(elId, signed, null);
}

function _cmAgrRenderPaperBody(elId, signed, secsOverride) {
    const el = document.getElementById(elId);
    if (!el || typeof window.dacsPartnerAgreementDoc !== 'function') return;
    const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const now = new Date();
    const dayStr = now.toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
    const typed = (document.getElementById('cm-agreement-signature')?.value || '').trim();
    const name = (signed && typed) ? typed : _cmAgrPartnerName();
    const doc = window.dacsPartnerAgreementDoc(name, cmProjectData, dayStr, secsOverride);
    const secs = (doc.sections || []).map(s =>
        `<div class="cm-agr-p-sec"><div class="cm-agr-p-h">${esc(s.heading)}</div><p style="white-space:pre-wrap;">${esc(s.body)}</p></div>`).join('');
    const sigImg = (signed && _cmSigPad.hasInk && _cmSigPad.canvas) ? _cmSigPad.canvas.toDataURL('image/png') : '';
    const signBlock = signed
        ? `<div class="cm-agr-p-signrow">
             <div>${sigImg ? `<div class="cm-agr-p-sigimg" style="background-image:url(${sigImg});"></div>` : ''}
               <div class="cm-agr-p-signame">${esc(name)}</div>
               <div class="cm-agr-p-siglbl">${esc(name)} — Partner · Signed electronically on ${esc(dayStr)}</div></div>
             <div><img src="assets/images/dacs-signature.png" alt="" onerror="this.style.display='none'" style="height:34px;display:block;margin:0 auto 2px;"/><div class="cm-agr-p-sigline"></div><div class="cm-agr-p-siglbl">DAC's Building Design Services — Authorized Representative</div></div>
           </div>`
        : `<div class="cm-agr-p-signrow">
             <div><div class="cm-agr-p-sigline"></div><div class="cm-agr-p-siglbl">${esc(name)} — Partner</div></div>
             <div><img src="assets/images/dacs-signature.png" alt="" onerror="this.style.display='none'" style="height:34px;display:block;margin:0 auto 2px;"/><div class="cm-agr-p-sigline"></div><div class="cm-agr-p-siglbl">DAC's Building Design Services — Authorized Representative</div></div>
           </div>`;
    el.innerHTML = `
      <div class="cm-agr-p-head">
        <img src="assets/images/DACS-TRANSPARENT.png" alt="DAC's logo"/>
        <div class="cm-agr-p-title">DAC's Partnership Agreement</div>
        <div class="cm-agr-p-subtitle">Partner Agreement · ${signed ? 'Signed Copy' : 'Official Document'}</div>
        <div class="cm-agr-p-rule"></div>
      </div>
      <div class="cm-agr-p-parties">
        <div>Partner</div><div class="b">${esc(name)}</div>
        <div>Company</div><div>DAC's Building Design Services</div>
        <div>${signed ? 'Signed on' : 'Date'}</div><div>${esc(dayStr)}</div>
      </div>
      <p class="cm-agr-p-pre">${esc(doc.preamble)}</p>
      ${secs}
      ${signBlock}
      <div class="cm-agr-p-end">— End of agreement —</div>`;
}

window.cmAgrGoStep = function(n) {
    if (!document.getElementById('cm-agr-step-1')) return;   // no gate markup (client portal)
    _cmAgrStep = n;
    [1, 2, 3].forEach(i => {
        const p = document.getElementById('cm-agr-step-' + i);
        if (p) p.style.display = (i === n) ? '' : 'none';
    });
    // Top progress bar + step label ("Step 1 of 2" / "Step 2 of 2" / "Complete")
    const fill = document.getElementById('cm-agr-progress-fill');
    if (fill) fill.style.width = n === 1 ? '50%' : n === 2 ? '85%' : '100%';
    const lbl = document.getElementById('cm-agr-steplabel');
    if (lbl) lbl.textContent = n === 3 ? 'Complete' : 'Step ' + n + ' of 2';

    if (n === 1) {
        const w = document.getElementById('cm-agr-welcome');
        const first = (cmCurrentProfile && cmCurrentProfile.firstName) || _cmAgrPartnerName().split(' ')[0] || 'Partner';
        if (w) w.textContent = 'Welcome, ' + first;
        _cmAgrRenderPaper('cm-agr-paper-read', false);
    }
    if (n === 2) {
        // Canvas needs its real on-screen size — init only once the panel is visible.
        setTimeout(cmInitSignaturePad, 60);
        cmToggleAgreementBtn();
    }
    if (n === 3) {
        _cmAgrRenderPaper('cm-agr-paper-signed', true);
        cmToggleAgreementBtn();
    }
    const modal = document.getElementById('cm-agreement-modal');
    if (modal) modal.scrollTop = 0;
};

// "Download my signed copy (PDF)" on the done step — prints the signed document
// from the live pad/name (the profile fields are saved on Enter-the-portal).
window.cmAgrDownloadPreview = function() {
    if (typeof window.dacsAgreementPdf !== 'function' || typeof window.dacsPartnerAgreementDoc !== 'function') return;
    const sigName = (document.getElementById('cm-agreement-signature')?.value || '').trim() || _cmAgrPartnerName();
    const img = (_cmSigPad.hasInk && _cmSigPad.canvas) ? _cmSigPad.canvas.toDataURL('image/png') : '';
    const now = new Date();
    const dateStr = now.toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const dayStr  = now.toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
    window.dacsAgreementPdf({
        ...window.dacsPartnerAgreementDoc(sigName, cmProjectData, dayStr),
        signature: sigName, signatureImage: img, dateStr
    });
};

window.cmAgrNext = function() {
    if (_cmAgrStep === 1) { cmAgrGoStep(2); return; }
    if (_cmAgrStep === 2) {
        const cb  = document.getElementById('cm-agreement-checkbox');
        const sig = document.getElementById('cm-agreement-signature');
        if (!(cb && cb.checked) || !sig || sig.value.trim().length < 2) return;
        cmAgrGoStep(3);
    }
};
window.cmAgrBack = function() { if (_cmAgrStep > 1) cmAgrGoStep(_cmAgrStep - 1); };

window.cmOpenMvpModal = function() {
    const el = document.getElementById('cm-mvp-modal');
    if (el) { el.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
};
window.cmCloseMvpModal = function() {
    const el = document.getElementById('cm-mvp-modal');
    if (el) { el.style.display = 'none'; document.body.style.overflow = ''; }
};

// ── Signature pad (draw with mouse/finger) ───────────────────────────────
let _cmSigPad = { canvas: null, ctx: null, drawing: false, hasInk: false, bound: false };
function cmInitSignaturePad() {
    const canvas = document.getElementById('cm-signature-pad');
    if (!canvas) return;
    // Size the backing store to the element's CSS size (crisp lines, correct coords).
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
    _cmSigPad.canvas = canvas; _cmSigPad.ctx = ctx; _cmSigPad.hasInk = false;

    if (_cmSigPad.bound) return;   // only attach listeners once
    _cmSigPad.bound = true;
    const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        const p = e.touches ? e.touches[0] : e;
        return { x: p.clientX - r.left, y: p.clientY - r.top };
    };
    const start = (e) => {
        e.preventDefault();
        _cmSigPad.drawing = true;
        const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y);
        const hint = document.getElementById('cm-signature-hint');
        if (hint) hint.style.display = 'none';
    };
    const move = (e) => {
        if (!_cmSigPad.drawing) return;
        e.preventDefault();
        const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke();
        _cmSigPad.hasInk = true;
        cmToggleAgreementBtn();
    };
    const end = () => { _cmSigPad.drawing = false; cmToggleAgreementBtn(); };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end);
}
window.cmClearSignature = function() {
    const c = _cmSigPad.canvas, ctx = _cmSigPad.ctx;
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    _cmSigPad.hasInk = false;
    const hint = document.getElementById('cm-signature-hint');
    if (hint) hint.style.display = '';
    cmToggleAgreementBtn();
};

window.cmToggleAgreementBtn = function() {
    const cb  = document.getElementById('cm-agreement-checkbox');
    const sig = document.getElementById('cm-agreement-signature');
    const btn = document.getElementById('cm-agreement-accept-btn');
    // Enabled when the box is ticked AND a name is typed (≥2 characters). The
    // drawn signature is captured too but is NOT a hard requirement, so a canvas
    // init hiccup can never lock the user out of their portal.
    const named = sig && sig.value.trim().length >= 2;
    if (btn) btn.disabled = !((cb && cb.checked) && named);
    // Partner gate: the step-2 "Agree & sign" button follows the same rule, and a
    // hint below it lists what's missing (drawing is suggested but never blocks —
    // a canvas init hiccup must not lock the partner out).
    const nextBtn = document.getElementById('cm-agr-next-btn');
    if (nextBtn && _cmAgrStep === 2) nextBtn.disabled = !((cb && cb.checked) && named);
    const hintEl = document.getElementById('cm-agr-signhint');
    if (hintEl && _cmAgrStep === 2) {
        const missing = [];
        if (!(cb && cb.checked)) missing.push('tick the box');
        if (!_cmSigPad.hasInk)   missing.push('draw your signature');
        if (!named)              missing.push('type your name');
        hintEl.textContent = missing.length ? 'To finish: ' + missing.join(', ') + '.' : '';
    }
    // Agree-card border highlights when ticked (gate design).
    const agreeCard = document.getElementById('cm-agr-agree-card');
    if (agreeCard) agreeCard.style.borderColor = (cb && cb.checked) ? '#1A5C3A' : '#e3e8e4';
};

// Best-effort client IP (optional — blank if the lookup is blocked/offline).
// Fully guarded + 2.5s timeout so browser tracking-prevention can never hang
// or break the agreement acceptance.
async function cmFetchIp() {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(t);
        if (r && r.ok) { const j = await r.json(); return (j && j.ip) || ''; }
    } catch (_) { /* offline / blocked / aborted → leave blank */ }
    return '';
}

window.cmAcceptAgreement = async function() {
    const cb  = document.getElementById('cm-agreement-checkbox');
    const sig = document.getElementById('cm-agreement-signature');
    const signature = sig ? sig.value.trim() : '';
    if (!cb?.checked) return;
    if (signature.trim().length < 2) {
        alert('Please type your name as your printed signature.');
        return;
    }
    const btn = document.getElementById('cm-agreement-accept-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // Optional client IP — fully non-blocking (browsers may block the lookup).
    let ip = '';
    try { ip = await cmFetchIp(); } catch (_) { ip = ''; }

    // Upload the drawn signature image to the 'uploads' bucket; store the URL.
    // Only when the user actually drew something — otherwise skip (typed name is
    // enough). Never blocks acceptance if the upload fails.
    let signatureImageUrl = '';
    try {
        if (_cmSigPad.hasInk && _cmSigPad.canvas && typeof storage !== 'undefined' && cmCurrentUser) {
            const blob = await new Promise(res => _cmSigPad.canvas.toBlob(res, 'image/png'));
            if (blob) {
                const path = `signatures/${cmCurrentUser.uid}_${Date.now()}.png`;
                const ref = storage.ref(path);
                await ref.put(blob);
                signatureImageUrl = await ref.getDownloadURL();
            }
        }
    } catch (upErr) {
        console.warn('Signature image upload failed (continuing):', upErr.message);
    }

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
            // Partners sign the Partnership Agreement → partner-prefixed fields;
            // clients sign the Cost-Plus agreement → the original fields.
            // Record WHICH template version was on screen — reprints render this
            // version even after the admin edits the agreement text later.
            const tplVer = (typeof window.dacsAgrTemplate === 'function')
                ? window.dacsAgrTemplate(cmIsPartner() ? 'partner' : 'client').version : 1;
            await db.collection(CM_COLLECTION).doc(cmCurrentUser.uid).update(cmIsPartner() ? {
                partnerAgreementAccepted      : true,
                partnerAgreementAcceptedAt    : firebase.firestore.FieldValue.serverTimestamp(),
                partnerAgreementSignature     : signature,
                partnerAgreementSignatureImage: signatureImageUrl || '',
                partnerAgreementIp            : ip || '',
                partnerAgreementDocVersion    : tplVer
            } : {
                agreementAccepted      : true,
                agreementAcceptedAt    : firebase.firestore.FieldValue.serverTimestamp(),
                agreementSignature     : signature,
                agreementSignatureImage: signatureImageUrl || '',
                agreementIp            : ip || '',
                agreementDocVersion    : tplVer
            });
        }
        if (cmCurrentProfile) {
            if (cmIsPartner()) {
                cmCurrentProfile.partnerAgreementAccepted       = true;
                cmCurrentProfile.partnerAgreementSignature      = signature;
                cmCurrentProfile.partnerAgreementSignatureImage = signatureImageUrl || '';
            } else {
                cmCurrentProfile.agreementAccepted       = true;
                cmCurrentProfile.agreementSignature      = signature;
                cmCurrentProfile.agreementSignatureImage = signatureImageUrl || '';
            }
        }
        // Flip the linked project Pending Agreement → Ready to Start.
        // Client-only: the CLIENT's cost-plus acceptance is what starts a project;
        // a partner signing the partnership terms must not change project status.
        if (!cmIsPartner() && cmProjectData && cmProjectData.id && cmProjectData.status === 'pending_agreement') {
            try {
                await db.collection('constructionProjects').doc(cmProjectData.id).update({ status: 'ready' });
                cmProjectData.status = 'ready';
            } catch (pe) { console.warn('Project status update skipped:', pe.message); }
        }
        // Immutable audit row (append-only agreement_events, migration 0021).
        // Best-effort by design — the helper never throws.
        if (typeof dacsLogAgreementEvent === 'function') {
            const tplA = (typeof window.dacsAgrTemplate === 'function')
                ? window.dacsAgrTemplate(cmIsPartner() ? 'partner' : 'client')
                : { mode: 'sections', version: 1 };
            let docText = '', pdfSnap = null;
            if (tplA.mode === 'pdf' && tplA.pdfUrl) {
                // The signed document is the uploaded PDF — freeze a per-signer
                // copy + fingerprint (best-effort; never blocks acceptance).
                if (cmCurrentUser && typeof dacsSnapshotPdf === 'function')
                    pdfSnap = await dacsSnapshotPdf(tplA.pdfUrl, cmCurrentUser.uid, tplA.pdfName || 'agreement');
            } else {
                const doc = cmIsPartner()
                    ? (typeof window.dacsPartnerAgreementDoc === 'function' ? window.dacsPartnerAgreementDoc(signature, cmProjectData || {}, '') : null)
                    : (typeof window.dacsClientAgreementDoc  === 'function' ? window.dacsClientAgreementDoc(signature,  cmProjectData || {}, '') : null);
                docText = doc ? [doc.title || '', ...(doc.sections || []).map(s => (s.heading || '') + '\n' + (s.body || ''))].join('\n\n') : '';
            }
            await dacsLogAgreementEvent({
                audience : cmIsPartner() ? 'partner' : 'construction_client',
                docType  : cmIsPartner() ? 'partnership_agreement' : 'cost_plus_agreement',
                docTitle : (tplA.mode === 'pdf' && tplA.pdfName)
                    ? tplA.pdfName
                    : (cmIsPartner() ? 'DAC’s Partnership Agreement' : 'Cost-Plus Project Management Agreement'),
                projectId: (cmProjectData && cmProjectData.id) || null,
                signature,
                signatureImageUrl: signatureImageUrl || '',
                pdfSnapshotUrl : pdfSnap ? pdfSnap.url  : '',
                pdfSnapshotName: pdfSnap ? pdfSnap.name : '',
                docSha256      : pdfSnap ? pdfSnap.sha256
                    : (docText && typeof dacsSha256Text === 'function' ? await dacsSha256Text(docText) : ''),
                docText,
                docVersion: tplA.version || 1,
                ip: ip || ''
            });
        }
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
    cmRouteAfterLogin();
};

// ── Signed agreement PDF (print-to-PDF; no external library) ──────────────
// Generates a locked, read-only agreement document filled with the recorded
// signature + date. Callable by the client/partner after signing. The admin
// version (user-navigator) passes an explicit profile/project to print any
// client's signed copy.
window.cmDownloadAgreementPdf = async function(opts) {
    const o = opts || {};
    const prof = o.profile || cmCurrentProfile || {};
    const proj = o.project || cmProjectData || {};
    if (typeof window.dacsAgreementPdf !== 'function') { alert('Print utility not loaded.'); return; }
    // Reprints render the VERSION the person signed, not the current template.
    try { if (window.dacsLoadAgreementTemplates) await window.dacsLoadAgreementTemplates(); } catch (_) {}
    // Partner portal (or explicit opts.partner) prints the signed PARTNERSHIP
    // agreement from the partner-prefixed fields; clients print the Cost-Plus one.
    const isPartner  = o.partner === true || cmIsPartner();
    const clientName = [prof.firstName, prof.lastName].filter(Boolean).join(' ').trim() || prof.email || '—';
    const signature  = (isPartner ? prof.partnerAgreementSignature : prof.agreementSignature) || clientName;
    const acceptedAtRaw = isPartner ? prof.partnerAgreementAcceptedAt : prof.agreementAcceptedAt;
    const signedAt   = acceptedAtRaw
        ? (acceptedAtRaw.toDate ? acceptedAtRaw.toDate() : new Date(acceptedAtRaw))
        : new Date();
    const dateStr = isNaN(signedAt) ? '' : signedAt.toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const dayStr  = isNaN(signedAt) ? '' : signedAt.toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
    const projectTitle = proj.projectName || proj.clientName || 'Construction Project';
    const contract = proj.budget != null ? '₱' + Number(proj.budget).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    const feePct   = (proj.managementFeePct != null ? proj.managementFeePct : 15) + '%';
    const signedVer = isPartner ? prof.partnerAgreementDocVersion : prof.agreementDocVersion;
    // If the signed version was an admin-UPLOADED PDF, that file IS the
    // agreement — download the archived copy directly.
    const verDoc = (typeof window.dacsAgrVersionDoc === 'function')
        ? window.dacsAgrVersionDoc(isPartner ? 'partner' : 'client', signedVer) : null;
    if (verDoc && verDoc.mode === 'pdf' && verDoc.pdfUrl) {
        // One merged file: the signed document's pages + the signature
        // certificate page (falls back to opening the document if merge fails).
        if (typeof window.dacsAgreementDownloadPdf !== 'function') { window.open(verDoc.pdfUrl, '_blank'); return; }
        window.dacsAgreementDownloadPdf({
            title   : isPartner ? 'DAC’s Partnership Agreement' : 'Cost-Plus Project Management Agreement',
            subtitle: 'Signature Certificate',
            preamble: 'This certificate is attached to the agreement document “' + (verDoc.pdfName || 'Agreement.pdf') + '” (version ' + (verDoc.version || '—') + ') — the preceding pages of this file — electronically signed by ' + clientName + '.',
            parties : [
                { label: isPartner ? 'Partner' : 'Client', value: clientName },
                { label: 'Document', value: verDoc.pdfName || 'Agreement.pdf' },
                { label: 'Version',  value: 'v' + (verDoc.version || '—') },
                ...(proj && proj.projectName ? [{ label: 'Project', value: proj.projectName }] : [])
            ],
            sections: [],
            signature,
            signatureImage: (isPartner ? prof.partnerAgreementSignatureImage : prof.agreementSignatureImage) || '',
            dateStr,
            signerLabel: isPartner ? 'Partner' : 'Client',
            ip: (isPartner ? prof.partnerAgreementIp : prof.agreementIp) || '',
            pdfEmbedUrl: verDoc.pdfUrl,
            fillFields: [
                { label: isPartner ? 'Partner' : 'Client', value: clientName },
                { label: 'Project',        value: (proj && proj.projectName) || '' },
                { label: 'Start Date',     value: (proj && proj.startDate) || '' },
                { label: 'Contract Value', value: (proj && proj.budget != null) ? 'PHP ' + Number(proj.budget).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '' }
            ]
        });
        return;
    }
    const verSections = (verDoc && verDoc.mode !== 'pdf') ? verDoc.sections : null;
    // TRUE file download (jsPDF) — this is the portal's "Download" action;
    // fall back to the print popup only if the PDF library can't load.
    const _pdfFn = (typeof window.dacsAgreementDownloadPdf === 'function')
        ? window.dacsAgreementDownloadPdf : window.dacsAgreementPdf;
    _pdfFn(isPartner ? {
        // The canonical Partnership document (print-utils.js) at the SIGNED
        // version — the reprint matches what was signed, even after edits.
        ...window.dacsPartnerAgreementDoc(clientName, proj, dayStr, verSections),
        signature,
        signatureImage: prof.partnerAgreementSignatureImage || '',
        dateStr,
        ip: prof.partnerAgreementIp || ''
    } : {
        // Canonical Cost-Plus client document (print-utils.js) at the SIGNED
        // version — the same sections the client read in the portal modal.
        ...window.dacsClientAgreementDoc(clientName, proj, dayStr, verSections),
        signature,
        signatureImage: prof.agreementSignatureImage || '',
        dateStr,
        ip: prof.agreementIp || ''
    });
};

// ══════════════════════════════════════════════════════════════════
// PER-PROJECT TERMS GATE (partners must sign each project's terms)
// ══════════════════════════════════════════════════════════════════
let _cmPtSig = { canvas: null, ctx: null, drawing: false, hasInk: false, bound: false };

// Has this partner already accepted the given project's terms?
async function cmPartnerHasAcceptedProject(projectId) {
    try {
        const uid = cmCurrentUser && cmCurrentUser.uid;
        if (!uid) return true;   // no user → don't block
        const snap = await db.collection('constructionProjects').doc(projectId)
            .collection('partnerAgreements')
            .where('partnerUid', '==', uid)
            .get();
        return !snap.empty;
    } catch (e) {
        console.warn('Project-terms check failed (allowing through):', e.message);
        return true;             // never hard-block on a read error
    }
}

function cmOpenProjectTerms(project) {
    const modal = document.getElementById('cm-projterms-modal');
    if (!modal) return;
    const nameEl = document.getElementById('cm-projterms-projectname');
    if (nameEl) nameEl.textContent = 'For project: ' + (project.projectName || project.clientName || 'this project');

    const pdfUrl = project.partnerTermsPdfUrl && project.partnerTermsPdfUrl.trim();

    // reset inputs
    const cb = document.getElementById('cm-projterms-checkbox'); if (cb) cb.checked = false;
    const sig = document.getElementById('cm-projterms-signature'); if (sig) sig.value = '';
    const btn = document.getElementById('cm-projterms-accept-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Accept & View Project'; }

    // No special sizing needed — PDF mode just shows an "Open PDF" button now.
    const card = modal.querySelector('.cm-agreement-card');
    if (card) card.classList.remove('pdf-mode');

    if (pdfUrl) {
        // PDF mode: the partner must OPEN the document once before the checkbox
        // (and therefore the e-signature) unlocks.
        cmProjTermsSetReadGate(true);
        cmProjTermsRenderPdf(pdfUrl);
    } else {
        // Text mode (no PDF): show the terms text.
        cmProjTermsSetReadGate(false);
        const textEl = document.getElementById('cm-projterms-text');
        if (textEl) {
            textEl.innerHTML = '';
            textEl.style.whiteSpace = 'pre-wrap';
            textEl.textContent = (project.partnerTerms && project.partnerTerms.trim())
                ? project.partnerTerms
                : 'By viewing this project you agree to keep its information confidential, to use it only for the purposes of this partnership, and to abide by DAC’s Building Design Services’ standard Cost-Plus terms and policies. Prices may vary with market conditions; figures reflect actual recorded costs.';
        }
    }

    modal.style.display = '';
    setTimeout(cmProjTermsInitPad, 60);
}

// (cmOpenClientTermsGate / cmClientTermsAccept were retired 2026-07-03: the
// account-level Terms PDF is now required reading inside the Cost-Plus
// agreement ceremony — see _cmClientAgrSetupTermsPdf. The shared modal below
// now serves ONLY the per-project terms gate for clients.)

// Lock/unlock the read gate. When locked, the agree-checkbox is disabled and a
// hint tells the partner to open and read the PDF first.
function cmProjTermsSetReadGate(locked) {
    const cb   = document.getElementById('cm-projterms-checkbox');
    const wrap = cb ? cb.closest('.cm-agreement-check-wrap') : null;
    const hint = document.getElementById('cm-projterms-readhint');
    const sign = document.querySelector('#cm-projterms-modal .cm-agreement-sign-wrap');
    const sig  = document.getElementById('cm-projterms-signature');
    if (cb) {
        cb.disabled = !!locked;
        if (locked) cb.checked = false;
    }
    if (sig) sig.disabled = !!locked;
    if (wrap) { wrap.style.opacity = locked ? '0.5' : ''; wrap.style.pointerEvents = locked ? 'none' : ''; }
    if (sign) { sign.style.opacity = locked ? '0.5' : ''; sign.style.pointerEvents = locked ? 'none' : ''; }
    if (hint) hint.style.display = locked ? '' : 'none';
    if (typeof cmProjTermsToggleBtn === 'function') cmProjTermsToggleBtn();
}

// Show a single "Open Terms & Conditions (PDF)" button — the document opens
// full-screen in a new tab. Opening it once satisfies the read gate.
function cmProjTermsRenderPdf(url) {
    const textEl = document.getElementById('cm-projterms-text');
    if (!textEl) return;
    textEl.style.whiteSpace = 'normal';
    textEl.innerHTML =
        '<div style="padding:8px 0 4px;font-size:13.5px;color:#374151;margin-bottom:12px;">Please open and read the project’s Terms &amp; Conditions before you sign:</div>'
        + '<a href="' + cmEsc(url) + '" target="_blank" rel="noopener" id="cm-projterms-openpdf-btn" onclick="cmProjTermsMarkOpened()" '
        + 'style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border:1.5px solid #111827;border-radius:9px;background:#fff;color:#111827;font-weight:700;font-size:14px;cursor:pointer;text-decoration:none;font-family:inherit;">'
        + '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
        + 'Open Terms &amp; Conditions (PDF)</a>'
        + '<div id="cm-projterms-openednote" style="display:none;margin-top:10px;font-size:12.5px;font-weight:600;color:#16a34a;">✓ Document opened — you can now sign below.</div>';
}

// The partner clicked "Open Terms (PDF)": mark as read and unlock the e-sign.
window.cmProjTermsMarkOpened = function() {
    cmProjTermsSetReadGate(false);
    const note = document.getElementById('cm-projterms-openednote');
    if (note) note.style.display = '';
    const btn = document.getElementById('cm-projterms-openpdf-btn');
    if (btn) { btn.style.borderColor = '#16a34a'; btn.style.color = '#16a34a'; }
    // The link's default navigation (opening the PDF in a new tab) still happens.
};

// Leave the terms modal without accepting. Multiple projects → return to the
// picker so they can choose a different one; single project → sign out.
window.cmProjTermsBack = function() {
    const modal = document.getElementById('cm-projterms-modal');
    if (modal) modal.style.display = 'none';
    if (cmProjects.length > 1) {
        cmProjectData = null;
        cmShowProjectPicker();
    } else {
        doLogout();
    }
};

function cmProjTermsInitPad() {
    const canvas = document.getElementById('cm-projterms-pad');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
    _cmPtSig.canvas = canvas; _cmPtSig.ctx = ctx; _cmPtSig.hasInk = false;
    const hint = document.getElementById('cm-projterms-hint'); if (hint) hint.style.display = '';
    if (_cmPtSig.bound) return;
    _cmPtSig.bound = true;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; };
    const start = (e) => { e.preventDefault(); _cmPtSig.drawing = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); const h = document.getElementById('cm-projterms-hint'); if (h) h.style.display = 'none'; };
    const move  = (e) => { if (!_cmPtSig.drawing) return; e.preventDefault(); const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); _cmPtSig.hasInk = true; };
    const end   = () => { _cmPtSig.drawing = false; };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end);
}

window.cmProjTermsClearSig = function() {
    const c = _cmPtSig.canvas, ctx = _cmPtSig.ctx;
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    _cmPtSig.hasInk = false;
    const hint = document.getElementById('cm-projterms-hint'); if (hint) hint.style.display = '';
};

window.cmProjTermsToggleBtn = function() {
    const cb  = document.getElementById('cm-projterms-checkbox');
    const sig = document.getElementById('cm-projterms-signature');
    const btn = document.getElementById('cm-projterms-accept-btn');
    const named = sig && sig.value.trim().length >= 2;
    if (btn) btn.disabled = !((cb && cb.checked) && named);
};

window.cmProjTermsAccept = async function() {
    const cb  = document.getElementById('cm-projterms-checkbox');
    const sig = document.getElementById('cm-projterms-signature');
    const signature = sig ? sig.value.trim() : '';
    if (!cb?.checked) return;
    if (signature.length < 2) { alert('Please type your name as your signature.'); return; }
    if (!cmProjectData || !cmProjectData.id) return;

    const btn = document.getElementById('cm-projterms-accept-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    let ip = ''; try { ip = await cmFetchIp(); } catch (_) { ip = ''; }

    // Upload the drawn signature (optional, non-blocking).
    let signatureImageUrl = '';
    try {
        if (_cmPtSig.hasInk && _cmPtSig.canvas && typeof storage !== 'undefined' && cmCurrentUser) {
            const blob = await new Promise(res => _cmPtSig.canvas.toBlob(res, 'image/png'));
            if (blob) {
                const path = `signatures/proj_${cmProjectData.id}_${cmCurrentUser.uid}_${Date.now()}.png`;
                const ref = storage.ref(path);
                await ref.put(blob);
                signatureImageUrl = await ref.getDownloadURL();
            }
        }
    } catch (upErr) { console.warn('Project signature upload failed (continuing):', upErr.message); }

    try {
        const uid = cmCurrentUser ? cmCurrentUser.uid : null;
        const col = db.collection('constructionProjects').doc(cmProjectData.id).collection('partnerAgreements');
        const payload = {
            partnerUid     : uid,
            partnerEmail   : cmCurrentUser ? (cmCurrentUser.email || '') : '',
            signature      : signature,
            signatureImage : signatureImageUrl || '',
            termsPdfUrl    : (cmProjectData && cmProjectData.partnerTermsPdfUrl)  || '',
            termsPdfName   : (cmProjectData && cmProjectData.partnerTermsPdfName) || '',
            ip             : ip || '',
            acceptedAt     : firebase.firestore.FieldValue.serverTimestamp()
        };
        // Upsert: one row per partner per project. Update the existing row if this
        // partner already signed (re-sign), otherwise create a fresh one.
        let existingId = null;
        if (uid) {
            try {
                const prior = await col.where('partnerUid', '==', uid).get();
                if (!prior.empty) existingId = prior.docs[0].id;
            } catch (_) { /* fall through to add */ }
        }
        if (existingId) {
            await col.doc(existingId).update(payload);
        } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await col.add(payload);
        }
        // Immutable audit row + frozen copy of the exact document (agreement_events,
        // migration 0021). Best-effort — the helpers never throw.
        if (typeof dacsLogAgreementEvent === 'function') {
            const pdfUrl = ((cmProjectData.partnerTermsPdfUrl) || '').trim();
            let snap = null;
            if (pdfUrl && uid && typeof dacsSnapshotPdf === 'function')
                snap = await dacsSnapshotPdf(pdfUrl, uid, cmProjectData.partnerTermsPdfName || 'project-terms');
            const docText = pdfUrl ? '' : ((cmProjectData.partnerTerms && cmProjectData.partnerTerms.trim()) || '');
            await dacsLogAgreementEvent({
                audience : cmIsPartner() ? 'partner' : 'construction_client',
                docType  : 'project_terms',
                docTitle : 'Per-Project Terms & Conditions — ' + (cmProjectData.projectName || cmProjectData.id),
                projectId: cmProjectData.id,
                signature,
                signatureImageUrl: signatureImageUrl || '',
                pdfSnapshotUrl : snap ? snap.url    : '',
                pdfSnapshotName: snap ? snap.name   : '',
                docSha256      : snap ? snap.sha256 : (docText && typeof dacsSha256Text === 'function' ? await dacsSha256Text(docText) : ''),
                docText,
                ip: ip || ''
            });
        }
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Accept & View Project'; }
        alert('Could not save your acceptance: ' + (e.message || e) + '\n\nPlease try again.');
        return;
    }

    const modal = document.getElementById('cm-projterms-modal');
    if (modal) modal.style.display = 'none';
    // Enter the dashboard now — the gate will pass this time (just accepted).
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
    const mgmtFee        = directCosts * cmFeeRate();
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
                <span class="cm-term-cost-label">Management Fee (${cmFeePct()}%)</span>
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
            const mgmtFee        = directCosts * cmFeeRate();
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
