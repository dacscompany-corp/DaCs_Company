// ════════════════════════════════════════════════════════════════════
// WEEKLY REPORT ENGINE — pure functions that turn the att_week_report
// payload into employees, days, entries and projects. No DOM, no network,
// no global state. Dates are 'YYYY-MM-DD' strings; day arithmetic uses
// Date.UTC so the browser's timezone never matters. Hours come from
// total_minutes only.
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var WR_DAY_LABEL = {
    pending: 'Pending',
    none: 'No attendance recorded',
    working: 'Still on site',
    complete: 'Finished the day',
    missing_timeout: 'No Time Out',
    admin_closed: 'Closed by the office'
  };
  var WR_REASON = {
    missing_timeout: 'No Time Out',
    admin_closed: 'Closed by the office',
    verification: 'Location concern',
    no_photo: 'Work photo missing'
  };
  var REASON_ORDER = ['missing_timeout', 'admin_closed', 'verification', 'no_photo'];
  var BAD_LOCATION = { outside_radius: 1, mock_location: 1, permission_denied: 1 };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function parseKey(key) {
    var p = String(key).split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }
  function keyFromMs(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function keyMs(key) { var k = parseKey(key); return Date.UTC(k.y, k.m - 1, k.d); }

  function wrManilaTodayKey(nowMs) { return keyFromMs(nowMs + 8 * 3600e3); }
  function wrAddDays(key, n) { return keyFromMs(keyMs(key) + n * 86400000); }
  function wrWeekStart(key) {
    var dow = new Date(keyMs(key)).getUTCDay(); // 0 = Sunday
    return wrAddDays(key, -((dow + 6) % 7));
  }
  function wrWeekDays(weekStart) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(wrAddDays(weekStart, i));
    return out;
  }

  function wrTime(iso) {
    if (!iso) return '—';
    var t = new Date(iso);
    if (isNaN(t.getTime())) return '—';
    return t.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(/\s/g, ' ');
  }

  function dayName(key) { return DAY_NAMES[new Date(keyMs(key)).getUTCDay()]; }
  function wrDayLabel(key) {
    var k = parseKey(key);
    return dayName(key) + ' ' + k.d + ' ' + MONTH_NAMES[k.m - 1];
  }
  function wrWeekLabel(weekStart) {
    var a = parseKey(weekStart), endKey = wrAddDays(weekStart, 6), b = parseKey(endKey);
    var first = 'Mon ' + a.d;
    if (a.m !== b.m || a.y !== b.y) first += ' ' + MONTH_NAMES[a.m - 1];
    if (a.y !== b.y) first += ' ' + a.y;
    return first + ' – Sun ' + b.d + ' ' + MONTH_NAMES[b.m - 1] + ' ' + b.y;
  }

  function wrHoursText(minutes) {
    if (minutes === null || minutes === undefined) return '—';
    var m = Math.max(0, Number(minutes) | 0); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }
  function wrWorkerNo(n) {
    if (n === null || n === undefined || n === '') return '—';
    var s = String(n);
    while (s.length < 4) s = '0' + s;
    return 'W-' + s;
  }
  function wrTrade(position) {
    return String(position == null ? '' : position).trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  function wrDayStatus(record, dayKey, todayKey) {
    if (!record) return dayKey >= todayKey ? 'pending' : 'none';
    if (record.status === 'complete') return 'complete';
    if (record.status === 'abandoned') return 'admin_closed';
    if (record.status === 'working') return dayKey === todayKey ? 'working' : 'missing_timeout';
    return 'none';
  }

  function wrPhotos(record) {
    var extras = record.timeout_extra_photo_paths;
    var main = record.timeout_photo_path;
    if (Array.isArray(extras) && extras.length) {
      var all = [main === undefined ? null : main].concat(extras);
      return all.map(function (p, i) {
        return { path: p === undefined ? null : p, label: 'Work photo ' + (i + 1) + ' of ' + all.length, legacy: false };
      });
    }
    if (main) return [{ path: main, label: 'Legacy Time Out photo - purpose not recorded', legacy: true }];
    return [];
  }

  function wrProjectKey(system, id) { return (system === 'pm' ? 'pm:' : 'pc:') + id; }

  // A deleted project leaves a null id, so key by its saved name (then by the
  // record) rather than letting every deleted project collapse into one.
  function projRef(system, folderId, pmId, name, recordId) {
    var id = folderId != null ? folderId : pmId;
    if (system == null && id == null) return null;
    var key;
    if (id != null) key = wrProjectKey(system, id);
    else {
      var nm = String(name == null ? '' : name).trim().toLowerCase();
      key = (system === 'pm' ? 'pm' : 'pc') + (nm ? ':name:' + nm : ':record:' + recordId);
    }
    return { key: key, system: system, id: id, name: name };
  }

  function wrEntry(record, person) {
    if (!record || record.status !== 'complete') return null;
    person = person || {};
    var project = projRef(record.timeout_project_system, record.timeout_folder_id, record.timeout_pm_project_id, record.timeout_project_name, record.id);
    var tin = projRef(record.timein_project_system, record.timein_folder_id, record.timein_pm_project_id, record.timein_project_name, record.id);
    var photos = wrPhotos(record);
    var note = record.timeout_description;
    return {
      recordId: record.id,
      workerId: record.worker_id,
      workerName: person.name != null ? person.name : (record.worker_name || '—'),
      workerNo: person.worker_no != null ? person.worker_no : (person.workerNo != null ? person.workerNo : null),
      date: record.work_date,
      project: project,
      timeInProject: tin,
      projectsDiffer: !!(tin && project && tin.key !== project.key),
      note: (note === null || note === undefined || note === '') ? null : note,
      photos: photos,
      legacy: photos.length > 0 && photos[0].legacy,
      timeOutAt: record.timeout_at,
      timeoutEventId: record.timeout_event_id
    };
  }

  function byRecordOrder(a, b) {
    if (a.work_date !== b.work_date) return a.work_date < b.work_date ? -1 : 1;
    var x = a.timein_at || '', y = b.timein_at || '';
    if (x !== y) return x < y ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
  }

  function recordReasons(r, todayKey) {
    var out = {};
    var st = wrDayStatus(r, r.work_date, todayKey);
    if (st === 'missing_timeout') out.missing_timeout = true;
    if (st === 'admin_closed') out.admin_closed = true;
    if (BAD_LOCATION[r.timein_location_status] || BAD_LOCATION[r.timeout_location_status] ||
        r.timein_is_mock === true || r.timeout_is_mock === true) out.verification = true;
    if (r.status === 'complete' && wrPhotos(r).length === 0) out.no_photo = true;
    return out;
  }

  function wrBuildEmployees(payload, todayKey) {
    var weekDays = wrWeekDays(payload.week_start);
    var records = (payload.records || []).slice().sort(byRecordOrder);
    var duties = payload.duties || [];
    var out = (payload.roster || []).map(function (m) {
      var mine = records.filter(function (r) { return r.worker_id === m.worker_id; });
      var newest = mine.length ? mine[mine.length - 1] : null;
      var name = (newest && newest.worker_name) || m.name || wrWorkerNo(m.worker_no);
      var position = (newest && newest.worker_position) || m.position || '';
      var trade = wrTrade(position);
      var person = { name: name, worker_no: m.worker_no };

      var days = weekDays.map(function (date) {
        var rc = null;
        for (var i = 0; i < mine.length; i++) if (mine[i].work_date === date) { rc = mine[i]; break; }
        var status = wrDayStatus(rc, date, todayKey);
        return { date: date, label: wrDayLabel(date), status: status, statusLabel: WR_DAY_LABEL[status], record: rc };
      });

      var entries = [];
      mine.forEach(function (r) { var e = wrEntry(r, person); if (e) entries.push(e); });

      var recDates = {};
      mine.forEach(function (r) { recDates[r.work_date] = true; });
      var knownMinutes = 0, anyKnown = false, incompleteDays = 0;
      mine.forEach(function (r) {
        if (r.total_minutes === null || r.total_minutes === undefined) incompleteDays++;
        else { knownMinutes += r.total_minutes; anyKnown = true; }
      });

      var reasonSet = {};
      mine.forEach(function (r) {
        var rr = recordReasons(r, todayKey);
        for (var k in rr) reasonSet[k] = true;
      });
      var reviewReasons = REASON_ORDER.filter(function (k) { return reasonSet[k]; });

      var duty = null;
      for (var i = 0; i < duties.length; i++) {
        if (String(duties[i].position).toLowerCase() === trade.toLowerCase()) {
          duty = { text: duties[i].duties, updatedAt: duties[i].updated_at };
          break;
        }
      }

      return {
        workerId: m.worker_id,
        workerNo: m.worker_no,
        name: name,
        position: position,
        trade: trade,
        active: m.active,
        inRoster: m.in_roster,
        headerPhotoPath: mine.length && mine[0].timein_photo_path ? mine[0].timein_photo_path : null,
        days: days,
        entries: entries,
        recordedDays: Object.keys(recDates).length,
        knownMinutes: knownMinutes,
        incompleteDays: incompleteDays,
        hoursText: anyKnown ? wrHoursText(knownMinutes) : 'No hours recorded',
        reviewReasons: reviewReasons,
        needsReview: reviewReasons.length > 0,
        duties: duty
      };
    });
    out.sort(function (a, b) {
      var x = a.name.toLowerCase(), y = b.name.toLowerCase();
      if (x !== y) return x < y ? -1 : 1;
      var p = a.workerNo == null ? Infinity : a.workerNo, q = b.workerNo == null ? Infinity : b.workerNo;
      return p === q ? 0 : (p < q ? -1 : 1);
    });
    return out;
  }

  function wrBuildProjects(payload) {
    var people = {};
    (payload.roster || []).forEach(function (m) { people[m.worker_id] = m; });
    var records = (payload.records || []).slice().sort(byRecordOrder);
    var map = {}, order = [];
    records.forEach(function (r) {
      var m = people[r.worker_id] || {};
      var e = wrEntry(r, { name: r.worker_name || m.name, worker_no: m.worker_no });
      if (!e || !e.project) return;
      var p = map[e.project.key];
      if (!p) {
        p = map[e.project.key] = { key: e.project.key, system: e.project.system, id: e.project.id, name: e.project.name, _days: {}, entries: [] };
        order.push(p);
      }
      p.name = e.project.name; // records are in date order, so the newest wins
      p.entries.push(e);
      (p._days[e.date] = p._days[e.date] || []).push(e);
    });
    // Rows from payload.projects (migration 0121) say which sites are hidden or
    // completed. When the key is absent the output is exactly Part 1's.
    var rows = Array.isArray(payload.projects) ? payload.projects : null;
    var meta = {};
    if (rows) rows.forEach(function (pr) { meta[wrProjectKey(pr.project_system, pr.project_id)] = pr; });
    var out = order.map(function (p) {
      var workers = {}, photos = 0;
      p.entries.forEach(function (e) { workers[e.workerId] = true; photos += e.photos.length; });
      var m = meta[p.key];
      return {
        key: p.key, system: p.system, id: p.id, name: p.name,
        days: Object.keys(p._days).sort().map(function (d) { return { date: d, label: wrDayLabel(d), entries: p._days[d] }; }),
        submissions: p.entries.length,
        contributors: Object.keys(workers).length,
        photoCount: photos,
        hidden: !!(m && m.hidden),
        completed: !!(m && m.completed),
        hasWork: true
      };
    });
    if (rows) {
      var seen = {};
      out.forEach(function (p) { seen[p.key] = true; });
      rows.forEach(function (pr) {
        var key = wrProjectKey(pr.project_system, pr.project_id);
        if (pr.completed !== false || seen[key]) return;
        seen[key] = true;
        out.push({
          key: key, system: pr.project_system, id: pr.project_id, name: pr.project_name,
          days: [], submissions: 0, contributors: 0, photoCount: 0,
          hidden: !!pr.hidden, completed: false, hasWork: false
        });
      });
    }
    out.sort(function (a, b) {
      var x = String(a.name == null ? '' : a.name).toLowerCase(), y = String(b.name == null ? '' : b.name).toLowerCase();
      return x === y ? 0 : (x < y ? -1 : 1);
    });
    return out;
  }

  // Numbers the photos of a project's entries from 1, in date, then worker name
  // (case-insensitive), then record id order. dayKey limits it to one day.
  function wrNumberPhotos(project, dayKey) {
    var list = [];
    ((project && project.entries) || flatEntries(project)).forEach(function (e) {
      if (!dayKey || e.date === dayKey) list.push(e);
    });
    list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var x = String(a.workerName == null ? '' : a.workerName).toLowerCase();
      var y = String(b.workerName == null ? '' : b.workerName).toLowerCase();
      if (x !== y) return x < y ? -1 : 1;
      var i = String(a.recordId), j = String(b.recordId);
      return i === j ? 0 : (i < j ? -1 : 1);
    });
    var n = 0, rows = [], photos = [];
    list.forEach(function (e) {
      var from = null, to = null;
      e.photos.forEach(function (ph) {
        n++;
        if (from === null) from = n;
        to = n;
        photos.push({ n: n, path: ph.path, label: ph.label, legacy: ph.legacy, entry: e });
      });
      rows.push({ entry: e, from: from, to: to });
    });
    return { rows: rows, photos: photos };
  }
  function flatEntries(project) {
    var out = [];
    ((project && project.days) || []).forEach(function (d) { d.entries.forEach(function (e) { out.push(e); }); });
    return out;
  }

  function wrCoverage(payload) {
    var h = payload.history_starts_on;
    var tail = ' This week lists only people with attendance records; others may be missing.';
    if (!h || h > payload.week_end) {
      return {
        kind: 'before_history',
        note: (h ? 'Roster history starts on ' + wrDayLabel(h) + '.' : 'Roster history has not started yet.') + tail
      };
    }
    if (h > payload.week_start) {
      return {
        kind: 'partial',
        note: 'Roster history starts on ' + wrDayLabel(h) + ', during this week. People with no records before then may be missing.'
      };
    }
    return { kind: 'full', note: '' };
  }

  function wrFilterEmployees(list, f) {
    f = f || {};
    var q = f.q ? String(f.q).trim().toLowerCase() : '';
    var trade = f.trade ? String(f.trade).toLowerCase() : '';
    return list.filter(function (e) {
      if (q && e.name.toLowerCase().indexOf(q) < 0 && wrWorkerNo(e.workerNo).toLowerCase().indexOf(q) < 0) return false;
      if (trade && e.trade.toLowerCase() !== trade) return false;
      if (f.needsReview && !e.needsReview) return false;
      if (f.projectKey && !e.entries.some(function (en) { return en.project && en.project.key === f.projectKey; })) return false;
      return true;
    });
  }

  var api = {
    WR_DAY_LABEL: WR_DAY_LABEL, WR_REASON: WR_REASON,
    wrManilaTodayKey: wrManilaTodayKey, wrAddDays: wrAddDays, wrWeekStart: wrWeekStart, wrWeekDays: wrWeekDays,
    wrTime: wrTime, wrDayLabel: wrDayLabel, wrWeekLabel: wrWeekLabel, wrHoursText: wrHoursText,
    wrWorkerNo: wrWorkerNo, wrTrade: wrTrade, wrDayStatus: wrDayStatus, wrPhotos: wrPhotos,
    wrProjectKey: wrProjectKey, wrEntry: wrEntry, wrBuildEmployees: wrBuildEmployees,
    wrBuildProjects: wrBuildProjects, wrNumberPhotos: wrNumberPhotos, wrCoverage: wrCoverage, wrFilterEmployees: wrFilterEmployees
  };
  root.WeeklyReportData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
