// Global variables
let _loginViaForm   = false;   // true only when user clicked Sign In
let currentUser     = null;
let currentUserRole = null;   // 'owner' | 'staff' | 'worker' | 'teamLeader'
let currentAllowedModules = null;  // e.g. ['pm'] — when set, this account is "focused" to these PRIMARY_NAV sections on every screen (desktop + mobile). null/empty = full access.
let currentView     = 'dashboard';
let appointments = [];
let currentAppointment = null;
let _pendingFeedbackCount       = 0;
window._pendingPaymentCount     = 0;
window._newClientsCount         = 0;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuthState();
    setupEventListeners();
});

// Roles that are allowed to access the admin dashboard
const ADMIN_ROLES = ['owner', 'staff', 'worker', 'teamLeader'];

// Check authentication state
function checkAuthState() {
    auth.onAuthStateChanged(async user => {
        if (user) {
            currentUser = user;
            // Fetch role and ownerUid from Firestore users collection
            try {
                const userDoc = await db.collection('users').doc(user.uid).get();

                // Reject if user has no record in the admin users collection
                if (!userDoc.exists) {
                    await auth.signOut();
                    showLogin();
                    showLoginError('Access denied. You are not authorized to access this portal.');
                    _loginViaForm = false;
                    return;
                }

                const data = userDoc.data();
                currentUserRole = data.role || 'owner';

                // Reject if the role is not an admin role
                if (!ADMIN_ROLES.includes(currentUserRole)) {
                    await auth.signOut();
                    showLogin();
                    showLoginError('Access denied. This account does not have admin privileges.');
                    _loginViaForm = false;
                    return;
                }

                window.currentUserRole = currentUserRole;
                // If staff, use ownerUid so they see the same data as the owner
                window.currentDataUserId = (currentUserRole === 'staff' && data.ownerUid)
                    ? data.ownerUid
                    : user.uid;

                // Module-focus: PRIMARY_NAV ids this account is narrowed to on
                // every screen (desktop + mobile). Empty/missing = full access.
                currentAllowedModules = Array.isArray(data.allowedModules) ? data.allowedModules : null;
                window.currentAllowedModules = currentAllowedModules;
            } catch (e) {
                console.warn('Could not fetch user role:', e);
                await auth.signOut();
                showLogin();
                showLoginError('Unable to verify your account. Please try again.');
                _loginViaForm = false;
                return;
            }
            // First-login agreement gate — all admin roles EXCEPT owner must read
            // and e-sign the Terms before reaching the dashboard.
            try {
                const needsAgreement = currentUserRole !== 'owner'
                    && (await _empAgreementProfile(user.uid)).agreementAccepted !== true;
                if (needsAgreement) {
                    _showEmployeeAgreementGate(user);
                    _loginViaForm = false;
                    return;   // dashboard shows only after they accept
                }
            } catch (agErr) {
                console.warn('Employee agreement gate skipped:', agErr && agErr.message);
            }

            applyRoleBasedUI();
            showDashboard();
            showWelcomeToast(user.email, _loginViaForm ? 'Login Successful!' : 'Welcome back!');
            _loginViaForm = false;
            // Start admin notification bell listener immediately after login
            if (typeof loadNotifications === 'function') loadNotifications();
        } else {
            showLogin();
        }
    });
}

// ════════════════════════════════════════════════════════════════════
// EMPLOYEE FIRST-LOGIN AGREEMENT GATE
// Mirrors the Client Management agreement: a non-owner admin account must read
// the Terms and e-sign (tick + typed name + optional drawn signature) before
// reaching the dashboard. Acceptance is saved on their `users` profile.
// ════════════════════════════════════════════════════════════════════

const EMP_AGREEMENT_FALLBACK =
`EMPLOYMENT TERMS & CONDITIONS

By accepting, you confirm that you have read, understood, and agree to DAC's Building Design Services' employment terms, confidentiality, acceptable-use, and conduct policies, and that all work products created in the course of your employment remain the property of the company.`;

let _empAgrSig = { canvas: null, ctx: null, drawing: false, hasInk: false, bound: false };

async function _empAgreementProfile(uid) {
    try {
        const doc = await db.collection('users').doc(uid).get();
        return doc.exists ? doc.data() : {};
    } catch (_) { return {}; }
}

// Load the global employee terms: { text, pdfUrl, pdfName }.
async function _empLoadGlobalTerms() {
    try {
        const doc = await db.collection('settings').doc('employeeTerms').get();
        const t = doc && doc.exists ? doc.data() : null;
        return {
            text  : (t && typeof t.text === 'string' && t.text.trim()) ? t.text : EMP_AGREEMENT_FALLBACK,
            pdfUrl : (t && t.pdfUrl)  || '',
            pdfName: (t && t.pdfName) || ''
        };
    } catch (_) { return { text: EMP_AGREEMENT_FALLBACK, pdfUrl: '', pdfName: '' }; }
}

async function _empLoadTermsText() {
    try {
        const doc = await db.collection('settings').doc('employeeTerms').get();
        const t = doc && doc.exists ? doc.data() : null;
        return (t && typeof t.text === 'string' && t.text.trim()) ? t.text : EMP_AGREEMENT_FALLBACK;
    } catch (_) { return EMP_AGREEMENT_FALLBACK; }
}

async function _showEmployeeAgreementGate(user) {
    // Keep the login screen hidden but do NOT show the dashboard yet.
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) loginScreen.style.display = 'none';

    let modal = document.getElementById('emp-agreement-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'emp-agreement-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px;';
        document.body.appendChild(modal);
    }
    modal.innerHTML =
      '<div style="background:#fff;border:1.5px solid #111827;width:100%;max-width:720px;height:92vh;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 28px 80px rgba(0,0,0,.32);font-family:inherit;">'
      + '<div style="padding:20px 28px 16px;border-bottom:1.5px solid #e5e7eb;text-align:center;background:linear-gradient(160deg,#f5f3ff 0%,#ede9fe 100%);">'
      +   '<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.2);border-radius:20px;font-size:11px;font-weight:700;color:#6d28d9;letter-spacing:.07em;text-transform:uppercase;">🔒 Employee Agreement</div>'
      +   '<h2 style="font-size:20px;font-weight:800;color:#4c1d95;margin:8px 0 2px;">Terms &amp; Conditions</h2>'
      +   '<p style="font-size:13px;color:#6b7280;margin:0;">Please read and sign to access the portal.</p>'
      + '</div>'
      + '<div style="flex:1;min-height:0;overflow-y:auto;padding:22px 28px;">'
      +   '<div id="emp-agreement-text" style="white-space:pre-wrap;font-size:13px;line-height:1.65;color:#374151;">Loading…</div>'
      + '</div>'
      + '<div style="padding:14px 28px 18px;border-top:1.5px solid #e5e7eb;background:#fafafa;display:flex;flex-direction:column;gap:12px;">'
      +   '<label style="display:flex;align-items:flex-start;gap:9px;font-size:12.5px;color:#374151;cursor:pointer;">'
      +     '<input type="checkbox" id="emp-agreement-checkbox" onchange="empToggleAgreementBtn()" style="width:17px;height:17px;margin-top:1px;flex-shrink:0;cursor:pointer;">'
      +     '<span>I have read and agree to the <strong>Terms &amp; Conditions</strong>.</span>'
      +   '</label>'
      +   '<div style="display:grid;grid-template-columns:1.3fr 1fr;gap:16px;align-items:end;">'
      +     '<div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;"><label style="font-size:12px;font-weight:700;color:#374151;">Draw your signature</label><button type="button" onclick="empClearAgreementSig()" style="font-size:11px;font-weight:600;color:#6b7280;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:7px;padding:3px 10px;cursor:pointer;">Clear</button></div>'
      +       '<div style="position:relative;border:1.5px solid #d1d5db;border-radius:10px;background:#fff;overflow:hidden;"><canvas id="emp-agreement-pad" style="display:block;width:100%;height:90px;touch-action:none;cursor:crosshair;"></canvas><div id="emp-agreement-hint" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;color:#c4c8d0;font-size:13px;font-style:italic;">Sign here</div></div></div>'
      +     '<div><label for="emp-agreement-signature" style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:5px;">Full name (printed) <span style="color:#dc2626;">*</span></label>'
      +       '<input type="text" id="emp-agreement-signature" oninput="empToggleAgreementBtn()" placeholder="e.g. Juan Dela Cruz" autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px 13px;border:1.5px solid #d1d5db;border-radius:10px;font-size:14px;font-family:inherit;color:#111827;outline:none;">'
      +       '<div style="font-size:11px;color:#9ca3af;margin-top:6px;">Signing is recorded with the date/time.</div></div>'
      +   '</div>'
      +   '<div style="display:flex;gap:10px;justify-content:flex-end;">'
      +     '<button type="button" onclick="empAgreementSignOut()" style="padding:11px 18px;border-radius:10px;border:1.5px solid #d1d5db;background:#fff;color:#374151;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;">Sign out</button>'
      +     '<button type="button" id="emp-agreement-accept-btn" onclick="empAcceptAgreement()" disabled style="flex:1;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#6d28d9 0%,#7c3aed 100%);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;opacity:.6;">Accept Agreement</button>'
      +   '</div>'
      + '</div>'
      + '</div>';

    modal.dataset.uid = user.uid;
    modal.style.display = 'flex';

    const prof  = await _empAgreementProfile(user.uid);
    const nm    = [prof.firstName, prof.lastName].filter(Boolean).join(' ').trim();
    const sigEl = document.getElementById('emp-agreement-signature');
    if (sigEl && nm) sigEl.value = nm;

    // Global employee terms (one document for all employees).
    const globalTerms = await _empLoadGlobalTerms();
    const pdfUrl = globalTerms.pdfUrl && String(globalTerms.pdfUrl).trim();
    const textEl = document.getElementById('emp-agreement-text');
    if (pdfUrl) {
        // PDF mode: must open the document once before the checkbox unlocks.
        _empReadGateLocked = true;
        if (textEl) {
            textEl.style.whiteSpace = 'normal';
            textEl.innerHTML =
                '<div style="padding:4px 0 4px;font-size:13.5px;color:#374151;margin-bottom:12px;">Please open and read the Terms &amp; Conditions before you sign:</div>'
                + '<a href="' + _empEsc(pdfUrl) + '" target="_blank" rel="noopener" id="emp-agreement-openpdf" onclick="empMarkPdfOpened()" '
                + 'style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border:1.5px solid #111827;border-radius:9px;background:#fff;color:#111827;font-weight:700;font-size:14px;cursor:pointer;text-decoration:none;font-family:inherit;">'
                + '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
                + 'Open Terms &amp; Conditions (PDF)</a>'
                + '<div id="emp-agreement-openednote" style="display:none;margin-top:10px;font-size:12.5px;font-weight:600;color:#16a34a;">✓ Document opened — you can now sign below.</div>';
        }
    } else {
        // Text mode: show the global terms text; no read gate.
        _empReadGateLocked = false;
        if (textEl) { textEl.style.whiteSpace = 'pre-wrap'; textEl.textContent = globalTerms.text; }
    }

    setTimeout(_empInitAgreementPad, 60);
    empToggleAgreementBtn();
}

