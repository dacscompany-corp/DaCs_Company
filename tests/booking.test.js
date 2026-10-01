// ════════════════════════════════════════════════════════════════════
// BOOKING TESTS: run with  node tests/booking.test.js
//
// Zero dependencies. Guards the public booking wizard (index.html #/book):
//   I.   Pure helpers in js/booking.js — local date keys (PH is UTC+8),
//        booking window, calendar cells, per-step validation, the saved
//        row, reference code, schedule text.
//   II.  Migration 0084 — six optional columns, appt_read dropped.
//   III. Admin — every service id has a label, budget hidden from staff.
//   IV.  Router — #appointment and unknown hashes resolve to a page.
//   V.   Fences — public saves never read back (RLS rejects the insert).
// ════════════════════════════════════════════════════════════════════
'use strict';
process.env.TZ = 'Asia/Manila';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function eq(a, b, label) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((label ? label + ': ' : '') + 'expected ' + B + ', got ' + A);
}
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }
function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error('missing file: ' + rel);
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

const B = require('../js/booking.js');
// Thursday 1 Oct 2026, 09:00 Manila
const TODAY = new Date(2026, 9, 1, 9, 0);

console.log('\nI. Booking helpers');

test('dateKey uses local parts (07:00 Manila is still the 5th)', () => {
  const d = new Date(2026, 9, 5, 7, 0);
  eq(B.dateKey(d), '2026-10-05');
  ok(d.toISOString().slice(0, 10) === '2026-10-04', 'sanity: the UTC slice would have rolled back');
});

test('parseDateKey round-trips', () => {
  eq(B.dateKey(B.parseDateKey('2026-12-31')), '2026-12-31');
});

test('booking window: from tomorrow to +3 months, never Sunday', () => {
  ok(!B.isBookable(new Date(2026, 9, 1), TODAY), 'today is not bookable');
  ok(B.isBookable(new Date(2026, 9, 2), TODAY), 'tomorrow (Fri) is bookable');
  ok(!B.isBookable(new Date(2026, 9, 4), TODAY), 'Sunday 4 Oct is not bookable');
  ok(B.isBookable(new Date(2027, 0, 1), TODAY), '1 Jan 2027 (Fri, exactly +3 months) is bookable');
  ok(!B.isBookable(new Date(2027, 0, 2), TODAY), '2 Jan 2027 is past the window');
});

test('monthCells: Monday-first with leading blanks', () => {
  const cells = B.monthCells(2026, 9, TODAY, '2026-10-02');
  eq(cells.length, 3 + 31, 'Oct 2026 starts Thursday → 3 blanks + 31 days');
  ok(cells[0].blank && cells[2].blank && !cells[3].blank, 'blanks first');
  eq(cells[3].day, 1); eq(cells[3].disabled, true, 'the 1st (today) disabled');
  eq(cells[4].key, '2026-10-02'); eq(cells[4].disabled, false); eq(cells[4].selected, true);
});

test('canShowMonth: current month to the window end only', () => {
  ok(!B.canShowMonth(2026, 8, TODAY), 'September 2026 is in the past');
  ok(B.canShowMonth(2026, 9, TODAY), 'October 2026');
  ok(B.canShowMonth(2027, 0, TODAY), 'January 2027 (holds 1 Jan)');
  ok(!B.canShowMonth(2027, 1, TODAY), 'February 2027 is past the window');
});

const FULL = { meeting: 'site', service: 'interior-design', property: 'House', budget: '₱1M – ₱3M',
  location: ' Quezon City ', details: ' Kitchen ', date: '2026-10-05', time: '10:30 AM',
  name: ' Juan Dela Cruz ', email: ' juan@example.com ', phone: ' 0917 000 0000 ' };

test('validateStep: step 1', () => {
  eq(B.validateStep(1, { ...FULL, meeting: '' }), 'Choose how you would like to meet.');
  eq(B.validateStep(1, { ...FULL, service: '' }), 'Select the service you need.');
  eq(B.validateStep(1, FULL), '');
});

test('validateStep: step 2 (details optional)', () => {
  eq(B.validateStep(2, { ...FULL, property: '' }), 'Select your property type.');
  eq(B.validateStep(2, { ...FULL, budget: '' }), 'Select an estimated budget.');
  eq(B.validateStep(2, { ...FULL, location: '   ' }), 'Tell us where the property is.');
  eq(B.validateStep(2, { ...FULL, details: '' }), '');
});

