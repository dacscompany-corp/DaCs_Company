-- Link a Project Management project (construction_projects) to its matching
-- Project Control folder (folders), so labor-contract "paid" totals can be
-- reconciled across the two systems instead of living in two disjoint ledgers
-- (labor_contracts/payroll, folder-scoped vs. pm_labor_contracts/weekly_bills,
-- construction_projects-scoped). Nullable — most existing rows have no match
-- and that's fine; only projects an admin explicitly links get reconciled.
alter table construction_projects
  add column if not exists folder_id uuid references folders(id) on delete set null;

create index if not exists cproj_folder_idx on construction_projects(folder_id);
