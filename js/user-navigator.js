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
                    createdAt: d.createdAt || null,
                    agreementAccepted  : d.agreementAccepted === true,
                    agreementAcceptedAt: d.agreementAcceptedAt || null,
                    agreementSignature : d.agreementSignature || ''
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
                <div style="display:flex;flex-direction:column;">
                    <span class="un-user-name">${_esc(name)}</span>
                    <span class="un-role-badge ${_roleClass(user.role)}" style="margin-top:3px;align-self:flex-start;">${_roleLabel(user.role)}</span>
                </div>
            </div></td>
            <td style="color:#6b7280;font-size:13px;">${_esc(user.email)}</td>
            <td style="color:#6b7280;font-size:13px;">${_formatDate(user.createdAt)}</td>
            <td><div style="display:flex;flex-direction:column;align-items:flex-start;">${_statusBadge(user.status)}${_empAgreementBadge(user)}</div></td>
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

    // ── Employee Terms & Conditions ───────────────────────────

    const EMP_TERMS_DEFAULT =
`EMPLOYMENT TERMS & CONDITIONS

1. Employment. This account grants access to DaCs Company systems for the purpose of performing your assigned duties. Access is granted based on your role and may be changed or revoked at any time.

2. Confidentiality. You agree to keep all company, client, and project information confidential and to use it only for authorized work purposes.

3. Acceptable Use. You agree to use company systems responsibly, to protect your login credentials, and not to share your account with anyone.

4. Conduct. You agree to follow all company policies, applicable laws, and to act honestly and professionally in your work.

5. Company Property. All work products, data, and materials created in the course of your employment remain the property of DaCs Company.

6. Termination. Your access may be suspended or terminated upon the end of your employment or a violation of these terms.

By agreeing, you confirm that you have read, understood, and accept these Terms & Conditions.`;

    // Cached settings/employeeTerms doc: { text, pdfUrl, pdfName }.
    let _empTermsDoc  = null;   // full settings blob
    let _empTermsCache = null;  // text only (back-compat for the Add Employee preview)

    async function _loadEmployeeTermsDoc() {
        if (_empTermsDoc !== null) return _empTermsDoc;
        try {
            const doc = await db.collection('settings').doc('employeeTerms').get();
            const data = doc && doc.exists ? doc.data() : null;
            _empTermsDoc = {
                text  : (data && typeof data.text === 'string' && data.text.trim()) ? data.text : EMP_TERMS_DEFAULT,
                pdfUrl : (data && data.pdfUrl)  || '',
                pdfName: (data && data.pdfName) || ''
            };
        } catch (err) {
            console.error('_loadEmployeeTermsDoc:', err);
            _empTermsDoc = { text: EMP_TERMS_DEFAULT, pdfUrl: '', pdfName: '' };
        }
        _empTermsCache = _empTermsDoc.text;
        return _empTermsDoc;
    }

    async function _loadEmployeeTerms() {
        return (await _loadEmployeeTermsDoc()).text;
    }

    // Global Terms PDF picker state (for the editor modal).
    let _empGlobalPdfFile = null;   // newly-picked file
    let _empGlobalPdfUrl  = '';     // existing url
    let _empGlobalPdfName = '';     // existing name

    function _empRenderGlobalPdfState() {
        const nameEl = document.getElementById('emp-terms-pdf-name');
        const rmEl   = document.getElementById('emp-terms-pdf-remove');
        if (!nameEl) return;
        if (_empGlobalPdfFile) {
            nameEl.textContent = _empGlobalPdfFile.name + ' (new — will upload on save)';
            nameEl.style.color = '#111827';
            if (rmEl) rmEl.style.display = '';
        } else if (_empGlobalPdfUrl) {
            nameEl.textContent = _empGlobalPdfName || 'Attached PDF';
            nameEl.style.color = '#111827';
            if (rmEl) rmEl.style.display = '';
        } else {
            nameEl.textContent = 'No PDF attached.';
            nameEl.style.color = '#6b7280';
            if (rmEl) rmEl.style.display = 'none';
        }
    }

    window.unOnGlobalTermsPdfPick = function (input) {
        const f = input && input.files && input.files[0];
        if (!f) return;
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { alert('Please choose a PDF file.'); input.value = ''; return; }
        _empGlobalPdfFile = f;
        _empRenderGlobalPdfState();
    };

    window.unRemoveGlobalTermsPdf = function () {
        _empGlobalPdfFile = null;
        _empGlobalPdfUrl  = '';
        _empGlobalPdfName = '';
        const input = document.getElementById('emp-terms-pdf-input');
        if (input) input.value = '';
        _empRenderGlobalPdfState();
    };

    window.unOpenEmployeeTermsModal = async function () {
        const modal = document.getElementById('unEmployeeTermsModal');
        if (!modal) return;
        const errEl = document.getElementById('emp-terms-editor-err');
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        const editor = document.getElementById('emp-terms-editor');
        if (editor) { editor.value = 'Loading…'; editor.disabled = true; }
        _empGlobalPdfFile = null;
        const _pi = document.getElementById('emp-terms-pdf-input'); if (_pi) _pi.value = '';
        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        const doc = await _loadEmployeeTermsDoc();
        if (editor) { editor.value = doc.text; editor.disabled = false; }
        _empGlobalPdfUrl  = doc.pdfUrl;
        _empGlobalPdfName = doc.pdfName;
        _empRenderGlobalPdfState();
    };

    window.unCloseEmployeeTermsModal = function () {
        const modal = document.getElementById('unEmployeeTermsModal');
        if (modal) modal.style.display = 'none';
    };

    window.unSaveEmployeeTerms = async function () {
        const editor = document.getElementById('emp-terms-editor');
        const errEl  = document.getElementById('emp-terms-editor-err');
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        const text = (editor?.value || '').trim();
        if (!text) {
            if (errEl) { errEl.textContent = 'The terms text cannot be empty.'; errEl.style.display = 'block'; }
            return;
        }
        const btn = document.getElementById('emp-terms-save-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<div class="un-loading-spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px;display:inline-block;"></div>Saving…'; }
        try {
            // Resolve the PDF: upload a new one, keep the existing url, or clear it.
            let pdfUrl = _empGlobalPdfUrl, pdfName = _empGlobalPdfName;
            if (_empGlobalPdfFile) {
                const safe = String(_empGlobalPdfFile.name || 'terms.pdf').replace(/[^\w.\-]+/g, '_');
                const ref  = storage.ref(`employeeTermsGlobal/${Date.now()}_${safe}`);
                await ref.put(_empGlobalPdfFile);
                pdfUrl  = await ref.getDownloadURL();
                pdfName = _empGlobalPdfFile.name || 'Terms & Conditions.pdf';
            }
            // settings is a kv table — .set() overwrites the whole value, so write all fields.
            await db.collection('settings').doc('employeeTerms').set({
                text,
                pdfUrl : pdfUrl || '',
                pdfName: pdfName || '',
                updatedAt: new Date().toISOString()
            });
            _empTermsDoc = { text, pdfUrl: pdfUrl || '', pdfName: pdfName || '' };
            _empTermsCache = text;
            unCloseEmployeeTermsModal();
            _showSuccessBanner('Employee Terms & Conditions saved.');
        } catch (err) {
            console.error('unSaveEmployeeTerms:', err);
            if (errEl) { errEl.textContent = 'Could not save. Please try again.'; errEl.style.display = 'block'; }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save Terms';
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        }
    };

    // ── Global Terms & Conditions editor (Client Management + Client Portal) ──
    // One document per audience: text fallback + optional global PDF. Stored in
    // a settings/{key} doc. Reused by both tabs via a small config map.
    const GLOBAL_TERMS_CFG = {
        cc: { settingsKey: 'constructionClientTerms', folder: 'constructionClientTermsGlobal', title: 'Client Management Terms & Conditions', sub: 'Applies to all construction clients' },
        cp: { settingsKey: 'clientPortalTerms',       folder: 'clientPortalTermsGlobal',       title: 'Client Portal Terms & Conditions',      sub: 'Applies to all client-portal accounts' }
    };
    let _gtFile = null, _gtUrl = '', _gtName = '', _gtKind = null;

    function _gtRenderState() {
        const nameEl = document.getElementById('gt-pdf-name');
        const rmEl   = document.getElementById('gt-pdf-remove');
        if (!nameEl) return;
        if (_gtFile)      { nameEl.textContent = _gtFile.name + ' (new — will upload on save)'; nameEl.style.color = '#111827'; if (rmEl) rmEl.style.display = ''; }
        else if (_gtUrl)  { nameEl.textContent = _gtName || 'Attached PDF'; nameEl.style.color = '#111827'; if (rmEl) rmEl.style.display = ''; }
        else              { nameEl.textContent = 'No PDF attached.'; nameEl.style.color = '#6b7280'; if (rmEl) rmEl.style.display = 'none'; }
    }

    window.unGtPickPdf = function (input) {
        const f = input && input.files && input.files[0];
        if (!f) return;
        if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { alert('Please choose a PDF file.'); input.value = ''; return; }
        _gtFile = f; _gtRenderState();
    };
    window.unGtRemovePdf = function () {
        _gtFile = null; _gtUrl = ''; _gtName = '';
        const input = document.getElementById('gt-pdf-input'); if (input) input.value = '';
        _gtRenderState();
    };

    window.unOpenGlobalTerms = async function (kind) {
        const cfg = GLOBAL_TERMS_CFG[kind];
        if (!cfg) return;
        _gtKind = kind; _gtFile = null; _gtUrl = ''; _gtName = '';

        let modal = document.getElementById('unGlobalTermsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'unGlobalTermsModal';
            modal.className = 'un-modal-overlay';
            modal.style.display = 'none';
            modal.onclick = (e) => { if (e.target === modal) unCloseGlobalTerms(); };
            document.body.appendChild(modal);
        }
        modal.innerHTML =
          '<div class="un-modal-card" style="max-width:640px;width:94%;">'
          + '<div class="un-modal-header"><div class="un-modal-avatar" style="background:#7c3aed;color:#fff;"><i data-lucide="file-text" style="width:18px;height:18px;"></i></div>'
          +   '<div class="un-modal-title-block"><h3>' + _esc(cfg.title) + '</h3><span class="un-role-badge un-role-staff">' + _esc(cfg.sub) + '</span></div>'
          +   '<button class="un-modal-close" aria-label="Close" onclick="unCloseGlobalTerms()"><i data-lucide="x"></i></button></div>'
          + '<div class="un-modal-body" style="padding:20px 24px 24px;">'
          +   '<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px;">Terms &amp; Conditions PDF <span style="color:#9ca3af;font-weight:400;">(one document for everyone)</span></label>'
          +   '<input type="file" id="gt-pdf-input" accept="application/pdf,.pdf" onchange="unGtPickPdf(this)" style="display:none;">'
          +   '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">'
          +     '<button type="button" onclick="document.getElementById(\'gt-pdf-input\').click()" style="display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border:1.5px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;"><i data-lucide="upload" style="width:15px;height:15px;"></i> Upload PDF</button>'
          +     '<span id="gt-pdf-name" style="font-size:12.5px;color:#6b7280;">No PDF attached.</span>'
          +     '<button type="button" id="gt-pdf-remove" onclick="unGtRemovePdf()" style="display:none;font-size:12px;font-weight:600;color:#dc2626;background:none;border:none;cursor:pointer;font-family:inherit;">Remove</button>'
          +   '</div>'
          +   '<div style="font-size:11.5px;color:#9ca3af;margin-bottom:18px;">If a PDF is attached, every ' + (kind === 'cc' ? 'construction client' : 'client') + ' must open it and e-sign on their next login before entering. Leave blank to use the text below.</div>'
          +   '<label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:5px;">Terms &amp; Conditions text <span style="color:#9ca3af;font-weight:400;">(used when no PDF is attached)</span></label>'
          +   '<textarea id="gt-editor" rows="10" placeholder="Write the Terms &amp; Conditions everyone must agree to." style="width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;outline:none;font-family:inherit;line-height:1.6;resize:vertical;min-height:160px;">Loading…</textarea>'
          +   '<div id="gt-err" style="display:none;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;font-size:13px;margin-top:14px;"></div>'
          +   '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">'
          +     '<button onclick="unCloseGlobalTerms()" style="padding:9px 20px;border-radius:8px;border:1.5px solid #d1d5db;background:#fff;color:#374151;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
          +     '<button id="gt-save" onclick="unSaveGlobalTerms()" style="padding:9px 20px;border-radius:8px;border:none;background:#7c3aed;color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;"><i data-lucide="save" style="width:14px;height:14px;"></i> Save</button>'
          +   '</div>'
          + '</div></div>';
        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();

        try {
            const doc  = await db.collection('settings').doc(cfg.settingsKey).get();
            const data = doc && doc.exists ? doc.data() : null;
            const editor = document.getElementById('gt-editor');
            if (editor) editor.value = (data && data.text) || '';
            _gtUrl  = (data && data.pdfUrl)  || '';
            _gtName = (data && data.pdfName) || '';
        } catch (e) { const editor = document.getElementById('gt-editor'); if (editor) editor.value = ''; }
        _gtRenderState();
    };

    window.unCloseGlobalTerms = function () {
        const modal = document.getElementById('unGlobalTermsModal');
        if (modal) modal.style.display = 'none';
        _gtFile = null; _gtKind = null;
    };

    window.unSaveGlobalTerms = async function () {
        const cfg = GLOBAL_TERMS_CFG[_gtKind];
        if (!cfg) return;
        const editor = document.getElementById('gt-editor');
        const errEl  = document.getElementById('gt-err');
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        const text = (editor?.value || '').trim();
        const btn = document.getElementById('gt-save');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        try {
            let pdfUrl = _gtUrl, pdfName = _gtName;
            if (_gtFile) {
                if (btn) btn.textContent = 'Uploading…';
                const safe = String(_gtFile.name || 'terms.pdf').replace(/[^\w.\-]+/g, '_');
                const ref  = storage.ref(cfg.folder + '/' + Date.now() + '_' + safe);
                await ref.put(_gtFile);
                pdfUrl  = await ref.getDownloadURL();
                pdfName = _gtFile.name || 'Terms & Conditions.pdf';
            }
            await db.collection('settings').doc(cfg.settingsKey).set({
                text, pdfUrl: pdfUrl || '', pdfName: pdfName || '', updatedAt: new Date().toISOString()
            });
            unCloseGlobalTerms();
            _showSuccessBanner('Terms & Conditions saved.');
        } catch (err) {
            console.error('unSaveGlobalTerms:', err);
            if (errEl) { errEl.textContent = 'Could not save: ' + (err.message || err); errEl.style.display = 'block'; }
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Save'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
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
         'err-emp-password','err-emp-confirm','err-emp-terms','emp-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });
        const agreeEl = document.getElementById('emp-create-terms-agree');
        if (agreeEl) agreeEl.checked = false;
        const termsBox = document.getElementById('emp-create-terms-box');
        if (termsBox) {
            termsBox.textContent = 'Loading terms…';
            _loadEmployeeTerms().then(text => { termsBox.textContent = text; });
        }

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
         'err-emp-password','err-emp-confirm','err-emp-terms','emp-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });

        const firstName = (document.getElementById('emp-create-firstname')?.value || '').trim();
        const lastName  = (document.getElementById('emp-create-lastname')?.value  || '').trim();
        // Lowercase the email so it matches what the auth system stores (login
        // returns a lowercased email); avoids case-mismatch lookups later.
        const email     = (document.getElementById('emp-create-email')?.value     || '').trim().toLowerCase();
        const role      = (document.getElementById('emp-create-role')?.value      || '');
        const password  = (document.getElementById('emp-create-password')?.value  || '');
        const confirm   = (document.getElementById('emp-create-confirm')?.value   || '');
        const termsAgreed = !!document.getElementById('emp-create-terms-agree')?.checked;

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
        // Terms are now OPTIONAL at creation: if the admin ticks the box the
        // employee is pre-signed; otherwise the account starts "Pending" and the
        // employee signs the agreement themselves on first login.
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

            // Seed the agreement state. If the admin ticked the box the employee is
            // pre-signed; otherwise the account starts "Pending" and the employee
            // signs on their first login to the admin portal.
            const acceptedAt = new Date();
            const termsText  = await _loadEmployeeTerms();
            try {
                if (termsAgreed) {
                    await db.collection('users').doc(uid).update({
                        agreementAccepted   : true,
                        agreementAcceptedAt : acceptedAt,
                        agreementSignature  : firstName + ' ' + lastName,
                        termsSnapshot       : termsText
                    });
                } else {
                    await db.collection('users').doc(uid).update({
                        agreementAccepted   : false,
                        agreementAcceptedAt : null,
                        termsSnapshot       : termsText
                    });
                }
            } catch (termsErr) {
                console.error('seed employee agreement:', termsErr);
            }

            // Add to local state and refresh table
            const newUser = {
                uid,
                _type    : 'admin',
                name     : firstName + ' ' + lastName,
                email,
                role,
                status   : 'active',
                createdAt: new Date(),
                agreementAccepted   : !!termsAgreed,
                agreementAcceptedAt : termsAgreed ? acceptedAt : null,
                agreementSignature  : termsAgreed ? (firstName + ' ' + lastName) : ''
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
                if (p.clientEmail)  projectByEmail[(p.clientEmail  || '').toLowerCase()] = p.projectName || '';
                if (p.partnerEmail) projectByEmail[(p.partnerEmail || '').toLowerCase()] = p.projectName || '';
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
                    project  : projectByEmail[email] || '',
                    role     : d.role || 'client',
                    isPartner: d.role === 'partner',   // partner accounts use the Dacs Partnership portal
                    agreementAccepted  : d.agreementAccepted === true,
                    agreementAcceptedAt: d.agreementAcceptedAt || null,
                    agreementSignature : d.agreementSignature || '',
                    agreementSignatureImage: d.agreementSignatureImage || '',
                    agreementIp        : d.agreementIp || '',
                    // Partnership agreement (Dacs Partnership portal) — separate document,
                    // signed into partner-prefixed fields (migration 0017).
                    partnerAgreementAccepted  : d.partnerAgreementAccepted === true,
                    partnerAgreementAcceptedAt: d.partnerAgreementAcceptedAt || null,
                    partnerAgreementSignature : d.partnerAgreementSignature || '',
                    partnerAgreementSignatureImage: d.partnerAgreementSignatureImage || '',
                    partnerAgreementIp        : d.partnerAgreementIp || ''
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
        // Redesigned header shows one compact stats line instead of stat cards.
        _setText('cc-stats-line', total + ' client' + (total === 1 ? '' : 's') + ' · ' + active + ' active · ' + (total - active) + ' inactive');
    }

    // Segmented status filter (All / Active / Inactive) — writes the hidden
    // #ccStatusFilter input the existing ccFilterClients() already reads.
    window.ccSetStatusTab = function (v) {
        const hid = document.getElementById('ccStatusFilter');
        if (hid) hid.value = v;
        const wrap = document.getElementById('cc-status-tabs');
        if (wrap) wrap.querySelectorAll('button').forEach(b => {
            const on = b.getAttribute('data-v') === v;
            b.style.background = on ? '#1A5C3A' : 'transparent';
            b.style.color = on ? '#fff' : '#6b7280';
        });
        ccFilterClients();
    };

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

    function _agreementChip(c) {
        // Two separate documents: the client Cost-Plus agreement and the Partnership
        // agreement. Each account tracks the document for ITS portal (by role); a
        // signed chip for the other document still shows if it exists (e.g. an
        // account that was a client before becoming a partner).
        const chips = [];
        const clientSigned = () => {
            const when = c.agreementAcceptedAt ? _formatDate(c.agreementAcceptedAt) : '';
            return `<span title="Signed by ${_esc(c.agreementSignature || c.name || '')}${when ? ' on ' + _esc(when) : ''}" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#15803d;background:#ecfdf3;padding:3px 11px;border-radius:99px;white-space:nowrap;">✓ Signed${when ? ' · ' + _esc(when) : ''}</span>`;
        };
        const partnerSigned = () => {
            const pwhen = c.partnerAgreementAcceptedAt ? _formatDate(c.partnerAgreementAcceptedAt) : '';
            return `<span title="Partnership agreement signed by ${_esc(c.partnerAgreementSignature || c.name || '')}${pwhen ? ' on ' + _esc(pwhen) : ''}" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#5b3f96;background:#efeaf8;padding:3px 11px;border-radius:99px;white-space:nowrap;">✓ Partner${pwhen ? ' · ' + _esc(pwhen) : ''}</span>`;
        };
        const pending = (label) =>
            `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#b45309;background:#fff7e6;padding:3px 11px;border-radius:99px;white-space:nowrap;">${label}</span>`;

        if (c.isPartner) {
            chips.push(c.partnerAgreementAccepted ? partnerSigned() : pending('Partner agreement pending'));
            if (c.agreementAccepted) chips.push(clientSigned());
        } else {
            chips.push(c.agreementAccepted ? clientSigned() : pending('Waiting for signature'));
            if (c.partnerAgreementAccepted) chips.push(partnerSigned());
        }
        return chips.join(' ');
    }

    // Client Management Redesign row: avatar + stacked name/email, combined
    // "Project & agreement" cell (project name + status badges), and a compact
    // View + "More ▾" action pair — the Edit / print / (de)activate actions live
    // in the More dropdown (ccToggleRowMenu) instead of five inline buttons.
    function _buildConRow(c) {
        const name    = c.name || _nameFromEmail(c.email);
        const initial = (name[0] || 'C').toUpperCase();
        const active  = c.status === 'active';
        return `<tr data-uid="${c.uid}">
            <td>
                <div style="display:flex;align-items:center;gap:12px;min-width:0;">
                    <span style="width:38px;height:38px;border-radius:50%;flex-shrink:0;background:#eaf5ee;color:#1A5C3A;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;">${initial}</span>
                    <span style="min-width:0;">
                        <span style="display:block;font-size:15px;font-weight:700;color:#143523;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(name)}</span>
                        <span style="display:block;font-size:13px;color:#8a94a1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(c.email)}</span>
                    </span>
                </div>
            </td>
            <td>
                <div style="font-size:14px;font-weight:600;color:${c.project ? '#143523' : '#a8b0ba'};margin-bottom:5px;">${c.project ? _esc(c.project) : 'No project linked'}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">${_agreementChip(c)}</div>
            </td>
            <td style="color:#6b7280;font-size:13.5px;white-space:nowrap;">${_formatDate(c.createdAt)}</td>
            <td><span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;border-radius:99px;padding:4px 12px;background:${active ? '#ecfdf3' : '#f3f4f6'};color:${active ? '#15803d' : '#6b7280'};">${active ? 'Active' : 'Inactive'}</span></td>
            <td>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button onclick="ccViewProfile('${c.uid}')" style="padding:9px 16px;border:1.5px solid #d6dcd7;border-radius:10px;background:#fff;color:#143523;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit;">View</button>
                    <button id="cc-more-${c.uid}" onclick="ccToggleRowMenu('${c.uid}', event)" style="display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:10px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:600;border:1.5px solid #d6dcd7;background:#fff;color:#143523;">
                        More <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }

    // "More ▾" dropdown — one shared fixed-position popup (so the table's
    // overflow can never clip it), rebuilt per row on open.
    let _ccRowMenuUid = null;
    window.ccToggleRowMenu = function (uid, ev) {
        if (ev) ev.stopPropagation();
        if (_ccRowMenuUid === uid) { window.ccCloseRowMenu(); return; }
        const c = _allConClients.find(x => x.uid === uid);
        const btn = document.getElementById('cc-more-' + uid);
        if (!c || !btn) return;
        _ccRowMenuUid = uid;
        let menu = document.getElementById('ccRowMenu');
        if (!menu) {
            menu = document.createElement('div');
            menu.id = 'ccRowMenu';
            document.body.appendChild(menu);
            document.addEventListener('click', function () { window.ccCloseRowMenu(); });
        }
        const item = (label, onclick, danger) =>
            '<button type="button" onclick="' + onclick + '" style="text-align:left;padding:10px 13px;border:none;border-radius:8px;background:transparent;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:' + (danger ? '#b91c1c' : '#374151') + ';" onmouseover="this.style.background=\'#f3f5f3\'" onmouseout="this.style.background=\'transparent\'">' + label + '</button>';
        menu.innerHTML = [
            item('Edit account', "ccOpenEditModal('" + uid + "')"),
            (c.agreementAccepted ? item('Print agreement (PDF)', "ccViewAgreementPdf('" + uid + "')") : ''),
            ((c.isPartner || c.partnerAgreementAccepted) ? item('Print partner agreement', "ccViewAgreementPdf('" + uid + "', true)") : ''),
            item(c.status === 'active' ? 'Deactivate account' : 'Reactivate account', "ccToggleStatus('" + uid + "','" + c.status + "')", c.status === 'active')
        ].join('');
        menu.style.cssText = 'position:fixed;z-index:10060;background:#fff;border:1px solid #e3e8e4;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,0.16);min-width:210px;padding:6px;display:flex;flex-direction:column;';
        const r = btn.getBoundingClientRect();
        menu.style.left = Math.max(8, r.right - Math.max(210, menu.offsetWidth)) + 'px';
        menu.style.top  = Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 6) + 'px';
    };
    window.ccCloseRowMenu = function () {
        const menu = document.getElementById('ccRowMenu');
        if (menu) menu.style.display = 'none';
        _ccRowMenuUid = null;
    };

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

    // Admin: download a client's signed agreement PDF (self-contained — mirrors
    // the portal's cmDownloadAgreementPdf so both sides produce the same locked doc).
    // Pass partner=true to print the signed PARTNERSHIP agreement (separate document,
    // partner-prefixed fields) instead of the client Cost-Plus one.
    window.ccViewAgreementPdf = function (uid, partner) {
        const c = _allConClients.find(x => x.uid === uid);
        if (!c) return;
        // Partner doc not signed yet → offer an UNSIGNED review copy instead of blocking
        // (signing happens in the Dacs Partnership portal; needs migration 0017 applied).
        const unsigned = partner && !c.partnerAgreementAccepted;
        if (unsigned && !confirm('This account has not signed the Partnership Agreement yet.\n\nPrint an UNSIGNED copy for review?')) return;
        if (!partner && !c.agreementAccepted) { alert('This account has not signed the agreement yet.'); return; }
        if (typeof window.dacsAgreementPdf !== 'function') { alert('Print utility not loaded.'); return; }
        const email = (c.email || '').toLowerCase();
        // One account can own SEVERAL projects (same clientEmail) — never print the
        // first match blindly (it mixed one project's name with another's numbers).
        // With more than one, the admin picks which project in a styled modal.
        const matches = (_conProjects || []).filter(p =>
            (p.clientEmail || '').toLowerCase() === email || (p.partnerEmail || '').toLowerCase() === email);
        if (matches.length > 1) { _ccOpenPrintPicker(c, matches, !!partner, unsigned); return; }
        _ccPrintAgreement(c, matches[0] || {}, !!partner, unsigned);
    };

    function _ccPrintAgreement(c, proj, partner, unsigned) {
        const clientName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || c.email || '—';
        const signature  = unsigned ? '' : ((partner ? c.partnerAgreementSignature : c.agreementSignature) || clientName);
        const atRaw = partner ? c.partnerAgreementAcceptedAt : c.agreementAcceptedAt;
        const at = atRaw ? (atRaw.toDate ? atRaw.toDate() : new Date(atRaw)) : new Date();
        const dateStr = (unsigned || isNaN(at)) ? '' : at.toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
        const dayStr  = (unsigned || isNaN(at)) ? '' : at.toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
        if (partner) {
            // Canonical Partnership document from print-utils.js — identical to what
            // the partner read and signed in the portal's signing stepper.
            window.dacsAgreementPdf({
                ...window.dacsPartnerAgreementDoc(clientName, proj, dayStr),
                subtitle: unsigned ? 'Partner Agreement — UNSIGNED (for review)' : 'Partner Agreement',
                signature,
                signatureImage: unsigned ? '' : (c.partnerAgreementSignatureImage || ''),
                dateStr,
                ip: unsigned ? '' : (c.partnerAgreementIp || '')
            });
            return;
        }
        // Canonical Cost-Plus client document (print-utils.js) — identical to what
        // the client read and signed in the portal modal.
        window.dacsAgreementPdf({
            ...window.dacsClientAgreementDoc(clientName, proj, dayStr),
            signature,
            signatureImage: c.agreementSignatureImage || '',
            dateStr,
            ip: c.agreementIp || ''
        });
    }

    // ── Print-agreement project picker (claude_design "Print Agreement Picker") ──
    // Styled radio-card modal replacing the old native prompt(): pick which of the
    // account's projects the printed agreement covers, then print.
    let _ccPicker = null;   // { c, matches, partner, unsigned, selected }

    function _ccOpenPrintPicker(c, matches, partner, unsigned) {
        _ccPicker = { c, matches, partner, unsigned, selected: 0 };
        let ov = document.getElementById('ccPrintPickerOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'ccPrintPickerOverlay';
            ov.addEventListener('click', function (e) { if (e.target === ov) window.ccPickerCancel(); });
            document.body.appendChild(ov);
        }
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,0.45);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;z-index:10050;';
        _ccRenderPrintPicker();
    }

    function _ccRenderPrintPicker() {
        const ov = document.getElementById('ccPrintPickerOverlay');
        const st = _ccPicker;
        if (!ov || !st) return;
        const name = [st.c.firstName, st.c.lastName].filter(Boolean).join(' ').trim() || st.c.email || 'This account';
        const printIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A5C3A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>';
        const cards = st.matches.map(function (p, i) {
            const sel = i === st.selected;
            const budget = p.budget != null ? '₱' + Number(p.budget).toLocaleString('en-PH') : '';
            return '<button type="button" onclick="ccPickerSelect(' + i + ')" style="display:flex;align-items:center;gap:14px;width:100%;padding:15px 16px;border-radius:13px;cursor:pointer;font-family:inherit;border:1.5px solid ' + (sel ? '#1A5C3A' : '#e3e8e4') + ';background:' + (sel ? '#f4faf6' : '#fff') + ';box-shadow:' + (sel ? '0 0 0 3px rgba(26,92,58,0.10)' : 'none') + ';transition:border-color .15s,background .15s,box-shadow .15s;">'
                + '<span style="width:20px;height:20px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:' + (sel ? 'none' : '2px solid #cdd6cf') + ';background:' + (sel ? '#1A5C3A' : '#fff') + ';">' + (sel ? '<span style="width:8px;height:8px;border-radius:50%;background:#fff;display:block;"></span>' : '') + '</span>'
                + '<span style="flex:1;min-width:0;text-align:left;">'
                + '<span style="display:block;font-size:15px;font-weight:700;color:#143523;">' + _esc(p.projectName || 'Project') + '</span>'
                + '<span style="display:block;font-size:13px;color:#6b7280;margin-top:2px;">' + _esc(p.address || '—') + '</span>'
                + '</span>'
                + (budget ? '<span style="font-size:14px;font-weight:700;color:#1A5C3A;white-space:nowrap;">' + budget + '</span>' : '')
                + '</button>';
        }).join('');
        ov.innerHTML =
            '<div style="background:#fff;border-radius:18px;width:100%;max-width:470px;box-shadow:0 24px 60px rgba(15,23,42,0.28);overflow:hidden;">'
            + '<div style="padding:24px 26px 6px;display:flex;align-items:flex-start;gap:14px;">'
            + '<div style="width:42px;height:42px;border-radius:12px;background:#eaf5ee;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' + printIcon + '</div>'
            + '<div style="flex:1;">'
            + '<div style="font-size:18px;font-weight:700;color:#143523;line-height:1.3;">Print ' + (st.partner ? 'partner ' : '') + 'agreement</div>'
            + '<div style="font-size:14px;color:#6b7280;line-height:1.5;margin-top:3px;">' + _esc(name) + ' has ' + st.matches.length + ' linked projects. Choose which one this agreement covers.</div>'
            + '</div>'
            + '<button type="button" onclick="ccPickerCancel()" aria-label="Close" style="width:32px;height:32px;border-radius:50%;border:none;background:#f3f4f6;color:#6b7280;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
            + '</button></div>'
            + '<div style="padding:16px 26px 4px;display:flex;flex-direction:column;gap:10px;">' + cards + '</div>'
            + '<div style="padding:18px 26px 22px;display:flex;gap:10px;justify-content:flex-end;">'
            + '<button type="button" onclick="ccPickerCancel()" style="padding:12px 20px;border-radius:11px;border:1.5px solid #d6dcd7;background:#fff;color:#374151;font-size:14.5px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'
            + '<button type="button" onclick="ccPickerConfirm()" style="padding:12px 24px;border-radius:11px;border:none;background:#1A5C3A;color:#fff;font-size:14.5px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(26,92,58,0.28);display:inline-flex;align-items:center;gap:8px;">'
            + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>'
            + 'Print agreement</button>'
            + '</div></div>';
    }

    window.ccPickerSelect = function (i) {
        if (_ccPicker) { _ccPicker.selected = i; _ccRenderPrintPicker(); }
    };
    window.ccPickerCancel = function () {
        const ov = document.getElementById('ccPrintPickerOverlay');
        if (ov) ov.style.display = 'none';
        _ccPicker = null;
    };
    window.ccPickerConfirm = function () {
        const st = _ccPicker;
        window.ccPickerCancel();
        if (st) _ccPrintAgreement(st.c, st.matches[st.selected] || {}, st.partner, st.unsigned);
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
        const newRoleSel = document.getElementById('cc-create-role');
        if (newRoleSel) newRoleSel.value = 'client';
        ['err-cc-firstname','err-cc-lastname','err-cc-email',
         'err-cc-password','err-cc-confirm','cc-create-general-err'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.display = 'none'; el.textContent = ''; }
        });
        // Always reopen with passwords hidden + eye icons reset.
        [['cc-create-password','cc-create-password-eye'],
         ['cc-create-confirm','cc-create-confirm-eye']].forEach(([inp, ic]) => {
            const i = document.getElementById(inp), e = document.getElementById(ic);
            if (i) i.type = 'password';
            if (e) e.setAttribute('data-lucide', 'eye');
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
        // Lowercase the email so it matches auth storage and the project's
        // clientEmail link (login returns a lowercased email).
        const email     = (document.getElementById('cc-create-email')?.value     || '').trim().toLowerCase();
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
            const accountRole = (document.getElementById('cc-create-role')?.value === 'partner') ? 'partner' : 'client';
            const { uid } = await adminCreateUser({
                email, password, kind: 'construction_client', role: accountRole,
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
                project  : linkedProject?.projectName || '',
                role     : accountRole,
                isPartner: accountRole === 'partner',
                // New accounts start un-signed → show "Pending agreement" until they sign on first login.
                agreementAccepted  : false,
                agreementAcceptedAt: null,
                agreementSignature : '',
                partnerAgreementAccepted: false
            });
            _renderConStats(_allConClients);
            _renderConTable(_allConClients);

            caCloseCreateModal();
            _showSuccessBanner('Account created for ' + firstName + ' ' + lastName + '. They can now log in to the ' + (accountRole === 'partner' ? 'Dacs Partnership Portal' : 'Client Management Portal') + '.');
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
        const roleSel = document.getElementById('cc-edit-role');
        if (roleSel) roleSel.value = c.isPartner ? 'partner' : 'client';

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
        const accountRole = (document.getElementById('cc-edit-role')?.value === 'partner') ? 'partner' : 'client';

        let valid = true;
        function _fe(id, msg) { const el = document.getElementById(id); if (el) { el.textContent = msg; el.style.display = 'block'; } valid = false; }

        if (!firstName) _fe('err-cc-edit-firstname', 'First name is required.');
        if (!lastName)  _fe('err-cc-edit-lastname',  'Last name is required.');
        if (!valid) return;

        const btn = document.getElementById('cc-edit-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        try {
            await db.collection('constructionClientUsers').doc(uid).update({ firstName, lastName, role: accountRole });

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
            c.role      = accountRole;
            c.isPartner = accountRole === 'partner';

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
                    projects : projectsByEmail[email] || [],
                    agreementAccepted  : d.agreementAccepted === true,
                    agreementAcceptedAt: d.agreementAcceptedAt || null
                };
            }).sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));

            // Does a global client-portal Terms PDF exist? Drives the Signed/Pending badge.
            try {
                const gt = await db.collection('settings').doc('clientPortalTerms').get();
                _cpGlobalHasPdf = !!(gt && gt.exists && gt.data() && gt.data().pdfUrl);
            } catch (_) { _cpGlobalHasPdf = false; }

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
            <td><div style="display:flex;flex-direction:column;align-items:flex-start;">${_statusBadge(c.status)}${_cpTermsBadge(c)}</div></td>
            <td><div class="un-actions">
                ${toggleBtn}
            </div></td>
        </tr>`;
    }

    // Signed/Pending badge — only shown when a GLOBAL client-portal Terms PDF is set.
    let _cpGlobalHasPdf = false;
    function _cpTermsBadge(c) {
        if (!_cpGlobalHasPdf) return '';
        if (c.agreementAccepted) {
            const when = c.agreementAcceptedAt ? _formatDate(c.agreementAcceptedAt) : '';
            return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#15803d;background:#dcfce7;padding:3px 9px;border-radius:20px;white-space:nowrap;margin-top:6px;"><i data-lucide="check-circle" style="width:12px;height:12px;"></i> Signed${when ? ' · ' + _esc(when) : ''}</span>`;
        }
        return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;padding:3px 9px;border-radius:20px;white-space:nowrap;margin-top:6px;"><i data-lucide="clock" style="width:12px;height:12px;"></i> Pending agreement</span>`;
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
        // Lowercase the email so it matches auth storage and the project's
        // clientEmail link (login returns a lowercased email).
        const email     = (document.getElementById('cp-create-email')?.value     || '').trim().toLowerCase();
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

    // Agreement badge for an employee (owners don't sign an agreement → no badge).
    function _empAgreementBadge(user) {
        if (user.role === 'owner') return '';
        if (user.agreementAccepted) {
            const when = user.agreementAcceptedAt ? _formatDate(user.agreementAcceptedAt) : '';
            return `<span title="Signed by ${_esc(user.agreementSignature || user.name || '')}${when ? ' on ' + _esc(when) : ''}" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#15803d;background:#dcfce7;padding:3px 9px;border-radius:20px;white-space:nowrap;margin-top:6px;"><i data-lucide="check-circle" style="width:12px;height:12px;"></i> Signed${when ? ' · ' + _esc(when) : ''}</span>`;
        }
        return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;padding:3px 9px;border-radius:20px;white-space:nowrap;margin-top:6px;"><i data-lucide="clock" style="width:12px;height:12px;"></i> Pending agreement</span>`;
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
