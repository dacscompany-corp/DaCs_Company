
// ── Forgot Password ──────────────────────────────────────────
// Cloudflare Turnstile widget for the forgot-password modal (rendered on demand)
let _fpWidgetId = null;
function _fpRenderOrReset() {
    if (!window.turnstile) return;
    try {
        if (_fpWidgetId === null) _fpWidgetId = turnstile.render('#fp-captcha', { sitekey: '0x4AAAAAADgIAGT-ZrooN5eY' });
        else turnstile.reset(_fpWidgetId);
    } catch (e) {}
}
function _fpToken() {
    try { return (window.turnstile && _fpWidgetId !== null) ? (turnstile.getResponse(_fpWidgetId) || undefined) : undefined; }
    catch (e) { return undefined; }
}

window.doForgotPassword = function () {
    var modal = document.getElementById('forgotPasswordModal');
    var input = document.getElementById('forgotEmailInput');
    var msg   = document.getElementById('forgotPasswordMsg');
    // Pre-fill with whatever is in the login email field
    var loginEmail = (document.getElementById('login-email') || {}).value || '';
    if (input) input.value = loginEmail;
    if (msg)   { msg.style.display = 'none'; msg.textContent = ''; }
    if (modal) modal.style.display = 'flex';
    _fpRenderOrReset(); // fresh captcha each time the modal opens
    setTimeout(function() { if (input) input.focus(); }, 100);
};

window.closeForgotPasswordModal = function () {
    var modal = document.getElementById('forgotPasswordModal');
    if (modal) modal.style.display = 'none';
};

window.sendResetEmail = async function () {
    var input = document.getElementById('forgotEmailInput');
    var msg   = document.getElementById('forgotPasswordMsg');
    var btn   = document.getElementById('sendResetBtn');
    var email = (input ? input.value : '').trim();

    function showMsg(text, isError) {
        if (!msg) return;
        msg.textContent    = text;
        msg.style.display  = 'block';
        msg.style.background = isError ? '#fef2f2' : '#f0fdf4';
        msg.style.color      = isError ? '#b91c1c' : '#065f46';
        msg.style.border     = '1px solid ' + (isError ? '#fecaca' : '#a7f3d0');
    }

    if (!email) { showMsg('Please enter your email address.', true); return; }
    if (!/^[^s@]+@[^s@]+.[^s@]+$/.test(email)) { showMsg('Please enter a valid email address.', true); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
        await firebase.auth().sendPasswordResetEmail(email, _fpToken());
        showMsg('Reset link sent! Check your email inbox (and spam folder).', false);
        if (input) input.value = '';
        setTimeout(function() { window.closeForgotPasswordModal(); }, 3000);
    } catch (e) {
        _fpRenderOrReset(); // refresh captcha so a retry gets a fresh token
        var errMsg = 'Failed to send reset email.';
        if (e.code === 'auth/user-not-found')    errMsg = 'No account found with this email address.';
        else if (e.code === 'auth/invalid-email') errMsg = 'Invalid email address.';
        else if (e.code === 'auth/too-many-requests') errMsg = 'Too many requests. Please try again later.';
        showMsg(errMsg, true);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; }
    }
};

// ============================================================
// CLIENT PORTAL — Firebase Edition
// DAC's Building Design Services
// ============================================================

// ── State ────────────────────────────────────────────────
let currentUser     = null;   // Firebase Auth user
let currentProfile  = null;   // Firestore clientUsers doc
let currentBoqDocs  = [];     // boqDocuments for this client
let currentFolder   = null;   // primary folder document (first)
let currentFolders  = [];     // all folder documents for this client
let currentProjects = [];     // billing periods across all folders
let _notifications      = [];   // local computed (overdue billing)
let _firestoreNotifs    = [];   // real-time from Firestore notifications subcollection
let _notifUnsub         = null;
let _reportFilter       = 'all';
let sidebarOpen         = true;

// ── Real-time listener handles (so we can unsubscribe) ────
let _boqUnsub     = null;
let _initialLoad  = true;   // suppress toast on first load

// ── Auth State ───────────────────────────────────────────
auth.onAuthStateChanged(async user => {
    if (user) {
        // Verify the user has a record in the clientUsers collection
        try {
            const clientDoc = await db.collection('clientUsers').doc(user.uid).get();
            if (!clientDoc.exists) {
                await auth.signOut();
                currentUser = null;
                showLoginPage();
                showClientLoginError('Access denied. This account is not registered as a client.');
                return;
            }
        } catch (err) {
            console.error('Auth check error:', err);
            await auth.signOut();
            currentUser = null;
            showLoginPage();
            showClientLoginError('Unable to verify your account. Please try again.');
            return;
        }

        currentUser = user;
        try {
            await Promise.all([loadClientData(user), loadUserProfile(user)]);
            enterDashboard();
        } catch (err) {
            console.error('Client portal load error:', err);
            showToast('Error loading data. Please refresh.');
        }
    } else {
        currentUser = null;
        showLoginPage();
    }
});

function showClientLoginError(message) {
    const errEl = document.getElementById('login-error');
    if (errEl) {
        errEl.textContent = message;
        errEl.classList.add('show');
    }
}

// ── Login ────────────────────────────────────────────────
async function doLogin() {
    clearLoginErrors();
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;
    let valid   = true;

    if (!email)                    { setError('err-login-email',    'Please enter your email address.');                       valid = false; }
    else if (!isValidEmail(email)) { setError('err-login-email',    'That email doesn\'t look right. Example: name@gmail.com'); valid = false; }
    if (!pass)                     { setError('err-login-password', 'Please enter your password.');                             valid = false; }
    if (!valid) return;

    const btn = document.getElementById('btn-login');
    btn.disabled = true; btn.textContent = 'Signing in…';

    try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        await auth.signInWithEmailAndPassword(email, pass);
        // onAuthStateChanged handles the rest
    } catch (err) {
        const loginErr = document.getElementById('login-error');
        if (err.code === 'auth/user-not-found')      loginErr.textContent = 'No account found with that email. Check for typos or create an account.';
        else if (err.code === 'auth/wrong-password')  loginErr.textContent = 'Wrong password. Please check and try again.';
        else if (err.code === 'auth/too-many-requests') loginErr.textContent = 'Too many failed attempts. Please wait a moment before trying again.';
        else if (err.code === 'auth/user-disabled')   loginErr.textContent = 'This account has been disabled. Please contact support.';
        else                                          loginErr.textContent = 'Incorrect email or password. Please try again.';
        loginErr.classList.add('show');
        btn.disabled = false; btn.textContent = 'Sign In';
    }
}