// Simple HTML-attribute escaper for the PDF url.
function _empEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Read gate: when a PDF is attached, the checkbox/signature stay locked until
// the employee opens the document once.
let _empReadGateLocked = false;

window.empMarkPdfOpened = function() {
    _empReadGateLocked = false;
    const note = document.getElementById('emp-agreement-openednote');
    if (note) note.style.display = '';
    const link = document.getElementById('emp-agreement-openpdf');
    if (link) { link.style.borderColor = '#16a34a'; link.style.color = '#16a34a'; }
    empToggleAgreementBtn();
    // The link's default navigation (opening the PDF) still happens.
};

window.empToggleAgreementBtn = function() {
    const cb  = document.getElementById('emp-agreement-checkbox');
    const sig = document.getElementById('emp-agreement-signature');
    const btn = document.getElementById('emp-agreement-accept-btn');
    // Disable the checkbox itself until the PDF has been opened (if gated).
    if (cb) cb.disabled = _empReadGateLocked;
    const ok  = !_empReadGateLocked && (cb && cb.checked) && sig && sig.value.trim().length >= 2;
    if (btn) { btn.disabled = !ok; btn.style.opacity = ok ? '1' : '.6'; }
};

window.empClearAgreementSig = function() {
    const c = _empAgrSig.canvas, ctx = _empAgrSig.ctx;
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    _empAgrSig.hasInk = false;
    const h = document.getElementById('emp-agreement-hint'); if (h) h.style.display = '';
};

window.empAgreementSignOut = async function() {
    const modal = document.getElementById('emp-agreement-modal');
    if (modal) modal.style.display = 'none';
    try { await auth.signOut(); } catch (_) {}
};

function _empInitAgreementPad() {
    const canvas = document.getElementById('emp-agreement-pad');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
    _empAgrSig.canvas = canvas; _empAgrSig.ctx = ctx; _empAgrSig.hasInk = false;
    const hint = document.getElementById('emp-agreement-hint'); if (hint) hint.style.display = '';
    if (_empAgrSig.bound) return;
    _empAgrSig.bound = true;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; };
    const start = (e) => { e.preventDefault(); _empAgrSig.drawing = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); const h = document.getElementById('emp-agreement-hint'); if (h) h.style.display = 'none'; };
    const move  = (e) => { if (!_empAgrSig.drawing) return; e.preventDefault(); const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); _empAgrSig.hasInk = true; };
    const end   = () => { _empAgrSig.drawing = false; };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end);
}

window.empAcceptAgreement = async function() {
    const modal = document.getElementById('emp-agreement-modal');
    const uid   = modal?.dataset.uid;
    const cb    = document.getElementById('emp-agreement-checkbox');
    const sig   = document.getElementById('emp-agreement-signature');
    const signature = sig ? sig.value.trim() : '';
    if (_empReadGateLocked) { alert('Please open the Terms & Conditions document first.'); return; }
    if (!uid || !cb?.checked) return;
    if (signature.length < 2) { alert('Please type your name as your signature.'); return; }

    const btn = document.getElementById('emp-agreement-accept-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // Optional drawn-signature upload (non-blocking).
    let signatureImageUrl = '';
    try {
        if (_empAgrSig.hasInk && _empAgrSig.canvas && typeof storage !== 'undefined') {
            const blob = await new Promise(res => _empAgrSig.canvas.toBlob(res, 'image/png'));
            if (blob) {
                const ref = storage.ref(`signatures/employee_${uid}_${Date.now()}.png`);
                await ref.put(blob);
                signatureImageUrl = await ref.getDownloadURL();
            }
        }
    } catch (upErr) { console.warn('Employee signature upload failed (continuing):', upErr.message); }

    try {
        await db.collection('users').doc(uid).update({
            agreementAccepted      : true,
            agreementAcceptedAt    : firebase.firestore.FieldValue.serverTimestamp(),
            agreementSignature     : signature,
            agreementSignatureImage: signatureImageUrl || ''
        });
    } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Accept Agreement'; }
        alert('Could not save your acceptance: ' + (e.message || e) + '\n\nPlease try again.');
        return;
    }

    // Immutable audit row + frozen copy of the exact document signed
    // (agreement_events, migration 0021). Best-effort — never blocks entry.
    try {
        if (typeof dacsLogAgreementEvent === 'function') {
            const g = await _empLoadGlobalTerms();
            let snap = null;
            if (g.pdfUrl && typeof dacsSnapshotPdf === 'function')
                snap = await dacsSnapshotPdf(g.pdfUrl, uid, g.pdfName || 'employee-terms');
            const docText = g.pdfUrl ? '' : (g.text || '');
            await dacsLogAgreementEvent({
                userId  : uid,
                audience: 'employee',
                docType : 'employee_terms',
                docTitle: 'Employment Terms & Conditions',
                signature,
                signatureImageUrl: signatureImageUrl || '',
                pdfSnapshotUrl : snap ? snap.url    : '',
                pdfSnapshotName: snap ? snap.name   : '',
                docSha256      : snap ? snap.sha256 : (docText && typeof dacsSha256Text === 'function' ? await dacsSha256Text(docText) : ''),
                docText
            });
        }
    } catch (evErr) { console.warn('Agreement event skipped:', evErr.message); }

    if (modal) modal.style.display = 'none';
    // Now enter the dashboard.
    applyRoleBasedUI();
    showDashboard();
    showWelcomeToast(auth.currentUser?.email || '', 'Welcome!');
    if (typeof loadNotifications === 'function') loadNotifications();
};

// Show an error message on the login screen
function showLoginError(message) {
    const errorDiv = document.getElementById('loginError');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.add('show');
    }
}

// Apply nav and view restrictions based on role
function applyRoleBasedUI() {
    // Re-render the top portal tabs now that the role is known, so role-hidden
    // primaries (e.g. Users for staff) and modules (e.g. Clients) disappear.
    if (typeof renderPortalChrome === 'function') renderPortalChrome();

    // ── Reset: restore all nav items and groups before applying role restrictions ──
    document.querySelectorAll('.nav-item').forEach(el => el.style.display = '');
    document.querySelectorAll('.nav-group').forEach(el => el.style.display = '');
    document.querySelectorAll('.nav-group-toggle').forEach(el => el.style.display = '');
    const _resetCards = ['mvpDetailBudgetCard'];
    _resetCards.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });

    if (currentUserRole === 'staff') {
        // Staff can access all expense + construction views, but NOT the
        // admin-only User Navigator or Client Accounts pages — nor Reports,
        // Client Reimbursement and the Warranty Fund, which are wall-to-wall
        // peso amounts (staff must not see money; reimbursements is owner-only
        // by RLS too, 0041, and the warranty tables likewise, 0043).
        // Quotations is the same story (0045) — hide the sidebar link too,
        // not just the top-nav tab from _visibleNav().
        ['userNavigator', 'clientAccounts', 'expReports', 'reimbursements', 'warrantyFund', 'quoteList'].forEach(view => {
            const el = document.querySelector(`.nav-item[data-view="${view}"]`);
            if (el) el.style.display = 'none';
        });

        // Hide specific KPI cards not relevant to staff
        const hiddenCards = ['mvpDetailBudgetCard'];
        hiddenCards.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Default landing view for staff: Project Control → Overview
        setTimeout(() => switchView('dacsPortal'), 100);

    } else if (currentUserRole === 'worker' || currentUserRole === 'teamLeader') {
        // Workers only see Construction — hide all other groups entirely
        ['navGroup-appointments', 'navGroup-expenses', 'navGroup-accomplishment', 'navGroup-userlogs'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Also hide userNavigator inside userlogs (already covered above, but be explicit)
        const uvItem = document.querySelector('.nav-item[data-view="userNavigator"]');
        if (uvItem) uvItem.style.display = 'none';

        // Hide Inventory — Firestore rules only allow owner/staff to read inventory,
        // so workers must not be offered a view that would fail with permission-denied.
        const invItem = document.querySelector('.nav-item[data-view="consInventory"]');
        if (invItem) invItem.style.display = 'none';

        // Open construction group by default for workers
        const consGroup = document.getElementById('navGroup-construction');
        if (consGroup) consGroup.classList.add('open');

        // Default landing view for workers
        setTimeout(() => switchView('consBatch'), 100);
    } else {
        // 'owner' sees everything — no restrictions
        // Default landing view for owner/admin: Expenses → Project Control
        setTimeout(() => switchView('dacsPortal'), 100);
    }

    // Auto-hide any group toggle whose all children are hidden
    document.querySelectorAll('.nav-group').forEach(group => {
        const visibleChildren = [...group.querySelectorAll('.nav-item')].filter(el => el.style.display !== 'none');
        if (visibleChildren.length === 0) group.style.display = 'none';
    });

    // Module-focus: a flagged account lands directly inside its focused module,
    // overriding the role-based default landing above. Fires last (larger
    // timeout) so it wins over the role default switchView calls.
    if (Array.isArray(currentAllowedModules) && currentAllowedModules.length) {
        const _fv = window.focusDefaultView();
        if (_fv) setTimeout(() => switchView(_fv), 160);
    }
}

