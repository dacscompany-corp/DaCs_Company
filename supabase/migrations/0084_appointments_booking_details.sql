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