// ── Sign Up ──────────────────────────────────────────────
async function doSignup() {
    clearSignupErrors();
    const firstName = document.getElementById('su-firstname').value.trim();
    const lastName  = document.getElementById('su-lastname').value.trim();
    const email     = document.getElementById('su-email').value.trim();
    const password  = document.getElementById('su-password').value;
    const confirm   = document.getElementById('su-confirm').value;
    let valid = true;

    if (!firstName)                    { setError('err-su-firstname', 'Please enter your first name.');                              valid = false; }
    else if (firstName.length < 2)     { setError('err-su-firstname', 'First name must be at least 2 characters.');                  valid = false; }
    if (!lastName)                     { setError('err-su-lastname',  'Please enter your last name.');                               valid = false; }
    else if (lastName.length < 2)      { setError('err-su-lastname',  'Last name must be at least 2 characters.');                   valid = false; }
    if (!email)                        { setError('err-su-email',     'Please enter your email address.');                           valid = false; }
    else if (!isValidEmail(email))     { setError('err-su-email',     'That email doesn\'t look right. Example: name@gmail.com');    valid = false; }
    if (!password)                     { setError('err-su-password',  'Please create a password.');                                  valid = false; }
    else if (password.length < 8)      { setError('err-su-password',  'Password must be at least 8 characters long.');               valid = false; }
    else if (getPasswordStrength(password) < 2) { setError('err-su-password', 'Password is too weak. Add uppercase letters, numbers, or symbols.'); valid = false; }
    if (!confirm)                      { setError('err-su-confirm',   'Please re-enter your password to confirm.');                  valid = false; }
    else if (confirm !== password)     { setError('err-su-confirm',   'Passwords don\'t match. Please check and try again.');        valid = false; }
    if (!valid) return;

    const btn = document.getElementById('btn-signup');
    btn.disabled = true; btn.textContent = 'Creating account…';

    try {
        await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        await db.collection('clientUsers').doc(cred.user.uid).set({
            firstName, lastName, email,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // onAuthStateChanged handles the rest
    } catch (err) {
        let msg = 'Something went wrong. Please try again.';
        if (err.code === 'auth/email-already-in-use') msg = 'An account with this email already exists. Try signing in instead.';
        if (err.code === 'auth/weak-password')        msg = 'Password is too weak. Please choose a stronger password.';
        setError('err-su-email', msg);
        btn.disabled = false; btn.textContent = 'Create Account';
    }
}

// ── Logout ───────────────────────────────────────────────
function confirmLogout() { document.getElementById('logout-modal').classList.add('show'); }
function closeLogoutModal(e) {
    if (e && e.target !== document.getElementById('logout-modal')) return;
    document.getElementById('logout-modal').classList.remove('show');
}
async function doLogout() {
    closeLogoutModal();
    // Stop real-time listener before signing out
    if (_boqUnsub) { _boqUnsub(); _boqUnsub = null; }
    try { await auth.signOut(); } catch (err) { console.error(err); }
}

// ── Show login page ──────────────────────────────────────
function showLoginPage() {
    document.getElementById('dashboard-page').classList.remove('active');
    document.getElementById('login-page').classList.add('active');
    document.getElementById('login-email').value    = '';
    document.getElementById('login-password').value = '';
    clearLoginErrors();
    switchToLogin();
    sidebarOpen = true;
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('closed', 'open');
    document.getElementById('main-content').classList.remove('expanded');
    document.getElementById('overlay').classList.remove('show');
    document.getElementById('burger').classList.remove('open');
    if (_boqUnsub)   { _boqUnsub();   _boqUnsub   = null; }
    if (_notifUnsub) { _notifUnsub(); _notifUnsub = null; }
    _firestoreNotifs = [];
    currentUser = null; currentProfile = null;
    currentBoqDocs = []; currentFolder = null; currentFolders = []; currentProjects = [];
    window._clientOwnerUid = null;
}

// ── Load User Profile ────────────────────────────────────
async function loadUserProfile(user) {
    try {
        const doc = await db.collection('clientUsers').doc(user.uid).get();
        currentProfile = doc.data();
    } catch (err) {
        console.warn('Profile load error:', err);
        currentProfile = { firstName: 'Client', lastName: 'User', email: user.email };
    }
}

// ── Load Client Data — real-time listener ────────────────
function loadClientData(user) {
    // Tear down any existing listener
    if (_boqUnsub) { _boqUnsub(); _boqUnsub = null; }
    _initialLoad = true;

    return new Promise((resolve, reject) => {
        let resolved = false;

        _boqUnsub = db.collection('boqDocuments')
            .where('clientEmail', '==', user.email)
            .onSnapshot(async snap => {
                // Update docs list
                currentBoqDocs = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
                // Expose the admin/owner UID so client-payment can notify the admin
                window._clientOwnerUid = currentBoqDocs.length ? (currentBoqDocs[0].userId || null) : null;

                // Fetch folders + projects once per snapshot (they change rarely)
                if (currentBoqDocs.length) {
                    const folderIds = [...new Set(currentBoqDocs.map(d => d.folderId).filter(Boolean))];
                    try {
                        const folderDocs = await Promise.all(
                            folderIds.map(fid => db.collection('folders').doc(fid).get())
                        );
                        currentFolders = folderDocs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));
                        // Contract value lives in the owner-only folderBudgets collection;
                        // the assigned client is allowed to read their own folder's budget.
                        const fbDocs = await Promise.all(
                            currentFolders.map(f => db.collection('folderBudgets').doc(f.id).get().catch(() => null))
                        );
                        const fbMap = {};
                        fbDocs.forEach(d => { if (d && d.exists) fbMap[d.id] = d.data().totalBudget || 0; });
                        currentFolders.forEach(f => { f.totalBudget = fbMap[f.id] || 0; });
                        currentFolder  = currentFolders[0] || null;
                    } catch (e) { console.warn('Folder fetch:', e.message); }

                    try {
                        const MONTHS = ['January','February','March','April','May','June',
                                        'July','August','September','October','November','December'];
                        const projSnaps = await Promise.all(
                            folderIds.map(fid => db.collection('projects').where('folderId','==',fid).get())
                        );
                        const allProjects = projSnaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
                        currentProjects = allProjects
                            .filter(p => p.fundingType !== 'president')
                            .sort((a, b) => {
                                if ((a.year||0) !== (b.year||0)) return (a.year||0) - (b.year||0);
                                return MONTHS.indexOf(a.month) - MONTHS.indexOf(b.month);
                            });
                        // Fund allocated lives in the owner-only projectBudgets collection;
                        // the assigned client may read budgets for their folder's projects.
                        const pbDocs = await Promise.all(
                            currentProjects.map(p => db.collection('projectBudgets').doc(p.id).get().catch(() => null))
                        );
                        const pbMap = {};
                        pbDocs.forEach(d => { if (d && d.exists) pbMap[d.id] = d.data().monthlyBudget || 0; });
                        currentProjects.forEach(p => { p.monthlyBudget = pbMap[p.id] || 0; });
                    } catch (e) { console.warn('Projects fetch:', e.message); }
                }

                if (!resolved) {
                    // First snapshot — resolve the promise so enterDashboard() can run
                    resolved = true;
                    resolve();
                } else {
                    // Subsequent snapshots = admin made a change → refresh all views live
                    _onLiveUpdate();
                }
            }, err => {
                console.warn('boqDocuments onSnapshot error:', err);
                if (!resolved) { resolved = true; resolve(); }   // don't block login
            });
    });
}

// ── Called every time Firestore pushes an update ──────────
function _onLiveUpdate() {
    // Re-render every section with fresh data
    populateDashboard();
    populateReports();
    populateBilling();
    buildNotifications();
    populateNotifications();

    // Show a subtle live-update badge and toast
    _showLiveBadge();
    showToast('Report updated by your project team.');
}

// Show a small "Live" badge that fades out after 4 s
function _showLiveBadge() {
    let badge = document.getElementById('client-live-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'client-live-badge';
        badge.innerHTML = `<span class="live-dot"></span> Updated just now`;
        badge.style.cssText = [
            'position:fixed','bottom:24px','right:24px','z-index:9999',
            'background:#065f46','color:#d1fae5','font-size:12px','font-weight:700',
            'padding:8px 14px','border-radius:20px','display:flex','align-items:center','gap:7px',
            'box-shadow:0 4px 18px rgba(0,0,0,0.28)','transition:opacity 0.5s',
        ].join(';');
        document.body.appendChild(badge);
    }
    badge.style.cssText += ';opacity:1';
    clearTimeout(badge._t);
    badge._t = setTimeout(() => { badge.style.opacity = '0'; }, 3500);
}

// Add live dot CSS once
(function _injectLiveDotCss() {
    if (document.getElementById('live-dot-style')) return;
    const s = document.createElement('style');
    s.id = 'live-dot-style';
    s.textContent = `.live-dot{width:8px;height:8px;border-radius:50%;background:#34d399;
        display:inline-block;animation:livePulse 1.4s ease-in-out infinite;}
        @keyframes livePulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.7);}}`;
    document.head.appendChild(s);
})();

// ── Enter Dashboard ──────────────────────────────────────
function enterDashboard() {
    document.getElementById('login-page').classList.remove('active');
    document.getElementById('dashboard-page').classList.add('active');

    refreshUserDisplay();

    if (window.innerWidth > 768) {
        document.getElementById('sidebar').classList.remove('closed');
        document.getElementById('main-content').classList.remove('expanded');
        sidebarOpen = true;
    }

    showSection('dashboard');
    populateDashboard();
    populateReports();
    populateBilling();
    buildNotifications();
    subscribeToNotifications(currentUser.uid);
    if (typeof initClientPayment === 'function') initClientPayment();

    if (localStorage.getItem('dac-dark') === '1') {
        document.body.classList.add('dark-mode');
        document.getElementById('icon-moon').style.display = 'none';
        document.getElementById('icon-sun').style.display  = '';
    }
}

// ── Refresh User Display ─────────────────────────────────
function refreshUserDisplay() {
    const p = currentProfile || {};
    const fn = p.firstName || 'Client';
    const ln = p.lastName  || 'User';
    const em = p.email     || (currentUser?.email || '');
    const initials = (fn[0] + ln[0]).toUpperCase();
    const fullName = fn + ' ' + ln;
    const photo = p.photoURL || '';

    _setAvatar('sidebar-avatar', initials, photo);
    _setText('sidebar-name',   fullName);
    _setText('sidebar-email',  em);
    _setAvatar('topbar-avatar',  initials, photo);
    _setText('topbar-name',    fn);
    _setAvatar('profile-avatar-lg', initials, photo);
    _setText('profile-fullname',     fullName);
    _setText('profile-email-display', em);
    _setText('pf-name',  fullName);
    _setText('pf-email', em);

    const since = p.createdAt?.toDate
        ? p.createdAt.toDate().toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' })
        : new Date().toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
    _setText('pf-since', since);
}

function _setAvatar(id, initials, photoURL) {
    const el = document.getElementById(id);
    if (!el) return;
    if (photoURL) {
        el.innerHTML = `<img src="${photoURL}" alt="avatar" onerror="this.parentElement.textContent='${initials}'">`;
    } else {
        el.textContent = initials;
    }
}

// ── Profile Picture Upload ────────────────────────────────
function triggerAvatarUpload() {
    document.getElementById('avatar-file-input')?.click();
}

async function handleAvatarUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !currentUser) return;
    if (!file.type.startsWith('image/')) { showToast('Please select an image file.'); return; }

    try {
        showToast('Uploading photo…');
        const base64 = await _compressImage(file, 256, 0.8);
        await db.collection('clientUsers').doc(currentUser.uid).set({ photoURL: base64 }, { merge: true });
        currentProfile.photoURL = base64;
        refreshUserDisplay();
        showToast('Profile photo updated ✓');
    } catch (err) {
        showToast('Error uploading photo: ' + err.message);
    }
    event.target.value = '';
}

