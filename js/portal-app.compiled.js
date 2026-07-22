(function() {
  const TIP_ID = 'dacs-global-tip';
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Spring-like easing for a lively but smooth entrance.
  const EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  // Direction the tip slides in from: 1 = it sits below the anchor (slides up),
  // -1 = it sits above (slides down). Set per-show so the motion points sensibly.
  let dir = 1;

  function getEl() {
    let el = document.getElementById(TIP_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TIP_ID;
      el.style.cssText = 'position:fixed;z-index:99999;background:linear-gradient(160deg,#1f2937,#111827);color:#f9fafb;font-size:13px;font-weight:500;line-height:1.6;padding:13px 16px;border-radius:13px;border:1px solid rgba(255,255,255,0.10);box-shadow:0 16px 40px rgba(0,0,0,0.40);max-width:300px;pointer-events:none;opacity:0;transform-origin:top center;will-change:transform,opacity;';
      document.body.appendChild(el);
    }
    return el;
  }

  // Render either a plain string (legacy data-tip) or a clearer, formatted
  // layout when a title and/or newline-separated steps are provided. Steps that
  // start with "1) ", "- ", or "• " are shown as a tidy list with the marker
  // pulled into its own column so the text aligns cleanly.
  function render(el, title, body) {
    el.innerHTML = '';
    if (title) {
      const h = document.createElement('div');
      h.textContent = title;
      h.style.cssText = 'font-weight:800;font-size:12.5px;letter-spacing:.02em;color:#fff;margin-bottom:7px;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,0.12);';
      el.appendChild(h);
    }
    const lines = String(body).split('\n').map(s => s.trim()).filter(Boolean);
    const looksLikeList = lines.length > 1 && lines.some(l => /^(\d+[\).]|[-•])\s/.test(l));
    if (looksLikeList) {
      lines.forEach((line, i) => {
        const m = line.match(/^(\d+[\).]|[-•])\s+(.*)$/);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;' + (i ? 'margin-top:6px;' : '');
        const marker = document.createElement('span');
        marker.textContent = m ? m[1].replace(')', '').replace('.', '') : '•';
        marker.style.cssText = 'flex:none;min-width:16px;text-align:center;font-weight:800;color:#6ee7b7;';
        const txt = document.createElement('span');
        txt.textContent = m ? m[2] : line;
        txt.style.cssText = 'color:#e5e7eb;';
        row.appendChild(marker); row.appendChild(txt);
        el.appendChild(row);
      });
    } else {
      const p = document.createElement('div');
      p.textContent = body;
      el.appendChild(p);
    }
  }

  function show(tip) {
    const el = getEl();
    render(el, tip.getAttribute('data-tip-title'), tip.getAttribute('data-tip'));
    const r = tip.getBoundingClientRect();
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.display = 'block';
    const ew = el.offsetWidth, eh = el.offsetHeight;
    // prefer below, fallback above
    let top = r.bottom + 10; dir = 1;
    if (top + eh > window.innerHeight - 10) { top = r.top - eh - 10; dir = -1; }
    let left = r.left + r.width / 2 - ew / 2;
    if (left < 10) left = 10;
    if (left + ew > window.innerWidth - 10) left = window.innerWidth - ew - 10;
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    el.style.transformOrigin = dir === 1 ? 'top center' : 'bottom center';
    if (REDUCED) {
      el.style.transform = 'none';
      el.style.transition = 'opacity .15s ease';
      requestAnimationFrame(() => { el.style.opacity = '1'; });
      return;
    }
    // Start slightly offset toward the anchor and scaled down, then spring in.
    el.style.transform = 'translateY(' + (dir * 8) + 'px) scale(.94)';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .18s ease, transform .28s ' + EASE;
      el.style.opacity = '1';
      el.style.transform = 'translateY(0) scale(1)';
    });
  }

  function hide() {
    const el = document.getElementById(TIP_ID);
    if (!el) return;
    el.style.transition = REDUCED ? 'opacity .12s ease' : 'opacity .15s ease, transform .15s ease';
    el.style.opacity = '0';
    if (!REDUCED) el.style.transform = 'translateY(' + (dir * 6) + 'px) scale(.96)';
  }

  document.addEventListener('mouseover', function(e) {
    const tip = e.target.closest('.pc-help-tip[data-tip]');
    if (tip) show(tip);
  });
  document.addEventListener('mouseout', function(e) {
    const tip = e.target.closest('.pc-help-tip[data-tip]');
    if (tip) hide();
  });
  // Touch / tap support: tapping the "?" toggles the tip on phones (where there
  // is no hover). Tapping elsewhere dismisses it.
  document.addEventListener('click', function(e) {
    const tip = e.target.closest('.pc-help-tip[data-tip]');
    if (tip) { e.stopPropagation(); show(tip); }
    else hide();
  });
})();

