-- ════════════════════════════════════════════════════════════════════
-- Add budget + planned end date to construction_projects.
-- Powers the partner/client portal KPIs:
--   • Budget Status      (totalExpenses ÷ budget)
--   • Cost Variance      (budget − totalExpenses)
--   • Schedule Performance — planned progress needs a target end date
-- The admin Project Management form (pm-admin.js) writes these via the
-- Firebase→Supabase compat shim: budget → budget, plannedEndDate → planned_end_date.
-- ════════════════════════════════════════════════════════════════════

alter table construction_projects
  add column if not exists budget           numeric,
  add column if not exists planned_end_date text;

-- Refresh PostgREST's schema cache so the new columns are usable immediately.
notify pgrst, 'reload schema';