test('validateStep: step 3', () => {
  eq(B.validateStep(3, { ...FULL, date: '' }), 'Pick a preferred date.');
  eq(B.validateStep(3, { ...FULL, time: '' }), 'Pick a preferred time.');
  eq(B.validateStep(3, FULL), '');
});

test('validateStep: step 4', () => {
  eq(B.validateStep(4, { ...FULL, phone: ' ' }), 'Please complete all required fields.');
  eq(B.validateStep(4, { ...FULL, email: 'juan@example' }), 'Please enter a valid email address.');
  eq(B.validateStep(4, FULL), '');
});

test('buildRow: exactly the spec columns, trimmed, status pending', () => {
  const row = B.buildRow('7f3a2c1d-0000-4000-8000-000000000000', FULL);
  eq(Object.keys(row).sort(), ['budget', 'contact', 'email', 'fullname', 'id', 'location', 'meeting_type',
    'message', 'preferred_date', 'preferred_time', 'property_type', 'service', 'status'].sort());
  eq(row.fullname, 'Juan Dela Cruz'); eq(row.email, 'juan@example.com'); eq(row.contact, '0917 000 0000');
  eq(row.location, 'Quezon City'); eq(row.message, 'Kitchen');
  eq(row.meeting_type, 'site'); eq(row.preferred_date, '2026-10-05'); eq(row.status, 'pending');
});

test('refCode: DACS- + first 6 hex of the id, upper case', () => {
  eq(B.refCode('7f3a2c1d-0000-4000-8000-000000000000'), 'DACS-7F3A2C');
});

test('meetingLabel and formatPreferred', () => {
  eq(B.meetingLabel('online'), 'Online call');
  eq(B.meetingLabel('unknown'), 'unknown');
  eq(B.formatPreferred('2026-10-05', '10:30 AM'), 'Mon, Oct 5 · 10:30 AM');
  eq(B.formatPreferred('2026-10-05', ''), 'Mon, Oct 5');
  eq(B.formatPreferred('', ''), '');
});

test('summaryRows: six labelled rows', () => {
  eq(B.summaryRows(FULL, 'Interior Design').map((r) => r[0]),
    ['Meeting', 'Service', 'Property', 'Budget', 'Location', 'Schedule']);
  eq(B.summaryRows(FULL, 'Interior Design')[5][1], 'Mon, Oct 5 · 10:30 AM');
});

console.log('\nII. Migration 0084');

