/* ============================================================
   AI HEALTH ASSISTANT — DAC's Building Design Services
   Scans ALL projects' live numbers and gives the owner a daily
   company-health briefing: overall verdict + flagged projects
   (over budget / cover expenses over limit).
   Rule-based facts are computed here (always accurate); the AI
   only phrases the briefing. Runs through the Cloudflare Worker.
   ============================================================ */
(function () {
  const AI_WORKER_URL = 'https://dacs-ai.dacsbuilding.workers.dev';

  const ICON_SPARK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  const ICON_OK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  const ICON_WARN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  const ICON_RISK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  const VERDICT_ICON = { ok: ICON_OK, warn: ICON_WARN, risk: ICON_RISK };

  function peso(n) {
    n = parseFloat(n) || 0;
    return '₱' + n.toLocaleString('en-PH', { maximumFractionDigits: 0 });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function ensureStyles() {
    if (document.getElementById('aiHcStyles')) return;
    var s = document.createElement('style');
    s.id = 'aiHcStyles';
    s.textContent = [
      '.ai-hc-overlay{position:fixed;inset:0;z-index:1200;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(17,24,39,.5);}',
      '.ai-hc-overlay.active{display:flex;animation:aiHcFade .15s ease;}',
      '@keyframes aiHcFade{from{opacity:0}to{opacity:1}}',
".ai-hc-box{font-family:'Barlow',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;width:100%;max-width:540px;border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.26);overflow:hidden;animation:aiHcRise .18s ease;max-height:88vh;display:flex;flex-direction:column;}",
      '@keyframes aiHcRise{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}',
      // header
      '.ai-hc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:24px 26px 18px;}',
      '.ai-hc-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1A5C3A;}',
      '.ai-hc-eyebrow svg{width:13px;height:13px;}',
      '.ai-hc-pill{display:inline-flex;align-items:center;gap:7px;margin-top:11px;padding:6px 13px 6px 11px;border-radius:999px;font-size:14px;font-weight:700;line-height:1;}',
      '.ai-hc-pill svg{width:15px;height:15px;}',
      '.ai-hc-pill-ok{background:#e7f3ec;color:#1A5C3A;}',
      '.ai-hc-pill-warn{background:#fbf3e3;color:#A86B00;}',
      '.ai-hc-pill-risk{background:#fdecea;color:#c0392b;}',
      '.ai-hc-date{margin-top:10px;font-size:12.5px;color:#6b7280;}',
      '.ai-hc-close{flex:none;width:32px;height:32px;border:none;background:#f3f4f6;border-radius:9px;color:#6b7280;font-size:19px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s;}',
      '.ai-hc-close:hover{background:#e5e7eb;color:#111827;}',
      // stat row (dividers, no boxes — minimalist)
      '.ai-hc-stats{display:flex;padding:2px 26px 18px;}',
      '.ai-hc-stat{flex:1;min-width:0;padding:0 16px;border-left:1px solid #eef0f2;}',
      '.ai-hc-stat:first-child{padding-left:0;border-left:0;}',
      '.ai-hc-stat .k{font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;font-weight:600;white-space:nowrap;}',
      '.ai-hc-stat .v{margin-top:5px;font-size:16px;font-weight:700;color:#111827;white-space:nowrap;font-variant-numeric:tabular-nums;}',
      // scroll body
      '.ai-hc-scroll{overflow:auto;padding:0 26px;border-top:1px solid #f1f3f5;}',
      '.ai-hc-body{padding:18px 0 4px;}',
      '.ai-hc-body p{margin:0 0 13px;font-size:14.5px;line-height:1.72;color:#374151;}',
      '.ai-hc-body p:last-child{margin-bottom:0;}',
      '.ai-hc-spin{display:flex;flex-direction:column;align-items:center;gap:13px;padding:30px 0;color:#6b7280;font-size:13.5px;}',
      '.ai-hc-spin .ring{width:28px;height:28px;border:3px solid #e9ebee;border-top-color:#1A5C3A;border-radius:50%;animation:aiHcSpin .8s linear infinite;}',
      '@keyframes aiHcSpin{to{transform:rotate(360deg)}}',
      // alerts (minimal rows with small dots + hairlines)
      '.ai-hc-alerts{margin:14px 0 18px;}',
      '.ai-hc-alerts-title{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin:0 0 4px;}',
      '.ai-hc-alert{display:flex;align-items:flex-start;gap:11px;font-size:13.5px;line-height:1.5;color:#374151;padding:11px 0;border-top:1px solid #f1f3f5;}',
      '.ai-hc-alert .dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;}',
      '.ai-hc-alert .dot.risk{background:#c0392b;} .ai-hc-alert .dot.warn{background:#A86B00;} .ai-hc-alert .dot.ok{background:#1A5C3A;}',
      '.ai-hc-alert strong{font-weight:700;color:#111827;}',
      '.ai-hc-alert-txt{flex:1;}',
      '.ai-hc-alert-link{cursor:pointer;margin:0 -12px;padding-left:12px;padding-right:12px;border-radius:9px;}',
      '.ai-hc-alert-link:hover{background:#f7f8f9;}',
      '.ai-hc-alert-arrow{flex:none;align-self:center;color:#9ca3af;font-weight:700;font-size:15px;}',
      '.ai-hc-alert-link:hover .ai-hc-alert-arrow{color:#374151;}',
      // footer
      '.ai-hc-foot{padding:13px 26px 18px;border-top:1px solid #f1f3f5;}',
      '.ai-hc-note{font-size:11px;color:#9ca3af;display:inline-flex;align-items:center;gap:5px;}',
      '.ai-hc-note svg{width:12px;height:12px;}'
    ].join('');
    document.head.appendChild(s);
  }

  function closeModal() {
    var o = document.getElementById('aiHcOverlay');
    if (o) o.classList.remove('active');
  }

  function ensureModal() {
    ensureStyles();
    var o = document.getElementById('aiHcOverlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'aiHcOverlay';
    o.className = 'ai-hc-overlay';
    o.innerHTML =
      '<div class="ai-hc-box" role="dialog" aria-modal="true" aria-label="Company Health Check">' +
        '<div class="ai-hc-head">' +
          '<div style="min-width:0">' +
            '<span class="ai-hc-eyebrow">' + ICON_SPARK + 'Company Health Check</span>' +
            '<div id="aiHcVerdict"></div>' +
            '<div class="ai-hc-date" id="aiHcDate"></div>' +
          '</div>' +
          '<button class="ai-hc-close" id="aiHcClose" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="ai-hc-stats" id="aiHcStats"></div>' +
        '<div class="ai-hc-scroll">' +
          '<div class="ai-hc-body" id="aiHcBody"></div>' +
          '<div class="ai-hc-alerts" id="aiHcAlerts"></div>' +
        '</div>' +
        '<div class="ai-hc-foot"><span class="ai-hc-note">' + ICON_SPARK + 'AI-generated · verify key figures</span></div>' +
      '</div>';
    document.body.appendChild(o);
    o.querySelector('#aiHcClose').addEventListener('click', closeModal);
    o.addEventListener('click', function (e) { if (e.target === o) closeModal(); });
    // Clicking an alert opens that project folder.
    o.querySelector('#aiHcAlerts').addEventListener('click', function (e) {
      var row = e.target.closest && e.target.closest('.ai-hc-alert-link');
      if (!row) return;
      var fid = row.getAttribute('data-fid');
      if (fid && typeof window.pcOpenFolder === 'function') { closeModal(); window.pcOpenFolder(fid); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && o.classList.contains('active')) closeModal();
    });
    return o;
  }

  window.aiHealthCheck = async function (projects, coverLimit) {
    coverLimit = coverLimit || 10000;
    projects = Array.isArray(projects) ? projects : [];

    // ── Compute the facts ourselves (never trust the AI with the math) ──
    var NEAR_PCT = 15;     // remaining below this % of budget = "near limit"
    var LOW_MARGIN = 10;   // gross margin below this % = "low margin"

    var totals = projects.reduce(function (a, p) {
      a.contract += Number(p.revenue) || 0;
      a.allocated += Number(p.allocated) || 0;
      a.spent += Number(p.spent) || 0;
      a.cover += Number(p.coverCost) || 0;
      return a;
    }, { contract: 0, allocated: 0, spent: 0, cover: 0 });
    totals.profit = totals.contract - totals.spent;

    var healthy = projects.filter(function (p) { return /HEALTHY/i.test(p.statusLabel || ''); });

    // Per-project checks (rule-based, always accurate). Risk alerts first, then warnings.
    var risks = [], warns = [];
    projects.forEach(function (p) {
      var name = '<strong>' + esc(p.name) + '</strong>';
      var revenue = Number(p.revenue) || 0;
      var allocated = Number(p.allocated) || 0;
      var spent = Number(p.spent) || 0;
      var remaining = (p.remaining != null) ? Number(p.remaining) : (allocated - spent);
      var cover = Number(p.coverCost) || 0;
      var margin = revenue > 0 ? (revenue - spent) / revenue * 100 : null;

      var fid = p.id;
      if (remaining < 0) {                                   // over budget
        risks.push({ kind: 'risk', id: fid, text: name + ' is over budget by ' + peso(Math.abs(remaining)) });
      } else {
        if (allocated <= 0 && spent > 0) {                   // no budget set
          warns.push({ kind: 'warn', id: fid, text: name + ' has ' + peso(spent) + ' spent but no budget set' });
        } else if (allocated > 0 && remaining < allocated * (NEAR_PCT / 100)) {  // near limit
          warns.push({ kind: 'warn', id: fid, text: name + ' is near its budget limit — only ' + peso(remaining) + ' left (' + (remaining / allocated * 100).toFixed(0) + '%)' });
        }
        if (cover > coverLimit) {                            // cover expenses over limit
          warns.push({ kind: 'warn', id: fid, text: name + ' cover expenses ' + peso(cover) + ' — over ' + peso(coverLimit) });
        }
        if (margin !== null && margin < 0) {                 // losing money
          risks.push({ kind: 'risk', id: fid, text: name + ' is losing money — margin ' + margin.toFixed(1) + '%' });
        } else if (margin !== null && margin < LOW_MARGIN) { // low margin
          warns.push({ kind: 'warn', id: fid, text: name + ' has a low margin of ' + margin.toFixed(1) + '%' });
        }
      }
    });
    var alerts = risks.concat(warns);
    var issuesPlain = alerts.map(function (a) { return a.text.replace(/<[^>]+>/g, ''); });

    var verdict, vKind;
    if (risks.length) { verdict = 'At Risk'; vKind = 'risk'; }
    else if (warns.length) { verdict = 'Needs Attention'; vKind = 'warn'; }
    else { verdict = 'Healthy'; vKind = 'ok'; }

    if (!alerts.length) alerts.push({ kind: 'ok', text: 'All projects are within budget, on margin, and within limits.' });

    var today = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    // ── Render shell ──
    var o = ensureModal();
    o.classList.add('active');
    o.querySelector('#aiHcVerdict').innerHTML =
      '<span class="ai-hc-pill ai-hc-pill-' + vKind + '">' + VERDICT_ICON[vKind] + verdict + '</span>';
    o.querySelector('#aiHcDate').textContent = today;
    o.querySelector('#aiHcStats').innerHTML =
      '<div class="ai-hc-stat"><div class="k">Projects</div><div class="v">' + projects.length + '</div></div>' +
      '<div class="ai-hc-stat"><div class="k">Total Contract</div><div class="v">' + peso(totals.contract) + '</div></div>' +
      '<div class="ai-hc-stat"><div class="k">Total Spent</div><div class="v">' + peso(totals.spent) + '</div></div>' +
      '<div class="ai-hc-stat"><div class="k">Gross Profit</div><div class="v">' + peso(totals.profit) + '</div></div>';
    o.querySelector('#aiHcAlerts').innerHTML =
      '<div class="ai-hc-alerts-title">Alerts</div>' +
      alerts.map(function (a) {
        var link = a.id ? ' ai-hc-alert-link' : '';
        var attr = a.id ? ' data-fid="' + esc(a.id) + '"' : '';
        var arrow = a.id ? '<span class="ai-hc-alert-arrow">&rarr;</span>' : '';
        return '<div class="ai-hc-alert' + link + '"' + attr + '>'
          + '<span class="dot ' + a.kind + '"></span>'
          + '<span class="ai-hc-alert-txt">' + a.text + '</span>' + arrow + '</div>';
      }).join('');

    var bodyEl = o.querySelector('#aiHcBody');
    bodyEl.innerHTML = '<div class="ai-hc-spin"><div class="ring"></div><span>Writing your briefing…</span></div>';

    // ── Ask the AI to phrase the briefing (facts only) ──
    var prompt =
      "You are a financial assistant for DAC's Building Design Services, a construction company. " +
      'Today is ' + today + '. Write a SHORT daily health briefing (3-5 sentences) for the owner in plain professional English. ' +
      'Begin with the overall verdict (' + verdict + '), then specifically mention the most important issues below by project name, ' +
      'and end with ONE practical recommendation. Use Philippine Peso (₱). Use ONLY the facts below — do not invent any. No markdown, no bullet points.\n\n' +
      'Company snapshot:\n' +
      '- Total projects: ' + projects.length + ' (' + healthy.length + ' healthy)\n' +
      '- Total Contract: ' + peso(totals.contract) + '\n' +
      '- Total Spent: ' + peso(totals.spent) + '\n' +
      '- Total Gross Profit: ' + peso(totals.profit) + '\n' +
      '- Total Cover Expenses: ' + peso(totals.cover) + '\n' +
      'Issues detected (' + issuesPlain.length + '): ' + (issuesPlain.length ? issuesPlain.join('; ') : 'none — all projects are healthy');

    try {
      var res = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 600 }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error((data && data.error && (data.error.message || data.error)) || ('Request failed (' + res.status + ')'));
      var text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content.trim() : '';
      bodyEl.innerHTML = text
        ? text.split(/\n{2,}/).map(function (para) { return '<p>' + esc(para.trim()).replace(/\n/g, ' ').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') + '</p>'; }).join('')
        : '<p style="color:#9ca3af">Briefing unavailable — see the alerts below for the key facts.</p>';
    } catch (err) {
      bodyEl.innerHTML = '<p style="color:#b91c1c">Couldn\'t generate the briefing (' + esc(err.message || err) + '). The alerts below are still accurate.</p>';
    }
  };
})();
