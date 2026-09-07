-- 0064_folder_completion.sql
-- COMPLETED projects in Project Control.
--
-- Project Control has never had a notion of a finished project. The badge on a
-- folder card ("On track" / "Needs attention" / "Not started") is DERIVED live
-- from spend-vs-budget in portal-app.compiled.js — nothing was ever stored, so
-- a job that wrapped up two years ago still sat in the picker between two live
-- ones, and the only way to get it out of the way was to delete it.
--
-- WHY A TIMESTAMP AND NOT A STATUS. Presence IS the state:
--
--     completed_at is null      ->  active   (in the picker, in the carousel)
--     completed_at is set       ->  complete (hidden; reachable via "Completed")
--
-- A `status` column would collide with the card's derived `status` field, whose
-- values are 'track' | 'attn' | 'new' and mean something else entirely — two
-- fields of the same name meaning different things is how a dashboard gets
-- misread. The timestamp also answers "when", which a boolean cannot, and the
-- UI shows it as "Completed · 12 Aug 2026" for free.
--
-- MONEY MODEL: untouched, and deliberately so. This column carries NO pesos and
-- gates NO arithmetic. A completed folder's Labor / Material / Overhead still
-- total exactly as before and it still contributes to the company P&L:
--
--     Spent  = Labor + Material + Overhead        <- unchanged
--     Earned = % complete x contract              <- unchanged
--     Profit = Earned - Spent                     <- unchanged
--
-- Completion is a VIEW state, not an accounting event. §X of
-- tests/folder-completion.test.js fences that marking a folder complete moves
-- no money, and that a completed folder is still counted by the P&L strip.
--
-- NOT THE WARRANTY RESERVE. Migration 0043's warranty retention triggers on
-- `construction_projects.status = 'completed'` — a DIFFERENT project system with
-- a different id space (folders.id != construction_projects.id). Marking a
-- folder complete here creates no warranty_retentions row and draws no reserve.
-- Do not wire the two together without deciding what netCash means for a folder.
--
-- NOT A DELETE. Re-opening is simply setting the column back to null, so
-- nothing is destroyed and nothing cascades. The trash button is unchanged.
--
-- Owner/staff only, same as the base table's RLS — no new policy needed. The
-- UI additionally restricts the mark/re-open action to non-staff accounts.

alter table folders
  add column if not exists completed_at timestamptz;

-- Existing folders are all live work. The column is nullable with no default,
-- so they are already active — this is stated, not executed, for the reader.

comment on column folders.completed_at is
  'When the owner marked this project finished. NULL = active. Presence hides the folder from the Project Control picker and carousel; it is reached again through the collapsed "Completed" section. Carries no pesos and gates no arithmetic — see 0064_folder_completion.sql.';