// SQL with -- comments removed, so a comment can't satisfy a check.
function sqlCode(sql) { return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n'); }

test('0084 adds the six optional booking columns', () => {
  const sql = sqlCode(read('supabase/migrations/0084_appointments_booking_details.sql')).toLowerCase();
  [['meeting_type', 'text'], ['property_type', 'text'], ['budget', 'text'], ['location', 'text'],
   ['preferred_date', 'date'], ['preferred_time', 'text']].forEach(([col, type]) => {
    ok(new RegExp('add column if not exists\\s+' + col + '\\s+' + type + '\\b').test(sql), col + ' ' + type);
  });
  ok(!/not null/.test(sql), 'columns must stay nullable (old rows, old form)');
});

test('0084 drops appt_read and grants nothing new to the public', () => {
  const sql = sqlCode(read('supabase/migrations/0084_appointments_booking_details.sql')).toLowerCase();
  ok(/drop policy if exists appt_read on appointments/.test(sql), 'appt_read dropped');
  ok(!/create policy/.test(sql), 'no new policy');
  ok(!/\bgrant\b/.test(sql), 'no grants');
});

console.log('\nIII. Admin');

const ADMIN = read('js/admin.js');
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('SLICE NOT FOUND: ' + name);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

test('formatService labels every v2 service id and keeps the old ones', () => {
  const formatService = new Function(sliceFn(ADMIN, 'formatService') + '\nreturn formatService;')();
  const v2 = ['vertical-construction', 'interior-design', 'architectural-design', 'engineering-design',
    'interior-renovation', 'residential-construction', 'ground-up-construction', 'commercial-renovation',
    'allied-services', 'consultation'];
  const old = ['building-interiors', 'interior-construction', 'structural-inspection',
    'electrical-engineering', 'cad-operations'];
  v2.concat(old).forEach((id) => ok(formatService(id) !== id, 'no label for ' + id));
  eq(formatService('vertical-construction'), 'Vertical Construction');
  eq(formatService('allied-services'), 'Collaborations & Allied Services');
});

test('details modal hides Budget from staff', () => {
  const fn = sliceFn(ADMIN, 'showAppointmentDetails');
  ok(/currentUserRole\s*===\s*'staff'\s*\?\s*''\s*:\s*_apptOpt\('Budget'/.test(fn),
    "Budget row must be gated by currentUserRole === 'staff'");
});

test('both appointment tables render through one row helper', () => {
  ok(/function _apptRowHtml\(/.test(ADMIN), '_apptRowHtml exists');
  ok(/map\(_apptRowHtml\)/.test(sliceFn(ADMIN, 'displayAllAppointments')), 'displayAllAppointments uses it');
  ok(/map\(_apptRowHtml\)/.test(sliceFn(ADMIN, 'filterAppointments')), 'filterAppointments uses it');
  ok(!/colspan="7"/.test(ADMIN.slice(ADMIN.indexOf('function displayAllAppointments'),
    ADMIN.indexOf('function updateStatus'))), 'empty-state colspan updated to 8');
});

test('admin.html: Preferred column and booking.js loaded before admin.js', () => {
  const html = read('admin.html');
  ok(/<th>Service<\/th><th>Preferred<\/th><th>Status<\/th>/.test(html), 'Preferred header after Service');
  const b = html.indexOf('src="js/booking.js'), a = html.indexOf('src="js/admin.js');
  ok(b > 0 && b < a, 'js/booking.js must load before js/admin.js');
});

console.log('\nIV. Router');

const SITE = require('../js/script.js');

test('resolveRoute maps hashes to the four pages', () => {
  eq(SITE.PAGES, ['home', 'services', 'projects', 'book']);
  eq(SITE.resolveRoute(''), 'home');
  eq(SITE.resolveRoute('#'), 'home');
  eq(SITE.resolveRoute('#/services'), 'services');
  eq(SITE.resolveRoute('#/projects'), 'projects');
  eq(SITE.resolveRoute('#/book'), 'book');
  eq(SITE.resolveRoute('#appointment'), 'book', 'old bookmark');
  eq(SITE.resolveRoute('#services'), 'services', 'old section anchor');
  eq(SITE.resolveRoute('#/studio'), 'home', 'Studio was removed');
  eq(SITE.resolveRoute('#about'), 'home');
});

test('img maps design keys to the portfolio files', () => {
  eq(SITE.img('p4'), 'assets/images/portfolio/DaCs_AIRBNB%20PROFILE.pdf%20(4).png');
});

console.log('\nV. Fences: public saves never read back');

function jsCode(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n'); }

test('booking.js inserts appointments with sb and never reads back', () => {
  const src = jsCode(read('js/booking.js'));
  ok(/sb\.from\('appointments'\)\.insert\(/.test(src), "uses sb.from('appointments').insert(");
  ok(!/\.select\(/.test(src), 'no .select( anywhere in booking.js');
  ok(!/collection\('appointments'\)/.test(src), "no db.collection('appointments')");
  ok(/_dacsReportError\(/.test(src), 'failures are reported to client_errors');
  ok(/dacsStartBooking/.test(src), 'exposes dacsStartBooking for "Book this service"');
});

test('site-widgets.js: feedback is a plain pending insert', () => {
  const src = jsCode(read('js/site-widgets.js'));
  ok(/sb\.from\('testimonials'\)\.insert\(/.test(src), 'plain insert');
  ok(!/collection\('testimonials'\)\.add\(/.test(src), 'no .add() read-back');
  ok(/status:\s*'pending'/.test(src), "status 'pending'");
  ok(!/status:\s*[^,\n]*'approved'/.test(src), 'never inserts approved (RLS testi_create)');
});

test('index.html has no Studio page and loads the scripts in order', () => {
  const html = read('index.html');
  ok(!/data-page="studio"/.test(html) && !/#\/studio/.test(html), 'no Studio');
  const order = ['js/supabase-config.js', 'js/script.js', 'js/booking.js', 'js/site-widgets.js'].map((s) => html.indexOf('src="' + s));
  ok(order.every((v) => v > 0), 'all four scripts present');
  ok(order.every((v, i) => i === 0 || v > order[i - 1]), 'supabase-config → script → booking → site-widgets');
  ok(/id="bookWizard"/.test(html), 'wizard mount present');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
