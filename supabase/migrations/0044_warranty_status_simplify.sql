-- ════════════════════════════════════════════════════════════════════
-- 0044_warranty_status_simplify.sql
--
-- Simplifies warranty_retentions.status from four values to two.
--
-- 0043 shipped held / released / consumed / void, with a manual "Release"
-- button moving a row from held to released once its warranty year was up.
--
-- That button gated nothing. In this system the whole reserve is spendable
-- whether a row is held or released (see the isolation notes in 0043 and
-- CLAUDE.md), so Release only ever changed a label — a badge the owner had
-- to maintain by hand for no downstream effect. `consumed` and `void` were
-- worse: both were in the filter UI but no screen could ever set them.
--
-- So:
--   · Whether a project is still inside its warranty year is now DERIVED in
--     the app, from release_due vs today. Nothing to click, nothing to keep
--     current, and it cannot go stale.
--   · `status` keeps only the one distinction that moves a total:
--       active → counts toward the reserve
--       void   → excluded (mis-entered project, duplicate, shouldn't count)
--
-- The old values stay in the check constraint so rows written by the first
-- build remain valid, and the app reads held/released/consumed as active.
-- Existing rows are migrated to 'active' below, so in practice only 'void'
-- and 'active' occur from here on. Do not write the legacy values.
--
-- released_at / released_by / release_note are deliberately NOT dropped:
-- they hold real data on any row the old button touched, and dropping a
-- column to save three unused fields is not worth losing that history.
--
-- Idempotent — safe on the live DB and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

-- 1) Widen the constraint FIRST, or the update below has nowhere to land.
alter table warranty_retentions
  drop constraint if exists warranty_retentions_status_check;

alter table warranty_retentions
  add constraint warranty_retentions_status_check
  check (status in ('active','void','held','released','consumed'));

-- 2) Everything that used to mean "counts" becomes 'active'. `void` is the
--    only old value that carried a real decision, so it is left alone.
update warranty_retentions
   set status = 'active'
 where status in ('held','released','consumed');

-- 3) New rows default to 'active'.
alter table warranty_retentions
  alter column status set default 'active';
