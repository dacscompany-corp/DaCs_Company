/* ============================================================
   AI BUDGET SUMMARY — DAC's Building Design Services
   Generates a plain-English budget summary for a project folder
   via Groq (through the Cloudflare Worker proxy) and presents it
   in a clean, professional modal.
   ============================================================ */
(function () {
  // Cloudflare Worker proxy (hides the Groq API key).
  const AI_WORKER_URL = 'https://dacs-ai.dacsbuilding.workers.dev';

  // ── small inline icons ───────────────────────────────────
  const ICON_SPARK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  const ICON_REFRESH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  const ICON_ALERT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

  // ── helpers ──────────────────────────────────────────────
  function peso(n) {
    n = parseFloat(n) || 0;
    return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function badgeStyle(label) {
    label = String(label || '').toUpperCase();
    if (label.indexOf('OVER') > -1 || label.indexOf('CRITICAL') > -1) return 'background:#fdecea;color:#c0392b;';
    if (label.indexOf('WARNING') > -1) return 'background:#fbf3e3;color:#A86B00;';
    if (label.indexOf('HEALTHY') > -1) return 'background:#e7f3ec;color:#1A5C3A;';
    return 'background:#f1f3f5;color:#6b7280;';
  }
  // Render AI prose into tidy paragraphs (+ light **bold** support).
  function renderText(text) {
    return String(text || '').split(/\n{2,}/).map(function (para) {
      var html = esc(para.trim()).replace(/\n/g, ' ');
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return html ? '<p>' + html + '</p>' : '';
    }).join('');
  }

  // ── styles (injected once) ───────────────────────────────
  function ensureStyles() {
    if (document.getElementById('aiSumStyles')) return;
    var s = document.createElement('style');
    s.id = 'aiSumStyles';
    s.textContent = [
      '.ai-sum-overlay{position:fixed;inset:0;z-index:1200;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(17,24,39,.55);}',
      '.ai-sum-overlay.active{display:flex;animation:aiSumFade .15s ease;}',
      '@keyframes aiSumFade{from{opacity:0}to{opacity:1}}',
      '.ai-sum-box{font-family:inherit;background:#fff;width:100%;max-width:520px;border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.28);overflow:hidden;animation:aiSumRise .18s ease;}',
      '@keyframes aiSumRise{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}',
      '.ai-sum-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:22px 24px 14px;}',
      '.ai-sum-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#1A5C3A;}',
      '.ai-sum-eyebrow svg{width:14px;height:14px;}',
      '.ai-sum-title{margin:8px 0 0;font-size:20px;font-weight:700;color:#111827;line-height:1.25;}',
      '.ai-sum-badge{display:inline-flex;align-items:center;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 8px;border-radius:999px;margin-left:8px;vertical-align:middle;}',
      '.ai-sum-loc{margin:3px 0 0;font-size:13px;color:#6b7280;}',
      '.ai-sum-close{flex:none;width:32px;height:32px;border:none;background:#f3f4f6;border-radius:8px;color:#6b7280;font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;}',
      '.ai-sum-close:hover{background:#e5e7eb;color:#111827;}',
      '.ai-sum-stats{display:flex;gap:10px;padding:2px 24px 16px;}',
      '.ai-sum-stat{flex:1;background:#f9fafb;border:1px solid #eef0f2;border-radius:10px;padding:10px 12px;min-width:0;}',
      '.ai-sum-stat .k{font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#9ca3af;font-weight:600;}',
      '.ai-sum-stat .v{margin-top:3px;font-size:14px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.ai-sum-stat .v.neg{color:#c0392b;}',
      '.ai-sum-body{padding:2px 24px 6px;max-height:46vh;overflow:auto;}',
      '.ai-sum-body p{margin:0 0 12px;font-size:14.5px;line-height:1.72;color:#374151;}',
      '.ai-sum-body p:last-child{margin-bottom:0;}',
      '.ai-sum-spin{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:30px 0 28px;color:#6b7280;font-size:13.5px;}',
      '.ai-sum-spin .ring{width:30px;height:30px;border:3px solid #e9ebee;border-top-color:#1A5C3A;border-radius:50%;animation:aiSumSpin .8s linear infinite;}',
      '@keyframes aiSumSpin{to{transform:rotate(360deg)}}',
      '.ai-sum-err{display:flex;gap:10px;align-items:flex-start;padding:16px 0 22px;color:#b91c1c;font-size:14px;line-height:1.55;}',
      '.ai-sum-err svg{flex:none;width:18px;height:18px;margin-top:1px;}',
      '.ai-sum-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 24px 20px;border-top:1px solid #f1f3f5;margin-top:8px;}',
      '.ai-sum-note{font-size:11px;color:#9ca3af;display:inline-flex;align-items:center;gap:5px;}',
      '.ai-sum-note svg{width:12px;height:12px;}',
      '.ai-sum-regen{border:1px solid #e5e7eb;background:#fff;color:#374151;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:8px;cursor:pointer;transition:background .15s,border-color .15s;display:inline-flex;align-items:center;gap:6px;}',
      '.ai-sum-regen svg{width:13px;height:13px;}',
      '.ai-sum-regen:hover{background:#f9fafb;border-color:#d1d5db;}',
      '.ai-sum-regen:disabled{opacity:.5;cursor:default;}'
    ].join('');
    document.head.appendChild(s);
  }

  function closeModal() {
    var o = document.getElementById('aiSumOverlay');
    if (o) o.classList.remove('active');
  }

  function ensureModal() {
    ensureStyles();
    var o = document.getElementById('aiSumOverlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'aiSumOverlay';
    o.className = 'ai-sum-overlay';
    o.innerHTML =
      '<div class="ai-sum-box" role="dialog" aria-modal="true" aria-label="AI Budget Summary">' +
        '<div class="ai-sum-head">' +
          '<div style="min-width:0">' +
            '<span class="ai-sum-eyebrow">' + ICON_SPARK + 'AI Budget Summary</span>' +
            '<h2 class="ai-sum-title" id="aiSumTitle">Project</h2>' +
            '<div class="ai-sum-loc" id="aiSumLoc" style="display:none"></div>' +
          '</div>' +
          '<button class="ai-sum-close" id="aiSumClose" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="ai-sum-stats" id="aiSumStats" style="display:none"></div>' +
        '<div class="ai-sum-body" id="aiSumBody"></div>' +
        '<div class="ai-sum-foot">' +
          '<span class="ai-sum-note">' + ICON_SPARK + 'AI-generated · verify key figures</span>' +
          '<button class="ai-sum-regen" id="aiSumRegen">' + ICON_REFRESH + 'Regenerate</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(o);

    o.querySelector('#aiSumClose').addEventListener('click', closeModal);
    o.addEventListener('click', function (e) { if (e.target === o) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && o.classList.contains('active')) closeModal();
    });
    o.querySelector('#aiSumRegen').addEventListener('click', function () {
      if (_lastFolder) window.aiSummarizeFolder(_lastFolder);
    });
    return o;
  }

  var _lastFolder = null;

  window.aiSummarizeFolder = async function (folder) {
    folder = folder || {};
    _lastFolder = folder;

    var o = ensureModal();
    o.classList.add('active');

    var spent = (parseFloat(folder.labor) || 0) + (parseFloat(folder.material) || 0);
    var remaining = parseFloat(folder.remaining);
    if (isNaN(remaining)) remaining = (parseFloat(folder.allocated) || 0) - spent;

    // Header + status badge
    o.querySelector('#aiSumTitle').innerHTML =
      esc(folder.name || 'Project') +
      (folder.statusLabel
        ? '<span class="ai-sum-badge" style="' + badgeStyle(folder.statusLabel) + '">' + esc(folder.statusLabel) + '</span>'
        : '');
    var locEl = o.querySelector('#aiSumLoc');
    if (folder.location) { locEl.textContent = folder.location; locEl.style.display = ''; }
    else { locEl.style.display = 'none'; }

    // Metric strip
    var statsEl = o.querySelector('#aiSumStats');
    statsEl.innerHTML =
      '<div class="ai-sum-stat"><div class="k">Allocated</div><div class="v">' + peso(folder.allocated) + '</div></div>' +
      '<div class="ai-sum-stat"><div class="k">Spent</div><div class="v">' + peso(spent) + '</div></div>' +
      '<div class="ai-sum-stat"><div class="k">Remaining</div><div class="v' + (remaining < 0 ? ' neg' : '') + '">' + peso(remaining) + '</div></div>';
    statsEl.style.display = '';

    var bodyEl = o.querySelector('#aiSumBody');
    var regenBtn = o.querySelector('#aiSumRegen');

    if (!AI_WORKER_URL || AI_WORKER_URL.indexOf('PASTE_YOUR_WORKER_URL') === 0) {
      bodyEl.innerHTML = '<div class="ai-sum-err">' + ICON_ALERT +
        '<span>AI is not configured yet. Set <code>AI_WORKER_URL</code> in js/ai-summary.js.</span></div>';
      return;
    }

    // Loading state
    regenBtn.disabled = true;
    bodyEl.innerHTML = '<div class="ai-sum-spin"><div class="ring"></div><span>Generating summary…</span></div>';

    var prompt =
      "You are a construction project budget analyst for DAC's Building Design Services.\n" +
      'Write a concise, professional budget summary in 3-5 sentences that a client could read. ' +
      'Cover: overall budget health, amount spent vs allocated, remaining funds, and ONE practical recommendation. ' +
      'Use Philippine Peso (₱). Do not invent numbers. Do not use markdown headings or bullet points.\n\n' +
      'Project: ' + (folder.name || 'Untitled') + (folder.location ? ' — ' + folder.location : '') + '\n' +
      'Total Contract: ' + peso(folder.revenue) + '\n' +
      'Total Fund Allocated: ' + peso(folder.allocated) + '\n' +
      'Current Fund Spent: ' + peso(spent) + '\n' +
      'Cover Expenses: ' + peso(folder.coverCost) + '\n' +
      'Remaining: ' + peso(remaining) + '\n' +
      'Status: ' + (folder.statusLabel || 'n/a') + ' (' + (Number(folder.spentPct) || 0).toFixed(1) + '% spent)\n' +
      'Number of billing periods: ' + (folder.periodCount || 0);

    try {
      var res = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      });
      var data = await res.json();
      if (!res.ok) {
        throw new Error((data && data.error && (data.error.message || data.error)) || ('Request failed (' + res.status + ')'));
      }
      var text = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content.trim() : '';
      bodyEl.innerHTML = text ? renderText(text)
        : '<div class="ai-sum-err">' + ICON_ALERT + '<span>No summary was returned. Try again.</span></div>';
    } catch (err) {
      bodyEl.innerHTML = '<div class="ai-sum-err">' + ICON_ALERT +
        '<span>' + esc(err.message || String(err)) + '</span></div>';
    } finally {
      regenBtn.disabled = false;
    }
  };
})();
