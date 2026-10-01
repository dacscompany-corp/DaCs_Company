# Public website (index.html) — v2 redesign

**Date:** 2026-10-01 · **Status:** design approved in chat, awaiting spec review
**Design source:** [`docs/design/dacs-website-v2.dc.html`](../../design/dacs-website-v2.dc.html)
(copied from `Downloads/DACS website redesign.zip`). It is a design-tool prototype
(`support.js` runtime, React-style templates) — **a visual and behavioural reference to port,
never code to ship.**

---

## 1. Goal

Replace the public marketing site (`index.html`) with the v2 design, **minus the Studio page**,
and replace the 5-field appointment form with v2's 4-step booking wizard, storing its answers
in real columns that the admin Appointments screen shows.

### Out of scope
- Studio page and all of its content (founder story, team grid, Values / Mission / Vision) —
  removed entirely, not moved elsewhere.
- About video, today's service pop-up and project pop-up modals (replaced by v2 pages).
- Photo / plan uploads in the wizard (replaced by a Messenger note; can be a later phase).
- Confirming a booking from admin, emails/SMS to the client, calendar availability checks.

## 2. Already shipped (hotfix, 2026-10-01)

The live forms were rejecting **every logged-out visitor** (last appointment: June 2026; last
testimonial: March 2026). Cause: `db.collection().add()` does `insert().select()`, and the
public has no SELECT on those rows, so RLS rejects the whole statement; feedback also sent
`status:'approved'` for 4–5★, which `testi_create` forbids.

Fixed in the current `js/script.js`: plain `sb.from(...).insert()` with no read-back, feedback
always `pending`, failures reported to `client_errors` via `_dacsReportError`. Verified with
anon-role inserts (rolled back). **The redesign must keep all three properties.**

## 3. Architecture

One page, no build step. `index.html` holds four sections; only one is visible at a time.

| Route | Section |
|---|---|
| `#/home` (also empty hash) | Home |
| `#/services` | Services |
| `#/projects` | Projects (case study opens as an overlay on this page) |
| `#/book` | Booking wizard |

- Page switches use the v2 green "DAC'S" curtain (skipped under `prefers-reduced-motion`),
  scroll to top, and `history.replaceState` the hash.
- **Legacy redirect:** `#appointment` → `#/book`; any other unknown hash → `#/home`.
  (Fixes the live `'#' is not a valid selector` errors in `client_errors`, 2026-09-10.)
- Header: Home / Services / Projects, **Client Portal** link (`client.html`), **Book** button.
  Transparent over the Home hero, dark glass once scrolled or on other pages. Mobile: full-screen
  menu with Book as the last item.
- Global, on every page: footer, floating **Messenger** button (`https://m.me/61557923249219`),
  **feedback ★ button** (draggable, position remembered — keep `makeDraggable`), scroll-to-top.

### Files

| File | Responsibility |
|---|---|
| `index.html` | Markup for header, 4 sections, footer, feedback modal, case-study overlay |
| `css/styles.css` | All site styles (index-only — no other page loads it) |
| `js/script.js` | Router, header/menu, reveal + count-up + parallax effects, hero slideshow, before/after sliders, carousel, services panels, areas map, projects filter + case study, FAQ accordion, testimonials load, feedback modal |
| `js/site-widgets.js` *(new)* | Testimonials loader, feedback modal + submit, draggable floating buttons — moved unchanged (with the hotfix) from today's `script.js` |
| `js/booking.js` *(new)* | Wizard state, per-step validation, calendar, summary card, payload build, submit, success screen. Pure helpers exported on `window.DacsBooking` for tests |
| `supabase/migrations/0084_appointments_booking_details.sql` | Columns + policy (§6) |
| `js/admin.js`, `admin.html` | Admin display (§7) |
| `docs/DATABASE_SCHEMA.md` | Appointment fields |
| `tests/booking.test.js` *(new)*, `package.json` | Tests (§9), added to `npm test` |

Script order in `index.html`: supabase-js CDN → `js/supabase-config.js` → `js/script.js` →
`js/booking.js`. Data constants (SERVICES, SCOPE, PROJECTS, AREAS, FAQS) live in `script.js`;
`booking.js` reads service options from `window.DacsSite.SERVICES` so the list exists once.