function _compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let w = img.width, h = img.height;
            if (w > h) { if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; } }
            else       { if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; } }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = url;
    });
}

function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

// ── Populate Dashboard ───────────────────────────────────
function populateDashboard() {
    // ── NEW HERO KPIs (Always Visible) ──
    const designPctEl = document.getElementById('hero-design-pct');
    const designSubEl = document.getElementById('hero-design-sub');
    const billedPctEl = document.getElementById('hero-billed-pct');
    const billedSubEl = document.getElementById('hero-billed-sub');
    const activityEl  = document.getElementById('hero-activity-count');
    const activitySubEl = document.getElementById('hero-activity-last');

    // 1. Design Progress
    const totalAcc   = currentBoqDocs.reduce((s, d) => s + calcTotalAcc(d.costItems), 0);
    const totalCost  = currentBoqDocs.reduce((s, d) => s + calcGrandTotal(d.costItems), 0);
    const progressPct = totalCost > 0 ? Math.round((totalAcc / totalCost) * 100) : calcStatusProgress();
    const approved   = currentBoqDocs.filter(d => d.status === 'approved').length;
    if (designPctEl) animateValue(designPctEl, 0, progressPct, 1200, n => n + '%');
    if (designSubEl) designSubEl.textContent = approved + ' approved';

    // 2. Total Billed
    const totalBudget = currentFolders.reduce((s, f) => s + (parseFloat(f.totalBudget) || 0), 0);
    const totalBilled = (window._clientPayRequests || [])
        .filter(r => r.status === 'verified')
        .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const billedPct   = totalBudget > 0 ? Math.round((totalBilled / totalBudget) * 100) : 0;
    const payReqCount = (window._clientPayRequests || []).length;
    if (billedPctEl) animateValue(billedPctEl, 0, billedPct, 1000, n => n + '%');
    if (billedSubEl) billedSubEl.textContent = payReqCount + ' requests';

    // 3. Recent Activity
    const events = [];
    currentBoqDocs.slice(-3).forEach(doc => {
        const name = doc.header?.subject || doc.projectName || 'Report';
        if (doc.status === 'approved') {
            events.push({ msg: name + ' approved', ts: doc.updatedAt });
        } else if (doc.status === 'submitted') {
            events.push({ msg: name + ' submitted for review', ts: doc.updatedAt });
        }
    });
    (window._clientPayRequests || []).slice(-2).forEach(r => {
        if (r.status === 'verified') {
            events.push({ msg: r.billingPeriod + ' payment verified', ts: r.verifiedAt });
        }
    });
    events.sort((a, b) => (b.ts?.seconds || 0) - (a.ts?.seconds || 0));
    const recentCount = events.length;
    const latest = events[0];
    if (activityEl) animateValue(activityEl, 0, recentCount, 800, n => n.toString());
    if (activitySubEl) activitySubEl.textContent = latest ? latest.msg : 'No recent activity';

    // ── Existing dashboard content ──
    const noProject  = document.getElementById('no-project-state');
    const projContent = document.getElementById('project-content');

    if (!currentBoqDocs.length) {
        noProject.style.display  = '';
        projContent.style.display = 'none';
        return;
    }
    noProject.style.display  = 'none';
    projContent.style.display = '';

    // ── Title: greeting, not project name
    const firstName = currentProfile?.firstName || 'Client';
    _setText('dash-project-title', 'Welcome back, ' + firstName + '!');
    _setText('dash-project-sub', 'Here\'s an overview of all your projects.');

    // ── Budget stats (aggregate across all folders)
    // (totalBudget, totalBilled, billedPct already computed above)
    const budgetEl = document.getElementById('stat-budget');
    if (budgetEl) animateValue(budgetEl, 0, totalBudget, 1200, formatPeso);
    const usageEl = document.getElementById('stat-usage');
    if (usageEl) animateValue(usageEl, 0, billedPct, 1000, n => n + '%');
    const usageSubEl = document.getElementById('stat-usage-sub');
    if (usageSubEl) usageSubEl.innerHTML =
        `<span class="stat-sub-amount">${formatPeso(totalBilled)}</span>`+
        ` <span class="stat-sub-of">of</span> `+
        `<span class="stat-sub-amount">${formatPeso(totalBudget)}</span>`+
        ` <span class="stat-sub-of">billed</span>`;
    setTimeout(() => {
        const bu = document.getElementById('bar-usage');
        if (bu) bu.style.width = Math.min(billedPct, 100) + '%';
    }, 300);

    // ── Progress (totalAcc, totalCost, progressPct, approved already computed above)
    const progressEl  = document.getElementById('stat-progress');
    if (progressEl) animateValue(progressEl, 0, progressPct, 1100, n => n + '%');
    const submitted  = currentBoqDocs.filter(d => d.status === 'submitted').length;
    _setText('stat-progress-sub', approved + ' approved, ' + submitted + ' under review');
    setTimeout(() => {
        const bp = document.getElementById('bar-progress');
        if (bp) bp.style.width = Math.min(progressPct, 100) + '%';
    }, 300);

    // ── Overall badge
    const badgeEl = document.getElementById('overall-badge');
    if (badgeEl) {
        if (progressPct >= 100) { badgeEl.textContent = 'Complete'; badgeEl.className = 'panel-badge panel-badge-green'; }
        else { badgeEl.textContent = 'In Progress'; badgeEl.className = 'panel-badge panel-badge-blue'; }
    }

    // ── Progress ring
    const ring = document.getElementById('ring-fill');
    const ringPct = document.getElementById('ring-pct');
    const circumference = 2 * Math.PI * 64;
    if (ring) setTimeout(() => { ring.style.strokeDashoffset = circumference - (progressPct / 100) * circumference; }, 400);
    if (ringPct) animateValue(ringPct, 0, progressPct, 1300, n => n + '%');

    // ── Phase breakdown (one card per boqDocument)
    const phaseList = document.getElementById('phase-list');
    const phaseBadge = document.getElementById('phase-count-badge');
    if (phaseBadge) phaseBadge.textContent = currentBoqDocs.length + ' Report' + (currentBoqDocs.length !== 1 ? 's' : '');

    if (phaseList) {
        if (!currentBoqDocs.length) {
            phaseList.innerHTML = '<div class="empty-state"><p>No reports yet.</p></div>';
        } else {
            phaseList.innerHTML = currentBoqDocs.map((doc, i) => {
                const docTotal = calcGrandTotal(doc.costItems);
                const docAcc   = calcTotalAcc(doc.costItems);
                const pct      = docTotal > 0 ? Math.round((docAcc / docTotal) * 100) : statusToPct(doc.status);
                const stClass  = 'phase-status-' + (doc.status || 'draft');
                const _boqStatusLabel = { draft: 'Draft', submitted: 'For Review', approved: 'Approved' };
                const stLabel  = _boqStatusLabel[doc.status] || capitalize(doc.status || 'draft');
                const folder   = currentFolders.find(f => f.id === doc.folderId);
                const folderTag = (currentFolders.length > 1 && folder)
                    ? `<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">${escHtml(folder.name)}</span>`
                    : '';
                return `
                <div style="animation-delay:${0.08 * i}s">
                  <div class="phase-info">
                    <span class="phase-name">
                      ${escHtml(doc.header?.subject || doc.projectName || 'Report ' + (i+1))}
                      <span class="phase-status-tag ${stClass}">${stLabel}</span>
                      ${folderTag}
                    </span>
                    <span class="phase-pct">${pct}%</span>
                  </div>
                  <div class="phase-bar-wrap">
                    <div class="phase-bar" id="pbar-${i}" style="width:0%"></div>
                  </div>
                </div>`;
            }).join('');
            setTimeout(() => {
                currentBoqDocs.forEach((doc, i) => {
                    const docTotal = calcGrandTotal(doc.costItems);
                    const docAcc   = calcTotalAcc(doc.costItems);
                    const pct      = docTotal > 0 ? Math.round((docAcc / docTotal) * 100) : statusToPct(doc.status);
                    const bar = document.getElementById('pbar-' + i);
                    if (bar) bar.style.width = Math.min(pct, 100) + '%';
                });
            }, 500);
        }
    }

    // ── Activity feed
    populateActivity();

    // ── Project timeline
    renderProjectTimeline();
}

function populateActivity() {
    const actList = document.getElementById('activity-list');
    if (!actList) return;

    const events = [];
    currentBoqDocs.forEach(doc => {
        const name = doc.header?.subject || doc.projectName || 'Report';
        if (doc.status === 'approved') {
            events.push({ type: 'green', msg: name + ' approved', sub: 'Report has been reviewed and approved', ts: doc.updatedAt });
        } else if (doc.status === 'submitted') {
            events.push({ type: 'blue', msg: name + ' submitted for review', sub: 'Awaiting approval from DAC team', ts: doc.updatedAt });
        } else {
            events.push({ type: 'amber', msg: name + ' in progress', sub: 'Report is being prepared', ts: doc.updatedAt });
        }
    });
    currentProjects.forEach(p => {
        const desc = formatFundingType(p.fundingType, p.billingNumber);
        events.push({ type: 'blue', msg: desc + ' billing period added', sub: p.month + ' ' + p.year + ' — ' + formatPeso(p.monthlyBudget || 0), ts: p.createdAt });
    });

    events.sort((a, b) => (b.ts?.seconds || 0) - (a.ts?.seconds || 0));
    const recent = events.slice(0, 6);
    _setText('activity-count', recent.length + ' event' + (recent.length !== 1 ? 's' : ''));

    const icons = {
        green: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
        blue:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
        amber: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };

    if (!recent.length) {
        actList.innerHTML = '<div class="empty-state"><p>No recent activity.</p></div>';
        return;
    }
    actList.innerHTML = recent.map((a, i) => `
        <div class="activity-item" style="animation-delay:${0.07 * i}s">
          <div class="activity-dot-wrap activity-dot-${a.type}">${icons[a.type] || icons.blue}</div>
          <div class="activity-text">
            <div class="activity-title">${escHtml(a.msg)}</div>
            <div class="activity-sub">${escHtml(a.sub)}</div>
          </div>
          <div class="activity-time">${formatTimestamp(a.ts)}</div>
        </div>`).join('');
}

