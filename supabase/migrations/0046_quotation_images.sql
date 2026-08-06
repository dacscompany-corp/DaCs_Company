-- ════════════════════════════════════════════════════════════════════
-- 0046_quotation_images.sql
--
-- QUOTATION REFERENCE IMAGES — move them from per-section to per-DOCUMENT.
--
-- 0045 stored images inside each section, in the `sections` jsonb blob.
-- That produced a sheet with a photo strip repeated under every section.
-- Real quotations carry ONE set of renders at the top, under the scope
-- note and above the itemized estimate — see the reference document.
--
-- So: a single document-level `images` array, capped at 4 by the module
-- (js/quotation-module.js, QT_MAX_IMAGES). The cap is deliberately NOT a
-- database constraint — trimming a 5th image belongs in the UI where the
-- user can be told, not in a failed INSERT with a Postgres error.
--
-- Shape, matching what 0045 stored per section:
--   [{ "url": "...", "name": "...", "caption": "..." }, ...]
--
-- Existing per-section images are NOT migrated in SQL. The module hoists
-- them on read (qtHoistLegacyImages) so an old quotation keeps printing
-- its pictures, and they move up to this column on its next save. That
-- keeps the rollback story simple: nothing here destroys the old data,
-- because `sections` is left exactly as it is.
--
-- Isolation rule from 0045 still stands: this is a PROPOSAL, not revenue.
-- Nothing in the money model reads it.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

alter table quotations
  add column if not exists images jsonb not null default '[]'::jsonb;

comment on column quotations.images is
  'Document-level reference images (renders/photos) printed above the itemized estimate. [{url,name,caption}]. Capped at 4 by the UI, not by the DB. Replaces the per-section images added in 0045.';

-- quotation_revisions.snapshot is already jsonb and freezes the whole
-- document, so a frozen revision carries its own copy of `images` with
-- no schema change here.
