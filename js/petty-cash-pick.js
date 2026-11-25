// ════════════════════════════════════════════════════════════════════
// PETTY CASH ON LABOR AND OVERHEAD (0122) — who may choose it, and what is sent
//
// One rule for the four forms (Add / Edit Payroll in Project Control, the
// Overhead section, Project Control's Overhead tab):
//   - a staff buyer pays from their own petty cash ("My petty cash") — payroll only;
//   - the main owner may pick any staff buyer's ("Petty cash" + whose);
//   - everyone else: Company only (the row is not shown).
// The server checks all of it again (0122's triggers). Nothing here touches
// a money figure: petty cash only says how an entry was paid.
// Spec: docs/superpowers/specs/2026-11-25-petty-cash-labor-overhead-design.md
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const COMPANY = { value: 'company', label: 'Company (paid directly)' };
    const REFUSALS = {
        NOT_A_BUYER: 'Only a staff buyer holds petty cash.',
        PERSON_NOT_ALLOWED: 'Only the main owner can record another person\'s petty cash.',
        PETTY_CASH_DATE: 'Petty cash needs a payment date that is not in the future.',
        BAD_AMOUNT: 'Check the amount.',
    };
    let names = {};   // buyer id → name, from the main owner's buyer list

    // The "Paid from" choices for this account. overhead: staff never pick it there.
    function choices({ role, mainOwner, canBuy, buyers, overhead } = {}) {
        const out = [COMPANY];
        if (role === 'staff' && canBuy && !overhead) out.push({ value: 'mine', label: 'My petty cash' });
        if (mainOwner && role !== 'staff' && (buyers || []).length) out.push({ value: 'petty_cash', label: 'Petty cash' });
        return out;
    }

    // Whose petty cash goes with the entry (null: not petty cash).
    function holderFor(choice, pickedPerson, myUid) {
        if (choice === 'mine') return myUid || null;
        if (choice === 'petty_cash') return pickedPerson || null;
        return null;
    }

    // What the form refuses before sending ('' = nothing).
    function problem(choice, holder, dayText) {
        if (choice !== 'mine' && choice !== 'petty_cash') return '';
        if (!holder) return 'Choose whose petty cash paid.';
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(dayText || '').trim())) return 'Petty cash needs the payment date.';
        return '';
    }

    // The server's refusals (0122) in plain words; null for anything else.
    function errorText(err) {
        const m = String((err && (err.message || err.code)) || '');
        const code = Object.keys(REFUSALS).find(k => m.includes(k));
        return code ? REFUSALS[code] : null;
    }

    // The main owner's staff buyers (the same list as Record payment); [] for
    // everyone else, and on any refusal.
    async function loadBuyers() {
        const w = window;
        if (w.currentUserRole === 'staff' || !w.currentStockMainOwner || !w.sbClient) return [];
        try {
            const { data, error } = await w.sbClient.rpc('pur_cash_tracker');
            if (error) throw error;
            const buyers = ((data && data.buyers) || []).filter(b => b.can_buy || Number(b.recorded) !== 0)
                .map(b => ({ buyer_id: b.buyer_id, name: b.name || '' }));
            names = {};
            buyers.forEach(b => { names[b.buyer_id] = b.name; });
            return buyers;
        } catch (err) {
            if (typeof console !== 'undefined') console.warn('petty cash buyers:', err);
            return [];
        }
    }

    function nameOf(uid) { return (uid && names[uid]) || ''; }

    // The small tag shown on a list row or a voucher.
    function tag(uid) {
        const n = nameOf(uid);
        return 'Petty cash' + (n ? ' · ' + n : '');
    }

    window.DacsPettyCash = { choices, holderFor, problem, errorText, loadBuyers, nameOf, tag };
})();
