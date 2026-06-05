// ════════════════════════════════════════════════════════════
// USER NAVIGATOR MODULE
// Tab 1 — Employees: admin/staff/worker accounts (users collection only)
// Tab 2 — Client Management: constructionClientUsers (admin-provisioned)
// Tab 3 — Client Portal: clientPortalUsers (admin-provisioned)
// ════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── State ────────────────────────────────────────────────
    let _allUsers        = [];
    let _allConClients   = [];
    let _allPortalClients = [];
    let _conProjects     = [];
    let _boqProjects     = [];
    let _loading         = false;
    let _activeTab       = 'all';

    // ── Tab Switching ────────────────────────────────────────
    window.switchUnTab = function (tab) {
        _activeTab = tab;
        ['all', 'construction', 'portal'].forEach(t => {
            const btn   = document.getElementById('un-tab-' + t);
            const panel = document.getElementById('un-panel-' + t);
            const active = t === tab;
            if (btn) {
                btn.style.color             = active ? '#1d4ed8' : '#6b7280';
                btn.style.borderBottomColor = active ? '#2563eb' : 'transparent';
                btn.style.fontWeight        = active ? '700'     : '600';
            }
            if (panel) panel.style.display = active ? '' : 'none';
        });
        if (tab === 'construction' && !_allConClients.length)   _loadConClients();
        if (tab === 'portal'       && !_allPortalClients.length) _loadPortalClients();
    };

    // ── Public entry point ────────────────────────────────────
    window.initUserNavigator = function () {
        if (_loading) return;
        _activeTab = 'all';
        ['all', 'construction', 'portal'].forEach(t => {
            const btn   = document.getElementById('un-tab-' + t);
            const panel = document.getElementById('un-panel-' + t);
            const active = t === 'all';
            if (btn) { btn.style.color = active ? '#1d4ed8' : '#6b7280'; btn.style.borderBottomColor = active ? '#2563eb' : 'transparent'; btn.style.fontWeight = active ? '700' : '600'; }
            if (panel) panel.style.display = active ? '' : 'none';
        });
        _loadUsers();
    };

    // ════════════════════════════════════════════════════════
    // ALL USERS (admin + design clients)
    // ════════════════════════════════════════════════════════

    async function _loadUsers() {
        _loading = true;
        _showLoading(true);

        let adminErr = null;

        try {
            const snap = await db.collection('users').get();
            _allUsers = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    uid      : doc.id,
                    _type    : 'admin',
                    name     : d.displayName || d.name || null,
                    email    : d.email || '',
                    role     : d.role || 'owner',
                    status   : d.status || 'active',
                    lastLogin: d.lastLogin || d.last_login || null,
                    createdAt: d.createdAt || null
                };
            }).sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));
        } catch (e) {
            adminErr = e;
            console.warn('UserNavigator: could not load employee users —', e.message);
        }

        _loading = false;
        _showLoading(false);

        if (adminErr) { _showPermissionError(); return; }

        _renderStats(_allUsers);
        _renderTable(_allUsers);
        _clearNewUserBadge();
    }

    function _renderStats(users) {
        const total  = users.length;
        const active = users.filter(u => u.status === 'active').length;
        _setText('unTotalCount',    total);
        _setText('unActiveCount',   active);
        _setText('unInactiveCount', total - active);
    }

    function _renderTable(users) {
        const tbody = document.getElementById('unTableBody');
        const table = document.getElementById('unTable');
        const empty = document.getElementById('unEmptyState');
        if (!tbody) return;

        if (!users.length) {
            if (table) table.style.display = 'none';
            if (empty) empty.style.display = 'flex';
        } else {
            if (table) table.style.display = 'table';
            if (empty) empty.style.display = 'none';
            tbody.innerHTML = users.map(_buildRow).join('');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function _buildRow(user) {
        const name    = user.name || _nameFromEmail(user.email);
        const initial = (name[0] || 'U').toUpperCase();
        const avatarContent = user.photoURL
            ? `<img src="${_esc(user.photoURL)}" alt="${_esc(initial)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
            : initial;
        const toggleBtn = user.status === 'active'
            ? `<button class="un-btn-toggle un-btn-deactivate" onclick="unToggleStatus('${user.uid}','active')">Deactivate</button>`
            : `<button class="un-btn-toggle un-btn-activate"   onclick="unToggleStatus('${user.uid}','inactive')">Activate</button>`;

        return `<tr data-uid="${user.uid}">
            <td><div class="un-user-cell">
                <div class="un-avatar">${avatarContent}</div>
                <span class="un-user-name">${_esc(name)}</span>
            </div></td>
            <td style="color:#6b7280;font-size:13px;">${_esc(user.email)}</td>
            <td><span class="un-role-badge ${_roleClass(user.role)}">${_roleLabel(user.role)}</span></td>
            <td>${_statusBadge(user.status)}</td>
            <td><div class="un-actions">
                <button class="un-btn-view" onclick="unViewProfile('${user.uid}','admin')">
                    <i data-lucide="eye" style="width:13px;height:13px;"></i> View
                </button>
                <button class="un-btn-view" onclick="unOpenEditModal('${user.uid}','admin')" style="background:#f0fdf4;color:#16a34a;border-color:#bbf7d0;">
                    <i data-lucide="pencil" style="width:13px;height:13px;"></i> Edit
                </button>
                ${toggleBtn}
            </div></td>
        </tr>`;
    }

    window.unFilterUsers = function () {
        const q      = (document.getElementById('unSearchInput')?.value  || '').toLowerCase().trim();
        const role   = (document.getElementById('unRoleFilter')?.value   || '');
        const status = (document.getElementById('unStatusFilter')?.value || '');
        const filtered = _allUsers.filter(u => {
            const name  = (u.name || _nameFromEmail(u.email)).toLowerCase();
            const email = (u.email || '').toLowerCase();
            return (!q      || name.includes(q)  || email.includes(q))
                && (!role   || u.role   === role)
                && (!status || u.status === status);
        });
        _renderTable(filtered);
    };

    window.unToggleStatus = async function (uid, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
        try {
            await db.collection('users').doc(uid).update({ status: newStatus });
            const u = _allUsers.find(x => x.uid === uid);
            if (u) u.status = newStatus;
            _renderStats(_allUsers);
            unFilterUsers();
        } catch (err) {
            console.error('unToggleStatus:', err);
            alert('Could not update user status. Please try again.');
        }
    };

    window.unViewProfile = function (uid) {
        const user = _allUsers.find(u => u.uid === uid);
        if (!user) return;
        const name    = user.name || _nameFromEmail(user.email);
        const initial = (name[0] || 'U').toUpperCase();

        const avatar = document.getElementById('unModalAvatar');
        const nameEl = document.getElementById('unModalName');
        const badge  = document.getElementById('unModalRoleBadge');

        if (avatar) {
            avatar.className = 'un-modal-avatar';
            if (user.photoURL) {
                avatar.innerHTML = `<img src="${_esc(user.photoURL)}" alt="${initial}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            } else {
                avatar.textContent = initial;
            }
        }
        if (nameEl) nameEl.textContent = name;
        if (badge)  { badge.textContent = _roleLabel(user.role); badge.className = `un-role-badge ${_roleClass(user.role)}`; }

        const body = document.getElementById('unProfileBody');
        if (body) body.innerHTML = `
            <div class="un-profile-section">
                <div class="un-profile-section-title">Account Info</div>
                <div class="un-profile-row"><span class="un-profile-label">Full Name</span><span class="un-profile-value">${_esc(name)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">Email</span><span class="un-profile-value">${_esc(user.email)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">Account Type</span><span class="un-profile-value"><span class="un-role-badge" style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">Employee</span></span></div>
                <div class="un-profile-row"><span class="un-profile-label">Role</span><span class="un-profile-value"><span class="un-role-badge ${_roleClass(user.role)}">${_roleLabel(user.role)}</span></span></div>
                <div class="un-profile-row"><span class="un-profile-label">Status</span><span class="un-profile-value">${_statusBadge(user.status)}</span></div>
            </div>
            <div class="un-profile-section">
                <div class="un-profile-section-title">Registration</div>
                <div class="un-profile-row"><span class="un-profile-label">Registered</span><span class="un-profile-value">${_formatDate(user.createdAt)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">User ID</span><span class="un-profile-value" style="font-size:11px;color:#9ca3af;word-break:break-all;">${uid}</span></div>
            </div>
            <div class="un-modal-footer" style="padding:0;margin-top:8px;border:none;display:flex;justify-content:flex-end;gap:10px;">
                <button class="un-btn-toggle ${user.status === 'active' ? 'un-btn-deactivate' : 'un-btn-activate'}"
                    onclick="unToggleStatus('${uid}','${user.status}');unCloseProfile();">
                    ${user.status === 'active' ? 'Deactivate User' : 'Activate User'}
                </button>
                <button class="un-modal-btn-close" onclick="unCloseProfile()">Close</button>
            </div>`;

        const modal = document.getElementById('unProfileModal');
        if (modal) { modal.style.display = 'flex'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    };

    window.unCloseProfile = function () {
        const modal = document.getElementById('unProfileModal');
        if (modal) modal.style.display = 'none';
    };

    // ── Edit User Modal ────────────────────────────────────────

    window.unOpenEditModal = function (uid, userType) {
        const user = _allUsers.find(u => u.uid === uid && u._type === userType);
        if (!user) return;
        const modal = document.getElementById('unEditModal');
        if (!modal) return;

        ['err-un-edit-firstname','err-un-edit-lastname','err-un-edit-displayname',
         'err-un-edit-role','un-edit-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        modal.dataset.uid  = uid;
        modal.dataset.type = 'admin';

        const adminFields  = document.getElementById('un-edit-admin-fields');
        const clientFields = document.getElementById('un-edit-client-fields');
        const emailEl      = document.getElementById('un-edit-email');
        const nameEl       = document.getElementById('un-edit-modal-name');

        if (emailEl) emailEl.textContent = user.email;
        if (nameEl)  nameEl.textContent  = user.name || _nameFromEmail(user.email);

        if (adminFields)  adminFields.style.display  = '';
        if (clientFields) clientFields.style.display = 'none';
        const dnEl   = document.getElementById('un-edit-displayname');
        const roleEl = document.getElementById('un-edit-role');
        if (dnEl)   dnEl.value   = user.name || '';
        if (roleEl) roleEl.value = user.role || '';

        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    };

    window.unCloseEditModal = function () {
        const modal = document.getElementById('unEditModal');
        if (modal) modal.style.display = 'none';
    };

    window.unSubmitEdit = async function () {
        ['err-un-edit-firstname','err-un-edit-lastname','err-un-edit-displayname',
         'err-un-edit-role','un-edit-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        const modal = document.getElementById('unEditModal');
        const uid   = modal?.dataset.uid;
        if (!uid) return;
        const user = _allUsers.find(u => u.uid === uid);
        if (!user) return;

        let valid = true;
        function _fe(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = 'block'; } valid = false; }

        const displayName = (document.getElementById('un-edit-displayname')?.value || '').trim();
        const role        = (document.getElementById('un-edit-role')?.value        || '');
        if (!displayName) _fe('err-un-edit-displayname', 'Display name is required.');
        if (!role)        _fe('err-un-edit-role',        'Please select a role.');
        if (!valid) return;

        const updates = { displayName, role };
        const newName = displayName;

        const btn = document.getElementById('un-edit-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        try {
            await db.collection('users').doc(uid).update(updates);
            user.name = newName;
            user.role = role;
            _renderStats(_allUsers);
            unFilterUsers();
            unCloseEditModal();
            _showSuccessBanner('Changes saved for ' + newName + '.');
        } catch (err) {
            console.error('unSubmitEdit:', err);
            const errEl = document.getElementById('un-edit-general-err');
            if (errEl) { errEl.textContent = 'Could not save changes. Please try again.'; errEl.style.display = 'block'; }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Changes';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }
    };

    // ── Add Employee Modal ────────────────────────────────────

    window.unOpenAddEmployeeModal = function () {
        const modal = document.getElementById('unAddEmployeeModal');
        if (!modal) return;

        ['emp-create-firstname','emp-create-lastname','emp-create-email',
         'emp-create-password','emp-create-confirm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const roleEl = document.getElementById('emp-create-role');
        if (roleEl) roleEl.value = '';
        ['err-emp-firstname','err-emp-lastname','err-emp-email','err-emp-role',
         'err-emp-password','err-emp-confirm','emp-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(() => document.getElementById('emp-create-firstname')?.focus(), 80);
    };

    window.unCloseAddEmployeeModal = function () {
        const modal = document.getElementById('unAddEmployeeModal');
        if (modal) modal.style.display = 'none';
    };

    window.unSubmitAddEmployee = async function () {
        ['err-emp-firstname','err-emp-lastname','err-emp-email','err-emp-role',
         'err-emp-password','err-emp-confirm','emp-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        const firstName = (document.getElementById('emp-create-firstname')?.value || '').trim();
        const lastName  = (document.getElementById('emp-create-lastname')?.value  || '').trim();
        const email     = (document.getElementById('emp-create-email')?.value     || '').trim();
        const role      = (document.getElementById('emp-create-role')?.value      || '');
        const password  = (document.getElementById('emp-create-password')?.value  || '');
        const confirm   = (document.getElementById('emp-create-confirm')?.value   || '');

        let valid = true;
        function _fe(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = 'block'; } valid = false; }

        if (!firstName)                              _fe('err-emp-firstname', 'First name is required.');
        if (!lastName)                               _fe('err-emp-lastname',  'Last name is required.');
        if (!email)                                  _fe('err-emp-email',     'Email is required.');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) _fe('err-emp-email', 'Enter a valid email address.');
        if (!role)                                   _fe('err-emp-role',      'Please select a role.');
        if (!password)                               _fe('err-emp-password',  'Password is required.');
        else if (password.length < 8)                _fe('err-emp-password',  'Minimum 8 characters.');
        if (!confirm)                                _fe('err-emp-confirm',   'Please confirm the password.');
        else if (confirm !== password)               _fe('err-emp-confirm',   'Passwords don\'t match.');
        if (!valid) return;

        const btn = document.getElementById('emp-create-submit-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<div class="un-loading-spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;display:inline-block;"></div>Creating…'; }

        try {
            // Create the auth user + profile via the admin Edge Function — the current
            // admin's session stays intact and the service_role key stays server-side.
            const ownerUid = window.currentDataUserId || auth.currentUser?.uid || '';
            const { uid } = await adminCreateUser({
                email, password, kind: 'admin', role, ownerUid,
                firstName, lastName, displayName: firstName + ' ' + lastName,
            });

            // Add to local state and refresh table
            const newUser = {
                uid,
                _type    : 'admin',
                name     : firstName + ' ' + lastName,
                email,
                role,
                status   : 'active',
                createdAt: new Date()
            };
            _allUsers.unshift(newUser);
            _renderStats(_allUsers);
            unFilterUsers();

            unCloseAddEmployeeModal();
            _showSuccessBanner(firstName + ' ' + lastName + ' has been added as ' + _roleLabel(role) + '.');
        } catch (err) {
            console.error('unSubmitAddEmployee:', err);
            let msg = 'Something went wrong. Please try again.';
            if (err.code === 'auth/email-already-in-use' || /exists|already/i.test(err.message || '')) msg = 'An account with this email already exists.';
            if (err.code === 'auth/weak-password' || /password/i.test(err.message || '')) msg = 'Password is too weak. Use at least 8 characters.';
            if (err.code === 'auth/invalid-email')        msg = 'The email address is not valid.';
            const errEl = document.getElementById('emp-create-general-err');
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="user-plus" style="width:14px;height:14px;"></i> Add Employee';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }
    };


    // ════════════════════════════════════════════════════════
    // CONSTRUCTION CLIENTS
    // ════════════════════════════════════════════════════════

    async function _loadConClients() {
        _showConLoading(true);
        try {
            const [conSnap, projSnap] = await Promise.all([
                db.collection('constructionClientUsers').get(),
                db.collection('constructionProjects').orderBy('projectName').get()
            ]);

            _conProjects = projSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            const projectByEmail = {};
            _conProjects.forEach(p => {
                if (p.clientEmail) projectByEmail[(p.clientEmail || '').toLowerCase()] = p.projectName || '';
            });

            _allConClients = conSnap.docs.map(doc => {
                const d     = doc.data();
                const email = (d.email || '').toLowerCase();
                return {
                    uid      : doc.id,
                    firstName: d.firstName || '',
                    lastName : d.lastName  || '',
                    name     : ((d.firstName || '') + ' ' + (d.lastName || '')).trim() || null,
                    email    : d.email     || '',
                    status   : d.status    || 'active',
                    createdAt: d.createdAt || null,
                    project  : projectByEmail[email] || ''
                };
            }).sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));

            _showConLoading(false);
            _renderConStats(_allConClients);
            _renderConTable(_allConClients);
        } catch (e) {
            console.error('ConstructionClients: load error', e);
            const el = document.getElementById('ccLoadingState');
            if (el) el.innerHTML = `<div style="text-align:center;"><p style="color:#b91c1c;font-weight:600;margin:0;">Could not load client management.</p></div>`;
        }
    }

    function _renderConStats(clients) {
        const total  = clients.length;
        const active = clients.filter(c => c.status === 'active').length;
        _setText('ccTotalCount',    total);
        _setText('ccActiveCount',   active);
        _setText('ccInactiveCount', total - active);
    }

    function _renderConTable(clients) {
        const tbody = document.getElementById('ccTableBody');
        const table = document.getElementById('ccTable');
        const empty = document.getElementById('ccEmptyState');
        if (!tbody) return;

        if (!clients.length) {
            if (table) table.style.display = 'none';
            if (empty) empty.style.display = 'flex';
        } else {
            if (table) table.style.display = 'table';
            if (empty) empty.style.display = 'none';
            tbody.innerHTML = clients.map(_buildConRow).join('');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function _buildConRow(c) {
        const name    = c.name || _nameFromEmail(c.email);
        const initial = (name[0] || 'C').toUpperCase();
        const toggleBtn = c.status === 'active'
            ? `<button class="un-btn-toggle un-btn-deactivate" onclick="ccToggleStatus('${c.uid}','active')">Deactivate</button>`
            : `<button class="un-btn-toggle un-btn-activate"   onclick="ccToggleStatus('${c.uid}','inactive')">Activate</button>`;
        const projectCell = c.project
            ? `<span class="ca-project-tag">${_esc(c.project)}</span>`
            : `<span style="color:#d1d5db;font-size:12px;">No project linked</span>`;

        return `<tr data-uid="${c.uid}">
            <td><div class="un-user-cell">
                <div class="un-avatar un-avatar-client">${initial}</div>
                <span class="un-user-name">${_esc(name)}</span>
            </div></td>
            <td style="color:#6b7280;font-size:13px;">${_esc(c.email)}</td>
            <td>${projectCell}</td>
            <td style="color:#6b7280;font-size:13px;">${_formatDate(c.createdAt)}</td>
            <td>${_statusBadge(c.status)}</td>
            <td><div class="un-actions">
                <button class="un-btn-view" onclick="ccViewProfile('${c.uid}')">
                    <i data-lucide="eye" style="width:13px;height:13px;"></i> View
                </button>
                <button class="un-btn-view" onclick="ccOpenEditModal('${c.uid}')" style="background:#f0fdf4;color:#16a34a;border-color:#bbf7d0;">
                    <i data-lucide="pencil" style="width:13px;height:13px;"></i> Edit
                </button>
                ${toggleBtn}
            </div></td>
        </tr>`;
    }

    window.ccFilterClients = function () {
        const q      = (document.getElementById('ccSearchInput')?.value  || '').toLowerCase().trim();
        const status = (document.getElementById('ccStatusFilter')?.value || '');
        const filtered = _allConClients.filter(c => {
            const name    = (c.name || _nameFromEmail(c.email)).toLowerCase();
            const email   = (c.email || '').toLowerCase();
            const project = (c.project || '').toLowerCase();
            return (!q      || name.includes(q) || email.includes(q) || project.includes(q))
                && (!status || c.status === status);
        });
        _renderConTable(filtered);
    };

    window.ccToggleStatus = async function (uid, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
        try {
            await db.collection('constructionClientUsers').doc(uid).update({ status: newStatus });
            const c = _allConClients.find(x => x.uid === uid);
            if (c) c.status = newStatus;
            _renderConStats(_allConClients);
            ccFilterClients();
        } catch (err) {
            console.error('ccToggleStatus:', err);
            alert('Could not update account status. Please try again.');
        }
    };

    window.ccViewProfile = function (uid) {
        const c = _allConClients.find(x => x.uid === uid);
        if (!c) return;
        const name    = c.name || _nameFromEmail(c.email);
        const initial = (name[0] || 'C').toUpperCase();

        const avatar = document.getElementById('unModalAvatar');
        const nameEl = document.getElementById('unModalName');
        const badge  = document.getElementById('unModalRoleBadge');

        if (avatar) { avatar.className = 'un-modal-avatar un-avatar-client'; avatar.textContent = initial; }
        if (nameEl) nameEl.textContent = name;
        if (badge)  { badge.textContent = 'Client Management'; badge.className = 'un-role-badge un-role-client'; }

        const projectHtml = c.project
            ? `<span class="ca-project-tag">${_esc(c.project)}</span>`
            : '<span style="color:#9ca3af;font-size:13px;">No project linked</span>';

        const body = document.getElementById('unProfileBody');
        if (body) body.innerHTML = `
            <div class="un-profile-section">
                <div class="un-profile-section-title">Account Info</div>
                <div class="un-profile-row"><span class="un-profile-label">Full Name</span><span class="un-profile-value">${_esc(name)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">Email</span><span class="un-profile-value">${_esc(c.email)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">Status</span><span class="un-profile-value">${_statusBadge(c.status)}</span></div>
            </div>
            <div class="un-profile-section">
                <div class="un-profile-section-title">Construction Project</div>
                <div class="un-profile-row" style="flex-wrap:wrap;gap:6px;">${projectHtml}</div>
            </div>
            <div class="un-profile-section">
                <div class="un-profile-section-title">Account Details</div>
                <div class="un-profile-row"><span class="un-profile-label">Created</span><span class="un-profile-value">${_formatDate(c.createdAt)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">User ID</span><span class="un-profile-value" style="font-size:11px;color:#9ca3af;word-break:break-all;">${c.uid}</span></div>
            </div>
            <div class="un-modal-footer" style="padding:0;margin-top:8px;border:none;display:flex;justify-content:flex-end;gap:10px;">
                <button class="un-btn-toggle ${c.status === 'active' ? 'un-btn-deactivate' : 'un-btn-activate'}"
                    onclick="ccToggleStatus('${uid}','${c.status}');unCloseProfile();">
                    ${c.status === 'active' ? 'Deactivate Account' : 'Activate Account'}
                </button>
                <button class="un-modal-btn-close" onclick="unCloseProfile()">Close</button>
            </div>`;

        const modal = document.getElementById('unProfileModal');
        if (modal) { modal.style.display = 'flex'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    };

    // ── Create Account Modal ─────────────────────────────────

    window.caOpenCreateModal = async function () {
        const modal = document.getElementById('caCreateModal');
        if (!modal) return;

        ['cc-create-firstname','cc-create-lastname','cc-create-email',
         'cc-create-password','cc-create-confirm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        ['err-cc-firstname','err-cc-lastname','err-cc-email',
         'err-cc-password','err-cc-confirm','cc-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(() => document.getElementById('cc-create-firstname')?.focus(), 80);

        const sel = document.getElementById('cc-create-project');
        if (sel) {
            sel.innerHTML = '<option value="">Loading projects…</option>';
            if (!_conProjects.length) {
                try {
                    const snap = await db.collection('constructionProjects').orderBy('projectName').get();
                    _conProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                } catch (e) {
                    console.warn('Could not load projects for dropdown');
                }
            }
            sel.innerHTML = '<option value="">— No project yet —</option>';
            _conProjects.forEach(p => {
                const opt = document.createElement('option');
                opt.value       = p.id;
                opt.textContent = (p.clientName ? p.clientName + ' — ' : '') + (p.projectName || p.id);
                sel.appendChild(opt);
            });
        }
    };

    window.caCloseCreateModal = function () {
        const modal = document.getElementById('caCreateModal');
        if (modal) modal.style.display = 'none';
    };

    window.caSubmitCreateClient = async function () {
        ['err-cc-firstname','err-cc-lastname','err-cc-email',
         'err-cc-password','err-cc-confirm','cc-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        const firstName = (document.getElementById('cc-create-firstname')?.value || '').trim();
        const lastName  = (document.getElementById('cc-create-lastname')?.value  || '').trim();
        const email     = (document.getElementById('cc-create-email')?.value     || '').trim();
        const password  = (document.getElementById('cc-create-password')?.value  || '');
        const confirm   = (document.getElementById('cc-create-confirm')?.value   || '');
        const projectId = (document.getElementById('cc-create-project')?.value   || '');

        let valid = true;
        function _fe(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = 'block'; } valid = false; }

        if (!firstName)                              _fe('err-cc-firstname', 'First name is required.');
        if (!lastName)                               _fe('err-cc-lastname',  'Last name is required.');
        if (!email)                                  _fe('err-cc-email',     'Email is required.');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) _fe('err-cc-email', 'Enter a valid email address.');
        if (!password)                               _fe('err-cc-password',  'Password is required.');
        else if (password.length < 8)                _fe('err-cc-password',  'Minimum 8 characters.');
        if (!confirm)                                _fe('err-cc-confirm',   'Please confirm the password.');
        else if (confirm !== password)               _fe('err-cc-confirm',   'Passwords don\'t match.');
        if (!valid) return;

        const btn = document.getElementById('cc-create-submit-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<div class="un-loading-spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;display:inline-block;"></div>Creating…'; }

        try {
            // Edge Function creates the auth user (reusing the uid if the email already
            // exists) and upserts the construction_client profile. Admin session intact.
            const { uid } = await adminCreateUser({
                email, password, kind: 'construction_client', role: 'client',
                firstName, lastName, displayName: firstName + ' ' + lastName,
            });

            if (projectId) {
                await db.collection('constructionProjects').doc(projectId).update({
                    clientEmail: email,
                    clientName : firstName + ' ' + lastName
                });
                const proj = _conProjects.find(p => p.id === projectId);
                if (proj) { proj.clientEmail = email; proj.clientName = firstName + ' ' + lastName; }
            }

            const linkedProject = _conProjects.find(p => p.id === projectId);
            _allConClients.unshift({
                uid, firstName, lastName,
                name     : firstName + ' ' + lastName,
                email,
                status   : 'active',
                createdAt: new Date(),
                project  : linkedProject?.projectName || ''
            });
            _renderConStats(_allConClients);
            _renderConTable(_allConClients);

            caCloseCreateModal();
            _showSuccessBanner('Account created for ' + firstName + ' ' + lastName + '. They can now log in to the Client Management Portal.');
        } catch (err) {
            console.error('caSubmitCreateClient:', err);
            let msg = 'Something went wrong. Please try again.';
            if (/weak|password too/i.test(err.message || '')) {
                msg = 'Password is too weak. Use at least 8 characters with mixed characters.';
            } else if (/invalid.*email/i.test(err.message || '')) {
                msg = 'The email address is not valid.';
            } else if (err.message) {
                msg = err.message;
            }
            const errEl = document.getElementById('cc-create-general-err');
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="user-plus" style="width:14px;height:14px;"></i> Create Account';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }
    };

    // ── Edit Construction Client Modal ────────────────────────

    window.ccOpenEditModal = async function (uid) {
        const c = _allConClients.find(x => x.uid === uid);
        if (!c) return;
        const modal = document.getElementById('ccEditModal');
        if (!modal) return;

        ['err-cc-edit-firstname','err-cc-edit-lastname','cc-edit-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        modal.dataset.uid = uid;

        const fnEl    = document.getElementById('cc-edit-firstname');
        const lnEl    = document.getElementById('cc-edit-lastname');
        const emailEl = document.getElementById('cc-edit-email');
        const nameEl  = document.getElementById('cc-edit-modal-name');

        if (fnEl)    fnEl.value          = c.firstName || '';
        if (lnEl)    lnEl.value          = c.lastName  || '';
        if (emailEl) emailEl.textContent = c.email;
        if (nameEl)  nameEl.textContent  = c.name || _nameFromEmail(c.email);

        const sel = document.getElementById('cc-edit-project');
        if (sel) {
            sel.innerHTML = '<option value="">Loading projects…</option>';
            if (!_conProjects.length) {
                try {
                    const snap = await db.collection('constructionProjects').orderBy('projectName').get();
                    _conProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                } catch (e) { console.warn('Could not load projects for edit dropdown'); }
            }
            sel.innerHTML = '<option value="">— No project linked —</option>';
            _conProjects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = (p.clientName ? p.clientName + ' — ' : '') + (p.projectName || p.id);
                if ((p.clientEmail || '').toLowerCase() === c.email.toLowerCase()) opt.selected = true;
                sel.appendChild(opt);
            });
        }

        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(() => document.getElementById('cc-edit-firstname')?.focus(), 80);
    };

    window.ccCloseEditModal = function () {
        const modal = document.getElementById('ccEditModal');
        if (modal) modal.style.display = 'none';
    };

    window.ccSubmitEdit = async function () {
        ['err-cc-edit-firstname','err-cc-edit-lastname','cc-edit-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        const modal = document.getElementById('ccEditModal');
        const uid   = modal?.dataset.uid;
        if (!uid) return;
        const c = _allConClients.find(x => x.uid === uid);
        if (!c) return;

        const firstName = (document.getElementById('cc-edit-firstname')?.value || '').trim();
        const lastName  = (document.getElementById('cc-edit-lastname')?.value  || '').trim();
        const projectId = (document.getElementById('cc-edit-project')?.value   || '');

        let valid = true;
        function _fe(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = 'block'; } valid = false; }

        if (!firstName) _fe('err-cc-edit-firstname', 'First name is required.');
        if (!lastName)  _fe('err-cc-edit-lastname',  'Last name is required.');
        if (!valid) return;

        const btn = document.getElementById('cc-edit-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        try {
            await db.collection('constructionClientUsers').doc(uid).update({ firstName, lastName });

            // Handle project link changes
            const prevProj = _conProjects.find(p => (p.clientEmail || '').toLowerCase() === c.email.toLowerCase());
            const newProj  = _conProjects.find(p => p.id === projectId);

            if (prevProj && prevProj.id !== (newProj?.id || '')) {
                await db.collection('constructionProjects').doc(prevProj.id).update({ clientEmail: '', clientName: '' });
                prevProj.clientEmail = '';
                prevProj.clientName  = '';
            }
            if (newProj) {
                await db.collection('constructionProjects').doc(newProj.id).update({
                    clientEmail: c.email,
                    clientName : firstName + ' ' + lastName
                });
                newProj.clientEmail = c.email;
                newProj.clientName  = firstName + ' ' + lastName;
            }

            c.firstName = firstName;
            c.lastName  = lastName;
            c.name      = firstName + ' ' + lastName;
            c.project   = newProj?.projectName || '';

            _renderConStats(_allConClients);
            ccFilterClients();
            ccCloseEditModal();
            _showSuccessBanner('Changes saved for ' + firstName + ' ' + lastName + '.');
        } catch (err) {
            console.error('ccSubmitEdit:', err);
            const errEl = document.getElementById('cc-edit-general-err');
            if (errEl) { errEl.textContent = 'Could not save changes. Please try again.'; errEl.style.display = 'block'; }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Changes';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }
    };

    function _showSuccessBanner(msg) {
        let banner = document.getElementById('cc-success-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'cc-success-banner';
            banner.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;background:#166534;color:#fff;padding:14px 20px;border-radius:10px;font-size:13px;font-weight:600;max-width:360px;box-shadow:0 4px 16px rgba(0,0,0,.18);display:flex;align-items:flex-start;gap:10px;';
            document.body.appendChild(banner);
        }
        banner.innerHTML = `<span style="font-size:18px;line-height:1;">&#10003;</span><span>${_esc(msg)}</span>`;
        banner.style.display = 'flex';
        clearTimeout(banner._timer);
        banner._timer = setTimeout(() => { banner.style.display = 'none'; }, 5000);
    }

    // ════════════════════════════════════════════════════════
    // CLIENT PORTAL
    // ════════════════════════════════════════════════════════

    async function _loadPortalClients() {
        _showPortalLoading(true);
        try {
            const uid = window.currentDataUserId || auth.currentUser?.uid;
            const [portalSnap, boqSnap] = await Promise.all([
                db.collection('clientUsers').get(),
                db.collection('boqDocuments').where('userId', '==', uid).get()
            ]);

            _boqProjects = boqSnap.docs.map(d => ({ id: d.id, ...d.data() }));

            const projectsByEmail = {};
            _boqProjects.forEach(p => {
                const email = (p.clientEmail || '').toLowerCase();
                const name  = p.projectName || p.header?.projectName || p.header?.subject || '';
                if (!email || !name) return;
                if (!projectsByEmail[email]) projectsByEmail[email] = [];
                if (!projectsByEmail[email].includes(name)) projectsByEmail[email].push(name);
            });

            _allPortalClients = portalSnap.docs.map(doc => {
                const d     = doc.data();
                const email = (d.email || '').toLowerCase();
                return {
                    uid      : doc.id,
                    firstName: d.firstName || '',
                    lastName : d.lastName  || '',
                    name     : ((d.firstName || '') + ' ' + (d.lastName || '')).trim() || null,
                    email    : d.email  || '',
                    status   : d.status || 'active',
                    createdAt: d.createdAt || null,
                    projects : projectsByEmail[email] || []
                };
            }).sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));

            _showPortalLoading(false);
            _renderPortalStats(_allPortalClients);
            _renderPortalTable(_allPortalClients);
        } catch (e) {
            console.error('PortalClients: load error', e);
            const el = document.getElementById('cpLoadingState');
            if (el) el.innerHTML = `<div style="text-align:center;"><p style="color:#b91c1c;font-weight:600;margin:0;">Could not load client portal accounts.</p></div>`;
        }
    }

    function _renderPortalStats(clients) {
        const total  = clients.length;
        const active = clients.filter(c => c.status === 'active').length;
        _setText('cpTotalCount',    total);
        _setText('cpActiveCount',   active);
        _setText('cpInactiveCount', total - active);
    }

    function _renderPortalTable(clients) {
        const tbody = document.getElementById('cpTableBody');
        const table = document.getElementById('cpTable');
        const empty = document.getElementById('cpEmptyState');
        if (!tbody) return;
        if (!clients.length) {
            if (table) table.style.display = 'none';
            if (empty) empty.style.display = 'flex';
        } else {
            if (table) table.style.display = 'table';
            if (empty) empty.style.display = 'none';
            tbody.innerHTML = clients.map(_buildPortalRow).join('');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function _buildPortalRow(c) {
        const name    = c.name || _nameFromEmail(c.email);
        const initial = (name[0] || 'C').toUpperCase();
        const toggleBtn = c.status === 'active'
            ? `<button class="un-btn-toggle un-btn-deactivate" onclick="cpToggleStatus('${c.uid}','active')">Deactivate</button>`
            : `<button class="un-btn-toggle un-btn-activate"   onclick="cpToggleStatus('${c.uid}','inactive')">Activate</button>`;
        const projectCell = c.projects?.length
            ? c.projects.map(p => `<span class="ca-project-tag">${_esc(p)}</span>`).join(' ')
            : `<span style="color:#d1d5db;font-size:12px;">No project linked</span>`;
        return `<tr data-uid="${c.uid}">
            <td><div class="un-user-cell">
                <div class="un-avatar un-avatar-client">${initial}</div>
                <span class="un-user-name">${_esc(name)}</span>
            </div></td>
            <td style="color:#6b7280;font-size:13px;">${_esc(c.email)}</td>
            <td>${projectCell}</td>
            <td style="color:#6b7280;font-size:13px;">${_formatDate(c.createdAt)}</td>
            <td>${_statusBadge(c.status)}</td>
            <td><div class="un-actions">
                ${toggleBtn}
            </div></td>
        </tr>`;
    }

    window.cpFilterClients = function () {
        const q      = (document.getElementById('cpSearchInput')?.value  || '').toLowerCase().trim();
        const status = (document.getElementById('cpStatusFilter')?.value || '');
        const filtered = _allPortalClients.filter(c => {
            const name  = (c.name || _nameFromEmail(c.email)).toLowerCase();
            const email = (c.email || '').toLowerCase();
            return (!q      || name.includes(q) || email.includes(q))
                && (!status || c.status === status);
        });
        _renderPortalTable(filtered);
    };

    window.cpToggleStatus = async function (uid, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
        try {
            await db.collection('clientUsers').doc(uid).update({ status: newStatus });
            const c = _allPortalClients.find(x => x.uid === uid);
            if (c) c.status = newStatus;
            _renderPortalStats(_allPortalClients);
            cpFilterClients();
        } catch (err) {
            console.error('cpToggleStatus:', err);
            alert('Could not update account status. Please try again.');
        }
    };

    // ── Create Portal Account Modal ───────────────────────────────

    window.cpOpenCreateModal = async function () {
        const modal = document.getElementById('cpCreateModal');
        if (!modal) return;
        ['cp-create-firstname','cp-create-lastname','cp-create-email',
         'cp-create-password','cp-create-confirm'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        ['err-cp-firstname','err-cp-lastname','err-cp-email',
         'err-cp-password','err-cp-confirm','cp-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });
        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(() => document.getElementById('cp-create-firstname')?.focus(), 80);

        const sel = document.getElementById('cp-create-project');
        if (sel) {
            sel.innerHTML = '<option value="">Loading projects…</option>';
            const ownerUid = window.currentDataUserId || auth.currentUser?.uid;
            if (!_boqProjects.length) {
                try {
                    const snap = await db.collection('boqDocuments').where('userId', '==', ownerUid).get();
                    _boqProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                } catch (e) { console.warn('Could not load BOQ projects for portal dropdown'); }
            }
            sel.innerHTML = '<option value="">— No project yet —</option>';
            _boqProjects.forEach(p => {
                const opt = document.createElement('option');
                opt.value       = p.id;
                opt.textContent = p.projectName || p.header?.projectName || p.header?.subject || p.id;
                sel.appendChild(opt);
            });
        }
    };

    window.cpCloseCreateModal = function () {
        const modal = document.getElementById('cpCreateModal');
        if (modal) modal.style.display = 'none';
    };

    window.cpSubmitCreateClient = async function () {
        ['err-cp-firstname','err-cp-lastname','err-cp-email',
         'err-cp-password','err-cp-confirm','cp-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        const firstName = (document.getElementById('cp-create-firstname')?.value || '').trim();
        const lastName  = (document.getElementById('cp-create-lastname')?.value  || '').trim();
        const email     = (document.getElementById('cp-create-email')?.value     || '').trim();
        const password  = (document.getElementById('cp-create-password')?.value  || '');
        const confirm   = (document.getElementById('cp-create-confirm')?.value   || '');
        const projectId = (document.getElementById('cp-create-project')?.value   || '');

        let valid = true;
        function _fe(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = 'block'; } valid = false; }

        if (!firstName)                                          _fe('err-cp-firstname', 'First name is required.');
        if (!lastName)                                           _fe('err-cp-lastname',  'Last name is required.');
        if (!email)                                              _fe('err-cp-email',     'Email is required.');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))     _fe('err-cp-email',     'Enter a valid email address.');
        if (!password)                                           _fe('err-cp-password',  'Password is required.');
        else if (password.length < 8)                            _fe('err-cp-password',  'Minimum 8 characters.');
        if (!confirm)                                            _fe('err-cp-confirm',   'Please confirm the password.');
        else if (confirm !== password)                           _fe('err-cp-confirm',   'Passwords don\'t match.');
        if (!valid) return;

        const btn = document.getElementById('cp-create-submit-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<div class="un-loading-spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;display:inline-block;"></div>Creating…'; }

        try {
            // Edge Function creates the auth user (reusing the uid if the email already
            // exists) and upserts the client profile. Admin session intact.
            const { uid } = await adminCreateUser({
                email, password, kind: 'client', role: 'client',
                firstName, lastName, displayName: firstName + ' ' + lastName,
            });

            if (projectId) {
                await db.collection('boqDocuments').doc(projectId).update({ clientEmail: email });
                const proj = _boqProjects.find(p => p.id === projectId);
                if (proj) proj.clientEmail = email;
            }

            const linkedProject = _boqProjects.find(p => p.id === projectId);
            const linkedName = linkedProject
                ? (linkedProject.projectName || linkedProject.header?.projectName || linkedProject.header?.subject || '')
                : '';
            _allPortalClients.unshift({
                uid, firstName, lastName,
                name     : firstName + ' ' + lastName,
                email,
                status   : 'active',
                createdAt: new Date(),
                projects : linkedName ? [linkedName] : []
            });
            _renderPortalStats(_allPortalClients);
            _renderPortalTable(_allPortalClients);

            cpCloseCreateModal();
            _showSuccessBanner('Account created for ' + firstName + ' ' + lastName + '. They can now log in to the Client Portal.');
        } catch (err) {
            console.error('cpSubmitCreateClient:', err);
            let msg = 'Something went wrong. Please try again.';
            if (/weak|password too/i.test(err.message || '')) {
                msg = 'Password is too weak. Use at least 8 characters.';
            } else if (/invalid.*email/i.test(err.message || '')) {
                msg = 'The email address is not valid.';
            } else if (err.message) {
                msg = err.message;
            }
            const errEl = document.getElementById('cp-create-general-err');
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="user-plus" style="width:14px;height:14px;"></i> Create Account';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }
    };

    function _showPortalLoading(on) {
        const loading = document.getElementById('cpLoadingState');
        const table   = document.getElementById('cpTable');
        const empty   = document.getElementById('cpEmptyState');
        if (on) {
            if (loading) { loading.style.display = 'flex'; loading.innerHTML = '<div class="un-loading-spinner"></div><span>Loading client portal accounts…</span>'; }
            if (table)   table.style.display = 'none';
            if (empty)   empty.style.display = 'none';
        } else {
            if (loading) loading.style.display = 'none';
        }
    }

    // ════════════════════════════════════════════════════════
    // ERROR / WARNING STATES
    // ════════════════════════════════════════════════════════

    function _showPermissionError() {
        const wrap = document.getElementById('unLoadingState');
        if (!wrap) return;
        wrap.style.display = 'flex';
        wrap.innerHTML = `
            <div style="text-align:center;max-width:480px;">
                <div style="font-size:32px;margin-bottom:10px;">🔒</div>
                <p style="font-weight:700;color:#b91c1c;font-size:15px;margin-bottom:6px;">Firestore Permission Denied</p>
                <p style="color:#6b7280;font-size:13px;line-height:1.6;">
                    Your Firestore security rules do not allow listing the
                    <code style="background:#f3f4f6;padding:1px 5px;border-radius:4px;">users</code> and
                    <code style="background:#f3f4f6;padding:1px 5px;border-radius:4px;">clientUsers</code> collections.<br><br>
                    Go to <b>Firebase Console → Firestore → Rules</b> and add the rules shown below.
                </p>
                <pre style="background:#1e1e2e;color:#a6e3a1;padding:14px 16px;border-radius:10px;font-size:11.5px;text-align:left;margin-top:12px;overflow-x:auto;line-height:1.7;">match /users/{uid} {
  allow read: if request.auth != null;
}
match /clientUsers/{uid} {
  allow read: if request.auth != null;
}</pre>
            </div>`;
    }

    function _showPartialWarning(msg) {
        const wrap = document.getElementById('unTableWrap') || document.querySelector('.un-table-wrap');
        if (!wrap) return;
        const el = document.createElement('div');
        el.style.cssText = 'padding:10px 18px;background:#fef9c3;border-bottom:1px solid #fde047;font-size:12.5px;color:#854d0e;display:flex;align-items:center;gap:8px;';
        el.innerHTML = `⚠️ ${msg}`;
        wrap.prepend(el);
    }

    // ════════════════════════════════════════════════════════
    // HELPERS
    // ════════════════════════════════════════════════════════

    function _showLoading(on) {
        const loading = document.getElementById('unLoadingState');
        const table   = document.getElementById('unTable');
        const empty   = document.getElementById('unEmptyState');
        if (on) {
            if (loading) { loading.style.display = 'flex'; loading.innerHTML = '<div class="un-loading-spinner"></div><span>Loading users…</span>'; }
            if (table)   table.style.display = 'none';
            if (empty)   empty.style.display = 'none';
        } else {
            if (loading) loading.style.display = 'none';
        }
    }

    function _showConLoading(on) {
        const loading = document.getElementById('ccLoadingState');
        const table   = document.getElementById('ccTable');
        const empty   = document.getElementById('ccEmptyState');
        if (on) {
            if (loading) { loading.style.display = 'flex'; loading.innerHTML = '<div class="un-loading-spinner"></div><span>Loading client management…</span>'; }
            if (table)   table.style.display = 'none';
            if (empty)   empty.style.display = 'none';
        } else {
            if (loading) loading.style.display = 'none';
        }
    }

    function _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function _tsToMs(ts) {
        if (!ts) return 0;
        if (typeof ts.toDate === 'function') return ts.toDate().getTime();
        if (ts instanceof Date) return ts.getTime();
        if (typeof ts === 'number') return ts;
        return new Date(ts).getTime() || 0;
    }

    function _nameFromEmail(email) {
        if (!email) return 'Unknown';
        return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function _esc(str) {
        return String(str || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function _typeBadge(type) {
        return type === 'client'
            ? `<span class="un-type-badge un-type-client">Client</span>`
            : `<span class="un-type-badge un-type-admin">Admin</span>`;
    }

    function _roleLabel(role) {
        const map = { owner:'Owner', staff:'Staff', worker:'Worker',
                      teamLeader:'Team Leader', engineer:'Engineer', client:'Client' };
        return map[role] || (role ? role.charAt(0).toUpperCase() + role.slice(1) : 'User');
    }

    function _roleClass(role) {
        const map = { owner:'un-role-owner', staff:'un-role-staff', worker:'un-role-worker',
                      teamLeader:'un-role-teamleader', engineer:'un-role-engineer', client:'un-role-client' };
        return map[role] || 'un-role-default';
    }

    function _statusBadge(status) {
        return status === 'inactive'
            ? `<span class="un-status-badge un-status-inactive"><span class="un-status-dot"></span>Inactive</span>`
            : `<span class="un-status-badge un-status-active"><span class="un-status-dot"></span>Active</span>`;
    }

    function _formatDate(ts) {
        const ms = _tsToMs(ts);
        if (!ms) return '—';
        return new Date(ms).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    }

    // ── New-user badge ────────────────────────────────────────
    const _SEEN_KEY = 'dacs_users_last_seen';

    function _syncUsersBadgeUI(count) {
        const child = document.getElementById('users-child-badge');
        const group = document.getElementById('users-group-badge');
        [child, group].forEach(el => {
            if (!el) return;
            if (count > 0) { el.textContent = count; el.style.display = 'inline-flex'; }
            else { el.style.display = 'none'; }
        });
    }

    function _clearNewUserBadge() {
        localStorage.setItem(_SEEN_KEY, Date.now().toString());
        _syncUsersBadgeUI(0);
    }

    window.syncNewUsersBadgeEager = function () {
        const lastSeen = parseInt(localStorage.getItem(_SEEN_KEY) || '0', 10);
        Promise.all([
            db.collection('users').get(),
            db.collection('clientUsers').get()
        ]).then(([adminSnap, clientSnap]) => {
            const allDocs = [...adminSnap.docs, ...clientSnap.docs];
            const count = allDocs.filter(d => _tsToMs(d.data().createdAt) > lastSeen).length;
            _syncUsersBadgeUI(count);
        }).catch(() => {});
    };

})();