// ── Populate Reports ─────────────────────────────────────
function populateReports() { renderReports(); }

function renderReports() {
    const tbody = document.getElementById('reports-tbody');
    if (!tbody) return;

    const q = (document.getElementById('report-search')?.value || '').toLowerCase();
    let data  = currentBoqDocs.filter(d => {
        if (_reportFilter !== 'all' && d.status !== _reportFilter) return false;
        if (!q) return true;
        const name = (d.header?.subject || d.projectName || '').toLowerCase();
        return name.includes(q);
    });

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">${currentBoqDocs.length ? 'No reports match this filter.' : 'No accomplishment reports yet.'}</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map((doc, i) => {
        const title     = doc.header?.subject || 'Accomplishment Report';
        const project   = doc.projectName || doc.header?.projectName || '—';
        const dateStr   = doc.header?.date ? formatDateStr(doc.header.date) : formatTimestamp(doc.createdAt);
        const status    = doc.status || 'draft';
        const docTotal  = calcGrandTotal(doc.costItems);
        const docAcc    = calcTotalAcc(doc.costItems);
        const accPct    = docTotal > 0 ? Math.round((docAcc / docTotal) * 100) : statusToPct(status);
        return `
        <tr>
          <td>
            <span style="font-weight:700;color:var(--text-dark)">${escHtml(title)}</span><br/>
            <span style="font-size:11px;color:#b0c8bc;">Report ${i + 1}</span>
          </td>
          <td>${escHtml(project)}</td>
          <td style="white-space:nowrap">${escHtml(dateStr)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;">
              <div class="boq-pct-bar-wrap" style="width:60px;">
                <div class="boq-pct-bar" style="width:${accPct}%"></div>
              </div>
              <span style="font-size:12px;font-weight:600;color:var(--text-dark)">${accPct}%</span>
            </div>
          </td>
          <td><span class="badge badge-${escHtml(status)}">${({draft:'Draft',submitted:'For Review',approved:'Approved'})[status] || capitalize(status)}</span></td>
          <td><button class="btn-view" onclick="viewReport('${doc.id}')">View</button></td>
        </tr>`;
    }).join('');
}

function filterByStatus(status, btn) {
    _reportFilter = status;
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderReports();
}
function filterReports() { renderReports(); }

// ── Report Viewer ────────────────────────────────────────
function viewReport(docId) {
    const doc = currentBoqDocs.find(d => d.id === docId);
    if (!doc) return;

    const h = doc.header || {};
    _setText('rmd-title', h.subject || 'Accomplishment Report');

    const lastUpdated = doc.updatedAt?.toDate
        ? doc.updatedAt.toDate().toLocaleString('en-PH', { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true })
        : null;

    document.getElementById('rmd-meta').innerHTML = [
        h.projectName && `<strong>Project:</strong> ${escHtml(h.projectName)}`,
        h.ownerName   && `<strong>Owner:</strong> ${escHtml(h.ownerName)}`,
        h.location    && `<strong>Location:</strong> ${escHtml(h.location)}`,
        h.area        && `<strong>Area:</strong> ${escHtml(h.area)} sqm`,
        h.date        && `<strong>Date:</strong> ${escHtml(formatDateStr(h.date))}`,
        lastUpdated   && `<span style="color:#6b7280;font-size:11px;">Last updated: ${escHtml(lastUpdated)}</span>`,
    ].filter(Boolean).join('  &nbsp;·&nbsp;  ');

    const status = doc.status || 'draft';
    const badge = document.getElementById('rmd-status-badge');
    if (badge) { badge.className = 'badge badge-' + status; badge.textContent = ({draft:'Draft',submitted:'For Review',approved:'Approved'})[status] || capitalize(status); }

    document.getElementById('rmd-body').innerHTML = renderBoqContent(doc) + renderBoqFooter(doc);
    document.getElementById('rmd-footer').innerHTML = '';
    document.getElementById('report-modal').classList.add('show');
}

function closeReportModal(e) {
    if (e && e.target !== document.getElementById('report-modal')) return;
    document.getElementById('report-modal').classList.remove('show');
}

let _galleryImages = [];
let _galleryIdx    = 0;

function openPhotosModal(images, title) {
    _galleryImages = images;
    _galleryIdx    = 0;

    let modal = document.getElementById('photos-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'photos-modal';
        modal.innerHTML = `
          <div class="pm-backdrop" onclick="closePhotosModal()"></div>
          <div class="pm-card">
            <button class="pm-close" onclick="closePhotosModal()">&#215;</button>
            <div class="pm-header-info">
              <div class="pm-title" id="pm-title"></div>
              <div class="pm-subtitle" id="pm-subtitle"></div>
            </div>
            <div class="pm-main">
              <img id="pm-main-img" class="pm-main-img" src="" alt="">
              <div class="pm-caption" id="pm-caption"></div>
            </div>
            <div class="pm-thumbs" id="pm-thumbs"></div>
          </div>`;
        document.body.appendChild(modal);
    }

    document.getElementById('pm-title').textContent    = title || 'Photos';
    document.getElementById('pm-subtitle').textContent = images.length + ' photo' + (images.length > 1 ? 's' : '');

    const thumbs = document.getElementById('pm-thumbs');
    thumbs.innerHTML = images.map((img, i) => `
      <img src="${img.url}" class="pm-thumb${i === 0 ? ' active' : ''}" onclick="gallerySelect(${i})" alt="">`
    ).join('');

    _gallerySetMain(0);
    modal.classList.add('show');
}

function _gallerySetMain(idx) {
    _galleryIdx = idx;
    const img = _galleryImages[idx];
    if (!img) return;
    document.getElementById('pm-main-img').src        = img.url;
    document.getElementById('pm-caption').textContent = img.name || '';
    document.querySelectorAll('.pm-thumb').forEach((t, i) => t.classList.toggle('active', i === idx));
    // scroll active thumb into view
    const activeThumb = document.querySelectorAll('.pm-thumb')[idx];
    if (activeThumb) activeThumb.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'center' });
}

function gallerySelect(idx) { _gallerySetMain(idx); }

function closePhotosModal() {
    document.getElementById('photos-modal')?.classList.remove('show');
}

function openPhotoLightbox(url, name) {
    let lb = document.getElementById('photo-lightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'photo-lightbox';
        lb.innerHTML = `<div class="lb-backdrop" onclick="closePhotoLightbox()"></div>
          <div class="lb-card">
            <button class="lb-close" onclick="closePhotoLightbox()">&#215;</button>
            <img id="lb-img" src="" alt="">
            <div class="lb-name" id="lb-name"></div>
          </div>`;
        document.body.appendChild(lb);
    }
    document.getElementById('lb-img').src  = url;
    document.getElementById('lb-name').textContent = name;
    lb.classList.add('show');
}
function closePhotoLightbox() {
    document.getElementById('photo-lightbox')?.classList.remove('show');
}

