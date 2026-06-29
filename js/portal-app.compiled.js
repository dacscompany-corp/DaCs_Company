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
const INDIRECT_KEYWORDS = ["supervisor", "manager", "officer", "foreman", "indirect", "overhead", "admin"];
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
function buildProject(folder, childMonths, labor, material) {
  const laborBreakdown = labor.reduce((acc, p) => {
    acc[p.type] = (acc[p.type] || 0) + p.amount;
    acc.total += p.amount;
    return acc;
  }, { direct: 0, indirect: 0, liability: 0, total: 0 });
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
  const spent = laborBreakdown.total + materialTotal;
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
    labor: laborBreakdown.total,
    laborBreakdown,
    material: materialTotal,
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
  const rem = (folder.allocated - (folder.labor + folder.material)) / folder.allocated * 100;
  if (rem <= 0) return { label: "OVER", cls: "pc-fld-health-critical", barClr: "#c0392b" };
  if (rem < 10) return { label: "CRITICAL", cls: "pc-fld-health-critical", barClr: "#c0392b" };
  if (rem < 20) return { label: "WARNING", cls: "pc-fld-health-warning", barClr: "#A86B00" };
  return { label: "HEALTHY", cls: "pc-fld-health-healthy", barClr: "#1A5C3A" };
}
function FoldersGrid({ folders, foldersRaw, monthsRaw, payrollRaw, expensesRaw, onPickFolder }) {
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
    const built = buildProject(_raw, childMonths, labor, material);
    const h = foldersHealth(built);
    const spent = built.labor + built.material;
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
      spent: c.labor + c.material,
      remaining: c.remaining,
      coverCost: c.coverCost,
      statusLabel: c.h.label,
      spentPct: c.spentPct,
      periodCount: c.periodCount
    })), COVER_LIMIT);
  };
  const _spentOf = (c) => c.labor + c.material;
  const _marginOf = (c) => c.revenue > 0 ? (c.revenue - _spentOf(c)) / c.revenue * 100 : null;
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
            rc("button", { className: "pcf-act-btn", title: "AI budget summary", onClick: () => window.aiSummarizeFolder && window.aiSummarizeFolder({ name: c.name, location: c.location, revenue: c.revenue, allocated: c.allocated, labor: c.labor, material: c.material, coverCost: c.coverCost, remaining: c.remaining, spentPct: c.spentPct, periodCount: c.periodCount, statusLabel: st.label }) }, Ico.sparkles),
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
  return /* @__PURE__ */ React.createElement(React.Fragment, null, header, !_staff() && /* @__PURE__ */ React.createElement("button", { className: "pc-reminder pc-reminder-" + _hcKind, onClick: runHealthCheck, title: "Click for the full AI briefing" }, /* @__PURE__ */ React.createElement("span", { className: "pc-reminder-icon" }, _hcIconSvg[_hcKind]), /* @__PURE__ */ React.createElement("span", { className: "pc-reminder-text" }, /* @__PURE__ */ React.createElement("strong", null, _hcTitle), " ", _hcMsg), /* @__PURE__ */ React.createElement("span", { className: "pc-reminder-cta" }, "View details \u2192")), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-grid" }, cards.map((c) => /* @__PURE__ */ React.createElement("div", { key: c.id, className: "pc-fld-card-wrap" }, /* @__PURE__ */ React.createElement("button", { className: "pc-fld-card", onClick: () => onPickFolder(c.id) }, /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-name", style: { display: "flex", alignItems: "center", gap: 8 } }, c.name, /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "This is a project folder. It holds all billing periods, labor costs, material costs, and documents for one construction project. Click ‘Open Project’ to manage it.", onClick: (e) => e.stopPropagation() }, "?"), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": openCards[c.id] ? "Collapse" : "Expand", onClick: (e) => { e.stopPropagation(); setOpenCards((s) => ({ ...s, [c.id]: !s[c.id] })); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", color: "var(--brand-green)", transition: "transform .15s ease", transform: openCards[c.id] ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), c.location && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-loc" }, c.location)), openCards[c.id] && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-stats" }, !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Total Contract"), "            ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(c.revenue))), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Total Fund Allocated"), "      ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(c.allocated))), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Current Fund Spent"), "        ", /* @__PURE__ */ React.createElement("span", { className: "val pc-fld-stat-accent" }, "\u20B1 ", peso(c.labor + c.material))), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Cover Expenses"), "            ", /* @__PURE__ */ React.createElement("span", { className: "val" + (c.coverCost > COVER_LIMIT ? " pc-fld-stat-warn" : "") }, "\u20B1 ", peso(c.coverCost))), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-stat" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Remaining"), "                 ", /* @__PURE__ */ React.createElement("span", { className: "val " + (c.remaining >= 0 ? "pc-fld-stat-accent" : "pc-fld-stat-warn") }, "\u20B1 ", peso(c.remaining)))), openCards[c.id] && !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-health" }, /* @__PURE__ */ React.createElement("span", { className: "pc-fld-health-badge " + c.h.cls }, c.h.label), /* @__PURE__ */ React.createElement("span", { className: "pc-fld-card-pct" }, c.spentPct.toFixed(1), "%")), openCards[c.id] && !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-progress" }, /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-progress-fill", style: { width: c.spentPct + "%", background: c.h.barClr } })), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-meta" }, c.periodCount, " billing period", c.periodCount !== 1 ? "s" : ""), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-cta" }, "Open Project ", /* @__PURE__ */ React.createElement("span", { style: { marginLeft: 6 } }, "\u2192"))), /* @__PURE__ */ React.createElement("div", { className: "pc-fld-card-actions" }, /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "AI budget summary", onClick: (e) => {
    e.stopPropagation();
    window.aiSummarizeFolder && window.aiSummarizeFolder({ name: c.name, location: c.location, revenue: c.revenue, allocated: c.allocated, labor: c.labor, material: c.material, coverCost: c.coverCost, remaining: c.remaining, spentPct: c.spentPct, periodCount: c.periodCount, statusLabel: c.h.label });
  } }, Ico.sparkles), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "Edit folder", onClick: (e) => openEdit(c.id, e) }, Ico.pencil), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon pc-row-icon-danger", title: "Delete folder", onClick: (e) => openDelete(c.id, e) }, Ico.trash))))));
}
function PageHead({ project, projects, onSelectProject, period, onPeriod, onBackToGrid }) {
  const [open, setOpen] = React.useState(false);
  const [pOpen, setPOpen] = React.useState(false);
  const PERIODS = ["This Month", "Last 30 days", "Quarter to Date", "Year to Date", "All Time"];
  return /* @__PURE__ */ React.createElement("header", { className: "pc-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-head-text" }, /* @__PURE__ */ React.createElement("div", { className: "pc-head-eyebrow" }, onBackToGrid && /* @__PURE__ */ React.createElement("button", { className: "pc-head-back", onClick: onBackToGrid, title: "Go back to All Folders" }, "\u2190 All Folders"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: onBackToGrid ? 10 : 0 } }, "Project Control")), /* @__PURE__ */ React.createElement("h1", { className: "pc-head-title" }, project.name), /* @__PURE__ */ React.createElement("div", { className: "pc-head-sub" }, /* @__PURE__ */ React.createElement("span", { className: "pc-code" }, project.code), project.location && /* @__PURE__ */ React.createElement("span", null, project.location))), /* @__PURE__ */ React.createElement("div", { className: "pc-head-controls" }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement("button", { className: "pc-pill", onClick: () => setOpen((o) => !o) }, Ico.bldg, /* @__PURE__ */ React.createElement("span", { className: "pc-pill-lbl" }, "Project"), /* @__PURE__ */ React.createElement("span", { className: "pc-pill-val" }, project.name), Ico.chevron), open && /* @__PURE__ */ React.createElement("div", { className: "dropdown", style: dropdownStyle }, projects.map((p) => /* @__PURE__ */ React.createElement(
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
function KPIStrip({ project }) {
  const [amountsHidden, setAmountsHidden] = React.useState(true);
  const spent = project.labor + project.material;
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
function FlowCards({ project, onOpen, periodCount }) {
  const [laborOpen, setLaborOpen] = React.useState(false);
  const [materialOpen, setMaterialOpen] = React.useState(false);
  const [overheadOpen, setOverheadOpen] = React.useState(false);
  const [periodsOpen, setPeriodsOpen] = React.useState(false);
  const lb = project.laborBreakdown;
  const dc = project.docCounts;
  const matCount = project.materialCount || 0;
  const docsAttached = dc.po + dc.dr + dc.si + dc.pay;
  const docsExpected = matCount * 4;
  return /* @__PURE__ */ React.createElement("div", { className: "pc-flow-cards" }, /* @__PURE__ */ React.createElement("button", { className: "pc-flow-card" + (laborOpen ? "" : " pc-flow-card--collapsed") + (_staff() && laborOpen ? " staff-flow-empty" : ""), onClick: () => onOpen("labor") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon" }, Ico.users), "Labor Cost", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Total wages and payroll paid to all workers on site. Includes direct labor, indirect labor, and liability costs.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Transaction History \u2192"), _staff() ? null : /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": laborOpen ? "Collapse labor breakdown" : "Expand labor breakdown", onClick: (e) => { e.stopPropagation(); setLaborOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: laborOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), _staff() ? null : (laborOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ _staff() ? null : React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "\u20B1"), peso(lb.total)), _staff() ? null : /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "By Tag"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot" }), "Direct"), "    ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(lb.direct))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot b" }), "Indirect"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(lb.indirect))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot c" }), "Liability"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(lb.liability)))))),/* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Labor Total \xB7 Actual"), /* @__PURE__ */ React.createElement("span", { className: _staff() ? "val val-split" : "val" }, _staff() ? /* @__PURE__ */ React.createElement(React.Fragment, null, (project.revenue > 0 ? (project.labor / project.revenue * 100).toFixed(1) + "%" : "—"), project.revenue > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pc-labor-formula", style: { marginLeft: 8 } }, "(Labor Total ÷ Contract Amount) × 100") : null) : /* @__PURE__ */ React.createElement(React.Fragment, null, React.createElement("div", { className: "pc-labor-row" }, React.createElement("span", { className: "pc-labor-currency" }, "₱"), React.createElement("span", { className: "pc-labor-amount" }, peso(lb.total)), project.revenue > 0 ? React.createElement("span", { className: "pc-labor-pct" }, (lb.total / project.revenue * 100).toFixed(1) + "%") : null, project.revenue > 0 ? React.createElement("span", { className: "pc-labor-formula" }, "(Labor Total ÷ Contract Amount) × 100") : null)))))  , /* @__PURE__ */ React.createElement("button", { className: "pc-flow-card" + (materialOpen ? "" : " pc-flow-card--collapsed") + (_staff() && materialOpen ? " staff-flow-empty" : ""), onClick: () => onOpen("material") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-amber" }, Ico.package), "Material Cost", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Total cost of all materials purchased for the project. Each transaction has supporting documents like PO, delivery receipt, invoice, and payment slip.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Transaction History \u2192"), _staff() ? null : /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": materialOpen ? "Collapse material breakdown" : "Expand material breakdown", onClick: (e) => { e.stopPropagation(); setMaterialOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: materialOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), _staff() ? null : (materialOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ _staff() ? null : React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "\u20B1"), peso(project.material)), _staff() ? null : /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "Per-Transaction Files"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Transactions"), "          ", /* @__PURE__ */ React.createElement("span", { className: "val" }, matCount)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Files Attached"), "        ", /* @__PURE__ */ React.createElement("span", { className: "val" }, docsAttached, " / ", docsExpected || 0)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item", style: { fontSize: 11.5, color: "var(--text-light)" } }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "PO \xB7 Delivery \xB7 Invoice \xB7 Payment"))))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Material Total \xB7 Actual"), /* @__PURE__ */ React.createElement("span", { className: _staff() ? "val val-split" : "val" }, _staff() ? /* @__PURE__ */ React.createElement(React.Fragment, null, (project.revenue > 0 ? (project.material / project.revenue * 100).toFixed(1) + "%" : "—"), project.revenue > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pc-labor-formula", style: { marginLeft: 8 } }, "(Material Total ÷ Contract Amount) × 100") : null) : /* @__PURE__ */ React.createElement("div", { className: "pc-labor-row" }, React.createElement("span", { className: "pc-labor-currency" }, "₱"), React.createElement("span", { className: "pc-labor-amount" }, peso(project.material)), project.revenue > 0 ? React.createElement("span", { className: "pc-labor-pct" }, (project.material / project.revenue * 100).toFixed(1) + "%") : null, project.revenue > 0 ? React.createElement("span", { className: "pc-labor-formula" }, "(Material Total ÷ Contract Amount) × 100") : null)))), /* @__PURE__ */ React.createElement("button", { className: "pc-flow-card" + (overheadOpen ? "" : " pc-flow-card--collapsed") + (_staff() && overheadOpen ? " staff-flow-empty" : ""), onClick: () => onOpen("overhead") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-purple" }, Ico.briefcase), "Overhead Cost", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Indirect / overhead labor — supervision, management, and other costs not tied to a single direct task.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Transaction History →"), _staff() ? null : /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": overheadOpen ? "Collapse overhead breakdown" : "Expand overhead breakdown", onClick: (e) => { e.stopPropagation(); setOverheadOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: overheadOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), _staff() ? null : (overheadOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }, "₱"), peso(project.overhead || 0)), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "Operating Costs"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot b" }), "Total Overhead"), /* @__PURE__ */ React.createElement("span", { className: "val" }, "₱ ", peso(project.overhead || 0))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item", style: { fontSize: 11.5, color: "var(--text-light)" } }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Utilities · Rent · Supplies · Other"))))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Overhead Total \xB7 Actual"), /* @__PURE__ */ React.createElement("span", { className: _staff() ? "val val-split" : "val" }, _staff() ? /* @__PURE__ */ React.createElement(React.Fragment, null, (project.revenue > 0 ? ((project.overhead || 0) / project.revenue * 100).toFixed(1) + "%" : "—"), project.revenue > 0 ? /* @__PURE__ */ React.createElement("span", { className: "pc-labor-formula", style: { marginLeft: 8 } }, "(Overhead Total ÷ Contract Amount) × 100") : null) : /* @__PURE__ */ React.createElement("div", { className: "pc-labor-row" }, React.createElement("span", { className: "pc-labor-currency" }, "₱"), React.createElement("span", { className: "pc-labor-amount" }, peso(project.overhead || 0)), project.revenue > 0 ? React.createElement("span", { className: "pc-labor-pct" }, ((project.overhead || 0) / project.revenue * 100).toFixed(1) + "%") : null, project.revenue > 0 ? React.createElement("span", { className: "pc-labor-formula" }, "(Overhead Total ÷ Contract Amount) × 100") : null)))), /* @__PURE__ */ React.createElement("button", { className: "pc-flow-card" + (periodsOpen ? "" : " pc-flow-card--collapsed") + (_staff() && periodsOpen ? " staff-flow-empty" : ""), onClick: () => onOpen("periods") }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-head" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title" }, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-card-title-icon pc-icon-blue" }, Ico.calendar), "Billing Periods", /* @__PURE__ */ React.createElement("span", { className: "pc-help-tip", "data-tip": "Billing periods are monthly cycles where project funds are allocated. Each period tracks how much was spent on labor and materials versus what was budgeted.", onClick: (e) => e.stopPropagation() }, "?")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-link" }, "Manage Periods \u2192"), _staff() ? null : /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": periodsOpen ? "Collapse period breakdown" : "Expand period breakdown", onClick: (e) => { e.stopPropagation(); setPeriodsOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", marginLeft: 8, color: "var(--brand-green)", transition: "transform .15s ease", transform: periodsOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" })))), _staff() ? null : (periodsOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "pc-flow-amount" }, /* @__PURE__ */ React.createElement("span", { className: "pc-flow-currency" }), periodCount), _staff() ? null : /* @__PURE__ */ React.createElement("div", { className: "pc-flow-sub-label" }, "Allocation by Period"), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-list" }, !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot" }), "Total Allocated"), "  ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(project.allocated))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot b" }), "Total Spent"), "    ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(project.labor + project.material))), !_staff() && /* @__PURE__ */ React.createElement("div", { className: "pc-flow-item" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, /* @__PURE__ */ React.createElement("span", { className: "dot c" }), "Remaining"), "      ", /* @__PURE__ */ React.createElement("span", { className: "val" }, "\u20B1 ", peso(project.allocated - (project.labor + project.material))))))), /* @__PURE__ */ React.createElement("div", { className: "pc-flow-total" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "Periods \xB7 Count"), /* @__PURE__ */ React.createElement("span", { className: "val" }, periodCount))));
}
function Summarize({ project }) {
  const [eqOpen, setEqOpen] = React.useState(false);
  const actualCost = project.labor + project.material;
  const grossProfit = project.revenue - actualCost;
  if (_staff()) {
    return null;
  }
  const margin = safePct(grossProfit, project.revenue);
  const isLoss = grossProfit < 0;
  return /* @__PURE__ */ React.createElement("section", { className: "pc-summarize pc-summarize-stacked" }, /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "pc-sm-contract",
      style: isLoss ? { background: "linear-gradient(135deg, #b00020 0%, #d64545 100%)" } : void 0
    },
    /* @__PURE__ */ React.createElement("div", { className: "pc-sm-contract-text" }, /* @__PURE__ */ React.createElement("div", { className: "pc-sm-contract-lbl" }, isLoss ? "Gross Loss" : "Gross Profit"), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-contract-sub" }, "Revenue \u2212 Actual cost")),
    /* @__PURE__ */ React.createElement("div", { className: "pc-sm-hero-figures" }, /* @__PURE__ */ React.createElement("div", { className: "pc-sm-contract-val" }, "\u20B1 ", peso(grossProfit)), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-hero-margin" }, /* @__PURE__ */ React.createElement("div", { className: "pc-sm-hero-margin-val" }, margin.toFixed(1), "%"), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-hero-margin-lbl" }, "Margin")), /* @__PURE__ */ React.createElement("span", { className: "pc-flow-expand", role: "button", "aria-label": eqOpen ? "Collapse breakdown" : "Expand breakdown", onClick: (e) => { e.stopPropagation(); setEqOpen((o) => !o); }, style: { cursor: "pointer", display: "inline-flex", alignItems: "center", color: "#fff", opacity: 0.9, transition: "transform .15s ease", transform: eqOpen ? "rotate(180deg)" : "rotate(0deg)" } }, /* @__PURE__ */ React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" }))))
  ), eqOpen && /* @__PURE__ */ React.createElement("div", { className: "pc-sm-equation" }, /* @__PURE__ */ React.createElement("div", { className: "pc-sm-label" }, "Contract Revenue", /* @__PURE__ */ React.createElement("div", { className: "sub" }, "Total billed to client")), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-val" }, "\u20B1 ", peso(project.revenue)), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-op" }, "\u2212"), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-label" }, "Actual Cost", /* @__PURE__ */ React.createElement("div", { className: "sub" }, "Labor + Material")), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-val" }, "\u20B1 ", peso(actualCost)), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-op" }, "="), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-label" }, "Gross Profit", /* @__PURE__ */ React.createElement("div", { className: "sub" }, margin.toFixed(1), "% margin")), /* @__PURE__ */ React.createElement("div", { className: "pc-sm-val " + (isLoss ? "warn" : "accent") }, "\u20B1 ", peso(grossProfit))));
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
function openAddEntry(kind, childMonths) {
  const latest = pickLatestMonth(childMonths);
  if (!latest) {
    alert("Add a billing period to this folder first via Budget Overview, then return to record entries.");
    return;
  }
  if (typeof window.expCurrentProject !== "undefined" || true) {
    window.expCurrentProject = { id: latest.id, folderId: latest.folderId, month: latest.month, year: latest.year, monthlyBudget: latest.monthlyBudget };
  }
  const modalId = kind === "labor" ? "addPayrollModal" : "addExpenseModal";
  if (typeof window.openExpModal === "function") window.openExpModal(modalId);
}
function OverheadDrill({ project, onBack, overheadTx, folderId }) {
  const h = React.createElement;
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ category: "", amount: "", date: new Date().toISOString().slice(0, 10), description: "" });
  const [saving, setSaving] = React.useState(false);
  const OVHD_PALETTE = ["#157a52", "#c8a45a", "#7f9cb0", "#9fb98a", "#b0907f", "#8a7fb0", "#5e9d80", "#c0564a"];
  const catColor = (name) => { let n = 0; const x = String(name || ""); for (let i = 0; i < x.length; i++) n = (n * 31 + x.charCodeAt(i)) >>> 0; return OVHD_PALETTE[n % OVHD_PALETTE.length]; };
  const total = overheadTx.reduce((s2, x) => s2 + (Number(x.amount) || 0), 0);
  const count = overheadTx.length;
  const avg = count ? total / count : 0;
  const byCat = (() => { const m = {}; overheadTx.forEach((x) => { const c = x.category || "Uncategorized"; m[c] = (m[c] || 0) + (Number(x.amount) || 0); }); return Object.keys(m).map((c) => ({ cat: c, amt: m[c] })).sort((p, q) => q.amt - p.amt); })();
  const esc = (v) => String(v == null ? "" : v);
  const saveEntry = async () => {
    const amt = parseFloat(String(form.amount).replace(/,/g, ""));
    if (!form.category) { alert("Please select a category."); return; }
    if (isNaN(amt) || amt <= 0) { alert("Please enter a valid amount."); return; }
    if (!form.date) { alert("Please select a date."); return; }
    if (!folderId) { alert("Open a project first."); return; }
    setSaving(true);
    try {
      await db.collection("overheadExpenses").add({
        userId: window.currentDataUserId || (firebase.auth().currentUser && firebase.auth().currentUser.uid) || null,
        folderId, category: form.category, amount: amt, date: form.date, description: form.description || "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      setAdding(false);
      setForm({ category: "", amount: "", date: new Date().toISOString().slice(0, 10), description: "" });
    } catch (err) { alert("Save failed: " + (err.message || err)); }
    setSaving(false);
  };
  const delEntry = async (id) => {
    if (!confirm("Delete this overhead expense?")) return;
    try { await db.collection("overheadExpenses").doc(id).delete(); } catch (err) { alert("Delete failed: " + (err.message || err)); }
  };

  const card = (label, value, accent) => h("div", { className: "drill-stat" },
    h("div", { className: "lbl" }, label),
    h("div", { className: "val" + (accent ? " total" : "") }, value));

  const kpis = h("div", { className: "drill-stats" },
    card("Total Overhead", "\u20B1 " + peso(total), true),
    card("Total Entries", count),
    card("Average Per Entry", "\u20B1 " + peso(avg)));

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

  const bodyRows = overheadTx.length
    ? overheadTx.map((x) => h("tr", { key: x.id, style: { borderTop: "1px solid #f0efec" } },
        h("td", { style: { padding: "12px 16px", color: "#6b7280" } }, x.date || "\u2014"),
        h("td", { style: { padding: "12px 16px" } }, h("span", { style: { display: "inline-flex", alignItems: "center", gap: 7 } },
          h("span", { style: { width: 9, height: 9, borderRadius: 3, background: catColor(x.category) } }), esc(x.category))),
        h("td", { style: { padding: "12px 16px", color: "#6b7280" } }, x.description ? esc(x.description) : "\u2014"),
        h("td", { style: { padding: "12px 16px", fontWeight: 600 } }, "\u20B1 " + peso(x.amount)),
        h("td", { style: { padding: "12px 16px", textAlign: "right" } }, _staff() ? null : h("button", { onClick: () => delEntry(x.id), title: "Delete", style: { border: 0, background: "#fdecea", color: "#c0564a", borderRadius: 8, padding: "6px 9px", cursor: "pointer" } }, Ico.trash))))
    : [h("tr", { key: "empty" }, h("td", { colSpan: 5, style: { padding: "28px 16px", textAlign: "center", color: "var(--text-light)" } }, "No overhead expenses for this project yet."))];

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
      field("Category", h("select", { value: form.category, onChange: (ev) => setForm({ ...form, category: ev.target.value }), style: inStyle },
        ["", "Electricity", "Water", "Internet", "Rent", "Transportation", "Office Supplies", "Permits & Fees", "Other"].map((c) => h("option", { key: c, value: c }, c || "Select category\u2026")))),
      field("Amount (\u20B1)", h("input", { type: "number", value: form.amount, onChange: (ev) => setForm({ ...form, amount: ev.target.value }), placeholder: "0.00", style: inStyle })),
      field("Date", h("input", { type: "date", value: form.date, onChange: (ev) => setForm({ ...form, date: ev.target.value }), style: inStyle })),
      field("Description (optional)", h("input", { type: "text", value: form.description, onChange: (ev) => setForm({ ...form, description: ev.target.value }), placeholder: "e.g. June electricity bill", style: inStyle })),
      h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 } },
        h("button", { onClick: () => setAdding(false), style: { padding: "9px 16px", borderRadius: 9, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", font: "600 13px 'IBM Plex Sans'" } }, "Cancel"),
        h("button", { onClick: saveEntry, disabled: saving, style: { padding: "9px 18px", borderRadius: 9, border: 0, background: "var(--brand-green)", color: "#fff", cursor: "pointer", font: "700 13px 'IBM Plex Sans'" } }, saving ? "Saving\u2026" : "Save Expense")))) : null;

  const head = h("div", { className: "drill-head", style: { marginTop: 14 } },
    h("div", { style: { minWidth: 0 } },
      h("div", { className: "eyebrow", style: { marginBottom: 10 } }, "Overhead Cost \xB7 Project Operating Costs"),
      h("h2", null, "Overhead Expenses"),
      h("div", { className: "sub" }, esc(project && project.name), project && project.code ? " \xB7 " + project.code : "")),
    h("button", { onClick: () => setAdding(true), style: { display: "inline-flex", alignItems: "center", gap: 8, background: "var(--brand-green)", color: "#fff", border: 0, borderRadius: 10, padding: "11px 20px", font: "700 13px 'IBM Plex Sans'", cursor: "pointer", whiteSpace: "nowrap", flex: "none" } }, "+ Add Expense"));

  return h("section", { className: "drill" },
    h("button", { className: "back-btn", onClick: onBack, title: "Go back to Project Control" }, Ico.arrowL, " Back to Project Control"),
    head, kpis, body, modal);
}
function _esc2(s) { return String(s == null ? "" : s); }
function LaborDrill({ project, onBack, laborTx, childMonths, initialTab, eyebrow, title }) {
  const [tab, setTab] = React.useState(initialTab || "all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [soaOpen, setSoaOpen] = React.useState(false);
  const soaRef = React.useRef(null);
  React.useEffect(() => {
    if (!soaOpen) return;
    const onDoc = (e) => { if (soaRef.current && !soaRef.current.contains(e.target)) setSoaOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [soaOpen]);
  const workers = React.useMemo(() => {
    const m = {};
    laborTx.forEach((t) => { const n = t.name || "—"; if (!m[n]) m[n] = { name: n, role: t.role || "", total: 0, count: 0 }; m[n].total += t.amount || 0; m[n].count++; });
    return Object.values(m).sort((a, b) => b.total - a.total);
  }, [laborTx]);
  const lb = project.laborBreakdown;
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
  const filtered = React.useMemo(() => {
    let result = tab === "all" ? laborTx : laborTx.filter((x) => x.type === tab);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (x) => (x.name || "").toLowerCase().includes(q) || (x.role || "").toLowerCase().includes(q)
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
    a.download = `labor-${project.code || "export"}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  };
  return /* @__PURE__ */ React.createElement("section", { className: "drill" }, /* @__PURE__ */ React.createElement("button", { className: "back-btn", onClick: onBack, title: "Go back to Project Control" }, Ico.arrowL, " Back to Project Control"), /* @__PURE__ */ React.createElement("div", { className: "drill-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, eyebrow || "Labor Cost \xB7 Transaction History"), /* @__PURE__ */ React.createElement("h2", null, title || "Labor", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--sans)", color: "var(--brand-green)", fontWeight: 700, fontSize: "22px", letterSpacing: "0.02em", marginLeft: 18, background: "rgba(26,90,58,0.12)", padding: "8px 20px", borderRadius: "999px", whiteSpace: "nowrap", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" } }, project.revenue > 0 ? (project.labor / project.revenue * 100).toFixed(1) + "%" : "—")), /* @__PURE__ */ React.createElement("div", { className: "sub" }, project.name, " \xB7 ", project.code)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { className: "panel-tabs" }, [["all", "All"], ["direct", "Direct"], ["indirect", "Indirect"], ["liability", "Liability"]].map(
    ([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, className: tab === k ? "active" : "", onClick: () => setTab(k) }, l)
  )), /* @__PURE__ */ React.createElement("div", { ref: soaRef, style: { position: "relative" } }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "pcf-soa-trigger" + (soaOpen ? " open" : ""), onClick: () => setSoaOpen((o) => !o), title: "Generate a worker's Statement of Account (all entries in this project)" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" }), /* @__PURE__ */ React.createElement("polyline", { points: "14 2 14 8 20 8" }), /* @__PURE__ */ React.createElement("line", { x1: 16, y1: 13, x2: 8, y2: 13 }), /* @__PURE__ */ React.createElement("line", { x1: 16, y1: 17, x2: 8, y2: 17 })), " Worker Statement"), soaOpen && /* @__PURE__ */ React.createElement("div", { className: "pcf-soa-pop" }, /* @__PURE__ */ React.createElement("div", { className: "pcf-soa-head" }, /* @__PURE__ */ React.createElement("div", { className: "t" }, "Worker Statement"), /* @__PURE__ */ React.createElement("div", { className: "s" }, "Select a worker to generate their SOA")), /* @__PURE__ */ React.createElement("div", { className: "pcf-soa-list" }, workers.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "pcf-soa-empty" }, "No workers yet.") : workers.map((wk) => /* @__PURE__ */ React.createElement("button", { key: wk.name, type: "button", className: "pcf-soa-item", onClick: () => { setSoaOpen(false); window.printWorkerLaborSOA && window.printWorkerLaborSOA(wk.name, project.id); } }, /* @__PURE__ */ React.createElement("span", { className: "pcf-soa-av" }, (wk.name || "?").trim().charAt(0).toUpperCase() || "?"), /* @__PURE__ */ React.createElement("span", { className: "pcf-soa-info" }, /* @__PURE__ */ React.createElement("span", { className: "pcf-soa-name" }, wk.name), /* @__PURE__ */ React.createElement("span", { className: "pcf-soa-sub" }, (wk.role || "—") + " \xB7 " + wk.count + " " + (wk.count === 1 ? "entry" : "entries"))), /* @__PURE__ */ React.createElement("span", { className: "pcf-soa-amt" }, "₱ ", peso(wk.total))))))), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: () => openAddEntry("labor", childMonths) }, Ico.plus, " Add Payroll"))), /* @__PURE__ */ _staff() ? null : React.createElement("div", { className: "drill-stats" }, /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Direct Labor"), /* @__PURE__ */ React.createElement("div", { className: "val" }, "\u20B1 ", peso(lb.direct))), /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Indirect Labor"), /* @__PURE__ */ React.createElement("div", { className: "val" }, "\u20B1 ", peso(lb.indirect))), /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Liability"), /* @__PURE__ */ React.createElement("div", { className: "val" }, "\u20B1 ", peso(lb.liability))), /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Labor Total \xB7 Actual"), /* @__PURE__ */ React.createElement("div", { className: "val total" }, "\u20B1 ", peso(lb.total)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "14px 4px 10px" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flex: "1 1 220px", minWidth: 200, maxWidth: 380 } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "Search by worker or role\u2026",
      value: searchQuery,
      onChange: (e) => setSearchQuery(e.target.value),
      "aria-label": "Search labor entries",
      style: { width: "100%", padding: "8px 12px 8px 32px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" }
    }
  ), /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "#9ca3af", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", style: { position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" } }, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "8" }), /* @__PURE__ */ React.createElement("path", { d: "m21 21-4.3-4.3" }))), /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11.5, color: "var(--ink-3)" } }, filtered.length, " of ", laborTx.length), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      onClick: exportCsv,
      title: "Export the currently visible rows as CSV",
      style: { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1.5px solid #d1fae5", background: "#f0fdf4", color: "#059669", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }
    },
    /* @__PURE__ */ React.createElement("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), /* @__PURE__ */ React.createElement("polyline", { points: "7 10 12 15 17 10" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "15", x2: "12", y2: "3" })),
    "Export CSV"
  ))), /* @__PURE__ */ React.createElement("table", { className: "tx-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { width: 170 } }, "Date"), /* @__PURE__ */ React.createElement("th", null, "Worker"), /* @__PURE__ */ React.createElement("th", { style: { width: 140 } }, "Category"), /* @__PURE__ */ React.createElement("th", { className: "right", style: { width: 80 } }, "Hours"), /* @__PURE__ */ React.createElement("th", { className: "right", style: { width: 140 } }, "Amount"), /* @__PURE__ */ React.createElement("th", { style: { width: 100 } }, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, filtered.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { padding: "24px 12px", textAlign: "center", color: "var(--ink-3)" } }, "No payroll entries in this category.")), filtered.map((row, i) => {
    const billingNum = billingByProjectId.get(row.projectId);
    return /* @__PURE__ */ React.createElement("tr", { key: row.id || i, className: "row" }, /* @__PURE__ */ React.createElement("td", { style: { fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "nowrap" } }, fmtDateTime(row.dateTime || row.date)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { className: "name" }, row.name), /* @__PURE__ */ React.createElement(PaymentTag, { method: row.paymentMethod })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--ink-3)", marginTop: 2 } }, row.role), billingNum && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5 } }, /* @__PURE__ */ React.createElement("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })), "Charged to \xB7 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)", fontWeight: 600 } }, "Billing #", billingNum))), /* @__PURE__ */ React.createElement("td", null, row.type === "direct" && /* @__PURE__ */ React.createElement("span", { className: "tag green" }, "Direct"), row.type === "indirect" && /* @__PURE__ */ React.createElement("span", { className: "tag" }, "Indirect"), row.type === "liability" && /* @__PURE__ */ React.createElement("span", { className: "tag warn" }, "Liability")), /* @__PURE__ */ React.createElement("td", { className: "right tabular" }, row.hours || "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "right" }, /* @__PURE__ */ React.createElement("span", { className: "amt" }, "\u20B1 ", peso(row.amount))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon pc-row-icon-invoice", title: "Invoice", onClick: () => window.printSinglePayrollInvoice && window.printSinglePayrollInvoice(row.id) }, Ico.receipt || "\u{1F9FE}"), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon", title: "Edit", onClick: () => window.openEditPayrollModal && window.openEditPayrollModal(row.id) }, Ico.pencil || "\u270E"), /* @__PURE__ */ React.createElement("button", { className: "pc-row-icon pc-row-icon-danger", title: "Delete", onClick: () => window.deletePayroll && window.deletePayroll(row.id) }, Ico.trash || "\u{1F5D1}")));
  }))));
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
function MaterialDrill({ project, onBack, materialTx, childMonths, activeFolder }) {
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
    a.download = `materials-${project.code || "export"}-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  };
  const pillBase = { padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", whiteSpace: "nowrap" };
  const pillActive = { ...pillBase, background: "#1A5C3A", color: "#fff", borderColor: "#1A5C3A" };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("section", { className: "drill" }, /* @__PURE__ */ React.createElement("button", { className: "back-btn", onClick: onBack, title: "Go back to Project Control" }, Ico.arrowL, " Back to Project Control"), /* @__PURE__ */ React.createElement("div", { className: "drill-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Material Cost \xB7 Transaction History"), /* @__PURE__ */ React.createElement("h2", null, "Materials", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--sans)", color: "var(--brand-green)", fontWeight: 700, fontSize: "22px", letterSpacing: "0.02em", marginLeft: 18, background: "rgba(26,90,58,0.12)", padding: "8px 20px", borderRadius: "999px", whiteSpace: "nowrap", verticalAlign: "middle", fontVariantNumeric: "tabular-nums" } }, project.revenue > 0 ? (project.material / project.revenue * 100).toFixed(1) + "%" : "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "sub" }, project.name, " \xB7 ", project.code)), /* @__PURE__ */ React.createElement("button", { className: "btn-primary", onClick: () => openAddEntry("material", childMonths) }, Ico.plus, " Add Expense")), /* @__PURE__ */ React.createElement("div", { className: "drill-stats" }, /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Purchase Order"), /* @__PURE__ */ React.createElement("div", { className: "val" }, dc.po, " / ", count)), /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Delivery Receipt"), /* @__PURE__ */ React.createElement("div", { className: "val" }, dc.dr, " / ", count)), /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Supplier Invoice"), /* @__PURE__ */ React.createElement("div", { className: "val" }, dc.si, " / ", count)), _staff() ? null : /* @__PURE__ */ React.createElement("div", { className: "drill-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Material Total \xB7 Actual"), /* @__PURE__ */ React.createElement("div", { className: "val total" }, "\u20B1 ", peso(project.material)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "14px 4px 4px" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flex: "1 1 220px", minWidth: 200, maxWidth: 380 } }, /* @__PURE__ */ React.createElement(
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
  ))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: "4px 16px", fontSize: 11.5, color: "var(--ink-3)", margin: "10px 4px 6px" } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)" } }, "PO"), " Purchase Order"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)" } }, "DR"), " Delivery Receipt"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)" } }, "SI"), " Supplier Invoice"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)" } }, "PR"), " Payment Receipt")), /* @__PURE__ */ React.createElement("table", { className: "tx-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { width: 170 } }, "Date"), /* @__PURE__ */ React.createElement("th", null, "Description"), /* @__PURE__ */ React.createElement("th", null, "Category"), /* @__PURE__ */ React.createElement("th", { style: { width: 160 } }, "Documents"), /* @__PURE__ */ React.createElement("th", { className: "right", style: { width: 140 } }, "Amount"), /* @__PURE__ */ React.createElement("th", { style: { width: 70 } }, "Receipt"), /* @__PURE__ */ React.createElement("th", { style: { width: 140 } }, "Actions"))), /* @__PURE__ */ React.createElement("tbody", null, filteredTx.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 7, style: { padding: "24px 12px", textAlign: "center", color: "var(--ink-3)" } }, count === 0 ? "No expense entries in this period." : "No transactions match the current search/filter.")), filteredTx.map((m, i) => {
    const billingNum = billingByProjectId.get(m.projectId);
    return /* @__PURE__ */ React.createElement("tr", { key: m.id || i, className: "row", onClick: () => setDetailsItem(m), title: "Click to view item details" }, /* @__PURE__ */ React.createElement("td", { style: { fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "nowrap" } }, fmtDateTime(m.dateTime || m.date)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { className: "name" }, m.name), /* @__PURE__ */ React.createElement(PaymentTag, { method: m.paymentMethod })), billingNum && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, color: "var(--ink-3)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5 } }, /* @__PURE__ */ React.createElement("svg", { width: "11", height: "11", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })), "Charged to \xB7 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--ink-2)", fontWeight: 600 } }, "Billing #", billingNum))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--ink-2)" } }, m.category || "\u2014")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "pc-docs-row", title: "Purchase Order \xB7 Delivery Receipt \xB7 Supplier Invoice \xB7 Payment Receipt" }, /* @__PURE__ */ React.createElement(DocPill, { m, k: "po", label: "PO", title: "Purchase Order" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "dr", label: "DR", title: "Delivery Receipt" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "si", label: "SI", title: "Supplier Invoice" }), /* @__PURE__ */ React.createElement(DocPill, { m, k: "pay", label: "PR", title: "Payment Receipt" }))), /* @__PURE__ */ React.createElement("td", { className: "right" }, /* @__PURE__ */ React.createElement("span", { className: "amt" }, "\u20B1 ", peso(m.amount))), /* @__PURE__ */ React.createElement("td", { onClick: (e) => e.stopPropagation() }, m.firstReceipt ? /* @__PURE__ */ React.createElement(
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
  const folderBudgetRef = React.useRef({});
  const projectBudgetRef = React.useRef({});
  const [isStaff, setIsStaff] = React.useState(false);
  const [boqRaw, setBoqRaw] = React.useState([]);
  const [payReqRaw, setPayReqRaw] = React.useState([]);
  const [invoicesRaw, setInvoicesRaw] = React.useState([]);
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
  const overheadTx = React.useMemo(
    () => (overheadRaw || []).filter((e) => e.folderId === projectId).map((e) => ({ id: e.id, category: e.category || "Uncategorized", amount: Number(e.amount) || 0, date: (e.date || "").toString().slice(0, 10), description: e.description || "" })).sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [overheadRaw, projectId]
  );
  const laborTx = React.useMemo(() => filterByPeriod(allLaborTx, period), [allLaborTx, period]);
  const materialTx = React.useMemo(() => filterByPeriod(allMaterialTx, period), [allMaterialTx, period]);
  const projects = React.useMemo(
    () => foldersRaw.map((f) => buildProject(f, [], [], [])),
    [foldersRaw]
  );
  const overheadTotal = overheadTx.reduce((s2, e) => s2 + (Number(e.amount) || 0), 0);
  const project = activeFolder ? { ...buildProject(activeFolder, childMonths, laborTx, materialTx), overhead: overheadTotal } : null;
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
      onBackToGrid: () => setProjectId(null)
    }
  ), view === "dashboard" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Summarize, { project }), /* @__PURE__ */ React.createElement(KPIStrip, { project }), /* @__PURE__ */ React.createElement(FlowCards, { project, onOpen: setView, periodCount: childMonths.length }), /* @__PURE__ */ React.createElement(BillingSummary, { billing }), /* @__PURE__ */ React.createElement(RecentEntries, { onOpen: setView, laborTx, materialTx })), view === "labor" && /* @__PURE__ */ React.createElement(LaborDrill, { project, childMonths, onBack: () => setView("dashboard"), laborTx }), view === "overhead" && /* @__PURE__ */ React.createElement(OverheadDrill, { project, onBack: () => setView("dashboard"), overheadTx, folderId: projectId }), view === "material" && /* @__PURE__ */ React.createElement(MaterialDrill, { project, childMonths, onBack: () => setView("dashboard"), materialTx, activeFolder }), view === "periods" && /* @__PURE__ */ React.createElement(BillingPeriodsDrill, { project, childMonths, payrollRaw, expensesRaw, onBack: () => setView("dashboard") })));
}
(function() {
  const mount = document.getElementById("dacsPortalRoot");
  if (mount && !mount.__dacsMounted) {
    mount.__dacsMounted = true;
    ReactDOM.createRoot(mount).render(/* @__PURE__ */ React.createElement(PortalApp, null));
  }
})();
//# sourceMappingURL=portal-app.compiled.js.map
