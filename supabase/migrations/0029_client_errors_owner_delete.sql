-- ════════════════════════════════════════════════════════════════════
-- 0029_client_errors_owner_delete.sql
--
-- The System Errors panel (admin.html → Users → System Errors) lets the
-- owner dismiss handled rows and clear the log. 0028 gave visitors
-- write-only access and the owner read access; this adds owner DELETE.
-- Still no UPDATE for anyone — error rows are evidence, not documents.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists client_errors_delete on client_errors;
create policy client_errors_delete on client_errors
  for delete to authenticated
  using (is_owner());