function renderBoqContent(doc) {
    const items = doc.costItems || [];
    if (!items.length) return '<p style="color:#b0c8bc;text-align:center;padding:32px;">No cost items in this report.</p>';

    const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
    let html = '';
    let sectionTotal = 0, sectionAcc = 0;

    html += `<table class="boq-view-table">
      <thead>
        <tr>
          <th class="col-num">ITEM NO.</th>
          <th>DESCRIPTIONS</th>
          <th class="col-qty">QTY</th>
          <th class="col-unit">UNIT</th>
          <th class="col-pct">% OF COMPLETION</th>
          <th class="col-ref">REFERENCE IMAGE</th>
        </tr>
      </thead>
      <tbody>`;

    items.forEach((ci, ciIdx) => {
        const ciNo    = ROMAN[ciIdx] || (ciIdx + 1);
        const ciTotal = calcCostItemTotal(ci);
        const ciAcc   = calcCostItemAcc(ci);
        sectionTotal += ciTotal;
        sectionAcc   += ciAcc;

        html += `<tr class="boq-section-row">
          <td class="col-num">${ciNo}.</td>
          <td>${escHtml(ci.label || 'SECTION ' + ciNo)}</td>
          <td class="col-qty"></td>
          <td class="col-unit"></td>
          <td class="col-pct"></td>
          <td class="col-ref"></td>
        </tr>`;

        (ci.subItems || []).forEach((si, siIdx) => {
            // Support both new (si.images) and old (li.images) photo storage
            const siImages = (si.images && si.images.length)
                ? si.images
                : (si.lineItems || []).flatMap(li => li.images || []);
            const photoBtn = siImages.length
                ? `<button class="boq-view-photo-btn" onclick="openPhotosModal(${JSON.stringify(siImages).split('"').join('&quot;')}, &quot;${escHtml(si.label || 'Photos')}&quot;)"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${siImages.length} Photo${siImages.length > 1 ? 's' : ''}</button>`
                : '<span style="color:#ccc;">—</span>';
            html += `<tr class="boq-view-sub-header-row">
              <td class="col-num">${String.fromCharCode(65 + siIdx)}.</td>
              <td>${escHtml(si.label || '')}</td>
              <td class="col-qty"></td>
              <td class="col-unit"></td>
              <td class="col-pct"></td>
              <td class="col-ref">${photoBtn}</td>
            </tr>`;
            (si.lineItems || []).forEach((li, liIdx) => {
                const pct = parseFloat(li.percentCompletion) || 0;
                html += `<tr class="boq-line-row">
                  <td class="col-num">${li.itemNo || (liIdx + 1)}</td>
                  <td>${escHtml(li.description || '')}${li.isOptional ? ' <em style="font-size:10px;color:#b0c8bc;">(optional)</em>' : ''}</td>
                  <td class="col-qty">${li.qty || ''}${li.unit ? `<span class="boq-unit-inline"> ${escHtml(li.unit)}</span>` : ''}</td>
                  <td class="col-unit">${escHtml(li.unit || '')}</td>
                  <td class="col-pct">
                    <div style="display:flex;align-items:center;gap:6px;justify-content:center;">
                      <div class="boq-pct-bar-wrap"><div class="boq-pct-bar" style="width:${Math.min(pct,100)}%"></div></div>
                      <span style="font-size:11px;font-weight:700">${pct}%</span>
                    </div>
                  </td>
                  <td class="col-ref"></td>
                </tr>`;
            });
        });

        html += `<tr class="boq-subtotal-row">
          <td colspan="6">Subtotal &mdash; ${ciNo}. ${escHtml(ci.label || '')}</td>
        </tr>`;
    });

    html += `</tbody></table>`;

    const discount = parseFloat(doc.discount) || 0;
    const grandTotal = sectionTotal - discount;
    html += `
    <div class="boq-grand-total">
      <span class="boq-grand-total-label">Overall Completion</span>
      <div class="boq-grand-total-group">
        <div class="boq-total-item">
          <div class="boq-total-item-value accent" style="font-size:1.6rem">${grandTotal > 0 ? Math.round((sectionAcc / grandTotal) * 100) : 0}%</div>
        </div>
      </div>
    </div>`;

    return html;
}

function renderBoqFooter(doc) {
    const terms = doc.terms || {};
    if (!terms.payments && !terms.exclusions && !terms.duration) return '';
    let n = 1;
    let html = '<div class="report-terms">';
    if (terms.payments)   html += `<div class="report-terms-section"><span class="report-terms-title">${toRoman(n++)}. Terms of Payment</span><div class="report-terms-body">${escHtml(terms.payments)}</div></div>`;
    if (terms.exclusions) html += `<div class="report-terms-section"><span class="report-terms-title">${toRoman(n++)}. Exclusions</span><div class="report-terms-body">${escHtml(terms.exclusions)}</div></div>`;
    if (terms.duration)   html += `<div class="report-terms-section"><span class="report-terms-title">${toRoman(n++)}. Duration</span><div class="report-terms-body">${escHtml(terms.duration)}</div></div>`;
    html += '</div>';
    return html;
}

function toRoman(n) {
    const v = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
    return v[n - 1] || n;
}

// ── Populate Billing ─────────────────────────────────────
// Called after payment requests are loaded to update the Total Billed KPI
window.refreshBilledKPI = function () {
    const reqs = window._clientPayRequests || [];
    const totalBilled = reqs
        .filter(r => r.status === 'verified')
        .reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const billedEl = document.getElementById('bsum-billed');
    if (billedEl) animateValue(billedEl, 0, totalBilled, 800, formatPeso);
    _setText('bsum-count', reqs.length);

    // Also refresh the dashboard stat-usage if dashboard is active
    const totalBudget = currentFolders.reduce((s, f) => s + (parseFloat(f.totalBudget) || 0), 0);
    const billedPct   = totalBudget > 0 ? Math.round((totalBilled / totalBudget) * 100) : 0;
    const usageEl = document.getElementById('stat-usage');
    if (usageEl) animateValue(usageEl, 0, billedPct, 800, n => n + '%');
    const usageSubEl = document.getElementById('stat-usage-sub');
    if (usageSubEl) usageSubEl.innerHTML =
        `<span class="stat-sub-amount">${formatPeso(totalBilled)}</span>`+
        ` <span class="stat-sub-of">of</span> `+
        `<span class="stat-sub-amount">${formatPeso(totalBudget)}</span>`+
        ` <span class="stat-sub-of">billed</span>`;
    const bu = document.getElementById('bar-usage');
    if (bu) bu.style.width = Math.min(billedPct, 100) + '%';

    // Refresh timeline and documents now that payments are loaded
    renderProjectTimeline();
    if (document.getElementById('section-documents')?.classList.contains('active')) renderDocuments();
};

function populateBilling() {
    const totalBudget = currentFolders.reduce((s, f) => s + (parseFloat(f.totalBudget) || 0), 0);

    // Summary cards
    const totalEl = document.getElementById('bsum-total');
    if (totalEl) animateValue(totalEl, 0, totalBudget, 1200, formatPeso);
    // bsum-billed and bsum-count are refreshed by refreshBilledKPI()
    // once payment requests finish loading (called from initClientPayment)
    _setText('bsum-count', '…');

    const tbody = document.getElementById('billing-tbody');
    if (!tbody) return;

    if (!currentProjects.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:#b0c8bc;font-style:italic;">No billing periods available yet.</td></tr>`;
        return;
    }

    const multiFolder = currentFolders.length > 1;

    // Update table header if multiple projects
    const theadRow = document.querySelector('#billing-table thead tr');
    if (theadRow) {
        if (multiFolder && !document.getElementById('billing-th-project')) {
            const th = document.createElement('th');
            th.id = 'billing-th-project';
            th.textContent = 'Project';
            theadRow.insertBefore(th, theadRow.children[2]);
        } else if (!multiFolder) {
            const existing = document.getElementById('billing-th-project');
            if (existing) existing.remove();
        }
    }

    tbody.innerHTML = currentProjects.map((p, idx) => {
        const desc     = formatFundingType(p.fundingType, p.billingNumber);
        const period   = (p.month || '') + (p.year ? ' ' + p.year : '');
        const amount   = parseFloat(p.monthlyBudget) || 0;
        const typeTag  = fundingTypeTag(p.fundingType);
        const folder   = currentFolders.find(f => f.id === p.folderId);
        const projCell = multiFolder
            ? `<td style="font-size:12px;color:var(--text-muted)">${escHtml(folder?.name || '—')}</td>`
            : '';
        return `
        <tr>
          <td><span style="font-weight:700;font-family:'Playfair Display',serif">${idx + 1}</span></td>
          <td>${escHtml(period)}</td>
          ${projCell}
          <td>${escHtml(desc)}</td>
          <td style="font-weight:700;white-space:nowrap">&#8369; ${fmt(amount)}</td>
          <td>${typeTag}</td>
        </tr>`;
    }).join('');
}

// ── Build Local Notifications (overdue billing only) ─────
function buildNotifications() {
    _notifications = [];
    // Overdue billing — computed locally from project data
    currentProjects.forEach(p => {
        if (p.paymentStatus === 'overdue') {
            _notifications.push({ type:'amber', msg: formatFundingType(p.fundingType, p.billingNumber) + ' payment is overdue', time: formatTimestamp(p.createdAt), read: false });
        }
    });
}

// ── Subscribe to Firestore Notifications ─────────────────
function subscribeToNotifications(uid) {
    if (_notifUnsub) { _notifUnsub(); _notifUnsub = null; }
    _notifUnsub = db.collection('notifications').doc(uid).collection('items')
        .orderBy('createdAt', 'desc')
        .limit(30)
        .onSnapshot(snap => {
            _firestoreNotifs = snap.docs.map(d => {
                const data = d.data();
                return {
                    id:      d.id,
                    rawType: data.type || '',
                    type:    _mapNotifType(data.type),
                    msg:     data.message || '',
                    time:    formatTimestamp(data.createdAt),
                    // Accept either field — two SOWA producers used to write `read`,
                    // everyone else writes `isRead`. Defensive forever as cheap insurance.
                    read:    data.isRead === true || data.read === true
                };
            });
            populateNotifications();
            _clientMigrateNotifFields(uid, snap.docs);
        }, err => console.warn('Notifications listener error:', err));
}

let _clientNotifMigrationDone = false;
function _clientMigrateNotifFields(uid, docs) {
    if (_clientNotifMigrationDone || !uid) return;
    _clientNotifMigrationDone = true;
    const fix = docs.filter(d => {
        const data = d.data();
        return 'read' in data && !('isRead' in data);
    });
    if (!fix.length) return;
    const batch = db.batch();
    fix.forEach(d => batch.update(d.ref, { isRead: d.data().read === true }));
    batch.commit()
        .then(() => console.log('[notif-migration] client normalized', fix.length, 'doc(s)'))
        .catch(e => console.warn('[notif-migration] client batch error:', e));
}

