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
                    phone    : d.phone || d.phoneNumber || d.contactNumber || '',
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

    // Deterministic avatar [bg, fg] from a key (PM Clients.dc.html palette).
    function _caAvatar(key) {
        const palette = [
            ['#eaf4ef','#157a52'], ['#eef0f3','#5b6b7e'], ['#f6efe0','#9a6b1f'],
            ['#f2eef5','#7a5b95'], ['#eef3ec','#5b7a4a'], ['#f7eceb','#b4453a'],
        ];
        let h = 0; const s = String(key || '');
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return palette[h % palette.length];
    }

    function _buildRow(c) {
        const name    = c.name || _nameFromEmail(c.email);
        const initial = (name[0] || 'C').toUpperCase();
        const [abg, acol] = _caAvatar(c.uid || c.email || name);
        const avatar  = c.photoURL
            ? `<img src="${_esc(c.photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
            : initial;
        const isActive = c.status === 'active';
        const projectCell = c.projects.length
            ? `<span class="ca-project-tag"><span class="ca-project-dot"></span><span class="ca-project-name">${_esc(c.projects[0])}</span></span>` +
              (c.projects.length > 1 ? `<span class="ca-project-more">+${c.projects.length - 1}</span>` : '')
            : `<span class="ca-no-project">No project</span>`;
        const statusCell = isActive
            ? `<span class="ca-status ca-status-active"><span class="ca-status-dot"></span>Active</span>`
            : `<span class="ca-status ca-status-inactive"><span class="ca-status-dot"></span>Inactive</span>`;

        return `<tr data-uid="${c.uid}">
            <td><div class="ca-user-cell">
                <div class="ca-avatar" style="background:${abg};color:${acol};box-shadow:0 0 0 2px #fff,0 0 0 3px ${acol}40;">${avatar}</div>
                <span class="ca-user-name">${_esc(name)}</span>
            </div></td>
            <td class="ca-email">${_esc(c.email)}</td>
            <td>${projectCell}</td>
            <td class="ca-reg">${_formatDate(c.createdAt)}</td>
            <td>${statusCell}</td>
            <td><div class="ca-actions">
                <button class="ca-icon-btn" title="View profile" onclick="caViewProfile('${c.uid}')">
                    <i data-lucide="eye"></i>
                </button>
                <button class="ca-icon-btn ca-icon-${isActive ? 'danger' : 'ok'}" title="${isActive ? 'Deactivate' : 'Activate'}" onclick="caToggleStatus('${c.uid}','${c.status}')">
                    <i data-lucide="${isActive ? 'power' : 'check'}"></i>
                </button>
            </div></td>
        </tr>`;
    }

    // ── Segmented status filter (All / Active / Inactive) ────
    window.caSetFilter = function (val, btn) {
        const hidden = document.getElementById('caStatusFilter');
        if (hidden) hidden.value = val;
        document.querySelectorAll('#clientAccountsView .ca-seg-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        caFilterClients();
    };

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
        const [abg, acol] = _caAvatar(c.uid || c.email || name);
        const isActive    = c.status === 'active';
        const avatarInner = c.photoURL
            ? `<img src="${_esc(c.photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
            : initial;
        const statusBadge = isActive
            ? `<span class="ca-d-status ca-d-status-active"><span class="ca-status-dot"></span>Active</span>`
            : `<span class="ca-d-status ca-d-status-inactive"><span class="ca-status-dot"></span>Inactive</span>`;
        const projectsHtml = c.projects.length
            ? `<div class="ca-d-projects">${c.projects.map(p => `<div class="ca-d-project"><span class="ca-d-project-dot"></span>${_esc(p)}</div>`).join('')}</div>`
            : `<div class="ca-d-noproject">No project assigned yet</div>`;

        const body = document.getElementById('caProfileBody');
        if (body) body.innerHTML = `
            <div class="ca-d-head">
                <div class="ca-d-avatar" style="background:${abg};color:${acol};">${avatarInner}</div>
                <div class="ca-d-name">${_esc(name)}</div>
                <div class="ca-d-email">${_esc(c.email)}</div>
                <div class="ca-d-statuswrap">${statusBadge}</div>
            </div>
            <div class="ca-d-rows">
                <div class="ca-d-row"><span class="ca-d-label">Phone</span><span class="ca-d-val">${_esc(c.phone || '—')}</span></div>
                <div class="ca-d-row"><span class="ca-d-label">Registered</span><span class="ca-d-val">${_formatDate(c.createdAt)}</span></div>
                <div class="ca-d-projblock">
                    <div class="ca-d-label" style="margin-bottom:9px;">Assigned projects</div>
                    ${projectsHtml}
                </div>
            </div>
            <div class="ca-d-actions">
                <button class="ca-d-toggle ${isActive ? 'ca-d-toggle-off' : 'ca-d-toggle-on'}"
                    onclick="caToggleStatus('${uid}','${c.status}');caCloseProfile();">
                    ${isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button class="ca-d-done" onclick="caCloseProfile()">Done</button>
            </div>`;

        const modal = document.getElementById('caProfileModal');
        if (modal) { modal.style.display = 'flex'; modal.classList.add('ca-drawer-open'); if (typeof lucide !== 'undefined') lucide.createIcons(); }
    };

    window.caCloseProfile = function () {
        const modal = document.getElementById('caProfileModal');
        if (modal) { modal.style.display = 'none'; modal.classList.remove('ca-drawer-open'); }
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
