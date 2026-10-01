# Public Website v2 Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `index.html` with the v2 design (Home / Services / Projects / Book, no Studio) and a 4-step booking wizard whose answers land in new `appointments` columns shown in admin.

**Architecture:** One static page, no build step. `index.html` holds four `<section class="page">` blocks; `js/script.js` shows one at a time from the URL hash (`#/home`, `#/services`, `#/projects`, `#/book`). `js/booking.js` owns the wizard: pure helpers at the top (exported for Node tests and reused by admin), DOM code below. `js/site-widgets.js` keeps the global widgets (testimonials, feedback modal, draggable floating buttons) moved from today's `script.js`.

**Tech Stack:** Plain HTML/CSS, vanilla JS (classic scripts, no modules), Supabase JS v2 from CDN (`sb` client + Firestore-compat shim `db` from `js/supabase-config.js`), zero-dependency Node tests (`node tests/x.test.js`).

**Spec:** [`docs/superpowers/specs/2026-10-01-index-v2-redesign-design.md`](../specs/2026-10-01-index-v2-redesign-design.md) — read it first.
**Design reference:** [`docs/design/dacs-website-v2.dc.html`](../../design/dacs-website-v2.dc.html) — a prototype to port. Line numbers below refer to this file.

## Global Constraints

- **Never run `npm run build`.** Never run `git commit` / `git push` — the owner commits manually. Every task ends with a **checkpoint**: list the changed files and stop for review.
- Public saves use `sb.from(table).insert(row)` with **no `.select()`** and never `db.collection(...).add()` (RLS forbids the read-back; this broke the live site until 2026-10-01).
- Feedback is always inserted with `status: 'pending'`.
- Save failures call `_dacsReportError('error', '<what> failed: ' + msg, '<file>', 0, 0, stack)` (global from `js/supabase-config.js`).
- Dates: build `YYYY-MM-DD` from local parts (`getFullYear/getMonth/getDate`); never `toISOString().slice(0,10)` (PH is UTC+8).
- Studio page and its content (founder story, team, values/mission/vision) are **not** ported. No photo upload.
- Stats read **9 Services Offered** (owner decision).
- Staff (`currentUserRole === 'staff'`) never see the Budget field in admin.
- Colours (CSS tokens on `:root`): `--green #1A5C3A`, `--green-dark #134428`, `--ink #1C1C1E`, `--night #0F1311`, `--cream #F5F3EE`, `--mint #80EF80`, `--sage #C9D3CC`, `--line #E5E5E5`, `--sand #DEDAD0`, `--muted #6C6C70`, `--error #B42318`. Fonts: Barlow (body), Playfair Display (headings).
- Phone: `+63 992 459 4334` (`tel:+639924594334`). Email: `dacsdesignservices@gmail.com`. Messenger: `https://m.me/61557923249219`. Facebook: `https://www.facebook.com/profile.php?id=61557923249219`.
- Must work at 360 px wide with no horizontal scroll. Respect `prefers-reduced-motion`.

## Porting rules (apply in Tasks 4–8)

The design file is markup with inline styles and `{{ }}` bindings. Convert it like this:

| Design | Port to |
|---|---|
| `style="…"` | A class in `css/styles.css` with the same values (keep exact colours, `clamp()` sizes, radii, spacing). Prefix classes by section: `hdr-`, `hero-`, `stats-`, `intro-`, `feat-`, `ba-`, `car-`, `proc-`, `testi-`, `faq-`, `cta-`, `svc-`, `area-`, `prj-`, `case-`, `bk-`, `ftr-`, `fb-` |
| `style-hover="…"` / `style-focus="…"` | `.class:hover {…}` / `.class:focus {…}` |
| Colour bindings like `{{ n.fg }}`, `{{ o.bd }}` that switch on a selected/active state | An `.is-on` (selected) or `.is-active` (current) modifier class |
| `<sc-if value="{{ isHome }}">…</sc-if>` page blocks | `<section class="page" data-page="home" hidden>…</section>` |
| `<sc-for list="{{ x }}">` | An empty container with an `id`, filled by JS from the data constants |
| `onClick="{{ go.book }}"` etc. | `<a href="#/book">` (router handles it) |
| `data-reveal`, `data-delay`, `data-count`, `data-suffix`, `data-parallax`, `data-magnetic` | Keep the attributes as-is; `js/script.js` implements them (Task 4) |
| `IMG('pN')` / `assets/pN.png` | `img('pN')` → `assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (N).png` |
| `assets/logo.png` | `assets/images/DACS-TRANSPARENT.png` |
| Interactive `<span>`/`<div>` | A real `<button type="button">` or `<a>` with a visible `:focus-visible` ring (`outline: 2px solid var(--mint); outline-offset: 2px`) |

Images below the fold get `loading="lazy"`; the first hero image is eager.

## File map

