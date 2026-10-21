/* ══════════════════════════════════════════════════════════
   PM PROFIT SHARING — the ONE calculation (window.PMShare)
   Spec: docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md

   An INTERNAL allocation of a PM project's remaining cash between the
   owner and the partner. Never a payout, amount owed or accounting entry,
   and outside Project Control's Spent / Earned / Profit entirely.

     Remaining cash  = paid − direct cost          (existing PM rules)
     Reserve         = recorded at closeout (completed), else
                       max(0, remaining × 5%)  — estimate / provisional
     Sharing balance = remaining − reserve
     Partner amount  = balance × partner% (centavos, half away from 0)
     Owner amount    = balance − partner amount

   Pure functions + thin RPC wrappers. Overview, Reports and the Profit
   Sharing dashboard only FORMAT what this returns.
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const WARRANTY_PCT = 5;
  const DEFAULT_PARTNER_PCT = 50;

  // Integer centavos. The tiny epsilon absorbs binary noise
  // (1.005 * 100 = 100.49999…; 5724.900000000001 from a stored reserve).
  function toCents(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    const c = Math.round(Math.abs(x) * 100 + 1e-6);
    return x < 0 ? -c : c;
  }
  // num / den for integers, rounded half AWAY from zero.
  function roundDiv(num, den) {
    const neg = (num < 0) !== (den < 0);
    const a = Math.abs(num), d = Math.abs(den);
    let q = Math.floor(a / d);
    if ((a - q * d) * 2 >= d) q += 1;
    return neg ? -q : q;
  }
  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  // ── existing PM rules, unchanged (plan D4) ─────────────────────────
  // Cash received: a verified request counts its paid amount (falling back
  // to paidAmount / totalAmount); anything else counts what was paid.
  function paid(reqs) {
    return (reqs || []).reduce((s, r) => {
      if (r.status === 'verified') return s + (Number(r.amountPaid || r.paidAmount || r.totalAmount) || 0);
      return s + (Number(r.amountPaid) || 0);
    }, 0);
  }
  function outstanding(reqs) {
    return (reqs || []).filter(r => r.status === 'unpaid' || r.status === 'partial')
      .reduce((s, r) => s + ((Number(r.totalAmount) || 0) - (Number(r.amountPaid) || 0)), 0);
  }
  // directCostTotal, then labor + materials, then grandTotal − fee. 0 counts
  // as missing. `materials` already includes supply & install (combined).
  // The middle step omits overhead (finding F6): no live bill uses it.
  function directCost(bills) {
    return (bills || []).reduce((s, b) => {
      const dct = Number(b.directCostTotal) || 0;
      if (dct) return s + dct;
      const lm = (Number(b.labor) || 0) + (Number(b.materials) || 0);
      if (lm) return s + lm;
      return s + ((Number(b.grandTotal) || 0) - (Number(b.managementFee) || 0));
    }, 0);
  }

  function split(balanceCents, partnerPct) {
    const bp = Math.round(Number(partnerPct) * 100);           // 40.25% → 4025
    const partnerCents = roundDiv(balanceCents * bp, 10000);
    return { partnerCents, ownerCents: balanceCents - partnerCents };
  }

  function reserveFor(status, remainingCents, rec, paidCents, costCents) {
    const estimate = Math.max(0, roundDiv(remainingCents * WARRANTY_PCT, 100));
    const floored = remainingCents < 0;
    if (status !== 'completed') {
      return { cents: estimate, kind: 'estimate', needsReview: false, changedSinceCloseout: false, floored };
    }
    const amt = rec ? Number(rec.contributedAmount) : NaN;
    const usable = !!rec && !rec.deleted && rec.status !== 'void' && Number.isFinite(amt) && amt >= 0;
    if (!usable) {
      return { cents: estimate, kind: 'provisional', needsReview: true, changedSinceCloseout: false, floored };
    }
    const changed = toCents(rec.totalPaid) !== paidCents || toCents(rec.directCost) !== costCents;
    return { cents: toCents(amt), kind: 'recorded', needsReview: false, changedSinceCloseout: changed, floored: false };
  }

  function dateKey(ts) {
    if (!ts) return '';
    const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function project(input) {
    const reqs = input.reqs || [], bills = input.bills || [];
    const paidCents = toCents(paid(reqs));
    const costCents = toCents(directCost(bills));
    const outstandingCents = toCents(outstanding(reqs));
    const remainingCents = paidCents - costCents;
    const reserve = reserveFor(input.status, remainingCents, input.reserveRow, paidCents, costCents);
    const balanceCents = remainingCents - reserve.cents;
    const partnerPct = input.partnerPct == null ? DEFAULT_PARTNER_PCT : Number(input.partnerPct);
    const s = split(balanceCents, partnerPct);
    const flags = [];
    if (reserve.needsReview) flags.push('reserve_review');
    if (outstandingCents > 0) flags.push('unpaid_balance');
    if (balanceCents < 0) flags.push('shortfall');
    if (reserve.changedSinceCloseout) flags.push('changed_since_closeout');
    return {
      id: input.id, name: input.name || '', address: String(input.address || '').trim(),
      clientName: input.clientName || '',
      partnerEmail: String(input.partnerEmail || '').trim().toLowerCase(),
      status: input.status || '', completionKey: dateKey(input.terminatedAt),
      paidCents, costCents, outstandingCents, remainingCents, reserve, balanceCents,
      partnerPct, ownerPct: round2(100 - partnerPct),
      partnerCents: s.partnerCents, ownerCents: s.ownerCents,
      flags, confirmed: !reserve.needsReview,
    };
  }

  function combine(results) {
    const confirmed = (results || []).filter(r => r.confirmed);
    const review = (results || []).filter(r => !r.confirmed);
    const t = { count: confirmed.length, reviewCount: review.length,
                estimateCount: confirmed.filter(r => r.reserve.kind === 'estimate').length,
                paidCents: 0, costCents: 0, reserveCents: 0, availableCents: 0, shortfallCents: 0,
                netCents: 0, ownerCents: 0, partnerCents: 0, ownerShortfallCents: 0,
                partnerShortfallCents: 0, outstandingCents: 0 };
    confirmed.forEach(r => {
      t.paidCents += r.paidCents; t.costCents += r.costCents; t.reserveCents += r.reserve.cents;
      t.outstandingCents += r.outstandingCents; t.netCents += r.balanceCents;
      t.ownerCents += r.ownerCents; t.partnerCents += r.partnerCents;
      if (r.balanceCents >= 0) t.availableCents += r.balanceCents;
      else { t.shortfallCents += r.balanceCents; t.ownerShortfallCents += r.ownerCents; t.partnerShortfallCents += r.partnerCents; }
    });
    return { totals: t, confirmed, review };
  }

  function fmtPct(n) { return String(round2(n)); }
  function pesos(cents) {
    const c = Math.round(Number(cents) || 0);
    const s = (Math.abs(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (c < 0 ? '−' : '') + '₱' + s;
  }

  // ── server calls (owner-role accounts; the server re-checks everything) ──
  async function rpc(name, args) {
    const sb = root.sbClient;
    if (!sb || typeof sb.rpc !== 'function') throw new Error('Not connected');
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(error.message || String(error));
    return data;
  }
  function load(projectIds) {
    return rpc('pm_sharing_read', { p_projects: projectIds == null ? null : projectIds });
  }
  function save(projectId, partnerPct, expectedVersion, reason) {
    return rpc('pm_set_sharing', { p_project: projectId, p_partner_pct: partnerPct,
                                   p_expected_version: expectedVersion, p_reason: String(reason || '').trim() });
  }
  // The form sends the value AS TYPED — never pre-rounded, so the server
  // can refuse 40.123 instead of storing 40.12.
  function parsePct(str) {
    const s = String(str == null ? '' : str).trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) {
      return { ok: false, error: /^\d{1,3}\.\d{3,}$/.test(s) ? 'Use at most 2 decimal places.' : 'Enter a number from 0 to 100.' };
    }
    const v = Number(s);
    if (v < 0 || v > 100) return { ok: false, error: 'Enter a number from 0 to 100.' };
    return { ok: true, value: v };
  }
  const ERRORS = {
    STALE: 'This split was changed by someone else — reload.',
    OWNER_ONLY: 'Only the main owner can change the split.',
    REASON_REQUIRED: 'Give a reason for changing the split.',
    BAD_PCT: 'Enter a number from 0 to 100 with at most 2 decimal places.',
    PROJECT_UNMAPPED: 'Project not linked to a company — sharing locked.',
    WRONG_COMPANY: 'This project belongs to another company.',
    INACTIVE: 'This account is not active.',
    PROFILE_MISSING: 'This account has no profile.',
    BAD_COMPANY_LINK: 'This account is not linked to a valid company.',
    NOT_OFFICE: 'This account cannot create projects.',
    NOT_SIGNED_IN: 'Sign in again and retry.',
    PROJECT_NOT_FOUND: 'This project no longer exists.',
  };
  function errorText(message) {
    const m = String(message || '');
    const key = Object.keys(ERRORS).find(k => m.indexOf(k) !== -1);
    return key ? ERRORS[key] : m;
  }
  // Facts from the partner's own acceptance record — never "accepted the split".
  function acceptanceFacts(partnerEmail, partners, lastChangeAt) {
    const email = String(partnerEmail || '').trim().toLowerCase();
    if (!email) return ['Partner unassigned.'];
    const p = (partners || []).find(x => String(x.email || '').toLowerCase() === email);
    if (!p || !p.accepted || !p.accepted_at) return ['No Partnership Agreement acceptance on record.'];
    const when = new Date(p.accepted_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    const lines = ['Partnership Agreement' + (p.doc_version ? ' v' + p.doc_version : '') + ' accepted ' + when
                   + '. This acceptance record does not capture a project sharing percentage.'];
    if (lastChangeAt && new Date(lastChangeAt) > new Date(p.accepted_at)) lines.push('Split changed after last signed agreement.');
    return lines;
  }

  const api = { WARRANTY_PCT, DEFAULT_PARTNER_PCT, toCents, roundDiv, paid, outstanding, directCost,
                split, reserveFor, project, combine, dateKey, fmtPct, pesos };
  Object.assign(api, { load, save, parsePct, errorText, acceptanceFacts });
  root.PMShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