// Refresh analytics - can be called manually
window.refreshAnalytics = function() {
    console.log('🔄 Manual analytics refresh triggered');
    displayAnalytics();
};

// Show login screen
function showLogin() {
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('loadingText').textContent = 'Signing you in...';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('dashboardScreen').style.display = 'none';
}

// Show dashboard
function showDashboard() {
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboardScreen').style.display = 'grid';
    document.getElementById('userEmail').textContent = currentUser.email;
    if (typeof initExpensesModule === 'function') initExpensesModule();
    if (typeof loadProjects === 'function') loadProjects();

    // Eagerly update payment requests + feedback + new clients badges on load
    _syncPaymentBadge();
    _syncFeedbackBadgeEager();
    setTimeout(() => {
        if (typeof window.syncNewClientsBadgeEager === 'function') window.syncNewClientsBadgeEager();
        if (typeof window.syncNewUsersBadgeEager === 'function') window.syncNewUsersBadgeEager();
        if (typeof window.syncUrgentBadgeEager === 'function') window.syncUrgentBadgeEager();
        if (typeof window.eiSyncGlobalBadges === 'function') window.eiSyncGlobalBadges();
        if (typeof window.eiWatchGlobalBadges === 'function') window.eiWatchGlobalBadges();
    }, 500);

    // Start real-time appointments listener only after auth is confirmed
    if (_appointmentsUnsub) _appointmentsUnsub(); // tear down any previous listener
    _appointmentsUnsub = db.collection('appointments')
        .orderBy('createdAt', 'desc')
        .onSnapshot(snapshot => {
            appointments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            updateDashboardStats();
            displayRecentAppointments();
            displayServicesChart();
            displayDashboardServiceChart();
            displayDashboardStatusChart();
            if (currentView === 'analytics') displayAnalytics();
            if (currentView === 'feedback') displayAllFeedback();
        });
}

// Update Billing & Reports group badge = payment requests + new clients
function _syncBillingGroupBadge() {
    const total = (window._pendingPaymentCount || 0) + (window._newClientsCount || 0);
    const groupBadge = document.getElementById('pr-group-badge');
    if (!groupBadge) return;
    if (total > 0) { groupBadge.textContent = total; groupBadge.style.display = 'inline-flex'; }
    else { groupBadge.style.display = 'none'; }
}
window.syncBillingGroupBadge = _syncBillingGroupBadge;

// Update the Appointments group badge = pending appointments + pending feedback
function _syncApptGroupBadge(pendingAppts) {
    const total = (pendingAppts || 0) + _pendingFeedbackCount;
    const groupBadge = document.getElementById('appt-group-badge');
    if (!groupBadge) return;
    if (total > 0) { groupBadge.textContent = total; groupBadge.style.display = 'inline-flex'; }
    else { groupBadge.style.display = 'none'; }
}

// Sync feedback child badge and roll into group badge
function _syncFeedbackBadge(count) {
    _pendingFeedbackCount = count || 0;
    const child = document.getElementById('feedback-child-badge');
    if (child) {
        if (_pendingFeedbackCount > 0) { child.textContent = _pendingFeedbackCount; child.style.display = 'inline-flex'; }
        else { child.style.display = 'none'; }
    }
    // Re-sync group badge with latest appointment count
    const pendingAppts = appointments.filter(a => a.status === 'pending').length;
    _syncApptGroupBadge(pendingAppts);
}

// Eagerly fetch feedback pending count on load
function _syncFeedbackBadgeEager() {
    db.collection('testimonials').get().then(snap => {
        const count = snap.docs.filter(d => (d.data().status || 'pending') === 'pending').length;
        _syncFeedbackBadge(count);
    }).catch(() => {});
}

// Eagerly fetch payment request pending count and update nav badges
function _syncPaymentBadge() {
    const user = firebase.auth().currentUser;
    if (!user) return;
    db.collection('users').doc(user.uid).get().then(doc => {
        const ownerUid = (doc.exists && doc.data().role === 'staff' && doc.data().ownerUid)
            ? doc.data().ownerUid : user.uid;
        return db.collection('paymentRequests')
            .where('ownerUid', '==', ownerUid)
            .get();
    }).then(snap => {
        window._pendingPaymentCount = snap.docs.filter(d => {
            const s = d.data().status;
            return s === 'submitted' || s === 'partial_pending';
        }).length;
        const badge = document.getElementById('pr-admin-badge');
        if (badge) {
            if (_pendingPaymentCount > 0) { badge.textContent = _pendingPaymentCount; badge.style.display = 'inline-flex'; }
            else { badge.style.display = 'none'; }
        }
        _syncBillingGroupBadge();
    }).catch(() => {});
}

// Setup event listeners
function setupEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    // Enter key in either login field submits too (belt-and-suspenders alongside
    // the form submit; handleLogin guards against firing twice).
    ['loginEmail', 'loginPassword'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(e); });
    });
    
    // Logout button — show confirmation modal
    document.getElementById('logoutBtn').addEventListener('click', () => {
        document.getElementById('logoutModal').style.display = 'flex';
    });
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const view = e.currentTarget.dataset.view;
            switchView(view);
        });
    });

    // Collapsible nav group toggles
    document.querySelectorAll('.nav-group-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const group = btn.closest('.nav-group');
            const isOpen = group.classList.contains('open');
            // Close all groups and reset aria-expanded
            document.querySelectorAll('.nav-group').forEach(g => {
                g.classList.remove('open');
                const t = g.querySelector('.nav-group-toggle');
                if (t) t.setAttribute('aria-expanded', 'false');
            });
            // Toggle clicked group
            if (!isOpen) {
                group.classList.add('open');
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // Open the Appointments group by default (contains Dashboard)
    const defaultGroup = document.getElementById('navGroup-appointments');
    if (defaultGroup) {
        defaultGroup.classList.add('open');
        const defaultToggle = defaultGroup.querySelector('.nav-group-toggle');
        if (defaultToggle) defaultToggle.setAttribute('aria-expanded', 'true');
    }
    
    // Filters
    document.getElementById('statusFilter')?.addEventListener('change', filterAppointments);
    document.getElementById('searchInput')?.addEventListener('input', filterAppointments);
    document.getElementById('feedbackStatusFilter')?.addEventListener('change', filterFeedback);
    document.getElementById('feedbackSearchInput')?.addEventListener('input', filterFeedback);
}

// Handle login
async function handleLogin(e) {
    if (e) e.preventDefault();
    // Guard against a double submit (e.g. the Enter key and the form submit both
    // firing) — bail out if a sign-in is already in flight.
    if (document.getElementById('loginBtn')?.disabled) return;

    const email    = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    const btn      = document.getElementById('loginBtn');
    const overlay  = document.getElementById('loadingOverlay');

    // Show overlay
    btn.disabled = true;
    overlay.style.display = 'flex';
    errorDiv.classList.remove('show');
    _loginViaForm = true;

    try {
        await auth.signInWithEmailAndPassword(email, password);
        errorDiv.classList.remove('show');
        // Toast is shown in checkAuthState after role is verified
    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = error.code === 'auth/captcha-failed'
            ? 'Please complete the verification below and try again.'
            : 'Invalid email or password. Please try again.';
        errorDiv.classList.add('show');
        // Hide overlay and restore button on error
        overlay.style.display = 'none';
        btn.disabled = false;
        _loginViaForm = false;
    }
}

// Show welcome back toast (auto-login)
function showWelcomeToast(email, title = 'Welcome back!') {
    setTimeout(() => {
        const toast = document.getElementById('welcomeToast');
        if (!toast) return;
        document.getElementById('welcomeToastTitle').textContent = title;
        document.getElementById('welcomeToastEmail').textContent = email;
        toast.classList.remove('hide');
        toast.style.display = 'flex';
        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => { toast.style.display = 'none'; toast.classList.remove('hide'); }, 300);
        }, 3500);
    }, 400);
}

