/* ══════════════════════════════════════════════════════════
   Expense Inbox — admin→staff receipt handoff queue (0031)

   Admin shares a payment/receipt picture from the phone share sheet
   (share-capture.html) tagged with project + type; each share becomes a row
   in `expense_inbox`. These panels list the rows so staff can see what still
   needs to be encoded through the normal expense forms, then mark items done.

   Mount points — receipts are ROUTED to the tab where staff encodes them
   (one fetch per target, rendered into one panel per encode surface):
     PC folder detail (Expenses tab), with pending-count tab badges:
       #eiPanelPCMaterials — Materials tab   (materials + overhead receipts)
       #eiPanelPCPayroll   — Payroll tab     (labor receipts)
     #eiPanelPM     — PM Daily Expenses tab, grouped by type
     #eiPanelPortal — Project Control React portal (ExpenseInboxMount
                      in portal-app.compiled.js) — combined overview

   Deliberately dumb: stores no amounts, writes nothing into expenses /
   payroll / weeklyBills — the receipt image carries the amount and staff
   encodes it through the existing, tested save paths.
══════════════════════════════════════════════════════════ */

'use strict';

(function () {

    // containerId → { sys, targetId, label, groupByType, badgeBtnId, items, filter, expanded, loadError }
    const _eiState = {};

    const _EI_TYPE_LABELS = {
        pc: { materials: 'Materials', labor: 'Labor', overhead: 'Overhead' },
        pm: { labor: 'Labor', materials: 'Materials', both: 'Out Source', overhead: 'Overhead' },
    };
    const _EI_TYPE_COLORS = {
        materials: { bg: '#eef1f4', fg: '#44536b' },
        labor:     { bg: '#eaf4ef', fg: '#0f6342' },
        overhead:  { bg: '#fbf3e2', fg: '#8a6310' },
        both:      { bg: '#f0ebf8', fg: '#5b3f8f' },
    };

    function _eiEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    // Only http(s) URLs (our signed/public uploads links) may reach an href/src.
    // Drops javascript:/data: so a crafted image_url can't execute on click.
    function _eiSafeUrl(u) {
        const s = String(u == null ? '' : u).trim();
        return /^https?:\/\//i.test(s) ? s : '';
    }
    function _eiDate(ts) {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
             + ' · ' + d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    }

    async function _eiFetch(sys, targetId) {
        const field = sys === 'pc' ? 'folderId' : 'pmProjectId';
        const snap = await db.collection('expenseInbox')
            .where('system', '==', sys).where(field, '==', targetId).get();
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => {
            const am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            const bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return bm - am;
        });
        return items;
    }

    // Seed (or refresh) one panel's state from an already-fetched item set,
    // keeping the filter/expanded UI state when it is the same target.
    function _eiApply(containerId, sys, targetId, label, opts, items, loadError) {
        const box = document.getElementById(containerId);
        if (!box) return;
        const prev  = _eiState[containerId];
        const same  = prev && prev.targetId === targetId;
        // opts.types    → keep ONLY these entry types
        // opts.notTypes → keep everything EXCEPT these (catch-all panel, so a
        //                 row with an unknown/missing type can never vanish)
        let list = items;
        if (opts && opts.types)    list = list.filter((i) => opts.types.indexOf(i.entryType) !== -1);
        if (opts && opts.notTypes) list = list.filter((i) => opts.notTypes.indexOf(i.entryType) === -1);
        _eiState[containerId] = {
            sys, targetId,
            label: label || '',
            groupByType: !!(opts && opts.groupByType),
            badgeBtnId: (opts && opts.badgeBtnId) || null,
            items: list,
            filter:   same ? prev.filter   : 'pending',
            expanded: same ? prev.expanded : {},
            // Starts CLOSED. The panel sits on top of the screen staff actually
            // came here to use, so it opens only when asked; the header carries a
            // "to do" count so a closed panel still says whether anything is
            // waiting. Reopening the same project keeps whatever was chosen.
            collapsed: same ? prev.collapsed : true,
            loadError: loadError || null,
        };
        _eiRender(containerId);
        _eiUpdateBadge(containerId);
    }

    // Single-panel path (PM tab, portal dashboard).
    async function _eiLoad(containerId, sys, targetId, label, opts) {
        if (!document.getElementById(containerId) || typeof db === 'undefined' || !targetId) return;
        let items = [], err = null;
        try {
            items = await _eiFetch(sys, targetId);
        } catch (e) {
            console.warn('expense-inbox: load', e.message || e);
            // Surface the failure instead of silently rendering nothing —
            // a hidden panel and a broken panel must not look the same.
            err = e.message || String(e);
        }
        _eiApply(containerId, sys, targetId, label, opts, items, err);
    }

    // Pending-count pill on the tab button the panel routes to.
    function _eiUpdateBadge(containerId) {
        const st = _eiState[containerId];
        if (!st || !st.badgeBtnId) return;
        const btn = document.getElementById(st.badgeBtnId);
        if (!btn) return;
        let b = btn.querySelector('.ei-tab-badge');
        const n = st.items.filter((i) => i.status !== 'encoded').length;
        if (!n) { if (b) b.remove(); return; }
        if (!b) {
            b = document.createElement('span');
            // Same Receipt Mark as the top-nav tabs — this is the same idea on a
            // different tab strip, so it shares the component, not a copy of it.
            b.className = 'ei-tab-badge rm rm-count rm-sm';
            b.style.marginLeft = '6px';
            btn.appendChild(b);
        }
        b.textContent = n;
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
        const total   = st.items.length;
        const done    = total - pending.length;
        const pct     = total ? Math.round(done / total * 100) : 0;

        const seg = (f, label) =>
            '<button onclick="_eiSetFilter(\'' + containerId + '\',\'' + f + '\')" style="flex:1;text-align:center;border:none;border-radius:9px;padding:10px 12px;cursor:pointer;font:700 13px \'IBM Plex Sans\';'
            + (st.filter === f
                ? 'background:#fff;color:#16211c;box-shadow:0 1px 3px rgba(20,40,30,.12);'
                : 'background:transparent;color:#8a938c;')
            + '">' + label + '</button>';

        const open = !st.collapsed;

        // The one thing a closed panel must still answer: is anything waiting?
        // A count when there is, a quiet "all done" when there isn't — so a
        // closed inbox never looks the same as an empty one.
        const todoMark = pending.length
            ? '<span style="background:#fbeceb;color:#b4453a;border-radius:99px;padding:4px 12px;font:700 12.5px \'IBM Plex Sans\';white-space:nowrap;flex:none;">' + pending.length + ' to do</span>'
            : '<span style="color:#157a52;font:700 12.5px \'IBM Plex Sans\';white-space:nowrap;flex:none;">all done 🎉</span>';

        const chevron =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#77857d" stroke-width="2.2" '
            + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" '
            + 'style="flex:none;transition:transform .2s;transform:rotate(' + (open ? '180deg' : '0deg') + ');">'
            + '<polyline points="6 9 12 15 18 9"></polyline></svg>';

        const header =
            '<div role="button" tabindex="0" aria-expanded="' + (open ? 'true' : 'false') + '"'
            + ' onclick="_eiToggleCollapse(\'' + containerId + '\')"'
            + ' onkeydown="_eiKeyToggle(event,\'' + containerId + '\')"'
            + ' title="' + (open ? 'Hide the receipt list' : 'Show the receipt list') + '"'
            + ' style="display:flex;align-items:center;gap:12px;cursor:pointer;">'
            + '<div style="width:42px;height:42px;border-radius:12px;background:#eaf4ef;display:flex;align-items:center;justify-content:center;font-size:21px;flex:none;">📥</div>'
            + '<div style="flex:1;min-width:0;">'
            +   '<div style="font:800 20px \'IBM Plex Sans\';color:#16211c;letter-spacing:-.3px;">Expense Inbox</div>'
            +   '<div style="font:400 13.5px \'IBM Plex Sans\';color:#77857d;margin-top:2px;line-height:1.45;">Receipts your admin sent. Open each one, enter it in the books, then tap the circle to mark it done.</div>'
            + '</div>'
            + todoMark
            + chevron
            + '</div>';

        const progress =
            '<div style="margin-top:20px;background:#f7f6f2;border:1px solid #ecebe4;border-radius:16px;padding:16px 18px;">'
            + '<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">'
            +   '<span style="font:700 15px \'IBM Plex Sans\';color:#16211c;">' + done + ' of ' + total + ' receipts entered</span>'
            +   '<span style="font:700 13px \'IBM Plex Sans\';color:#157a52;">' + (pending.length ? pending.length + ' left to do' : 'all done 🎉') + '</span>'
            + '</div>'
            + '<div style="height:10px;background:#e4e2da;border-radius:99px;overflow:hidden;margin-top:11px;">'
            +   '<div style="width:' + pct + '%;height:100%;background:#157a52;border-radius:99px;transition:width .3s;"></div>'
            + '</div>'
            + '</div>';

        const filterBar =
            '<div style="display:flex;gap:6px;background:#f2f1ec;border:1px solid #ecebe4;border-radius:12px;padding:4px;margin-top:18px;">'
            + seg('pending', 'To do' + (pending.length ? ' (' + pending.length + ')' : ''))
            + seg('all', 'Everything (' + total + ')')
            + '</div>';

        const groupHead = (text, pendCount) =>
            '<div style="display:flex;align-items:center;gap:9px;margin:22px 0 10px;">'
            + '<span style="font:800 12px \'IBM Plex Sans\';letter-spacing:.5px;text-transform:uppercase;color:#5b6a61;">' + _eiEsc(text) + '</span>'
            + '<span style="flex:1;height:1px;background:#ecebe4;"></span>'
            + (pendCount
                ? '<span style="background:#fbeceb;color:#b4453a;border-radius:99px;padding:2px 10px;font:700 11px \'IBM Plex Sans\';">' + pendCount + ' to do</span>'
                : '<span style="background:#eaf4ef;color:#0f6342;border-radius:99px;padding:2px 10px;font:700 11px \'IBM Plex Sans\';">done</span>')
            + '</div>';

        const card = (it) => {
            const isDone = it.status === 'encoded';
            const ex     = !!st.expanded[it.id];
            const tCol   = _EI_TYPE_COLORS[it.entryType] || { bg: '#f3f2ef', fg: '#6f6e69' };
            const tLab   = labels[it.entryType] || it.entryType || '—';
            const imgUrl = _eiEsc(_eiSafeUrl(it.imageUrl));
            const isPdf  = /\.pdf($|\?)/i.test(it.imageName || '') || /\.pdf($|\?)/i.test(it.imageUrl || '');
            const thumb  = isPdf
                ? '<div style="width:86px;height:86px;border-radius:13px;border:1px solid #e2e1dc;background:#f3f2ef;display:flex;align-items:center;justify-content:center;font-size:28px;flex:none;">📄</div>'
                : '<img src="' + imgUrl + '" alt="receipt" loading="lazy" style="width:86px;height:86px;border-radius:13px;border:1px solid #e2e1dc;object-fit:cover;flex:none;">';
            const sender = _eiEsc((it.createdBy || '').split('@')[0] || 'admin');
            const secondLabel = it.laborName ? 'Worker' : 'Category';
            const secondValue = _eiEsc(it.laborName || it.category || '—');
            const statusHtml = isDone
                ? '<span style="color:#0f6342;font-weight:700;">Entered in books ✓'
                    + (it.encodedBy ? ' by ' + _eiEsc(it.encodedBy.split('@')[0]) : '')
                    + (it.encodedAt ? ' · ' + _eiDate(it.encodedAt) : '') + '</span>'
                : '<span style="color:#b4453a;font-weight:700;">Waiting to be entered</span>';
            const doneBtn =
                '<button onclick="_eiMark(\'' + containerId + '\',\'' + it.id + '\',' + (isDone ? 'false' : 'true') + ')" title="' + (isDone ? 'Undo' : 'Mark done') + '" '
                + 'style="width:46px;height:46px;border-radius:50%;flex:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font:700 20px system-ui;'
                + (isDone
                    ? 'border:2px solid #157a52;background:#157a52;color:#fff;'
                    : 'border:2px solid #cdd5cf;background:#fff;color:transparent;')
                + '">✓</button>';

            return '<div style="border:1px solid ' + (ex ? '#cfe0d6' : '#e6e5df') + ';background:' + (isDone ? '#f8faf8' : '#fff') + ';border-radius:16px;padding:14px;transition:border-color .15s;' + (isDone ? 'opacity:.78;' : '') + '">'
                + '<div style="display:flex;gap:14px;align-items:center;">'
                +   '<a href="' + imgUrl + '" target="_blank" rel="noopener" style="flex:none;line-height:0;">' + thumb + '</a>'
                +   '<div onclick="_eiToggleExpand(\'' + containerId + '\',\'' + it.id + '\')" style="flex:1;min-width:0;cursor:pointer;">'
                +     '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">'
                +       '<span style="width:8px;height:8px;border-radius:50%;flex:none;background:' + tCol.fg + ';"></span>'
                +       '<span style="font:700 13px \'IBM Plex Sans\';color:#26322b;">' + _eiEsc(tLab) + '</span>'
                +       '<span style="font:400 12px \'IBM Plex Sans\';color:#a8aaa1;">· ' + _eiDate(it.createdAt) + '</span>'
                +     '</div>'
                +     '<div style="font:500 14.5px \'IBM Plex Sans\';color:#20291f;margin-top:5px;line-height:1.4;word-break:break-word;">' + _eiEsc(it.note || it.imageName || 'Receipt photo') + '</div>'
                +     '<div style="font:400 12px \'IBM Plex Sans\';color:#9b9a94;margin-top:5px;">' + (ex ? 'Tap to hide details' : 'Tap for details') + '</div>'
                +   '</div>'
                +   doneBtn
                + '</div>'
                + '<div style="display:' + (ex ? 'block' : 'none') + ';margin-top:14px;padding-top:14px;border-top:1px solid #eeede7;">'
                +   '<div style="display:grid;grid-template-columns:96px 1fr;gap:8px 14px;font:400 13px \'IBM Plex Sans\';">'
                +     (st.label ? '<span style="color:#9b9a94;">Project</span><span style="color:#3c3b36;font-weight:600;">' + _eiEsc(st.label) + '</span>' : '')
                +     '<span style="color:#9b9a94;">' + secondLabel + '</span><span style="color:#3c3b36;font-weight:600;">' + secondValue + '</span>'
                +     '<span style="color:#9b9a94;">Sent by</span><span style="color:#3c3b36;font-weight:600;">' + sender + '</span>'
                +     '<span style="color:#9b9a94;">Status</span><span>' + statusHtml + '</span>'
                +   '</div>'
                +   '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">'
                +     '<a href="' + imgUrl + '" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:6px;padding:11px 18px;border:1.5px solid #157a52;border-radius:12px;font:700 13px \'IBM Plex Sans\';color:#157a52;text-decoration:none;">Open receipt →</a>'
                +     '<button type="button" onclick="_eiDownload(this,\'' + imgUrl + '\',\'' + _eiEsc(it.imageName || '') + '\')" title="Save this receipt to your device" '
                +       'style="display:inline-flex;align-items:center;gap:7px;padding:11px 18px;border:1.5px solid #cdd5cf;background:#fff;border-radius:12px;font:700 13px \'IBM Plex Sans\';color:#3c3b36;cursor:pointer;">'
                +       '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
                +       'Download</button>'
                +   '</div>'
                + '</div>'
                + '</div>';
        };

        const allCaught =
            '<div style="margin-top:22px;text-align:center;padding:34px 20px;background:#f4f8f5;border:1px dashed #cfe4d8;border-radius:16px;">'
            + '<div style="font-size:34px;">🎉</div>'
            + '<div style="font:700 16px \'IBM Plex Sans\';color:#16211c;margin-top:8px;">All caught up!</div>'
            + '<div style="font:400 13px \'IBM Plex Sans\';color:#77857d;margin-top:4px;">Every receipt your admin sent has been entered.</div>'
            + '</div>';

        let body;
        if (!shown.length) {
            body = allCaught;
        } else if (st.groupByType) {
            // Panel holding several receipt types → one group per type actually
            // present, in the system's canonical order (unknown types last).
            const order = Object.keys(labels);
            const present = [];
            shown.forEach((i) => { const t = i.entryType || ''; if (present.indexOf(t) === -1) present.push(t); });
            present.sort((a, b) => {
                const ai = order.indexOf(a), bi = order.indexOf(b);
                return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
            body = present.map((t) => {
                const g = shown.filter((i) => (i.entryType || '') === t);
                const gPend = st.items.filter((i) => (i.entryType || '') === t && i.status !== 'encoded').length;
                return groupHead(labels[t] || t || 'Other', gPend)
                    + '<div style="display:flex;flex-direction:column;gap:10px;">' + g.map(card).join('') + '</div>';
            }).join('');
        } else {
            // Single group — labelled with the project name when the caller supplied one.
            body = (st.label ? groupHead(st.label, pending.length) : '')
                + '<div style="display:flex;flex-direction:column;gap:10px;' + (st.label ? '' : 'margin-top:18px;') + '">' + shown.map(card).join('') + '</div>';
        }

        // Closed, the card is just the header — tighter padding so it reads as a
        // bar rather than a mostly-empty box.
        box.innerHTML =
            '<div style="background:#fff;border:1px solid #e2e1dc;border-radius:20px;padding:' + (open ? '24px 24px 20px' : '18px 24px') + ';box-shadow:0 12px 34px rgba(20,40,30,.05);margin-bottom:16px;font-family:\'IBM Plex Sans\',sans-serif;">'
            + header + (open ? (progress + filterBar + body) : '')
            + '</div>';
    }

    window._eiToggleCollapse = function (containerId) {
        const st = _eiState[containerId];
        if (!st) return;
        st.collapsed = !st.collapsed;
        _eiRender(containerId);
    };
    // Enter / Space on the header behaves like a click — it is a div acting as a
    // button, so the keyboard behaviour has to be supplied by hand.
    window._eiKeyToggle = function (e, containerId) {
        if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        window._eiToggleCollapse(containerId);
    };

    window._eiSetFilter = function (containerId, f) {
        if (_eiState[containerId]) { _eiState[containerId].filter = f; _eiRender(containerId); }
    };

    window._eiToggleExpand = function (containerId, id) {
        const st = _eiState[containerId];
        if (!st) return;
        st.expanded[id] = !st.expanded[id];
        _eiRender(containerId);
    };

    // Save the receipt instead of opening it. The button reports its own state
    // because the fetch is not instant on a phone connection, and a button that
    // looks inert invites a second tap and a second download.
    window._eiDownload = async function (btn, url, name) {
        if (!url || (btn && btn.disabled)) return;
        const label = btn ? btn.lastChild : null;
        const was = label ? label.textContent : '';
        if (btn) { btn.disabled = true; btn.style.opacity = '.6'; btn.style.cursor = 'wait'; }
        if (label) label.textContent = 'Saving…';
        try {
            if (window.dacsDownloadUpload) await window.dacsDownloadUpload(url, name);
            else window.open(url, '_blank');
        } finally {
            if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.cursor = 'pointer'; }
            if (label) label.textContent = was || 'Download';
        }
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
            _eiUpdateBadge(containerId);
            if (typeof window.eiSyncGlobalBadges === 'function') window.eiSyncGlobalBadges();
        } catch (e) {
            alert('Could not update the inbox item: ' + (e.message || e));
        }
    };

    // ── Global nav badge ──────────────────────────────────────────────
    // Portal-wide "receipts waiting" count so owner/staff know a shared receipt
    // arrived WITHOUT opening a project. One badge per system on its nav group:
    //   Expenses group   (#expenses-group-badge) → pending Project Control receipts
    //   Project Mgmt group (#pm-group-badge)     → pending Project Management receipts
    // The per-tab badges (_eiUpdateBadge) still pinpoint the exact tab.
    // Shared Receipt Mark update: set the number, show/hide, and pulse once
    // when the count has RISEN (a receipt just landed). Styling is the .rm
    // component in css/admin-renovation.css — never inline here.
    function _eiPaintMark(el, count, rose) {
        if (!el) return;
        if (count > 0) {
            el.textContent = count;
            el.hidden = false;
            if (rose) {
                el.classList.remove('rm-new');
                void el.offsetWidth;          // restart the animation
                el.classList.add('rm-new');
            }
        } else {
            el.hidden = true;
            el.classList.remove('rm-new');
        }
    }
    function _eiSetGroupBadge(id, count, rose) {
        _eiPaintMark(document.getElementById(id), count, rose);
    }

    // Latest counts, cached. The primary tabs bar (admin.js _buildTabsBar) is
    // rebuilt on EVERY view switch, which wipes its badges — so it re-applies
    // them from this cache instead of firing another read each time.
    const _eiCounts = { pc: 0, pm: 0 };

    // Primary top-nav tab marks, keyed by PRIMARY_NAV id:
    //   'expenses' → Project Control tab      'pm' → Project Management tab
    function _eiSetTabBadge(primaryId, count, rose) {
        const els = document.querySelectorAll('[data-ptab-badge="' + primaryId + '"]');
        for (let i = 0; i < els.length; i++) {
            els[i].title = count + ' receipt' + (count === 1 ? '' : 's') + ' waiting in the Expense Inbox';
            _eiPaintMark(els[i], count, rose);
        }
    }
    window.eiSyncTabBadges = function () {
        _eiSetTabBadge('expenses', _eiCounts.pc);
        _eiSetTabBadge('pm', _eiCounts.pm);
    };

    // First paint must not pulse — a page load is not a fresh arrival.
    let _eiSeeded = false;
    function _eiApplyGlobalCounts(docs) {
        let pc = 0, pm = 0;
        docs.forEach((d) => {
            const sys = (d.data() || {}).system;
            if (sys === 'pm') pm++; else pc++;   // anything not tagged pm counts as PC
        });
        const pcRose = _eiSeeded && pc > _eiCounts.pc;
        const pmRose = _eiSeeded && pm > _eiCounts.pm;
        _eiSeeded = true;
        _eiCounts.pc = pc;
        _eiCounts.pm = pm;
        _eiSetGroupBadge('expenses-group-badge', pc, pcRose);
        _eiSetGroupBadge('pm-group-badge', pm, pmRose);
        _eiSetTabBadge('expenses', pc, pcRose);
        _eiSetTabBadge('pm', pm, pmRose);
    }

    // Owner + staff only — the same audience RLS lets read the inbox. Workers
    // and team leaders don't encode receipts, so they get no badge.
    function _eiBadgeAudience() {
        const role = window.currentUserRole;
        return (role === 'owner' || role === 'staff') && typeof db !== 'undefined';
    }

    window.eiSyncGlobalBadges = async function () {
        if (!_eiBadgeAudience()) return;
        try {
            const snap = await db.collection('expenseInbox').where('status', '==', 'pending').get();
            _eiApplyGlobalCounts(snap.docs);
        } catch (e) {
            console.warn('expense-inbox: global badge', e.message || e);
        }
    };

    // Keep the nav marks live. Without this the counts only moved on page load,
    // so a receipt shared while the admin was working stayed invisible — which
    // defeats the point of a nav-level mark. Subscribed once per page.
    let _eiGlobalUnsub = null;
    window.eiWatchGlobalBadges = function () {
        if (_eiGlobalUnsub || !_eiBadgeAudience()) return;
        try {
            _eiGlobalUnsub = db.collection('expenseInbox').where('status', '==', 'pending')
                .onSnapshot(
                    (snap) => _eiApplyGlobalCounts(snap.docs),
                    (e) => console.warn('expense-inbox: global badge watch', e.message || e)
                );
        } catch (e) {
            console.warn('expense-inbox: global badge watch', e.message || e);
        }
    };

    // ── Public mount points ──  (label = project/folder display name, optional)

    // PC folder detail: one fetch, routed into the tab where each receipt
    // type gets encoded — materials + overhead → Materials tab, labor →
    // Payroll tab — with pending counts on the tab buttons.
    window.expenseInboxRenderPC = async function (folderId, label) {
        const hasM = document.getElementById('eiPanelPCMaterials');
        const hasP = document.getElementById('eiPanelPCPayroll');
        if ((!hasM && !hasP) || typeof db === 'undefined' || !folderId) return;
        let items = [], err = null;
        try {
            items = await _eiFetch('pc', folderId);
        } catch (e) {
            console.warn('expense-inbox: load', e.message || e);
            err = e.message || String(e);
        }
        // Materials tab is the catch-all (materials + overhead + anything
        // untyped); only labor is routed away, to the Payroll tab.
        _eiApply('eiPanelPCMaterials', 'pc', folderId, label, { notTypes: ['labor'], groupByType: true, badgeBtnId: 'mvpTabBtnMaterials' }, items, err);
        _eiApply('eiPanelPCPayroll',   'pc', folderId, label, { types: ['labor'],                       badgeBtnId: 'mvpTabBtnPayroll'   }, items, err);
    };

    // PM Daily Expenses tab: everything is encoded on this one tab, so the
    // panel stays combined but groups receipts by type for scanning.
    window.expenseInboxRenderPM = function (pmProjectId, label) {
        _eiLoad('eiPanelPM', 'pm', pmProjectId, label, { groupByType: true });
    };

    // Project Control React portal (folder dashboard) — read-only overview,
    // combined. See ExpenseInboxMount in portal-app.compiled.js.
    window.expenseInboxRenderPortal = function (folderId, label) {
        _eiLoad('eiPanelPortal', 'pc', folderId, label);
    };

    // Project Control React portal — per-type panels, one inside each drill so a
    // receipt appears in the same module where staff encodes it. Labor → Labor
    // drill, Overhead → Overhead drill, and Materials is the catch-all (materials
    // + any untyped row) so a stray receipt can never disappear. Each is
    // ExpenseInboxMount({ kind }) in portal-app.compiled.js.
    window.expenseInboxRenderPortalLabor = function (folderId, label) {
        _eiLoad('eiPanelPortalLabor', 'pc', folderId, label, { types: ['labor'] });
    };
    window.expenseInboxRenderPortalMaterial = function (folderId, label) {
        _eiLoad('eiPanelPortalMaterial', 'pc', folderId, label, { notTypes: ['labor', 'overhead'] });
    };
    window.expenseInboxRenderPortalOverhead = function (folderId, label) {
        _eiLoad('eiPanelPortalOverhead', 'pc', folderId, label, { types: ['overhead'] });
    };

})();
