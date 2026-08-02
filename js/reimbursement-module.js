/* ══════════════════════════════════════════════════════════════════
   CLIENT REIMBURSEMENT TRACKER — Project Control  (migration 0041)

   The owner/admin (architect) pays a project expense out of personal or
   company funds; this module records that advance and tracks whether the
   CLIENT has paid it back.  Direction is Client → Owner/Admin.  It is NOT
   an employee reimbursement flow.

   ── ISOLATION (the whole point of the module) ───────────────────────
   This file reads and writes exactly TWO things:
     · `reimbursements`  (its own table)
     · `folders`         (read-only, to fill the project picker)
   …plus the `uploads` bucket for the optional receipt image.

   It creates NO invoice, NO payment_request, NO expense, NO payroll row and
   NO journal entry.  Nothing here feeds Labor / Material / Overhead / Spent /
   Earned / Profit — the money invariants in CLAUDE.md never see this data.
   Marking a record 'reimbursed' is a LABEL, not a transaction.
   If a future change makes another module read this table, it stops being a
   tracker: revisit the isolation rule (CLAUDE.md, docs/ARCHITECTURE.md §4)
   before writing that code.

   Owner-only.  RLS is `owner_id = auth.uid()` (staff excluded, like
   folder_budgets), and admin.html blocks the view for staff as well —
   every column here is a peso amount or the context for one.
══════════════════════════════════════════════════════════════════ */

'use strict';