// Logout modal controls
function closeLogoutModal() {
    document.getElementById('logoutModal').style.display = 'none';
}

async function confirmLogout() {
    closeLogoutModal();
    // Show logout animation — keep visible for at least 1.5s
    document.getElementById('loadingText').textContent = 'Signing out...';
    document.getElementById('loadingOverlay').style.display = 'flex';
    const [result] = await Promise.allSettled([
        auth.signOut(),
        new Promise(resolve => setTimeout(resolve, 1500))
    ]);
    if (result.status === 'rejected') {
        console.error('Logout error:', result.reason);
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

// Handle logout (kept for compatibility)
async function handleLogout() {
    document.getElementById('logoutModal').style.display = 'flex';
}

// Switch views
/* ═════════════════════════════════════════════════════════════
   VIEW-CLEANUP REGISTRY
   View-scoped Firestore listeners (or any other cleanup needing
   to run on view exit) should register their unsubscribe callback
   via window.registerViewCleanup(fn). switchView() runs every
   registered cleanup before changing views, so listeners don't
   accumulate over a long session.

   GLOBAL listeners (notification bell, urgent-request badge, the
   foundational data listeners loaded at boot) should NOT register
   here — they're intentionally long-lived.
═════════════════════════════════════════════════════════════ */
window._viewCleanups = window._viewCleanups || [];
window.registerViewCleanup = function (fn) {
    if (typeof fn === 'function') window._viewCleanups.push(fn);
};
window.runViewCleanups = function () {
    const list = window._viewCleanups;
    window._viewCleanups = [];
    list.forEach(fn => {
        try { fn(); } catch (e) { console.warn('view cleanup error:', e); }
    });
};

// NOTE: This switchView function is OVERRIDDEN by the window.switchView
// definition in admin.html (loaded after this file). The overriding version
// is the one actually called from the UI. The cleanup hook (runViewCleanups)
// and BOQ auto-select branch are wired in the admin.html version — see there.
// This function is retained for any code that still calls switchView() before
// admin.html's <script> block executes (rare; primarily during boot).
function switchView(view) {
    currentView = view;

    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.view === view) {
            item.classList.add('active');
            // Auto-open parent group if this item is inside one
            const parentGroup = item.closest('.nav-group');
            if (parentGroup) {
                document.querySelectorAll('.nav-group').forEach(g => {
                    g.classList.remove('open');
                    const t = g.querySelector('.nav-group-toggle');
                    if (t) t.setAttribute('aria-expanded', 'false');
                });
                parentGroup.classList.add('open');
                const parentToggle = parentGroup.querySelector('.nav-group-toggle');
                if (parentToggle) parentToggle.setAttribute('aria-expanded', 'true');
            }
        }
    });
    
    // Update page title
    const titles = {
        dashboard:        'Dashboard',
        appointments:     'Appointments',
        analytics:        'Analytics',
        feedback:         'Feedback',
        dacsPortal:       'Project Control',
        expOverview:      'Budget Overview',
        expExpenses:      'Expenses',
        expReports:       'Reports',
        expOverhead:      'Overhead Expenses',
        reimbursements:   'Client Reimbursement',
        warrantyFund:     'Warranty Fund',
        boqBuilder:       'Accomplishment Report',
        clientAccounts:   'Client Accounts',
        paymentRequests:  'Payment Requests',
        invoices:         'Invoice Receipt',
        consBatch:        'Current Batch',
        consUrgent:       'Urgent Requests',
        consBatchHistory: 'Batch History',
        consInventory:    'Inventory',
        userNavigator:    'User Navigator',
        terminationRequests: 'Project Closeout',
        pmReports:        'Reports',
    };
    const _pt = document.getElementById('pageTitle');
    if (_pt) _pt.textContent = titles[view] || view;

    // Sync the portal chrome (active primary tab + module pills)
    if (typeof syncPortalChrome === 'function') syncPortalChrome(view);

    // Hide all views
    document.querySelectorAll('.content-view').forEach(v => {
        v.style.display = 'none';
    });

    // Show selected view
    const vEl = document.getElementById(`${view}View`);
    if (vEl) vEl.style.display = 'block';
    
    // Load view-specific data
    if (view === 'appointments') {
        displayAllAppointments();
    } else if (view === 'analytics') {
        // Ensure Chart.js is loaded before displaying analytics
        if (typeof Chart === 'undefined') {
            console.error('❌ Chart.js not loaded, waiting...');
            setTimeout(() => displayAnalytics(), 200);
        } else {
            displayAnalytics();
        }
    } else if (view === 'feedback') {
        loadFeedback();
    } else if (view === 'expOverview') {
        if (typeof mvpOvNavigate === 'function') mvpOvNavigate('folders');
    } else if (view === 'expExpenses') {
        if (typeof mvpNavigate === 'function') mvpNavigate('folders');
    }
}

