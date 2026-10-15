// ════════════════════════════════════════════════════════════
// SPLIT EXPENSES SHOWN AS ONE ROW (display only)
// ════════════════════════════════════════════════════════════
// An expense bigger than one billing period's remaining fund is saved as
// several rows — one per period — sharing a splitGroup. The server (0096
// pur_charge_rows) and the pre-0096 save path both name them "Item (1/2)",
// "Item (2/2)". The office reads that as ONE expense, so every list shows
// one row: the name without "(1/2)", the summed amount, and the periods it
// was charged to (`_parts`).
//
// MONEY: this is display only. Spent, Remaining and every period total keep
// using the raw rows — each period must still carry its own part. Never feed
// the grouped rows into a total.
//
// Used by portal-app.compiled.js (Project Control) and expenses-module.js
// (Reports detail, CSV, print), so the two can't disagree.
(function (root) {
    'use strict';

    var SUFFIX = /\s*\(\d+\/\d+\)\s*$/;

    // rows    — expense rows in display order
    // nameKey — the field holding the name: 'expenseName' (raw rows) or
    //           'name' (portal-app's mapped rows)
    // Returns a new array. A split appears once, where its first part sat,
    // carrying the first part's id and documents (documents are attached to
    // part 1 only). `_parts` lists every part present, in split order;
    // `_partial` is true when some parts are outside `rows` (e.g. a view of
    // one billing period).
    function groupSplitRows(rows, nameKey) {
        nameKey = nameKey || 'expenseName';
        var out = [];
        var groups = new Map();
        (rows || []).forEach(function (r) {
            var g = r && Number(r.splitTotal) > 1 && r.splitGroup;
            if (!g) { out.push(r); return; }
            var item = groups.get(g);
            if (!item) {
                item = { _parts: [] };
                groups.set(g, item);
                out.push(item);
            }
            item._parts.push(r);
        });
        groups.forEach(function (item) {
            var parts = item._parts.slice().sort(function (a, b) {
                return (Number(a.splitIndex) || 0) - (Number(b.splitIndex) || 0);
            });
            var first = parts[0];
            Object.assign(item, first);
            item._parts = parts;
            item._partial = parts.length < Number(first.splitTotal);
            item.amount = parts.reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0);
            item[nameKey] = String(first[nameKey] || '').replace(SUFFIX, '');
            // Parts are saved with quantity 1, so the real quantity is unknown.
            item._qtyUnknown = true;
            // Any part on Cover makes the expense partly Cover-funded.
            item.coverExpense = parts.some(function (p) { return !!p.coverExpense; });
        });
        return out;
    }

    // A purchase-made split (0096) is edited and voided as one purchase.
    // An older split is edited part by part.
    function isPurchaseRow(r) {
        return !!(r && (r.purchaseLineId || r.purchaseChargeId));
    }

    // The billing period column for a (grouped) row: "Billing #1 + Billing #2"
    // for a split. labelOf(periodId) returns a period's label or ''.
    function periodLabel(r, labelOf) {
        if (!r._parts) return labelOf(r.projectId) || '';
        return r._parts.map(function (p) {
            return labelOf(p.projectId) || (p.projectId ? '' : 'No billing period');
        }).filter(Boolean).join(' + ');
    }

    root.expGroupSplitRows = groupSplitRows;
    root.expIsPurchaseRow = isPurchaseRow;
    root.expSplitPeriodLabel = periodLabel;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { groupSplitRows: groupSplitRows, isPurchaseRow: isPurchaseRow, periodLabel: periodLabel };
    }
})(typeof window !== 'undefined' ? window : globalThis);
