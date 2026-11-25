// ════════════════════════════════════════════════════════════════════
// WEEKLY REPORT PRINT — builds the printable employee / project report
// documents and opens them in a popup for Print / Save as PDF.
// Pure string builders plus one popup helper. Signed photo URLs arrive as
// opaque strings from the caller; nothing here builds a storage URL.
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  var D = root.WeeklyReportData;
  if (!D && typeof require === 'function') D = require('./weekly-report-data.js');

  var WR_PRINT_CSS =
    '@page { size: A4 portrait; margin: 14mm 12mm; @bottom-right { content: "Page " counter(page) " of " counter(pages); } }\n' +
    '* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n' +
    'body { font: 12px/1.45 Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; }\n' +
    '.wr-letterhead { display: block; width: 100%; max-height: 90px; object-fit: contain; margin-bottom: 8px; }\n' +
    'h1 { font-size: 20px; margin: 4px 0 2px; } h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #bbb; padding-bottom: 2px; }\n' +
    'h3 { font-size: 12px; margin: 10px 0 4px; }\n' +
    '.wr-sub { color: #444; margin: 0 0 6px; }\n' +
    '.wr-banner { border: 1px solid #b45309; background: #fef3c7; color: #78350f; padding: 6px 8px; font-weight: bold; margin: 8px 0; }\n' +
    '.wr-cover { border: 1px solid #ccc; background: #f5f5f5; padding: 6px 8px; margin: 8px 0; }\n' +
    '.wr-summary span { display: inline-block; margin-right: 18px; }\n' +
    'table { width: 100%; border-collapse: collapse; margin: 6px 0; }\n' +
    'th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }\n' +
    'th { background: #eee; }\n' +
    '.wr-entry { margin: 10px 0; padding-bottom: 8px; border-bottom: 1px dashed #ccc; }\n' +
    '.wr-note { white-space: pre-wrap; margin: 4px 0; }\n' +
    '.wr-photos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }\n' +
    'figure { break-inside: avoid; margin: 0; }\n' +
    'figure img { width: 100%; max-height: 300px; object-fit: contain; border: 1px solid #ccc; }\n' +
    'figcaption { font-size: 10px; color: #444; margin-top: 2px; }\n' +
    '.wr-missing { border: 1px dashed #888; padding: 40px 8px; text-align: center; color: #666; font-weight: bold; }\n' +
    '.wr-source { font-size: 9px; color: #666; margin-top: 4px; }\n';

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function manilaStamp(iso) {
    var t = new Date(iso);
    if (!iso || isNaN(t.getTime())) return '—';
    var d = new Date(t.getTime() + 8 * 3600e3);
    var key = d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
    return D.wrDayLabel(key) + ' ' + d.getUTCFullYear() + ', ' + D.wrTime(iso);
  }
  function workerNo(n) { return D.wrWorkerNo(n); }
  function first8(s) { return String(s == null ? '' : s).slice(0, 8); }

  function figureHtml(p, urls) {
    var url = p.path ? urls.get(p.path) : null;
    var cap = '<figcaption>' + esc(p.label) + '</figcaption>';
    if (!url) return '<figure><div class="wr-missing">Photo unavailable</div>' + cap + '</figure>';
    return '<figure><img src="' + esc(url) + '" alt="' + esc(p.label) + '">' + cap + '</figure>';
  }

  function sourceLine(e) {
    var s = 'Source: attendance record ' + esc(first8(e.recordId));
    if (e.timeoutEventId) s += ' · Time Out event ' + esc(first8(e.timeoutEventId));
    return '<div class="wr-source">' + s + '</div>';
  }

  function entryHtml(e, urls, opts) {
    var h = '<div class="wr-entry">';
    var head = '<strong>' + esc(D.wrDayLabel(e.date)) + '</strong>';
    if (opts.worker) head += ' · ' + esc(e.workerName) + ' (' + esc(workerNo(e.workerNo)) + ')';
    if (!opts.hideProject) {
      head += ' · ' + esc(e.project ? e.project.name : '—');
      if (e.projectsDiffer && e.timeInProject) head += ' (Time In at ' + esc(e.timeInProject.name) + ')';
    }
    h += '<div>' + head + '</div>';
    h += '<div class="wr-note">' + (e.note ? esc(e.note) : 'No note written') + '</div>';
    if (e.photos && e.photos.length) {
      h += '<div class="wr-photos">' + e.photos.map(function (p) { return figureHtml(p, urls); }).join('') + '</div>';
    }
    return h + sourceLine(e) + '</div>';
  }

  var LH = '/assets/images/DACS-LETTERHEAD.png';
  var LH_FALLBACK = '/assets/images/DACS-TRANSPARENT.png';

  function headerHtml(title, ctx) {
    var origin = (ctx && ctx.origin) || '';
    var h = '<img class="wr-letterhead" src="' + esc(origin + LH) + '" alt="" onerror="this.onerror=null;this.src=\'' + esc(origin + LH_FALLBACK) + '\'">';
    h += '<h1>' + esc(title) + '</h1>';
    h += '<p class="wr-sub">' + esc(D.wrWeekLabel(ctx.weekStart)) + '</p>';
    if (ctx.live) h += '<div class="wr-banner">Not final — live report assembled ' + esc(manilaStamp(ctx.generatedAt)) + '</div>';
    else h += '<p class="wr-sub">Report assembled ' + esc(manilaStamp(ctx.generatedAt)) + '</p>';
    if (ctx.coverageNote) h += '<div class="wr-cover">' + esc(ctx.coverageNote) + '</div>';
    return h;
  }

  var PRINT_SCRIPT =
    '(function(){var imgs=[].slice.call(document.images);' +
    'var waits=imgs.map(function(i){return new Promise(function(res){' +
    'function done(){res();}' +
    'if(i.complete){if(i.decode){i.decode().then(done,done);}else{done();}return;}' +
    'i.addEventListener("load",function(){if(i.decode){i.decode().then(done,done);}else{done();}});' +
    'i.addEventListener("error",done);});});' +
    'Promise.all(waits).then(function(){setTimeout(function(){window.print();},50);});})();';

  function docHtml(title, body, css) {
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + (css || WR_PRINT_CSS) +
      '</style></head><body>' + body + '<script>' + PRINT_SCRIPT + '</scr' + 'ipt></body></html>';
  }

  function wrPrintEmployeeHtml(emp, ctx, urls) {
    urls = urls || new Map();
    var b = headerHtml('Weekly Attendance and Work Report', ctx);
    b += '<h2>' + esc(emp.name) + '</h2><p class="wr-sub">' + esc(workerNo(emp.workerNo)) + ' · ' + esc(emp.position || '—') + '</p>';
    b += '<div class="wr-summary"><span><strong>' + (emp.hoursText === 'No hours recorded' ? 'No hours recorded' : 'Recorded hours: ' + esc(emp.hoursText)) + '</strong></span>' +
      '<span>Recorded days: ' + esc(emp.recordedDays) + '</span><span>Incomplete days: ' + esc(emp.incompleteDays) + '</span></div>';
    if (emp.duties && emp.duties.text) {
      b += '<h2>General duties (standing responsibilities, not a record of work done)</h2><div class="wr-note">' + esc(emp.duties.text) + '</div>';
    }
    b += '<h2>Daily attendance</h2><table><tr><th>Day</th><th>Status</th><th>Time In</th><th>Time Out</th><th>Site</th><th>Hours</th></tr>';
    emp.days.forEach(function (d) {
      var r = d.record;
      var site = r ? (r.timein_project_name || r.timeout_project_name || '—') : '—';
      if (r && r.timeout_project_name && r.timein_project_name && r.timeout_project_name !== r.timein_project_name) site = r.timein_project_name + ' → ' + r.timeout_project_name;
      b += '<tr><td>' + esc(D.wrDayLabel(d.date)) + '</td><td>' + esc(d.statusLabel) + '</td><td>' + esc(r ? D.wrTime(r.timein_at) : '—') +
        '</td><td>' + esc(r ? D.wrTime(r.timeout_at) : '—') + '</td><td>' + esc(site) + '</td><td>' +
        esc(r && r.total_minutes != null ? D.wrHoursText(r.total_minutes) : '—') + '</td></tr>';
    });
    b += '</table><h2>Work reported</h2>';
    if (!emp.entries.length) b += '<p>No work reported this week.</p>';
    emp.entries.forEach(function (e) { b += entryHtml(e, urls, {}); });
    return docHtml('Weekly report - ' + emp.name, b);
  }

  // Escapes a value for a double-quoted CSS string (the @page footer).
  function cssString(v) {
    return String(v == null ? '' : v)
      .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r\n|\r|\n|\f/g, '\\A ').replace(/</g, '\\3C ');
  }

  var WR_PROJECT_CSS =
    'body { font-family: Arial, Helvetica, sans-serif; color: #1f2a44; }\n' +
    '.wr-band { background: #1f2a44; color: #fff; border-radius: 10px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 3px solid #c9a227; }\n' +
    '.wr-band-kicker { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #cfd6e6; }\n' +
    '.wr-band h1 { color: #fff; font-size: 24px; margin: 6px 0 4px; }\n' +
    '.wr-band h1 span { color: #c9a227; }\n' +
    '.wr-band-sub { font-size: 10px; color: #cfd6e6; margin: 0; }\n' +
    '.wr-logo-box { background: #fff; border-radius: 10px; padding: 6px 8px; flex: none; }\n' +
    '.wr-logo-box img { display: block; height: 34px; width: auto; max-width: 120px; object-fit: contain; }\n' +
    '.wr-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }\n' +
    '.wr-tile { border: 1px solid #dde1ea; border-radius: 8px; padding: 8px 10px; background: #fff; }\n' +
    '.wr-tile.dark { background: #1f2a44; color: #fff; border-color: #1f2a44; }\n' +
    '.wr-tile-n { font-size: 20px; font-weight: bold; } .wr-tile-l { font-size: 8px; letter-spacing: 1px; text-transform: uppercase; color: #6b7280; }\n' +
    '.wr-tile.dark .wr-tile-l { color: #cfd6e6; }\n' +
    '.wr-sec { font-size: 12px; margin: 16px 0 8px; padding: 0; border: 0; display: flex; align-items: center; gap: 6px; }\n' +
    '.wr-sec:before { content: ""; width: 7px; height: 7px; background: #1f2a44; display: inline-block; }\n' +
    '.wr-day { font-size: 10px; color: #6b7280; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 1px; }\n' +
    '.wr-card { border: 1px solid #dde1ea; border-top: 2px solid #15803d; border-radius: 8px; padding: 8px 10px; margin: 6px 0; break-inside: avoid; display: flex; justify-content: space-between; gap: 10px; }\n' +
    '.wr-card .wr-who { font-size: 8px; letter-spacing: 1px; text-transform: uppercase; color: #6b7280; }\n' +
    '.wr-card .wr-note { font-size: 12px; font-weight: bold; margin: 2px 0; }\n' +
    '.wr-card .wr-range { font-size: 10px; color: #6b7280; white-space: nowrap; }\n' +
    '.wr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }\n' +
    '.wr-grid figure { position: relative; break-inside: avoid; page-break-inside: avoid; border-radius: 10px; overflow: hidden; border: 1px solid #dde1ea; margin: 0; }\n' +
    '.wr-grid figure img { display: block; width: 100%; height: 62mm; object-fit: cover; border: 0; max-height: none; }\n' +
    '.wr-grid .wr-missing { height: 62mm; display: flex; align-items: center; justify-content: center; padding: 0 8px; border: 0; background: #f3f4f6; }\n' +
    '.wr-badge { position: absolute; top: 6px; left: 6px; z-index: 1; background: #1f2a44; color: #fff; font-size: 9px; font-weight: bold; border-radius: 4px; padding: 2px 6px; }\n' +
    '.wr-grid figcaption { font-size: 9px; padding: 4px 6px; color: #444; }\n';

  function projectCard(r) {
    var e = r.entry;
    var range = r.from == null ? 'No photos' : (r.from === r.to ? 'Photos #' + r.from : 'Photos #' + r.from + '–#' + r.to);
    var site = (e.projectsDiffer && e.timeInProject) ? '<div class="wr-source">Time In at ' + esc(e.timeInProject.name) + '</div>' : '';
    return '<div class="wr-card"><div><div class="wr-who">' + esc(e.workerName) + ' (' + esc(workerNo(e.workerNo)) + ')</div>' +
      '<div class="wr-note">' + (e.note ? esc(e.note) : 'No note written') + '</div>' + site + sourceLine(e) + '</div>' +
      '<div class="wr-range">' + range + '</div></div>';
  }

  function wrPrintProjectHtml(project, ctx, urls, dayKey) {
    urls = urls || new Map();
    ctx = ctx || {};
    var origin = ctx.origin || '';
    var num = D.wrNumberPhotos(project, dayKey || null);
    var rows = num.rows;
    var workers = {}, dates = {}, order = [];
    rows.forEach(function (r) {
      workers[r.entry.workerId] = true;
      if (!dates[r.entry.date]) { dates[r.entry.date] = []; order.push(r.entry.date); }
      dates[r.entry.date].push(r);
    });
    var period = dayKey ? D.wrDayLabel(dayKey) + ' ' + dayKey.slice(0, 4) : D.wrWeekLabel(ctx.weekStart);
    var pname = project.name || '—';
    var sys = project.system === 'pm' ? 'Project Management' : 'Project Control';
    var b = '<div class="wr-band"><div><div class="wr-band-kicker">' + esc(String(project.name == null ? '' : project.name).toUpperCase()) + ' · OFFICE REPORT</div>' +
      '<h1>' + (dayKey ? 'Daily' : 'Weekly') + ' Progress <span>Report</span></h1>' +
      '<p class="wr-band-sub">' + esc(sys) + ' · ' + esc(period) + ' · Assembled ' + esc(manilaStamp(ctx.generatedAt)) + '</p></div>' +
      '<div class="wr-logo-box"><img src="' + esc(origin + LH) + '" alt="DAC" onerror="this.onerror=null;this.src=\'' + esc(origin + LH_FALLBACK) + '\'"></div></div>';
    // No "Not final" banner on the project report (owner, 23 Nov 2026): the band's
    // "Assembled <date, time>" already says when it was made.
    if (ctx.coverageNote) b += '<div class="wr-cover">' + esc(ctx.coverageNote) + '</div>';
    if (!rows.length) {
      b += '<p>No work submitted for this period.</p>';
    } else {
      var tiles = [[rows.length, 'Submissions'], [Object.keys(workers).length, 'Workers'], [num.photos.length, 'Photos'], [order.length, 'Days with work']];
      b += '<div class="wr-tiles">' + tiles.map(function (t, i) {
        return '<div class="wr-tile' + (i === 0 ? ' dark' : '') + '"><div class="wr-tile-n">' + t[0] + '</div><div class="wr-tile-l">' + t[1] + '</div></div>';
      }).join('') + '</div>';
      b += '<h2 class="wr-sec">Work done</h2>';
      order.forEach(function (d) {
        b += '<div class="wr-day">' + esc(D.wrDayLabel(d)) + '</div>' + dates[d].map(projectCard).join('');
      });
      if (num.photos.length) {
        b += '<h2 class="wr-sec">Progress photos</h2><div class="wr-grid">';
        num.photos.forEach(function (p) {
          var url = p.path ? urls.get(p.path) : null;
          var cap = D.wrDayLabel(p.entry.date) + ' · ' + p.entry.workerName + (p.legacy ? ' · ' + p.label : '');
          var badge = '<span class="wr-badge">#' + p.n + '</span>';
          b += '<figure>' + badge + (url ? '<img src="' + esc(url) + '" alt="' + esc(cap) + '">' : '<div class="wr-missing">Photo unavailable</div>') +
            '<figcaption>' + esc(cap) + '</figcaption></figure>';
        });
        b += '</div>';
      }
    }
    var foot = 'font-family: Arial, Helvetica, sans-serif; font-size: 8px; color: #6b7280;';
    var css = WR_PRINT_CSS + WR_PROJECT_CSS +
      '@page { @bottom-left { content: "' + cssString(pname + ' · ' + period) + '"; ' + foot + ' } @bottom-right { content: "Page " counter(page) " of " counter(pages); ' + foot + ' } }\n';
    return docHtml((dayKey ? 'Daily' : 'Weekly') + ' Progress Report - ' + pname + ' - ' + period, b, css);
  }

  // Resolves 'printed' | 'blocked' | 'error' (never rejects).
  function wrOpenPrint(buildHtml, paths, sign, win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    var w = win && win.open('', '_blank');
    if (!w) return Promise.resolve('blocked');
    try {
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparing report…</title></head><body><p style="font:14px Arial;padding:24px">Preparing report…</p></body></html>');
    } catch (e0) { return Promise.resolve('error'); }
    var distinct = [];
    (paths || []).forEach(function (p) { if (p && distinct.indexOf(p) < 0) distinct.push(p); });
    var urls = new Map();
    var next = 0;
    function worker() {
      if (next >= distinct.length) return Promise.resolve();
      var p = distinct[next++];
      var done;
      try { done = Promise.resolve(sign(p)); } catch (e) { done = Promise.resolve(null); }
      return done.then(function (u) { urls.set(p, u || null); }, function () { urls.set(p, null); }).then(worker);
    }
    var pool = [];
    for (var i = 0; i < Math.min(4, distinct.length); i++) pool.push(worker());
    return Promise.all(pool).then(function () {
      try {
        var html = buildHtml(urls);
        if (w.document.open) w.document.open();
        w.document.write(html);
        if (w.document.close) w.document.close();
        return 'printed';
      } catch (e) {
        try {
          if (w.document.open) w.document.open();
          w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Report</title></head><body><p style="font:14px Arial;padding:24px">The report could not be prepared. Close this window and try again.</p></body></html>');
          if (w.document.close) w.document.close();
        } catch (e2) { /* window already closed */ }
        return 'error';
      }
    });
  }

  var api = {
    WR_PRINT_CSS: WR_PRINT_CSS, wrPrintEmployeeHtml: wrPrintEmployeeHtml,
    wrPrintProjectHtml: wrPrintProjectHtml, wrOpenPrint: wrOpenPrint
  };
  root.WeeklyReportPrint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
