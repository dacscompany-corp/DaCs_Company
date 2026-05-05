// ════════════════════════════════════════════════════════════
// CLIENT ACCOUNTS MODULE
// Displays and manages design client accounts (clientUsers)
// including their designated projects from boqDocuments.
// Construction clients are managed in user-navigator.js.
// ════════════════════════════════════════════════════════════

(function () {
    'use strict';

    let _allClients = [];
    let _loading    = false;

    // ── Public entry point ───────────────────────────────────
    window.initClientAccounts = function () {
        if (_loading) return;
        _loadClients();
    };

    // ── Load from Firestore ──────────────────────────────────
    async function _loadClients() {
        _loading = true;
        _showLoading(true);

        try {
            const uid = window.currentDataUserId || auth.currentUser?.uid;
            const [clientSnap, boqSnap] = await Promise.all([
                db.collection('clientUsers').get(),
                db.collection('boqDocuments').where('userId', '==', uid).get()
            ]);

            const projectsByEmail = {};
            boqSnap.docs.forEach(doc => {
                const d     = doc.data();
                const email = (d.clientEmail || '').toLowerCase();
                const name  = d.projectName || d.header?.projectName || d.header?.subject || '';
                if (!email || !name) return;
                if (!projectsByEmail[email]) projectsByEmail[email] = [];
                if (!projectsByEmail[email].includes(name)) projectsByEmail[email].push(name);
            });

            _allClients = clientSnap.docs.map(doc => {
                const d     = doc.data();
                const email = (d.email || '').toLowerCase();
                return {
                    uid      : doc.id,
                    name     : ((d.firstName || '') + ' ' + (d.lastName || '')).trim() || null,
                    firstName: d.firstName || '',
                    lastName : d.lastName  || '',
                    email    : d.email     || '',
                    status   : d.status    || 'active',
                    photoURL : d.photoURL  || '',
                    createdAt: d.createdAt || null,
                    projects : projectsByEmail[email] || []
                };
            }).sort((a, b) => _tsToMs(b.createdAt) - _tsToMs(a.createdAt));

            _loading = false;
            _showLoading(false);
            _renderStats(_allClients);
            _renderTable(_allClients);
            _clearNewClientBadge();
        } catch (e) {
            _loading = false;
            _showLoading(false);
            console.error('ClientAccounts: load error', e);
            _showError();
        }
    }

    // ── Stats ────────────────────────────────────────────────
    function _renderStats(clients) {
        const total  = clients.length;
        const active = clients.filter(c => c.status === 'active').length;
        _setText('caTotalCount',    total);
        _setText('caActiveCount',   active);
        _setText('caInactiveCount', total - active);
    }

    // ── Table ────────────────────────────────────────────────
    function _renderTable(clients) {
        const tbody = document.getElementById('caTableBody');
        const table = document.getElementById('caTable');
        const empty = document.getElementById('caEmptyState');
        if (!tbody) return;

        if (!clients.length) {
            if (table) table.style.display = 'none';
            if (empty) empty.style.display = 'flex';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        if (table) table.style.display = 'table';
        if (empty) empty.style.display = 'none';
        tbody.innerHTML = clients.map(_buildRow).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function _buildRow(c) {
        const name    = c.name || _nameFromEmail(c.email);
        const initial = (name[0] || 'C').toUpperCase();
        const avatar  = c.photoURL
            ? `<img src="${_esc(c.photoURL)}" alt="${_esc(initial)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
            : initial;
        const toggleBtn = c.status === 'active'
            ? `<button class="un-btn-toggle un-btn-deactivate" onclick="caToggleStatus('${c.uid}','active')">Deactivate</button>`
            : `<button class="un-btn-toggle un-btn-activate"   onclick="caToggleStatus('${c.uid}','inactive')">Activate</button>`;
        const projectCell = c.projects.length
            ? c.projects.map(p => `<span class="ca-project-tag">${_esc(p)}</span>`).join(' ')
            : `<span style="color:#d1d5db;font-size:12px;">No project assigned</span>`;

        return `<tr data-uid="${c.uid}">
            <td><div class="un-user-cell">
                <div class="un-avatar un-avatar-client">${avatar}</div>
                <span class="un-user-name">${_esc(name)}</span>
            </div></td>
            <td style="color:#6b7280;font-size:13px;">${_esc(c.email)}</td>
            <td>${projectCell}</td>
            <td style="color:#6b7280;font-size:13px;">${_formatDate(c.createdAt)}</td>
            <td>${_statusBadge(c.status)}</td>
            <td><div class="un-actions">
                <button class="un-btn-view" onclick="caViewProfile('${c.uid}')">
                    <i data-lucide="eye" style="width:13px;height:13px;"></i> View
                </button>
                ${toggleBtn}
            </div></td>
        </tr>`;
    }

    // ── Filter ───────────────────────────────────────────────
    window.caFilterClients = function () {
        const q      = (document.getElementById('caSearchInput')?.value  || '').toLowerCase().trim();
        const status = (document.getElementById('caStatusFilter')?.value || '');
        const filtered = _allClients.filter(c => {
            const name     = (c.name || _nameFromEmail(c.email)).toLowerCase();
            const email    = (c.email || '').toLowerCase();
            const projects = c.projects.join(' ').toLowerCase();
            return (!q      || name.includes(q) || email.includes(q) || projects.includes(q))
                && (!status || c.status === status);
        });
        _renderTable(filtered);
    };

    // ── Toggle status ────────────────────────────────────────
    window.caToggleStatus = async function (uid, currentStatus) {
        const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
        try {
            await db.collection('clientUsers').doc(uid).update({ status: newStatus });
            const c = _allClients.find(x => x.uid === uid);
            if (c) c.status = newStatus;
            _renderStats(_allClients);
            caFilterClients();
        } catch (err) {
            console.error('caToggleStatus:', err);
            alert('Could not update account status. Please try again.');
        }
    };

    // ── View Profile Modal ────────────────────────────────────
    window.caViewProfile = function (uid) {
        const c = _allClients.find(x => x.uid === uid);
        if (!c) return;
        const name    = c.name || _nameFromEmail(c.email);
        const initial = (name[0] || 'C').toUpperCase();

        const avatar = document.getElementById('caModalAvatar');
        const nameEl = document.getElementById('caModalName');
        if (avatar) {
            if (c.photoURL) {
                avatar.innerHTML = `<img src="${_esc(c.photoURL)}" alt="${initial}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
            } else {
                avatar.textContent = initial;
            }
        }
        if (nameEl) nameEl.textContent = name;

        const projectsHtml = c.projects.length
            ? c.projects.map(p => `<span class="ca-project-tag">${_esc(p)}</span>`).join(' ')
            : '<span style="color:#9ca3af;font-size:13px;">No project assigned</span>';

        const body = document.getElementById('caProfileBody');
        if (body) body.innerHTML = `
            <div class="un-profile-section">
                <div class="un-profile-section-title">Account Info</div>
                <div class="un-profile-row"><span class="un-profile-label">Full Name</span><span class="un-profile-value">${_esc(name)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">Email</span><span class="un-profile-value">${_esc(c.email)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">Status</span><span class="un-profile-value">${_statusBadge(c.status)}</span></div>
            </div>
            <div class="un-profile-section">
                <div class="un-profile-section-title">Assigned Projects</div>
                <div class="un-profile-row" style="flex-wrap:wrap;gap:6px;">${projectsHtml}</div>
            </div>
            <div class="un-profile-section">
                <div class="un-profile-section-title">Registration</div>
                <div class="un-profile-row"><span class="un-profile-label">Registered</span><span class="un-profile-value">${_formatDate(c.createdAt)}</span></div>
                <div class="un-profile-row"><span class="un-profile-label">User ID</span><span class="un-profile-value" style="font-size:11px;color:#9ca3af;word-break:break-all;">${c.uid}</span></div>
            </div>
            <div class="un-modal-footer" style="padding:0;margin-top:8px;border:none;display:flex;justify-content:flex-end;gap:10px;">
                <button class="un-btn-toggle ${c.status === 'active' ? 'un-btn-deactivate' : 'un-btn-activate'}"
                    onclick="caToggleStatus('${uid}','${c.status}');caCloseProfile();">
                    ${c.status === 'active' ? 'Deactivate Account' : 'Activate Account'}
                </button>
                <button class="un-modal-btn-close" onclick="caCloseProfile()">Close</button>
            </div>`;

        const modal = document.getElementById('caProfileModal');
        if (modal) { modal.style.display = 'flex'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    };

    window.caCloseProfile = function () {
        const modal = document.getElementById('caProfileModal');
        if (modal) modal.style.display = 'none';
    };

    // ── Helpers ───────────────────────────────────────────────
    function _showLoading(on) {
        const loading = document.getElementById('caLoadingState');
        const table   = document.getElementById('caTable');
        const empty   = document.getElementById('caEmptyState');
        if (on) {
            if (loading) { loading.style.display = 'flex'; loading.innerHTML = '<div class="un-loading-spinner"></div><span>Loading clients…</span>'; }
            if (table)   table.style.display = 'none';
            if (empty)   empty.style.display = 'none';
        } else {
            if (loading) loading.style.display = 'none';
        }
    }

    function _showError() {
        const loading = document.getElementById('caLoadingState');
        if (loading) {
            loading.style.display = 'flex';
            loading.innerHTML = `
                <div style="text-align:center;">
                    <div style="font-size:28px;margin-bottom:8px;">&#9888;&#65039;</div>
                    <p style="color:#b91c1c;font-weight:600;margin-bottom:4px;">Could not load client accounts.</p>
                    <p style="color:#6b7280;font-size:13px;">Check your Firestore rules for the <code>clientUsers</code> collection.</p>
                </div>`;
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
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _statusBadge(status) {
        return status === 'inactive'
            ? `<span class="un-status-badge un-status-inactive"><span class="un-status-dot"></span>Inactive</span>`
            : `<span class="un-status-badge un-status-active"><span class="un-status-dot"></span>Active</span>`;
    }

    function _formatDate(ts) {
        const ms = _tsToMs(ts);
        if (!ms) return '—';
        return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // ── New-client badge ──────────────────────────────────────
    const _SEEN_KEY = 'dacs_clients_last_seen';

    function _clearNewClientBadge() {
        localStorage.setItem(_SEEN_KEY, Date.now().toString());
        if (typeof window._newClientsCount !== 'undefined') window._newClientsCount = 0;
        const child = document.getElementById('clients-child-badge');
        if (child) child.style.display = 'none';
        if (typeof window.syncBillingGroupBadge === 'function') window.syncBillingGroupBadge();
    }

    window.syncNewClientsBadgeEager = function () {
        db.collection('clientUsers').get().then(snap => {
            const lastSeen = parseInt(localStorage.getItem(_SEEN_KEY) || '0', 10);
            const count = snap.docs.filter(d => {
                const ts = d.data().createdAt;
                return _tsToMs(ts) > lastSeen;
            }).length;
            if (typeof window._newClientsCount !== 'undefined') window._newClientsCount = count;
            const child = document.getElementById('clients-child-badge');
            if (child) {
                if (count > 0) { child.textContent = count; child.style.display = 'inline-flex'; }
                else { child.style.display = 'none'; }
            }
            if (typeof window.syncBillingGroupBadge === 'function') window.syncBillingGroupBadge();
        }).catch(() => {});
    };

})();
