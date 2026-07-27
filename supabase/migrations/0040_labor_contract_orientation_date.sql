-- 0040_labor_contract_orientation_date.sql
-- Orientation date on a labor contract.
--
-- Page 13 of the Employee Policy Manual has a "PETSA NG ORIENTATION" blank
-- (AcroForm field `ack_orientation_date`) next to the project/branch line. The
-- owner wants it printed rather than hand-dated.
--
-- NOTE: the date picker was dropped straight after this migration was written —
-- the agreement now always prints TODAY's date (the day the manual is handed
-- over), computed at print time in expenses-module.js. Nothing writes this
-- column today; it is kept so the schema still matches the migration history,
-- and so a per-contract date override can be re-enabled without a new column.
--
-- Stored as text 'YYYY-MM-DD' (local PH parts, never toISOString) to match
-- payroll.payment_date and every other date column in this schema.

alter table labor_contracts
  add column if not exists orientation_date text;

comment on column labor_contracts.orientation_date is
  'Worker orientation date, YYYY-MM-DD. UNUSED by the app: the agreement prints today''s date at print time.';