function _mapNotifType(type) {
    if (['payment_verified', 'report_approved', 'partial_approved', 'report_shared', 'invoice_issued'].includes(type)) return 'green';
    if (['payment_rejected', 'partial_declined'].includes(type)) return 'amber';
    return 'blue';
}

function populateNotifications() {
    const list = document.getElementById('notif-list');
    const dot  = document.getElementById('notif-dot');
    if (!list) return;

    // Combine Firestore (real) + local (overdue billing)
    const combined = [..._firestoreNotifs, ..._notifications];
    const display  = combined.length
        ? combined
        : [{ type:'green', msg:'Welcome to the DAC Client Portal', time:'Just now', read: false }];

    const unread = display.filter(n => !n.read).length;
    if (dot) dot.style.display = unread ? '' : 'none';
    const nb = document.getElementById('notif-nav-badge');
    if (nb) { nb.textContent = unread; nb.style.display = unread ? '' : 'none'; }

    const icons = {
        green: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
        blue:  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        amber: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };

    const _notifNavMap = {
        payment_verified: 'billing', payment_rejected: 'billing',
        partial_approved: 'billing', partial_declined: 'billing', sowa_ready: 'billing',
        invoice_issued:   'billing',
        report_approved: 'accomplishment', report_submitted: 'accomplishment', report_updated: 'accomplishment',
        report_shared:    'accomplishment',
    };

    list.innerHTML = display.map((n, i) => {
        const dest = _notifNavMap[n.rawType] || null;
        return `
        <div class="notif-item ${n.read ? '' : 'unread'}" onclick="markOneRead(${i});${dest ? `document.getElementById('notif-dropdown').classList.remove('open');showSection('${dest}')` : ''}">
          <div class="notif-icon notif-icon-${n.type}">${icons[n.type] || icons.blue}</div>
          <div class="notif-body">
            <div class="notif-msg">${escHtml(n.msg)}</div>
            <div class="notif-time">${n.time}${dest ? ' &nbsp;·&nbsp; <span style="color:#059669;font-size:11px;">Tap to view</span>' : ''}</div>
          </div>
          ${!n.read ? '<div class="notif-unread-dot"></div>' : ''}
        </div>`;
    }).join('');
}

function toggleNotifications() {
    document.getElementById('notif-dropdown')?.classList.toggle('open');
}
function markOneRead(i) {
    const combined = [..._firestoreNotifs, ..._notifications];
    const n = combined[i];
    if (!n || n.read) return;
    // Mark in correct backing array
    if (i < _firestoreNotifs.length) {
        _firestoreNotifs[i].read = true;
        // Persist to Firestore
        if (n.id && currentUser) {
            db.collection('notifications').doc(currentUser.uid).collection('items')
                .doc(n.id).update({ isRead: true }).catch(e => console.warn('markRead error:', e));
        }
    } else {
        _notifications[i - _firestoreNotifs.length].read = true;
    }
    populateNotifications();
}
function markAllRead() {
    const unreadFirestore = _firestoreNotifs.filter(n => !n.read);
    _firestoreNotifs.forEach(n => n.read = true);
    _notifications.forEach(n => n.read = true);
    populateNotifications();
    showToast('All notifications marked as read ✓');
    // Batch-persist Firestore reads
    if (currentUser && unreadFirestore.length) {
        const batch = db.batch();
        unreadFirestore.forEach(n => {
            if (n.id) {
                batch.update(
                    db.collection('notifications').doc(currentUser.uid).collection('items').doc(n.id),
                    { isRead: true }
                );
            }
        });
        batch.commit().catch(e => console.warn('markAllRead error:', e));
    }
}
document.addEventListener('click', e => {
    const wrap = document.getElementById('notif-wrap');
    if (wrap && !wrap.contains(e.target)) document.getElementById('notif-dropdown')?.classList.remove('open');
});

// ── Profile ───────────────────────────────────────────────
function toggleEditProfile() {
    const view = document.getElementById('profile-view-mode');
    const edit = document.getElementById('profile-edit-mode');
    const btn  = document.getElementById('btn-edit-profile');
    if (!view || !edit) return;
    const isEditing = edit.style.display !== 'none';
    view.style.display = isEditing ? '' : 'none';
    edit.style.display = isEditing ? 'none' : '';
    btn.innerHTML = isEditing
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Profile`
        : '✕ Cancel';
    if (!isEditing && currentProfile) {
        document.getElementById('edit-firstname').value = currentProfile.firstName || '';
        document.getElementById('edit-lastname').value  = currentProfile.lastName  || '';
    }
}

function cancelEditProfile() {
    document.getElementById('profile-view-mode').style.display = '';
    document.getElementById('profile-edit-mode').style.display = 'none';
    const btn = document.getElementById('btn-edit-profile');
    if (btn) btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit Profile`;
}

async function saveProfile() {
    const fn = document.getElementById('edit-firstname').value.trim();
    const ln = document.getElementById('edit-lastname').value.trim();
    ['err-edit-firstname','err-edit-lastname'].forEach(id => setError(id, ''));
    let valid = true;
    if (!fn || fn.length < 2) { setError('err-edit-firstname', 'Min. 2 characters.'); valid = false; }
    if (!ln || ln.length < 2) { setError('err-edit-lastname',  'Min. 2 characters.'); valid = false; }
    if (!valid) return;

    try {
        await db.collection('clientUsers').doc(currentUser.uid).set({ firstName: fn, lastName: ln }, { merge: true });
        currentProfile.firstName = fn;
        currentProfile.lastName  = ln;
        refreshUserDisplay();
        cancelEditProfile();
        showToast('Profile updated ✓');
    } catch (err) {
        showToast('Error saving profile: ' + err.message);
    }
}

// ── Change-password captcha (Cloudflare Turnstile, rendered on demand) ──
const CPW_SITEKEY = '0x4AAAAAADgIAGT-ZrooN5eY';
let _cpwWidgetId = null;
function _cpwRenderOrReset() {
    if (!window.turnstile) return;
    try {
        if (_cpwWidgetId === null) _cpwWidgetId = turnstile.render('#cpw-captcha', { sitekey: CPW_SITEKEY });
        else turnstile.reset(_cpwWidgetId);
    } catch (e) {}
}
function _cpwToken() {
    try { return (window.turnstile && _cpwWidgetId !== null) ? (turnstile.getResponse(_cpwWidgetId) || undefined) : undefined; }
    catch (e) { return undefined; }
}

function toggleChangePassword() {
    const form  = document.getElementById('change-pw-form');
    const ph    = document.getElementById('change-pw-placeholder');
    const btn   = document.getElementById('btn-toggle-pw');
    if (!form) return;
    const isOpen = form.style.display !== 'none';
    form.style.display = isOpen ? 'none' : '';
    ph.style.display   = isOpen ? '' : 'none';
    if (btn) btn.style.display = isOpen ? '' : 'none';
    if (isOpen) {
        ['pw-current','pw-new','pw-confirm-new'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        ['err-pw-current','err-pw-new','err-pw-confirm-new'].forEach(id => setError(id, ''));
        const wrap = document.getElementById('new-pw-strength-wrap');
        if (wrap) wrap.style.display = 'none';
    } else {
        // Opening → render/refresh the captcha so a fresh token is ready on submit
        _cpwRenderOrReset();
    }
}

function updateNewPwStrength() {
    const pw    = document.getElementById('pw-new')?.value || '';
    const wrap  = document.getElementById('new-pw-strength-wrap');
    const fill  = document.getElementById('new-pw-strength-fill');
    const label = document.getElementById('new-pw-strength-label');
    if (!wrap) return;
    if (!pw) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const score  = getPasswordStrength(pw);
    const levels = [
        { label:'Very Weak', color:'#e74c3c', pct:'15%' },
        { label:'Weak',      color:'#e67e22', pct:'30%' },
        { label:'Fair',      color:'#f1c40f', pct:'50%' },
        { label:'Good',      color:'#2ecc71', pct:'75%' },
        { label:'Strong',    color:'#00a85e', pct:'100%'},
    ];
    const lvl = levels[Math.max(0, Math.min(score - 1, 4))];
    fill.style.width      = lvl.pct;
    fill.style.background = lvl.color;
    label.textContent     = lvl.label;
    label.style.color     = lvl.color;
}

async function doChangePassword() {
    ['err-pw-current','err-pw-new','err-pw-confirm-new'].forEach(id => setError(id, ''));
    const cur = document.getElementById('pw-current')?.value || '';
    const nw  = document.getElementById('pw-new')?.value     || '';
    const cnw = document.getElementById('pw-confirm-new')?.value || '';
    let valid = true;

    if (!cur) { setError('err-pw-current', 'Current password is required.'); valid = false; }
    if (!nw)  { setError('err-pw-new', 'New password is required.'); valid = false; }
    else if (nw.length < 8) { setError('err-pw-new', 'Min. 8 characters.'); valid = false; }
    else if (getPasswordStrength(nw) < 2) { setError('err-pw-new', 'Password is too weak.'); valid = false; }
    if (!cnw) { setError('err-pw-confirm-new', 'Please confirm your new password.'); valid = false; }
    else if (nw && cnw !== nw) { setError('err-pw-confirm-new', 'Passwords do not match.'); valid = false; }
    if (!valid) return;

    try {
        const cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, cur);
        cred.captchaToken = _cpwToken();
        await currentUser.reauthenticateWithCredential(cred);
        await currentUser.updatePassword(nw);
        toggleChangePassword();
        showToast('Password updated successfully ✓');
    } catch (err) {
        _cpwRenderOrReset(); // refresh captcha so a retry gets a fresh token
        if (err.code === 'auth/wrong-password') setError('err-pw-current', 'Incorrect current password.');
        else showToast('Error: ' + err.message);
    }
}