### Images
Reuse `assets/images/portfolio/`. The design's `assets/pN.png` is
`assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (N).png` (same photos, re-encoded; confirm
visually per image during implementation). Logo: `assets/images/DACS-TRANSPARENT.png`.
Fonts: Barlow + Playfair Display (already used).

## 4. Pages

### Home
1. **Hero** — full-screen slideshow of the 7 turnover images (`(2) (4) … (14)`), 6.5 s per
   slide with progress bars, prev/next, slide number, project title + city; parallax.
   Title "Dac's Building Design and Services", tagline, CTAs **Book a Free Consultation** and
   **Explore Our Projects**, plus `tel:+639924594334`.
2. **Stats** — count-up: 10+ Projects Completed · 10+ Years Combined Experience ·
   9 Services Offered · 5 Cities with completed projects. (The design file says 7; owner
   confirmed **9** on 2026-10-01 so it matches the Services page.)
3. **Intro** — "Your hard work deserves a home that lasts." with the design-build copy.
   The design's "Meet the studio →" link is **removed**.
4. **Featured before/after** — tabs for 4 projects (Park Triangle, San Lorenzo, Health Works,
   AUM), draggable divider (pointer events; keyboard ←/→ moves it 5 %).
5. **Carousel** — auto-scrolling turnover images, centre card enlarged, pauses on hover/touch;
   "See all projects →".
6. **How It Works** — 3-step vertical timeline whose fill grows on scroll.
7. **Testimonials** — loaded from `testimonials` (approved, rating ≥ 4), as today. Empty state:
   a short line inviting feedback, never the design's placeholder copy.
8. **FAQ** — the 6 existing questions, one open at a time.
9. **Closing CTA** — "Ready to Start Your Project?" → Book.

### Services
Page title "Professional Design & Build Services", then 9 full-width panels in the v2 order
(Vertical Construction first, labelled "Our Main Service"; Allied Services last, dark), each
with category, description, scope list, image cross-fade + thumbnails, and **Book this
service** → `#/book` with the service pre-selected. A sticky jump list of the 9 services.
Then **"Based in Quezon City, building across the Philippines"**: the 5 areas (QC 3, Makati 1,
Taguig 1, Valenzuela 1, Iligan 1) with an embedded Google Map that follows the selected city.

### Projects
Title "Featured Projects", filters **All / Residential / Commercial** with counts, mosaic grid
(7/5 spans on wide screens, 2-up on tablet, 1-up on phone). Clicking a card opens the **case
study overlay**: title, type, scope, city, before/after slider of its two images, the two
captions, and **Start a project like this** → `#/book` with a mapped service (Commercial →
Commercial Renovation, Building → Residential Construction, otherwise Interior Design).
Esc or the close button closes it (no history entry is pushed, so browser Back leaves the page
as it does everywhere else on the site).

## 5. Booking wizard (`#/book`)

Left: the step form. Right (stacks below on phone): **summary card** filling in live.
Progress bar = step × 25 %. Back / Next; Next validates the current step and shows one
error line.

| Step | Fields | Required | Validation message |
|---|---|---|---|
| 1 Consultation | Meeting type: Office visit / Site visit / Online call · Service: 9 services + General Consultation | both | "Choose how you would like to meet." / "Select the service you need." |
| 2 Your project | Property type: Condominium unit / House / Apartment or multi-storey building / Commercial space · Budget: Below ₱500K / ₱500K – ₱1M / ₱1M – ₱3M / ₱3M – ₱10M / ₱10M and above / Not sure yet · Location (text, suggestions QC, Makati, Taguig, Pasig, Manila, Outside Metro Manila) · Project details (optional) | all but details | "Select your property type." / "Select an estimated budget." / "Tell us where the property is." |
| 3 Schedule | Calendar (Mon-first; from **tomorrow** to **+3 months**; **Sundays disabled**) · Time: 9:00 AM / 10:30 AM / 1:00 PM / 2:30 PM / 4:00 PM | both | "Pick a preferred date." / "Pick a preferred time." |
| 4 Contact | Full name · Email · Phone | all | "Please complete all required fields." / "Please enter a valid email address." |

Step 2's upload box is replaced by: *"Have photos or plans? Send them to us on Messenger after
booking."* with a Messenger link. Consent line under Submit as in the design.

