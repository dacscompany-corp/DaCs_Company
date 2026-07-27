-- 0039_labor_contract_trade.sql
-- Worker position / trade on a labor contract.
--
-- The Employee Policy Manual's acknowledgement page (page 13) has a
-- "POSISYON / TRADE" blank next to the printed name, and its fillable AcroForm
-- exposes it as `ack_position_trade`. Nothing on the contract supplied it, so
-- the field printed blank on every agreement. `scope` is the JOB ("Tiling &
-- masonry"), not the worker's trade ("Mason"), so it can't stand in.
--
-- Project Management's pm_labor_contracts is left alone: it attaches an already
-- signed PDF and never stamps the manual, so it has nothing to fill.

alter table labor_contracts
  add column if not exists trade text;   -- e.g. "Mason", "Carpenter", "Foreman"

comment on column labor_contracts.trade is
  'Worker position / trade — fills ack_position_trade on the policy manual.';