// ── Sidebar ──────────────────────────────────────────────
const isMobile = () => window.innerWidth <= 768;

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const main    = document.getElementById('main-content');
    const burger  = document.getElementById('burger');
    const overlay = document.getElementById('overlay');
    if (isMobile()) {
        const open = sidebar.classList.toggle('open');
        overlay.classList.toggle('show', open);
        burger.classList.toggle('open', open);
    } else {
        sidebarOpen = !sidebarOpen;
        sidebar.classList.toggle('closed', !sidebarOpen);
        main.classList.toggle('expanded', !sidebarOpen);
        burger.classList.toggle('open', !sidebarOpen);
    }
}

function closeSidebar() {
    if (!isMobile()) return;
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
    document.getElementById('burger').classList.remove('open');
}

window.addEventListener('resize', () => {
    const sidebar = document.getElementById('sidebar');
    const main    = document.getElementById('main-content');
    const overlay = document.getElementById('overlay');
    const burger  = document.getElementById('burger');
    if (!isMobile()) {
        sidebar.classList.remove('open'); overlay.classList.remove('show'); burger.classList.remove('open');
        sidebar.classList.toggle('closed', !sidebarOpen);
        main.classList.toggle('expanded', !sidebarOpen);
    } else {
        sidebar.classList.remove('closed');
        main.classList.remove('expanded');
    }
});

// ── Section Navigation ───────────────────────────────────
const SECTION_TITLES = { dashboard:'Dashboard', accomplishment:'Accomplishment Reports', billing:'Billing Periods', soa:'Statement of Account', profile:'Profile', notifications:'Notifications', documents:'Documents' };

function showSection(id) {
    document.querySelectorAll('.sub-page').forEach(el => el.classList.remove('active'));
    const target = document.getElementById('section-' + id);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
        const oc = el.getAttribute('onclick') || '';
        if (oc.includes("'" + id + "'") || oc.includes('"' + id + '"')) el.classList.add('active');
    });
    _setText('topbar-title', SECTION_TITLES[id] || id);
    if (id === 'billing' && typeof initClientPayment === 'function') initClientPayment();
    if (id === 'soa'           && typeof initSOAClient     === 'function') initSOAClient();
    if (id === 'notifications') renderNotifHistory();
    if (id === 'documents') renderDocuments();
    if (isMobile()) closeSidebar();
}

// ── Notification History Page ─────────────────────────────
window.renderNotifHistory = function () {
    const el = document.getElementById('notif-history-list');
    if (!el) return;
    const combined = [..._firestoreNotifs, ..._notifications];
    if (!combined.length) {
        el.innerHTML = `<div style="padding:48px;text-align:center;color:#9ca3af;">
            <div style="font-size:32px;margin-bottom:10px;">🔔</div>
            <div style="font-weight:600;font-size:14px;color:#374151;">No notifications yet</div>
            <div style="font-size:13px;margin-top:4px;">Updates from your project team will appear here.</div>
        </div>`;
        return;
    }
    const icons = {
        green: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
        blue:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
        amber: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };
    const bgMap = { green:'#ecfdf5', blue:'#eff6ff', amber:'#fffbeb' };
    const colorMap = { green:'#059669', blue:'#2563eb', amber:'#d97706' };
    const navMap = {
        payment_verified:  'billing',
        payment_rejected:  'billing',
        partial_approved:  'billing',
        partial_declined:  'billing',
        sowa_ready:        'billing',
        report_approved:   'accomplishment',
        report_submitted:  'accomplishment',
        report_updated:    'accomplishment',
    };
    const hintMap = {
        payment_verified:  'Go to Billing Periods →',
        payment_rejected:  'Go to Billing Periods →',
        partial_approved:  'Go to Billing Periods →',
        partial_declined:  'Go to Billing Periods →',
        sowa_ready:        'Go to Billing Periods →',
        report_approved:   'Go to Accomplishment Reports →',
        report_submitted:  'Go to Accomplishment Reports →',
        report_updated:    'Go to Accomplishment Reports →',
    };

    el.innerHTML = combined.map((n, i) => {
        const dest = navMap[n.rawType] || null;
        const hint = hintMap[n.rawType] || null;
        return `
        <div onclick="markOneRead(${i});${dest ? `showSection('${dest}')` : ''}" style="display:flex;align-items:flex-start;gap:14px;padding:16px 22px;border-bottom:1px solid #f3f4f6;cursor:${dest ? 'pointer' : 'default'};background:${n.read ? '#fff' : '#f8faff'};transition:background .15s;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='${n.read ? '#fff' : '#f8faff'}'">
            <div style="width:36px;height:36px;border-radius:10px;background:${bgMap[n.type]||'#f3f4f6'};color:${colorMap[n.type]||'#6b7280'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                ${icons[n.type] || icons.blue}
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:13.5px;color:#1f2937;font-weight:${n.read ? '400' : '600'};line-height:1.45;">${escHtml(n.msg)}</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${n.time}${hint ? ` &nbsp;·&nbsp; <span style="color:#2563eb;">${hint}</span>` : ''}</div>
            </div>
            ${!n.read ? '<div style="width:8px;height:8px;border-radius:50%;background:#2563eb;flex-shrink:0;margin-top:6px;"></div>' : ''}
        </div>`;
    }).join('');

    // Update nav badge
    const unread = combined.filter(n => !n.read).length;
    const nb = document.getElementById('notif-nav-badge');
    if (nb) { nb.textContent = unread; nb.style.display = unread ? '' : 'none'; }
};

// ── Documents Page ────────────────────────────────────────
window.renderDocuments = function () {
    _renderDocInvoices();
    _renderDocSOWA();
};

function _renderDocInvoices() {
    const el = document.getElementById('docs-invoice-list');
    if (!el) return;
    const reqs = (window._clientPayRequests || []).filter(r => r.status === 'verified');
    if (!reqs.length) {
        el.innerHTML = `<div style="padding:32px;text-align:center;color:#9ca3af;font-size:14px;">No invoices yet. Invoices are generated after your payment is verified.</div>`;
        return;
    }
    el.innerHTML = reqs.map(r => `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 22px;border-bottom:1px solid #f3f4f6;">
            <div style="width:38px;height:38px;border-radius:10px;background:#ecfdf5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:14px;font-weight:700;color:#1f2937;">${escHtml(r.billingPeriod || '—')}</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${escHtml(r.projectName || '')}${r.projectName ? ' &nbsp;·&nbsp; ' : ''}Amount Paid: <strong style="color:#059669;">${_formatAmount(r.paidAmount != null ? r.paidAmount : r.amount)}</strong></div>
            </div>
            <button onclick="prPrintClientInvoice('${r.id}')"
                style="display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;color:#059669;border:1.5px solid #d1fae5;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print Invoice
            </button>
        </div>`).join('');
}

