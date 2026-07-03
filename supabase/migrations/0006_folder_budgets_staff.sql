-- ════════════════════════════════════════════════════════════════════
-- Allow staff to read their owner's contract value (folder_budgets.total_budget)
-- so the staff Project Control cards can show "% of contract" like the owner.
--
-- ⚠️ NOTE: This intentionally lets staff SEE the contract value. Because staff
-- already hold the labor/material peso amounts in the browser, showing them the
-- contract ratio makes the contract derivable anyway — this just makes it direct.
-- Run AFTER 0002_rls.sql.
-- ════════════════════════════════════════════════════════════════════

drop policy if exists folder_budgets_staff_read on folder_budgets;
create policy folder_budgets_staff_read on folder_budgets for select
  using (is_staff() and owner_id = data_owner_id());