(function () {

    // ── State ──────────────────────────────────────────────────────
    let _rbRows        = [];      // live, non-deleted reimbursement records
    let _rbFolders     = [];      // Project Control folders (id, name, clientEmail)
    let _rbFoldersReady = null;   // in-flight _rbLoadFolders() promise
    let _rbUnsub       = null;
    let _rbInitialized = false;

    // Filters
    let _rbFolderId = '';
    let _rbClient   = '';         // matches clientEmail OR clientName
    let _rbCategory = '';
    let _rbStatus   = '';
    let _rbFrom     = '';         // expense-date range, 'YYYY-MM-DD'
    let _rbTo       = '';
    let _rbSearch   = '';

    let _rbReceiptPending = null; // { file } staged before save
    let _rbStatusTarget   = null; // id of the record the status modal is acting on

    // ── Status vocabulary ──────────────────────────────────────────
    // Tracking labels only. 'reimbursed' means the client has paid the
    // owner/admin back — it triggers no calculation anywhere.
    const RB_STATUS = {
        pending:              { label: 'Pending',              cls: 'rb-b-pending',   hint: 'Advance recorded — not yet sent to the client.' },
        sent_to_client:       { label: 'Sent to Client',       cls: 'rb-b-sent',      hint: 'Reimbursement request has been sent to the client.' },
        partially_reimbursed: { label: 'Partially Reimbursed', cls: 'rb-b-partial',   hint: 'Client has paid back part of the advance.' },
        reimbursed:           { label: 'Reimbursed',           cls: 'rb-b-done',      hint: 'Client has fully paid the owner/admin back.' },
        cancelled:            { label: 'Cancelled',            cls: 'rb-b-cancelled', hint: 'No longer being claimed from the client.' },
    };
    const RB_STATUS_ORDER = ['pending', 'sent_to_client', 'partially_reimbursed', 'reimbursed', 'cancelled'];

    // Suggestions only — the category box is free text, so anything already
    // used is offered from then on (same idea as the Overhead category box).
    const RB_CAT_PRESETS = [
        'Permits & Government Fees', 'Materials', 'Transportation & Delivery',
        'Professional Fees', 'Printing & Documents', 'Labor', 'Equipment Rental',
        'Utilities', 'Meals & Representation', 'Miscellaneous'
    ];

    // ── Small helpers ──────────────────────────────────────────────
    function _rbUid() {
        return (typeof _uid === 'function' ? _uid() : null)
            || window.currentDataUserId
            || (typeof currentUser !== 'undefined' && currentUser && currentUser.uid)
            || null;
    }
    function _rbEmail() {
        return (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email) || '';
    }
    function _rbEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _rbAmt(n) {
        const v = parseFloat(n);
        if (isNaN(v)) return '₱0.00';
        return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function _rbNum(v) {
        const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
    }
    // Only http(s) URLs (our signed/public uploads links) may reach an href/src.
    function _rbSafeUrl(u) {
        const s = String(u == null ? '' : u).trim();
        return /^https?:\/\//i.test(s) ? s : '';
    }
    // 'YYYY-MM-DD' → local Date. Built from parts on purpose: new Date(str)
    // parses as UTC and PH (UTC+8) would render the previous day.
    function _rbParseDay(s) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }
    // Local date key — never toISOString().slice(0,10) (see CLAUDE.md).
    function _rbTodayKey(d) {
        const t = d || new Date();
        return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }
    function _rbDay(s) {
        const d = _rbParseDay(s);
        return d ? d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    }
    function _rbTs(ts) {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
             + ' · ' + d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    }
    function _rbToast(msg, type) {
        const el = document.getElementById('expNotification');
        if (!el) { if (type === 'error') alert(msg); return; }
        el.textContent = msg;
        el.className = 'exp-notification' + (type === 'error' ? ' error' : '');
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 3500);
    }
    function _rbVal(id) {
        const el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
    }
    function _rbSet(id, html) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }
    function _rbRow(id) { return _rbRows.find(r => r.id === id) || null; }
    function _rbStatusMeta(s) { return RB_STATUS[s] || RB_STATUS.pending; }
    function _rbBadge(s) {
        const m = _rbStatusMeta(s);
        return '<span class="rb-badge ' + m.cls + '">' + _rbEsc(m.label) + '</span>';
    }
    // What the client still owes on this record. Cancelled records are not
    // being claimed, and a fully reimbursed one is settled.
    function _rbOutstanding(r) {
        if (r.status === 'reimbursed' || r.status === 'cancelled') return 0;
        return Math.max(0, _rbNum(r.amount) - _rbNum(r.amountReimbursed));
    }
    function _rbPaidBack(r) {
        if (r.status === 'reimbursed') return _rbNum(r.amount);
        if (r.status === 'cancelled')  return 0;
        return Math.min(_rbNum(r.amountReimbursed), _rbNum(r.amount));
    }
    function _rbClientLabel(r) {
        return r.clientName || r.clientEmail || '—';
    }
    function _rbFolder(id) { return _rbFolders.find(f => f.id === id) || null; }

    // Human-readable reference: RB-2026-0001. Derived from the records already
    // loaded, so it is a DISPLAY label — never a key, and two records created
    // in the same second on two devices could collide. `id` stays the identity.
    function _rbNextRefNo() {
        const year = new Date().getFullYear();
        let max = 0;
        _rbRows.forEach(r => {
            const m = /^RB-(\d{4})-(\d+)$/.exec(String(r.refNo || ''));
            if (m && +m[1] === year) max = Math.max(max, +m[2]);
        });
        return 'RB-' + year + '-' + String(max + 1).padStart(4, '0');
    }

    // ── Init ───────────────────────────────────────────────────────
    window.initReimbursementModule = function () {
        if (typeof db === 'undefined' || !_rbUid()) return;

        const t = document.getElementById('rbExpenseDate');
        if (t) t.max = _rbTodayKey();

        _rbFoldersReady = _rbLoadFolders();
        if (!_rbInitialized) {
            _rbInitialized = true;
            _rbSubscribe();
        } else {
            _rbRender();
        }
    };

    // Folders come from Project Control. Prefer the set the Expenses module has
    // already loaded (expFolders) so the picker matches the rest of the tab;
    // fetch them ourselves when the user landed here first.
    async function _rbLoadFolders() {
        const shared = (typeof expFolders !== 'undefined' && Array.isArray(expFolders)) ? expFolders : [];
        if (shared.length) {
            _rbFolders = shared.map(f => ({ id: f.id, name: f.name, clientEmail: f.clientEmail || '' }));
            _rbFillFolderSelects();
            return;
        }
        try {
            const snap = await db.collection('folders').where('userId', '==', _rbUid()).get();
            _rbFolders = snap.docs.map(d => {
                const v = d.data() || {};
                return { id: d.id, name: v.name || 'Untitled', clientEmail: v.clientEmail || '' };
            }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        } catch (e) {
            console.warn('reimbursement: folders load', e.message || e);
            _rbFolders = [];
        }
        _rbFillFolderSelects();
    }

    function _rbFillFolderSelects() {
        [['rbFilterProject', 'All Projects'], ['rbFolderId', 'Select project…']].forEach(([id, ph]) => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const cur = sel.value;
            sel.innerHTML = '<option value="">' + ph + '</option>'
                + _rbFolders.map(f => '<option value="' + _rbEsc(f.id) + '">' + _rbEsc(f.name) + '</option>').join('');
            if (cur && _rbFolders.some(f => f.id === cur)) sel.value = cur;
        });
    }

    function _rbSubscribe() {
        const uid = _rbUid();
        if (!uid) return;
        if (_rbUnsub) { _rbUnsub(); _rbUnsub = null; }

        const apply = (snap) => {
            _rbRows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !r.deletedAt);
            _rbRows.sort((a, b) => {
                const am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
                const bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
                return bm - am;
            });
            _rbFillLookupSelects();
            _rbRender();
        };

        try {
            _rbUnsub = db.collection('reimbursements').where('userId', '==', uid)
                .onSnapshot(apply, (err) => {
                    console.warn('reimbursement onSnapshot error, falling back to .get():', err);
                    db.collection('reimbursements').where('userId', '==', uid).get()
                        .then(apply)
                        .catch(e => {
                            console.error('reimbursement fallback .get() error:', e);
                            _rbRenderError(e.message || String(e));
                        });
                });
        } catch (e) {
            console.error('_rbSubscribe error:', e);
            _rbRenderError(e.message || String(e));
        }
    }

    // Client + category filter options are built from the records themselves,
    // so a client typed by hand is filterable from then on.
    function _rbFillLookupSelects() {
        const clientSel = document.getElementById('rbFilterClient');
        if (clientSel) {
            const cur = clientSel.value;
            const seen = [];
            _rbRows.forEach(r => {
                const v = r.clientEmail || r.clientName;
                if (v && seen.indexOf(v) === -1) seen.push(v);
            });
            seen.sort((a, b) => String(a).localeCompare(String(b)));
            clientSel.innerHTML = '<option value="">All Clients</option>'
                + seen.map(v => '<option value="' + _rbEsc(v) + '">' + _rbEsc(v) + '</option>').join('');
            if (cur && seen.indexOf(cur) !== -1) clientSel.value = cur;
        }

        const catSel = document.getElementById('rbFilterCategory');
        const cats = Array.from(new Set(_rbRows.map(r => r.expenseCategory).filter(Boolean))).sort();
        if (catSel) {
            const cur = catSel.value;
            catSel.innerHTML = '<option value="">All Categories</option>'
                + cats.map(c => '<option value="' + _rbEsc(c) + '">' + _rbEsc(c) + '</option>').join('');
            if (cur && cats.indexOf(cur) !== -1) catSel.value = cur;
        }

        const dl = document.getElementById('rbCategoryList');
        if (dl) {
            const all = Array.from(new Set(RB_CAT_PRESETS.concat(cats))).sort();
            dl.innerHTML = all.map(c => '<option value="' + _rbEsc(c) + '"></option>').join('');
        }
    }

    // ── Filtering (the one set every card and the table read) ──────
    function _rbFiltered() {
        return _rbRows.filter(r => {
            if (_rbFolderId && r.folderId !== _rbFolderId) return false;
            if (_rbClient && r.clientEmail !== _rbClient && r.clientName !== _rbClient) return false;
            if (_rbCategory && r.expenseCategory !== _rbCategory) return false;
            if (_rbStatus && (r.status || 'pending') !== _rbStatus) return false;
            const d = String(r.expenseDate || '');
            if (_rbFrom && (!d || d < _rbFrom)) return false;
            if (_rbTo   && (!d || d > _rbTo))   return false;
            if (_rbSearch) {
                const hay = [r.refNo, r.projectName, r.clientName, r.clientEmail, r.paidByName, r.paidBy,
                             r.expenseCategory, r.description, r.notes, r.remarks]
                    .join(' ').toLowerCase();
                if (hay.indexOf(_rbSearch) === -1) return false;
            }
            return true;
        });
    }

    // ── Filter handlers ────────────────────────────────────────────
    window.rbOnProjectFilter  = function (v) { _rbFolderId = v || ''; _rbRender(); };
    window.rbOnClientFilter   = function (v) { _rbClient   = v || ''; _rbRender(); };
    window.rbOnCategoryFilter = function (v) { _rbCategory = v || ''; _rbRender(); };
    window.rbOnStatusFilter   = function (v) { _rbStatus   = v || ''; _rbRender(); };
    window.rbOnFromFilter     = function (v) { _rbFrom     = v || ''; _rbRender(); };
    window.rbOnToFilter       = function (v) { _rbTo       = v || ''; _rbRender(); };
    window.rbOnSearch         = function (v) { _rbSearch   = String(v || '').trim().toLowerCase(); _rbRender(); };
    window.rbClearFilters = function () {
        _rbFolderId = _rbClient = _rbCategory = _rbStatus = _rbFrom = _rbTo = _rbSearch = '';
        ['rbFilterProject', 'rbFilterClient', 'rbFilterCategory', 'rbFilterStatus',
         'rbFilterFrom', 'rbFilterTo', 'rbSearchInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        _rbRender();
    };

    // ── Render ─────────────────────────────────────────────────────
    function _rbRenderError(msg) {
        _rbSet('rbTableBody',
            '<tr><td colspan="12" class="rb-empty">Could not load reimbursements: ' + _rbEsc(msg) + '</td></tr>');
    }

    function _rbRender() {
        const rows = _rbFiltered();

        let advanced = 0, outstanding = 0, back = 0;
        rows.forEach(r => {
            if (r.status !== 'cancelled') advanced += _rbNum(r.amount);
            outstanding += _rbOutstanding(r);
            back        += _rbPaidBack(r);
        });

        _rbSet('rbKpiAdvanced',    _rbAmt(advanced));
        _rbSet('rbKpiOutstanding', _rbAmt(outstanding));
        _rbSet('rbKpiBack',        _rbAmt(back));
        _rbSet('rbKpiCount',       String(rows.length));
        _rbSet('rbKpiCountSub',    rows.length === _rbRows.length
            ? 'all records'
            : 'of ' + _rbRows.length + ' record' + (_rbRows.length === 1 ? '' : 's'));

        if (!rows.length) {
            _rbSet('rbTableBody', '<tr><td colspan="12" class="rb-empty">'
                + (_rbRows.length
                    ? 'No reimbursement records match these filters.'
                    : 'No reimbursement records yet. Click <strong>+ New Reimbursement</strong> to record an expense you advanced for a client.')
                + '</td></tr>');
            return;
        }

        _rbSet('rbTableBody', rows.map(_rbRowHtml).join(''));
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }

    function _rbRowHtml(r) {
        const id      = _rbEsc(r.id);
        const paid    = _rbPaidBack(r);
        const out     = _rbOutstanding(r);
        const partial = r.status === 'partially_reimbursed' && paid > 0;
        const desc    = String(r.description || '—');
        const receipt = _rbSafeUrl(r.receiptUrl);

        return '<tr>'
            + '<td data-label="Reimbursement ID"><span class="rb-ref">' + _rbEsc(r.refNo || '—') + '</span>'
            +   (receipt ? ' <i data-lucide="paperclip" class="rb-clip" title="Receipt attached"></i>' : '') + '</td>'
            + '<td data-label="Project">' + _rbEsc(r.projectName || (_rbFolder(r.folderId) || {}).name || '—') + '</td>'
            + '<td data-label="Client">' + _rbEsc(_rbClientLabel(r)) + '</td>'
            + '<td data-label="Owner/Admin">' + _rbEsc(r.paidByName || r.paidBy || '—') + '</td>'
            + '<td data-label="Category">' + _rbEsc(r.expenseCategory || '—') + '</td>'
            + '<td data-label="Description"><span class="rb-desc" title="' + _rbEsc(desc) + '">' + _rbEsc(desc) + '</span></td>'
            + '<td data-label="Amount" class="rb-num"><span class="rb-amt">' + _rbAmt(r.amount) + '</span>'
            +   (partial ? '<span class="rb-sub">' + _rbAmt(paid) + ' back · ' + _rbAmt(out) + ' left</span>' : '') + '</td>'
            + '<td data-label="Expense Date">' + _rbEsc(_rbDay(r.expenseDate)) + '</td>'
            + '<td data-label="Date Recorded">' + _rbEsc(_rbTs(r.createdAt)) + '</td>'
            + '<td data-label="Status">' + _rbBadge(r.status) + '</td>'
            + '<td data-label="Remarks"><span class="rb-desc" title="' + _rbEsc(r.remarks || r.notes || '') + '">'
            +   _rbEsc(r.remarks || r.notes || '—') + '</span></td>'
            + '<td data-label="Actions" class="rb-actions-cell">'
            +   '<button class="rb-icon-btn" title="View details" onclick="rbOpenDetail(\'' + id + '\')"><i data-lucide="eye"></i></button>'
            +   '<button class="rb-icon-btn" title="Edit" onclick="rbOpenForm(\'' + id + '\')"><i data-lucide="pencil"></i></button>'
            +   '<button class="rb-icon-btn" title="Update status" onclick="rbOpenStatus(\'' + id + '\')"><i data-lucide="refresh-cw"></i></button>'
            +   '<button class="rb-icon-btn" title="' + (_rbOutstanding(r) > 0 && r.status !== 'cancelled' ? 'Print invoice' : 'Print receipt')
            +     '" onclick="rbPrintInvoice(\'' + id + '\')"><i data-lucide="printer"></i></button>'
            + '</td>'
            + '</tr>';
    }

    // ── Create / Edit form ─────────────────────────────────────────
    window.rbOpenForm = async function (id) {
        const modal = document.getElementById('rbFormModal');
        if (!modal) return;
        const r = id ? _rbRow(id) : null;

        _rbReceiptPending = null;
        // The project picker (and the project-name snapshot taken on save) needs
        // the folder list — wait for the in-flight fetch rather than opening a
        // form with an empty dropdown.
        if (!_rbFolders.length) {
            try { await (_rbFoldersReady || (_rbFoldersReady = _rbLoadFolders())); } catch (e) { /* handled inside */ }
        }
        _rbFillFolderSelects();
        _rbFillLookupSelects();

        document.getElementById('rbEditingId').value = r ? r.id : '';
        _rbSet('rbFormTitle', r ? 'Edit Reimbursement' : 'New Reimbursement');
        _rbSet('rbFormRef', r ? _rbEsc(r.refNo || '') : _rbEsc(_rbNextRefNo()));

        const set = (fid, v) => { const el = document.getElementById(fid); if (el) el.value = v == null ? '' : v; };
        set('rbFolderId',        r ? (r.folderId || '') : '');
        set('rbClientName',      r ? (r.clientName || '') : '');
        set('rbClientEmail',     r ? (r.clientEmail || '') : '');
        set('rbExpenseCategory', r ? (r.expenseCategory || '') : '');
        set('rbDescription',     r ? (r.description || '') : '');
        set('rbAmount',          r ? (r.amount != null ? r.amount : '') : '');
        set('rbExpenseDate',     r ? (r.expenseDate || '') : _rbTodayKey());
        set('rbNotes',           r ? (r.notes || '') : '');
        set('rbReceiptUrl',      r ? (r.receiptUrl || '') : '');
        set('rbReceiptName',     r ? (r.receiptName || '') : '');

        // Paid by = the owner/admin (architect) who advanced the money. Defaults
        // to the signed-in account; editable because the record is sometimes
        // encoded after the fact.
        set('rbPaidByName', r ? (r.paidByName || '') : ((typeof currentUser !== 'undefined' && currentUser && currentUser.displayName) || ''));
        set('rbPaidBy',     r ? (r.paidBy || '') : _rbEmail());

        // Status is set here only on create (always Pending); afterwards it moves
        // through the Update Status dialog so every change lands in the history.
        const statusBox = document.getElementById('rbInitialStatusBox');
        if (statusBox) statusBox.style.display = r ? 'none' : 'block';

        _rbPaintReceiptPreview(r ? r.receiptUrl : '', r ? r.receiptName : '');
        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    };

    window.rbCloseForm = function () {
        const modal = document.getElementById('rbFormModal');
        if (modal) modal.style.display = 'none';
        _rbReceiptPending = null;
    };

    // Selecting a project pre-fills the client from the folder (the BOQ contact),
    // without overwriting a client the user already typed.
    window.rbOnFolderChange = function (folderId) {
        const f = _rbFolder(folderId);
        const emailEl = document.getElementById('rbClientEmail');
        if (f && emailEl && !emailEl.value) emailEl.value = f.clientEmail || '';
    };

    window.rbPickReceipt = function (input) {
        const file = input && input.files && input.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
            _rbToast('Receipt is larger than 10MB — please attach a smaller file.', 'error');
            input.value = '';
            return;
        }
        _rbReceiptPending = { file };
        document.getElementById('rbReceiptName').value = file.name;
        _rbPaintReceiptPreview(URL.createObjectURL(file), file.name, true);
    };

    window.rbClearReceipt = function () {
        _rbReceiptPending = null;
        const f = document.getElementById('rbReceiptFile');
        if (f) f.value = '';
        document.getElementById('rbReceiptUrl').value = '';
        document.getElementById('rbReceiptName').value = '';
        _rbPaintReceiptPreview('', '');
    };

    function _rbIsPdf(url, name) {
        return /\.pdf($|\?)/i.test(String(name || '')) || /\.pdf($|\?)/i.test(String(url || ''));
    }

    function _rbPaintReceiptPreview(url, name, isLocal) {
        const box = document.getElementById('rbReceiptPreview');
        if (!box) return;
        // A blob: URL is our own freshly-picked file; stored URLs go through the
        // http(s) guard and are signed at use time by the shim (§11b).
        const safe = isLocal ? String(url || '') : _rbSafeUrl(url);
        if (!safe) { box.innerHTML = '<span class="rb-hint">No receipt attached.</span>'; return; }
        box.innerHTML = (_rbIsPdf(safe, name)
                ? '<div class="rb-thumb rb-thumb-pdf">PDF</div>'
                : '<img class="rb-thumb" src="' + _rbEsc(safe) + '" alt="receipt">')
            + '<div class="rb-thumb-meta">'
            +   '<span class="rb-thumb-name">' + _rbEsc(name || 'Receipt') + '</span>'
            +   '<button type="button" class="rb-link-btn" onclick="rbClearReceipt()">Remove</button>'
            + '</div>';
    }

    window.rbSaveForm = async function (e) {
        if (e) e.preventDefault();
        if (typeof db === 'undefined' || !_rbUid()) return;

        const editingId  = _rbVal('rbEditingId');
        const folderId   = _rbVal('rbFolderId');
        const clientName = _rbVal('rbClientName');
        const clientEmail= _rbVal('rbClientEmail');
        const category   = _rbVal('rbExpenseCategory');
        const description= _rbVal('rbDescription');
        const amount     = _rbNum(_rbVal('rbAmount'));
        const expenseDate= _rbVal('rbExpenseDate');
        const notes      = _rbVal('rbNotes');
        const paidBy     = _rbVal('rbPaidBy');
        const paidByName = _rbVal('rbPaidByName');

        if (!folderId)   { _rbToast('Please select a project.', 'error'); return; }
        if (!clientName && !clientEmail) { _rbToast('Please enter the client name or email.', 'error'); return; }
        if (!category)   { _rbToast('Please enter an expense category.', 'error'); return; }
        if (!description){ _rbToast('Please enter a description.', 'error'); return; }
        if (!(amount > 0)) { _rbToast('Please enter an amount greater than zero.', 'error'); return; }
        if (!expenseDate){ _rbToast('Please select the expense date.', 'error'); return; }
        if (expenseDate > _rbTodayKey()) { _rbToast('Expense date cannot be in the future.', 'error'); return; }

        // Editing a record that is no longer in the loaded set (deleted elsewhere,
        // or the list reloaded under us) must NOT silently fall through to
        // "create" — that would leave a duplicate advance in the tracker.
        const existing = editingId ? _rbRow(editingId) : null;
        if (editingId && !existing) {
            _rbToast('That record is no longer available — reopen it from the list.', 'error');
            return;
        }

        const btn = document.getElementById('rbSaveBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        try {
            let receiptUrl  = _rbVal('rbReceiptUrl');
            let receiptName = _rbVal('rbReceiptName');
            if (_rbReceiptPending && _rbReceiptPending.file) {
                const file = _rbReceiptPending.file;
                const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
                const ref  = window.storage.ref('reimbursementReceipts/' + _rbUid() + '_' + Date.now() + '.' + ext);
                await ref.put(file);
                receiptUrl  = await ref.getDownloadURL();
                receiptName = file.name;
            }

            const payload = {
                userId: _rbUid(),
                folderId,
                projectName: (_rbFolder(folderId) || {}).name || (existing && existing.projectName) || '',
                clientName, clientEmail,
                paidBy, paidByName,
                expenseCategory: category,
                description,
                amount,
                expenseDate,
                receiptUrl, receiptName,
                notes,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            };

            if (existing) {
                // Append-only edit trail — same convention as overhead_expenses.history.
                const history = Array.isArray(existing.history) ? existing.history.slice() : [];
                const changed = [];
                ['folderId', 'clientName', 'clientEmail', 'paidBy', 'paidByName',
                 'expenseCategory', 'description', 'amount', 'expenseDate', 'notes', 'receiptUrl'].forEach(f => {
                    const a = existing[f] == null ? '' : existing[f];
                    const b = payload[f]  == null ? '' : payload[f];
                    if (String(a) !== String(b)) changed.push(f);
                });
                if (changed.length) {
                    history.push({ at: new Date().toISOString(), by: _rbEmail(), status: existing.status || 'pending',
                                   note: 'Edited: ' + changed.join(', ') });
                }
                await db.collection('reimbursements').doc(existing.id).update({ ...payload, history });
                _rbToast('Reimbursement record updated.');
            } else {
                const refNo = _rbNextRefNo();
                await db.collection('reimbursements').add({
                    ...payload,
                    refNo,
                    // Every new record starts as Pending — an advance has been
                    // recorded but nothing has been claimed from the client yet.
                    status: 'pending',
                    amountReimbursed: 0,
                    remarks: '',
                    history: [{ at: new Date().toISOString(), by: _rbEmail(), status: 'pending',
                                note: 'Reimbursement recorded' }],
                    createdBy: _rbEmail(),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                _rbToast('Reimbursement ' + refNo + ' recorded.');
            }

            window.rbCloseForm();
        } catch (err) {
            console.error('rbSaveForm:', err);
            _rbToast('Error saving reimbursement: ' + (err.message || err), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Save Record'; }
        }
    };

    // ── Detail drawer ──────────────────────────────────────────────
    window.rbOpenDetail = function (id) {
        const r = _rbRow(id);
        const drawer = document.getElementById('rbDetailDrawer');
        if (!r || !drawer) return;

        const receipt = _rbSafeUrl(r.receiptUrl);
        const paid    = _rbPaidBack(r);
        const out     = _rbOutstanding(r);

        const line = (label, value) =>
            '<div class="rb-dl-row"><span class="rb-dl-k">' + _rbEsc(label) + '</span>'
            + '<span class="rb-dl-v">' + (value || '—') + '</span></div>';

        const history = (Array.isArray(r.history) ? r.history.slice() : []).reverse();
        const historyHtml = history.length
            ? history.map(h =>
                '<li class="rb-hist-item">'
                + '<span class="rb-hist-dot"></span>'
                + '<div><div class="rb-hist-note">' + _rbEsc(h.note || _rbStatusMeta(h.status).label) + '</div>'
                + '<div class="rb-hist-meta">' + _rbEsc(_rbTs(h.at))
                + (h.by ? ' · ' + _rbEsc(String(h.by).split('@')[0]) : '') + '</div></div>'
                + '</li>').join('')
            : '<li class="rb-hist-item"><span class="rb-hist-dot"></span><div class="rb-hist-note">No history recorded.</div></li>';

        _rbSet('rbDetailBody',
            '<div class="rb-d-head">'
            +   '<div><div class="rb-d-ref">' + _rbEsc(r.refNo || '—') + '</div>'
            +     '<div class="rb-d-amt">' + _rbAmt(r.amount) + '</div></div>'
            +   _rbBadge(r.status)
            + '</div>'
            + '<div class="rb-d-hint">' + _rbEsc(_rbStatusMeta(r.status).hint) + '</div>'

            + '<div class="rb-d-section">Project</div>'
            + line('Project', _rbEsc(r.projectName || (_rbFolder(r.folderId) || {}).name || '—'))

            + '<div class="rb-d-section">Client</div>'
            + line('Name', _rbEsc(r.clientName || '—'))
            + line('Email', _rbEsc(r.clientEmail || '—'))

            + '<div class="rb-d-section">Paid by (Owner/Admin)</div>'
            + line('Name', _rbEsc(r.paidByName || '—'))
            + line('Email', _rbEsc(r.paidBy || '—'))

            + '<div class="rb-d-section">Expense</div>'
            + line('Category', _rbEsc(r.expenseCategory || '—'))
            + line('Description', _rbEsc(r.description || '—'))
            + line('Amount advanced', _rbAmt(r.amount))
            + line('Reimbursed so far', _rbAmt(paid))
            + line('Still to reimburse', _rbAmt(out))
            + line('Expense date', _rbEsc(_rbDay(r.expenseDate)))

            + '<div class="rb-d-section">Receipt / Invoice</div>'
            + (receipt
                ? '<div class="rb-d-receipt">'
                  + (_rbIsPdf(receipt, r.receiptName)
                      ? '<div class="rb-thumb rb-thumb-pdf">PDF</div>'
                      : '<img class="rb-thumb rb-thumb-lg" src="' + _rbEsc(receipt) + '" alt="receipt">')
                  + '<a class="rb-link-btn" href="' + _rbEsc(receipt) + '" target="_blank" rel="noopener">Open '
                  + _rbEsc(r.receiptName || 'receipt') + ' →</a></div>'
                : '<div class="rb-hint">No receipt attached.</div>')

            + '<div class="rb-d-section">Notes</div>'
            + '<div class="rb-d-notes">' + _rbEsc(r.notes || '—') + '</div>'
            + line('Latest remark', _rbEsc(r.remarks || '—'))

            + '<div class="rb-d-section">Record</div>'
            + line('Created', _rbEsc(_rbTs(r.createdAt)) + (r.createdBy ? ' · ' + _rbEsc(String(r.createdBy).split('@')[0]) : ''))
            + line('Last updated', _rbEsc(_rbTs(r.updatedAt)))

            + '<div class="rb-d-section">Status history</div>'
            + '<ul class="rb-hist">' + historyHtml + '</ul>'
        );

        const editBtn = document.getElementById('rbDetailEditBtn');
        const stBtn   = document.getElementById('rbDetailStatusBtn');
        const prBtn   = document.getElementById('rbDetailPrintBtn');
        if (editBtn) editBtn.onclick = function () { window.rbCloseDetail(); window.rbOpenForm(r.id); };
        if (stBtn)   stBtn.onclick   = function () { window.rbCloseDetail(); window.rbOpenStatus(r.id); };
        // Label follows the document the record will actually produce.
        if (prBtn) {
            prBtn.textContent = (_rbOutstanding(r) > 0 && r.status !== 'cancelled') ? 'Print Invoice' : 'Print Receipt';
            prBtn.onclick = function () { window.rbPrintInvoice(r.id); };
        }

        drawer.style.display = 'flex';
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    };

    window.rbCloseDetail = function () {
        const d = document.getElementById('rbDetailDrawer');
        if (d) d.style.display = 'none';
    };

    // ── Invoice / Receipt document ─────────────────────────────────
    // A PRINT-ONLY document for one advance. It writes nothing: no invoice
    // row, no payment, no accounting entry, no status change — the isolation
    // of this module (CLAUDE.md) is the feature, and a printed page must not
    // become a back door into the money model. Everything below is rendered
    // from the record already on screen.
    //
    // The same button produces one of two documents, because a reimbursement
    // record means different things at different points in its life:
    //   • still owed  → INVOICE  (a claim on the client)
    //   • paid back   → RECEIPT  (an acknowledgement of settlement)
    window.rbPrintInvoice = async function (id) {
        const r = _rbRow(id);
        if (!r) { _rbToast('Record not found.', 'error'); return; }

        const esc = _rbEsc;
        const amount   = _rbNum(r.amount);
        const paidBack = _rbPaidBack(r);
        const balance  = _rbOutstanding(r);
        const settled  = r.status === 'reimbursed' || (balance <= 0 && paidBack > 0);
        const cancelled = r.status === 'cancelled';
        const meta     = _rbStatusMeta(r.status);

        const docKind = cancelled ? 'Cancelled Record' : settled ? 'Reimbursement<br>Receipt' : 'Reimbursement<br>Invoice';
        const kicker  = cancelled ? 'Hindi na sinisingil'
                      : settled   ? 'Resibo ng Bayad-Balik'
                                  : 'Singil para sa Bayad-Balik';

        const bizName = (typeof _defaults !== 'undefined' && _defaults && _defaults.businessName)    || "DAC's Building Design Services";
        const bizAddr = (typeof _defaults !== 'undefined' && _defaults && _defaults.businessAddress) || '';
        const bizTin  = (typeof _defaults !== 'undefined' && _defaults && _defaults.businessTin)     || '';

        const refNo   = r.refNo || '—';
        const today   = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
        const project = r.projectName || (_rbFolder(r.folderId) || {}).name || '—';
        const payer   = r.paidByName || r.paidBy || '—';

        // Sign the stored receipt so it renders inside the popup, which has no
        // access to the signing layer in supabase-config.js. Best-effort: a
        // failure downgrades to a "on file" line rather than a broken image.
        let receiptImg = '';
        const rcptUrl = _rbSafeUrl(r.receiptUrl);
        if (rcptUrl) {
            let shown = '';
            try {
                shown = window.dacsSignedUrl ? await window.dacsSignedUrl(rcptUrl) : rcptUrl;
            } catch (e) { console.warn('receipt sign failed:', e.message || e); }
            const isPdf = /\.pdf($|\?)/i.test(r.receiptName || '') || /\.pdf($|\?)/i.test(rcptUrl);
            receiptImg = '<div class="ws-box" style="margin-top:22px;">'
                + '<div class="ws-lbl ws-sec">Katibayan / Supporting receipt</div>'
                + (shown && !isPdf
                    ? '<img src="' + esc(shown) + '" alt="" style="max-width:100%;max-height:70mm;object-fit:contain;display:block;" onerror="this.style.display=\'none\'">'
                    : '<div class="ws-note-t">' + esc(r.receiptName || 'Receipt') + ' &mdash; on file with this record.</div>')
                + '</div>';
        }

        const w = window.open('', '_blank', 'width=920,height=1180');
        if (!w) { _rbToast('Please allow pop-ups to print the document.', 'error'); return; }

        w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${settled ? 'Reimbursement Receipt' : 'Reimbursement Invoice'} — ${esc(refNo)}</title>
<style>${window.dacsStatementCSS()}</style>
</head>
<body>
<div class="page">
${window.dacsStatementHead({
    title: docKind,
    kicker: kicker,
    bizName, bizAddr, bizTin,
    meta: [
        { k: 'Reference No.', v: refNo },
        { k: 'Petsa / Date',  v: today }
    ]
})}
  <div class="ws-band" style="grid-template-columns:1.4fr 1.4fr 1.2fr 1fr;">
    <div>
      <div class="ws-lbl">Kliyente / Client</div>
      <div class="ws-band-v">${esc(_rbClientLabel(r))}</div>
      ${r.clientEmail ? `<div class="ws-band-s">${esc(r.clientEmail)}</div>` : ''}
    </div>
    <div>
      <div class="ws-lbl">Proyekto / Project</div>
      <div class="ws-band-v sm">${esc(project)}</div>
    </div>
    <div>
      <div class="ws-lbl">Inunang bayad ni / Advanced by</div>
      <div class="ws-band-v sm">${esc(payer)}</div>
    </div>
    <div>
      <div class="ws-lbl">Katayuan / Status</div>
      <div><span class="${window.dacsStatusPillClass(settled ? 'completed' : cancelled ? 'over' : meta.label)}">${esc(meta.label)}</span></div>
    </div>
  </div>

  <div class="ws-body">
    <div class="ws-lbl ws-sec">Ginastos / Expense advanced for the client</div>
    <table class="ws-tbl">
      <thead>
        <tr>
          <th>Deskripsyon / Description</th>
          <th style="width:150px;">Kategorya / Category</th>
          <th style="width:110px;" class="ws-c">Petsa</th>
          <th style="width:120px;" class="ws-r">Halaga</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${esc(r.description || '—')}</td>
          <td>${esc(r.expenseCategory || '—')}</td>
          <td class="ws-c">${esc(_rbDay(r.expenseDate))}</td>
          <td class="ws-r ws-amt">${_rbAmt(amount)}</td>
        </tr>
      </tbody>
    </table>

    <div class="ws-tot-wrap">
      <div class="ws-tot">
        <div class="ws-tot-row"><span>Inunang bayad / Total advanced</span><b>${_rbAmt(amount)}</b></div>
        <div class="ws-tot-row rule"><span>Naibalik na / Reimbursed to date</span><b>${_rbAmt(paidBack)}</b></div>
        <div class="ws-grand">
          <span class="l">${cancelled ? 'Hindi sinisingil / Not claimed'
                          : settled   ? 'Bayad na / Fully settled'
                                      : 'Babayaran / Balance due'}</span>
          <span class="v">${_rbAmt(cancelled ? 0 : balance)}</span>
        </div>
      </div>
    </div>
  </div>
${receiptImg}
${(r.remarks || r.notes) ? `
  <div class="ws-box" style="margin-top:22px;">
    <div class="ws-lbl ws-sec">Paalala / Remarks</div>
    <div class="ws-note-t">${esc(r.remarks || r.notes)}</div>
  </div>` : ''}

  <div class="ws-note">
    <div class="ws-note-t">
      <strong>Tracking document only.</strong> This records money the owner/admin advanced on the
      client&rsquo;s behalf and whether it has been paid back. It is not a project billing document:
      it does not form part of the project cost, budget, accomplishment or any accounting entry,
      and issuing it changes nothing in the record.
    </div>
  </div>

  <div style="flex:1;min-height:12px;"></div>
${window.dacsStatementSigns([
    { label: 'Inihanda ni / Prepared by', name: payer === '—' ? '' : payer },
    { label: settled ? 'Kinumpirma ni / Confirmed by' : 'Tinanggap ni / Received by', name: r.clientName || '' }
])}
${window.dacsStatementFoot([bizName, bizAddr].filter(Boolean).join(' · '), refNo + ' · Pahina 1 / 1')}
</div>
${window.dacsStatementPrintScript()}
</body>
</html>`);
        w.document.close();
    };

    // ── Update status (with confirmation) ──────────────────────────
    window.rbOpenStatus = function (id) {
        const r = _rbRow(id);
        const modal = document.getElementById('rbStatusModal');
        if (!r || !modal) return;
        _rbStatusTarget = id;

        _rbSet('rbStatusRef', _rbEsc(r.refNo || '') + ' · ' + _rbAmt(r.amount));
        _rbSet('rbStatusCurrent', _rbBadge(r.status));

        const sel = document.getElementById('rbStatusNew');
        if (sel) {
            sel.innerHTML = RB_STATUS_ORDER
                .map(s => '<option value="' + s + '">' + _rbEsc(RB_STATUS[s].label) + '</option>').join('');
            sel.value = r.status || 'pending';
        }
        const paidEl = document.getElementById('rbStatusPaid');
        if (paidEl) paidEl.value = _rbNum(r.amountReimbursed) || '';
        const remarkEl = document.getElementById('rbStatusRemark');
        if (remarkEl) remarkEl.value = '';

        window.rbOnStatusPick(sel ? sel.value : 'pending');
        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    };

    window.rbCloseStatus = function () {
        const m = document.getElementById('rbStatusModal');
        if (m) m.style.display = 'none';
        _rbStatusTarget = null;
    };

    // The partial-amount box only makes sense for a partial reimbursement.
    window.rbOnStatusPick = function (status) {
        const box = document.getElementById('rbStatusPaidBox');
        if (box) box.style.display = (status === 'partially_reimbursed') ? 'block' : 'none';
        const r = _rbStatusTarget ? _rbRow(_rbStatusTarget) : null;
        _rbSet('rbStatusHint', _rbEsc(_rbStatusMeta(status).hint)
            + (status === 'reimbursed' && r
                ? ' The full ' + _rbAmt(r.amount) + ' will be marked as paid back.'
                : ''));
        // Say it plainly at the moment of the change: this is a label, nothing more.
        _rbSet('rbStatusIsolation',
            'This only updates the tracking label. No invoice, payment, expense or accounting entry is created.');
    };

    window.rbConfirmStatus = async function () {
        const r = _rbStatusTarget ? _rbRow(_rbStatusTarget) : null;
        if (!r) return;
        const next   = _rbVal('rbStatusNew') || 'pending';
        const remark = _rbVal('rbStatusRemark');
        if (!RB_STATUS[next]) { _rbToast('Please choose a valid status.', 'error'); return; }

        let paidBack = _rbNum(r.amountReimbursed);
        if (next === 'partially_reimbursed') {
            paidBack = _rbNum(_rbVal('rbStatusPaid'));
            if (!(paidBack > 0)) { _rbToast('Enter how much the client has reimbursed so far.', 'error'); return; }
            if (paidBack >= _rbNum(r.amount)) {
                _rbToast('That is the full amount — use "Reimbursed" instead.', 'error'); return;
            }
        } else if (next === 'reimbursed') {
            paidBack = _rbNum(r.amount);
        } else if (next === 'pending' || next === 'sent_to_client' || next === 'cancelled') {
            paidBack = 0;
        }

        const btn = document.getElementById('rbStatusConfirmBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }

        try {
            const history = Array.isArray(r.history) ? r.history.slice() : [];
            history.push({
                at: new Date().toISOString(),
                by: _rbEmail(),
                status: next,
                from: r.status || 'pending',
                note: 'Status: ' + _rbStatusMeta(r.status).label + ' → ' + _rbStatusMeta(next).label
                      + (remark ? ' — ' + remark : ''),
            });
            await db.collection('reimbursements').doc(r.id).update({
                status: next,
                amountReimbursed: paidBack,
                remarks: remark || r.remarks || '',
                history,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            _rbToast('Status updated to ' + _rbStatusMeta(next).label + '.');
            window.rbCloseStatus();
        } catch (err) {
            console.error('rbConfirmStatus:', err);
            _rbToast('Error updating status: ' + (err.message || err), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Confirm Update'; }
        }
    };

})();
