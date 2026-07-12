// ════════════════════════════════════════════════════════════
// SYSTEM ERRORS — owner-only reader for the client_errors table.
// The reporter lives in supabase-config.js §13 (every entry page);
// this panel is where those rows finally get LOOKED AT. RLS already
// hides everything from staff/clients (0028) — the nav/role guards
// in admin.html are just UX on top of that.
// ════════════════════════════════════════════════════════════

let _elRows = [];

function _elEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function initErrorLog() {
    await elRefreshErrors();
}

async function elRefreshErrors() {
    const tbody = document.getElementById('elTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="padding:26px;text-align:center;color:#9ca3af;">Loading…</td></tr>';
    try {
        const snap = await db.collection('clientErrors').orderBy('at', 'desc').limit(200).get();
        _elRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _elRender();
    } catch (err) {
        console.error('elRefreshErrors:', err);
        tbody.innerHTML = '<tr><td colspan="6" style="padding:26px;text-align:center;color:#c0564a;">Could not load errors — ' + _elEsc(err.message) + '</td></tr>';
    }
}

function _elRender() {
    const tbody = document.getElementById('elTableBody');
    const countEl = document.getElementById('elCount');
    if (countEl) countEl.textContent = _elRows.length + (_elRows.length === 200 ? ' (latest 200)' : '') + ' error' + (_elRows.length === 1 ? '' : 's');
    if (!tbody) return;
    if (!_elRows.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:34px;text-align:center;color:#9ca3af;">No errors recorded. Quiet is good.</td></tr>';
        return;
    }
    tbody.innerHTML = _elRows.map(r => {
        const when = r.at && r.at.toDate ? r.at.toDate().toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        const src = r.source ? (r.source.split('/').pop() + (r.line ? ':' + r.line : '')) : '—';
        const who = r.uid ? String(r.uid).slice(0, 8) + '…' : 'anon';
        const stack = r.stack ? `<details style="margin-top:5px;"><summary style="cursor:pointer;font-size:11px;color:#6b7280;">stack</summary><pre style="margin:6px 0 0;padding:8px 10px;background:#f9fafb;border:1px solid #f0efec;border-radius:8px;font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow:auto;">${_elEsc(r.stack)}</pre></details>` : '';
        return `<tr style="border-top:1px solid #f0efec;">
            <td style="padding:11px 14px;white-space:nowrap;color:#6b7280;font-size:12px;">${_elEsc(when)}</td>
            <td style="padding:11px 14px;font-size:12px;color:#6b7280;">${_elEsc(r.page || '—')}</td>
            <td style="padding:11px 14px;"><span style="font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${r.kind === 'unhandledrejection' ? '#7f9cb0' : '#c0564a'};">${r.kind === 'unhandledrejection' ? 'Promise' : 'Error'}</span></td>
            <td style="padding:11px 14px;font-size:13px;max-width:420px;word-break:break-word;">${_elEsc(r.message || '—')}${stack}</td>
            <td style="padding:11px 14px;white-space:nowrap;font-size:12px;color:#6b7280;">${_elEsc(src)}<br><span style="font-size:11px;">${_elEsc(who)}</span></td>
            <td style="padding:11px 14px;text-align:right;">
                <button class="exp-icon-btn exp-icon-btn-danger" onclick="elDeleteError('${_elEsc(r.id)}')" title="Dismiss">
                    <i data-lucide="x" style="width:14px;height:14px;stroke:currentColor;"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.elDeleteError = async function (id) {
    try {
        await db.collection('clientErrors').doc(id).delete();
        _elRows = _elRows.filter(r => String(r.id) !== String(id));
        _elRender();
    } catch (err) { alert('Delete failed: ' + (err.message || err)); }
};

window.elClearErrors = async function () {
    if (!_elRows.length) return;
    if (!confirm('Clear ALL recorded errors? (New ones will keep arriving as they happen.)')) return;
    try {
        // One request via the raw client — the shim has no bulk delete.
        const { error } = await window.sbClient.from('client_errors').delete().gte('id', 0);
        if (error) throw error;
        _elRows = [];
        _elRender();
    } catch (err) { alert('Clear failed: ' + (err.message || err)); }
};
