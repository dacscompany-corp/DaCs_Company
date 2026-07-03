-- ════════════════════════════════════════════════════════════════════
-- Add profiles.allowed_modules (jsonb) — "mobile module-focus".
--
-- A list of PRIMARY_NAV section ids (admin.js) that an admin account is
-- narrowed to on every screen (desktop + mobile). The account sees ONLY
-- those sections in the portal nav. Example for a Project-Management-only
-- account:
--     update profiles set allowed_modules = '["pm"]'::jsonb
--      where email = 'admin-pm@dacsbuilding.com';
--
-- NULL / empty array = no focus (full access on every screen). Existing
-- rows stay NULL, so nothing changes for current accounts.
--
-- Valid ids: "expenses" (Project Control), "construction",
--            "pm" (Project Management), "appointments", "users".
--
-- Run AFTER 0001_init.sql.
-- ════════════════════════════════════════════════════════════════════

alter table profiles
  add column if not exists allowed_modules jsonb;
