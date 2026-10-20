/* ══════════════════════════════════════════════════════════
   WORKER CASH ADVANCES — the ONE calculation (window.CashAdvance)
   Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md

   A tracking ledger OUTSIDE the money model. Money advanced to a worker on
   a PM project, and the repayments the owner records by hand:

     Repaid     = sum of the non-voided repayments
     Balance    = advance − repaid   (the server refuses any repayment above it)
     Suggestion = payroll × suggested %, capped at the balance — a LABEL,
                  never a deduction, payment or repayment

   Pure functions + the thin server wrappers. This is the ONLY file that
   names the server's cash-advance functions (tests/cash-advance.test.js
   fences it). Nothing here touches payroll, expenses or Spent / Earned /
   Profit. Money is handled in integer centavos.
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const DEFAULT_PCT = 30;
  const STATUS_LABEL = { unpaid: 'Unpaid', partial: 'Partially Paid', paid: 'Fully Paid', voided: 'Voided' };
  // pm-admin.js's daily-expense types; anything unrecognised is Labor there, so here too.
  const PM_ENTRY_TYPES = ['labor', 'materials', 'both', 'overhead'];

  // Integer centavos. The epsilon absorbs binary noise (1.005 * 100 = 100.4999…).
  function toCents(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const c = Math.round(Math.abs(x) * 100 + 1e-6);
    return x < 0 ? -c : c;
  }
  function pesos(cents) {
    const c = Math.round(Number(cents) || 0);
    const s = (Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (c < 0 ? '−' : '') + '₱' + s;
  }
  function fmtPct(n) {
    const x = Number(n);
    return String(Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
  }
  // Local date key — never toISOString().slice(0,10) (PH is UTC+8).
  function dateKey(d) {
    const x = d instanceof Date ? d : new Date();
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }

  function totals(adv) {
    const a = adv || {};
    const amountCents = toCents(a.amount);
    const repaidCents = (a.repayments || []).filter(r => r && !r.voided_at).reduce((s, r) => s + toCents(r.amount), 0);
    const balanceCents = amountCents - repaidCents;
    let status;
    if (a.voided_at) status = 'voided';
    else if (repaidCents <= 0) status = 'unpaid';
    else if (balanceCents <= 0) status = 'paid';
    else status = 'partial';
    return { amountCents, repaidCents, balanceCents, status, label: STATUS_LABEL[status] };
  }

  // basis × pct in integer maths: pct is held in hundredths of a percent, so
  // ₱6,450 × 30% = 645000 × 3000 / 10000 = 193500 centavos, rounded half-up.
  function suggestion(basisCents, pct, balanceCents) {
    const b = Math.round(Number(basisCents) || 0);
    const p = Math.round((Number(pct) || 0) * 100);
    const bal = Math.round(Number(balanceCents) || 0);
    const none = { raw: 0, capped: 0, isCapped: false, none: true };
    if (p <= 0 || b <= 0 || bal <= 0) return none;
    // The permitted numeric(12,2) maximum times 100% exceeds Number's safe
    // integer range. Keep the half-up product exact until it is bounded.
    const raw = Number((BigInt(b) * BigInt(p) + 5000n) / 10000n);
    if (raw <= 0) return none;
    return { raw, capped: Math.min(raw, bal), isCapped: raw > bal, none: false };
  }

  // The form sends the value AS TYPED (after stripping ₱ and commas) — never
  // pre-rounded, so 100.005 is refused rather than stored as 100.01.
  function parseAmount(str) {
    const s = String(str == null ? '' : str).replace(/[₱,\s]/g, '');
    if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: 'Amounts can have at most two decimal places.' };
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Enter an amount above ₱0.' };
    const value = Number(s);
    if (!(value > 0)) return { ok: false, error: 'Enter an amount above ₱0.' };
    return { ok: true, value, cents: toCents(value) };
  }
  function parsePct(str) {
    const s = String(str == null ? '' : str).replace(/[%\s]/g, '');
    if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: 'Suggested % can have at most two decimal places.' };
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'Suggested % must be 0 to 100.' };
    const value = Number(s);
    if (value < 0 || value > 100) return { ok: false, error: 'Suggested % must be 0 to 100.' };
    return { ok: true, value };
  }

  function nameKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function exactSimilar(a, b) { const k = nameKey(a); return k !== '' && k === nameKey(b); }
  function entryType(v) { return PM_ENTRY_TYPES.indexOf(v) >= 0 ? v : 'labor'; }

  // A worker's Labor lines on one project. Legs of one split payment
  // (splitGroup) are one line, summed — never "(1/2)" rows.
  function laborLines(bills, workerName, similarFn) {
    const same = typeof similarFn === 'function' ? similarFn : exactSimilar;
    const byKey = new Map();
    (bills || []).forEach(b => {
      const entries = Array.isArray(b && b.entries) ? b.entries : [];
      entries.forEach((e, i) => {
        if (!e || entryType(e.type) !== 'labor') return;
        const details = String(e.details || '').trim();
        if (!details || !same(details, workerName)) return;
        const key = String(b.id) + '|' + (e.splitGroup ? 'sp:' + e.splitGroup : 'e:' + (e.id || 'i' + i));
        let line = byKey.get(key);
        if (!line) {
          line = { key, billId: String(b.id), entryIds: [], day: String(b.weekEndingDate || ''), details, cents: 0 };
          byKey.set(key, line);
        }
        line.entryIds.push(String(e.id || ''));
        line.cents += toCents(e.amount);
      });
    });
    return Array.from(byKey.values()).filter(l => l.cents > 0)
      .sort((x, y) => y.day.localeCompare(x.day) || x.details.localeCompare(y.details));
  }
  function payrollRef(line) {
    return { billId: line.billId, entryIds: line.entryIds.slice(), day: line.day, details: line.details, amount: line.cents / 100 };
  }
  function nameSuggestions(bills, groupFn) {
    const rows = [];
    (bills || []).forEach(b => (Array.isArray(b && b.entries) ? b.entries : []).forEach(e => {
      const details = String((e && e.details) || '').trim();
      if (e && details && entryType(e.type) === 'labor') rows.push({ details, amount: Number(e.amount) || 0 });
    }));
    let names;
    if (typeof groupFn === 'function') names = Array.from(groupFn(rows), g => g.canonical);
    else {
      const seen = new Map();
      rows.forEach(r => { const k = nameKey(r.details); if (k && !seen.has(k)) seen.set(k, r.details); });
      names = Array.from(seen.values());
    }
    return names.filter(Boolean).sort((a, b) => a.localeCompare(b));
  }

  // A voided advance is listed only with "Show voided" on AND the All chip.
  function listSummary(advances, filters, similarFn) {
    const f = Object.assign({ worker: '', project: '', status: 'all', showVoided: false }, filters || {});
    const same = typeof similarFn === 'function' ? similarFn : exactSimilar;
    const q = String(f.worker || '').trim();
    const qk = nameKey(q);
    const rows = (advances || []).map(a => ({ adv: a, t: totals(a) })).filter(({ adv, t }) => {
      if (t.status === 'voided' && !(f.showVoided && f.status === 'all')) return false;
      if (f.status !== 'all' && t.status !== f.status) return false;
      if (f.project && adv.project_id !== f.project) return false;
      if (qk && !(nameKey(adv.worker_name).includes(qk) || same(adv.worker_name, q))) return false;
      return true;
    }).sort((x, y) => String(y.adv.issued_on || '').localeCompare(String(x.adv.issued_on || ''))
                   || String(y.adv.created_at || '').localeCompare(String(x.adv.created_at || '')));
    const live = rows.filter(r => r.t.status !== 'voided');
    return { rows, totals: {
      advancedCents: live.reduce((s, r) => s + r.t.amountCents, 0),
      repaidCents: live.reduce((s, r) => s + r.t.repaidCents, 0),
      outstandingCents: live.reduce((s, r) => s + Math.max(0, r.t.balanceCents), 0) } };
  }
  function projectOptions(projects, advances) {
    const out = new Map();
    (projects || []).forEach(p => { if (p && p.id) out.set(p.id, { id: p.id, label: p.name || 'Untitled project', deleted: false }); });
    (advances || []).forEach(a => {
      if (!a || !a.project_id || out.has(a.project_id)) return;
      out.set(a.project_id, { id: a.project_id, label: (a.project_name || 'Untitled project') + (a.project_deleted ? ' (project deleted)' : ''),
                              deleted: !!a.project_deleted });
    });
    return Array.from(out.values()).sort((x, y) => x.label.localeCompare(y.label));
  }

  const MESSAGES = {
    OWNER_ONLY: 'Only owner accounts can use Cash Advances.',
    NOT_OFFICE: 'Only owner accounts can use Cash Advances.',
    OVER_BALANCE: (t) => t ? "That's more than the remaining balance of " + pesos(t.balanceCents) + '.' : "That's more than the remaining balance.",
    BELOW_REPAID: (t) => t ? "The amount can't be lower than the " + pesos(t.repaidCents) + ' already repaid.' : "The amount can't be lower than what has already been repaid.",
    HAS_REPAYMENTS: "Void this advance's repayments first.",
    BAD_AMOUNT: 'Enter an amount above ₱0.',
    BAD_PCT: 'Suggested % must be 0 to 100.',
    BAD_PRECISION: 'Amounts can have at most two decimal places.',
    BAD_REASON: 'Give a reason for voiding.',
    BAD_WORKER: "Enter the worker's name.",
    BAD_DATE: 'Pick a date.',
    BAD_REF: "That payroll line couldn't be linked — pick it again or type an amount.",
    VOIDED: 'This was already voided.',
    ALREADY_VOIDED: 'This was already voided.',
    OP_CONFLICT: 'This form was already used for something else — close it and try again.',
    BAD_OP: 'Close the form and try again.',
    NOT_FOUND: 'This record or project no longer exists — the list has been reloaded.',
    INACTIVE: 'This account is not active.',
    PROFILE_MISSING: 'This account has no profile.',
    BAD_COMPANY_LINK: 'This account is not linked to a valid company.',
    NOT_SIGNED_IN: 'Sign in again and retry.',
  };
  // Refusals that mean the screen is out of date: reload before showing the message.
  const RELOAD_CODES = ['OVER_BALANCE', 'BELOW_REPAID', 'HAS_REPAYMENTS', 'VOIDED', 'ALREADY_VOIDED', 'NOT_FOUND'];
  function errorCode(message) {
    const toks = String(message || '').match(/[A-Z][A-Z_]{2,}/g) || [];
    return toks.find(t => Object.prototype.hasOwnProperty.call(MESSAGES, t)) || '';
  }
  function errorText(message, t) {
    const code = errorCode(message);
    if (!code) return { code: '', known: false, text: String(message || 'Unknown error') };
    const m = MESSAGES[code];
    return { code, known: true, text: typeof m === 'function' ? m(t || null) : m };
  }

  function newOpId() {
    const c = root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const b = new Uint8Array(16);
    c.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // ── server calls (owner-role accounts; the server re-checks everything) ──
  async function rpc(name, args) {
    const sb = root.sbClient;
    if (!sb || typeof sb.rpc !== 'function') throw new Error('Not connected');
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message || String(error));
    return data;
  }
  const server = {
    list: () => rpc('pm_ca_list'),
    projects: () => rpc('pm_ca_projects'),
    recordAdvance: (op, f) => rpc('pm_ca_record_advance', { p_op_id: op, p_project: f.projectId, p_worker: f.worker,
      p_issued_on: f.issuedOn, p_amount: f.amount, p_pct: f.pct, p_notes: f.notes || null }),
    editAdvance: (op, id, f) => rpc('pm_ca_edit_advance', { p_op_id: op, p_id: id, p_project: f.projectId, p_worker: f.worker,
      p_issued_on: f.issuedOn, p_amount: f.amount, p_pct: f.pct, p_notes: f.notes || null }),
    recordRepayment: (op, advanceId, f) => rpc('pm_ca_record_repayment', { p_op_id: op, p_advance: advanceId,
      p_paid_on: f.paidOn, p_amount: f.amount, p_payroll_ref: f.payrollRef || null, p_notes: f.notes || null }),
    voidRepayment: (op, repaymentId, reason) => rpc('pm_ca_void_repayment', { p_op_id: op, p_repayment: repaymentId, p_reason: reason }),
    voidAdvance: (op, id, reason) => rpc('pm_ca_void_advance', { p_op_id: op, p_id: id, p_reason: reason }),
  };

  const api = { DEFAULT_PCT, STATUS_LABEL, RELOAD_CODES, toCents, pesos, fmtPct, dateKey, totals, suggestion,
                parseAmount, parsePct, laborLines, payrollRef, nameSuggestions, listSummary, projectOptions,
                errorCode, errorText, newOpId, server };
  root.CashAdvance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
