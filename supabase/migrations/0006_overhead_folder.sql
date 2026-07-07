-- ════════════════════════════════════════════════════════════════════
-- PER-PROJECT OVERHEAD
-- The Overhead drill in Project Control reads overheadExpenses scoped to a
-- project (folder). Add the folder_id column the app writes (folderId ->
-- folder_id). Existing rows keep folder_id = NULL.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table overhead_expenses
  add column if not exists folder_id uuid references folders(id) on delete cascade;

create index if not exists overhead_folder_idx on overhead_expenses(folder_id);