window.useTweaks = function(defaults) {
  const [v, setV] = React.useState(defaults);
  const setT = React.useCallback((k, val) => {
    setV((prev) => typeof k === "object" ? { ...prev, ...k } : { ...prev, [k]: val });
  }, []);
  return [v, setT];
};
window.TweaksPanel = function() {
  return null;
};
window.TweakSection = function() {
  return null;
};
window.TweakColor = function() {
  return null;
};
window.TweakToggle = function() {
  return null;
};
window.TweakRadio = function() {
  return null;
};
const peso = (n, opts = {}) => {
  const { compact = false } = opts;
  if (compact && Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (compact && Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.?0+$/, "") + "K";
  return n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
};
const _staff = () => typeof window !== "undefined" && window.currentUserRole === "staff";
const Ico = {
  search: /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "8" }), /* @__PURE__ */ React.createElement("path", { d: "m21 21-4.3-4.3" })),
  bell: /* @__PURE__ */ React.createElement("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }), /* @__PURE__ */ React.createElement("path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0" })),
  chevron: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })),
  arrowR: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("line", { x1: "5", y1: "12", x2: "19", y2: "12" }), /* @__PURE__ */ React.createElement("polyline", { points: "12 5 19 12 12 19" })),
  arrowL: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("line", { x1: "19", y1: "12", x2: "5", y2: "12" }), /* @__PURE__ */ React.createElement("polyline", { points: "12 19 5 12 12 5" })),
  trendUp: /* @__PURE__ */ React.createElement("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "22 7 13.5 15.5 8.5 10.5 2 17" }), /* @__PURE__ */ React.createElement("polyline", { points: "16 7 22 7 22 13" })),
  plus: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "5", x2: "12", y2: "19" }), /* @__PURE__ */ React.createElement("line", { x1: "5", y1: "12", x2: "19", y2: "12" })),
  download: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), /* @__PURE__ */ React.createElement("polyline", { points: "7 10 12 15 17 10" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "15", x2: "12", y2: "3" })),
  calendar: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })),
  bldg: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "4", y: "2", width: "16", height: "20", rx: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "9", y1: "22", x2: "9", y2: "18" }), /* @__PURE__ */ React.createElement("line", { x1: "15", y1: "22", x2: "15", y2: "18" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "7", x2: "10", y2: "7" }), /* @__PURE__ */ React.createElement("line", { x1: "14", y1: "7", x2: "16", y2: "7" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "11", x2: "10", y2: "11" }), /* @__PURE__ */ React.createElement("line", { x1: "14", y1: "11", x2: "16", y2: "11" })),
  receipt: /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2H4z" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "9", x2: "16", y2: "9" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "13", x2: "14", y2: "13" })),
  package: /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M16.5 9.4 7.55 4.24" }), /* @__PURE__ */ React.createElement("path", { d: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" }), /* @__PURE__ */ React.createElement("polyline", { points: "3.27 6.96 12 12.01 20.73 6.96" })),
  users: /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "7", r: "4" }), /* @__PURE__ */ React.createElement("path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }), /* @__PURE__ */ React.createElement("path", { d: "M16 3.13a4 4 0 0 1 0 7.75" })),
  doc: /* @__PURE__ */ React.createElement("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), /* @__PURE__ */ React.createElement("polyline", { points: "14 2 14 8 20 8" })),
  chart: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("line", { x1: "18", y1: "20", x2: "18", y2: "10" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "20", x2: "12", y2: "4" }), /* @__PURE__ */ React.createElement("line", { x1: "6", y1: "20", x2: "6", y2: "14" })),
  hard: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2zM10 10V5a3 3 0 0 1 4 0v5M4 15v-3a8 8 0 0 1 16 0v3" })),
  briefcase: /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "2", y: "7", width: "20", height: "14", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" })),
  pencil: /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" }), /* @__PURE__ */ React.createElement("path", { d: "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" })),
  trash: /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "3 6 5 6 21 6" }), /* @__PURE__ */ React.createElement("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }), /* @__PURE__ */ React.createElement("path", { d: "M10 11v6" }), /* @__PURE__ */ React.createElement("path", { d: "M14 11v6" }), /* @__PURE__ */ React.createElement("path", { d: "M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" })),
  sparkles: /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" }), /* @__PURE__ */ React.createElement("path", { d: "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" }))
};
function shortRef(prefix, id) {
  return id ? `${prefix}-${String(id).slice(0, 6).toUpperCase()}` : "\u2014";
}
const LIABILITY_KEYWORDS = ["sss", "philhealth", "pag-ibig", "pagibig", "tax", "liability", "statutory", "contribution", "withholding"];
const INDIRECT_KEYWORDS = ["supervisor", "supervision", "coordinator", "coordination", "procurement", "manager", "officer", "foreman", "indirect", "overhead", "admin"];
function classifyLabor(role, name) {
  const s = ((role || "") + " " + (name || "")).toLowerCase();
  if (LIABILITY_KEYWORDS.some((k) => s.includes(k))) return "liability";
  if (INDIRECT_KEYWORDS.some((k) => s.includes(k))) return "indirect";
  return "direct";
}
function mapPayrollDoc(d) {
  const type = d.laborType === "direct" || d.laborType === "indirect" || d.laborType === "liability" ? d.laborType : classifyLabor(d.role, d.workerName);
  const dateTime = (d.paymentDate || "").toString();
  return {
    id: d.id,
    projectId: d.projectId,
    date: dateTime.slice(0, 10),
    dateTime,
    name: d.workerName || "\u2014",
    role: d.role || "",
    type,
    hours: Number(d.hours) || 0,
    amount: Number(d.totalSalary) || 0,
    // Statutory burden follows the worker it was paid for: a coordinator's SSS is
    // overhead, a mason's SSS is labor. Legacy rows have no flag => treated as direct.
    liabilityFor: d.liabilityFor === "indirect" ? "indirect" : "direct",
    contractId: d.contractId || null,
    payMilestone: d.payMilestone || "",
    paymentMethod: (d.paymentMethod || "").toString(),
    ref: shortRef("PAY", d.id)
  };
}
function mapExpenseDoc(d) {
  const dateTime = (d.dateTime || "").toString();
  const date = dateTime.slice(0, 10);
  const docUrls = {
    po: d.poImageUrl || "",
    dr: d.deliveryReceiptUrl || "",
    si: d.supplierInvoiceUrl || "",
    pay: d.paymentReceiptUrl || ""
  };
  const docs = {
    po: !!docUrls.po,
    dr: !!docUrls.dr,
    si: !!docUrls.si,
    pay: !!docUrls.pay
  };
  const receipts = Array.isArray(d.receiptImages) && d.receiptImages.length ? d.receiptImages : d.receiptURL ? [d.receiptURL] : [];
  return {
    id: d.id,
    projectId: d.projectId,
    date,
    dateTime,
    // full timestamp for date+time display
    name: d.expenseName || d.description || "\u2014",
    category: (d.category || "").toString(),
    supplier: d.supplierName || d.vendor || "",
    amount: Number(d.amount) || 0,
    paymentMethod: (d.paymentMethod || "").toString(),
    // GCASH / LALAMOVE / CASH / BANK / etc.
    notes: (d.notes || "").toString(),
    quantity: Number(d.quantity) || 1,
    coverExpense: !!d.coverExpense,
    // flagged as a "cover expense" (no budget remaining)
    docs,
    docUrls,
    receipts,
    firstReceipt: receipts[0] || docUrls.si || docUrls.dr || docUrls.po || docUrls.pay || "",
    ref: shortRef("EXP", d.id)
  };
}
function mapMonthlyProject(d) {
  return {
    id: d.id,
    folderId: d.folderId,
    month: d.month || "",
    year: d.year || "",
    monthlyBudget: Number(d.monthlyBudget) || 0,
    fundingType: d.fundingType || ""
    // 'president' = cover-expense period
  };
}
// Project Overhead is ONE bucket: the support people (coordinator, site
// supervision, procurement — payroll tagged 'indirect') PLUS the site operating
// costs (electricity, fuel, rent — overheadExpenses). Indirect pay therefore
// leaves Labor Cost and lands here, so it is never counted twice.
//
// A payroll row belongs to Overhead if it IS indirect pay, or if it is the statutory
// burden OF an indirect worker (a coordinator's SSS is overhead; a mason's is labor).
function _isOverheadPay(p) {
  return p.type === "indirect" || (p.type === "liability" && p.liabilityFor === "indirect");
}
function _projOverhead(c) { return c.overhead || 0; }
function _projSpent(c) { return (c.labor || 0) + (c.material || 0) + _projOverhead(c); }
// ── Percentage-of-completion ──────────────────────────────────
// Contract revenue is only EARNED as work is accomplished. Measuring the FULL
// contract against costs-to-date reports a ~90% margin on a job that is 10% built,
// which flatters every project until it finishes. Earned revenue is therefore
// % accomplished (from the BOQ / accomplishment report) × contract amount.
//
// hasData requires accomplished > 0: a BOQ whose percentCompletion is all zeros
// (nobody has updated the accomplishment report yet) would otherwise compute 0%
// earned against real spend and scream "losing money" on every young project.
// With no usable accomplishment data we fall back to the full contract — that is a
// FORECAST-at-completion number, and every caller must label it as such.
function _folderCompletion(boqRaw, folderId) {
  const matches = (boqRaw || []).filter((x) => x.folderId === folderId);
  const doc = matches.slice().sort((a, b) => ((b.costItems && b.costItems.length) || 0) - ((a.costItems && a.costItems.length) || 0))[0] || null;
  if (!doc) return { hasData: false, pct: 0 };
  const total = boqGrandTotal(doc.costItems);
  const acc = boqAccTotal(doc.costItems);
  if (!(total > 0) || !(acc > 0)) return { hasData: false, pct: 0 };
  return { hasData: true, pct: Math.max(0, Math.min(acc / total, 1)), boqContract: total, boqAcc: acc };
}
// Profit recognised at COMPANY level for one project.
//
// A project with reliable accomplishment data books its earned margin. A project
// WITHOUT it (no BOQ, or accomplishment still at 0%) books NO PROFIT — revenue is
// recognised equal to the cost incurred. This is the standard zero-profit method
// used when the outcome of a contract cannot be estimated reliably; the alternative
// (contract minus cost-to-date) would let every unmeasured job pour imaginary profit
// into the company total, which is exactly the flattery we removed from margins.
//
// A loss, however, is recognised IMMEDIATELY even without accomplishment data: if
// costs already exceed the contract, that money is gone regardless of % complete.
function _recognisedProfit(c) {
  const m = _projMargin(c);
  if (!m.isForecast) return m.profit;
  const overrun = (c.revenue || 0) - _projSpent(c);
  return overrun < 0 ? overrun : 0;
}
// G&A — the cost of running the business, never charged to a job. Rows saved before
// the `scope` column existed are inferred the same way the admin page infers them:
// a folderId means project, otherwise company.
function _companyOverhead(overheadRaw) {
  return (overheadRaw || [])
    .filter((e) => !e.deletedAt && (e.scope ? e.scope === "company" : !e.folderId))
    .reduce((s2, e) => s2 + (Number(e.amount) || 0), 0);
}
function _projEarned(c) {
  const comp = c.completion;
  return comp && comp.hasData ? (c.revenue || 0) * comp.pct : (c.revenue || 0);
}
// The single profit calculation. `isForecast` true = no accomplishment data, so the
// figure assumes the job runs to completion and is NOT an earned margin.
function _projMargin(c) {
  const earned = _projEarned(c);
  const profit = earned - _projSpent(c);
  const comp = c.completion;
  return {
    earned,
    profit,
    pct: earned > 0 ? (profit / earned) * 100 : null,
    isForecast: !(comp && comp.hasData),
    completePct: comp && comp.hasData ? comp.pct * 100 : null
  };
}
// ── OCM allowance ─────────────────────────────────────────────
// The contract PRICES overhead in (OCM, typically 8–12% of a PH BOQ), but
// until now nothing compared that allowance to actual overhead spend.
// folders.ocm_pct (migration 0030) stores what was priced; this turns
// overhead tracking into overhead CONTROL. The comparison always uses
// ALL-TIME overhead — the allowance covers the whole job, so the drill's
// period filter must not shrink the spent side. Returns null when no
// allowance is configured.
function _ocmStatus(contract, ocmPct, overheadSpent) {
  const pct = Number(ocmPct) || 0;
  const rev = Number(contract) || 0;
  if (!(pct > 0) || !(rev > 0)) return null;
  const allowance = rev * pct / 100;
  const spent = Number(overheadSpent) || 0;
  return {
    pct,
    allowance,
    spent,
    usedPct: allowance > 0 ? spent / allowance * 100 : 0,
    remaining: allowance - spent,
    over: spent > allowance
  };
}
function buildProject(folder, childMonths, labor, material, overheadRows) {
  const laborBreakdown = labor.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + p.amount;
    acc.total += p.amount;
    // The slice of `liability` that is burden for an INDIRECT worker — it belongs in
    // Overhead, not Labor. Tracked separately so `liability` stays the true total.
    if (p.type === "liability" && p.liabilityFor === "indirect") acc.liabilityIndirect += p.amount;
    return acc;
  }, { direct: 0, indirect: 0, liability: 0, liabilityIndirect: 0, total: 0 });
  const docCounts = material.reduce((acc, e) => {
    if (e.docs.po) acc.po++;
    if (e.docs.dr) acc.dr++;
    if (e.docs.si) acc.si++;
    if (e.docs.pay) acc.pay++;
    return acc;
  }, { po: 0, dr: 0, si: 0, pay: 0 });
  const materialTotal = material.reduce((s, e) => s + e.amount, 0);
  const contractAmount = folder.totalBudget;
  const revenue = Number(contractAmount) || 0;
  const allocated = childMonths.reduce((s, m) => s + m.monthlyBudget, 0);
  // Site operating costs recorded against this folder (soft-deleted rows excluded).
  const overheadExpenses = (overheadRows || [])
    .filter((e) => !e.deletedAt)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  // Labor keeps only the burden of DIRECT workers; an indirect worker's burden moves
  // to Overhead with them. Every peso still lands in exactly one bucket.
  const overheadLabor = laborBreakdown.indirect + laborBreakdown.liabilityIndirect;
  const laborCost = laborBreakdown.direct + (laborBreakdown.liability - laborBreakdown.liabilityIndirect);
  const overhead = overheadLabor + overheadExpenses;
  const spent = laborCost + materialTotal + overhead;
  const _presIds = new Set(childMonths.filter((m) => m.fundingType === "president").map((m) => m.id));
  const coverCost = material.filter((e) => e.coverExpense || _presIds.has(e.projectId)).reduce((s, e) => s + e.amount, 0) + labor.filter((p) => _presIds.has(p.projectId)).reduce((s, p) => s + p.amount, 0);
  return {
    id: folder.id,
    name: folder.name || "Untitled Folder",
    code: shortRef("FLD", folder.id),
    location: folder.description || "",
    revenue,
    revenuePaid: spent,
    allocated,
    coverCost,
    labor: laborCost,
    laborBreakdown,
    material: materialTotal,
    overhead,
    overheadBreakdown: { indirectLabor: overheadLabor, expenses: overheadExpenses },
    spent,
    docCounts,
    fee: 0,
    monthsCount: childMonths.length,
    laborCount: labor.length,
    materialCount: material.length
  };
}
function _billNum(s) {
  if (s === null || s === void 0 || s === "") return 0;
  const n = parseFloat(String(s).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}
function _billLITotal(li) {
  const qty = _billNum(li.qty);
  const mat = li.materialOverride ? 0 : _billNum(li.materialRate);
  const lab = li.laborOverride ? 0 : _billNum(li.laborRate);
  return qty * (mat + lab);
}
function boqGrandTotal(costItems) {
  return (costItems || []).reduce((s, ci) => s + (ci.subItems || []).reduce((s2, si) => s2 + (si.lineItems || []).reduce((s3, li) => s3 + _billLITotal(li), 0), 0), 0);
}
function boqAccTotal(costItems) {
  return (costItems || []).reduce((s, ci) => s + (ci.subItems || []).reduce((s2, si) => s2 + (si.lineItems || []).reduce((s3, li) => s3 + _billLITotal(li) * (_billNum(li.percentCompletion) / 100), 0), 0), 0);
}
function safePct(n, d) {
  return d > 0 ? n / d * 100 : 0;
}
const COVER_LIMIT = 1e4;
const fmtDate = (s) => {
  const d = /* @__PURE__ */ new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const fmtDateTime = (dateTime) => {
  if (!dateTime) return "\u2014";
  const s = String(dateTime);
  const hasTime = s.includes("T") && s.length > 10;
  const iso = hasTime ? s : s.slice(0, 10) + "T00:00:00";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return s;
  const datePart = d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  if (!hasTime) return datePart;
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return datePart + " \xB7 " + timePart;
};
const dropdownStyle = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  minWidth: 280,
  background: "var(--surface)",
  border: "1px solid var(--hair)",
  borderRadius: 12,
  boxShadow: "var(--shadow-lg)",
  padding: 6,
  zIndex: 50
};
const itemStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  width: "100%",
  textAlign: "left",
  borderRadius: 8,
  fontSize: 13,
  color: "var(--ink)"
};
function foldersHealth(folder) {
  if (!(folder.allocated > 0)) return { label: "No budget set", cls: "pc-fld-health-neutral", barClr: "#9CA3AF" };
  const rem = (folder.allocated - _projSpent(folder)) / folder.allocated * 100;
  if (rem <= 0) return { label: "OVER", cls: "pc-fld-health-critical", barClr: "#c0392b" };
  if (rem < 10) return { label: "CRITICAL", cls: "pc-fld-health-critical", barClr: "#c0392b" };
  if (rem < 20) return { label: "WARNING", cls: "pc-fld-health-warning", barClr: "#A86B00" };
  return { label: "HEALTHY", cls: "pc-fld-health-healthy", barClr: "#1A5C3A" };
}
function FoldersGrid({ folders, foldersRaw, monthsRaw, payrollRaw, expensesRaw, overheadRaw, boqRaw, onPickFolder }) {
  const [openCards, setOpenCards] = React.useState({});
  const rc = React.createElement;
  const [current, setCurrent] = React.useState(null);
  const [comboOpen, setComboOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [panelOpen, setPanelOpen] = React.useState(false);
  const comboRef = React.useRef(null);
  React.useEffect(() => {
    if (!comboOpen) return;
    const onDoc = (e) => { if (comboRef.current && !comboRef.current.contains(e.target)) setComboOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [comboOpen]);
  const openCreate = () => window.openExpModal && window.openExpModal("createFolderModal");
  const openEdit = (id, ev) => {
    if (ev) ev.stopPropagation();
    window.openEditFolderModal && window.openEditFolderModal(id);
  };
  const openDelete = (id, ev) => {
    if (ev) ev.stopPropagation();
    window.confirmDeleteFolder && window.confirmDeleteFolder(id);
  };
  const cards = folders.map((f) => {
    const childMonths = monthsRaw.filter((m) => m.folderId === f.id).map(mapMonthlyProject);
    const childIds = new Set(childMonths.map((m) => m.id));
    const labor = payrollRaw.filter((p) => childIds.has(p.projectId)).map(mapPayrollDoc);
    const material = expensesRaw.filter((e) => childIds.has(e.projectId)).map(mapExpenseDoc);
    const _raw = foldersRaw.find((x) => x.id === f.id) || {};
    const ovhd = (overheadRaw || []).filter((e) => e.folderId === f.id);
    const built = buildProject(_raw, childMonths, labor, material, ovhd);
    built.completion = _folderCompletion(boqRaw, f.id);
    const h = foldersHealth(built);
    const spent = _projSpent(built);
    const spentPct = built.allocated > 0 ? Math.min(spent / built.allocated * 100, 100) : 0;
    const remaining = built.allocated - spent;
    const periodCount = childMonths.length;
    let status = "track";
    if (periodCount === 0 && spent === 0) status = "new";
    else if (remaining < 0 || (built.coverCost || 0) > COVER_LIMIT) status = "attn";
    let note = "";
    if (status === "attn") {
      note = remaining < 0
        ? "This project is over budget by ₱" + peso(Math.abs(remaining)) + ". Review the latest cost summary before approving payouts."
        : "Cover expenses exceed ₱" + peso(COVER_LIMIT) + " this billing period. Review the latest cost summary before approving payouts.";
    }
    return { ...built, h, spent, spentPct, remaining, periodCount, status, note, createdAt: _raw.createdAt };
  });
  const _fldMs = (t) => t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : 0);
  cards.sort((a, b) => _fldMs(b.createdAt) - _fldMs(a.createdAt));
  // Remember the last-selected project across reloads. The very first load (no
  // saved choice yet) still shows "Select a project"; after that it restores.
  const _restoredRef = React.useRef(false);
  React.useEffect(() => {
    if (_restoredRef.current || !cards.length) return;
    _restoredRef.current = true;
    try {
      const saved = localStorage.getItem("pcfSelectedFolder");
      if (saved) { const i = cards.findIndex((c) => c.id === saved); if (i >= 0) setCurrent(i); }
    } catch (e) {}
  });
  React.useEffect(() => {
    try {
      if (current !== null && cards[current]) localStorage.setItem("pcfSelectedFolder", cards[current].id);
    } catch (e) {}
  }, [current]);
  const runHealthCheck = () => {
    if (typeof window.aiHealthCheck !== "function") return;
    window.aiHealthCheck(cards.map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location,
      revenue: c.revenue,
      allocated: c.allocated,
      spent: _projSpent(c),
      overhead: c.overhead || 0,
      remaining: c.remaining,
      coverCost: c.coverCost,
      statusLabel: c.h.label,
      spentPct: c.spentPct,
      periodCount: c.periodCount,
      // Earned-revenue view, so the briefing doesn't reason from a contract-vs-cost
      // margin that flatters every unfinished job.
      percentComplete: _projMargin(c).completePct,
      earnedRevenue: _projEarned(c),
      marginPct: _projMargin(c).pct,
      marginIsForecast: _projMargin(c).isForecast
    })), COVER_LIMIT);
  };
  const _spentOf = (c) => _projSpent(c);
  // Earned margin (percentage-of-completion), not contract-vs-cost-to-date.
  const _marginOf = (c) => c.revenue > 0 ? _projMargin(c).pct : null;
  const _over = cards.filter((c) => c.remaining < 0);
  const _negM = cards.filter((c) => c.remaining >= 0 && _marginOf(c) !== null && _marginOf(c) < 0);
  const _noBud = cards.filter((c) => (c.allocated || 0) <= 0 && _spentOf(c) > 0);
  const _near = cards.filter((c) => c.allocated > 0 && c.remaining >= 0 && c.remaining < c.allocated * 0.15);
  const _cover = cards.filter((c) => c.coverCost > COVER_LIMIT && c.remaining >= 0);
  const _lowM = cards.filter((c) => c.remaining >= 0 && _marginOf(c) !== null && _marginOf(c) >= 0 && _marginOf(c) < 10);
  const _n = (arr) => arr.length + " project" + (arr.length > 1 ? "s" : "");
  const _more = (arr) => arr.length > 1 ? " and " + (arr.length - 1) + " more" : "";
  let _hcKind = "ok", _hcTitle = "All clear:", _hcMsg = "All " + cards.length + " projects are healthy and within budget.";
  if (_over.length) {
    _hcKind = "risk";
    _hcTitle = "Action needed:";
    _hcMsg = _n(_over) + " over budget \u2014 " + _over[0].name + " by \u20B1" + peso(Math.abs(_over[0].remaining)) + _more(_over) + ".";
  } else if (_negM.length) {
    _hcKind = "risk";
    _hcTitle = "Action needed:";
    _hcMsg = _n(_negM) + " losing money \u2014 " + _negM[0].name + _more(_negM) + ".";
  } else if (_noBud.length) {
    _hcKind = "warn";
    _hcTitle = "Needs attention:";
    _hcMsg = _n(_noBud) + " spending with no budget set \u2014 " + _noBud[0].name + _more(_noBud) + ".";
  } else if (_near.length) {
    _hcKind = "warn";
    _hcTitle = "Needs attention:";
    _hcMsg = _n(_near) + " near the budget limit \u2014 " + _near[0].name + _more(_near) + ".";
  } else if (_cover.length) {
    _hcKind = "warn";
    _hcTitle = "Needs attention:";
    _hcMsg = _n(_cover) + " with cover expenses over \u20B1" + peso(COVER_LIMIT) + " \u2014 " + _cover[0].name + _more(_cover) + ".";
  } else if (_lowM.length) {
    _hcKind = "warn";
    _hcTitle = "Needs attention:";
    _hcMsg = _n(_lowM) + " with a low profit margin \u2014 " + _lowM[0].name + _more(_lowM) + ".";
  }
  const _hcIconSvg = {
    ok: /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M22 11.08V12a10 10 0 1 1-5.93-9.14" }), /* @__PURE__ */ React.createElement("polyline", { points: "22 4 12 14.01 9 11.01" })),
    warn: /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "9", x2: "12", y2: "13" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" })),
    risk: /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polygon", { points: "7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "8", x2: "12", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "16", x2: "12.01", y2: "16" }))
  };
  const header = rc("header", { className: "pcf-head" }, rc("div", null, rc("p", { className: "pcf-eyebrow" }, "Project Control"), rc("h1", { className: "pcf-title" }, "Project Folders"), rc("p", { className: "pcf-sub" }, "Select a project to manage its budget, billing periods, labor and materials.")), rc("button", { className: "pcf-btn-primary", onClick: openCreate }, rc("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" }, rc("line", { x1: 12, y1: 5, x2: 12, y2: 19 }), rc("line", { x1: 5, y1: 12, x2: 19, y2: 12 })), " New Project Folder"));
  if (!folders.length) {
    return /* @__PURE__ */ React.createElement(React.Fragment, null, header, /* @__PURE__ */ React.createElement("section", { className: "pc-folders-empty" }, /* @__PURE__ */ React.createElement("div", { className: "pc-folders-empty-icon" }, "\u{1F4C1}"), /* @__PURE__ */ React.createElement("h3", { className: "pc-folders-empty-title" }, "No project folders yet"), /* @__PURE__ */ React.createElement("p", { className: "pc-folders-empty-sub" }, "Create your first project folder to start tracking budgets, billing periods, and expenses."), /* @__PURE__ */ React.createElement("button", { className: "pc-btn-primary", onClick: openCreate, style: { marginTop: 12 } }, "+ New Project Folder")));
  }
  return (() => {
    const hasSel = current !== null && current >= 0 && current < cards.length;
    const idx = hasSel ? current : -1;
    const c = hasSel ? cards[idx] : null;
    const STATUS = { track: { cls: "st-track", label: "On track" }, attn: { cls: "st-attn", label: "Needs attention" }, "new": { cls: "st-new", label: "Not started" } };
    const st = c ? (STATUS[c.status] || STATUS.track) : STATUS.track;
    const DOT = { track: "#3D8A63", attn: "#C9871A", "new": "#B8B2A8" };
    const q = query.trim().toLowerCase();
    const filtered = cards.map((cc, i) => ({ cc, i })).filter((o) => !q || o.cc.name.toLowerCase().includes(q) || (o.cc.location && o.cc.location.toLowerCase().includes(q)));
    const SEGN = 6;
    const segs = c ? Array.from({ length: SEGN }, (_, i) => rc("span", { key: i, className: "pcf-seg" + (i < c.periodCount ? " on" : "") })) : [];
    const cur = (v) => v > 0 ? rc(React.Fragment, null, rc("span", { className: "pcf-cur" }, "₱"), peso(v)) : rc("span", { style: { color: "#908A81" } }, "—");
    const pinSvg = rc("svg", { viewBox: "0 0 24 24", width: 14, height: 14, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" }, rc("path", { d: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" }), rc("circle", { cx: 12, cy: 10, r: 2.5 }));
    const warnSvg = rc("svg", { viewBox: "0 0 24 24", width: 17, height: 17, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }, rc("path", { d: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" }), rc("line", { x1: 12, y1: 9, x2: 12, y2: 13 }), rc("line", { x1: 12, y1: 17, x2: 12.01, y2: 17 }));
    const chevSvg = rc("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, rc("polyline", { points: "6 9 12 15 18 9" }));
    return rc(React.Fragment, null,
      header,
      rc("div", { className: "pcf-switch" },
        rc("div", { className: "pcf-combo" + (comboOpen ? " open" : ""), ref: comboRef },
          rc("button", { className: "pcf-combo-btn", onClick: () => setComboOpen((o) => !o) },
            rc("span", { className: "pcf-combo-icon" }, Ico.bldg),
            rc("span", { className: "pcf-combo-label" }, rc("span", { className: "pcf-combo-cap" }, "Active project"), rc("span", { className: "pcf-combo-name", style: c ? void 0 : { color: "#908A81", fontStyle: "italic" } }, c ? c.name : "Select a project…")),
            rc("span", { className: "pcf-combo-chev" }, chevSvg)
          ),
          comboOpen && rc("div", { className: "pcf-combo-pop" },
            rc("div", { className: "pcf-combo-search" },
              rc("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }, rc("circle", { cx: 11, cy: 11, r: 7 }), rc("line", { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })),
              rc("input", { type: "text", placeholder: "Search projects…", value: query, autoFocus: true, onChange: (e) => setQuery(e.target.value) })
            ),
            rc("div", { className: "pcf-combo-list" },
              filtered.length === 0
                ? rc("div", { className: "pcf-combo-empty" }, "No projects match.")
                : filtered.map((o) => rc("button", { key: o.cc.id, className: "pcf-combo-item" + (o.i === idx ? " selected" : ""), onClick: () => { setCurrent(o.i); setComboOpen(false); setQuery(""); } },
                    rc("span", { className: "pcf-ci-dot", style: { background: DOT[o.cc.status] || "#B8B2A8" } }),
                    rc("span", { style: { minWidth: 0 } }, rc("span", { className: "pcf-ci-name" }, o.cc.name), rc("span", { className: "pcf-ci-meta" }, (o.cc.location ? o.cc.location + " · " : "") + (o.cc.periodCount === 1 ? "1 billing period" : o.cc.periodCount + " billing periods"))),
                    o.i === idx ? rc("span", { className: "pcf-ci-check" }, "✓") : null
                  ))
            )
          )
        ),
        rc("div", { className: "pcf-stepper" },
          rc("button", { className: "pcf-step-btn", title: "Previous", onClick: () => setCurrent(hasSel ? (idx - 1 + cards.length) % cards.length : cards.length - 1) }, rc("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, rc("polyline", { points: "15 18 9 12 15 6" }))),
          rc("button", { className: "pcf-step-btn", title: "Next", onClick: () => setCurrent(hasSel ? (idx + 1) % cards.length : 0) }, rc("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, rc("polyline", { points: "9 18 15 12 9 6" })))
        )
      ),
      rc("p", { className: "pcf-count" }, hasSel ? rc(React.Fragment, null, "Showing ", rc("b", null, idx + 1), " of ", rc("b", null, cards.length), " projects · use the selector or arrows to switch") : rc(React.Fragment, null, rc("b", null, cards.length), " projects · choose one from the selector or arrows above")),
      !c && rc("section", { className: "pcf-panel pcf-empty" }, rc("h3", null, "No project selected"), rc("p", null, "Choose a project from the selector or arrows above to view its budget, billing periods, labor and materials.")),
      c && rc("section", { className: "pcf-panel" },
        rc("div", { className: "pcf-panel-head" },
          rc("div", { className: "pcf-ph-left" },
            rc("h2", { className: "pcf-ph-title", style: { display: "flex", alignItems: "center", gap: 10 } }, c.name, rc("span", { className: "pc-help-tip tip-down", "data-tip": "This is a project folder. It holds all billing periods, labor costs, material costs, and documents for one construction project. Click 'Open Project' to manage it.", onClick: (e) => e.stopPropagation() }, "?")),
            rc("div", { className: "pcf-ph-loc" + (c.location ? "" : " muted") }, pinSvg, c.location || "No location set"),
            rc("div", null, rc("span", { className: "pcf-status-chip " + st.cls }, rc("span", { className: "pcf-dot" }), st.label))
          ),
          rc("div", { className: "pcf-ph-actions" },
            rc("button", { className: "pcf-act-btn", title: panelOpen ? "Collapse details" : "Expand details", onClick: () => setPanelOpen((o) => !o), style: { transition: "transform .15s ease", transform: panelOpen ? "rotate(180deg)" : "rotate(0deg)" } }, rc("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, rc("polyline", { points: "6 9 12 15 18 9" }))),
            rc("button", { className: "pcf-act-btn", title: "AI budget summary", onClick: () => window.aiSummarizeFolder && window.aiSummarizeFolder({ name: c.name, location: c.location, revenue: c.revenue, allocated: c.allocated, labor: c.labor, material: c.material, overhead: c.overhead || 0, coverCost: c.coverCost, remaining: c.remaining, spentPct: c.spentPct, periodCount: c.periodCount, statusLabel: st.label }) }, Ico.sparkles),
            rc("button", { className: "pcf-act-btn", title: "Edit folder", onClick: () => openEdit(c.id) }, Ico.pencil),
            rc("button", { className: "pcf-act-btn danger", title: "Delete folder", onClick: () => openDelete(c.id) }, Ico.trash)
          )
        ),
        panelOpen && !_staff() && rc("div", { className: "pcf-stats" },
          rc("div", { className: "pcf-stat" }, rc("div", { className: "pcf-stat-label" }, "Contract Budget"), rc("div", { className: "pcf-stat-value" }, _staff() ? rc("span", { style: { color: "#908A81" } }, "—") : cur(c.revenue))),
          rc("div", { className: "pcf-stat" }, rc("div", { className: "pcf-stat-label" }, "Billing Periods"), rc("div", { className: "pcf-stat-value" }, c.periodCount), rc("div", { className: "pcf-stat-note" }, (c.periodCount === 1 ? "1 period" : c.periodCount + " periods") + " recorded")),
          rc("div", { className: "pcf-stat" }, rc("div", { className: "pcf-stat-label" }, "Labor"), rc("div", { className: "pcf-stat-value" }, _staff() ? rc("span", { style: { color: "#908A81" } }, "—") : cur(c.labor))),
          rc("div", { className: "pcf-stat" }, rc("div", { className: "pcf-stat-label" }, "Materials"), rc("div", { className: "pcf-stat-value" }, _staff() ? rc("span", { style: { color: "#908A81" } }, "—") : cur(c.material)))
        ),
        panelOpen && rc("div", { className: "pcf-periods" },
          rc("div", { className: "pcf-periods-top" }, rc("span", { className: "pcf-periods-label" }, "Billing periods"), rc("span", { className: "pcf-periods-count" }, c.periodCount > 0 ? c.periodCount + " of " + SEGN + " recorded" : "None yet")),
          c.periodCount > 0 ? rc("div", { className: "pcf-seg-row" }, segs) : rc("p", { className: "pcf-periods-empty" }, "No billing periods recorded. Add the first period to begin tracking labor and materials.")
        ),
        panelOpen && !_staff() && c.status === "attn" && c.note ? rc("div", { className: "pcf-attn" }, warnSvg, rc("div", null, rc("b", null, "Needs attention. "), c.note)) : null,
        rc("div", { className: "pcf-panel-foot" },
          rc("span", { className: "pcf-foot-meta" }, "Folder " + String(idx + 1).padStart(2, "0") + " of " + cards.length),
          rc("button", { className: "pcf-open-btn", onClick: () => onPickFolder(c.id) }, "Open Project ", rc("svg", { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, rc("line", { x1: 5, y1: 12, x2: 19, y2: 12 }), rc("polyline", { points: "12 5 19 12 12 19" })))
        )
      )
    );
  })();
  // ── Company P&L ────────────────────────────────────────────────
  const _measured = cards.filter((c) => !_projMargin(c).isForecast).length;
  const _grossProfit = cards.reduce((s2, c) => s2 + _recognisedProfit(c), 0);
  const _coOverhead = _companyOverhead(overheadRaw);
  const _netProfit = _grossProfit - _coOverhead;
  const _pnlCell = (lbl, val, sub2, tone) => rc("div", { style: { flex: "1 1 180px", minWidth: 160 } },
    rc("div", { style: { font: "600 10.5px 'IBM Plex Sans'", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-light)", marginBottom: 6 } }, lbl),
    rc("div", { style: { font: "700 20px 'IBM Plex Sans'", color: tone === "neg" ? "#c0392b" : (tone === "pos" ? "#1A5C3A" : "var(--ink)") } }, "\u20B1 " + peso(val)),
    sub2 ? rc("div", { style: { font: "400 11px 'IBM Plex Sans'", color: "var(--text-light)", marginTop: 3 } }, sub2) : null);
  const _pnlStrip = rc("div", { style: { border: "1px solid #e7e6e2", borderRadius: 14, background: "#fff", padding: "18px 20px", marginBottom: 14 } },
    rc("div", { style: { font: "600 13px 'IBM Plex Sans'", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 } },
      "Company Profit \xB7 To Date",
      rc("span", { className: "pc-help-tip", "data-tip": "Gross profit earned across all projects, minus company overhead (office rent, admin, software). Projects with no accomplishment report recognise no profit yet \u2014 only losses, if their costs already exceed the contract." }, "?")),
    rc("div", { style: { display: "flex", flexWrap: "wrap", gap: 18 } },
      _pnlCell("Gross Profit \xB7 Projects", _grossProfit, _measured + " of " + cards.length + " measured by accomplishment", _grossProfit < 0 ? "neg" : null),
      _pnlCell("Company Overhead", _coOverhead, "G&A \xB7 not charged to any job", null),
      _pnlCell(_netProfit < 0 ? "Net Loss" : "Net Profit", _netProfit, "Gross profit \u2212 company overhead", _netProfit < 0 ? "neg" : "pos")),
    _measured < cards.length ? rc("div", { style: { font: "400 11.5px 'IBM Plex Sans'", color: "var(--text-light)", marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0efec" } },
      (cards.length - _measured) + " project" + (cards.length - _measured === 1 ? "" : "s") + " have no accomplishment report yet, so they book no profit here (losses are still counted). Update their accomplishment reports to see their real contribution.") : null);

  return /* @__PURE__ */ React.createElement(React.Fragment, null, header, !_staff() && /* @__PURE__ */ React.createElement("button", { className: "pc-reminder pc-reminder-" + _hcKind, onClick: runHealthCheck, title: "Click for the full AI briefing" }, /* @__PURE__ */ React.createElement("span", { className: "pc-reminder-icon" }, _hcIconSvg[_hcKind]), /* @__PURE__ */ React.createElement("span", { className: "pc-reminder-text" }, /* @__PURE__ */ React.createElement("strong", null, _hcTitle), " ", _hcMsg), /* @__PURE__ */ React.createElement("span", { className: "pc-reminder-cta" }, "View details \u2192")), /* @__PURE__ */ !_staff() && _pnlStrip, /* @__PURE__ */ React.createElement("div", { className: "pc-fld-grid" }, cards.map((c) => /* @__PURE__ */ React.createElement("div", { key: c.id, className: "pc-fld-card-wrap" }, /* @__PURE__ */ React.createElement("button", { className: "pc-fld-card", onClick: () => onPickFolder(c.id) }, /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-name", style: { display: "flex", alignItems: "center", gap: 8 } }, c.name, /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "This is a project folder. It holds all billing periods, labor costs, material costs, and documents for one construction project. Click ‘Open Project’ to manage it.", onClick: (e) => e.stopPropagation() }, "?"), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": openCards[c.id] ? "Collapse" : "Expand", onClick: (e) => { e.stopPropagation(); setOpenCards((s) => ({ ...s, [c.id]: !s[c.id] })); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", color: "var(--brand-green)", transition: "transform .15s ease", transform: openCards[c.id] ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), c.location && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-loc" }, c.location)), openCards[c.id] && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-stats" }, !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Total Contract"), "            ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(c.revenue))), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Total Fund Allocated"), "      ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(c.allocated))), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Current Fund Spent"), "        ", /* @__PURE__ */ React.createElement("span", { className: "val pc-fld-stat-accent" }, "\u20B1 ", peso(_projSpent(c)))), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Cover Expenses"), "            ", /* @__PURE__ */ React.createElement("span", { className: "val" + (c.coverCost > COVER_LIMIT ? " pc-fld-stat-warn" : "") }, "\u20B1 ", peso(c.coverCost))), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Remaining"), "                 ", /* @__PURE__ */ React.createElement("span", { className: "val " + (c.remaining >= 0 ? "pc-fld-stat-accent" : "pc-fld-stat-warn") }, "\u20B1 ", peso(c.remaining)))), openCards[c.id] && !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-health" }, /* @__PURE__ */ React.createElement("span", { className: "pc-fld-health-badge " + c.h.cls }, c.h.label), /* @__PURE__ */ React.createElement("span", { className: "pc-fld-card-pct" }, c.spentPct.toFixed(1), "%")), openCards[c.id] && !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-progress" }, /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-progress-fill", style: { width: c.spentPct + "%", background: c.h.barClr } })), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-meta" }, c.periodCount, " billing period", c.periodCount !== 1 ? "s" : ""), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-cta" }, "Open Project ", /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 6 } }, "\u2192"))), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-actions" }, /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "AI budget summary", onClick: (e) => {
    e.stopPropagation();
    window.aiSummarizeFolder && window.aiSummarizeFolder({ name: c.name, location: c.location, revenue: c.revenue, allocated: c.allocated, labor: c.labor, material: c.material, overhead: c.overhead || 0, coverCost: c.coverCost, remaining: c.remaining, spentPct: c.spentPct, periodCount: c.periodCount, statusLabel: c.h.label });
  } }, Ico.sparkles), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "Edit folder", onClick: (e) => openEdit(c.id, e) }, Ico.pencil), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon pc-row-icon-danger", title: "Delete folder", onClick: (e) => openDelete(c.id, e) }, Ico.trash))))));
}
function PageHead({ project, projects, onSelectProject, period, onPeriod, onBackToGrid, parentFolder }) {
  const [open, setOpen] = React.useState(false);
  const [pOpen, setPOpen] = React.useState(false);
  const PERIODS = ["This Month", "Last 30 days", "Quarter to Date", "Year to Date", "All Time"];
  return /* @__PURE__ */ React.createElement("header", { className: "pc-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-head-text" }, /* @__PURE__ */ React.createElement("div", { className: "pc-head-eyebrow" }, (parentFolder ? /* @__PURE__ */ React.createElement("button", { className: "pc-head-back", onClick: () => onSelectProject(parentFolder.id), title: "Back to " + parentFolder.name }, "\u2190 Back to " + parentFolder.name) : (onBackToGrid && /* @__PURE__ */ React.createElement("button", { className: "pc-head-back", onClick: onBackToGrid, title: "Go back to All Folders" }, "\u2190 All Folders"))), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: (onBackToGrid || parentFolder) ? 10 : 0 } }, "Project Control")), /* @__PURE__ */ React.createElement("h1", { className: "pc-head-title" }, project.name), /* @__PURE__ */ React.createElement("div", { className: "pc-head-sub" }, /* @__PURE__ */ React.createElement("span", { className: "pc-code" }, project.code), project.location && /* @__PURE__ */ React.createElement("span", null, project.location))), /* @__PURE__ */ React.createElement("div", { className: "pc-head-controls" }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("button", { className: "pc-pill", onClick: () => setOpen((o) => !o) }, Ico.bldg, /* @__PURE__ */ React.createElement("span", { className: "pc-pill-lbl" }, "Project"), /* @__PURE__ */ React.createElement("span", { className: "pc-pill-val" }, project.name), Ico.chevron), open && /* @__PURE__ */ React.createElement("div", { className: "dropdown", style: dropdownStyle }, projects.map((p) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: p.id,
      className: "dropdown-item",
      style: { ...itemStyle, fontWeight: p.id === project.id ? 600 : 500 },
      onClick: () => {
        onSelectProject(p.id);
        setOpen(false);
      }
    },
    /* @__PURE__ */ React.createElement("span", null, p.name),
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--ink-3)", marginLeft: "auto" } }, p.code)
  )))), /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("button", { className: "pc-pill", onClick: () => setPOpen((o) => !o) }, Ico.calendar, /* @__PURE__ */ React.createElement("span", { className: "pc-pill-val" }, period), Ico.chevron), pOpen && /* @__PURE__ */ React.createElement("div", { className: "dropdown", style: dropdownStyle }, PERIODS.map((p) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: p,
      className: "dropdown-item",
      style: itemStyle,
      onClick: () => {
        onPeriod(p);
        setPOpen(false);
      }
    },
    p
  )))), /* @__PURE__ */ React.createElement("button", { className: "pc-btn-ghost", onClick: () => window.printFullBillingSummary && window.printFullBillingSummary(), title: "Print full billing summary" }, Ico.download, " Print Summary"), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "pc-row-icon",
      title: "Edit folder",
      onClick: () => window.openEditFolderModal && window.openEditFolderModal(project.id)
    },
    Ico.pencil
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "pc-row-icon pc-row-icon-danger",
      title: "Delete folder",
      onClick: () => window.confirmDeleteFolder && window.confirmDeleteFolder(project.id)
    },
    Ico.trash
  )));
}
function ExpenseInboxMount({ folderId, label, kind }) {
  React.useEffect(() => {
    const fn = kind === "labor" ? window.expenseInboxRenderPortalLabor : kind === "material" ? window.expenseInboxRenderPortalMaterial : kind === "overhead" ? window.expenseInboxRenderPortalOverhead : window.expenseInboxRenderPortal;
    if (fn) fn(folderId, label);
  }, [folderId, label, kind]);
  const id = kind === "labor" ? "eiPanelPortalLabor" : kind === "material" ? "eiPanelPortalMaterial" : kind === "overhead" ? "eiPanelPortalOverhead" : "eiPanelPortal";
  return /* @__PURE__ */ React.createElement("div", { id });
}
function KPIStrip({ project }) {
  const [amountsHidden, setAmountsHidden] = React.useState(true);
  const spent = _projSpent(project);
  const allocated = project.allocated || 0;
  const remaining = allocated - spent;
  if (_staff()) {
    const _cv = project.coverCost || 0;
    const _isOver = _cv > COVER_LIMIT;
    return React.createElement("div", { className: "pc-sm-contract" + (_isOver ? " pc-sm-contract--danger" : ""), style: { borderRadius: 14, marginBottom: 12 } },
      React.createElement("div", { className: "pc-sm-contract-text" },
        React.createElement("div", { className: "pc-sm-contract-lbl" }, "Cover Expenses"),
        React.createElement("div", { className: "pc-sm-contract-sub" }, "Company-wide overhead · cover costs")
      ),
      React.createElement("div", { className: "pc-sm-hero-figures" },
        React.createElement("div", { className: "pc-sm-contract-val" }, "₱ ", peso(_cv)),
        React.createElement("div", { className: "pc-sm-hero-margin" },
          React.createElement("div", { className: "pc-sm-hero-margin-val", style: _isOver ? { color: "#fca5a5" } : {} }, _isOver ? "OVER LIMIT" : "OK"),
          React.createElement("div", { className: "pc-sm-hero-margin-lbl" }, _isOver ? "₱" + COVER_LIMIT.toLocaleString("en-PH") + " limit" : "Within limit")
        )
      )
    );
  }
  const kpis = _staff() ? [
    { lbl: "Cover Expenses", val: "\u20B1 " + peso(project.coverCost || 0), danger: (project.coverCost || 0) > COVER_LIMIT }
  ] : [
    { lbl: "Contract", val: "\u20B1 " + peso(project.revenue) },
    { lbl: "Total Fund Allocated", val: "\u20B1 " + peso(allocated) },
    { lbl: "Spent", val: "\u20B1 " + peso(spent) },
    { lbl: "Remaining", val: "\u20B1 " + peso(remaining), accent: remaining >= 0, warn: remaining < 0 },
    { lbl: "Cover Expenses", val: "\u20B1 " + peso(project.coverCost || 0), danger: (project.coverCost || 0) > COVER_LIMIT }
  ];
  return /* @__PURE__ */ React.createElement("section", { className: "pc-kpi-strip" + (_staff() ? " staff-kpi-single" : ""), style: (amountsHidden && !_staff()) ? { position: "relative", padding: "8px 0", marginBottom: 12 } : { position: "relative" } }, (amountsHidden && !_staff()) ? /* @__PURE__ */ React.createElement("div", { className: "pc-kpi", style: { borderRight: 0 } }, /* @__PURE__ */ React.createElement("span", { className: "pc-kpi-lbl" }, "Financial summary hidden — click the eye to show")) : kpis.map((k, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "pc-kpi" }, /* @__PURE__ */ React.createElement("span", { className: "pc-kpi-lbl" }, k.lbl), /* @__PURE__ */ React.createElement("span", { className: "pc-kpi-val" + (k.accent ? " pc-accent" : "") + (k.warn ? " pc-warn" : "") + (k.danger ? " pc-danger" : "") }, k.val), k.danger && /* @__PURE__ */ React.createElement("span", { className: "pc-over-badge" }, "Over \u20B1", COVER_LIMIT.toLocaleString("en-PH")))), _staff() ? null : /* @__PURE__ */ React.createElement("button", { type: "button", "aria-label": amountsHidden ? "Show amounts" : "Hide amounts", title: amountsHidden ? "Show amounts" : "Hide amounts", onClick: () => setAmountsHidden((h) => !h), style: { position: "absolute", top: 8, right: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: 0, borderRadius: 8, background: "transparent", color: "var(--text-light)", cursor: "pointer" } }, amountsHidden ? /* @__PURE__ */ React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" }), /* @__PURE__ */ React.createElement("line", { x1: 1, y1: 1, x2: 23, y2: 23 })) : /* @__PURE__ */ React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" }), /* @__PURE__ */ React.createElement("circle", { cx: 12, cy: 12, r: 3 }))));
}
function FlowCards({ project, onOpen, periodCount, additionalWorksTotal, additionalWorksCount, isAdditionalWorks }) {
  const [laborOpen, setLaborOpen] = React.useState(false);
  const [materialOpen, setMaterialOpen] = React.useState(false);
  const [overheadOpen, setOverheadOpen] = React.useState(false);
  const [periodsOpen, setPeriodsOpen] = React.useState(false);
  const lb = project.laborBreakdown;
  const dc = project.docCounts;
  const matCount = project.materialCount || 0;
  const docsAttached = dc.po + dc.dr + dc.si + dc.pay;
  const docsExpected = matCount * 4;
  return /* @__PURE__ */ React.createElement("div", { className: "pc-flow-cards" }, /* @__PURE__ */ React.createElement("button", { className: "pc-flow-card" + (laborOpen ? "" : " pc-flow-card--collapsed") + (_staff() && laborOpen ? " staff-flow-empty" : ""), onClick: () => onOpen("labor") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon" }, Ico.users), "Labor Cost", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Total wages and payroll paid to all workers on site. Includes direct labor, indirect labor, and liability costs.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Transaction History \u2192"), _staff() ? null : /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": laborOpen ? "Collapse labor breakdown" : "Expand labor breakdown", onClick: (e) => { e.stopPropagation(); setLaborOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: laborOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), _staff() ? null : (laborOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ _staff() ? null : React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "\u20B1"), peso(project.labor)), _staff() ? null : /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "By Tag"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot" }), "Direct"), "    ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(lb.direct))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot c" }), "Liability"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(lb.liability)))))),/* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Labor Total \xB7 Actual"), /* @__PURE__ */ React.createElement("span", { className: _staff() ? "val val-split" : "val" }, _staff() ? /* @__PURE__ */ React.createElement(React.Fragment, null, (project.revenue > 0 ? (project.labor / project.revenue * 100).toFixed(1) + "%" : "—"), project.revenue > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pc-labor-formula", style: { marginLeft: 8 } }, "(Labor Total ÷ Contract Amount) × 100") : null) : /* @__PURE__ */ React.createElement(React.Fragment, null, React.createElement("div", { className: "pc-labor-row" }, React.createElement("span", { className: "pc-labor-currency" }, "₱"), React.createElement("span", { className: "pc-labor-amount" }, peso(project.labor)), project.revenue > 0 ? React.createElement("span", { className: "pc-labor-pct" }, (project.labor / project.revenue * 100).toFixed(1) + "%") : null, project.revenue > 0 ? React.createElement("span", { className: "pc-labor-formula" }, "(Labor Total ÷ Contract Amount) × 100") : null)))))  , /* @__PURE__ */ React.createElement("button", { className: "pc-flow-card" + (materialOpen ? "" : " pc-flow-card--collapsed") + (_staff() && materialOpen ? " staff-flow-empty" : ""), onClick: () => onOpen("material") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-amber" }, Ico.package), "Material Cost", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Total cost of all materials purchased for the project. Each transaction has supporting documents like PO, delivery receipt, invoice, and payment slip.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Transaction History \u2192"), _staff() ? null : /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": materialOpen ? "Collapse material breakdown" : "Expand material breakdown", onClick: (e) => { e.stopPropagation(); setMaterialOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: materialOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), _staff() ? null : (materialOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ _staff() ? null : React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "\u20B1"), peso(project.material)), _staff() ? null : /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "Per-Transaction Files"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Transactions"), "          ", /* @__PURE__ */ React.createElement("span", { className: "val" }, matCount)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Files Attached"), "        ", /* @__PURE__ */ React.createElement("span", { className: "val" }, docsAttached, " / ", docsExpected || 0)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item", style: { fontSize: 11.5, color: "var(--text-light)" } }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "PO \xB7 Delivery \xB7 Invoice \xB7 Payment"))))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Material Total \xB7 Actual"), /* @__PURE__ */ React.createElement("span", { className: _staff() ? "val val-split" : "val" }, _staff() ? /* @__PURE__ */ React.createElement(React.Fragment, null, (project.revenue > 0 ? (project.material / project.revenue * 100).toFixed(1) + "%" : "—"), project.revenue > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pc-labor-formula", style: { marginLeft: 8 } }, "(Material Total ÷ Contract Amount) × 100") : null) : /* @__PURE__ */ React.createElement("div", { className: "pc-labor-row" }, React.createElement("span", { className: "pc-labor-currency" }, "₱"), React.createElement("span", { className: "pc-labor-amount" }, peso(project.material)), project.revenue > 0 ? React.createElement("span", { className: "pc-labor-pct" }, (project.material / project.revenue * 100).toFixed(1) + "%") : null, project.revenue > 0 ? React.createElement("span", { className: "pc-labor-formula" }, "(Material Total ÷ Contract Amount) × 100") : null)))), /* @__PURE__ */ React.createElement("button", { className: "pc-flow-card" + (overheadOpen ? "" : " pc-flow-card--collapsed") + (_staff() && overheadOpen ? " staff-flow-empty" : ""), onClick: () => onOpen("overhead") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-purple" }, Ico.briefcase), "Overhead Cost", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Project overhead — the support people (coordinator, site supervision, procurement) plus site operating costs (utilities, fuel, rent, permits). Counted against the project's profit.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Transaction History →"), _staff() ? null : /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": overheadOpen ? "Collapse overhead breakdown" : "Expand overhead breakdown", onClick: (e) => { e.stopPropagation(); setOverheadOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: overheadOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), _staff() ? null : (overheadOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "₱"), peso(project.overhead || 0)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "By Type"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot" }), "Indirect Labor"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "₱ ", peso((project.overheadBreakdown || {}).indirectLabor || 0))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot b" }), "Operating Costs"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "₱ ", peso((project.overheadBreakdown || {}).expenses || 0))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item", style: { fontSize: 11.5, color: "var(--text-light)" } }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Coordinator · Supervision · Procurement · Utilities · Rent"))))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Overhead Total \xB7 Actual"), /* @__PURE__ */ React.createElement("span", { className: _staff() ? "val val-split" : "val" }, _staff() ? /* @__PURE__ */ React.createElement(React.Fragment, null, (project.revenue > 0 ? ((project.overhead || 0) / project.revenue * 100).toFixed(1) + "%" : "—"), project.revenue > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pc-labor-formula", style: { marginLeft: 8 } }, "(Overhead Total ÷ Contract Amount) × 100") : null) : /* @__PURE__ */ React.createElement("div", { className: "pc-labor-row" }, React.createElement("span", { className: "pc-labor-currency" }, "₱"), React.createElement("span", { className: "pc-labor-amount" }, peso(project.overhead || 0)), project.revenue > 0 ? React.createElement("span", { className: "pc-labor-pct" }, ((project.overhead || 0) / project.revenue * 100).toFixed(1) + "%") : null, project.revenue > 0 ? React.createElement("span", { className: "pc-labor-formula" }, "(Overhead Total ÷ Contract Amount) × 100") : null)))), isAdditionalWorks ? null : (/* @__PURE__ */ React.createElement("button", { className: "pc-flow-card" + (periodsOpen ? "" : " pc-flow-card--collapsed") + (_staff() && periodsOpen ? " staff-flow-empty" : ""), onClick: () => onOpen("periods") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-blue" }, Ico.calendar), "Billing Periods", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Billing periods are monthly cycles where project funds are allocated. Each period tracks how much was spent on labor and materials versus what was budgeted.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Manage Periods \u2192"), _staff() ? null : /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": periodsOpen ? "Collapse period breakdown" : "Expand period breakdown", onClick: (e) => { e.stopPropagation(); setPeriodsOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: periodsOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), _staff() ? null : (periodsOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }), periodCount), _staff() ? null : /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "Allocation by Period"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot" }), "Total Allocated"), "  ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(project.allocated))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot b" }), "Total Spent"), "    ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(project.laborBreakdown.total + project.material))), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot c" }), "Remaining"), "      ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(project.allocated - (project.laborBreakdown.total + project.material))))))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Periods \xB7 Count"), /* @__PURE__ */ React.createElement("span", { className: "val" }, periodCount)))), /* @__PURE__ */ React.createElement("button", { className: "pc-flow-card pc-flow-card--collapsed", onClick: () => onOpen("additionalWorks") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-teal" }, Ico.hard), "Additional Works", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Extra scope added to this project after the original contract (contract extensions / change orders). Record each Additional Works BOQ here.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Manage →")), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Additional Works · Total"), /* @__PURE__ */ React.createElement("span", { className: "val" }, _staff() ? (additionalWorksCount || 0) + " entr" + ((additionalWorksCount || 0) === 1 ? "y" : "ies") : "₱ " + peso(additionalWorksTotal || 0)))));
}
function Summarize({ project }) {
  const [eqOpen, setEqOpen] = React.useState(false);
  const actualCost = _projSpent(project);
  const _m = _projMargin(project);
  const grossProfit = _m.profit;
  if (_staff()) {
    return null;
  }
  const margin = _m.pct == null ? 0 : _m.pct;
  const isLoss = grossProfit < 0;
  // No accomplishment data => the figure assumes the job runs to completion.
  // It must never be presented as an earned margin.
  const _cp = _m.isForecast ? null : _m.completePct.toFixed(1);
  const _heroLbl = (isLoss ? "Gross Loss" : "Gross Profit") + (_m.isForecast ? " \xB7 Forecast" : " \xB7 Earned");
  const _heroSub = _m.isForecast
    ? "Contract \u2212 Actual cost \xB7 assumes the job is completed"
    : "Earned revenue \u2212 Actual cost \xB7 " + _cp + "% complete";
  const _marginLbl = _m.isForecast ? "Forecast margin" : "Earned margin";
  const _revLbl = _m.isForecast ? "Contract Revenue" : "Earned Revenue";
  const _revSub = _m.isForecast ? "Full contract \xB7 not yet earned" : _cp + "% of contract accomplished";
  return /* @__PURE__ */ React.createElement("section", { className: "pc-summarize pc-summarize-stacked" }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "pc-sm-contract",
      style: isLoss ? { background: "linear-gradient(135deg, #b00020 0%, #d64545 100%)" } : void 0
    },
    /* @__PURE__ */ React.createElement("div", { className: "pc-sm-contract-text" }, /* @__PURE__ */ React.createElement("div", { className: "pc-sm-contract-lbl" }, _heroLbl), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-contract-sub" }, _heroSub)),
    /* @__PURE__ */ React.createElement("div", { className: "pc-sm-hero-figures" }, /* @__PURE__ */ React.createElement("div", { className: "pc-sm-contract-val" }, "\u20B1 ", peso(grossProfit)), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-hero-margin" }, /* @__PURE__ */ React.createElement("div", { className: "pc-sm-hero-margin-val" }, margin.toFixed(1), "%"), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-hero-margin-lbl" }, _marginLbl)), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": eqOpen ? "Collapse breakdown" : "Expand breakdown", onClick: (e) => { e.stopPropagation(); setEqOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", color: "#fff", opacity: 0.9, transition: "transform .15s ease", transform: eqOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" }))))
  ), eqOpen && /* @__PURE__ */ React.createElement("div", { className: "pc-sm-equation" }, /* @__PURE__ */ React.createElement("div", { className: "pc-sm-label" }, _revLbl, /* @__PURE__ */ React.createElement("div", { className: "sub" }, _revSub)), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-val" }, "\u20B1 ", peso(_m.earned)), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-op" }, "\u2212"), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-label" }, "Actual Cost", /* @__PURE__ */ React.createElement("div", { className: "sub" }, "Labor + Material + Overhead")), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-val" }, "\u20B1 ", peso(actualCost)), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-op" }, "="), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-label" }, "Gross Profit", /* @__PURE__ */ React.createElement("div", { className: "sub" }, margin.toFixed(1), "% margin")), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-val " + (isLoss ? "warn" : "accent") }, "\u20B1 ", peso(grossProfit))));
}
function BillingPeriodsDrill({ project, childMonths, payrollRaw, expensesRaw, onBack }) {
  const openCreate = () => {
    if (typeof window.openCreateMonthModal === "function") window.openCreateMonthModal(project.id);
  };
  const openEdit = (id) => window.openEditProjectModal && window.openEditProjectModal(id);
  const openDelete = (id) => window.confirmDeleteProject && window.confirmDeleteProject(id);
  const openDetail = (id) => window.mvpOvOpenPeriodDetail && window.mvpOvOpenPeriodDetail(project.id, id);
  const FUNDING_LBLS = {
    mobilization: "Mobilization",
    downpayment: "Downpayment",
    progress: "Progress Billing",
    final: "Final Payment",
    president: "Cover Expenses"
  };
  const cards = childMonths.map((m) => {
    const mat = expensesRaw.filter((e) => e.projectId === m.id).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const lab = payrollRaw.filter((p) => p.projectId === m.id).reduce((s, p) => s + (Number(p.totalSalary) || 0), 0);
    const totalCost = mat + lab;
    const budget = m.monthlyBudget;
    const noBudget = budget <= 0;
    const remain = budget - totalCost;
    const spentPct = budget > 0 ? Math.min(totalCost / budget * 100, 100) : totalCost > 0 ? 100 : 0;
    const remPct = 100 - spentPct;
    const expCount = expensesRaw.filter((e) => e.projectId === m.id).length;
    const payCount = payrollRaw.filter((p) => p.projectId === m.id).length;
    const fundingLabel = FUNDING_LBLS[m.fundingType] || "Billing Period";
    let healthCls, healthLabel, barClr;
    if (noBudget) {
      if (totalCost > 0) {
        healthCls = "pc-fld-health-warning";
        healthLabel = "NO BUDGET";
        barClr = "#A86B00";
      } else {
        healthCls = "pc-fld-health-healthy";
        healthLabel = "EMPTY";
        barClr = "#E5E5E5";
      }
    } else if (remPct < 0) {
      healthCls = "pc-fld-health-critical";
      healthLabel = "OVER";
      barClr = "#c0392b";
    } else if (remPct < 20) {
      healthCls = "pc-fld-health-warning";
      healthLabel = "WARNING";
      barClr = "#A86B00";
    } else {
      healthCls = "pc-fld-health-healthy";
      healthLabel = "HEALTHY";
      barClr = "#1A5C3A";
    }
    return { id: m.id, label: `${m.month || ""} ${m.year || ""}`.trim(), fundingLabel, budget, mat, lab, totalCost, remain, noBudget, spentPct, healthCls, healthLabel, barClr, expCount, payCount };
  }).sort((a, b) => (b.label || "").localeCompare(a.label || ""));
  const totalAllocated = cards.reduce((s, c) => s + c.budget, 0);
  const totalSpent = cards.reduce((s, c) => s + c.totalCost, 0);
  return /* @__PURE__ */ React.createElement("section", { className: "drill" }, /* @__PURE__ */ React.createElement("button", { className: "back-btn", onClick: onBack, title: "Go back to Project Control" }, Ico.arrowL, " Back to Project Control"), /* @__PURE__ */ React.createElement("div", { className: "drill-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Billing Periods \xB7 Monthly Budgets"), /* @__PURE__ */ React.createElement("h2", null, "Billing Periods"), /* @__PURE__ */ React.createElement("div", { className: "sub" }, project.name, " \xB7 ", project.code)), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: openCreate }, Ico.plus, " New Billing Period")), /* @__PURE__ */ _staff() ? null : React.createElement("div", { className: "drill-stats" }, /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Periods"), /* @__PURE__ */ React.createElement("div", { className: "val" }, cards.length)), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Total Allocated"), /* @__PURE__ */ React.createElement("div", { className: "val" }, "\u20B1 ", peso(totalAllocated))), /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Total Spent"), /* @__PURE__ */ React.createElement("div", { className: "val" }, "\u20B1 ", peso(totalSpent))), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Remaining"), /* @__PURE__ */ React.createElement("div", { className: "val " + (totalAllocated - totalSpent >= 0 ? "total" : "") }, "\u20B1 ", peso(totalAllocated - totalSpent)))), cards.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "pc-feed-empty", style: { padding: "48px 0" } }, 'No billing periods yet. Click "New Billing Period" to create your first one.') : /* @__PURE__ */ React.createElement("div", { className: "pc-period-grid" }, cards.map((c) => /* @__PURE__ */ React.createElement("div", { key: c.id, className: "pc-period-card" }, /* @__PURE__ */ React.createElement("div", { className: "pc-period-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-period-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-period-name" }, c.label), /* @__PURE__ */ React.createElement("div", { className: "pc-period-funding" }, c.fundingLabel)), /* @__PURE__ */ React.createElement("div", { className: "pc-period-actions" }, /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "Edit period", onClick: () => openEdit(c.id) }, Ico.pencil), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon pc-row-icon-danger", title: "Delete period", onClick: () => openDelete(c.id) }, Ico.trash))), /* @__PURE__ */ React.createElement("div", { className: "pc-period-stats" }, !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-period-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Period Budget"), " ", /* @__PURE__ */ React.createElement("span", { className: "val" }, c.noBudget ? /* @__PURE__ */ React.createElement("em", { style: { color: "var(--text-light)", fontStyle: "normal", fontSize: 12 } }, "Not set") : "\u20B1 " + peso(c.budget))), /* @__PURE__ */ React.createElement("div", { className: "pc-period-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Materials"), "     ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(c.mat))), /* @__PURE__ */ React.createElement("div", { className: "pc-period-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Labor"), "         ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(c.lab))), /* @__PURE__ */ React.createElement("div", { className: "pc-period-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Spent"), "         ", /* @__PURE__ */ React.createElement("span", { className: "val pc-fld-stat-accent" }, "\u20B1 ", peso(c.totalCost))), !_staff() && !c.noBudget && /* @__PURE__ */ React.createElement("div", { className: "pc-period-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Remaining"), /* @__PURE__ */ React.createElement("span", { className: "val " + (c.remain >= 0 ? "pc-fld-stat-accent" : "pc-fld-stat-warn") }, "\u20B1 ", peso(c.remain)))), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-health" }, /* @__PURE__ */ React.createElement("span", { className: "pc-fld-health-badge " + c.healthCls }, c.healthLabel), /* @__PURE__ */ React.createElement("span", { className: "pc-fld-card-pct" }, c.noBudget ? c.totalCost > 0 ? "No budget" : "Empty" : c.spentPct.toFixed(1) + "% used")), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-progress" }, /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-progress-fill", style: { width: c.spentPct + "%", background: c.barClr } })), /* @__PURE__ */ React.createElement("div", { className: "pc-period-meta" }, c.expCount, " expense", c.expCount !== 1 ? "s" : "", " \xB7 ", c.payCount, " payroll entr", c.payCount !== 1 ? "ies" : "y")))));
}
function RecentEntries({ onOpen, laborTx, materialTx }) {
  const [tab, setTab] = React.useState("all");
  const [feedOpen, setFeedOpen] = React.useState(false);
  const items = [
    ...laborTx.map((t) => ({ ...t, kind: "labor" })),
    ...materialTx.map((t) => ({ ...t, kind: "material" }))
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const filtered = (tab === "all" ? items : items.filter((i) => i.kind === tab)).slice(0, 10);
  const tabs = [
    ["all", "All", items.length],
    ["labor", "Labor", laborTx.length],
    ["material", "Material", materialTx.length]
  ];
  return /* @__PURE__ */ React.createElement("section", { className: "pc-card", style: feedOpen ? void 0 : { paddingTop: 14, paddingBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "pc-card-head", style: feedOpen ? void 0 : { marginBottom: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, React.createElement("h3", null, "Recent Entries"), React.createElement("span", { className: "pc-help-tip", "data-tip": "A live feed of the latest labor and material transactions recorded in this project. Use the tabs to filter by All, Labor, or Material entries.", onClick: (e) => e.stopPropagation() }, "?"), React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": feedOpen ? "Collapse recent entries" : "Expand recent entries", onClick: (e) => { e.stopPropagation(); setFeedOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", color: "var(--brand-green)", transition: "transform .15s ease", transform: feedOpen ? "rotate(180deg)" : "rotate(0deg)" } }, React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, React.createElement("polyline", { points: "6 9 12 15 18 9" })))), /* @__PURE__ */ React.createElement("div", { className: "panel-tabs", style: { padding: 3, background: "var(--brand-surface-2)", borderRadius: 8, display: "flex", gap: 2 } }, tabs.map(([k, l, count]) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: k,
      onClick: () => setTab(k),
      style: {
        padding: "5px 12px",
        fontSize: 11.5,
        fontWeight: 600,
        borderRadius: 6,
        border: 0,
        cursor: "pointer",
        background: tab === k ? "#fff" : "transparent",
        color: tab === k ? "var(--text-primary)" : "var(--text-light)",
        boxShadow: tab === k ? "var(--shadow-sm)" : "none",
        letterSpacing: "0.04em"
      }
    },
    l,
    " \xB7 ",
    count
  )))), feedOpen && /* @__PURE__ */ React.createElement("div", { className: "pc-feed" }, filtered.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "pc-feed-empty" }, "No entries in this period."), filtered.map((t, i) => {
    const tagClass = t.kind === "labor" ? "pc-tag-labor" : "pc-tag-material";
    const tagLabel = t.kind === "labor" ? "Labor" : "Material";
    const name = t.name;
    const sub = t.kind === "labor" ? t.role : t.supplier;
    return /* @__PURE__ */ React.createElement("div", { key: t.kind + "-" + (t.id || i), className: "pc-feed-row", onClick: () => onOpen(t.kind) }, /* @__PURE__ */ React.createElement("div", { className: "pc-feed-date" }, fmtDate(t.date)), /* @__PURE__ */ React.createElement("span", { className: "pc-feed-tag " + tagClass }, /* @__PURE__ */ React.createElement("span", { className: "pc-feed-tag-dot" }), tagLabel), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "pc-feed-desc-name" }, name || "\u2014"), sub && /* @__PURE__ */ React.createElement("div", { className: "pc-feed-desc-sub" }, sub)), /* @__PURE__ */ React.createElement("div", { className: "pc-feed-amt" }, "\u20B1 ", peso(t.amount)));
  })));
}
function pickLatestMonth(childMonths) {
  const sorted = childMonths.slice().sort((a, b) => {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    if ((b.year || 0) !== (a.year || 0)) return (b.year || 0) - (a.year || 0);
    return months.indexOf(b.month || "") - months.indexOf(a.month || "");
  });
  return sorted[0] || null;
}
async function ensureAdditionalWorksPeriod(folderId) {
  const uid = window.currentDataUserId || (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null;
  const now = new Date();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  const ref = await db.collection("projects").add({
    userId: uid, month, year, fundingType: "downpayment", folderId,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return { id: ref.id, folderId, month, year, monthlyBudget: 0 };
}
async function openAddEntry(kind, childMonths, folder) {
  let latest = pickLatestMonth(childMonths);
  if (!latest && folder && folder.parentFolderId) {
    try {
      latest = await ensureAdditionalWorksPeriod(folder.id);
    } catch (err) {
      alert("Could not prepare this Additional Works folder: " + (err.message || err));
      return;
    }
  }
  if (!latest) {
    alert("Add a billing period to this folder first via Budget Overview, then return to record entries.");
    return;
  }
  window.expCurrentProject = { id: latest.id, folderId: latest.folderId, month: latest.month, year: latest.year, monthlyBudget: latest.monthlyBudget };
  const modalId = kind === "labor" ? "addPayrollModal" : "addExpenseModal";
  if (typeof window.openExpModal === "function") window.openExpModal(modalId);
}
function ContractRollup({ contracts, folderPayroll, onOpen }) {
  const rc = React.createElement;
  if (!contracts || !contracts.length) return null;
  let agreed = 0, paid = 0;
  contracts.forEach((c) => {
    agreed += Number(c.agreedAmount) || 0;
    paid += (folderPayroll || []).filter((x) => x.contractId === c.id).reduce((s, x) => s + (Number(x.amount) || 0), 0);
  });
  const remaining = agreed - paid;
  return rc("button", { className: "pc-contract-rollup", onClick: () => onOpen && onOpen("labor"), title: "Open the Worker Tracker" },
    rc("div", { className: "pc-cr-label" }, "Contracted Labor ", rc("span", { className: "pc-cr-sub" }, "(" + contracts.length + " contract" + (contracts.length === 1 ? "" : "s") + ") →")),
    rc("div", { className: "pc-cr-figs" },
      rc("div", null, rc("span", null, "Agreed"), rc("strong", null, "₱ ", peso(agreed))),
      rc("div", null, rc("span", null, "Paid"), rc("strong", null, "₱ ", peso(paid))),
      rc("div", null, rc("span", null, "Outstanding"), rc("strong", { className: remaining < 0 ? "lc-neg" : "" }, "₱ ", peso(remaining)))
    )
  );
}
function awLineTotal(item) {
  return (Number(item.materialCost) || 0) + (Number(item.laborCost) || 0);
}
function awCategoryTotal(cat) {
  return (cat.items || []).reduce((s, it) => s + awLineTotal(it), 0);
}
function awSubtotal(categories) {
  return (categories || []).reduce((s, c) => s + awCategoryTotal(c), 0);
}
function awDiscountedTotal(entry) {
  return Math.max(0, awSubtotal(entry.categories) - (Number(entry.discount) || 0));
}
function awItemCount(categories) {
  return (categories || []).reduce((s, c) => s + (c.items || []).length, 0);
}
function _ovhdLocalToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function OverheadDrill({ project, onBack, overheadTx, indirectTx, folderId, ocmPct, contractAmount, allTimeOverhead }) {
  const h = React.createElement;
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ category: "", amount: "", date: _ovhdLocalToday(), description: "" });
  const [saving, setSaving] = React.useState(false);
  const [receiptFile, setReceiptFile] = React.useState(null);   // staged until save
  const OVHD_PALETTE = ["#157a52", "#c8a45a", "#7f9cb0", "#9fb98a", "#b0907f", "#8a7fb0", "#5e9d80", "#c0564a"];
  const catColor = (name) => { let n = 0; const x = String(name || ""); for (let i = 0; i < x.length; i++) n = (n * 31 + x.charCodeAt(i)) >>> 0; return OVHD_PALETTE[n % OVHD_PALETTE.length]; };
  // Overhead = the support people (payroll tagged Overhead / Indirect Labor) + the
  // site operating costs. The payroll rows are read-only here — they are edited in
  // Expenses → Payroll, so they carry no delete button.
  const indirectRows = (indirectTx || []).map((p) => ({
    id: p.id,
    category: p.role ? p.role : "Indirect Labor",
    amount: Number(p.amount) || 0,
    date: p.date || "",
    description: p.name || "",
    fromPayroll: true
  }));
  const allTx = [...indirectRows, ...overheadTx].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  // Suggestions = site operating-cost presets + every category already used on this
  // project's overhead expenses, so a category typed once is offered from then on.
  const OVHD_CAT_PRESETS = ["Electricity", "Water", "Internet", "Rent", "Transportation", "Fuel", "Equipment Rental", "Temporary Utilities", "Site Office Expenses", "Safety Equipment", "Permits & Fees", "Security", "Office Supplies", "Miscellaneous"];
  const catSuggestions = Array.from(new Set(OVHD_CAT_PRESETS.concat(overheadTx.map((x) => x.category).filter(Boolean)))).sort();
  const indirectTotal = indirectRows.reduce((s2, x) => s2 + x.amount, 0);
  const expenseTotal = overheadTx.reduce((s2, x) => s2 + (Number(x.amount) || 0), 0);
  const total = indirectTotal + expenseTotal;
  const count = allTx.length;
  const avg = count ? total / count : 0;
  const byCat = (() => { const m = {}; allTx.forEach((x) => { const c = x.category || "Uncategorized"; m[c] = (m[c] || 0) + (Number(x.amount) || 0); }); return Object.keys(m).map((c) => ({ cat: c, amt: m[c] })).sort((p, q) => q.amt - p.amt); })();
  const esc = (v) => String(v == null ? "" : v);
  const saveEntry = async () => {
    const amt = parseFloat(String(form.amount).replace(/,/g, ""));
    const category = String(form.category || "").trim();
    if (!category) { alert("Please enter a category."); return; }
    if (isNaN(amt) || amt <= 0) { alert("Please enter a valid amount."); return; }
    if (!form.date) { alert("Please select a date."); return; }
    if (!folderId) { alert("Open a project first."); return; }
    setSaving(true);
    try {
      const uid = window.currentDataUserId || (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null;
      // Upload the receipt FIRST — if storage fails we abort instead of saving an
      // expense that claims a receipt it doesn't have.
      let receiptUrl = "";
      if (receiptFile) {
        const ext = (receiptFile.name.split(".").pop() || "jpg").toLowerCase();
        const ref = window.storage.ref("overheadReceipts/" + uid + "_" + Date.now() + "." + ext);
        await ref.put(receiptFile);
        receiptUrl = await ref.getDownloadURL();
      }
      await db.collection("overheadExpenses").add({
        userId: uid,
        // scope is explicit so the admin Overhead page doesn't have to infer it.
        // status is deliberately NOT set: the drill never asks whether the bill was
        // paid, so it defaults to 'pending' and is settled on the Overhead page.
        folderId, scope: "project",
        category, amount: amt, date: form.date, description: form.description || "",
        receiptUrl,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setAdding(false);
      setForm({ category: "", amount: "", date: _ovhdLocalToday(), description: "" });
      setReceiptFile(null);
    } catch (err) { alert("Save failed: " + (err.message || err)); }
    setSaving(false);
  };
  const delEntry = async (id) => {
    if (!confirm("Delete this overhead expense?")) return;
    // Soft delete — matches the admin Overhead page, which keeps the audit trail
    // and filters `deletedAt` on read. A hard delete here would destroy that history.
    try {
      await db.collection("overheadExpenses").doc(id).update({
        deletedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (err) { alert("Delete failed: " + (err.message || err)); }
  };

  const card = (label, value, accent) => h("div", { className: "drill-stat" },
    h("div", { className: "lbl" }, label),
    h("div", { className: "val" + (accent ? " total" : "") }, value));

  const kpis = h("div", { className: "drill-stats" },
    card("Total Overhead", "\u20B1 " + peso(total), true),
    card("Indirect Labor", "\u20B1 " + peso(indirectTotal)),
    card("Operating Costs", "\u20B1 " + peso(expenseTotal)),
    card("Total Entries", count),
    card("Average Per Entry", "\u20B1 " + peso(avg)));

  // \u2500\u2500 OCM allowance: what you PRICED vs what you've SPENT (all-time) \u2500\u2500
  const ocm = _ocmStatus(contractAmount, ocmPct, allTimeOverhead);
  const setOcmPct = async () => {
    const v = prompt(
      "Overhead (OCM) allowance as a % of the contract \u2014 the overhead you priced into the BOQ (typically 8\u201312). Enter 0 to remove.",
      ocmPct || ""
    );
    if (v === null) return;
    const n = parseFloat(String(v).replace(/,/g, ""));
    if (isNaN(n) || n < 0 || n > 100) { alert("Enter a percentage between 0 and 100."); return; }
    try {
      await db.collection("folders").doc(folderId).update({ ocmPct: n });
    } catch (err) { alert("Save failed (is migration 0030 applied?): " + (err.message || err)); }
  };
  const _ocmBtn = (label) => h("button", { onClick: setOcmPct, style: { border: "1px solid #e5e7eb", background: "#fff", borderRadius: 8, padding: "7px 13px", cursor: "pointer", font: "600 12px 'IBM Plex Sans'", color: "#157a52", whiteSpace: "nowrap", flex: "none" } }, label);
  const _ocmFig = (lbl, val, sub, color) => h("div", { style: { minWidth: 150 } },
    h("div", { style: { font: "600 10.5px 'IBM Plex Sans'", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-light)", marginBottom: 4 } }, lbl),
    h("div", { style: { font: "700 17px 'IBM Plex Sans'", color: color || "var(--ink)" } }, val),
    sub ? h("div", { style: { font: "400 11px 'IBM Plex Sans'", color: "var(--text-light)", marginTop: 2 } }, sub) : null);
  const ocmPanel = _staff() ? null : h("div", { style: { border: "1px solid " + (ocm && ocm.over ? "#f3c1bb" : "#e7e6e2"), borderRadius: 14, background: ocm && ocm.over ? "#fdf6f5" : "#fff", padding: "16px 20px", marginBottom: 14 } },
    h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" } },
      h("div", { style: { font: "600 13px 'IBM Plex Sans'" } }, "OCM Allowance ",
        h("span", { className: "pc-help-tip", "data-tip": "The overhead you PRICED into this contract (OCM % of the contract amount) versus the overhead you have actually spent \u2014 all-time, unaffected by the period filter. If Spent passes the allowance, this project's overhead is eating margin you never priced.", onClick: (e2) => e2.stopPropagation() }, "?")),
      _ocmBtn(ocm ? "Edit %" : "Set OCM %")),
    !ocm
      ? h("div", { style: { font: "400 12.5px 'IBM Plex Sans'", color: "var(--text-light)", marginTop: 8 } },
          "No allowance set. Enter the OCM % you priced into this contract to see whether overhead is staying inside what the client is already paying for.")
      : h(React.Fragment, null,
          h("div", { style: { display: "flex", gap: 26, flexWrap: "wrap", marginTop: 12 } },
            _ocmFig("Priced Allowance", "\u20B1 " + peso(ocm.allowance), ocm.pct + "% of \u20B1 " + peso(contractAmount) + " contract"),
            _ocmFig("Overhead Spent \u00B7 All-Time", "\u20B1 " + peso(ocm.spent), ocm.usedPct.toFixed(1) + "% of allowance used"),
            ocm.over
              ? _ocmFig("Over Allowance", "\u20B1 " + peso(ocm.spent - ocm.allowance), "eating margin you never priced", "#c0392b")
              : _ocmFig("Allowance Remaining", "\u20B1 " + peso(ocm.remaining), "before overhead exceeds what was priced", "#157a52")),
          h("div", { style: { height: 8, background: "#f0efec", borderRadius: 99, overflow: "hidden", marginTop: 14 } },
            h("div", { style: { width: Math.min(ocm.usedPct, 100) + "%", height: "100%", borderRadius: 99, background: ocm.over ? "#c0392b" : ocm.usedPct > 85 ? "#A86B00" : "#157a52" } })),
          h("div", { style: { font: "400 10.5px 'IBM Plex Sans'", color: "var(--text-light)", marginTop: 5 } },
            ocm.over ? "OVER \u2014 actual overhead has exceeded the priced allowance." : ocm.usedPct > 85 ? "Approaching the priced allowance." : "Within the priced allowance.")));

  const byCatRows = byCat.length
    ? byCat.map((r, i) => {
        const pct = total > 0 ? (r.amt / total) * 100 : 0;
        const col = catColor(r.cat);
        return h("div", { key: i, style: { marginBottom: 13 } },
          h("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6 } },
            h("span", { style: { font: "500 12.5px 'IBM Plex Sans'", display: "inline-flex", alignItems: "center", gap: 8 } },
              h("span", { style: { width: 10, height: 10, borderRadius: 3, background: col } }), esc(r.cat)),
            h("span", { style: { font: "600 12.5px 'IBM Plex Sans'" } }, "\u20B1 " + peso(r.amt))),
          h("div", { style: { height: 7, background: "#f0efec", borderRadius: 99, overflow: "hidden" } },
            h("div", { style: { width: pct + "%", height: "100%", background: col, borderRadius: 99 } })),
          h("div", { style: { font: "400 10.5px 'IBM Plex Sans'", color: "var(--text-light)", marginTop: 4 } }, pct.toFixed(1) + "% of total"));
      })
    : [h("div", { key: "none", style: { color: "var(--text-light)", font: "400 13px 'IBM Plex Sans'", padding: "10px 0" } }, "No expenses yet.")];

  const byCatPanel = h("div", { style: { width: 320, flex: "none", border: "1px solid #e7e6e2", borderRadius: 14, background: "#fff", padding: "18px 20px" } },
    h("div", { style: { font: "600 14px 'IBM Plex Sans'", marginBottom: 14 } }, "By Category"), byCatRows);

  const headerRow = h("tr", { style: { background: "#faf9f7", color: "var(--text-light)", textAlign: "left" } },
    ["Date", "Category", "Description", "Amount", ""].map((t, i) => h("th", { key: i, style: { padding: "10px 16px", font: "600 10.5px 'IBM Plex Sans'", letterSpacing: ".06em", textTransform: "uppercase" } }, t)));

  const bodyRows = allTx.length
    ? allTx.map((x) => h("tr", { key: x.id, style: { borderTop: "1px solid #f0efec" } },
        h("td", { style: { padding: "12px 16px", color: "#6b7280" } }, x.date || "\u2014"),
        h("td", { style: { padding: "12px 16px" } }, h("span", { style: { display: "inline-flex", alignItems: "center", gap: 7 } },
          h("span", { style: { width: 9, height: 9, borderRadius: 3, background: catColor(x.category) } }), esc(x.category),
          x.fromPayroll ? h("span", { title: "Recorded in Payroll as Overhead / Indirect Labor", style: { font: "600 9.5px 'IBM Plex Sans'", letterSpacing: ".05em", textTransform: "uppercase", color: "#7f9cb0", border: "1px solid #dbe3e9", borderRadius: 5, padding: "1px 5px" } }, "Payroll") : null)),
        h("td", { style: { padding: "12px 16px", color: "#6b7280" } }, x.description ? esc(x.description) : "\u2014"),
        h("td", { style: { padding: "12px 16px", fontWeight: 600 } }, "\u20B1 " + peso(x.amount)),
        h("td", { style: { padding: "12px 16px", textAlign: "right", whiteSpace: "nowrap" } },
          x.receiptUrl ? h("a", {
            href: x.receiptUrl, target: "_blank", rel: "noopener noreferrer", title: "View receipt",
            style: { display: "inline-flex", alignItems: "center", gap: 5, marginRight: 6, padding: "6px 9px", borderRadius: 8, background: "#eef6f1", color: "var(--brand-green)", textDecoration: "none", font: "600 11.5px 'IBM Plex Sans'" }
          }, "Receipt") : null,
          (_staff() || x.fromPayroll) ? null : h("button", { onClick: () => delEntry(x.id), title: "Delete", style: { border: 0, background: "#fdecea", color: "#c0564a", borderRadius: 8, padding: "6px 9px", cursor: "pointer" } }, Ico.trash))))
    : [h("tr", { key: "empty" }, h("td", { colSpan: 5, style: { padding: "28px 16px", textAlign: "center", color: "var(--text-light)" } }, "No overhead recorded for this project yet."))];

  const recordsPanel = h("div", { style: { flex: 1, minWidth: 340, border: "1px solid #e7e6e2", borderRadius: 14, background: "#fff", overflow: "hidden" } },
    h("div", { style: { font: "600 14px 'IBM Plex Sans'", padding: "16px 20px" } }, "Expense Records"),
    h("table", { style: { width: "100%", borderCollapse: "collapse", font: "400 13px 'IBM Plex Sans'" } },
      h("thead", null, headerRow), h("tbody", null, bodyRows)));

  const body = h("div", { style: { display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap", marginTop: 8 } }, byCatPanel, recordsPanel);

  const field = (label, input) => h("div", { style: { marginBottom: 12 } },
    h("label", { style: { font: "600 12px 'IBM Plex Sans'", display: "block", marginBottom: 4 } }, label), input);
  const inStyle = { width: "100%", padding: "9px 11px", border: "1.5px solid #e5e7eb", borderRadius: 9, font: "400 14px 'IBM Plex Sans'", boxSizing: "border-box" };

  const modal = adding ? h("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }, onClick: (ev) => { if (ev.target === ev.currentTarget) setAdding(false); } },
    h("div", { style: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 460, padding: 24 } },
      h("h3", { style: { font: "700 16px 'IBM Plex Sans'", margin: "0 0 16px" } }, "Add Overhead Expense"),
      // Free text + suggestions: type any category, or pick one you've used before.
      // The old "Indirect Support (Supervisor/Foreman/Admin/Engineer)" shortcut is gone
      // on purpose \u2014 those people are paid through Expenses -> Payroll as Overhead /
      // Indirect Labor and already flow into this total. Recording them here too would
      // count them twice.
      field("Category", h(React.Fragment, null,
        h("input", {
          type: "text", list: "ovhdDrillCatList", value: form.category,
          onChange: (ev) => setForm({ ...form, category: ev.target.value }),
          placeholder: "Type or pick a category\u2026", style: inStyle
        }),
        h("datalist", { id: "ovhdDrillCatList" }, catSuggestions.map((c) => h("option", { key: c, value: c }))),
        h("div", { style: { font: "400 11px 'IBM Plex Sans'", color: "#6b7280", marginTop: 5, lineHeight: 1.45 } },
          "Type any category \u2014 new ones are remembered and suggested next time. Coordinator, site supervision and procurement pay belongs in Expenses \u2192 Payroll (Overhead / Indirect Labor), not here.")
      )),
      field("Amount (\u20B1)", h("input", { type: "number", value: form.amount, onChange: (ev) => setForm({ ...form, amount: ev.target.value }), placeholder: "0.00", style: inStyle })),
      field("Date", h("input", { type: "date", value: form.date, onChange: (ev) => setForm({ ...form, date: ev.target.value }), style: inStyle })),
      field("Description (optional)", h("input", { type: "text", value: form.description, onChange: (ev) => setForm({ ...form, description: ev.target.value }), placeholder: "e.g. June electricity bill", style: inStyle })),
      // Receipt: accept="image/*,.pdf" + capture lets a phone offer the camera directly,
      // while a desktop opens the file picker.
      field("Receipt (optional)", h(React.Fragment, null,
        h("input", {
          type: "file", accept: "image/*,.pdf", capture: "environment",
          onChange: (ev) => setReceiptFile((ev.target.files && ev.target.files[0]) || null),
          style: { ...inStyle, padding: "7px 9px", font: "400 12.5px 'IBM Plex Sans'" }
        }),
        receiptFile ? h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 6 } },
          h("span", { style: { font: "500 11.5px 'IBM Plex Sans'", color: "#157a52", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "✓ " + receiptFile.name),
          h("button", { type: "button", onClick: () => setReceiptFile(null), style: { border: 0, background: "none", color: "#c0564a", cursor: "pointer", font: "600 11.5px 'IBM Plex Sans'", padding: 0, flex: "none" } }, "Remove")
        ) : null
      )),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 } },
        h("button", { onClick: () => { setAdding(false); setReceiptFile(null); }, style: { padding: "9px 16px", borderRadius: 9, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", font: "600 13px 'IBM Plex Sans'" } }, "Cancel"),
        h("button", { onClick: saveEntry, disabled: saving, style: { padding: "9px 18px", borderRadius: 9, border: 0, background: "var(--brand-green)", color: "#fff", cursor: "pointer", font: "700 13px 'IBM Plex Sans'" } }, saving ? "Saving\u2026" : "Save Expense")))) : null;

  const head = h("div", { className: "drill-head", style: { marginTop: 14 } },
    h("div", { style: { minWidth: 0 } },
      h("div", { className: "eyebrow", style: { marginBottom: 10 } }, "Overhead Cost \xB7 Project Operating Costs"),
      h("h2", null, "Overhead Expenses"),
      h("div", { className: "sub" }, esc(project && project.name), project && project.code ? " \xB7 " + project.code : "")),
    h("button", { onClick: () => setAdding(true), style: { display: "inline-flex", alignItems: "center", gap: 8, background: "var(--brand-green)", color: "#fff", border: 0, borderRadius: 10, padding: "11px 20px", font: "700 13px 'IBM Plex Sans'", cursor: "pointer", whiteSpace: "nowrap", flex: "none" } }, "+ Add Expense"));

  return h("section", { className: "drill" },
    h("button", { className: "back-btn", onClick: onBack, title: "Go back to Project Control" }, Ico.arrowL, " Back to Project Control"),
    h(ExpenseInboxMount, { folderId, label: project && project.name || "", kind: "overhead" }),
    head, ocmPanel, kpis, body, modal);
}
function _awId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function _awNewItem() { return { id: _awId(), description: "", qty: "", unit: "", materialCost: "", laborCost: "" }; }
function _awNewCategory() { return { id: _awId(), label: "", items: [_awNewItem()] }; }
function _awEmptyDraft() { return { id: null, title: "", workDate: _ovhdLocalToday(), categories: [_awNewCategory()], discount: 0 }; }
function AdditionalWorksDrill({ project, onBack, childFolders, additionalWorksRaw, onOpenChild, folderId }) {
  const h = React.createElement;
  const [editing, setEditing] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [creating, setCreating] = React.useState(null);
  const [savingNew, setSavingNew] = React.useState(false);
  const esc = (v) => String(v == null ? "" : v);

  const children = childFolders || [];
  const grandTotal = children.reduce((s, c) => s + c.revenue, 0);
  const totalSpent = children.reduce((s, c) => s + _projSpent(c), 0);

  const openAdd = () => setCreating({ title: "", workDate: _ovhdLocalToday() });
  const closeCreate = () => { if (!savingNew) setCreating(null); };
  const saveNew = async () => {
    if (!folderId) { alert("Open a project first."); return; }
    if (!creating.title || !creating.title.trim()) { alert("Please enter a name for this project."); return; }
    setSavingNew(true);
    try {
      const uid = window.currentDataUserId || (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null;
      const ref = await db.collection("folders").add({
        userId: uid, name: creating.title, description: "", parentFolderId: folderId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await db.collection("folderBudgets").doc(ref.id).set({ userId: uid, totalBudget: 0 });
      await db.collection("additionalWorks").add({
        userId: uid, folderId: ref.id, title: creating.title, workDate: creating.workDate || "",
        categories: [], discount: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setCreating(null);
    } catch (err) { alert("Save failed: " + (err.message || err)); }
    setSavingNew(false);
  };
  const openEditChild = (child) => {
    const aw = (additionalWorksRaw || []).find((x) => x.folderId === child.id);
    setEditing({
      id: aw ? aw.id : null,
      childFolderId: child.id,
      title: (aw && aw.title) || child.name || "",
      workDate: (aw && aw.workDate) || _ovhdLocalToday(),
      categories: (aw && aw.categories && aw.categories.length ? aw.categories : [_awNewCategory()]).map((c) => ({ id: c.id || _awId(), label: c.label || "", items: (c.items && c.items.length ? c.items : [_awNewItem()]).map((it) => ({ id: it.id || _awId(), description: it.description || "", qty: it.qty || "", unit: it.unit || "", materialCost: it.materialCost || "", laborCost: it.laborCost || "" })) })),
      discount: (aw && aw.discount) || 0
    });
  };
  const closeModal = () => { if (!saving) setEditing(null); };

  const patchCategory = (catId, patch) => setEditing((d) => ({ ...d, categories: d.categories.map((c) => c.id === catId ? { ...c, ...patch } : c) }));
  const patchItem = (catId, itemId, patch) => setEditing((d) => ({ ...d, categories: d.categories.map((c) => c.id !== catId ? c : { ...c, items: c.items.map((it) => it.id === itemId ? { ...it, ...patch } : it) }) }));
  const addCategory = () => setEditing((d) => ({ ...d, categories: [...d.categories, _awNewCategory()] }));
  const removeCategory = (catId) => setEditing((d) => ({ ...d, categories: d.categories.length > 1 ? d.categories.filter((c) => c.id !== catId) : d.categories }));
  const addItem = (catId) => setEditing((d) => ({ ...d, categories: d.categories.map((c) => c.id === catId ? { ...c, items: [...c.items, _awNewItem()] } : c) }));
  const removeItem = (catId, itemId) => setEditing((d) => ({ ...d, categories: d.categories.map((c) => c.id !== catId ? c : { ...c, items: c.items.length > 1 ? c.items.filter((it) => it.id !== itemId) : c.items }) }));

  const draftSubtotal = editing ? awSubtotal(editing.categories) : 0;
  const draftDiscount = editing ? Number(String(editing.discount).replace(/,/g, "")) || 0 : 0;
  const draftTotal = Math.max(0, draftSubtotal - draftDiscount);

  const save = async () => {
    if (!folderId) { alert("Open a project first."); return; }
    if (!editing.title || !editing.title.trim()) { alert("Please enter a title — it becomes the project name."); return; }
    const cleanCategories = editing.categories.map((c) => ({
      label: c.label || "",
      items: c.items.filter((it) => it.description || it.materialCost || it.laborCost).map((it) => ({
        description: it.description || "", qty: it.qty || "", unit: it.unit || "",
        materialCost: Number(String(it.materialCost).replace(/,/g, "")) || 0,
        laborCost: Number(String(it.laborCost).replace(/,/g, "")) || 0
      }))
    })).filter((c) => c.items.length);
    setSaving(true);
    try {
      const uid = window.currentDataUserId || (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null;
      let childId = editing.childFolderId;
      if (childId) {
        await db.collection("folders").doc(childId).update({ name: editing.title });
        await db.collection("folderBudgets").doc(childId).set({ userId: uid, totalBudget: draftTotal });
      } else {
        const ref = await db.collection("folders").add({
          userId: uid, name: editing.title, description: "", parentFolderId: folderId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        childId = ref.id;
        await db.collection("folderBudgets").doc(childId).set({ userId: uid, totalBudget: draftTotal });
      }
      const awPayload = {
        userId: uid, folderId: childId, title: editing.title, workDate: editing.workDate || "",
        categories: cleanCategories, discount: draftDiscount,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (editing.id) {
        await db.collection("additionalWorks").doc(editing.id).update(awPayload);
      } else {
        awPayload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection("additionalWorks").add(awPayload);
      }
      setEditing(null);
    } catch (err) { alert("Save failed: " + (err.message || err)); }
    setSaving(false);
  };
  const deleteChild = async (child) => {
    if (!confirm(`Delete "${child.name}"? This removes its contract amount and any billing periods/entries recorded under it.`)) return;
    try { await db.collection("folders").doc(child.id).delete(); } catch (err) { alert("Delete failed: " + (err.message || err)); }
  };

  const card = (label, value, accent) => h("div", { className: "drill-stat" },
    h("div", { className: "lbl" }, label),
    h("div", { className: "val" + (accent ? " total" : "") }, value));
  const kpis = h("div", { className: "drill-stats" },
    card("Total Additional Works", _staff() ? children.length + " project" + (children.length === 1 ? "" : "s") : "₱ " + peso(grandTotal), true),
    card("Projects", children.length),
    _staff() ? null : card("Total Spent", "₱ " + peso(totalSpent)));

  const headerRow = h("tr", { style: { background: "#faf9f7", color: "var(--text-light)", textAlign: "left" } },
    ["Name", "Contract", "Spent", "Remaining", ""].map((t, i) => h("th", { key: i, style: { padding: "10px 16px", font: "600 10.5px 'IBM Plex Sans'", letterSpacing: ".06em", textTransform: "uppercase" } }, t)));

  const bodyRows = children.length
    ? children.map((cf) => h("tr", { key: cf.id, style: { borderTop: "1px solid #f0efec", cursor: "pointer" }, onClick: () => onOpenChild(cf.id) },
        h("td", { style: { padding: "12px 16px", fontWeight: 600 } }, esc(cf.name) || "—"),
        h("td", { style: { padding: "12px 16px" } }, _staff() ? "—" : "₱ " + peso(cf.revenue)),
        h("td", { style: { padding: "12px 16px" } }, _staff() ? "—" : "₱ " + peso(_projSpent(cf))),
        h("td", { style: { padding: "12px 16px", fontWeight: 600 } }, _staff() ? "—" : "₱ " + peso(cf.revenue - _projSpent(cf))),
        h("td", { style: { padding: "12px 16px", textAlign: "right", whiteSpace: "nowrap" } },
          h("button", { onClick: (ev) => { ev.stopPropagation(); onOpenChild(cf.id); }, title: "Open", style: { border: 0, background: "#eef6f1", color: "var(--brand-green)", borderRadius: 8, padding: "6px 9px", cursor: "pointer", marginRight: 6, font: "600 12px 'IBM Plex Sans'" } }, "Open →"),
          h("button", { onClick: (ev) => { ev.stopPropagation(); openEditChild(cf); }, title: "Edit BOQ breakdown", style: { border: 0, background: "#f0efec", color: "var(--text-primary)", borderRadius: 8, padding: "6px 9px", cursor: "pointer", marginRight: 6 } }, Ico.pencil),
          h("button", { onClick: (ev) => { ev.stopPropagation(); deleteChild(cf); }, title: "Delete", style: { border: 0, background: "#fdecea", color: "#c0564a", borderRadius: 8, padding: "6px 9px", cursor: "pointer" } }, Ico.trash))))
    : [h("tr", { key: "empty" }, h("td", { colSpan: 5, style: { padding: "28px 16px", textAlign: "center", color: "var(--text-light)" } }, "No Additional Works projects yet for this project."))];

  const recordsPanel = h("div", { style: { border: "1px solid #e7e6e2", borderRadius: 14, background: "#fff", overflow: "hidden" } },
    h("div", { style: { font: "600 14px 'IBM Plex Sans'", padding: "16px 20px" } }, "Additional Works Projects"),
    h("table", { style: { width: "100%", borderCollapse: "collapse", font: "400 13px 'IBM Plex Sans'" } },
      h("thead", null, headerRow), h("tbody", null, bodyRows)));

  const inStyle = { width: "100%", padding: "8px 10px", border: "1.5px solid #e5e7eb", borderRadius: 8, font: "400 13px 'IBM Plex Sans'", boxSizing: "border-box" };
  const field = (label, input, w) => h("div", { style: { marginBottom: 10, flex: w || "1 1 120px", minWidth: 0 } },
    h("label", { style: { font: "600 11px 'IBM Plex Sans'", display: "block", marginBottom: 4, color: "var(--text-light)" } }, label), input);

  const createModal = creating ? h("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }, onClick: (ev) => { if (ev.target === ev.currentTarget) closeCreate(); } },
    h("div", { style: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 420, padding: 24 } },
      h("h3", { style: { font: "700 16px 'IBM Plex Sans'", margin: "0 0 16px" } }, "New Additional Works"),
      field("Project Name", h("input", { type: "text", autoFocus: true, value: creating.title, onChange: (ev) => setCreating({ ...creating, title: ev.target.value }), placeholder: "e.g. Additional Works Rev. 1", style: inStyle })),
      field("Date", h("input", { type: "date", value: creating.workDate, onChange: (ev) => setCreating({ ...creating, workDate: ev.target.value }), style: inStyle })),
      h("div", { style: { fontSize: 12, color: "var(--text-light)", margin: "-4px 0 16px" } }, "You can price it (categories, line items, discount) afterward via the edit icon."),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10 } },
        h("button", { onClick: closeCreate, disabled: savingNew, style: { padding: "9px 16px", borderRadius: 9, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", font: "600 13px 'IBM Plex Sans'" } }, "Cancel"),
        h("button", { onClick: saveNew, disabled: savingNew, style: { padding: "9px 18px", borderRadius: 9, border: 0, background: "var(--brand-green)", color: "#fff", cursor: "pointer", font: "700 13px 'IBM Plex Sans'" } }, savingNew ? "Saving…" : "Create Project")))) : null;

  const itemRow = (cat, it) => h("div", { key: it.id, style: { display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 8, flexWrap: "wrap" } },
    field("Description", h("input", { type: "text", value: it.description, onChange: (ev) => patchItem(cat.id, it.id, { description: ev.target.value }), placeholder: "e.g. Shower Set", style: inStyle }), "1 1 200px"),
    field("Qty", h("input", { type: "text", value: it.qty, onChange: (ev) => patchItem(cat.id, it.id, { qty: ev.target.value }), placeholder: "1.00", style: inStyle }), "0 1 70px"),
    field("Unit", h("input", { type: "text", value: it.unit, onChange: (ev) => patchItem(cat.id, it.id, { unit: ev.target.value }), placeholder: "lot", style: inStyle }), "0 1 70px"),
    field("Material (₱)", h("input", { type: "text", value: it.materialCost, onChange: (ev) => patchItem(cat.id, it.id, { materialCost: ev.target.value }), placeholder: "0.00", style: inStyle }), "0 1 110px"),
    field("Labor (₱)", h("input", { type: "text", value: it.laborCost, onChange: (ev) => patchItem(cat.id, it.id, { laborCost: ev.target.value }), placeholder: "0.00", style: inStyle }), "0 1 110px"),
    h("div", { style: { flex: "0 1 90px", font: "600 13px 'IBM Plex Sans'", padding: "8px 0", textAlign: "right" } }, "₱ " + peso(awLineTotal(it))),
    h("button", { onClick: () => removeItem(cat.id, it.id), title: "Remove item", style: { border: 0, background: "#fdecea", color: "#c0564a", borderRadius: 8, padding: "8px 9px", cursor: "pointer", flex: "none" } }, Ico.trash));

  const categoryBlock = (cat, idx) => h("div", { key: cat.id, style: { border: "1px solid #e7e6e2", borderRadius: 12, padding: 14, marginBottom: 12 } },
    h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 10 } },
      h("input", { type: "text", value: cat.label, onChange: (ev) => patchCategory(cat.id, { label: ev.target.value }), placeholder: `e.g. ${String.fromCharCode(65 + idx)}. Plumbing Fixtures`, style: { ...inStyle, fontWeight: 600, flex: 1 } }),
      h("button", { onClick: () => removeCategory(cat.id), title: "Remove category", style: { border: 0, background: "#fdecea", color: "#c0564a", borderRadius: 8, padding: "8px 9px", cursor: "pointer", flex: "none" } }, Ico.trash)),
    cat.items.map((it) => itemRow(cat, it)),
    h("button", { onClick: () => addItem(cat.id), style: { border: "1.5px dashed #d1d5db", background: "#fff", color: "var(--text-light)", borderRadius: 8, padding: "7px 12px", cursor: "pointer", font: "600 12px 'IBM Plex Sans'" } }, "+ Add Line Item"));

  const modal = editing ? h("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }, onClick: (ev) => { if (ev.target === ev.currentTarget) closeModal(); } },
    h("div", { style: { background: "#fff", borderRadius: 16, width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", padding: 24 } },
      h("h3", { style: { font: "700 16px 'IBM Plex Sans'", margin: "0 0 16px" } }, editing.childFolderId ? "Edit Additional Works" : "New Additional Works"),
      h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" } },
        field("Title", h("input", { type: "text", value: editing.title, onChange: (ev) => setEditing({ ...editing, title: ev.target.value }), placeholder: "e.g. Additional Works Rev. 1", style: inStyle }), "2 1 260px"),
        field("Date", h("input", { type: "date", value: editing.workDate, onChange: (ev) => setEditing({ ...editing, workDate: ev.target.value }), style: inStyle }), "1 1 160px")),
      h("div", { style: { margin: "14px 0 8px", font: "600 12.5px 'IBM Plex Sans'" } }, "Line Items by Category"),
      editing.categories.map((cat, idx) => categoryBlock(cat, idx)),
      h("button", { onClick: addCategory, style: { border: "1.5px dashed #d1d5db", background: "#fff", color: "var(--text-light)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", font: "600 12.5px 'IBM Plex Sans'", marginBottom: 16 } }, "+ Add Category"),
      h("div", { style: { borderTop: "1px solid #f0efec", paddingTop: 14, display: "flex", justifyContent: "flex-end" } },
        h("div", { style: { width: 260 } },
          h("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6, font: "400 13px 'IBM Plex Sans'" } }, h("span", null, "Subtotal"), h("span", null, "₱ " + peso(draftSubtotal))),
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
            h("span", { style: { font: "400 13px 'IBM Plex Sans'" } }, "Discount"),
            h("input", { type: "text", value: editing.discount, onChange: (ev) => setEditing({ ...editing, discount: ev.target.value }), placeholder: "0.00", style: { ...inStyle, width: 120, textAlign: "right" } })),
          h("div", { style: { display: "flex", justifyContent: "space-between", font: "700 15px 'IBM Plex Sans'", borderTop: "1px solid #f0efec", paddingTop: 8 } }, h("span", null, "Total"), h("span", null, "₱ " + peso(draftTotal))))),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 } },
        h("button", { onClick: closeModal, disabled: saving, style: { padding: "9px 16px", borderRadius: 9, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", font: "600 13px 'IBM Plex Sans'" } }, "Cancel"),
        h("button", { onClick: save, disabled: saving, style: { padding: "9px 18px", borderRadius: 9, border: 0, background: "var(--brand-green)", color: "#fff", cursor: "pointer", font: "700 13px 'IBM Plex Sans'" } }, saving ? "Saving…" : "Save Additional Works")))) : null;

  const head = h("div", { className: "drill-head", style: { marginTop: 14 } },
    h("div", { style: { minWidth: 0 } },
      h("div", { className: "eyebrow", style: { marginBottom: 10 } }, "Additional Works \xB7 Contract Extensions"),
      h("h2", null, "Additional Works"),
      h("div", { className: "sub" }, esc(project && project.name), project && project.code ? " \xB7 " + project.code : "")),
    h("button", { onClick: openAdd, style: { display: "inline-flex", alignItems: "center", gap: 8, background: "var(--brand-green)", color: "#fff", border: 0, borderRadius: 10, padding: "11px 20px", font: "700 13px 'IBM Plex Sans'", cursor: "pointer", whiteSpace: "nowrap", flex: "none" } }, "+ New Additional Works"));

  return h("section", { className: "drill" },
    h("button", { className: "back-btn", onClick: onBack, title: "Go back to Project Control" }, Ico.arrowL, " Back to Project Control"),
    head, kpis, recordsPanel, modal, createModal);
}
function _esc2(s) { return String(s == null ? "" : s); }
function LaborDrill({ project, onBack, laborTx, childMonths, contracts, folderPayroll, activeFolder, folderId }) {
  const rc = React.createElement;
  const [tab, setTab] = React.useState("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [soaOpen, setSoaOpen] = React.useState(false);
  const [openW, setOpenW] = React.useState({});
  const soaRef = React.useRef(null);
  React.useEffect(() => {
    if (!soaOpen) return;
    const onDoc = (e) => { if (soaRef.current && !soaRef.current.contains(e.target)) setSoaOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [soaOpen]);
  const workers = React.useMemo(() => {
    const m = {};
    laborTx.forEach((t) => { const n = t.name || "\u2014"; if (!m[n]) m[n] = { name: n, role: t.role || "", total: 0, count: 0 }; m[n].total += t.amount || 0; m[n].count++; });
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [laborTx]);
  const billingByProjectId = React.useMemo(() => {
    const monthNum = (m) => {
      const map2 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const s = String(m || "").toLowerCase().slice(0, 3);
      return map2[s] || 99;
    };
    const sorted = [...childMonths || []].sort((a, b) => {
      const ya = +a.year || 0, yb = +b.year || 0;
      if (ya !== yb) return ya - yb;
      return monthNum(a.month) - monthNum(b.month);
    });
    const map = new Map();
    sorted.forEach((m, i) => map.set(m.id, i + 1));
    return map;
  }, [childMonths]);
  const filtered = React.useMemo(() => {
    let result = tab === "all" ? laborTx : laborTx.filter((x) => x.type === tab);
    if (searchQuery.trim()) {
      const q2 = searchQuery.trim().toLowerCase();
      result = result.filter(
        (x) => (x.name || "").toLowerCase().includes(q2) || (x.role || "").toLowerCase().includes(q2)
      );
    }
    return result;
  }, [laborTx, tab, searchQuery]);
  const exportCsv = () => {
    const headers = ["Date", "Worker", "Role", "Category", "Hours", "Amount (PHP)"];
    const csvEsc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const rows = filtered.map((row) => [
      row.date || "",
      row.name || "",
      row.role || "",
      row.type || "",
      row.hours || "",
      Number(row.amount) || 0
    ].map(csvEsc).join(","));
    const csv = [headers.map(csvEsc).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `labor-${project.code || "export"}-${_ovhdLocalToday()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  };

  // ---- contract math (per worker) ----
  const _lcRows = (contracts || []).map((c) => {
    const agreed = Number(c.agreedAmount) || 0;
    const paid = (folderPayroll || []).filter((p) => p.contractId === c.id).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const remaining = agreed - paid;
    const pct = agreed > 0 ? Math.min(100, Math.max(0, paid / agreed * 100)) : 0;
    return { c, agreed, paid, remaining, pct };
  });
  const _lcByWorker = {};
  _lcRows.forEach((r) => {
    const w = (r.c.workerName || "\u2014").trim() || "\u2014";
    (_lcByWorker[w] = _lcByWorker[w] || []).push(r);
  });
  const _lcWorkers = Object.keys(_lcByWorker);
  const _lcTotAgreed = _lcRows.reduce((s, r) => s + r.agreed, 0);
  const _lcTotPaid = _lcRows.reduce((s, r) => s + r.paid, 0);
  const _lcTotRem = _lcTotAgreed - _lcTotPaid;

  // ---- payments grouped by worker (respects category tab + search) ----
  // A payment LINKED to a contract groups under that CONTRACT's worker name, so a
  // mismatched typed name (e.g. "Mark Frias" on the payment vs "Mark Frias
  // (Demolition)" on the contract) doesn't split it into a phantom "No contract"
  // row \u2014 the contract link wins over the free-typed name.
  const _cWorkerById = {};
  _lcRows.forEach((r) => { _cWorkerById[r.c.id] = (r.c.workerName || "\u2014").trim() || "\u2014"; });
  const _payByWorker = {};
  filtered.forEach((p) => {
    const w = (p.contractId && _cWorkerById[p.contractId]) || (p.name || "\u2014").trim() || "\u2014";
    (_payByWorker[w] = _payByWorker[w] || []).push(p);
  });
  const q = searchQuery.trim().toLowerCase();
  const _union = Array.from(new Set([..._lcWorkers, ...Object.keys(_payByWorker)]));
  const _allWorkers = _union.filter((w) => {
    if (!q) return true;
    if (w.toLowerCase().includes(q)) return true;
    if ((_payByWorker[w] || []).length) return true;
    if ((_lcByWorker[w] || []).some((r) => (String(r.c.scope || "") + String(r.c.role || "")).toLowerCase().includes(q))) return true;
    return false;
  }).sort((a, b) => a.localeCompare(b));

  const toggle = (w) => setOpenW((s) => ({ ...s, [w]: !s[w] }));

  const payRows = (list) => {
    const sorted = [...list].sort((a, b) => new Date(b.dateTime || b.date || 0) - new Date(a.dateTime || a.date || 0));
    return rc("table", { className: "lc2-tx" },
      rc("thead", null, rc("tr", null,
        rc("th", null, "Date"),
        rc("th", null, "Milestone"),
        rc("th", { className: "r" }, "Amount"),
        rc("th", { className: "r" }, "")
      )),
      rc("tbody", null, sorted.map((p, i) => rc("tr", { key: p.id || i },
        rc("td", null, fmtDateTime(p.dateTime || p.date)),
        rc("td", null, rc("span", { className: "lc2-mile" }, p.payMilestone ? (p.payMilestone.charAt(0).toUpperCase() + p.payMilestone.slice(1)) : "Payment")),
        rc("td", { className: "r amt" }, "\u20B1 ", peso(Number(p.amount) || 0)),
        rc("td", { className: "r" },
          rc("button", { className: "lc2-rowbtn", title: "Receipt / Invoice", onClick: () => window.printSinglePayrollInvoice && window.printSinglePayrollInvoice(p.id) }, Ico.receipt || "\u{1F9FE}"),
          rc("button", { className: "lc2-rowbtn", title: "Edit", onClick: () => window.openEditPayrollModal && window.openEditPayrollModal(p.id) }, Ico.pencil || "\u270E"),
          rc("button", { className: "lc2-rowbtn", title: "Delete", onClick: () => window.deletePayroll && window.deletePayroll(p.id) }, Ico.trash || "\u{1F5D1}")
        )
      )))
    );
  };

  const workerBody = (w, crows, pays) => {
    const blocks = [];
    crows.forEach((r) => {
      const cpays = pays.filter((p) => p.contractId === r.c.id);
      blocks.push(rc("div", { key: r.c.id, className: "lc2-cblock" },
        rc("div", { className: "lc2-cblock-head" },
          rc("div", { className: "lc2-cscope" }, r.c.scope || "Untitled job"),
          rc("div", { className: "lc2-cmeta" }, "Agreed \u20B1 " + peso(r.agreed) + " \u00B7 Paid \u20B1 " + peso(r.paid) + " \u00B7 " + (r.remaining < 0 ? "Over by \u20B1 " + peso(Math.abs(r.remaining)) : "Remaining \u20B1 " + peso(r.remaining)))
        ),
        cpays.length ? payRows(cpays) : rc("div", { className: "lc2-none" }, "No payments recorded against this contract yet."),
        rc("div", { className: "lc2-cactions" },
          rc("button", { onClick: () => window.lcOpenLedger && window.lcOpenLedger(r.c.id) }, "Ledger"),
          rc("button", { onClick: () => window.lcOpenRaiseCap && window.lcOpenRaiseCap(r.c.id) }, "Raise cap"),
          rc("button", { onClick: () => window.lcOpenEdit && window.lcOpenEdit(r.c.id) }, "Edit contract"),
          rc("button", { onClick: () => window.lcOpenAgreement && window.lcOpenAgreement(r.c.id) }, "Print agreement"),
          rc("button", { onClick: () => window.printWorkerLaborSOA && window.printWorkerLaborSOA(w, project.id) }, "Worker statement"),
          rc("button", { onClick: (e) => window.lcAddFile && window.lcAddFile(r.c.id, e.currentTarget) }, "Add file"),
          rc("button", { onClick: () => window.lcViewFiles && window.lcViewFiles(r.c.id) }, "View"),
          rc("button", { className: "danger", onClick: () => window.lcDelete && window.lcDelete(r.c.id) }, "Delete")
        )
      ));
    });
    const uncapPays = pays.filter((p) => !p.contractId);
    if (uncapPays.length) {
      const uncapTot = uncapPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      blocks.push(rc("div", { key: "_uncap", className: "lc2-cblock" },
        rc("div", { className: "lc2-cblock-head" },
          rc("div", { className: "lc2-cscope" }, "Other (uncapped) payments"),
          rc("div", { className: "lc2-cmeta" }, "Total \u20B1 " + peso(uncapTot))
        ),
        payRows(uncapPays)
      ));
    }
    if (!blocks.length) blocks.push(rc("div", { key: "_empty", className: "lc2-none" }, "No payments yet."));
    return blocks;
  };

  const workerRow = (w) => {
    const crows = _lcByWorker[w] || [];
    const pays = _payByWorker[w] || [];
    const hasContract = crows.length > 0;
    const agreed = crows.reduce((s, r) => s + r.agreed, 0);
    const paid = crows.reduce((s, r) => s + r.paid, 0);
    const remaining = agreed - paid;
    const pct = agreed > 0 ? Math.min(100, Math.max(0, paid / agreed * 100)) : 0;
    const totalPaidAll = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    let status = "Ongoing", scls = "lc2-badge-ongoing", barcls = "lc2-bar-ok";
    if (!hasContract) { status = "No contract"; scls = "lc2-badge-none"; }
    else if (paid >= agreed) {
      if (paid > agreed) { status = "Over cap"; scls = "lc2-badge-over"; barcls = "lc2-bar-over"; }
      else { status = "Completed"; scls = "lc2-badge-done"; barcls = "lc2-bar-done"; }
    }
    const open = !!openW[w];
    const role = (crows[0] && crows[0].c.role) || (pays[0] && pays[0].role) || "";
    const payType = crows[0] && crows[0].c.payType;
    const initial = (w || "?").trim().charAt(0).toUpperCase() || "?";
    const isDone = hasContract && paid >= agreed && paid <= agreed;
    return rc("div", { key: w, className: "lc2-acc" + (open ? " open" : "") },
      rc("div", { className: "lc2-acc-head", onClick: () => toggle(w) },
        rc("div", { className: "lc2-av" }, initial),
        rc("div", { className: "lc2-id" },
          rc("div", { className: "lc2-name" }, w),
          rc("div", { className: "lc2-role" }, role || "\u2014",
            payType ? rc("span", { className: "lc2-type lc2-type-" + (payType === "inhouse" ? "in" : "pk") }, payType === "inhouse" ? "In-house" : "Pakyaw") : null
          )
        ),
        rc("div", { className: "lc2-mid" },
          hasContract
            ? rc(React.Fragment, null,
                rc("div", { className: "lc2-bar" }, rc("div", { className: "lc2-bar-fill " + barcls, style: { width: pct.toFixed(1) + "%" } })),
                rc("div", { className: "lc2-mid-cap" }, "\u20B1 " + peso(paid) + " paid of \u20B1 " + peso(agreed) + (crows.length === 1 && crows[0].c.scope ? " \u00B7 " + crows[0].c.scope : " \u00B7 " + crows.length + " contracts"))
              )
            : rc("div", { className: "lc2-mid-cap" }, pays.length + " payment" + (pays.length === 1 ? "" : "s") + " \u00B7 no capped contract")
        ),
        rc("div", { className: "lc2-rem" },
          rc("div", { className: "lc2-rem-lbl" }, hasContract ? (remaining < 0 ? "Over by" : "Remaining") : "Total paid"),
          rc("div", { className: "lc2-rem-val" + (remaining < 0 ? " neg" : (hasContract ? (isDone ? " muted" : "") : " muted")) }, remaining < 0 ? "\u2212 \u20B1 " + peso(Math.abs(remaining)) : "\u20B1 " + peso(hasContract ? remaining : totalPaidAll))
        ),
        rc("span", { className: "lc2-badge " + scls }, status + (status === "Ongoing" ? " \u00B7 " + pct.toFixed(0) + "%" : "")),
        rc("button", { className: "lc2-pay", onClick: (e) => { e.stopPropagation(); openAddEntry("labor", childMonths, activeFolder); } }, Ico.plus, " Pay"),
        rc("svg", { className: "lc2-chev", width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "#A1A1A6", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }, rc("polyline", { points: "6 9 12 15 18 9" }))
      ),
      open ? rc("div", { className: "lc2-acc-body" }, workerBody(w, crows, pays)) : null
    );
  };

  const pctChip = project.revenue > 0 ? (project.labor / project.revenue * 100).toFixed(1) + "%" : "\u2014";

  return rc("section", { className: "drill lc2-drill" },
    rc("button", { className: "back-btn", onClick: onBack, title: "Go back to Project Control" }, Ico.arrowL, " Back to Project Control"),
    rc(ExpenseInboxMount, { folderId, label: project && project.name || "", kind: "labor" }),
    rc("div", { className: "drill-head" },
      rc("div", null,
        rc("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Labor Cost \u00B7 Worker Tracker"),
        rc("h2", null, "Labor", rc("span", { style: { fontFamily: "var(--sans)", color: "var(--brand-green)", fontWeight: 700, fontSize: "22px", letterSpacing: "0.02em", marginLeft: 18, background: "rgba(26,90,58,0.12)", padding: "8px 20px", borderRadius: "999px", whiteSpace: "nowrap", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" } }, pctChip)),
        rc("div", { className: "sub" }, project.name, " \u00B7 ", project.code)
      ),
      rc("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } },
        rc("div", { ref: soaRef, style: { position: "relative" } },
          rc("button", { type: "button", className: "lc2-ghost" + (soaOpen ? " open" : ""), onClick: () => setSoaOpen((o) => !o), title: "Generate a worker's Statement of Account" },
            rc("svg", { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, rc("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), rc("polyline", { points: "14 2 14 8 20 8" }), rc("line", { x1: 16, y1: 13, x2: 8, y2: 13 }), rc("line", { x1: 16, y1: 17, x2: 8, y2: 17 })),
            " Worker Statement"),
          soaOpen && rc("div", { className: "pcf-soa-pop" },
            rc("div", { className: "pcf-soa-head" }, rc("div", { className: "t" }, "Worker Statement"), rc("div", { className: "s" }, "Select a worker to generate their SOA")),
            rc("div", { className: "pcf-soa-list" }, workers.length === 0 ? rc("div", { className: "pcf-soa-empty" }, "No workers yet.") : workers.map((wk) => rc("button", { key: wk.name, type: "button", className: "pcf-soa-item", onClick: () => { setSoaOpen(false); window.printWorkerLaborSOA && window.printWorkerLaborSOA(wk.name, project.id); } },
              rc("span", { className: "pcf-soa-av" }, (wk.name || "?").trim().charAt(0).toUpperCase() || "?"),
              rc("span", { className: "pcf-soa-info" }, rc("span", { className: "pcf-soa-name" }, wk.name), rc("span", { className: "pcf-soa-sub" }, (wk.role || "\u2014") + " \u00B7 " + wk.count + " " + (wk.count === 1 ? "entry" : "entries"))),
              rc("span", { className: "pcf-soa-amt" }, "\u20B1 ", peso(wk.total)))))
          )
        ),
        _staff() ? null : rc("button", { className: "lc2-ghost", onClick: () => window.lcOpenNew && window.lcOpenNew() }, Ico.plus, " New Contract"),
        rc("button", { className: "btn-primary", onClick: () => openAddEntry("labor", childMonths, activeFolder) }, Ico.plus, " Add Payment")
      )
    ),
    _lcRows.length ? rc("div", { className: "lc2-totals" },
      rc("div", { className: "lc2-tcell" }, rc("div", { className: "lc2-tlbl" }, "Total Agreed"), rc("div", { className: "lc2-tval" }, "\u20B1 " + peso(_lcTotAgreed))),
      rc("div", { className: "lc2-tcell" }, rc("div", { className: "lc2-tlbl" }, "Paid So Far"), rc("div", { className: "lc2-tval" }, "\u20B1 " + peso(_lcTotPaid))),
      rc("div", { className: "lc2-tcell" }, rc("div", { className: "lc2-tlbl" }, "Remaining to Pay"), rc("div", { className: "lc2-tval" + (_lcTotRem < 0 ? " neg" : " accent") }, _lcTotRem < 0 ? "\u2212 \u20B1 " + peso(Math.abs(_lcTotRem)) : "\u20B1 " + peso(_lcTotRem))),
      rc("div", { className: "lc2-tcell lc2-tcell-last" }, rc("div", { className: "lc2-tlbl" }, "Contracts"), rc("div", { className: "lc2-tval" }, String(_lcRows.length), rc("span", { style: { fontSize: 13, color: "var(--ink-4)", fontFamily: "var(--sans)", fontWeight: 400 } }, " \u00B7 " + _lcWorkers.length + " workers")))
    ) : null,
    rc("div", { className: "lc2-toolbar" },
      rc("div", { style: { position: "relative", flex: "1 1 240px", minWidth: 200, maxWidth: 340 } },
        rc("input", { type: "text", placeholder: "Search worker or job\u2026", value: searchQuery, onChange: (e) => setSearchQuery(e.target.value), "aria-label": "Search labor entries", style: { width: "100%", padding: "9px 12px 9px 34px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" } }),
        rc("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "#9ca3af", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", style: { position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" } }, rc("circle", { cx: "11", cy: "11", r: "8" }), rc("path", { d: "m21 21-4.3-4.3" }))
      ),
      rc("div", { className: "panel-tabs" }, [["all", "All"], ["direct", "Direct"], ["liability", "Liability"]].map(
        ([k, l]) => rc("button", { key: k, className: tab === k ? "active" : "", onClick: () => setTab(k) }, l)
      )),
      rc("button", { className: "lc2-export", type: "button", onClick: exportCsv, title: "Export the currently visible payments as CSV" }, Ico.download, " Export CSV")
    ),
    rc("div", { className: "lc2-list" },
      _allWorkers.length === 0
        ? rc("div", { className: "lc2-empty" }, searchQuery ? "No workers match your search." : "No labor recorded yet. Click \u201CAdd Payment\u201D to record a payroll payment, or \u201CNew Contract\u201D to cap a worker\u2019s job.")
        : _allWorkers.map(workerRow)
    )
  );
}
function DocPill({ m, k, label, title }) {
  const attached = !!m.docs[k];
  const onClick = (e) => {
    e.stopPropagation();
    if (attached && m.docUrls[k]) {
      if (window._receiptStore) {
        window._receiptStore[`docpill_${m.id}_${k}`] = { images: [m.docUrls[k]], name: `${title} \u2014 ${m.name}` };
        if (typeof window.openLightbox === "function") window.openLightbox(`docpill_${m.id}_${k}`, 0);
      } else {
        window.open(m.docUrls[k], "_blank");
      }
    } else {
      if (typeof window.openEditExpenseModal === "function") window.openEditExpenseModal(m.id);
    }
  };
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      className: "pc-doc-pill clickable" + (attached ? " done" : ""),
      title: attached ? `${title} \u2014 click to view` : `${title} \u2014 click to attach`,
      onClick,
      role: "button"
    },
    label
  );
}
function openRowSupportingDocs(m) {
  const order = [
    { k: "po", label: "Purchase Order" },
    { k: "dr", label: "Delivery Receipt" },
    { k: "si", label: "Supplier Invoice" },
    { k: "pay", label: "Payment Receipt" }
  ];
  const receipts = Array.isArray(m.receipts) ? m.receipts : [];
  const docImgs = order.filter((o) => m.docUrls && m.docUrls[o.k]).map((o) => m.docUrls[o.k]);
  const images = [...receipts, ...docImgs];
  if (!images.length) {
    if (typeof window.showExpNotif === "function") {
      window.showExpNotif("No images attached yet \u2014 open Edit to add a receipt or PO/DR/SI/PR document.", "info");
    } else {
      alert("No images attached yet for this entry.");
    }
    return;
  }
  if (window._receiptStore && typeof window.openLightbox === "function") {
    const key = `rowdocs_${m.id}`;
    window._receiptStore[key] = { images, name: `${m.name} \u2014 Attachments` };
    window.openLightbox(key, 0);
  } else {
    window.open(images[0], "_blank");
  }
}
function MaterialDrill({ project, onBack, materialTx, childMonths, activeFolder, folderId }) {
  const printMaterialReceipt = (m) => {
    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const amountFmt = "\u20B1 " + peso(m.amount);
    const dateStr = m.date || "\u2014";
    const docs = m.docs || {};
    const supplierBlock = m.supplier ? '<div class="item-supplier">Supplier: ' + esc(m.supplier) + "</div>" : "";
    const docFlags = [];
    if (docs.po) docFlags.push(" \u2713 Purchase Order");
    if (docs.dr) docFlags.push(" \u2713 Delivery Receipt");
    if (docs.si) docFlags.push(" \u2713 Supplier Invoice");
    if (docs.pay) docFlags.push(" \u2713 Payment Receipt");
    const docsLine = docFlags.length ? docFlags.join("") : " (none attached)";
    const printedOn = (/* @__PURE__ */ new Date()).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
    const w = window.open("", "_blank");
    if (!w) {
      alert("Allow popups for this site to print the material receipt.");
      return;
    }
    const html = "<!DOCTYPE html><html><head><title>Material Receipt \u2014 " + esc(m.name || "") + '</title><style>body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;padding:36px;max-width:680px;margin:0 auto;}.header{border-bottom:2px solid #1A5C3A;padding-bottom:14px;margin-bottom:22px;}.doc-title{font-size:20px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#1A5C3A;margin:0;}.doc-subtitle{font-size:12px;color:#6b7280;margin-top:4px;}.meta{margin-bottom:20px;font-size:12.5px;}.meta-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9;}.meta-label{color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em;font-size:11px;}.meta-value{color:#111;font-weight:600;text-align:right;}.item-block{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:18px;}.item-name{font-size:18px;font-weight:700;color:#111;margin-bottom:6px;}.item-supplier{font-size:13px;color:#6b7280;}.total-row{display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-top:2px solid #111;margin-top:6px;}.total-label{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;}.total-amount{font-size:22px;font-weight:800;color:#1A5C3A;}.docs{margin-top:18px;font-size:12px;color:#374151;}.docs strong{color:#111;}.signature{margin-top:48px;display:flex;justify-content:space-between;gap:60px;}.sig-line{flex:1;border-top:1px solid #111;padding-top:6px;font-size:11px;text-align:center;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;}.footer{margin-top:28px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:10.5px;color:#9ca3af;text-align:center;}@media print { body { padding:18px; } }</style></head><body><div class="header"><h1 class="doc-title">Material Expense Receipt</h1><div class="doc-subtitle">Internal record \xB7 for cost-tracking purposes only</div></div><div class="meta"><div class="meta-row"><span class="meta-label">Project</span><span class="meta-value">' + esc(project.name || "\u2014") + '</span></div><div class="meta-row"><span class="meta-label">Project Code</span><span class="meta-value">' + esc(project.code || "\u2014") + '</span></div><div class="meta-row"><span class="meta-label">Expense Date</span><span class="meta-value">' + esc(dateStr) + '</span></div><div class="meta-row"><span class="meta-label">Reference</span><span class="meta-value">' + esc(m.ref || m.id || "\u2014") + '</span></div></div><div class="item-block"><div class="item-name">' + esc(m.name || "Material Item") + "</div>" + supplierBlock + '</div><div class="total-row"><span class="total-label">Total Amount</span><span class="total-amount">' + esc(amountFmt) + '</span></div><div class="docs"><strong>Supporting Documents:</strong>' + esc(docsLine) + '</div><div class="signature"><div class="sig-line">Prepared By</div><div class="sig-line">Verified By</div></div><div class="footer">Generated by DAC&#39;s Portal &middot; ' + esc(printedOn) + "</div></body></html>";
    w.document.write(html);
    w.document.close();
    setTimeout(function() {
      w.print();
    }, 400);
  };
  const dc = project.docCounts;
  const count = materialTx.length;
  const [searchQuery, setSearchQuery] = React.useState("");
  const [docFilter, setDocFilter] = React.useState("all");
  const [detailsItem, setDetailsItem] = React.useState(null);
  const billingByProjectId = React.useMemo(() => {
    const monthNum = (m) => {
      const map2 = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const s = String(m || "").toLowerCase().slice(0, 3);
      return map2[s] || 99;
    };
    const sorted = [...childMonths || []].sort((a, b) => {
      const ya = +a.year || 0, yb = +b.year || 0;
      if (ya !== yb) return ya - yb;
      return monthNum(a.month) - monthNum(b.month);
    });
    const map = /* @__PURE__ */ new Map();
    sorted.forEach((m, i) => map.set(m.id, i + 1));
    return map;
  }, [childMonths]);
  const openReceiptThumb = (m) => {
    if (!m.firstReceipt) return;
    if (window._receiptStore && typeof window.openLightbox === "function") {
      const key = `thumb_${m.id}`;
      window._receiptStore[key] = { images: [m.firstReceipt], name: `Receipt \u2014 ${m.name}` };
      window.openLightbox(key, 0);
    } else {
      window.open(m.firstReceipt, "_blank");
    }
  };
  const filteredTx = React.useMemo(() => {
    let result = materialTx;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (m) => (m.name || "").toLowerCase().includes(q) || (m.category || "").toLowerCase().includes(q)
      );
    }
    if (docFilter === "incomplete") {
      result = result.filter((m) => {
        const d = m.docs || {};
        return !(d.po && d.dr && d.si && d.pay);
      });
    } else if (docFilter === "complete") {
      result = result.filter((m) => {
        const d = m.docs || {};
        return d.po && d.dr && d.si && d.pay;
      });
    }
    return result;
  }, [materialTx, searchQuery, docFilter]);
  const MAT_PALETTE = ["#157a52", "#c8a45a", "#7f9cb0", "#9fb98a", "#b0907f", "#8a7fb0", "#5e9d80", "#c0564a"];
  const matCatColor = (name) => { let n = 0; const x = String(name || ""); for (let i = 0; i < x.length; i++) n = (n * 31 + x.charCodeAt(i)) >>> 0; return MAT_PALETTE[n % MAT_PALETTE.length]; };
  const byCategory = React.useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    filteredTx.forEach((m) => {
      const cat = (m.category || "Uncategorized").trim() || "Uncategorized";
      map.set(cat, (map.get(cat) || 0) + (Number(m.amount) || 0));
    });
    return Array.from(map.entries()).map(([cat, amt]) => ({ cat, amt })).sort((a, b) => b.amt - a.amt);
  }, [filteredTx]);
  const groupedTx = React.useMemo(() => {
    const order = byCategory.map((r) => r.cat);
    const byCat = /* @__PURE__ */ new Map();
    filteredTx.forEach((m) => {
      const cat = (m.category || "Uncategorized").trim() || "Uncategorized";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(m);
    });
    const flat = [];
    order.forEach((cat) => {
      const items = byCat.get(cat) || [];
      const total = items.reduce((s, m) => s + (Number(m.amount) || 0), 0);
      const pctContract = project.revenue > 0 ? total / project.revenue * 100 : 0;
      flat.push({ kind: "header", cat, total, pctContract, count: items.length });
      items.forEach((m) => flat.push({ kind: "item", m }));
    });
    return flat;
  }, [filteredTx, byCategory, project.revenue]);
  const exportCsv = () => {
    const headers = ["Date", "Description", "Category", "Amount (PHP)", "PO", "DR", "SI", "PR"];
    const csvEsc = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const rows = filteredTx.map((m) => {
      const d = m.docs || {};
      return [
        m.date || "",
        m.name || "",
        m.category || "",
        Number(m.amount) || 0,
        d.po ? "Yes" : "No",
        d.dr ? "Yes" : "No",
        d.si ? "Yes" : "No",
        d.pay ? "Yes" : "No"
      ].map(csvEsc).join(",");
    });
    const csv = [headers.map(csvEsc).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `materials-${project.code || "export"}-${_ovhdLocalToday()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  };
  const pillBase = { padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", whiteSpace: "nowrap" };
  const pillActive = { ...pillBase, background: "#1A5C3A", color: "#fff", borderColor: "#1A5C3A" };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("section", { className: "drill" }, /* @__PURE__ */ React.createElement("button", { className: "back-btn", onClick: onBack, title: "Go back to Project Control" }, Ico.arrowL, " Back to Project Control"), /* @__PURE__ */ React.createElement(ExpenseInboxMount, { folderId, label: project && project.name || "", kind: "material" }), /* @__PURE__ */ React.createElement("div", { className: "drill-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Material Cost \xB7 Transaction History"), /* @__PURE__ */ React.createElement("h2", null, "Materials", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--sans)", color: "var(--brand-green)", fontWeight: 700, fontSize: "22px", letterSpacing: "0.02em", marginLeft: 18, background: "rgba(26,90,58,0.12)", padding: "8px 20px", borderRadius: "999px", whiteSpace: "nowrap", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" } }, project.revenue > 0 ? (project.material / project.revenue * 100).toFixed(1) + "%" : "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "sub" }, project.name, " \xB7 ", project.code)), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: () => openAddEntry("material", childMonths, activeFolder) }, Ico.plus, " Add Expense")), /* @__PURE__ */ React.createElement("div", { className: "drill-stats" }, /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Purchase Order"), /* @__PURE__ */ React.createElement("div", { className: "val" }, dc.po, " / ", count)), /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Delivery Receipt"), /* @__PURE__ */ React.createElement("div", { className: "val" }, dc.dr, " / ", count)), /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Supplier Invoice"), /* @__PURE__ */ React.createElement("div", { className: "val" }, dc.si, " / ", count)), _staff() ? null : /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Material Total \xB7 Actual"), /* @__PURE__ */ React.createElement("div", { className: "val total" }, "\u20B1 ", peso(project.material)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "14px 4px 4px" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flex: "1 1 220px", minWidth: 200, maxWidth: 380 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "Search by description or category\u2026",
      value: searchQuery,
      onChange: (e) => setSearchQuery(e.target.value),
      "aria-label": "Search material transactions",
      style: { width: "100%", padding: "8px 12px 8px 32px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }
    }
  ), /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "#9ca3af", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", style: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" } }, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "8" }), /* @__PURE__ */ React.createElement("path", { d: "m21 21-4.3-4.3" }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("button", { type: "button", style: docFilter === "all" ? pillActive : pillBase, onClick: () => setDocFilter("all") }, "All"), /* @__PURE__ */ React.createElement("button", { type: "button", style: docFilter === "incomplete" ? pillActive : pillBase, onClick: () => setDocFilter("incomplete") }, "Missing docs"), /* @__PURE__ */ React.createElement("button", { type: "button", style: docFilter === "complete" ? pillActive : pillBase, onClick: () => setDocFilter("complete") }, "Fully documented")), /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11.5, color: "var(--ink-3)" } }, filteredTx.length, " of ", count), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: exportCsv,
      title: "Export the currently visible rows as CSV",
      style: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1.5px solid #d1fae5", background: "#f0fdf4", color: "#059669", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }
    },
    /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), /* @__PURE__ */ React.createElement("polyline", { points: "7 10 12 15 17 10" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "15", x2: "12", y2: "3" })),
    "Export CSV"
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "4px 16px", fontSize: 11.5, color: "var(--ink-3)", margin: "10px 4px 6px" } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)" } }, "PO"), " Purchase Order"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)" } }, "DR"), " Delivery Receipt"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)" } }, "SI"), " Supplier Invoice"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)" } }, "PR"), " Payment Receipt")), /* @__PURE__ */ React.createElement("table", { className: "tx-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { width: 170 } }, "Date"), /* @__PURE__ */ React.createElement("th", null, "Description"), /* @__PURE__ */ React.createElement("th", null, "Category"), /* @__PURE__ */ React.createElement("th", { style: { width: 160 } }, "Documents"), /* @__PURE__ */ React.createElement("th", { className: "right", style: { width: 140 } }, "Amount"), /* @__PURE__ */ React.createElement("th", { style: { width: 70 } }, "Receipt"), /* @__PURE__ */ React.createElement("th", { style: { width: 140 } }, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, filteredTx.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 7, style: { padding: "24px 12px", textAlign: "center", color: "var(--ink-3)" } }, count === 0 ? "No expense entries in this period." : "No transactions match the current search/filter.")), groupedTx.map((row, i) => {
    if (row.kind === "header") {
      const col = matCatColor(row.cat);
      return /* @__PURE__ */ React.createElement("tr", { key: "cat_" + row.cat + "_" + i, style: { background: "#faf9f7" } }, /* @__PURE__ */ React.createElement("td", { colSpan: 4, style: { padding: "10px 16px" } }, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 8, font: "600 12.5px 'IBM Plex Sans'", color: "var(--ink)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: col, flex: "none" } }), row.cat, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 400, color: "var(--ink-3)" } }, "(", row.count, ")"))), /* @__PURE__ */ React.createElement("td", { className: "right", style: { padding: "10px 16px" } }, /* @__PURE__ */ React.createElement("span", { style: { font: "700 13px 'IBM Plex Sans'", color: "var(--ink)" } }, "₱ ", peso(row.total)), _staff() ? null : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--brand-green)", marginTop: 2 } }, row.pctContract.toFixed(2), "% of contract")), /* @__PURE__ */ React.createElement("td", { colSpan: 2 }));
    }
    const m = row.m;
    const billingNum = billingByProjectId.get(m.projectId);
    return /* @__PURE__ */ React.createElement("tr", { key: m.id || i, className: "row", onClick: () => setDetailsItem(m), title: "Click to view item details" }, /* @__PURE__ */ React.createElement("td", { style: { fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "nowrap" } }, fmtDateTime(m.dateTime || m.date)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { className: "name" }, m.name), /* @__PURE__ */ React.createElement(PaymentTag, { method: m.paymentMethod })), billingNum && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5 } }, /* @__PURE__ */ React.createElement("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })), "Charged to \xB7 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)", fontWeight: 600 } }, "Billing #", billingNum))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--ink-2)" } }, m.category || "\u2014")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "pc-docs-row", title: "Purchase Order \xB7 Delivery Receipt \xB7 Supplier Invoice \xB7 Payment Receipt" }, /* @__PURE__ */ React.createElement(DocPill, { m, k: "po", label: "PO", title: "Purchase Order" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "dr", label: "DR", title: "Delivery Receipt" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "si", label: "SI", title: "Supplier Invoice" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "pay", label: "PR", title: "Payment Receipt" }))), /* @__PURE__ */ React.createElement("td", { className: "right" }, /* @__PURE__ */ React.createElement("span", { className: "amt" }, "\u20B1 ", peso(m.amount)), _staff() ? null : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 } }, project.revenue > 0 ? (Number(m.amount) / project.revenue * 100).toFixed(2) + "% of contract" : "\u2014")), /* @__PURE__ */ React.createElement("td", { onClick: (e) => e.stopPropagation() }, m.firstReceipt ? /* @__PURE__ */ React.createElement(
      "img",
      {
        src: m.firstReceipt,
        alt: "Receipt",
        loading: "lazy",
        onClick: () => openReceiptThumb(m),
        style: { width: 44, height: 44, objectFit: "cover", borderRadius: 6, cursor: "pointer", border: "1px solid #e5e7eb", display: "block" }
      }
    ) : /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db", fontSize: 11 } }, "\u2014")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "Print receipt for this material expense", onClick: (e) => {
      e.stopPropagation();
      printMaterialReceipt(m);
    } }, Ico.receipt || "\u{1F9FE}"), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "Edit", onClick: (e) => {
      e.stopPropagation();
      window.openEditExpenseModal && window.openEditExpenseModal(m.id);
    } }, Ico.pencil || "\u270E"), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon pc-row-icon-danger", title: "Delete", onClick: (e) => {
      e.stopPropagation();
      window.deleteExpense && window.deleteExpense(m.id);
    } }, Ico.trash || "\u{1F5D1}")));
  })))), detailsItem && /* @__PURE__ */ React.createElement(
    ItemDetailsModal,
    {
      item: detailsItem,
      billingNum: billingByProjectId.get(detailsItem.projectId),
      onClose: () => setDetailsItem(null),
      onOpenImage: openReceiptThumb,
      onPrint: printMaterialReceipt
    }
  ));
}
function ItemDetailsModal({ item, billingNum, onClose, onOpenImage, onPrint }) {
  const m = item;
  const receipts = Array.isArray(m.receipts) ? m.receipts : [];
  const docOrder = [
    { k: "po", label: "Purchase Order" },
    { k: "dr", label: "Delivery Receipt" },
    { k: "si", label: "Supplier Invoice" },
    { k: "pay", label: "Payment Receipt" }
  ];
  const docImgs = docOrder.filter((o) => m.docUrls && m.docUrls[o.k]).map((o) => ({ url: m.docUrls[o.k], label: o.label }));
  const allImages = [
    ...receipts.map((url, i) => ({ url, label: `Receipt ${i + 1}` })),
    ...docImgs
  ];
  const openImg = (url, label) => {
    if (window._receiptStore && typeof window.openLightbox === "function") {
      const key = `details_${m.id}`;
      window._receiptStore[key] = { images: allImages.map((x) => x.url), name: `${m.name} \u2014 ${label}` };
      const idx = allImages.findIndex((x) => x.url === url);
      window.openLightbox(key, idx >= 0 ? idx : 0);
    } else {
      window.open(url, "_blank");
    }
  };
  const Row = ({ label, children }) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, padding: "10px 0", borderBottom: "1px solid #f3f4f6" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 130, fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 } }, label), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, fontSize: 14, color: "#111827" } }, children));
  return /* @__PURE__ */ React.createElement("div", { onClick: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" } }, /* @__PURE__ */ React.createElement("div", { onClick: (e) => e.stopPropagation(), style: { background: "#fff", borderRadius: 14, maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, position: "sticky", top: 0, background: "#fff", zIndex: 1, borderRadius: "14px 14px 0 0" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#6b7280", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 } }, "Item Details"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "#111827", wordBreak: "break-word" } }, m.name)), /* @__PURE__ */ React.createElement("button", { onClick: onClose, "aria-label": "Close", style: { background: "#f3f4f6", border: "none", width: 32, height: 32, borderRadius: 8, fontSize: 18, cursor: "pointer", color: "#6b7280", lineHeight: 1, flexShrink: 0 } }, "\xD7")), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 24px 20px" } }, /* @__PURE__ */ React.createElement(Row, { label: "Amount" }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 700, color: "#1A5C3A" } }, "\u20B1 ", peso(m.amount))), /* @__PURE__ */ React.createElement(Row, { label: "Date & Time" }, fmtDateTime(m.dateTime || m.date)), /* @__PURE__ */ React.createElement(Row, { label: "Category" }, m.category || /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db" } }, "\u2014")), /* @__PURE__ */ React.createElement(Row, { label: "Payment" }, /* @__PURE__ */ React.createElement(PaymentTag, { method: m.paymentMethod }), " ", !m.paymentMethod && /* @__PURE__ */ React.createElement("span", { style: { color: "#d1d5db" } }, "\u2014")), m.quantity > 1 && /* @__PURE__ */ React.createElement(Row, { label: "Quantity" }, m.quantity), billingNum && /* @__PURE__ */ React.createElement(Row, { label: "Charged To" }, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })), /* @__PURE__ */ React.createElement("b", null, "Billing #", billingNum))), /* @__PURE__ */ React.createElement(Row, { label: "Documents" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } }, docOrder.map((o) => {
    const has = !!(m.docs && m.docs[o.k]);
    return /* @__PURE__ */ React.createElement("span", { key: o.k, title: o.label, style: { padding: "3px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", background: has ? "#dcfce7" : "#f3f4f6", color: has ? "#166534" : "#9ca3af", border: "1px solid", borderColor: has ? "#86efac" : "#e5e7eb" } }, o.k === "pay" ? "PR" : o.k.toUpperCase(), " ", has ? "\u2713" : "\u2014");
  }))), m.notes && /* @__PURE__ */ React.createElement(Row, { label: "Notes" }, /* @__PURE__ */ React.createElement("div", { style: { whiteSpace: "pre-wrap", color: "#374151" } }, m.notes)), m.ref && /* @__PURE__ */ React.createElement(Row, { label: "Reference" }, /* @__PURE__ */ React.createElement("code", { style: { fontSize: 12, color: "#6b7280" } }, m.ref)), allImages.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 } }, "Attachments (", allImages.length, ")"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 10 } }, allImages.map((img, i) => /* @__PURE__ */ React.createElement("div", { key: i, onClick: () => openImg(img.url, img.label), style: { cursor: "pointer", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb", background: "#f9fafb" } }, /* @__PURE__ */ React.createElement("img", { src: img.url, alt: img.label, loading: "lazy", style: { width: "100%", height: 90, objectFit: "cover", display: "block" } }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10.5, color: "#6b7280", padding: "4px 6px", textAlign: "center" } }, img.label)))))), /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 24px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 8, justifyContent: "flex-end", position: "sticky", bottom: 0, background: "#fff", borderRadius: "0 0 14px 14px" } }, /* @__PURE__ */ React.createElement("button", { onClick: () => onPrint && onPrint(m), style: { padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600, cursor: "pointer" } }, "Print Receipt"), /* @__PURE__ */ React.createElement("button", { onClick: () => {
    onClose();
    window.openEditExpenseModal && window.openEditExpenseModal(m.id);
  }, style: { padding: "8px 14px", borderRadius: 8, border: "1px solid #1A5C3A", background: "#1A5C3A", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" } }, "Edit"))));
}
function PaymentTag({ method }) {
  if (!method) return null;
  const key = String(method).toLowerCase().trim();
  const styles = {
    gcash: { bg: "#ede9fe", color: "#5b21b6" },
    // purple (GCash brand-ish)
    lalamove: { bg: "#dbeafe", color: "#1e40af" },
    // blue (Lalamove brand-ish)
    bank: { bg: "#dcfce7", color: "#166534" },
    // green
    cash: { bg: "#fef3c7", color: "#92400e" },
    // amber
    card: { bg: "#fce7f3", color: "#9f1239" },
    // pink
    bdo: { bg: "#dbeafe", color: "#1e40af" },
    bpi: { bg: "#fee2e2", color: "#991b1b" },
    paymaya: { bg: "#dcfce7", color: "#166534" },
    maya: { bg: "#dcfce7", color: "#166534" }
  };
  const s = styles[key] || { bg: "#f3f4f6", color: "#374151" };
  return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", background: s.bg, color: s.color } }, method);
}
function periodCutoff(period) {
  const now = /* @__PURE__ */ new Date();
  if (period === "All Time") return null;
  if (period === "Last 30 days") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (period === "This Month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  if (period === "Quarter to Date") {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return new Date(now.getFullYear(), q, 1);
  }
  if (period === "Year to Date") {
    return new Date(now.getFullYear(), 0, 1);
  }
  return null;
}
function filterByPeriod(rows, period) {
  const cutoff = periodCutoff(period);
  if (!cutoff) return rows;
  return rows.filter((r) => {
    if (!r.date) return false;
    const d = new Date(r.date.length === 10 ? r.date + "T00:00:00" : r.date);
    return !isNaN(d) && d >= cutoff;
  });
}
function BillingSummary({ billing }) {
  const b = billing;
  const [boqOpen, setBoqOpen] = React.useState(false);
  const [prOpen, setPrOpen] = React.useState(false);
  const [invOpen, setInvOpen] = React.useState(false);
  const chev = (open, setOpen, label) => React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": (open ? "Collapse " : "Expand ") + label, onClick: (e) => { e.stopPropagation(); setOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" } }, React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, React.createElement("polyline", { points: "6 9 12 15 18 9" })));
  if (!b || !b.linked) {
    return /* @__PURE__ */ React.createElement("section", { className: "pc-summarize", style: { display: "block" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-light)", fontWeight: 600, marginBottom: 8 } }, "Billing & Reports"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6 } }, "No linked billing yet. Create an ", /* @__PURE__ */ React.createElement("b", null, "Accomplishment Report (BOQ)"), " for this project under ", /* @__PURE__ */ React.createElement("b", null, "Billing & Reports"), " to connect Payment Requests and Invoices here."));
  }
  const jump = (view) => {
    if (typeof window.switchView !== "function") return;
    window.switchView(view);
    setTimeout(() => {
      try {
        if (view === "boqBuilder" && b.folderId && typeof window.boqSelectFolder === "function") {
          window.boqSelectFolder(b.folderId);
        } else if (view === "paymentRequests" && b.clientEmail) {
          const input = document.getElementById("prSearchInput");
          if (input) {
            input.value = b.clientEmail;
            if (typeof window.prFilterRequests === "function") window.prFilterRequests();
          }
        }
      } catch (e) {
      }
    }, 80);
  };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-light)", fontWeight: 600, margin: "4px 2px 10px" } }, "Billing & Reports", b.clientEmail ? " \xB7 " + b.clientEmail : ""), /* @__PURE__ */ React.createElement("section", { className: "pc-flow-cards" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "pc-flow-card" + (boqOpen ? "" : " pc-flow-card--collapsed"), onClick: () => jump("boqBuilder"), title: "Open the Accomplishment Report (BOQ) for this project" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-blue" }, Ico.doc), "Accomplishment (BOQ)", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "The Accomplishment Report (Bill of Quantities) — the priced breakdown of every work item and how much of each has been completed to date. Click Open to view or edit it.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Open \u2192"), (_staff() ? null : chev(boqOpen, setBoqOpen, "BOQ breakdown"))), boqOpen && !_staff() && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "\u20B1"), peso(b.boqContract)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "Contract value \xB7 ", b.accPct.toFixed(1), "% accomplished"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Accomplished"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(b.boqAcc))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Remaining"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(b.boqContract - b.boqAcc)))))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pc-flow-card" + (prOpen ? "" : " pc-flow-card--collapsed"), onClick: () => jump("paymentRequests"), title: "Open Payment Requests" + (b.clientEmail ? " (filtered to " + b.clientEmail + ")" : "") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon" }, Ico.briefcase), "Payment Requests", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Requests for client payment tied to this project's billing. Track what has been requested, collected, and is still pending. Click Open to manage them.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Open \u2192"), (_staff() ? null : chev(prOpen, setPrOpen, "payment requests breakdown"))), prOpen && !_staff() && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "\u20B1"), peso(b.prCollected)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "Collected of \u20B1 ", peso(b.prRequested), " requested"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Requests"), /* @__PURE__ */ React.createElement("span", { className: "val" }, b.prCount)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Pending"), /* @__PURE__ */ React.createElement("span", { className: "val" }, b.prPending))))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "pc-flow-card" + (invOpen ? "" : " pc-flow-card--collapsed"), onClick: () => jump("invoices"), title: "Open Invoices" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-amber" }, Ico.receipt), "Invoices", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Official invoices issued to the client for this project. Click Open to view, create, or send invoices.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Open \u2192"), (_staff() ? null : chev(invOpen, setInvOpen, "invoices breakdown"))), invOpen && !_staff() && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "\u20B1"), peso(b.invTotal)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "Total invoiced to client"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Invoices"), /* @__PURE__ */ React.createElement("span", { className: "val" }, b.invCount)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Issued"), /* @__PURE__ */ React.createElement("span", { className: "val" }, b.invIssued)))))));
}
function PortalApp() {
  const [t, setTweak] = window.useTweaks({ accent: "#1A5C3A", dark: false, panelExpanded: true });
  const [period, setPeriod] = React.useState("All Time");
  const [view, setView] = React.useState("dashboard");
  const [foldersRaw, setFoldersRaw] = React.useState([]);
  const [monthsRaw, setMonthsRaw] = React.useState([]);
  const [payrollRaw, setPayrollRaw] = React.useState([]);
  const [expensesRaw, setExpensesRaw] = React.useState([]);
  const [overheadRaw, setOverheadRaw] = React.useState([]);
  const [additionalWorksRaw, setAdditionalWorksRaw] = React.useState([]);
  const folderBudgetRef = React.useRef({});
  const projectBudgetRef = React.useRef({});
  const [isStaff, setIsStaff] = React.useState(false);
  const [boqRaw, setBoqRaw] = React.useState([]);
  const [payReqRaw, setPayReqRaw] = React.useState([]);
  const [invoicesRaw, setInvoicesRaw] = React.useState([]);
  const [laborContractsRaw, setLaborContractsRaw] = React.useState([]);
  const [projectId, setProjectId] = React.useState(null);
  React.useEffect(() => {
    window._activeProjectFolderId = projectId || null;
  }, [projectId]);
  React.useEffect(() => {
    window.pcOpenFolder = (id) => {
      if (id) setProjectId(id);
    };
    return () => {
      if (window.pcOpenFolder) delete window.pcOpenFolder;
    };
  }, []);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [authUid, setAuthUid] = React.useState(() => firebase.auth().currentUser && firebase.auth().currentUser.uid || null);
  const [ownerId, setOwnerId] = React.useState(null);
  React.useEffect(() => {
    const unsub = firebase.auth().onAuthStateChanged((u) => {
      setAuthUid(u ? u.uid : null);
      if (!u) {
        setOwnerId(null);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);
  React.useEffect(() => {
    if (!authUid || typeof db === "undefined") {
      setOwnerId(null);
      return;
    }
    let cancelled = false;
    db.collection("users").doc(authUid).get().then((doc) => {
      if (cancelled) return;
      const data = doc.exists ? doc.data() : null;
      const eff = data && data.role === "staff" && data.ownerUid ? data.ownerUid : authUid;
      window.currentDataUserId = eff;
      setIsStaff(!!(data && data.role === "staff"));
      setOwnerId(eff);
    }).catch(() => {
      if (!cancelled) setOwnerId(authUid);
    });
    return () => {
      cancelled = true;
    };
  }, [authUid]);
  React.useEffect(() => {
    if (!ownerId || typeof db === "undefined") return;
    setLoading(true);
    const dataUid = ownerId;
    let done = 0;
    const totalNeeded = 4;
    const onAny = () => {
      done++;
      if (done >= totalNeeded) setLoading(false);
    };
    const onErr = (e) => setError(e.message || "Failed to load project data");
    const unsubs = [
      db.collection("folders").where("userId", "==", dataUid).onSnapshot(
        (s) => {
          setFoldersRaw(s.docs.map((d) => ({ id: d.id, ...d.data(), totalBudget: folderBudgetRef.current[d.id] || 0 })));
          onAny();
        },
        onErr
      ),
      db.collection("projects").where("userId", "==", dataUid).onSnapshot(
        (s) => {
          setMonthsRaw(s.docs.map((d) => ({ id: d.id, ...d.data(), monthlyBudget: projectBudgetRef.current[d.id] || 0 })));
          onAny();
        },
        onErr
      ),
      db.collection("expenses").where("userId", "==", dataUid).onSnapshot(
        (s) => {
          setExpensesRaw(s.docs.map((d) => ({ id: d.id, ...d.data() })));
          onAny();
        },
        onErr
      ),
      db.collection("payroll").where("userId", "==", dataUid).onSnapshot(
        (s) => {
          setPayrollRaw(s.docs.map((d) => ({ id: d.id, ...d.data() })));
          onAny();
        },
        onErr
      )
    ];
    return () => unsubs.forEach((u) => u && u());
  }, [ownerId]);
  React.useEffect(() => {
    if (!ownerId || typeof db === "undefined") return;
    const dataUid = ownerId;
    const unsubs = [
      db.collection("folderBudgets").where("userId", "==", dataUid).onSnapshot((s) => {
        const m = {};
        s.docs.forEach((d) => {
          m[d.id] = d.data().totalBudget || 0;
        });
        folderBudgetRef.current = m;
        setFoldersRaw((prev) => prev.map((f) => ({ ...f, totalBudget: m[f.id] || 0 })));
      }, () => {
      }),
      db.collection("projectBudgets").where("userId", "==", dataUid).onSnapshot((s) => {
        const m = {};
        s.docs.forEach((d) => {
          m[d.id] = d.data().monthlyBudget || 0;
        });
        projectBudgetRef.current = m;
        setMonthsRaw((prev) => prev.map((p) => ({ ...p, monthlyBudget: m[p.id] || 0 })));
      }, () => {
      }),
      db.collection("overheadExpenses").where("userId", "==", dataUid).onSnapshot((s) => {
        setOverheadRaw(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, () => {
      }),
      db.collection("additionalWorks").where("userId", "==", dataUid).onSnapshot((s) => {
        setAdditionalWorksRaw(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, () => {
      })
    ];
    return () => unsubs.forEach((u) => u && u());
  }, [ownerId, isStaff]);
  React.useEffect(() => {
    if (!ownerId || typeof db === "undefined") return;
    const skip = () => {
    };
    const unsubs = [
      db.collection("boqDocuments").where("userId", "==", ownerId).onSnapshot(
        (s) => setBoqRaw(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        skip
      ),
      db.collection("invoices").where("userId", "==", ownerId).onSnapshot(
        (s) => setInvoicesRaw(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        skip
      ),
      db.collection("paymentRequests").where("ownerUid", "==", ownerId).onSnapshot(
        (s) => setPayReqRaw(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        skip
      ),
      db.collection("laborContracts").where("userId", "==", ownerId).onSnapshot(
        (s) => setLaborContractsRaw(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        skip
      )
    ];
    return () => unsubs.forEach((u) => u && u());
  }, [ownerId]);
  React.useEffect(() => {
    if (projectId) setView("dashboard");
  }, [projectId]);
  const activeFolder = foldersRaw.find((f) => f.id === projectId);
  const childMonths = React.useMemo(
    () => monthsRaw.filter((m) => m.folderId === projectId).map(mapMonthlyProject),
    [monthsRaw, projectId]
  );
  const childMonthIds = React.useMemo(() => new Set(childMonths.map((m) => m.id)), [childMonths]);
  const allLaborTx = React.useMemo(
    () => payrollRaw.filter((p) => childMonthIds.has(p.projectId)).map(mapPayrollDoc).sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [payrollRaw, childMonthIds]
  );
  const allMaterialTx = React.useMemo(
    () => expensesRaw.filter((e) => childMonthIds.has(e.projectId)).map(mapExpenseDoc).sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [expensesRaw, childMonthIds]
  );
  // Soft-deleted rows (deleted from the admin Overhead page) must not resurface here.
  const overheadRows = React.useMemo(
    () => (overheadRaw || []).filter((e) => e.folderId === projectId && !e.deletedAt),
    [overheadRaw, projectId]
  );
  // Operating costs honour the SAME period filter as labor and materials. Without
  // this, picking "This Month" would compare this month's labor+material against
  // ALL-TIME overhead and report a nonsense margin.
  const overheadRowsTx = React.useMemo(() => filterByPeriod(overheadRows, period), [overheadRows, period]);
  const overheadTx = React.useMemo(
    () => overheadRowsTx.map((e) => ({ id: e.id, category: e.category || "Uncategorized", amount: Number(e.amount) || 0, date: (e.date || "").toString().slice(0, 10), description: e.description || "", receiptUrl: e.receiptUrl || "" })).sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [overheadRowsTx]
  );
  const childFolders = React.useMemo(
    () => foldersRaw.filter((f) => f.parentFolderId === projectId),
    [foldersRaw, projectId]
  );
  // Additional Works child folders honour the SAME period filter as the parent.
  // Without this, "This Month" mixed this month's parent costs with the children's
  // ALL-TIME costs inside a single total.
  const childFolderStats = React.useMemo(
    () => childFolders.map((cf) => {
      const cfMonths = monthsRaw.filter((m) => m.folderId === cf.id).map(mapMonthlyProject);
      const cfMonthIds = new Set(cfMonths.map((m) => m.id));
      const cfLabor = filterByPeriod(payrollRaw.filter((p) => cfMonthIds.has(p.projectId)).map(mapPayrollDoc), period);
      const cfMaterial = filterByPeriod(expensesRaw.filter((e) => cfMonthIds.has(e.projectId)).map(mapExpenseDoc), period);
      const cfOverhead = filterByPeriod((overheadRaw || []).filter((e) => e.folderId === cf.id && !e.deletedAt), period);
      return { ...buildProject(cf, cfMonths, cfLabor, cfMaterial, cfOverhead), raw: cf };
    }),
    [childFolders, monthsRaw, payrollRaw, expensesRaw, overheadRaw, period]
  );
  const additionalWorksTotal = childFolderStats.reduce((s, c) => s + c.revenue, 0);
  const laborTx = React.useMemo(() => filterByPeriod(allLaborTx, period), [allLaborTx, period]);
  const materialTx = React.useMemo(() => filterByPeriod(allMaterialTx, period), [allMaterialTx, period]);
  // Indirect pay is Overhead, not Labor — so it shows in the Overhead drill and is
  // kept out of the Labor drill / worker tracker / contract drawdown. Splitting the
  // list here (rather than in each drill) keeps every screen on the same numbers.
  const laborOnlyTx = React.useMemo(() => laborTx.filter((t) => !_isOverheadPay(t)), [laborTx]);
  const overheadLaborTx = React.useMemo(() => laborTx.filter(_isOverheadPay), [laborTx]);
  const contractPayroll = React.useMemo(() => allLaborTx.filter((t) => t.type !== "indirect"), [allLaborTx]);
  // ALL-TIME overhead for the OCM allowance comparison — the allowance covers
  // the whole job, so this deliberately ignores the period filter.
  const allTimeOverheadSpent = React.useMemo(
    () => overheadRows.reduce((s, e) => s + (Number(e.amount) || 0), 0)
        + allLaborTx.filter(_isOverheadPay).reduce((s, t) => s + (t.amount || 0), 0),
    [overheadRows, allLaborTx]
  );
  const projects = React.useMemo(
    () => foldersRaw.filter((f) => !f.parentFolderId).map((f) => buildProject(f, [], [], [])),
    [foldersRaw]
  );
  const overheadTotal = overheadTx.reduce((s2, e) => s2 + (Number(e.amount) || 0), 0);
  const project = activeFolder ? (() => {
    const base = buildProject(activeFolder, childMonths, laborTx, materialTx, overheadRowsTx);
    const childRevenue = childFolderStats.reduce((s, c) => s + c.revenue, 0);
    const childLabor = childFolderStats.reduce((s, c) => s + c.labor, 0);
    const childMaterial = childFolderStats.reduce((s, c) => s + c.material, 0);
    const childAllocated = childFolderStats.reduce((s, c) => s + c.allocated, 0);
    const childOverhead = childFolderStats.reduce((s, c) => s + (c.overhead || 0), 0);
    const childOverheadExp = childFolderStats.reduce((s, c) => s + (c.overheadBreakdown ? c.overheadBreakdown.expenses : 0), 0);
    const childOverheadLabor = childFolderStats.reduce((s, c) => s + (c.overheadBreakdown ? c.overheadBreakdown.indirectLabor : 0), 0);
    const childLb = childFolderStats.reduce((acc, c) => ({
      direct: acc.direct + c.laborBreakdown.direct,
      indirect: acc.indirect + c.laborBreakdown.indirect,
      liability: acc.liability + c.laborBreakdown.liability,
      liabilityIndirect: acc.liabilityIndirect + (c.laborBreakdown.liabilityIndirect || 0)
    }), { direct: 0, indirect: 0, liability: 0, liabilityIndirect: 0 });
    const merged = {
      ...base,
      revenue: base.revenue + childRevenue,
      labor: base.labor + childLabor,
      material: base.material + childMaterial,
      allocated: base.allocated + childAllocated,
      overhead: base.overhead + childOverhead,
      overheadBreakdown: {
        indirectLabor: base.overheadBreakdown.indirectLabor + childOverheadLabor,
        expenses: base.overheadBreakdown.expenses + childOverheadExp
      },
      laborBreakdown: {
        direct: base.laborBreakdown.direct + childLb.direct,
        indirect: base.laborBreakdown.indirect + childLb.indirect,
        liability: base.laborBreakdown.liability + childLb.liability,
        liabilityIndirect: base.laborBreakdown.liabilityIndirect + childLb.liabilityIndirect,
        total: base.laborBreakdown.total + (childLb.direct + childLb.indirect + childLb.liability)
      }
    };
    merged.spent = _projSpent(merged);
    merged.completion = _folderCompletion(boqRaw, activeFolder.id);
    return merged;
  })() : null;
  const parentFolder = activeFolder && activeFolder.parentFolderId
    ? foldersRaw.find((f) => f.id === activeFolder.parentFolderId) || null
    : null;
  const folderContracts = React.useMemo(
    () => laborContractsRaw.filter((c) => c.folderId === projectId),
    [laborContractsRaw, projectId]
  );
  const folderPayrollAll = React.useMemo(
    () => payrollRaw.filter((p) => childMonthIds.has(p.projectId)),
    [payrollRaw, childMonthIds]
  );
  React.useEffect(() => {
    if (typeof window.lcSyncFromPortal === "function") {
      window.lcSyncFromPortal(projectId, folderContracts, folderPayrollAll);
    }
  }, [projectId, folderContracts, folderPayrollAll]);
  const billing = React.useMemo(() => {
    if (!activeFolder) return null;
    const boqMatches = boqRaw.filter((x) => x.folderId === activeFolder.id);
    const boqDoc = boqMatches.slice().sort((a, b) => (b.costItems && b.costItems.length || 0) - (a.costItems && a.costItems.length || 0))[0] || null;
    const boqContract = boqDoc ? boqGrandTotal(boqDoc.costItems) : 0;
    const boqAcc = boqDoc ? boqAccTotal(boqDoc.costItems) : 0;
    const clientEmail = boqDoc && boqDoc.clientEmail || "";
    const projectName = boqDoc && boqDoc.projectName || "";
    const prMatches = clientEmail ? payReqRaw.filter((r) => r.clientEmail === clientEmail && (!projectName || !r.projectName || r.projectName === projectName)) : [];
    const prRequested = prMatches.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const prCollected = prMatches.filter((r) => r.status === "verified").reduce((s, r) => s + (r.paidAmount != null ? Number(r.paidAmount) : Number(r.amount) || 0), 0);
    const prPending = prMatches.filter((r) => r.status !== "verified" && r.status !== "rejected").length;
    const clientNames = new Set(prMatches.map((r) => (r.clientName || "").trim()).filter(Boolean));
    const invMatches = invoicesRaw.filter((inv) => clientNames.has((inv.clientName || "").trim()));
    const invTotal = invMatches.reduce((s, i) => s + (Number(i.totalAmount) || 0), 0);
    const invIssued = invMatches.filter((i) => i.status === "issued").length;
    return {
      linked: !!boqDoc,
      folderId: activeFolder.id,
      clientEmail,
      projectName,
      boqContract,
      boqAcc,
      accPct: boqContract > 0 ? boqAcc / boqContract * 100 : 0,
      prRequested,
      prCollected,
      prPending,
      prCount: prMatches.length,
      invTotal,
      invIssued,
      invCount: invMatches.length
    };
  }, [activeFolder, boqRaw, payReqRaw, invoicesRaw]);
  if (!authUid) {
    return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("main", { className: "main" }, /* @__PURE__ */ React.createElement("div", { style: { padding: "80px 0", textAlign: "center", color: "var(--ink-3)" } }, "Sign in to view Project Control.")));
  }
  if (loading) {
    return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("main", { className: "main" }, /* @__PURE__ */ React.createElement("div", { style: { padding: "80px 0", textAlign: "center", color: "var(--ink-3)" } }, "Loading project data\u2026")));
  }
  if (error) {
    return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("main", { className: "main" }, /* @__PURE__ */ React.createElement("div", { style: { padding: "80px 0", textAlign: "center", color: "#c0392b" } }, "Error: ", error)));
  }
  if (!project) {
    return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("main", { className: "main" }, /* @__PURE__ */ React.createElement(
      FoldersGrid,
      {
        folders: projects,
        foldersRaw,
        monthsRaw,
        payrollRaw,
        expensesRaw,
        overheadRaw,
        boqRaw,
        onPickFolder: setProjectId
      }
    )));
  }
  return /* @__PURE__ */ React.createElement("div", { className: "app" }, /* @__PURE__ */ React.createElement("main", { className: "main" }, /* @__PURE__ */ React.createElement(
    PageHead,
    {
      project,
      projects,
      onSelectProject: setProjectId,
      period,
      onPeriod: setPeriod,
      onBackToGrid: () => setProjectId(null),
      parentFolder
    }
  ), view === "dashboard" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Summarize, { project }), /* @__PURE__ */ React.createElement(ExpenseInboxMount, { folderId: projectId, label: project && project.name || "" }), /* @__PURE__ */ React.createElement(KPIStrip, { project }), /* @__PURE__ */ React.createElement(FlowCards, { project, onOpen: setView, periodCount: childMonths.length, additionalWorksTotal, additionalWorksCount: childFolderStats.length, isAdditionalWorks: !!(activeFolder && activeFolder.parentFolderId) }), /* @__PURE__ */ React.createElement(BillingSummary, { billing }), /* @__PURE__ */ React.createElement(RecentEntries, { onOpen: setView, laborTx: laborOnlyTx, materialTx })), view === "labor" && /* @__PURE__ */ React.createElement(LaborDrill, { project, childMonths, onBack: () => setView("dashboard"), laborTx: laborOnlyTx, contracts: folderContracts, folderPayroll: contractPayroll, activeFolder, folderId: projectId }), view === "overhead" && /* @__PURE__ */ React.createElement(OverheadDrill, { project, onBack: () => setView("dashboard"), overheadTx, indirectTx: overheadLaborTx, folderId: projectId, ocmPct: activeFolder ? Number(activeFolder.ocmPct) || 0 : 0, contractAmount: activeFolder ? Number(activeFolder.totalBudget) || 0 : 0, allTimeOverhead: allTimeOverheadSpent }), view === "additionalWorks" && /* @__PURE__ */ React.createElement(AdditionalWorksDrill, { project, onBack: () => setView("dashboard"), childFolders: childFolderStats, additionalWorksRaw, onOpenChild: setProjectId, folderId: projectId }), view === "material" && /* @__PURE__ */ React.createElement(MaterialDrill, { project, childMonths, onBack: () => setView("dashboard"), materialTx, activeFolder, folderId: projectId }), view === "periods" && /* @__PURE__ */ React.createElement(BillingPeriodsDrill, { project, childMonths, payrollRaw, expensesRaw, onBack: () => setView("dashboard") })));
}
(function() {
  const mount = document.getElementById("dacsPortalRoot");
  if (mount && !mount.__dacsMounted) {
    mount.__dacsMounted = true;
    ReactDOM.createRoot(mount).render(/* @__PURE__ */ React.createElement(PortalApp, null));
  }
})();