// Load all data
async function loadData() {
    try {
        const snapshot = await db.collection('appointments')
            .orderBy('createdAt', 'desc')
            .limit(200)
            .get();
        
        appointments = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        console.log('📊 Loaded', appointments.length, 'appointments');
        
        updateDashboardStats();
        displayRecentAppointments();
        displayServicesChart();
        displayDashboardServiceChart();
        displayDashboardStatusChart();
        
        // Refresh analytics if on analytics view
        if (currentView === 'analytics') {
            displayAnalytics();
        }
        
        // Load feedback if on feedback view
        if (currentView === 'feedback') {
            displayAllFeedback();
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Update dashboard stats
function updateDashboardStats() {
    const total = appointments.length;
    const pending = appointments.filter(a => a.status === 'pending').length;
    const completed = appointments.filter(a => a.status === 'completed').length;
    
    // This week
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const thisWeek = appointments.filter(a => {
        const createdAt = a.createdAt?.toDate();
        return createdAt && createdAt >= weekAgo;
    }).length;
    
    document.getElementById('totalAppointments').textContent = total;
    document.getElementById('pendingAppointments').textContent = pending;
    document.getElementById('completedAppointments').textContent = completed;
    document.getElementById('thisWeek').textContent = thisWeek;

    // Sync appointment child badge
    const apptChild = document.getElementById('appt-child-badge');
    if (apptChild) {
        if (pending > 0) { apptChild.textContent = pending; apptChild.style.display = 'inline-flex'; }
        else { apptChild.style.display = 'none'; }
    }
    // Sync group badge = pending appointments + pending feedback
    _syncApptGroupBadge(pending);
}

// ── XSS guards ───────────────────────────────────────────────
// Appointments and feedback are submitted from the PUBLIC website form by
// anyone on the internet, then rendered inside the logged-in admin session.
// Every dynamic field below goes through _admEsc — an unescaped fullname
// like <img onerror=…> would otherwise execute as the owner.
function _admEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Rating comes from the public form too — clamp before '★'.repeat(), which
// throws on negatives and can hang the tab on huge values.
function _admStars(rating) {
    const r = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
    return '★'.repeat(r) + '☆'.repeat(5 - r);
}

// Display recent appointments
function displayRecentAppointments() {
    const container = document.getElementById('recentAppointments');
    const recent = appointments.slice(0, 5);
    
    if (recent.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); padding: 20px;">No appointments yet.</p>';
        return;
    }
    
    container.innerHTML = recent.map(appointment => {
        const date = appointment.createdAt?.toDate();
        const dateStr = date ? date.toLocaleDateString() : 'N/A';
        
        return `
            <div class="appointment-item" onclick="showAppointmentDetails('${_admEsc(appointment.id)}')">
                <div class="appointment-date">${dateStr}</div>
                <div class="appointment-name">${_admEsc(appointment.fullname)}</div>
                <div class="appointment-service">${_admEsc(formatService(appointment.service))}</div>
                <span class="status-badge status-${_admEsc(appointment.status)}">${_admEsc(appointment.status)}</span>
                <button class="btn-secondary" onclick="event.stopPropagation(); showAppointmentDetails('${_admEsc(appointment.id)}')">View</button>
            </div>
        `;
    }).join('');
}

// Display all appointments
function displayAllAppointments() {
    const tbody = document.getElementById('appointmentsTableBody');
    
    if (appointments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No appointments found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = appointments.map(appointment => {
        const date = appointment.createdAt?.toDate();
        const dateStr = date ? date.toLocaleDateString() : 'N/A';
        
        const isPending = appointment.status === 'pending';
        return `
            <tr onclick="showAppointmentDetails('${_admEsc(appointment.id)}')">
                <td>${dateStr}</td>
                <td>${_admEsc(appointment.fullname)}</td>
                <td>${_admEsc(appointment.email)}</td>
                <td>${_admEsc(appointment.contact)}</td>
                <td>${_admEsc(formatService(appointment.service))}</td>
                <td><span class="status-badge status-${_admEsc(appointment.status)}">${_admEsc(appointment.status)}</span></td>
                <td style="position:relative;">
                    ${isPending ? '<span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:#ef4444;pointer-events:none;"></span>' : ''}
                    <select onchange="updateStatus('${_admEsc(appointment.id)}', this.value)" onclick="event.stopPropagation()">
                        <option value="">Update Status</option>
                        <option value="pending" ${isPending ? 'selected' : ''}>Pending</option>
                        <option value="confirmed" ${appointment.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                        <option value="completed" ${appointment.status === 'completed' ? 'selected' : ''}>Completed</option>
                        <option value="cancelled" ${appointment.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

// Filter appointments
function filterAppointments() {
    const statusFilter = document.getElementById('statusFilter').value;
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    
    const filtered = appointments.filter(appointment => {
        const matchesStatus = statusFilter === 'all' || appointment.status === statusFilter;
        const matchesSearch = 
            appointment.fullname.toLowerCase().includes(searchTerm) ||
            appointment.email.toLowerCase().includes(searchTerm);
        
        return matchesStatus && matchesSearch;
    });
    
    const tbody = document.getElementById('appointmentsTableBody');
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No matching appointments found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map(appointment => {
        const date = appointment.createdAt?.toDate();
        const dateStr = date ? date.toLocaleDateString() : 'N/A';
        
        const isPending = appointment.status === 'pending';
        return `
            <tr onclick="showAppointmentDetails('${_admEsc(appointment.id)}')">
                <td>${dateStr}</td>
                <td>${_admEsc(appointment.fullname)}</td>
                <td>${_admEsc(appointment.email)}</td>
                <td>${_admEsc(appointment.contact)}</td>
                <td>${_admEsc(formatService(appointment.service))}</td>
                <td><span class="status-badge status-${_admEsc(appointment.status)}">${_admEsc(appointment.status)}</span></td>
                <td style="position:relative;">
                    ${isPending ? '<span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:#ef4444;pointer-events:none;"></span>' : ''}
                    <select onchange="updateStatus('${_admEsc(appointment.id)}', this.value)" onclick="event.stopPropagation()">
                        <option value="">Update Status</option>
                        <option value="pending" ${isPending ? 'selected' : ''}>Pending</option>
                        <option value="confirmed" ${appointment.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                        <option value="completed" ${appointment.status === 'completed' ? 'selected' : ''}>Completed</option>
                        <option value="cancelled" ${appointment.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

// Update appointment status
async function updateStatus(appointmentId, newStatus) {
    if (!newStatus) return;

    const appointment = appointments.find(a => a.id === appointmentId);
    const clientName  = appointment?.fullname || 'this appointment';

    const statusColors = { confirmed: '#00a85e', completed: '#3b82f6', cancelled: '#ef4444', pending: '#f59e0b' };
    const statusColor  = statusColors[newStatus] || '#1e3a5f';

    const confirmed = await _showStatusConfirm(clientName, newStatus, statusColor);
    if (!confirmed) {
        // Revert dropdown to current status
        displayAllAppointments();
        return;
    }

    try {
        await db.collection('appointments').doc(appointmentId).update({
            status: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if (appointment) appointment.status = newStatus;
        updateDashboardStats();
        displayRecentAppointments();
        displayAllAppointments();
        _showAdminToast('Appointment status updated successfully.');
    } catch (error) {
        console.error('Error updating status:', error);
        _showAdminToast('Error updating status. Please try again.', true);
    }
}

function _showStatusConfirm(clientName, newStatus, color) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px);';
        overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;width:100%;max-width:380px;box-shadow:0 8px 40px rgba(0,0,0,0.18);overflow:hidden;">
            <div style="background:#1e3a5f;padding:18px 22px;">
                <div style="font-size:15px;font-weight:700;color:#fff;">Update Appointment Status</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px;">${_admEsc(clientName)}</div>
            </div>
            <div style="padding:22px;">
                <p style="font-size:13.5px;color:#374151;margin:0 0 16px;">Change status to <span style="font-weight:700;color:${color};text-transform:capitalize;">${newStatus}</span>?</p>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button id="_scCancel" style="padding:9px 20px;border-radius:8px;border:1.5px solid #e5e7eb;background:#fff;color:#374151;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>
                    <button id="_scConfirm" style="padding:9px 20px;border-radius:8px;border:none;background:${color};color:#fff;font-size:13px;font-weight:600;cursor:pointer;text-transform:capitalize;">Set ${newStatus}</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#_scConfirm').onclick = () => { overlay.remove(); resolve(true); };
        overlay.querySelector('#_scCancel').onclick  = () => { overlay.remove(); resolve(false); };
        overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
}

function _showAdminToast(msg, isError = false) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;right:24px;background:${isError ? '#b91c1c' : '#1e3a5f'};color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.3s;`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}

// Show appointment details
function showAppointmentDetails(appointmentId) {
    currentAppointment = appointments.find(a => a.id === appointmentId);
    if (!currentAppointment) return;
    
    const date = currentAppointment.createdAt?.toDate();
    const dateStr = date ? date.toLocaleDateString() + ' ' + date.toLocaleTimeString() : 'N/A';
    
    const detailsHTML = `
        <div class="detail-row">
            <div class="detail-label">Date Submitted</div>
            <div class="detail-value">${dateStr}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Full Name</div>
            <div class="detail-value">${_admEsc(currentAppointment.fullname)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Email</div>
            <div class="detail-value">${_admEsc(currentAppointment.email)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Contact Number</div>
            <div class="detail-value">${_admEsc(currentAppointment.contact)}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Service Required</div>
            <div class="detail-value">${_admEsc(formatService(currentAppointment.service))}</div>
        </div>
        <div class="detail-row">
            <div class="detail-label">Status</div>
            <div class="detail-value">
                <span class="status-badge status-${_admEsc(currentAppointment.status)}">${_admEsc(currentAppointment.status)}</span>
            </div>
        </div>
        ${currentAppointment.message ? `
            <div class="detail-row">
                <div class="detail-label">Project Details</div>
                <div class="detail-value">${_admEsc(currentAppointment.message)}</div>
            </div>
        ` : ''}
    `;
    
    document.getElementById('appointmentDetails').innerHTML = detailsHTML;
    document.getElementById('appointmentModal').classList.add('show');
}

// Close modal
function closeModal() {
    document.getElementById('appointmentModal').classList.remove('show');
    currentAppointment = null;
}

// Delete appointment
async function deleteAppointment() {
    if (!currentAppointment) return;
    
    if (!await showDeleteConfirm('Are you sure you want to delete this appointment?')) return;
    
    try {
        await db.collection('appointments').doc(currentAppointment.id).delete();
        
        // Remove from local array
        appointments = appointments.filter(a => a.id !== currentAppointment.id);
        
        // Refresh displays
        updateDashboardStats();
        displayRecentAppointments();
        displayServicesChart();
        displayAllAppointments();
        
        closeModal();
        _showAdminToast('Appointment deleted successfully.');
    } catch (error) {
        console.error('Error deleting appointment:', error);
        _showAdminToast('Error deleting appointment. Please try again.', true);
    }
}

// Display services chart (for Dashboard) - Now with line chart!
function displayServicesChart() {
    const canvas = document.getElementById('servicesChart');
    
    if (!canvas) return;
    
    // Destroy existing chart if any
    if (canvas.chartInstance) {
        canvas.chartInstance.destroy();
    }
    
    if (appointments.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#7A7A7A';
        ctx.font = '14px Barlow, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Get month data for the line chart
    const monthCounts = {};
    appointments.forEach(a => {
        const date = a.createdAt?.toDate();
        if (date) {
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
        }
    });
    
    // Get last 12 months starting from Jan 2026
    const months = [];
    for (let month = 0; month < 12; month++) {
        const key = `2026-${String(month + 1).padStart(2, '0')}`;
        const monthName = new Date(2026, month).toLocaleDateString('en-US', { month: 'short' });
        months.push({
            key,
            label: monthName,
            count: monthCounts[key] || 0
        });
    }
    
    const ctx = canvas.getContext('2d');
    const labels = months.map(m => m.label);
    const data = months.map(m => m.count);
    
    canvas.chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Appointments',
                data: data,
                borderColor: '#00D084',
                backgroundColor: 'rgba(0, 208, 132, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#00D084',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 12, weight: '600' },
                    bodyFont: { size: 11 },
                    padding: 8,
                    cornerRadius: 6,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `${context.parsed.y} appointment${context.parsed.y !== 1 ? 's' : ''}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        font: { size: 10 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        display: false,
                        drawBorder: false
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

// Display service distribution chart on dashboard
function displayDashboardServiceChart() {
    const canvas = document.getElementById('dashboardServiceChart');
    if (!canvas) return;
    
    if (canvas.chart) {
        canvas.chart.destroy();
    }
    
    if (appointments.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#7A7A7A';
        ctx.font = '14px Barlow, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    const serviceCounts = {};
    appointments.forEach(a => {
        const service = formatService(a.service);
        serviceCounts[service] = (serviceCounts[service] || 0) + 1;
    });
    
    const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);
    const labels = sortedServices.map(s => s[0]);
    const data = sortedServices.map(s => s[1]);
    
    const colors = [
        '#00D084',
        '#00A86B',
        '#4DFFB8',
        '#17a2b8',
        '#ffc107',
        '#28a745',
        '#6c757d'
    ];
    
    const ctx = canvas.getContext('2d');
    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#fff',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 12,
                        font: { size: 11 },
                        color: '#4A4A4A',
                        usePointStyle: true,
                        pointStyle: 'circle',
                        boxWidth: 8,
                        boxHeight: 8,
                        generateLabels: function(chart) {
                            const data = chart.data;
                            const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                            return data.labels.map((label, i) => {
                                const value = data.datasets[0].data[i];
                                const percentage = ((value / total) * 100).toFixed(1);
                                return {
                                    text: `${label}: ${value} (${percentage}%)`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    hidden: false,
                                    index: i
                                };
                            });
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    padding: 10,
                    cornerRadius: 6,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.parsed / total) * 100).toFixed(1);
                            return `${context.label}: ${context.parsed} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

// Display status chart on dashboard
function displayDashboardStatusChart() {
    const canvas = document.getElementById('dashboardStatusChart');
    if (!canvas) return;
    
    if (canvas.chart) {
        canvas.chart.destroy();
    }
    
    if (appointments.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#7A7A7A';
        ctx.font = '14px Barlow, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    const statusCounts = {
        pending: 0,
        confirmed: 0,
        completed: 0,
        cancelled: 0
    };
    
    appointments.forEach(a => {
        if (statusCounts.hasOwnProperty(a.status)) {
            statusCounts[a.status]++;
        }
    });
    
    const labels = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
    const data = [statusCounts.pending, statusCounts.confirmed, statusCounts.completed, statusCounts.cancelled];
    const colors = ['#ffc107', '#17a2b8', '#28a745', '#dc3545'];
    
    const ctx = canvas.getContext('2d');
    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: data,
                backgroundColor: colors,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    padding: 10,
                    cornerRadius: 6,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.parsed.y / total) * 100).toFixed(1);
                            return `${context.parsed.y} appointments (${percentage}%)`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        font: { size: 11 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        font: { size: 11 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        display: false,
                        drawBorder: false
                    }
                }
            }
        }
    });
}

// ============================================
// ADVANCED ANALYTICS CHARTS
// ============================================

// Display analytics with Chart.js
function displayAnalytics() {
    console.log('📊 displayAnalytics called, appointments:', appointments.length);
    
    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js not loaded yet, retrying...');
        setTimeout(displayAnalytics, 100);
        return;
    }
    
    if (appointments.length === 0) {
        console.warn('⚠️ No appointments data available for analytics');
        // Show empty state message
        const charts = ['monthlyTrendChart', 'serviceBreakdownChart', 'statusBreakdownChart', 'weeklyActivityChart'];
        charts.forEach(chartId => {
            const canvas = document.getElementById(chartId);
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#7A7A7A';
                ctx.font = '14px Barlow, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('No appointment data available', canvas.width / 2, canvas.height / 2);
            }
        });
        return;
    }
    
    updateAnalyticsMetrics();
    displayMonthlyTrendChartJS();
    displayServiceBreakdownChartJS();
    displayStatusBreakdownChartJS();
    displayWeeklyActivityChart();
    
    console.log('✅ All analytics charts rendered');
}

// Update analytics metrics
function updateAnalyticsMetrics() {
    if (appointments.length === 0) return;
    
    // Conversion rate (completed / total)
    const completed = appointments.filter(a => a.status === 'completed').length;
    const conversionRate = ((completed / appointments.length) * 100).toFixed(1);
    document.getElementById('conversionRate').textContent = conversionRate + '%';
    
    // Popular service
    const serviceCounts = {};
    appointments.forEach(a => {
        const service = formatService(a.service);
        serviceCounts[service] = (serviceCounts[service] || 0) + 1;
    });
    const popularService = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1])[0];
    if (popularService) {
        const shortName = popularService[0].split(' ')[0];
        document.getElementById('popularService').textContent = shortName;
    }
    
    // Growth rate calculation
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const lastMonthCount = appointments.filter(a => {
        const date = a.createdAt?.toDate();
        return date && date >= lastMonth && date < thisMonth;
    }).length;
    
    const thisMonthCount = appointments.filter(a => {
        const date = a.createdAt?.toDate();
        return date && date >= thisMonth;
    }).length;
    
    const growthRate = lastMonthCount > 0 
        ? (((thisMonthCount - lastMonthCount) / lastMonthCount) * 100).toFixed(0)
        : 0;
    document.getElementById('growthRate').textContent = (growthRate > 0 ? '+' : '') + growthRate + '%';
}

// Monthly trend chart with Chart.js
function displayMonthlyTrendChartJS() {
    const canvas = document.getElementById('monthlyTrendChart');
    if (!canvas) {
        console.error('❌ monthlyTrendChart canvas not found');
        return;
    }
    
    console.log('📊 Rendering monthly trend chart, appointments:', appointments.length);
    
    // Check Chart.js
    if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js not available in displayMonthlyTrendChartJS');
        return;
    }
    
    // Destroy existing chart
    if (canvas.chart) {
        canvas.chart.destroy();
    }
    
    if (appointments.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#7A7A7A';
        ctx.font = '14px Barlow, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Prepare data - 2026 only, January to December
    const currentYear = 2026;
    const monthlyData = {};
    
    // Initialize all 12 months of current year
    for (let month = 0; month < 12; month++) {
        const key = `${currentYear}-${String(month + 1).padStart(2, '0')}`;
        monthlyData[key] = 0;
    }
    
    appointments.forEach(a => {
        const date = a.createdAt?.toDate();
        if (date && date.getFullYear() === currentYear) {
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (monthlyData.hasOwnProperty(key)) {
                monthlyData[key]++;
            }
        }
    });
    
    const labels = Object.keys(monthlyData).map(key => {
        const [year, month] = key.split('-');
        return new Date(year, month - 1).toLocaleDateString('en-US', { month: 'short' });
    });
    
    const data = Object.values(monthlyData);
    
    const ctx = canvas.getContext('2d');
    canvas.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Appointments',
                data: data,
                borderColor: '#00D084',
                backgroundColor: 'rgba(0, 208, 132, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#00D084',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 14, weight: '600' },
                    bodyFont: { size: 13 },
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        font: { size: 12 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        font: { size: 12 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        display: false,
                        drawBorder: false
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
    
    console.log('✅ Monthly trend chart rendered successfully');
}

// Service breakdown doughnut chart
function displayServiceBreakdownChartJS() {
    const canvas = document.getElementById('serviceBreakdownChart');
    if (!canvas) {
        console.error('❌ serviceBreakdownChart canvas not found');
        return;
    }
    
    console.log('📊 Rendering service breakdown chart');
    
    if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js not available in displayServiceBreakdownChartJS');
        return;
    }
    
    if (canvas.chart) {
        canvas.chart.destroy();
    }
    
    const serviceCounts = {};
    appointments.forEach(a => {
        const service = formatService(a.service);
        serviceCounts[service] = (serviceCounts[service] || 0) + 1;
    });
    
    const sortedServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);
    const labels = sortedServices.map(s => s[0]);
    const data = sortedServices.map(s => s[1]);
    
    const colors = [
        '#00D084',
        '#00A86B',
        '#4DFFB8',
        '#17a2b8',
        '#ffc107',
        '#28a745',
        '#6c757d'
    ];
    
    const ctx = canvas.getContext('2d');
    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#fff',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 12,
                        font: { size: 11 },
                        color: '#4A4A4A',
                        usePointStyle: true,
                        pointStyle: 'circle',
                        boxWidth: 8,
                        boxHeight: 8,
                        generateLabels: function(chart) {
                            const data = chart.data;
                            const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                            return data.labels.map((label, i) => {
                                const value = data.datasets[0].data[i];
                                const percentage = ((value / total) * 100).toFixed(1);
                                return {
                                    text: `${label}: ${value} (${percentage}%)`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    hidden: false,
                                    index: i
                                };
                            });
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 14, weight: '600' },
                    bodyFont: { size: 13 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.parsed / total) * 100).toFixed(1);
                            return `${context.label}: ${context.parsed} (${percentage}%)`;
                        }
                    }
                }
            },
            cutout: '70%'
        }
    });
}

// Status breakdown bar chart
function displayStatusBreakdownChartJS() {
    const canvas = document.getElementById('statusBreakdownChart');
    if (!canvas) {
        console.error('❌ statusBreakdownChart canvas not found');
        return;
    }
    
    console.log('📊 Rendering status breakdown chart');
    
    if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js not available in displayStatusBreakdownChartJS');
        return;
    }
    
    if (canvas.chart) {
        canvas.chart.destroy();
    }
    
    const statusCounts = {
        pending: 0,
        confirmed: 0,
        completed: 0,
        cancelled: 0
    };
    
    appointments.forEach(a => {
        if (statusCounts.hasOwnProperty(a.status)) {
            statusCounts[a.status]++;
        }
    });
    
    const labels = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
    const data = [statusCounts.pending, statusCounts.confirmed, statusCounts.completed, statusCounts.cancelled];
    const colors = ['#ffc107', '#17a2b8', '#28a745', '#dc3545'];
    
    const ctx = canvas.getContext('2d');
    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: data,
                backgroundColor: colors,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 14, weight: '600' },
                    bodyFont: { size: 13 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.parsed.y / total) * 100).toFixed(1);
                            return `${context.parsed.y} appointments (${percentage}%)`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        font: { size: 12 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        font: { size: 12 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        display: false,
                        drawBorder: false
                    }
                }
            }
        }
    });
}

// Weekly activity chart
function displayWeeklyActivityChart() {
    const canvas = document.getElementById('weeklyActivityChart');
    if (!canvas) {
        console.error('❌ weeklyActivityChart canvas not found');
        return;
    }
    
    console.log('📊 Rendering weekly activity chart');
    
    if (typeof Chart === 'undefined') {
        console.error('❌ Chart.js not available in displayWeeklyActivityChart');
        return;
    }
    
    if (canvas.chart) {
        canvas.chart.destroy();
    }
    
    const dayCount = {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0
    };
    
    appointments.forEach(a => {
        const date = a.createdAt?.toDate();
        if (date) {
            dayCount[date.getDay()]++;
        }
    });
    
    const labels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const data = [dayCount[0], dayCount[1], dayCount[2], dayCount[3], dayCount[4], dayCount[5], dayCount[6]];
    
    const ctx = canvas.getContext('2d');
    canvas.chart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Appointments',
                data: data,
                borderColor: '#00D084',
                backgroundColor: 'rgba(0, 208, 132, 0.2)',
                borderWidth: 2,
                pointBackgroundColor: '#00D084',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 14, weight: '600' },
                    bodyFont: { size: 13 },
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        font: { size: 11 },
                        color: '#7A7A7A'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    pointLabels: {
                        font: { size: 12 },
                        color: '#4A4A4A'
                    }
                }
            }
        }
    });
}



// Format service name
function formatService(service) {
    const services = {
        'architectural-design': 'Architectural Design',
        'building-interiors': 'Building Architectural Interiors',
        'interior-construction': 'Architectural Interior Construction',
        'structural-inspection': 'Structural Inspection',
        'electrical-engineering': 'Electrical Engineering Services',
        'cad-operations': 'CAD & Operations',
        'consultation': 'General Consultation'
    };
    return services[service] || service;
}

// Real-time updates — started only after successful auth (see showDashboard)
// Unsubscribe ref stored so it can be torn down on logout
let _appointmentsUnsub = null;

console.log('✅ Admin Dashboard Loaded Successfully');
console.log('📊 Advanced Analytics Charts Enabled');

// Verify Chart.js is loaded
if (typeof Chart !== 'undefined') {
    console.log('✅ Chart.js version:', Chart.version);
} else {
    console.error('❌ Chart.js NOT LOADED - Analytics will not work!');
    console.log('Attempting to load Chart.js from CDN...');
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.onload = () => {
        console.log('✅ Chart.js loaded dynamically');
        if (currentView === 'analytics') {
            displayAnalytics();
        }
    };
    script.onerror = () => console.error('❌ Failed to load Chart.js dynamically');
    document.head.appendChild(script);
}
// ── Mobile Sidebar ────────────────────────────────────────
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isOpen  = sidebar.classList.contains('mobile-open');
    if (isOpen) {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    } else {
        sidebar.classList.add('mobile-open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeSidebar() {
    document.querySelector('.sidebar')?.classList.remove('mobile-open');
    document.getElementById('sidebarOverlay')?.classList.remove('active');
    document.body.style.overflow = '';
}

// Close sidebar when a nav item is clicked on mobile
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        if (window.innerWidth <= 768) closeSidebar();
    });
});

// ============================================
// FEEDBACK MANAGEMENT
// ============================================
let allFeedback = [];
async function loadFeedback() {
    try {
        const snapshot = await db.collection('testimonials').get();
        allFeedback = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        displayAllFeedback();
        const pendingCount = allFeedback.filter(f => (f.status || 'pending') === 'pending').length;
        _syncFeedbackBadge(pendingCount);
    } catch (error) { console.error('Error loading feedback:', error); }
}

let feedbackList = [];

function displayAllFeedback() {
    feedbackList = [...allFeedback].sort((a, b) =>
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
    );
    renderFeedbackTable();
    setupFeedbackFilters();
}

function renderFeedbackTable() {
    const tbody = document.getElementById('feedbackTableBody');
    
    if (feedbackList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No feedback found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = feedbackList.map(t => {
        const date = t.createdAt?.toDate();
        const dateStr = date ? date.toLocaleDateString() : 'N/A';
        const stars = _admStars(t.rating);
        
        return `
            <tr>
                <td>${dateStr}</td>
                <td>${_admEsc(t.name)}</td>
                <td>${_admEsc(t.location)}</td>
                <td style="color: #FFD700;">${stars}</td>
                <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${_admEsc(t.message)}</td>
                <td><span class="status-badge status-${_admEsc(t.status)}">${_admEsc(t.status)}</span></td>
                <td>
                    <select onchange="updateFeedbackStatus('${_admEsc(t.id)}', this.value)" onclick="event.stopPropagation()">
                        <option value="">Update Status</option>
                        <option value="pending" ${t.status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="approved" ${t.status === 'approved' ? 'selected' : ''}>Approved</option>
                        <option value="rejected" ${t.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                    <button class="btn-danger" style="margin-left: 8px; padding: 6px 12px; font-size: 13px;" onclick="deleteFeedback('${_admEsc(t.id)}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function setupFeedbackFilters() {
    const statusFilter = document.getElementById('feedbackStatusFilter');
    const searchInput = document.getElementById('feedbackSearchInput');
    
    statusFilter?.addEventListener('change', filterFeedback);
    searchInput?.addEventListener('input', filterFeedback);
}

function filterFeedback() {
    const ratingFilter = document.getElementById('feedbackStatusFilter').value;
    const searchTerm = document.getElementById('feedbackSearchInput').value.toLowerCase();
    
    const filtered = feedbackList.filter(t => {
        const matchesRating = ratingFilter === 'all' || t.rating === parseInt(ratingFilter);
        const matchesSearch = 
            t.name.toLowerCase().includes(searchTerm) ||
            t.location.toLowerCase().includes(searchTerm) ||
            t.message.toLowerCase().includes(searchTerm);
        
        return matchesRating && matchesSearch;
    });
    
    const tbody = document.getElementById('feedbackTableBody');
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">No matching feedback found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = filtered.map(t => {
        const date = t.createdAt?.toDate();
        const dateStr = date ? date.toLocaleDateString() : 'N/A';
        const stars = _admStars(t.rating);
        
        return `
            <tr>
                <td>${dateStr}</td>
                <td>${_admEsc(t.name)}</td>
                <td>${_admEsc(t.location)}</td>
                <td style="color: #FFD700;">${stars}</td>
                <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${_admEsc(t.message)}</td>
                <td><span class="status-badge status-${_admEsc(t.status)}">${_admEsc(t.status)}</span></td>
                <td>
                    <select onchange="updateFeedbackStatus('${_admEsc(t.id)}', this.value)" onclick="event.stopPropagation()">
                        <option value="">Update Status</option>
                        <option value="pending" ${t.status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="approved" ${t.status === 'approved' ? 'selected' : ''}>Approved</option>
                        <option value="rejected" ${t.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                    <button class="btn-danger" style="margin-left: 8px; padding: 6px 12px; font-size: 13px;" onclick="deleteFeedback('${_admEsc(t.id)}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function updateFeedbackStatus(feedbackId, newStatus) {
    if (!newStatus) return;
    
    try {
        await db.collection('testimonials').doc(feedbackId).update({
            status: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        const feedback = feedbackList.find(t => t.id === feedbackId);
        if (feedback) feedback.status = newStatus;
        const cached = allFeedback.find(t => t.id === feedbackId);
        if (cached) cached.status = newStatus;

        renderFeedbackTable();
        _showAdminToast('Feedback status updated successfully.');
    } catch (error) {
        console.error('Error updating feedback status:', error);
        _showAdminToast('Error updating status. Please try again.', true);
    }
}

async function deleteFeedback(feedbackId) {
    if (!await showDeleteConfirm('Are you sure you want to delete this feedback?')) return;
    
    try {
        await db.collection('testimonials').doc(feedbackId).delete();
        feedbackList = feedbackList.filter(t => t.id !== feedbackId);
        allFeedback = allFeedback.filter(t => t.id !== feedbackId);
        renderFeedbackTable();
        _showAdminToast('Feedback deleted successfully.');
    } catch (error) {
        console.error('Error deleting feedback:', error);
        _showAdminToast('Error deleting feedback. Please try again.', true);
    }
}

window.displayAllFeedback = displayAllFeedback;
window.updateFeedbackStatus = updateFeedbackStatus;
window.deleteFeedback = deleteFeedback;

/* ════════════════════════════════════════════════════════════
   PORTAL CHROME — top-nav driven navigation
   Data-driven primary tabs + secondary modules row that mirror
   the old left-sidebar groups. Each module routes to switchView.
═════════════════════════════════════════════════════════════ */
const PRIMARY_NAV = [
    { id: 'expenses', label: 'Project Control', sub: 'Monitoring · Billing · Reports', defaultView: 'dacsPortal',
      modules: [
        { view: 'dacsPortal',  label: 'Overview',         icon: 'line-chart' },
        { view: 'expReports',  label: 'Reports',          icon: 'file-bar-chart' },
        { view: 'expOverhead', label: 'Overhead',         icon: 'building-2' },
        // Client Reimbursement Tracker — expenses the owner/admin advanced and
        // whether the client paid them back. Tracking only; owner-only (0041).
        { view: 'reimbursements', label: 'Reimbursement', icon: 'hand-coins' },
        // Merged from the former standalone "Billing & Reports" module — these
        // are the full editors (create/edit BOQ, payments, invoices), not copies.
        { view: 'boqBuilder',      label: 'Accomplishment',   icon: 'file-spreadsheet' },
        { view: 'clientAccounts',  label: 'Clients',          icon: 'user-circle' },
        { view: 'paymentRequests', label: 'Payment Requests', icon: 'credit-card' },
        { view: 'invoices',        label: 'Invoice Receipt',  icon: 'receipt-text' },
      ]
    },
    { id: 'construction', label: 'Construction', sub: 'Materials & Orders', defaultView: 'consBatch',
      modules: [
        { view: 'consBatch',        label: 'Current Batch',   icon: 'package' },
        { view: 'consUrgent',       label: 'Urgent Requests', icon: 'alert-circle' },
        { view: 'consBatchHistory', label: 'Batch History',   icon: 'calendar' },
        { view: 'consInventory',    label: 'Inventory',       icon: 'box' },
      ]
    },
    { id: 'pm', label: 'Project Management', sub: 'Projects', defaultView: 'pmProjects',
      modules: [
        { view: 'pmProjects',          label: 'Projects',             icon: 'folder-open' },
        { view: 'terminationRequests', label: 'Project Closeout',     icon: 'check-circle' },
        // Warranty Retention register + fund — the retention frozen when a
        // project completes, and draws against the accumulated pool.
        // Tracking only; owner-only (0043).
        { view: 'warrantyFund',        label: 'Warranty Fund',        icon: 'shield-check' },
        { view: 'pmReports',           label: 'Reports',              icon: 'file-bar-chart' },
      ]
    },
    // Outgoing client quotations. Pre-sales: a quotation exists before any
    // project does, and belongs to NEITHER project system — hence its own
    // top-level tab rather than a slot under Project Control.
    // Owner-only (0045), like Reimbursement and Warranty Fund.
    { id: 'quotations', label: 'Quotations', sub: 'Estimates & Proposals', defaultView: 'quoteList',
      modules: [
        { view: 'quoteList', label: 'Quotations', icon: 'file-text' },
      ]
    },
    { id: 'appointments', label: 'Appointments', sub: 'Workflow', defaultView: 'dashboard',
      modules: [
        // Dashboard is the primary's default landing — clicking the "Appointments"
        // tab already takes you here, so keep it as a route target but hide it
        // from the secondary row to avoid the duplicated label.
        { view: 'dashboard',    label: 'Dashboard',    icon: 'layout-dashboard', hidden: true },
        { view: 'appointments', label: 'Appointments', icon: 'calendar-check' },
        { view: 'analytics',    label: 'Analytics',    icon: 'bar-chart-2' },
        { view: 'feedback',     label: 'Feedback',     icon: 'message-square' },
      ]
    },
    // Worker attendance, written by the native Android app through the
    // RPCs in 0050/0051. Owner + staff only; workers use the app, not
    // this portal, and must never see other workers' records.
    { id: 'attendance', label: 'Attendance', sub: 'Workers · Time In / Out', defaultView: 'attToday',
      modules: [
        { view: 'attToday', label: "Today", icon: 'calendar-check' },
      ]
    },
    { id: 'users', label: 'Users', sub: 'People', defaultView: 'userNavigator',
      modules: [
        { view: 'userNavigator', label: 'Navigator', icon: 'user-round' },
      ]
    },
];

// When an account is flagged with allowed_modules, it is "focused" to those
// PRIMARY_NAV sections on EVERY screen size (desktop + mobile alike).
function _activeFocus() {
    return (Array.isArray(currentAllowedModules) && currentAllowedModules.length)
        ? currentAllowedModules : null;
}
// Sub-views reachable *inside* a section but not shown as their own nav button
// (e.g. opening a project drills from pmProjects → pmWorkspace). Keep in sync
// with the *_VIEWS groups in admin.html's switchView so the focus guard doesn't
// block a legitimate drill-down. Keyed by PRIMARY_NAV section id.
const _FOCUS_SUBVIEWS = {
    pm:       ['pmWorkspace'],
    expenses: ['expOverview', 'expExpenses', 'laborInvoices'],
    quotations: ['quoteEditor', 'quoteRevision'],
    // Drill-down from the today list into one worker's day. Without this
    // an allowed_modules account can open the section but not any row.
    attendance: ['attWorker'],
};
// All views reachable inside the focused module(s) — used by the switchView guard.
window.focusAllowedViews = function () {
    if (!Array.isArray(currentAllowedModules) || !currentAllowedModules.length) return [];
    const views = [];
    PRIMARY_NAV.forEach(p => {
        if (!currentAllowedModules.includes(p.id)) return;
        p.modules.forEach(m => views.push(m.view));
        (_FOCUS_SUBVIEWS[p.id] || []).forEach(v => views.push(v));
    });
    return views;
};
// Landing view for the first focused module (e.g. 'pm' → 'pmProjects').
window.focusDefaultView = function () {
    if (!Array.isArray(currentAllowedModules) || !currentAllowedModules.length) return null;
    const p = PRIMARY_NAV.find(x => currentAllowedModules.includes(x.id));
    return p ? p.defaultView : null;
};

// Role-filtered view of PRIMARY_NAV. Staff lose the Users tab and the Clients
// module; workers/teamLeaders see only Construction. Owner sees everything.
function _visibleNav() {
    const role = currentUserRole;
    let nav = PRIMARY_NAV
        .filter(p => {
            // Quotations is peso amounts end to end and owner-only by RLS
            // (0045) — same reasoning as Reimbursement and Warranty Fund.
            if (role === 'staff') return p.id !== 'users' && p.id !== 'quotations';
            // Workers record attendance in the app; they must never see
            // the roll-up of everyone else's. RLS enforces it too — this
            // just keeps the tab out of the nav.
            if (role === 'worker' || role === 'teamLeader') return p.id === 'construction';
            return true;
        })
        .map(p => {
            if (role === 'staff' && p.id === 'expenses') {
                // Reports is a money dashboard end to end — hidden from staff
                // along with Client Accounts. Reimbursement is the same: every
                // column is a peso amount, and its RLS is owner-only (0041).
                const hidden = ['clientAccounts', 'expReports', 'reimbursements'];
                return { ...p, modules: p.modules.filter(m => !hidden.includes(m.view)) };
            }
            if (role === 'staff' && p.id === 'pm') {
                // Warranty Fund is peso amounts end to end and owner-only by
                // RLS (0043) — same reasoning as Reimbursement above.
                const hidden = ['warrantyFund'];
                return { ...p, modules: p.modules.filter(m => !hidden.includes(m.view)) };
            }
            return p;
        });

    // Module-focus: an account flagged with allowed_modules sees ONLY those
    // sections, on every screen size. Falls back to the full nav if the focus
    // list matches nothing (avoids an empty menu).
    const focus = _activeFocus();
    if (focus) {
        const narrowed = nav.filter(p => focus.includes(p.id));
        if (narrowed.length) nav = narrowed;
    }
    return nav;
}

function findPrimaryForView(view) {
    for (const p of _visibleNav()) {
        if (p.modules.find(m => m.view === view)) return p;
    }
    return null;
}

function _buildTabsBar(activePrimaryId) {
    const tabs = document.getElementById('portalPrimaryTabs');
    if (!tabs) return;

    const nav = _visibleNav();

    // Always show every section — no collapse/expand toggle.
    // Project Control / Project Management carry an Expense-Inbox "receipts
    // waiting" mark; it is filled from the cached counts right after this
    // rebuild, since re-rendering the bar wipes whatever was in the spans.
    tabs.innerHTML =
        nav.map((p) => {
            const isActive = p.id === activePrimaryId;
            const badge = (p.id === 'expenses' || p.id === 'pm')
                ? `<span class="rm rm-count rm-sm" data-ptab-badge="${p.id}" style="margin-left:6px;" hidden></span>`
                : '';
            return `<button class="portal-ptab${isActive ? ' active' : ''}" data-primary="${p.id}">${p.label}${badge}</button>`;
        }).join('');

    if (typeof window.eiSyncTabBadges === 'function') window.eiSyncTabBadges();

    tabs.querySelectorAll('.portal-ptab').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.primary;
            const primary = PRIMARY_NAV.find(p => p.id === id);
            if (primary) switchView(primary.defaultView);
        });
    });
}

function renderPortalChrome() {
    _buildTabsBar(null);

    // Top-nav logout button mirrors sidebar logout
    const topLogout = document.getElementById('logoutBtnTop');
    if (topLogout) {
        topLogout.addEventListener('click', () => {
            const modal = document.getElementById('logoutModal');
            if (modal) modal.style.display = 'flex';
        });
    }
}

function syncPortalChrome(view) {
    const primary = findPrimaryForView(view);
    if (!primary) return;

    // Rebuild tabs bar with correct active state
    _buildTabsBar(primary.id);

    const row = document.getElementById('portalModulesRow');
    if (!row) return;

    const visibleModules = primary.modules.filter(m => !m.hidden);

    // Always show every module — no collapse/expand toggle.
    row.innerHTML =
        '<div class="portal-modules-track">' +
        visibleModules.map((m) => {
            const isActive = m.view === view;
            return `<button class="portal-module-link${isActive ? ' active-link' : ''}" data-view="${m.view}">
                <i data-lucide="${m.icon}" style="width:14px;height:14px;"></i>
                <span>${m.label}</span>
            </button>`;
        }).join('') +
        '</div>';

    row.querySelectorAll('.portal-module-link').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();

    // Hide the duplicate page-title block on Project Control (which renders its own title)
    document.body.classList.toggle('dacs-portal-active', view === 'dacsPortal');
}

document.addEventListener('DOMContentLoaded', renderPortalChrome);