| File | Status | Responsibility |
|---|---|---|
| `js/booking.js` | Create | Wizard helpers (pure, exported) + wizard DOM + submit |
| `tests/booking.test.js` | Create | Helpers, migration, admin, router, source fences |
| `package.json` | Modify | Add `node tests/booking.test.js` to `npm test` |
| `supabase/migrations/0084_appointments_booking_details.sql` | Create | 6 columns, drop `appt_read` |
| `js/admin.js` | Modify | `formatService`, shared row helper, details rows, staff budget hiding |
| `admin.html` | Modify | "Preferred" column, load `js/booking.js`, bump `admin.js` cache version |
| `index.html` | Rewrite | Header, 4 pages, CTA band, footer, case overlay, feedback modal, floating buttons |
| `css/styles.css` | Rewrite | All site styles |
| `js/script.js` | Rewrite | Data constants, router, header/menu/curtain, effects, Home/Services/Projects behaviour |
| `js/site-widgets.js` | Create | Testimonials loader, feedback modal + submit, `makeDraggable` (moved from today's `script.js`) |
| `docs/DATABASE_SCHEMA.md` | Modify | Appointment fields |

---

### Task 1: Booking helpers (pure logic) + test harness

**Files:**
- Create: `js/booking.js` (helpers section only — DOM code comes in Task 8)
- Create: `tests/booking.test.js`
- Modify: `package.json` (the `"test"` script)

**Interfaces:**
- Produces (exported via `module.exports` in Node, `window.DacsBooking` in the browser):
  - `MEETINGS: {id,label,sub}[]`, `PROPERTIES: string[]`, `BUDGETS: string[]`, `LOCS: string[]`, `TIMES: string[]`, `STEP_TITLES: string[]`, `EMPTY: object`
  - `dateKey(d: Date) → 'YYYY-MM-DD'`, `parseDateKey(k: string) → Date`
  - `isBookable(d: Date, today: Date) → boolean`
  - `monthCells(y: number, m: number, today: Date, selectedKey: string) → ({blank:true} | {day,key,disabled,selected})[]`
  - `canShowMonth(y: number, m: number, today: Date) → boolean`
  - `validateStep(step: 1|2|3|4, b: object) → '' | message`
  - `buildRow(id: string, b: object) → row`
  - `refCode(id: string) → 'DACS-XXXXXX'`
  - `meetingLabel(id: string) → string`
  - `formatPreferred(key: string, time: string) → 'Mon, Oct 5 · 10:30 AM'`
  - `summaryRows(b: object, serviceLabel: string) → [label, value][]`

- [ ] **Step 1: Write the failing test**

Create `tests/booking.test.js`:

```js
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
  return fs.readFileSync(p, 'utf8');
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

// Sections II–V are added by later tasks.

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/booking.test.js`
Expected: crash with `Cannot find module '../js/booking.js'`.

- [ ] **Step 3: Write the helpers**

Create `js/booking.js`:

```js
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

  // ── DOM wizard (Task 8) goes here ──

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DacsBooking = api;
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/booking.test.js`
Expected: `13 passed, 0 failed`.

- [ ] **Step 5: Register in `npm test`**

In `package.json`, append ` && node tests/booking.test.js` to the end of the `"test"` script string.
Run: `npm test` → every suite passes; the last block prints `13 passed, 0 failed`.

- [ ] **Step 6: Checkpoint** — changed: `js/booking.js`, `tests/booking.test.js`, `package.json`. Stop for review.

---

### Task 2: Migration 0084 (columns + tighter read rule)

**Files:**
- Create: `supabase/migrations/0084_appointments_booking_details.sql`
- Modify: `tests/booking.test.js` (add section II)

**Interfaces:**
- Produces: columns `meeting_type text`, `property_type text`, `budget text`, `location text`, `preferred_date date`, `preferred_time text` on `appointments`. The shim reads them as `meetingType`, `propertyType`, `budget`, `location`, `preferredDate` (`'YYYY-MM-DD'` string), `preferredTime`.

- [ ] **Step 1: Write the failing test**

In `tests/booking.test.js`, replace the line `// Sections II–V are added by later tasks.` with:

```js
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

// Sections III–V are added by later tasks.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/booking.test.js`
Expected: the two section II tests FAIL with `missing file: supabase/migrations/0084_appointments_booking_details.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0084_appointments_booking_details.sql`:

```sql
-- 0084 — Booking wizard details on appointments (public website v2).
--
-- The new #/book wizard asks for meeting type, property, budget, location and a
-- preferred date/time. All nullable: rows from the old 5-field form, and any old
-- cached page still posting those five fields, keep working.
--
-- preferred_date is a plain DATE built from the visitor's local calendar day
-- (never toISOString — PH is UTC+8). It is a *preferred* slot, not a confirmed
-- booking.

alter table appointments
  add column if not exists meeting_type   text,
  add column if not exists property_type  text,
  add column if not exists budget         text,
  add column if not exists location       text,
  add column if not exists preferred_date date,
  add column if not exists preferred_time text;

-- appt_read let ANY signed-in account (clients, partners, workers) read every
-- visitor's name, email, phone — and now budget. Owner + staff keep full access
-- through appt_admin; the public keeps insert through appt_create.
drop policy if exists appt_read on appointments;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/booking.test.js` → `15 passed, 0 failed`.

- [ ] **Step 5: Apply to production — ask the owner first**

This changes the live database. Ask the owner whether to apply it now (via the Supabase MCP `apply_migration` with name `appointments_booking_details`, project `hqbgduyonlbbsvjuapre`) or whether they will apply it themselves. Do not apply without a yes.

- [ ] **Step 6: Verify the live database (always — "applied" has not matched the live DB twice before)**

Run on project `hqbgduyonlbbsvjuapre`:

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'appointments'
  and column_name in ('meeting_type','property_type','budget','location','preferred_date','preferred_time')
order by column_name;
select policyname from pg_policies where tablename = 'appointments' order by policyname;
```

Expected: 6 rows (`preferred_date` is `date`, the rest `text`); policies exactly `appt_admin`, `appt_create`.

Then prove a logged-out visitor can still insert the new shape (rolled back, leaves nothing):

```sql
begin;
set local role anon;
insert into appointments (id, fullname, email, contact, service, message, meeting_type, property_type,
  budget, location, preferred_date, preferred_time, status)
values (gen_random_uuid(), 'RLS probe', 'probe@example.com', '0', 'interior-design', '', 'site', 'House',
  'Not sure yet', 'Quezon City', '2026-10-05', '10:30 AM', 'pending');
rollback;
select count(*) from appointments where fullname = 'RLS probe';
```

Expected: no error; final count `0`.

- [ ] **Step 7: Checkpoint** — changed: the migration, `tests/booking.test.js`. Report the verification output. Stop for review.

---

### Task 3: Admin Appointments shows the booking details

**Files:**
- Modify: `js/admin.js` — `formatService` (~line 1977), `displayAllAppointments` (~924), `filterAppointments` (~961), `showAppointmentDetails` (~1076)
- Modify: `admin.html` — appointments table header (~line 384), script tags (~5375–5380)
- Modify: `tests/booking.test.js` (add section III)

**Interfaces:**
- Consumes: `window.DacsBooking.refCode`, `.meetingLabel`, `.formatPreferred` (Task 1); shim fields `meetingType`, `propertyType`, `budget`, `location`, `preferredDate`, `preferredTime` (Task 2).
- Produces: `_apptRowHtml(appointment) → string` (one `<tr>`), used by both table renderers.

- [ ] **Step 1: Write the failing test**

In `tests/booking.test.js`, replace `// Sections III–V are added by later tasks.` with:

```js
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

// Sections IV–V are added by later tasks.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/booking.test.js`
Expected: section III — 4 FAIL (missing labels, no `_apptOpt`, no `_apptRowHtml`, no Preferred header).

- [ ] **Step 3: Update `formatService`**

Replace the `services` object inside `formatService` in `js/admin.js` with:

```js
    const services = {
        // Public website v2 (2026-10-01)
        'vertical-construction': 'Vertical Construction',
        'interior-design': 'Interior Design',
        'architectural-design': 'Architectural Design',
        'engineering-design': 'Engineering Design',
        'interior-renovation': 'Interior Renovation',
        'residential-construction': 'Residential Construction',
        'ground-up-construction': 'Ground-Up Construction',
        'commercial-renovation': 'Commercial Renovation',
        'allied-services': 'Collaborations & Allied Services',
        'consultation': 'General Consultation',
        // Old form — kept so past appointments still read correctly
        'building-interiors': 'Building Architectural Interiors',
        'interior-construction': 'Architectural Interior Construction',
        'structural-inspection': 'Structural Inspection',
        'electrical-engineering': 'Electrical Engineering Services',
        'cad-operations': 'CAD & Operations'
    };
```

- [ ] **Step 4: One shared row helper + Preferred column**

Add above `function displayAllAppointments()`:

```js
// Preferred date/time from the v2 booking wizard; '—' for old-form rows.
function _apptPreferred(a) {
    if (!a.preferredDate && !a.preferredTime) return '—';
    return window.DacsBooking ? DacsBooking.formatPreferred(a.preferredDate, a.preferredTime)
                              : [a.preferredDate, a.preferredTime].filter(Boolean).join(' · ');
}

// One <tr> — shared by displayAllAppointments and filterAppointments.
function _apptRowHtml(appointment) {
    const date = appointment.createdAt?.toDate();
    const dateStr = date ? date.toLocaleDateString() : 'N/A';
    const isPending = appointment.status === 'pending';
    return `
        <tr onclick="showAppointmentDetails('${_admEsc(appointment.id)}')">
            <td>${dateStr}</td>
            <td>${_admEsc(appointment.fullname)}</td>
            <td>${_admEsc(appointment.email)}</td>
            <td>${_admEsc(appointment.contact)}</td>
            <td>${_admEsc(formatService(appointment.service))}</td>
            <td>${_admEsc(_apptPreferred(appointment))}</td>
            <td><span class="status-badge status-${_admEsc(appointment.status)}">${_admEsc(appointment.status)}</span></td>
            <td style="position:relative;">
                ${isPending ? '<span style="position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:#ef4444;pointer-events:none;"></span>' : ''}
                <select onchange="updateStatus('${_admEsc(appointment.id)}', this.value)" onclick="event.stopPropagation()">
                    <option value="">Update Status</option>
                    <option value="pending" ${isPending ? 'selected' : ''}>Pending</option>
                    <option value="confirmed" ${appointment.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                    <option value="completed" ${appointment.status === 'completed' ? 'selected' : ''}>Completed</option>
                    <option value="cancelled" ${appointment.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                </select>
            </td>
        </tr>
    `;
}
```

Replace the body of `displayAllAppointments` with:

```js
function displayAllAppointments() {
    const tbody = document.getElementById('appointmentsTableBody');
    if (appointments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">No appointments found.</td></tr>';
        return;
    }
    tbody.innerHTML = appointments.map(_apptRowHtml).join('');
}
```

Replace the body of `filterAppointments` with (also null-safe — old rows can lack a name):

```js
function filterAppointments() {
    const statusFilter = document.getElementById('statusFilter').value;
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    const filtered = appointments.filter(appointment => {
        const matchesStatus = statusFilter === 'all' || appointment.status === statusFilter;
        const matchesSearch =
            String(appointment.fullname || '').toLowerCase().includes(searchTerm) ||
            String(appointment.email || '').toLowerCase().includes(searchTerm);
        return matchesStatus && matchesSearch;
    });
    const tbody = document.getElementById('appointmentsTableBody');
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: var(--text-secondary);">No matching appointments found.</td></tr>';
        return;
    }
    tbody.innerHTML = filtered.map(_apptRowHtml).join('');
}
```

- [ ] **Step 5: Details modal rows**

Add above `function showAppointmentDetails`:

```js
// A details row only when the appointment has that value (old-form rows lack them).
function _apptOpt(label, value) {
    if (!value) return '';
    return `
        <div class="detail-row">
            <div class="detail-label">${label}</div>
            <div class="detail-value">${_admEsc(value)}</div>
        </div>`;
}
```

In `showAppointmentDetails`, directly after the closing `</div>` of the **Service Required** detail-row inside `detailsHTML`, insert:

```js
        ${_apptOpt('Reference', window.DacsBooking ? DacsBooking.refCode(currentAppointment.id) : '')}
        ${_apptOpt('Meeting Type', currentAppointment.meetingType
            ? (window.DacsBooking ? DacsBooking.meetingLabel(currentAppointment.meetingType) : currentAppointment.meetingType) : '')}
        ${_apptOpt('Property', currentAppointment.propertyType)}
        ${currentUserRole === 'staff' ? '' : _apptOpt('Budget', currentAppointment.budget)}
        ${_apptOpt('Location', currentAppointment.location)}
        ${_apptOpt('Preferred Schedule', (currentAppointment.preferredDate || currentAppointment.preferredTime) ? _apptPreferred(currentAppointment) : '')}
```

- [ ] **Step 6: `admin.html`**

1. Change the appointments table header row to:
   `<tr><th>Date</th><th>Name</th><th>Email</th><th>Contact</th><th>Service</th><th>Preferred</th><th>Status</th><th>Actions</th></tr>`
2. Directly before the `<script src="js/admin.js?v=…">` tag add `<script src="js/booking.js"></script>`.
3. Bump the admin cache-buster: `js/admin.js?v=20260805a` → `js/admin.js?v=20261001a`.

(`booking.js` attaches only `window.DacsBooking` and — from Task 8 — starts the wizard only when `#bookWizard` exists, so it is inert in admin.)

- [ ] **Step 7: Run tests**

Run: `node --check js/admin.js && node tests/booking.test.js && npm test`
Expected: syntax OK; `19 passed, 0 failed`; all suites green.

- [ ] **Step 8: Browser check** — `python -m http.server 5500` from the repo root, open `http://localhost:5500/admin.html`, log in as owner → Appointments: the table has a Preferred column (`—` for old rows), details of an old appointment look as before plus a Reference row. Stop the server.

- [ ] **Step 9: Checkpoint** — changed: `js/admin.js`, `admin.html`, `tests/booking.test.js`. Stop for review.

---

### Task 4: Site shell — page skeleton, router, header, effects, global widgets

**Files:**
- Rewrite: `index.html`, `css/styles.css`, `js/script.js`
- Create: `js/site-widgets.js`
- Modify: `tests/booking.test.js` (add section IV)

**Interfaces:**
- Consumes: `db`, `sb`, `_dacsReportError` (globals from `js/supabase-config.js`).
- Produces:
  - `js/script.js` → Node: `module.exports = { PAGES, resolveRoute, img, SERVICES, PROJECTS }`; browser: `window.DacsSite = { SERVICES, PROJECTS, navigate }`.
  - `resolveRoute(hash: string) → 'home'|'services'|'projects'|'book'`
  - `navigate(page: string)` — switches page with the curtain.
  - Event `document` → `CustomEvent('dacs:page', { detail: { page } })` after every switch.
  - `registerInit(fn)` — Tasks 5–7 add their page init functions through it; each runs once at start-up.
  - Effects scan: `refreshFx()` re-registers `[data-reveal]`/`[data-count]` inside newly rendered markup.

- [ ] **Step 1: Write the failing router test**

In `tests/booking.test.js`, replace `// Sections IV–V are added by later tasks.` with:

```js
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

// Section V is added by a later task.
```

Run: `node tests/booking.test.js` → section IV fails (`resolveRoute` / `img` / `PAGES` undefined — today's `script.js` touches `document` and crashes in Node, which is also a failure).

- [ ] **Step 2: Move the global widgets out of today's `script.js`**

Create `js/site-widgets.js`. Copy these **unchanged** from the current `js/script.js` (it contains the 2026-10-01 hotfix — keep it):
1. The `// Testimonials / Feedback` block: `let selectedRating`, `loadTestimonials()`, the feedback-button click handler, `closeFeedbackModal()`, the star-rating handlers, the feedback form `submit` handler (plain `sb.from('testimonials').insert`, status `'pending'`, `_dacsReportError` on failure), `showFeedbackMessage()`, and the "Load testimonials on page load" call.
2. `makeDraggable()` and its two calls at the end of the file.

Then make these edits in `js/site-widgets.js`:
- Put a header comment: `// Global widgets on every public page: approved testimonials, the feedback ★ modal (always inserts 'pending' — RLS testi_create), and the draggable Messenger / feedback buttons.`
- In `loadTestimonials`, render each card as:

```js
            return `
                <figure class="testi-card">
                    <div class="testi-stars" aria-label="${r} out of 5">${stars}</div>
                    <blockquote class="testi-text">${esc(data.message)}</blockquote>
                    <figcaption class="testi-author">
                        <span class="testi-avatar">${esc(initials)}</span>
                        <span><strong>${esc(data.name)}</strong><span>${esc(data.location)}</span></span>
                    </figcaption>
                </figure>
            `;
```

  and change both "No testimonials yet" messages to
  `'<p class="testi-empty">Be the first to share your experience — tap the ★ button to leave feedback.</p>'`.
- Change `makeDraggable(document.querySelector('.messenger-float-btn'), …)` to `makeDraggable(document.getElementById('messengerBtn'), 'dacs_messengerBtnPos');` (the feedback one stays `getElementById('feedbackBtn')`).

- [ ] **Step 3: Write the `index.html` skeleton**

Replace `index.html` with the structure below. Port the **header** from design lines 32–66 and the **mobile menu** from 68–86 inside the marked spots, using the Porting rules (nav = Home / Services / Projects; Client Portal link `client.html`; Book button `href="#/book"`; mobile menu items Home / Services / Projects / Book a Consultation with the `01`–`04` numbers). Port the **CTA band** from 706–719 and the **footer** from 723–761 (footer columns: Quick Links = Home / Services / Projects / Book; Services = Vertical Construction, Interior Design, Architectural Design, Engineering Design, all `href="#/services"`; contact column with phone, email, Facebook; copyright `© 2026 DAC's Building Design Services. All rights reserved.`). Port the **feedback modal** from 813–843 using today's element ids so `js/site-widgets.js` works unchanged: `feedbackModal` (class `modal`, shown with class `show`), `feedbackForm`, `feedbackName`, `feedbackLocation`, `starRating` with five `<span class="star" data-rating="1..5">&#9733;</span>`, hidden `feedbackRating`, `feedbackMessage`, `feedbackFormMessage`, close button `onclick="closeFeedbackModal()"`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DAC's Building Design Services</title>
    <meta name="description" content="Design & build in Quezon City — architectural, interior and engineering design, renovation and construction. Book a free consultation.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="hdr" id="hdr"><!-- port design 32–66 --></header>
    <div class="mmenu" id="mmenu" hidden><!-- port design 68–86 --></div>

    <div class="curtain" id="curtain" aria-hidden="true"><span>DAC'S</span></div>

    <main id="main">
        <section class="page" data-page="home" hidden><!-- Task 5 --></section>
        <section class="page" data-page="services" hidden><!-- Task 6 --></section>
        <section class="page" data-page="projects" hidden><!-- Task 7 --></section>
        <section class="page" data-page="book" hidden><!-- Task 8 --></section>

        <section class="cta" id="ctaBand"><!-- port design 706–719; button href="#/book" --></section>
    </main>

    <footer class="ftr"><!-- port design 723–761 --></footer>

    <div class="case" id="caseView" role="dialog" aria-modal="true" aria-labelledby="caseTitle" hidden><!-- Task 7 --></div>

    <div id="feedbackModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="feedbackModalTitle"><!-- port design 813–843 --></div>

    <a href="https://m.me/61557923249219" target="_blank" rel="noopener noreferrer" class="float-btn float-messenger" id="messengerBtn" title="Chat with us on Messenger" data-magnetic="1">
        <svg width="26" height="26" viewBox="0 0 36 36" fill="currentColor" aria-hidden="true"><path d="M18 2C9.163 2 2 8.710 2 17c0 4.556 2.013 8.641 5.218 11.487V33l4.868-2.676A17.232 17.232 0 0018 32c8.837 0 16-6.710 16-15S26.837 2 18 2zm1.662 20.188l-4.115-4.386-8.028 4.386 8.831-9.374 4.218 4.386 7.977-4.386-8.883 9.374z"/></svg>
    </a>
    <button type="button" class="float-btn float-feedback" id="feedbackBtn" title="Share your feedback" aria-label="Share your feedback">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </button>
    <button type="button" class="float-btn float-top" id="toTop" aria-label="Back to top">↑</button>

    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="js/supabase-config.js"></script>
    <script src="js/script.js"></script>
    <script src="js/booking.js"></script>
    <script src="js/site-widgets.js"></script>
</body>
</html>
```

- [ ] **Step 4: Base CSS**

Replace `css/styles.css`. Start with the tokens and base rules below, then add the ported classes for header, mobile menu, CTA band, footer, feedback modal and floating buttons.

```css
/* DAC's public site (index.html only) — v2, 2026-10-01. Ported from docs/design/dacs-website-v2.dc.html. */
:root {
  --green: #1A5C3A; --green-dark: #134428; --ink: #1C1C1E; --night: #0F1311; --cream: #F5F3EE;
  --mint: #80EF80; --sage: #C9D3CC; --line: #E5E5E5; --sand: #DEDAD0; --muted: #6C6C70; --error: #B42318;
  --serif: 'Playfair Display', Georgia, serif; --sans: 'Barlow', -apple-system, sans-serif;
  --ease: cubic-bezier(.2,.7,.2,1); --wrap: 1320px; --gutter: clamp(16px, 3vw, 32px);
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; font-family: var(--sans); color: var(--ink); background: var(--cream);
  -webkit-font-smoothing: antialiased; overflow-x: hidden; }
img { max-width: 100%; display: block; }
a { color: var(--green); text-decoration: none; }
a:hover { color: var(--green-dark); }
::selection { background: rgba(26,92,58,.22); }
input, select, textarea, button { font: inherit; }
:focus-visible { outline: 2px solid var(--mint); outline-offset: 2px; }
.wrap { max-width: var(--wrap); margin: 0 auto; padding: 0 var(--gutter); }
.skip-link { position: absolute; left: -9999px; top: 8px; z-index: 200; background: #fff; padding: 8px 12px; }
.skip-link:focus { left: 8px; }
.page[hidden], [hidden] { display: none !important; }

.curtain { position: fixed; inset: 0; z-index: 100; background: var(--green-dark); transform: scaleY(0);
  pointer-events: none; display: flex; align-items: center; justify-content: center; }
.curtain span { font-family: var(--serif); font-size: clamp(40px, 8vw, 96px); font-weight: 600; letter-spacing: 6px; color: #fff; }

.hdr { position: fixed; top: 0; left: 0; right: 0; z-index: 60; transition: background .4s ease, border-color .4s ease;
  background: rgba(15,19,17,.82); border-bottom: 1px solid rgba(255,255,255,.08);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
.hdr.is-clear { background: rgba(15,19,17,0); border-bottom-color: rgba(255,255,255,0); }

[data-reveal] { transition: opacity .9s var(--ease), transform .9s var(--ease); }
[data-reveal][data-rv="0"] { opacity: 0; transform: translateY(32px); }

@keyframes dacsBar { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes dacsCue { 0%,100% { transform: translateY(0); opacity: .4 } 50% { transform: translateY(8px); opacity: 1 } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
```

Below 1000 px: hide the desktop nav and Client Portal link, show the menu toggle (design `wide`/`narrow` = `min-width: 1000px`).

- [ ] **Step 5: Write `js/script.js` (shell)**

Replace `js/script.js`:

```js
// ════════════════════════════════════════════════════════════════════
// PUBLIC SITE (index.html) — v2, 2026-10-01.
// One page, four sections (#/home, #/services, #/projects, #/book); this file
// shows one at a time, runs the header / curtain / scroll effects, and the
// Home, Services and Projects behaviour. The booking wizard is js/booking.js;
// testimonials + feedback + floating buttons are js/site-widgets.js.
// Ported from docs/design/dacs-website-v2.dc.html (Studio page dropped).
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const PAGES = ['home', 'services', 'projects', 'book'];

  // Design key 'pN' → the portfolio export already in the repo.
  const img = (k) => encodeURI('assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (' + String(k).slice(1) + ').png');

  // ── Data (copied from the design, Task 5/6/7 fill these in) ──
  const SERVICES = [];
  const SCOPE = {};
  const PROJECTS = [];

  // '#/services' → 'services'; old '#appointment' bookmarks → 'book';
  // old '#services' anchors still work; anything else (incl. Studio) → 'home'.
  function resolveRoute(hash) {
    const h = String(hash || '').replace(/^#\/?/, '');
    if (h === 'appointment') return 'book';
    return PAGES.includes(h) ? h : 'home';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PAGES, resolveRoute, img, SERVICES, PROJECTS };
    return;
  }

  // ═════════════════════════ browser only ═════════════════════════
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  let page = null;
  const inits = [];
  function registerInit(fn) { inits.push(fn); }

  // ── Router ──
  function show(p) {
    page = p;
    $$('.page').forEach((s) => { s.hidden = s.dataset.page !== p; });
    $('#ctaBand').hidden = p === 'book';
    $$('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === p;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    closeMenu();
    root.scrollTo(0, 0);
    try { history.replaceState(null, '', '#/' + p); } catch (e) { /* file:// */ }
    document.title = (p === 'home' ? '' : ({ services: 'Services', projects: 'Projects', book: 'Book a Consultation' })[p] + ' · ') + "DAC's Building Design Services";
    document.dispatchEvent(new CustomEvent('dacs:page', { detail: { page: p } }));
    refreshFx(); fx();
  }

  function navigate(p) {
    p = PAGES.includes(p) ? p : 'home';
    if (p === page) { root.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); closeMenu(); return; }
    const c = $('#curtain');
    if (reduced || !c || !c.animate) return show(p);
    c.style.transformOrigin = 'bottom';
    const a = c.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
      { duration: 420, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' });
    a.onfinish = () => {
      show(p);
      c.style.transformOrigin = 'top';
      c.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }],
        { duration: 520, delay: 120, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' });
    };
  }

  function initRouter() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#/"]');
      if (!a) return;
      e.preventDefault();
      navigate(resolveRoute(a.getAttribute('href')));
    });
    root.addEventListener('hashchange', () => navigate(resolveRoute(location.hash)));
  }

  // ── Header + mobile menu ──
  function closeMenu() {
    const m = $('#mmenu'); if (!m || m.hidden) return;
    m.hidden = true; document.body.style.overflow = '';
    const t = $('#menuToggle'); if (t) t.setAttribute('aria-expanded', 'false');
  }
  function initHeader() {
    const t = $('#menuToggle');
    if (t) t.addEventListener('click', () => {
      const m = $('#mmenu'); const open = m.hidden;
      m.hidden = !open; document.body.style.overflow = open ? 'hidden' : '';
      t.setAttribute('aria-expanded', String(open));
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); document.dispatchEvent(new Event('dacs:escape')); } });
    $('#toTop').addEventListener('click', () => root.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));
  }

  // ── Effects: reveal, count-up, parallax, header state, timeline fill, magnetic ──
  let io = null;
  function revealEl(el) {
    if (el.hasAttribute('data-reveal')) el.setAttribute('data-rv', '1');
    [el].concat($$('[data-count]', el)).forEach((c) => {
      if (!c.hasAttribute('data-count') || c.getAttribute('data-cv') === '1') return;
      c.setAttribute('data-cv', '1');
      const to = +c.getAttribute('data-count'), suf = c.getAttribute('data-suffix') || '', t0 = performance.now();
      const tick = (t) => { const p = clamp((t - t0) / 1600, 0, 1);
        c.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suf; if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }
  function refreshFx() {
    if (reduced || !('IntersectionObserver' in root)) return;
    if (!io) io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { revealEl(e.target); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$('[data-reveal]:not([data-rv])').forEach((el) => {
      el.setAttribute('data-rv', '0');
      el.style.transitionDelay = (el.getAttribute('data-delay') || 0) + 'ms';
      io.observe(el);
    });
    $$('[data-count]:not([data-cv])').forEach((el) => {
      el.setAttribute('data-cv', '0');
      el.textContent = '0' + (el.getAttribute('data-suffix') || '');
      io.observe(el);
    });
  }
  function fx() {
    const y = root.scrollY, vh = root.innerHeight;
    $('#hdr').classList.toggle('is-clear', page === 'home' && y <= 40);
    $('#toTop').classList.toggle('is-on', y > vh);
    if (reduced) return;
    const hp = $('#heroParallax'); if (hp && page === 'home') hp.style.transform = 'translate3d(0,' + (y * 0.35) + 'px,0)';
    $$('.page:not([hidden]) [data-parallax]').forEach((el) => {
      const r = el.parentElement.getBoundingClientRect(), f = +el.getAttribute('data-parallax');
      el.style.transform = 'translate3d(0,' + ((r.top + r.height / 2 - vh / 2) * -f) + 'px,0)';
    });
    const tl = $('#procLine'), fill = $('#procFill');
    if (tl && fill && page === 'home') {
      const r = tl.getBoundingClientRect(), p = clamp((vh * 0.6 - r.top) / (r.height - 16), 0, 1);
      fill.style.height = 'calc(' + (p * 100) + '% - ' + (p * 16) + 'px)';
      $$('[data-tl-node]', tl).forEach((n) => n.classList.toggle('is-on', n.getBoundingClientRect().top < vh * 0.6));
    }
  }
  function initFx() {
    let raf = null;
    root.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; fx(); }); }, { passive: true });
    root.addEventListener('resize', fx);
    if (reduced || !root.matchMedia('(hover: hover)').matches) return;
    let mag = null;
    root.addEventListener('mousemove', (e) => {
      const t = e.target.closest ? e.target.closest('[data-magnetic]') : null;
      if (mag && mag !== t) { mag.style.transform = ''; mag = null; }
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.transition = 'transform .25s var(--ease), background .2s, color .2s';
      t.style.transform = 'translate(' + (e.clientX - r.left - r.width / 2) * 0.22 + 'px,' + (e.clientY - r.top - r.height / 2) * 0.32 + 'px)';
      mag = t;
    });
  }

  // Shared before/after slider: el has --pos, role="slider"; returns set(pos).
  function beforeAfter(el) {
    const set = (pos) => { pos = clamp(pos, 2, 98); el.style.setProperty('--pos', pos + '%'); el.setAttribute('aria-valuenow', String(Math.round(pos))); };
    const at = (e) => { const r = el.getBoundingClientRect(); set((e.clientX - r.left) / r.width * 100); };
    let drag = false;
    el.addEventListener('pointerdown', (e) => { drag = true; try { el.setPointerCapture(e.pointerId); } catch (x) {} at(e); });
    el.addEventListener('pointermove', (e) => { if (drag) at(e); });
    ['pointerup', 'pointercancel'].forEach((t) => el.addEventListener(t, () => { drag = false; }));
    el.addEventListener('keydown', (e) => {
      const cur = parseFloat(el.getAttribute('aria-valuenow')) || 50;
      if (e.key === 'ArrowLeft') { set(cur - 5); e.preventDefault(); }
      if (e.key === 'ArrowRight') { set(cur + 5); e.preventDefault(); }
    });
    set(50);
    return set;
  }

  function initSite() {
    initRouter(); initHeader(); initFx();
    inits.forEach((fn) => fn());
    show(resolveRoute(location.hash));
  }

  root.DacsSite = { SERVICES, PROJECTS, navigate, registerInit, beforeAfter, refreshFx, esc, img, $, $$, clamp, reduced,
    get page() { return page; } };
  document.addEventListener('DOMContentLoaded', initSite);
})(typeof window !== 'undefined' ? window : this);
```

Header markup must provide: `id="menuToggle"` (button, `aria-controls="mmenu" aria-expanded="false"`, hidden ≥ 1000 px); nav links `<a href="#/home" data-nav="home">` etc. (desktop and mobile both carry `data-nav`); the Book button `<a href="#/book" data-nav="book" data-magnetic="1">`. Style `.is-active` like the design's active nav (white text, mint underline `transform: scaleX(1)`). `.float-top` is hidden until `.is-on`.

- [ ] **Step 6: Run tests**

Run: `node --check js/script.js && node --check js/site-widgets.js && node tests/booking.test.js`
Expected: syntax OK; section IV passes → `21 passed, 0 failed`.

- [ ] **Step 7: Browser check** — `python -m http.server 5500`, open `http://localhost:5500/index.html` (logged out / private window):
  - Header, footer, CTA band render; nav links switch between the four (still empty) pages with the curtain; URL shows `#/services` etc.
  - `index.html#appointment` opens `#/book`; `#/studio` opens Home.
  - Mobile width 375 px: toggle opens/closes the menu; Esc closes it; no horizontal scroll.
  - ★ button opens the feedback modal; Messenger and ★ buttons drag and remember position.
  - DevTools console: no errors.
  Stop the server.

- [ ] **Step 8: Checkpoint** — changed: `index.html`, `css/styles.css`, `js/script.js`, `js/site-widgets.js`, `tests/booking.test.js`. Stop for review.

---

### Task 5: Home page

**Files:**
- Modify: `index.html` (`data-page="home"` section), `css/styles.css`, `js/script.js`

**Interfaces:**
- Consumes: `registerInit`, `beforeAfter`, `img`, `esc`, `reduced`, `page` (Task 4); `loadTestimonials` fills `#testimonialsGrid` (Task 4, `site-widgets.js`).
- Produces: `PROJECTS` filled (Projects page reuses it in Task 7).

- [ ] **Step 1: Data**

In `js/script.js`, replace `const PROJECTS = [];` with the `PROJECTS` array copied **verbatim** from design lines 874–882, and add after it, verbatim from lines 883–885 and 893–900: `SLIDES`, `FEATURED`, `SPANS`, `FAQS`. In `SLIDES`, keep `k` as the design key (`'p2'`…); every image URL goes through `img(k)`.

- [ ] **Step 2: Markup**

Port design lines 94–270 into `<section class="page" data-page="home" hidden>`, in this order, with these ids for JS:
1. **Hero** (94–128): wrapper of slide images `id="heroParallax"` → inner `id="heroSlides"`; bars container `id="heroBars"`; `id="heroNum"`, `id="heroTitle"`, `id="heroLoc"`; buttons `id="heroPrev"`, `id="heroNext"`. CTAs: `<a href="#/book">Book a Free Consultation</a>`, `<a href="#/projects">Explore Our Projects</a>`, and a call link `tel:+639924594334`. Badge "Design · Build — Established 2026".
2. **Stats** (129–137): four items with `data-count` = `10` (+), `10` (+), `9`, `5` and labels Projects Completed / Years Combined Experience / Services Offered / Cities with completed projects.
3. **Intro** (138–156): heading "Your hard work deserves a home that lasts." and the copy; **delete** the "Meet the studio →" link.
4. **Featured projects carousel** (157–179): `id="carTrack"` (the scrolling element), "Start Your Project" → `#/book`.
5. **Before/After** (180–210): tabs `id="featTabs"`; slider `id="featBA"` with `role="slider" tabindex="0" aria-label="Before and after comparison" aria-valuemin="0" aria-valuemax="100"`, images `id="featBefore"` / `id="featAfter"`, labels `id="featBeforeLabel"` / `id="featAfterLabel"`; caption `id="featDesc"`; "See all projects →" → `#/projects`.
6. **How It Works** (211–243): timeline container `id="procLine"` with fill `id="procFill"`; each of the 3 nodes has `data-tl-node`; "Start Your Project Today" → `#/book`.
7. **Testimonials** (244–270): heading, then `<div id="testimonialsGrid" class="testi-grid"><p class="testi-empty">Loading testimonials…</p></div>` — **no** placeholder cards.
8. **FAQ** — port the design's FAQ block from lines 682–703 here (spec puts FAQ on Home): container `id="faqList"`.

Before/after CSS (also used by the case study in Task 7):

```css
.ba { position: relative; overflow: hidden; touch-action: pan-y; cursor: ew-resize; user-select: none; --pos: 50%; }
.ba img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.ba .ba-top { clip-path: inset(0 0 0 var(--pos)); }
.ba .ba-handle { position: absolute; top: 0; bottom: 0; left: var(--pos); width: 2px; background: #fff; transform: translateX(-1px); }
```

(`ba-top` is the **after** image; the bottom image is **before**.)

- [ ] **Step 3: Behaviour**

Add to `js/script.js` (browser part, above `initSite`):

```js
  // ── Home ──
  function initHero() {
    const wrap = $('#heroSlides'), bars = $('#heroBars'); if (!wrap) return;
    wrap.innerHTML = SLIDES.map((s, i) => '<img class="hero-img" src="' + img(s.k) + '" alt="' + esc(s.title) +
      '"' + (i ? ' loading="lazy"' : '') + '>').join('');
    bars.innerHTML = SLIDES.map((_, i) => '<button type="button" class="hero-bar" aria-label="Slide ' + (i + 1) +
      '"><span></span></button>').join('');
    const imgs = $$('.hero-img', wrap), btns = $$('.hero-bar', bars);
    let cur = 0, timer = null;
    function go(i) {
      cur = (i + SLIDES.length) % SLIDES.length;
      imgs.forEach((im, k) => im.classList.toggle('is-on', k === cur));
      btns.forEach((b, k) => {
        b.classList.toggle('is-done', k < cur);
        b.classList.remove('is-active'); if (k === cur) { void b.offsetWidth; b.classList.add('is-active'); }
      });
      $('#heroNum').textContent = String(cur + 1).padStart(2, '0');
      $('#heroTitle').textContent = SLIDES[cur].title;
      $('#heroLoc').textContent = SLIDES[cur].loc;
      start();
    }
    function start() {
      clearInterval(timer);
      if (reduced) return;
      timer = setInterval(() => { if (page === 'home' && $('#caseView').hidden) go(cur + 1); }, 6500);
    }
    btns.forEach((b, k) => b.addEventListener('click', () => go(k)));
    $('#heroPrev').addEventListener('click', () => go(cur - 1));
    $('#heroNext').addEventListener('click', () => go(cur + 1));
    go(0);
  }

  function initFeatured() {
    const tabs = $('#featTabs'), ba = $('#featBA'); if (!tabs || !ba) return;
    const set = beforeAfter(ba);
    function pick(i) {
      const p = PROJECTS[i];
      $('#featBefore').src = img(p.a[0]); $('#featBefore').alt = p.title + ' — ' + p.a[1];
      $('#featAfter').src = img(p.b[0]);  $('#featAfter').alt = p.title + ' — ' + p.b[1];
      $('#featBeforeLabel').textContent = p.a[1]; $('#featAfterLabel').textContent = p.b[1];
      $('#featDesc').textContent = p.b[2];
      $$('button', tabs).forEach((b) => { const on = +b.dataset.i === i; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      set(50);
    }
    tabs.innerHTML = FEATURED.map((i) => '<button type="button" class="feat-tab" data-i="' + i + '">' + esc(PROJECTS[i].title) + '</button>').join('');
    tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
    pick(FEATURED[0]);
  }

  function initCarousel() {
    const el = $('#carTrack'); if (!el) return;
    const one = [];
    PROJECTS.forEach((p) => [p.a, p.b].filter((v) => v[1] === 'Turnover' || v[1] === 'Detail')
      .forEach((v) => one.push({ title: p.title, src: img(v[0]) })));
    el.innerHTML = one.concat(one).map((c) => '<a href="#/projects" class="car-item" data-car-item>' +
      '<img src="' + c.src + '" alt="' + esc(c.title) + '" loading="lazy"><span class="car-cap">' + esc(c.title) +
      ' · Turnover</span></a>').join('');
    let paused = false, x = null, center = null;
    ['mouseenter', 'touchstart', 'focusin'].forEach((t) => el.addEventListener(t, () => { paused = true; }, { passive: true }));
    ['mouseleave', 'touchend', 'focusout'].forEach((t) => el.addEventListener(t, () => { paused = false; }));
    (function loop() {
      if (page === 'home') {
        if (!paused && !reduced && $('#caseView').hidden) {
          x = (x == null ? el.scrollLeft : x) + 0.6;
          const half = el.scrollWidth / 2; if (x >= half) x -= half;
          el.scrollLeft = x;
        } else x = el.scrollLeft;
        const vr = el.getBoundingClientRect(), cx = vr.left + vr.width / 2;
        let best = null, bd = Infinity;
        $$('[data-car-item]', el).forEach((it) => { const r = it.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - cx); if (d < bd) { bd = d; best = it; } });
        if (best !== center) { if (center) center.classList.remove('is-center'); if (best) best.classList.add('is-center'); center = best; }
      }
      requestAnimationFrame(loop);
    })();
  }

  function initFaq() {
    const list = $('#faqList'); if (!list) return;
    list.innerHTML = FAQS.map((q, i) => '<div class="faq-item' + (i === 0 ? ' is-open' : '') + '">' +
      '<button type="button" class="faq-q" aria-expanded="' + (i === 0) + '" aria-controls="faq-a' + i + '" id="faq-q' + i + '">' +
      '<span>' + esc(q[0]) + '</span><span class="faq-icon" aria-hidden="true">+</span></button>' +
      '<div class="faq-a" id="faq-a' + i + '" role="region" aria-labelledby="faq-q' + i + '"><div><p>' + esc(q[1]) + '</p></div></div></div>').join('');
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.faq-q'); if (!btn) return;
      const item = btn.parentElement, open = !item.classList.contains('is-open');
      $$('.faq-item', list).forEach((it) => { it.classList.remove('is-open'); $('.faq-q', it).setAttribute('aria-expanded', 'false'); });
      if (open) { item.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
    });
  }

  registerInit(initHero); registerInit(initFeatured); registerInit(initCarousel); registerInit(initFaq);
```

CSS for the dynamic states (values from the design): `.hero-img` absolute cover, `opacity: 0; transform: scale(1.08); transition: opacity 1.2s, transform 7s linear`, `.hero-img.is-on { opacity: 1; transform: scale(1) }`; `.hero-bar span` 2 px track `rgba(255,255,255,.25)` with `::after` white fill — `.is-done` full, `.is-active::after { animation: dacsBar 6.5s linear forwards; transform-origin: left }`; `.car-item { transform: scale(.94); opacity: .92; transition: transform .5s var(--ease), opacity .5s, box-shadow .5s }`, `.car-item.is-center { transform: scale(1.12); opacity: 1; box-shadow: 0 24px 54px rgba(0,0,0,.28); z-index: 2 }`; `.faq-a { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .35s var(--ease) } .faq-a > div { overflow: hidden }`, `.faq-item.is-open .faq-a { grid-template-rows: 1fr }`, `.faq-item.is-open .faq-icon { transform: rotate(45deg); background: var(--green); color: #fff }`; `[data-tl-node].is-on { background: var(--green); border-color: var(--mint); color: #fff }`.

- [ ] **Step 4: Run tests**

Run: `node --check js/script.js && node tests/booking.test.js` → `21 passed, 0 failed` (`require` still works — the Home code is in the browser-only part).

- [ ] **Step 5: Browser check** (`python -m http.server 5500`, private window, desktop then 375 px):
  - Hero cycles every 6.5 s with progress bars; prev/next and bar clicks work; parallax on scroll; header turns from clear to dark after 40 px.
  - Stats count up when scrolled into view; reveals fade in.
  - Featured tabs swap projects; the slider drags with mouse and touch and moves with ←/→ after Tab focus.
  - Carousel auto-scrolls and pauses on hover; centre card is enlarged.
  - Timeline fill grows while scrolling; nodes turn green.
  - Testimonials show approved reviews (or the empty line); FAQ opens one at a time.
  - DevTools → Rendering → emulate `prefers-reduced-motion: reduce`: no slideshow auto-advance, no carousel auto-scroll, no parallax, content visible immediately.
  - Console clean. Stop the server.

- [ ] **Step 6: Checkpoint** — changed: `index.html`, `css/styles.css`, `js/script.js`. Stop for review.

---

### Task 6: Services page

**Files:**
- Modify: `index.html` (`data-page="services"`), `css/styles.css`, `js/script.js`

**Interfaces:**
- Consumes: Task 4 helpers; `root.dacsStartBooking(serviceId)` (defined in Task 8 — guard with `typeof`).
- Produces: `SERVICES` (with `images`) and `SCOPE` filled — `js/booking.js` reads `DacsSite.SERVICES` for its service chips.

- [ ] **Step 1: Data**

Replace `const SERVICES = [];` and `const SCOPE = {};` with the arrays copied **verbatim** from design lines 852–862 and 863–873, and add `AREAS` verbatim from lines 886–892.

- [ ] **Step 2: Markup**

Port design lines 275–343 into `<section class="page" data-page="services" hidden>`:
1. Header (275–284): eyebrow, `<h1>Professional Design &amp; Build Services</h1>`, intro copy.
2. Sticky index (285–291): `<nav class="svc-index" id="svcIndex" aria-label="Services">` (sticky under the header: `top: 74px`).
3. Panels: `<div id="svcPanels"></div>` (rendered by JS).
4. Areas (324–343): list `id="areaList"`, `<iframe id="areaMap" title="Service area map" loading="lazy">`.

- [ ] **Step 3: Behaviour**

Add to `js/script.js`:

```js
  // ── Services ──
  const AREA_ZOOM = (i) => (AREAS[i].city === 'Iligan City' ? 12 : 13);

  function bookService(id) {
    if (typeof root.dacsStartBooking === 'function') root.dacsStartBooking(id);
    navigate('book');
  }

  function initServices() {
    const idx = $('#svcIndex'), wrap = $('#svcPanels'); if (!wrap) return;
    idx.innerHTML = SERVICES.map((s, i) => '<a href="#svc-' + s.id + '" class="svc-jump" data-jump="' + s.id + '"><span>' +
      String(i + 1).padStart(2, '0') + '</span>' + esc(s.title) + '</a>').join('');
    idx.addEventListener('click', (e) => {
      const a = e.target.closest('[data-jump]'); if (!a) return;
      e.preventDefault();
      const el = document.getElementById('svc-' + a.dataset.jump);
      if (el) root.scrollTo({ top: el.getBoundingClientRect().top + root.scrollY - 128, behavior: reduced ? 'auto' : 'smooth' });
    });

    wrap.innerHTML = SERVICES.map((x, i) => {
      const dark = x.dark != null ? x.dark : i % 2 === 1;
      const tone = dark ? 'is-dark' : (i % 4 === 2 ? 'is-cream' : 'is-light');
      const cat = x.category === 'Allied' ? 'Partner Trades' : (x.id === 'vertical-construction' ? 'Our Main Service' : x.category + ' Services');
      const num = String(i + 1).padStart(2, '0');
      return '<section class="svc-panel ' + tone + (dark ? ' is-flip' : '') + '" id="svc-' + x.id + '" aria-labelledby="svc-h-' + x.id + '">' +
        '<div class="svc-text">' +
          '<span class="svc-eyebrow" data-reveal>' + num + ' · ' + esc(cat) + '</span>' +
          '<h2 id="svc-h-' + x.id + '" data-reveal data-delay="80">' + esc(x.title) + '</h2>' +
          '<p data-reveal data-delay="140">' + esc(x.description) + '</p>' +
          '<ul class="svc-scope" data-reveal data-delay="200">' + (SCOPE[x.id] || x.features || []).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
          '<div data-reveal data-delay="260"><button type="button" class="svc-book" data-book="' + x.id + '" data-magnetic="1">Book this service →</button></div>' +
        '</div>' +
        '<div class="svc-media">' +
          '<div class="svc-layers" data-parallax="0.08">' + x.images.map((im, k) =>
            '<img src="' + img(im[0]) + '" alt="' + esc(im[1]) + '" loading="lazy" class="' + (k ? '' : 'is-on') + '">').join('') + '</div>' +
          '<div class="svc-thumbs-bar"><span class="svc-img-label">' + esc(x.images[0][1]) + '</span><div class="svc-thumbs">' +
            x.images.map((im, k) => '<button type="button" class="svc-thumb' + (k ? '' : ' is-on') + '" data-k="' + k + '" aria-label="' + esc(im[1]) + '">' +
              '<img src="' + img(im[0]) + '" alt="" loading="lazy"></button>').join('') +
          '</div></div>' +
        '</div></section>';
    }).join('');

    const pickImg = (btn) => {
      const panel = btn.closest('.svc-panel'), k = +btn.dataset.k;
      $$('.svc-layers img', panel).forEach((im, j) => im.classList.toggle('is-on', j === k));
      $$('.svc-thumb', panel).forEach((b, j) => b.classList.toggle('is-on', j === k));
      $('.svc-img-label', panel).textContent = $$('.svc-layers img', panel)[k].alt;
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-book]'); if (b) return bookService(b.dataset.book);
      const t = e.target.closest('.svc-thumb'); if (t) pickImg(t);
    });
    wrap.addEventListener('mouseover', (e) => { const t = e.target.closest('.svc-thumb'); if (t) pickImg(t); });

    const list = $('#areaList'), map = $('#areaMap');
    function pickArea(i) {
      $$('button', list).forEach((b) => { const on = +b.dataset.i === i; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      map.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(AREAS[i].q) + '&z=' + AREA_ZOOM(i) + '&output=embed';
    }
    list.innerHTML = AREAS.map((a, i) => '<button type="button" class="area-item" data-i="' + i + '">' +
      '<span class="area-dot"></span><span class="area-city">' + esc(a.city) + '</span><span class="area-region">' + esc(a.region) + '</span>' +
      '<span class="area-n">' + a.n + (a.n === 1 ? ' project' : ' projects') + '</span></button>').join('');
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pickArea(+b.dataset.i); });
    pickArea(0);
  }

  registerInit(initServices);
```

Panel CSS from design lines 293–322: `.is-dark` = `--night` bg / white text / `--sage` sub / mint accent; `.is-light` white; `.is-cream` `--cream`; on ≥ 1000 px `.is-flip` puts the image first (`order`). `.svc-layers img` absolute cover, `opacity: 0; transition: opacity .6s`, `.is-on { opacity: 1 }`. `.area-item.is-on` = `--cream` background, green dot.

- [ ] **Step 4: Run tests**

Run: `node --check js/script.js && node tests/booking.test.js` → `21 passed, 0 failed`.

- [ ] **Step 5: Browser check** (`#/services`, desktop + 375 px): 9 panels in v2 order (Vertical Construction first, Allied last and dark); index jumps scroll to each panel below the sticky bar; thumbnails swap the image on hover/click; area buttons move the map; "Book this service" opens `#/book` (pre-fill is checked in Task 8). Console clean.

- [ ] **Step 6: Checkpoint** — changed: `index.html`, `css/styles.css`, `js/script.js`. Stop for review.

---

### Task 7: Projects page + case study

**Files:**
- Modify: `index.html` (`data-page="projects"` and `#caseView`), `css/styles.css`, `js/script.js`

**Interfaces:**
- Consumes: `PROJECTS`, `SPANS` (Task 5), `beforeAfter`, `bookService` (Task 6).

- [ ] **Step 1: Markup**

1. Port lines 348–383 into `data-page="projects"`: header with `<h1>Featured Projects</h1>`, filter bar `id="prjFilters"`, grid `<div class="prj-grid" id="prjGrid">`.
2. Port lines 769–810 into `#caseView` with ids: close button `id="caseClose"` ("← All projects"), counter `id="caseNum"`, `id="casePrev"`, `id="caseNext"`, eyebrow `id="caseEyebrow"`, `<h2 id="caseTitle">`, facts `id="caseCity"`, `id="caseType"`, `id="caseScope"`; slider `id="caseBA"` (class `ba`, `role="slider" tabindex="0"`, bottom image `id="caseA"` = first image, top image `class="ba-top" id="caseB"` = second image, labels `id="caseALabel"`/`id="caseBLabel"`, handle); captions `id="caseADesc"`/`id="caseBDesc"`, each preceded by a `<span class="case-cap-label">` (first = before label, second = after label); CTA button `id="caseBook"` "Start a similar project →".

- [ ] **Step 2: Behaviour**

Add to `js/script.js`:

```js
  // ── Projects + case study ──
  const caseService = (p) => (p.type === 'Commercial' ? 'commercial-renovation'
    : (p.scope === 'Building' ? 'residential-construction' : 'interior-design'));

  function initProjects() {
    const grid = $('#prjGrid'), bar = $('#prjFilters'), cv = $('#caseView'); if (!grid) return;
    let filter = 'All', idx = -1, lastFocus = null;
    const setCase = beforeAfter($('#caseBA'));

    function renderGrid() {
      const wide = root.innerWidth >= 1000, small = root.innerWidth < 700;
      const vis = PROJECTS.map((p, i) => ({ p, i })).filter(({ p }) => filter === 'All' || p.type === filter);
      grid.innerHTML = vis.map(({ p, i }, k) => {
        const sp = wide ? SPANS[k % SPANS.length] : [small ? 12 : 6, small ? '4/3' : '4/3'];
        return '<button type="button" class="prj-card" data-i="' + i + '" style="grid-column:span ' + sp[0] + ';aspect-ratio:' + sp[1] + '">' +
          '<img src="' + img(p.b[0]) + '" alt="' + esc(p.title) + '" loading="lazy"><span class="prj-shade"></span>' +
          '<span class="prj-type">' + esc(p.type) + '</span>' +
          '<span class="prj-meta"><span><span class="prj-sub">' + esc(p.scope) + ' · ' + esc(p.city) + '</span>' +
          '<span class="prj-title">' + esc(p.title) + '</span></span><span class="prj-arrow" aria-hidden="true">↗</span></span></button>';
      }).join('');
    }
    function renderFilters() {
      const counts = { All: PROJECTS.length,
        Residential: PROJECTS.filter((p) => p.type === 'Residential').length,
        Commercial: PROJECTS.filter((p) => p.type === 'Commercial').length };
      bar.innerHTML = ['All', 'Residential', 'Commercial'].map((l) => '<button type="button" class="prj-filter' +
        (l === filter ? ' is-on' : '') + '" aria-pressed="' + (l === filter) + '" data-f="' + l + '">' + l + ' <span>' + counts[l] + '</span></button>').join('');
    }
    function openCase(i) {
      idx = (i + PROJECTS.length) % PROJECTS.length;
      const p = PROJECTS[idx];
      $('#caseNum').textContent = String(idx + 1).padStart(2, '0') + ' / ' + String(PROJECTS.length).padStart(2, '0');
      $('#caseEyebrow').textContent = p.type + ' · ' + p.scope;
      $('#caseTitle').textContent = p.title;
      $('#caseCity').textContent = p.city; $('#caseType').textContent = p.type; $('#caseScope').textContent = p.scope;
      $('#caseA').src = img(p.a[0]); $('#caseA').alt = p.title + ' — ' + p.a[1];
      $('#caseB').src = img(p.b[0]); $('#caseB').alt = p.title + ' — ' + p.b[1];
      $('#caseALabel').textContent = p.a[1]; $('#caseBLabel').textContent = p.b[1];
      $('#caseADesc').textContent = p.a[2]; $('#caseBDesc').textContent = p.b[2];
      $$('.case-cap-label').forEach((el, k) => { el.textContent = k ? p.b[1] : p.a[1]; });
      setCase(50);
      if (cv.hidden) { lastFocus = document.activeElement; cv.hidden = false; document.body.style.overflow = 'hidden'; cv.scrollTop = 0; $('#caseClose').focus(); }
    }
    function closeCase() {
      if (cv.hidden) return;
      cv.hidden = true; document.body.style.overflow = ''; idx = -1;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; renderFilters(); renderGrid(); });
    grid.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) openCase(+b.dataset.i); });
    $('#caseClose').addEventListener('click', closeCase);
    $('#casePrev').addEventListener('click', () => openCase(idx - 1));
    $('#caseNext').addEventListener('click', () => openCase(idx + 1));
    $('#caseBook').addEventListener('click', () => { const p = PROJECTS[idx]; closeCase(); bookService(caseService(p)); });
    document.addEventListener('dacs:escape', closeCase);
    document.addEventListener('dacs:page', closeCase);
    let rt = null;
    root.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderGrid, 150); });
    renderFilters(); renderGrid();
  }

  registerInit(initProjects);
```

`#caseView` CSS: `position: fixed; inset: 0; z-index: 80; overflow-y: auto; background: var(--night); color: #fff` (design 769). `.prj-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px }`; `.prj-card img` cover with `transition: transform .8s var(--ease)` and `.prj-card:hover img { transform: scale(1.07) }`. Filters on the dark header: `.prj-filter.is-on` white bg / `--night` text, otherwise transparent with `rgba(255,255,255,.25)` border.

- [ ] **Step 3: Run tests**

Run: `node --check js/script.js && node tests/booking.test.js` → `21 passed, 0 failed`.

- [ ] **Step 4: Browser check** (`#/projects`, desktop + 375 px): filters show 7 / 5 / 2 and filter the mosaic; cards open the case study; prev/next cycle through all 7; slider drags and responds to ←/→; Esc and "← All projects" close it and return focus to the card; switching page via the header closes it; "Start a similar project →" opens `#/book`. While a case study is open the Home slideshow doesn't advance. Console clean.

- [ ] **Step 5: Checkpoint** — changed: `index.html`, `css/styles.css`, `js/script.js`. Stop for review.

---

### Task 8: Booking wizard UI + submit

**Files:**
- Modify: `index.html` (`data-page="book"`), `css/styles.css`, `js/booking.js` (DOM section)
- Modify: `tests/booking.test.js` (add section V)

**Interfaces:**
- Consumes: Task 1 helpers; `window.DacsSite.SERVICES`; globals `sb`, `_dacsReportError`; event `dacs:page`.
- Produces: `window.dacsStartBooking(serviceId?: string)` — resets the wizard to step 1 with the service pre-selected (used by Tasks 6–7).

- [ ] **Step 1: Write the failing fence test**

In `tests/booking.test.js`, replace `// Section V is added by a later task.` with:

```js
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
```

Run: `node tests/booking.test.js` → section V: the first test and the `bookWizard` check FAIL.

- [ ] **Step 2: Markup**

Port design lines 470–681 into `data-page="book"` with these changes:
- Remove the "Photos or floor plans" block (lines ~547–571). In its place put:
  `<p class="bk-note">Have photos or plans? <a href="https://m.me/61557923249219" target="_blank" rel="noopener noreferrer">Send them to us on Messenger</a> after booking.</p>`
- Wrap the form card in `<div id="bookWizard">`. Ids:
  - progress: `id="bkStepNum"`, `id="bkStepTitle"`, bar fill `id="bkProgress"` (`role="progressbar" aria-valuemin="0" aria-valuemax="100"`)
  - panes: `id="bkS1"`…`id="bkS4"` (all `hidden` except via JS)
  - chip groups: `id="bkMeetings"`, `id="bkServices"`, `id="bkProperties"`, `id="bkBudgets"`, `id="bkLocChips"`, `id="bkTimes"`
  - inputs: `id="bkLocation"`, `id="bkDetails"`, `id="bkName"` (`autocomplete="name"`), `id="bkEmail"` (`autocomplete="email"`), `id="bkPhone"` (`autocomplete="tel"`); each `<label>` wraps its input as in the design
  - calendar: `id="bkCalTitle"`, `id="bkCalPrev"`, `id="bkCalNext"`, grid `id="bkCalGrid"` (`role="grid"`; the seven weekday headers are static markup Mon…Sun); `id="bkDateLong"`
  - error `id="bkError"` (`role="alert"`), buttons `id="bkBack"`, `id="bkNext"`
  - done pane `id="bkDone"` hidden: `id="bkRef"`, `id="bkThanks"`, `id="bkDoneMsg"`, `id="bkDoneSummary"`, Messenger link, `id="bkAnother"` "Book another"
  - aside summary list `id="bkSummary"`
- Under the heading/intro keep the design copy; the done text is set by JS (below).

CSS: `.chip` (pill, `--line` border, white) and `.chip.is-on` (green bg, white text); `.bk-meet.is-on` (green border, `#EEF5F0` bg, icon tile green); calendar cells `.bk-day` (`--cream` bg), `.bk-day.is-on` (green, white), `.bk-day:disabled` (transparent, `#C4C4C8`, `cursor: not-allowed`); input `.is-invalid` border `var(--error)`; values from design 470–681. On < 1000 px the aside stacks under the form.

- [ ] **Step 3: Wizard code**

In `js/booking.js`, replace `// ── DOM wizard (Task 8) goes here ──` with:

```js
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

    function render() {
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
        if (S.done) root.scrollTo({ top: $('bookWizard').getBoundingClientRect().top + root.scrollY - 100 });
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
      $('bkBack').addEventListener('click', () => { S.step--; S.error = ''; render(); });
      $('bkNext').addEventListener('click', next);
      $('bkAnother').addEventListener('click', () => start());
      render();
    }

    root.dacsStartBooking = start;
    document.addEventListener('DOMContentLoaded', init);
  }
```

Notes for the implementer:
- `sb` and `_dacsReportError` are top-level bindings of `js/supabase-config.js` (a `const` and a function declaration in a classic script), so they resolve as free identifiers here. They are **not** `window.sb`.
- Give `#bkStepTitle` `tabindex="-1"` so focus can move to it on each step change (screen-reader users hear the new step).
- The `.bk-flow` class goes on the wrapper of progress + panes + buttons inside `#bookWizard`; `#bkDone` is its sibling.

- [ ] **Step 4: Run tests**

Run: `node --check js/booking.js && node tests/booking.test.js && npm test`
Expected: `24 passed, 0 failed`; all suites green.

- [ ] **Step 5: Browser check — logged out (private window)**, `python -m http.server 5500`, desktop then 375 px:
  - Next with nothing chosen shows each step's message; Back keeps answers.
  - Calendar: today and Sundays disabled; can't go before this month or past +3 months; choosing a date fills "Preferred time" heading text.
  - Summary card fills live; location chips fill the input.
  - Services → "Book this service" on Engineering Design opens the wizard at step 1 with Engineering Design selected. Same from a case study.
  - Submit a real test booking with name **"TEST — delete me"**: success screen shows `DACS-XXXXXX`, the summary, and "This is a preferred schedule…".
  - In admin (owner): the row shows the same Reference, Meeting Type, Property, Budget, Location and Preferred Schedule; the table's Preferred column reads e.g. `Mon, Oct 5 · 10:30 AM` — **same calendar day as picked**.
  - Log in as a **staff** account: details show no Budget row.
  - Delete the test appointment in admin.
  - Offline test: DevTools → Network → Offline → submit → the sorry message shows, answers are kept, button re-enables.
  - Console clean. Stop the server.

- [ ] **Step 6: Checkpoint** — changed: `index.html`, `css/styles.css`, `js/booking.js`, `tests/booking.test.js`. Stop for review.

---

### Task 9: Schema doc + final verification

**Files:**
- Modify: `docs/DATABASE_SCHEMA.md` (the `appointments/{id}` entry, ~line 621)

- [ ] **Step 1: Update the schema doc**

Replace the `appointments/{id}` entry with:

```markdown
### `appointments/{id}` (public booking — `index.html` #/book, `js/booking.js`)
`fullname`, `email`, `contact`, `service`, `message`, `status` (`pending`), `createdAt`, `updatedAt`,
plus from the v2 booking wizard (migration 0084, all nullable — old rows lack them):
`meetingType` (`office` / `site` / `online`), `propertyType`, `budget` (a range label, e.g. `₱1M – ₱3M`;
**hidden from staff** in admin), `location`, `preferredDate` (`date`, the visitor's local calendar day),
`preferredTime` (e.g. `10:30 AM`). Preferred date/time is a request, not a confirmed booking.
The client's reference code is `DACS-` + the first 6 hex characters of `id` (`DacsBooking.refCode`).
**Rules:** anyone can insert (`appt_create`); only owner/staff can read or manage (`appt_admin`) —
`appt_read` (any signed-in account) was dropped in 0084. The public insert must **not** read the row
back (`insert().select()` / `db.collection().add()`): RLS then rejects the whole insert.
```

In the `testimonials/{id}` entry, change the status note to: `status` (always `pending` on public insert — an admin approves; RLS `testi_create` rejects anything else).

- [ ] **Step 2: Full verification**

Run: `npm test` → every suite passes, booking prints `24 passed, 0 failed`.
Run: `for f in js/script.js js/booking.js js/site-widgets.js js/admin.js; do node --check "$f" || echo "FAIL $f"; done` → no output.

- [ ] **Step 3: Final browser pass** (private window, `python -m http.server 5500`): click through all four pages at 1440 px, 768 px and 375 px — no horizontal scroll, no console errors, header Client Portal link opens `client.html`, footer links route correctly, `index.html#appointment` lands on the wizard.

- [ ] **Step 4: Checkpoint — hand-off to the owner**

Report: every changed file (`index.html`, `css/styles.css`, `js/script.js`, `js/site-widgets.js`, `js/booking.js`, `js/admin.js`, `admin.html`, `supabase/migrations/0084_appointments_booking_details.sql`, `tests/booking.test.js`, `package.json`, `docs/DATABASE_SCHEMA.md`), test output, and the rollout order from spec §10:
1. Migration 0084 applied and verified (Task 2) **before** the site goes live.
2. Deploy all files together.
3. On production: one real test booking (logged out) → check it in admin → delete it.

The owner commits and deploys.
