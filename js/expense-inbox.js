/* ══════════════════════════════════════════════════════════
   Expense Inbox — admin→staff receipt handoff queue (0031)

   Admin shares a payment/receipt picture from the phone share sheet
   (share-capture.html) tagged with project + type; each share becomes a row
   in `expense_inbox`. These panels list the rows so staff can see what still
   needs to be encoded through the normal expense forms, then mark items done.

   Two mount points, one per project system:
     #eiPanelPC — Expenses tab folder detail   (expenseInboxRenderPC(folderId))
     #eiPanelPM — PM Daily Expenses tab        (expenseInboxRenderPM(pmProjectId))

   Deliberately dumb: stores no amounts, writes nothing into expenses /
   payroll / weeklyBills — the receipt image carries the amount and staff
   encodes it through the existing, tested save paths.
══════════════════════════════════════════════════════════ */

'use strict';

(function () {

    // containerId → { sys, targetId, items, filter }
    const _eiState = {};

    const _EI_TYPE_LABELS = {
        pc: { materials: 'Materials', labor: 'Labor', overhead: 'Overhead' },
        pm: { labor: 'Labor', materials: 'Materials', both: 'Out Source' },
    };
    const _EI_TYPE_COLORS = {
        materials: { bg: '#eef1f4', fg: '#44536b' },
        labor:     { bg: '#eaf4ef', fg: '#0f6342' },
        overhead:  { bg: '#fbf3e2', fg: '#8a6310' },
        both:      { bg: '#f0ebf8', fg: '#5b3f8f' },
    };

    function _eiEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _eiDate(ts) {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
             + ' · ' + d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    }

    async function _eiLoad(containerId, sys, targetId) {
        const box = document.getElementById(containerId);
        if (!box || typeof db === 'undefined' || !targetId) return;
        const prev = _eiState[containerId];
        _eiState[containerId] = { sys, targetId, items: [], filter: (prev && prev.targetId === targetId) ? prev.filter : 'pending' };
        try {
            const field = sys === 'pc' ? 'folderId' : 'pmProjectId';
            const snap = await db.collection('expenseInbox')
                .where('system', '==', sys).where(field, '==', targetId).get();
            const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            items.sort((a, b) => {
                const am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
                const bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
                return bm - am;
            });
            _eiState[containerId].items = items;
        } catch (e) {
            console.warn('expense-inbox: load', e.message || e);
            // Surface the failure instead of silently rendering nothing —
            // a hidden panel and a broken panel must not look the same.
            _eiState[containerId].loadError = e.message || String(e);
        }
        _eiRender(containerId);
    }

    function _eiRender(containerId) {
        const box = document.getElementById(containerId);
        const st  = _eiState[containerId];
        if (!box || !st) return;

        if (st.loadError) {
            box.innerHTML = '<div style="background:#f8ecea;border:1px solid #f0cdc8;border-radius:12px;padding:10px 14px;margin-bottom:16px;font:400 12.5px \'IBM Plex Sans\';color:#8f352c;">📥 Expense Inbox could not load: ' + _eiEsc(st.loadError) + '</div>';
            return;
        }

        // No items at all → keep the screen clean, render nothing.
        if (!st.items.length) { box.innerHTML = ''; return; }

        const pending = st.items.filter((i) => i.status !== 'encoded');
        const shown   = st.filter === 'pending' ? pending : st.items;
        const labels  = _EI_TYPE_LABELS[st.sys] || {};

        const chip = (f, label) =>
            '<button onclick="_eiSetFilter(\'' + containerId + '\',\'' + f + '\')" style="border:1px solid '
            + (st.filter === f ? '#0f6342;background:#0f6342;color:#fff' : '#d7d6d0;background:#fff;color:#5b5a55')
            + ';border-radius:99px;padding:4px 12px;font:600 11px \'IBM Plex Sans\';cursor:pointer;">' + label + '</button>';

        const rows = shown.map((it) => {
            const done  = it.status === 'encoded';
            const tCol  = _EI_TYPE_COLORS[it.entryType] || { bg: '#f3f2ef', fg: '#6f6e69' };
            const tLab  = labels[it.entryType] || it.entryType || '—';
            const isPdf = /\.pdf($|\?)/i.test(it.imageName || '') || /\.pdf($|\?)/i.test(it.imageUrl || '');
            const thumb = isPdf
                ? '<div style="width:64px;height:64px;border-radius:9px;border:1px solid #e2e1dc;background:#f3f2ef;display:flex;align-items:center;justify-content:center;font-size:22px;flex:none;">📄</div>'
                : '<img src="' + _eiEsc(it.imageUrl) + '" alt="receipt" loading="lazy" style="width:64px;height:64px;border-radius:9px;border:1px solid #e2e1dc;object-fit:cover;flex:none;">';
            const tags =
                '<span style="background:' + tCol.bg + ';color:' + tCol.fg + ';border-radius:99px;padding:2px 9px;font:700 10px \'IBM Plex Sans\';">' + _eiEsc(tLab) + '</span>'
                + (it.category  ? '<span style="background:#f3f2ef;color:#5b5a55;border-radius:99px;padding:2px 9px;font:600 10px \'IBM Plex Sans\';">' + _eiEsc(it.category) + '</span>' : '')
                + (it.laborName ? '<span style="background:#f3f2ef;color:#5b5a55;border-radius:99px;padding:2px 9px;font:600 10px \'IBM Plex Sans\';">' + _eiEsc(it.laborName) + '</span>' : '');
            const meta = 'from ' + _eiEsc((it.createdBy || '').split('@')[0] || 'admin') + ' · ' + _eiDate(it.createdAt)
                + (done ? ' &nbsp;·&nbsp; <span style="color:#0f6342;font-weight:700;">✓ encoded'
                    + (it.encodedBy ? ' by ' + _eiEsc(it.encodedBy.split('@')[0]) : '')
                    + (it.encodedAt ? ' · ' + _eiDate(it.encodedAt) : '') + '</span>' : '');
            const action = done
                ? '<button onclick="_eiMark(\'' + containerId + '\',\'' + it.id + '\',false)" style="border:1px solid #d7d6d0;background:#fff;color:#8a897f;border-radius:9px;padding:6px 12px;font:600 11px \'IBM Plex Sans\';cursor:pointer;flex:none;">Undo</button>'
                : '<button onclick="_eiMark(\'' + containerId + '\',\'' + it.id + '\',true)" style="border:none;background:#157a52;color:#fff;border-radius:9px;padding:7px 13px;font:700 11px \'IBM Plex Sans\';cursor:pointer;flex:none;">Mark as encoded ✓</button>';

            return '<div style="display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-top:1px solid #efeee9;' + (done ? 'opacity:.62;' : '') + '">'
                + '<a href="' + _eiEsc(it.imageUrl) + '" target="_blank" rel="noopener" style="flex:none;line-height:0;">' + thumb + '</a>'
                + '<div style="flex:1;min-width:0;">'
                +   '<div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;">' + tags + '</div>'
                +   (it.note ? '<div style="font:400 12.5px \'IBM Plex Sans\';color:#3c3b36;margin-top:5px;word-break:break-word;">' + _eiEsc(it.note) + '</div>' : '')
                +   '<div style="font:400 11px \'IBM Plex Sans\';color:#9b9a94;margin-top:4px;">' + meta + '</div>'
                + '</div>'
                + action
                + '</div>';
        }).join('');

        const empty = '<div style="padding:14px 0 4px;font:400 12.5px \'IBM Plex Sans\';color:#8a897f;border-top:1px solid #efeee9;margin-top:2px;">'
            + (st.filter === 'pending' ? 'All caught up — every shared receipt has been encoded. 🎉' : 'Nothing here yet.')
            + '</div>';

        box.innerHTML =
            '<div style="background:#fff;border:1px solid #e2e1dc;border-radius:14px;padding:14px 16px 6px;margin-bottom:16px;">'
            + '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;">'
            +   '<span style="font:800 13.5px \'IBM Plex Sans\';color:#1c1c1a;">📥 Expense Inbox</span>'
            +   (pending.length
                    ? '<span style="background:#b4453a;color:#fff;border-radius:99px;padding:2px 9px;font:800 10.5px \'IBM Plex Sans\';">' + pending.length + ' pending</span>'
                    : '<span style="background:#eaf4ef;color:#0f6342;border-radius:99px;padding:2px 9px;font:800 10.5px \'IBM Plex Sans\';">all encoded</span>')
            +   '<span style="flex:1;"></span>'
            +   chip('pending', 'Pending') + chip('all', 'All (' + st.items.length + ')')
            + '</div>'
            + '<div style="font:400 11.5px \'IBM Plex Sans\';color:#9b9a94;margin:-4px 0 4px;">Receipts shared by admin — open one, encode it below as usual, then mark it ✓.</div>'
            + (shown.length ? rows : empty)
            + '</div>';
    }

    window._eiSetFilter = function (containerId, f) {
        if (_eiState[containerId]) { _eiState[containerId].filter = f; _eiRender(containerId); }
    };

    window._eiMark = async function (containerId, id, done) {
        const st = _eiState[containerId];
        if (!st) return;
        const email = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email) || '';
        try {
            await db.collection('expenseInbox').doc(id).update({
                status:    done ? 'encoded' : 'pending',
                encodedBy: done ? email : null,
                encodedAt: done ? firebase.firestore.FieldValue.serverTimestamp() : null,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            const it = st.items.find((x) => x.id === id);
            if (it) {
                it.status = done ? 'encoded' : 'pending';
                it.encodedBy = done ? email : null;
                it.encodedAt = done ? { toDate: () => new Date(), toMillis: () => Date.now() } : null;
            }
            _eiRender(containerId);
        } catch (e) {
            alert('Could not update the inbox item: ' + (e.message || e));
        }
    };

    // ── Public mount points ──
    window.expenseInboxRenderPC = function (folderId)   { _eiLoad('eiPanelPC', 'pc', folderId); };
    window.expenseInboxRenderPM = function (pmProjectId){ _eiLoad('eiPanelPM', 'pm', pmProjectId); };

})();