function _formatAmount(v) {
    if (typeof v !== 'number' && !v) return '₱0.00';
    return '₱' + parseFloat(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _renderDocSOWA() {
    const el = document.getElementById('docs-sowa-section');
    if (!el) return;
    const sowaBtn = document.getElementById('clientViewSOWABtn');
    const sowaVisible = sowaBtn && sowaBtn.style.display !== 'none';
    if (sowaVisible) {
        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
                <div style="width:38px;height:38px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </div>
                <div style="flex:1;min-width:200px;">
                    <div style="font-size:14px;font-weight:700;color:#1f2937;">Statement of Work Accomplished</div>
                    <div style="font-size:12px;color:#9ca3af;margin-top:2px;">Your SOWA is ready to view, print, or save as PDF.</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button onclick="clientOpenSOWA()" style="display:inline-flex;align-items:center;gap:6px;background:#eff6ff;color:#1d4ed8;border:1.5px solid #bfdbfe;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        View SOWA
                    </button>
                    <button onclick="clientPrintSOWA()" style="display:inline-flex;align-items:center;gap:6px;background:#f0fdf4;color:#059669;border:1.5px solid #d1fae5;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;" title="Opens the browser print dialog — choose &quot;Save as PDF&quot; as the destination to download a PDF.">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                        Print / Save as PDF
                    </button>
                </div>
            </div>`;
    } else {
        el.innerHTML = `<div style="color:#9ca3af;font-size:13.5px;">No SOWA available yet. You can request one from the Billing Periods section.</div>`;
    }
}

// ── Project Completion Timeline ────────────────────────────
function renderProjectTimeline() {
    const el = document.getElementById('project-timeline');
    const badge = document.getElementById('timeline-badge');
    if (!el) return;

    const events = [];

    // Contract start — use earliest folder/project created date
    if (currentFolders.length) {
        events.push({ label: 'Contract Started', sub: currentFolders[0]?.name || 'Project', ts: currentFolders[0]?.createdAt, color: '#6b7280', done: true });
    }

    // Approved reports
    currentBoqDocs.filter(d => d.status === 'approved').forEach(d => {
        events.push({ label: escHtml(d.header?.subject || 'Report Approved'), sub: 'Accomplishment report approved', ts: d.updatedAt, color: '#059669', done: true });
    });

    // Verified payments
    (window._clientPayRequests || []).filter(r => r.status === 'verified').forEach(r => {
        events.push({ label: escHtml(r.billingPeriod || 'Payment Received'), sub: _formatAmount(r.paidAmount != null ? r.paidAmount : r.amount) + ' verified', ts: r.verifiedAt, color: '#2563eb', done: true });
    });

    // Sort by timestamp
    events.sort((a, b) => {
        const ta = a.ts?.seconds ? a.ts.seconds : 0;
        const tb = b.ts?.seconds ? b.ts.seconds : 0;
        return ta - tb;
    });

    if (!events.length) {
        el.innerHTML = `<div style="color:#9ca3af;font-size:13px;text-align:center;padding:16px 0;">No milestones yet.</div>`;
        if (badge) badge.style.display = 'none';
        return;
    }

    if (badge) { badge.textContent = events.length + ' Milestone' + (events.length !== 1 ? 's' : ''); badge.style.display = ''; }

    el.innerHTML = events.map((e, i) => `
        <div style="display:flex;gap:14px;padding:8px 16px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0;">
                <div style="width:28px;height:28px;border-radius:50%;background:${e.color}22;border:2.5px solid ${e.color};display:flex;align-items:center;justify-content:center;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${e.color}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                ${i < events.length - 1 ? `<div style="width:2px;flex:1;min-height:20px;background:#e5e7eb;margin:4px 0;"></div>` : ''}
            </div>
            <div style="padding-bottom:${i < events.length - 1 ? '8' : '0'}px;">
                <div style="font-size:13.5px;font-weight:700;color:#1f2937;">${e.label}</div>
                <div style="font-size:12px;color:#9ca3af;margin-top:2px;">${e.sub}</div>
            </div>
        </div>`).join('');
}

// ── Form Switchers ───────────────────────────────────────
function switchToSignup() { document.getElementById('form-login').style.display = 'none'; document.getElementById('form-signup').style.display = 'block'; clearLoginErrors(); }
function switchToLogin()  { document.getElementById('form-signup').style.display = 'none'; document.getElementById('form-login').style.display = 'block'; clearSignupErrors(); }

// ── Dark Mode ────────────────────────────────────────────
function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('dac-dark', isDark ? '1' : '0');
    document.getElementById('icon-moon').style.display = isDark ? 'none' : '';
    document.getElementById('icon-sun').style.display  = isDark ? '' : 'none';
}

// ── Toast ────────────────────────────────────────────────
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Keyboard ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.getElementById('logout-modal')?.classList.remove('show');
        document.getElementById('report-modal')?.classList.remove('show');
        document.getElementById('photos-modal')?.classList.remove('show');
        document.getElementById('photo-lightbox')?.classList.remove('show');
        document.getElementById('notif-dropdown')?.classList.remove('open');
    }
    if (e.key === 'Enter') {
        const lp = document.getElementById('login-page');
        if (!lp?.classList.contains('active')) return;
        const loginForm  = document.getElementById('form-login');
        const signupForm = document.getElementById('form-signup');
        if (loginForm?.style.display  !== 'none') doLogin();
        else if (signupForm?.style.display !== 'none') doSignup();
    }
});

// ── Password helpers ─────────────────────────────────────
const eyeHide = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
  <line x1="1" y1="1" x2="23" y2="23"/>`;
const eyeShow = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;

function togglePassword(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon  = document.getElementById(iconId);
    const hide  = input.type === 'password';
    input.type  = hide ? 'text' : 'password';
    icon.innerHTML = hide ? eyeHide : eyeShow;
}

// ── Validation helpers ───────────────────────────────────
function setError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg; el.style.display = msg ? 'flex' : 'none';
    const input = el.closest('.field')?.querySelector('input');
    if (input) {
        input.classList.toggle('input-invalid', !!msg);
        if (msg) { input.classList.remove('input-invalid'); void input.offsetWidth; input.classList.add('input-invalid'); }
    }
}
function clearLoginErrors()  { ['err-login-email','err-login-password'].forEach(id => setError(id, '')); document.getElementById('login-error')?.classList.remove('show'); }
function clearSignupErrors() { ['err-su-firstname','err-su-lastname','err-su-email','err-su-password','err-su-confirm'].forEach(id => setError(id, '')); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function getPasswordStrength(pw) {
    let s = 0;
    if (pw.length >= 8)  s++;
    if (pw.length >= 12) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
}

// Password strength on signup
document.addEventListener('DOMContentLoaded', () => {
    const suPw = document.getElementById('su-password');
    if (suPw) {
        suPw.addEventListener('input', () => {
            const wrap  = document.getElementById('pw-strength-wrap');
            const fill  = document.getElementById('pw-strength-fill');
            const label = document.getElementById('pw-strength-label');
            const pw    = suPw.value;
            if (!pw) { wrap.style.display = 'none'; return; }
            wrap.style.display = 'flex';
            const score  = getPasswordStrength(pw);
            const levels = [
                { label:'Very Weak', color:'#e74c3c', pct:'15%' },
                { label:'Weak',      color:'#e67e22', pct:'30%' },
                { label:'Fair',      color:'#f1c40f', pct:'50%' },
                { label:'Good',      color:'#2ecc71', pct:'75%' },
                { label:'Strong',    color:'#00a85e', pct:'100%'},
            ];
            const lvl = levels[Math.max(0, Math.min(score - 1, 4))];
            fill.style.width = lvl.pct; fill.style.background = lvl.color;
            label.textContent = lvl.label; label.style.color = lvl.color;
        });
    }
});

// ── Calculation helpers ──────────────────────────────────
function parseNum(v) { return parseFloat(String(v).replace(/,/g, '')) || 0; }

function calcLineItemTotal(li) {
    const qty = parseNum(li.qty);
    const mat = li.materialOverride ? 0 : parseNum(li.materialRate);
    const lab = li.laborOverride    ? 0 : parseNum(li.laborRate);
    return qty * (mat + lab);
}
function calcCostItemTotal(ci) {
    return (ci.subItems || []).reduce((s, si) =>
        s + (si.lineItems || []).reduce((s2, li) => s2 + calcLineItemTotal(li), 0), 0);
}
function calcCostItemAcc(ci) {
    return (ci.subItems || []).reduce((s, si) =>
        s + (si.lineItems || []).reduce((s2, li) =>
            s2 + calcLineItemTotal(li) * (parseNum(li.percentCompletion) / 100), 0), 0);
}
function calcGrandTotal(costItems) {
    return (costItems || []).reduce((s, ci) => s + calcCostItemTotal(ci), 0);
}
function calcTotalAcc(costItems) {
    return (costItems || []).reduce((s, ci) => s + calcCostItemAcc(ci), 0);
}
function statusToPct(status) {
    return status === 'approved' ? 100 : status === 'submitted' ? 60 : 20;
}
function calcStatusProgress() {
    if (!currentBoqDocs.length) return 0;
    const total = currentBoqDocs.reduce((s, d) => s + statusToPct(d.status), 0);
    return Math.round(total / currentBoqDocs.length);
}

// ── Format helpers ───────────────────────────────────────
function fmt(n) {
    return Number(n).toLocaleString('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function formatPeso(n) {
    return '\u20B1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTimestamp(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
    const now  = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60)   return 'Just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hr' + (Math.floor(diff / 3600) > 1 ? 's' : '') + ' ago';
    if (diff < 604800) return Math.floor(diff / 86400) + ' day' + (Math.floor(diff / 86400) > 1 ? 's' : '') + ' ago';
    return date.toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' });
}
function formatDateStr(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString('en-PH', { month:'long', day:'numeric', year:'numeric' });
}
function formatFundingType(type, billingNumber) {
    switch (type) {
        case 'downpayment':   return 'Downpayment';
        case 'mobilization':  return 'Mobilization';
        case 'final':         return 'Final Payment';
        case 'progress':      return 'Progress Billing' + (billingNumber ? ' #' + billingNumber : '');
        default:              return capitalize(type || 'Billing');
    }
}
function fundingTypeTag(type) {
    const map = {
        downpayment: ['#e6faf2','#00875a','Downpayment'],
        mobilization:['#eff6ff','#1d4ed8','Mobilization'],
        final:       ['#fef3c7','#854d0e','Final'],
        progress:    ['#f3f4f6','#4b5563','Progress'],
    };
    const [bg, color, label] = map[type] || ['#f3f4f6','#4b5563', capitalize(type || 'Billing')];
    return `<span style="background:${bg};color:${color};font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;">${label}</span>`;
}

// ── Animated Counter ─────────────────────────────────────
function animateValue(el, start, end, duration, formatter) {
    let startTime = null;
    function step(ts) {
        if (!startTime) startTime = ts;
        const p    = Math.min((ts - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = formatter(Math.floor(start + (end - start) * ease));
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}