**Submit**
- `id = crypto.randomUUID()` generated in the browser.
- `sb.from('appointments').insert(row)` — **no `.select()`**, no `db.collection().add()`.
- `preferred_date` is a `YYYY-MM-DD` string built from the **local** year/month/day
  (never `toISOString()` — PH is UTC+8).
- Reference shown to the client: `'DACS-' + id.replace(/-/g,'').slice(0,6).toUpperCase()`.
- Button disabled while saving. On failure: keep all answers, show "Sorry, we couldn't send
  your request. Please try again or message us on Messenger.", and `_dacsReportError(...)`.
- **Success screen:** "Request received", the reference, the summary, *"This is a preferred
  schedule — we'll confirm it with you within 24 hours."*, and **Book another**.

Row written:

| Column | Value |
|---|---|
| `id` | client UUID |
| `fullname`, `email`, `contact` | step 4 (trimmed) |
| `service` | service id (e.g. `vertical-construction`, `consultation`) |
| `message` | project details |
| `meeting_type` | `office` / `site` / `online` |
| `property_type`, `budget`, `location` | step 2 labels as shown |
| `preferred_date` | `YYYY-MM-DD` |
| `preferred_time` | e.g. `10:30 AM` |
| `status` | `pending` |

## 6. Migration `0084_appointments_booking_details.sql`

```sql
alter table appointments
  add column if not exists meeting_type   text,
  add column if not exists property_type  text,
  add column if not exists budget         text,
  add column if not exists location       text,
  add column if not exists preferred_date date,
  add column if not exists preferred_time text;

-- Any signed-in account (clients, partners, workers) could read every visitor's
-- contact details. Owner + staff keep full access through appt_admin.
drop policy if exists appt_read on appointments;
```

All columns nullable → old rows and the old form keep working. `REG.appointments` in the shim
needs no change (`preferred_date` is a plain `date`, not a `ts:` field).
**After it is applied, query `information_schema.columns` and `pg_policies` on the live DB
before shipping the site** — "applied" has not matched the live DB twice before.

## 7. Admin (`js/admin.js`, `admin.html`)

- **`formatService()`** — add the 9 v2 ids (`vertical-construction`, `interior-design`,
  `architectural-design`, `engineering-design`, `interior-renovation`,
  `residential-construction`, `ground-up-construction`, `commercial-renovation`,
  `allied-services`); keep every old id so past appointments still read correctly.
- **Details modal** — add rows, each only when the value is present: Reference
  (`DACS-xxxxxx` from the id, same formula as §5), Meeting type (label), Property, **Budget**,
  Location, Preferred schedule (`Mon, Oct 5 · 10:30 AM`, parsed from local parts).
- **Table** — new **Preferred** column after Service (`—` when empty); update the empty-state
  `colspan` from 7 to 8.
- **Staff** — Budget row hidden when `currentUserRole === 'staff'` (peso figure).
- Search keeps matching name / email (as today, made null-safe); no new filters.

## 8. Accessibility & responsiveness

- Works at 360 px with no horizontal scroll; header collapses below 1000 px.
- All interactive elements are real `<button>`/`<a>`; visible focus rings; the before/after
  divider has `role="slider"` + `aria-valuenow`.
- `prefers-reduced-motion`: no curtain, parallax, auto-advance slideshow or auto-scroll
  carousel; reveals show immediately.
- Images below the fold `loading="lazy"`; hero first image eager.

## 9. Testing

- **`tests/booking.test.js`** (Node, loads `js/booking.js` helpers):
  local date key for a late-evening PH time stays on the same day; Sundays / today /
  > 3 months are disabled; each step's validation messages; payload has exactly the §5
  columns; reference formula; source check that `booking.js` never calls `.select(` or
  `db.collection('appointments').add`.
- **Router** — `#appointment` → `#/book`, `#` / unknown → `#/home`.
- `npm test` green; `node --check` on all changed JS.
- **Browser:** desktop + 375 px phone; full booking while **logged out**; the row appears in
  admin as **owner** (budget visible) and as **staff** (budget hidden); feedback submit while
  logged out lands as pending; old `index.html#appointment` link opens the wizard.

## 10. Rollout

1. Apply migration 0084.
2. Verify columns + policies on the live DB (§6).
3. Ship `index.html`, `css/styles.css`, `js/script.js`, `js/booking.js`, `js/admin.js`,
   `admin.html`, schema doc, tests together.
4. Submit one real test booking on production; check it in admin; delete it.
