// ════════════════════════════════════════════════════════════════════
// BOOKING WIZARD (index.html #/book) — public appointment request.
//
// The helpers at the top are pure: tests/booking.test.js requires this file
// in Node, and admin.html loads it so admin computes the reference code and
// schedule text with the very same functions.
//
// Saving is a plain insert with NO read-back. The public may insert
// appointments but not select them (RLS), and insert().select() — which is
// what db.collection().add() does — makes Postgres reject the whole insert.
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const MEETINGS = [
    { id: 'office', label: 'Office visit', sub: 'Meet us in Quezon City' },
    { id: 'site',   label: 'Site visit',   sub: 'We visit your property' },
    { id: 'online', label: 'Online call',  sub: 'Video call from anywhere' }
  ];
  const PROPERTIES = ['Condominium unit', 'House', 'Apartment / multi-storey building', 'Commercial space'];
  const BUDGETS = ['Below ₱500K', '₱500K – ₱1M', '₱1M – ₱3M', '₱3M – ₱10M', '₱10M and above', 'Not sure yet'];
  const LOCS = ['Quezon City', 'Makati', 'Taguig', 'Pasig', 'Manila', 'Outside Metro Manila'];
  const TIMES = ['9:00 AM', '10:30 AM', '1:00 PM', '2:30 PM', '4:00 PM'];
  const STEP_TITLES = ['Consultation', 'Your project', 'Schedule', 'Contact details'];
  const EMPTY = { meeting: '', service: '', property: '', budget: '', location: '', details: '',
    date: '', time: '', name: '', email: '', phone: '' };

  const pad = (n) => String(n).padStart(2, '0');
  const trim = (v) => String(v == null ? '' : v).trim();

  // Local Y-M-D — never toISOString(): PH is UTC+8 and that rolls back a day.
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDateKey(k) { const p = String(k).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function bookingWindow(today) {
    const t = startOfDay(today);
    const min = new Date(t); min.setDate(min.getDate() + 1);
    const max = new Date(t); max.setMonth(max.getMonth() + 3);
    return { min, max };
  }

  function isBookable(d, today) {
    const w = bookingWindow(today), x = startOfDay(d);
    return x >= w.min && x <= w.max && x.getDay() !== 0;
  }

  function monthCells(y, m, today, selectedKey) {
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;       // Monday-first
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push({ blank: true });
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m, d), key = dateKey(dt);
      cells.push({ day: d, key, disabled: !isBookable(dt, today), selected: key === selectedKey });
    }
    return cells;
  }

  function canShowMonth(y, m, today) {
    const first = new Date(y, m, 1);
    return first >= new Date(today.getFullYear(), today.getMonth(), 1) && first <= bookingWindow(today).max;
  }

  function validateStep(step, b) {
    if (step === 1) {
      if (!b.meeting) return 'Choose how you would like to meet.';
      if (!b.service) return 'Select the service you need.';
    }
    if (step === 2) {
      if (!b.property) return 'Select your property type.';
      if (!b.budget) return 'Select an estimated budget.';
      if (!trim(b.location)) return 'Tell us where the property is.';
    }
    if (step === 3) {
      if (!b.date) return 'Pick a preferred date.';
      if (!b.time) return 'Pick a preferred time.';
    }
    if (step === 4) {
      if (!trim(b.name) || !trim(b.email) || !trim(b.phone)) return 'Please complete all required fields.';
      if (!/^\S+@\S+\.\S+$/.test(trim(b.email))) return 'Please enter a valid email address.';
    }
    return '';
  }

  function buildRow(id, b) {
    return {
      id,
      fullname: trim(b.name),
      email: trim(b.email),
      contact: trim(b.phone),
      service: b.service,
      message: trim(b.details),
      meeting_type: b.meeting,
      property_type: b.property,
      budget: b.budget,
      location: trim(b.location),
      preferred_date: b.date,
      preferred_time: b.time,
      status: 'pending'
    };
  }

  function refCode(id) { return 'DACS-' + String(id || '').replace(/-/g, '').slice(0, 6).toUpperCase(); }

  function meetingLabel(id) {
    const m = MEETINGS.find((x) => x.id === id);
    return m ? m.label : (id || '');
  }

  function formatPreferred(key, time) {
    if (!key) return time || '';
    const s = parseDateKey(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return time ? s + ' · ' + time : s;
  }

  function summaryRows(b, serviceLabel) {
    return [
      ['Meeting', meetingLabel(b.meeting)],
      ['Service', serviceLabel || ''],
      ['Property', b.property],
      ['Budget', b.budget],
      ['Location', trim(b.location)],
      ['Schedule', formatPreferred(b.date, b.time)]
    ];
  }

  const api = { MEETINGS, PROPERTIES, BUDGETS, LOCS, TIMES, STEP_TITLES, EMPTY,
    dateKey, parseDateKey, isBookable, monthCells, canShowMonth, validateStep,
    buildRow, refCode, meetingLabel, formatPreferred, summaryRows };

  if (typeof document !== 'undefined') {
    const MEETING_ICONS = {
      office: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>',
      site: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
      online: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'
    };
    const ERR_SAVE = "Sorry, we couldn't send your request. Please try again or message us on Messenger.";
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const today = () => new Date();
    function firstCalMonth() { const d = today(); d.setDate(d.getDate() + 1); return { y: d.getFullYear(), m: d.getMonth() }; }
    const S = { step: 1, bk: Object.assign({}, EMPTY), error: '', tried: false, done: false, ref: '', saving: false, cal: firstCalMonth() };

    const serviceOpts = () => ((root.DacsSite && root.DacsSite.SERVICES) || [])
      .map((s) => [s.id, s.title]).concat([['consultation', 'General Consultation']]);
    const serviceLabel = (id) => (serviceOpts().find((o) => o[0] === id) || [0, ''])[1];

    function uuid() {
      if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
      const b = root.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    }

    function chips(el, opts, selected, cls) {
      el.innerHTML = opts.map(([v, l]) => '<button type="button" class="' + (cls || 'chip') + (v === selected ? ' is-on' : '') +
        '" aria-pressed="' + (v === selected) + '" data-v="' + esc(v) + '">' + esc(l) + '</button>').join('');
    }

    // render() rebuilds chips/days with innerHTML, which destroys the focused
    // button; remember which one it was and focus its replacement.
    const FOCUS_BOXES = ['bkMeetings', 'bkServices', 'bkProperties', 'bkBudgets', 'bkLocChips', 'bkTimes', 'bkCalGrid'];
    function render() {
      const a = document.activeElement;
      let mark = null;
      if (a && a.closest && $('bookWizard') && $('bookWizard').contains(a)) {
        if (a.id === 'bkCalPrev' || a.id === 'bkCalNext') mark = { nav: a.id };
        else {
          const box = a.closest('[data-v], [data-key]');
          const host = box && FOCUS_BOXES.find((id) => $(id).contains(box));
          if (host) mark = { host, attr: box.hasAttribute('data-key') ? 'data-key' : 'data-v', val: box.getAttribute(box.hasAttribute('data-key') ? 'data-key' : 'data-v') };
        }
      }
      renderView();
      if (!mark || S.done) return;
      let el = null;
      if (mark.nav) {
        el = $(mark.nav);
        if (el.disabled) el = $(mark.nav === 'bkCalPrev' ? 'bkCalNext' : 'bkCalPrev');
        if (el.disabled) el = $('bkCalGrid').querySelector('.bk-day:not(:disabled)');
      } else {
        el = Array.from($(mark.host).querySelectorAll('[' + mark.attr + ']')).find((n) => n.getAttribute(mark.attr) === mark.val);
      }
      if (el && el.offsetParent !== null) el.focus();
    }

    function renderView() {
      const b = S.bk;
      $('bkDone').hidden = !S.done;
      $('bookWizard').querySelector('.bk-flow').hidden = S.done;
      renderSummary($('bkSummary'));
      if (S.done) {
        const first = b.name.trim().split(/\s+/)[0] || 'there';
        $('bkRef').textContent = 'Reference ' + S.ref;
        $('bkThanks').textContent = 'Thank you, ' + first + '. Your request is in.';
        $('bkDoneMsg').textContent = "This is a preferred schedule — we'll confirm it with you within 24 hours at " +
          b.email.trim() + ' or ' + b.phone.trim() + '.';
        renderSummary($('bkDoneSummary'));
        return;
      }
      $('bkStepNum').textContent = 'Step ' + S.step + ' of 4';
      $('bkStepTitle').textContent = STEP_TITLES[S.step - 1];
      $('bkProgress').style.width = (S.step * 25) + '%';
      $('bkProgress').setAttribute('aria-valuenow', String(S.step * 25));
      [1, 2, 3, 4].forEach((n) => { $('bkS' + n).hidden = n !== S.step; });

      if (S.step === 1) {
        $('bkMeetings').innerHTML = MEETINGS.map((m) => '<button type="button" class="bk-meet' + (b.meeting === m.id ? ' is-on' : '') +
          '" aria-pressed="' + (b.meeting === m.id) + '" data-v="' + m.id + '"><span class="bk-meet-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          MEETING_ICONS[m.id] + '</svg></span><span class="bk-meet-label">' + m.label + '</span><span class="bk-meet-sub">' + m.sub + '</span></button>').join('');
        chips($('bkServices'), serviceOpts(), b.service);
      }
      if (S.step === 2) {
        chips($('bkProperties'), PROPERTIES.map((p) => [p, p]), b.property);
        chips($('bkBudgets'), BUDGETS.map((p) => [p, p]), b.budget);
        chips($('bkLocChips'), LOCS.map((p) => [p, p]), '', 'chip chip-sm');
      }
      if (S.step === 3) renderCalendar();
      if (S.step === 4) ['bkName', 'bkEmail', 'bkPhone'].forEach((id, i) => {
        const v = [b.name, b.email, b.phone][i];
        $(id).classList.toggle('is-invalid', S.tried && !String(v).trim());
      });

      $('bkError').textContent = S.error ? '⚠ ' + S.error : '';
      $('bkError').hidden = !S.error;
      $('bkBack').hidden = S.step === 1;
      $('bkNext').textContent = S.saving ? 'Sending…' : (S.step === 4 ? 'Submit Appointment Request' : 'Continue →');
      $('bkNext').disabled = S.saving;
    }

    function renderSummary(el) {
      el.innerHTML = summaryRows(S.bk, serviceLabel(S.bk.service)).map(([k, v]) =>
        '<div class="bk-sum-row"><span>' + k + '</span><span class="' + (v ? '' : 'is-empty') + '">' + esc(v || '—') + '</span></div>').join('');
    }

    function renderCalendar() {
      const t = today(), c = S.cal, b = S.bk;
      $('bkCalTitle').textContent = new Date(c.y, c.m, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
      const prev = c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 };
      const next = c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 };
      $('bkCalPrev').disabled = !canShowMonth(prev.y, prev.m, t);
      $('bkCalNext').disabled = !canShowMonth(next.y, next.m, t);
      $('bkCalGrid').querySelectorAll('.bk-day, .bk-blank').forEach((n) => n.remove());
      $('bkCalGrid').insertAdjacentHTML('beforeend', monthCells(c.y, c.m, t, b.date).map((x) => x.blank
        ? '<span class="bk-blank" aria-hidden="true"></span>'
        : '<button type="button" class="bk-day' + (x.selected ? ' is-on' : '') + '" data-key="' + x.key + '"' +
          (x.disabled ? ' disabled' : '') + ' aria-pressed="' + x.selected + '" aria-label="' +
          esc(parseDateKey(x.key).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })) + '">' + x.day + '</button>').join(''));
      $('bkDateLong').textContent = b.date
        ? parseDateKey(b.date).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })
        : 'Select a date first';
      chips($('bkTimes'), TIMES.map((x) => [x, x]), b.time);
    }

    function setBk(k, v, rerender) { S.bk[k] = v; S.error = ''; if (rerender) render(); else { renderSummary($('bkSummary')); $('bkError').hidden = true; } }

    async function submit() {
      if (S.saving) return;
      if (typeof sb === 'undefined') { S.error = ERR_SAVE; return render(); }
      S.saving = true; render();
      const id = uuid();
      try {
        const { error } = await sb.from('appointments').insert(buildRow(id, S.bk));
        if (error) throw error;
        S.done = true; S.ref = refCode(id); S.error = '';
      } catch (e) {
        S.error = ERR_SAVE;
        if (typeof _dacsReportError === 'function') {
          _dacsReportError('error', 'Appointment submit failed: ' + ((e && e.message) || e), 'js/booking.js', 0, 0, e && e.stack);
        }
      } finally {
        S.saving = false; render();
        if (S.done) {
          root.scrollTo({ top: $('bookWizard').getBoundingClientRect().top + root.scrollY - 100 });
          $('bkThanks').focus({ preventScroll: true });
        }
      }
    }

    function next() {
      const err = validateStep(S.step, S.bk);
      if (err) { S.error = err; S.tried = true; return render(); }
      if (S.step < 4) { S.step++; S.error = ''; S.tried = false; render(); $('bkStepTitle').focus && $('bkStepTitle').focus(); return; }
      submit();
    }

    function start(serviceId) {
      Object.assign(S, { step: 1, bk: Object.assign({}, EMPTY, serviceId ? { service: serviceId } : {}),
        error: '', tried: false, done: false, ref: '', saving: false, cal: firstCalMonth() });
      ['bkLocation', 'bkDetails', 'bkName', 'bkEmail', 'bkPhone'].forEach((id) => { if ($(id)) $(id).value = ''; });
      if ($('bookWizard')) render();
    }

    function init() {
      if (!$('bookWizard')) return;              // admin.html loads this file too
      const pick = (id, key) => $(id).addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]'); if (b) setBk(key, b.dataset.v, true);
      });
      pick('bkMeetings', 'meeting'); pick('bkServices', 'service'); pick('bkProperties', 'property');
      pick('bkBudgets', 'budget'); pick('bkTimes', 'time');
      $('bkLocChips').addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        $('bkLocation').value = b.dataset.v; setBk('location', b.dataset.v);
      });
      [['bkLocation', 'location'], ['bkDetails', 'details'], ['bkName', 'name'], ['bkEmail', 'email'], ['bkPhone', 'phone']]
        .forEach(([id, key]) => $(id).addEventListener('input', (e) => setBk(key, e.target.value)));
      $('bkCalGrid').addEventListener('click', (e) => {
        const d = e.target.closest('[data-key]'); if (d && !d.disabled) setBk('date', d.dataset.key, true);
      });
      $('bkCalPrev').addEventListener('click', () => { const c = S.cal; S.cal = c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }; render(); });
      $('bkCalNext').addEventListener('click', () => { const c = S.cal; S.cal = c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }; render(); });
      $('bkBack').addEventListener('click', () => { S.step--; S.error = ''; render(); $('bkStepTitle').focus(); });
      $('bkNext').addEventListener('click', next);
      $('bkAnother').addEventListener('click', () => { start(); $('bkStepTitle').focus(); });
      render();
    }

    root.dacsStartBooking = start;
    document.addEventListener('DOMContentLoaded', init);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DacsBooking = api;
})(typeof window !== 'undefined' ? window : this);
