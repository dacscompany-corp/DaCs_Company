-- reorganize_cover_periods_preflight.sql
-- READ-ONLY. Nothing here writes.
--
-- HOW TO RUN
--   1. Paste the whole file into the Supabase SQL editor and hit Run.
--   2. Read section 0 of the output. It lists every folder name. Find the one
--      you want and copy it EXACTLY.
--   3. Replace <<FOLDER NAME>> on the one line below with that name, run again.
--
-- This is deliberately ONE statement. The Supabase SQL editor only displays the
-- result of the LAST statement when several are run together, so a script split
-- into four queries silently shows you only the fourth — which is how the first
-- version came back "No rows returned".
--
-- WHY THIS EXISTS
-- A folder accumulated several `president` (Cover Expenses) billing periods that
-- were never really cover — they are month containers saved with the wrong
-- funding type, and the spend inside them belongs against the real billing
-- periods (Mobilization / Downpayment / Progress Billing). Owner's call
-- (2026-09-07): reorganise them.
--
-- NOTE ON THE SQL EDITOR WARNING
-- Supabase's linter scans COMMENT text as well as code. An earlier draft used
-- the word "cre-ated" in this paragraph, and the editor raised its Row Level
-- Security warning against a phantom object it thought was being made. It was a
-- false positive: this file is a single SELECT and writes nothing at all.
-- The wording here avoids the trigger words (cre-ate / ta-ble / in-sert /
-- up-date / de-lete / al-ter / dr-op) so the warning does not come back.
--
-- WHAT COVER ACTUALLY MEANS (CLAUDE.md, docs/OVERHEAD_MODULE.md)
-- A president period, or a row flagged `cover_expense`, is work the COMPANY paid
-- for because the client's allocation ran out. It already counts in Labor /
-- Material like any other cost — "Cover Expenses" only reports how much of that
-- total was fronted. Moving a row out of cover does NOT change Spent; it changes
-- who the books say paid. That is the point of the exercise, and also why the
-- apply step must set `cover_expense = false` on every row it moves: a row
-- carries BOTH markers, and changing one without the other is what made Reports
-- and Project Control disagree in Aug 2026 (§I of tests/money-math.test.js).

with params as (
  -- ── THE ONLY LINE YOU EDIT ──────────────────────────────────────────
  select '<<FOLDER NAME>>'::text as folder_name
),
folder as (
  select f.id, f.name from folders f, params p where f.name = p.folder_name
),
periods as (
  select p.id, p.month, p.year, p.funding_type, p.billing_number,
         coalesce(pb.monthly_budget, 0)::numeric as budget,
         (coalesce((select sum(e.amount)       from expenses e where e.project_id = p.id), 0)
        + coalesce((select sum(r.total_salary) from payroll  r where r.project_id = p.id), 0))::numeric as spent
  from projects p
  join folder f on f.id = p.folder_id
  left join project_budgets pb on pb.project_id = p.id
),
cover as (select id from periods where funding_type = 'president'),
-- Dates are TEXT columns, so they are matched defensively: anything that is not
-- a leading YYYY-MM-DD comes back NULL and is reported separately, because a row
-- with no usable date cannot be assigned "by date".
rows_ as (
  select 'expense'::text as kind, e.id::text as id, coalesce(e.expense_name,'(no name)') as label,
         coalesce(e.amount,0)::numeric as amount,
         substring(e.date_time from '^[0-9]{4}-[0-9]{2}-[0-9]{2}') as d,
         e.cover_expense
  from expenses e where e.project_id in (select id from cover)
  union all
  select 'payroll', r.id::text, coalesce(r.worker_name,'(no name)'),
         coalesce(r.total_salary,0)::numeric,
         substring(r.payment_date from '^[0-9]{4}-[0-9]{2}-[0-9]{2}'),
         r.cover_expense
  from payroll r where r.project_id in (select id from cover)
),
dated as (
  -- Ordered the same way the output is sorted below (date, then kind, then id),
  -- so the running total reads consecutively down the screen instead of jumping
  -- around wherever two rows share a date.
  select *, sum(amount) over (order by d, kind, id) as running_total
  from rows_ where d is not null
)

-- ── 0. FOLDERS — copy the exact name you want ───────────────────────
select 0 as sort, '0. FOLDER' as section,
       f.name as item,
       ''::text as detail,
       null::numeric as amount,
       case when fo.id is not null then '<<< MATCHED — this is the one being reported below'
            else 'copy this name into the params line if it is the one you want' end as note
from folders f
left join folder fo on fo.id = f.id

union all
-- ── 1. PERIODS — budget, spend and headroom ─────────────────────────
select 1, '1. PERIOD',
       month || ' ' || year,
       coalesce(funding_type,'(none)') || coalesce(' #' || billing_number, ''),
       budget,
       case when funding_type = 'president' then 'SOURCE — its rows move'
            when budget > spent            then 'TARGET — headroom ' || round(budget - spent)
            when budget = 0                then 'no allocation set'
            else 'target already full/over by ' || round(spent - budget) end
from periods

union all
select 2, '1. PERIOD', '   ^ spent so far', '', spent, ''
from periods

union all
-- ── 2. WHAT IS IN COVER ─────────────────────────────────────────────
select 3, '2. IN COVER', kind, count(*)::text || ' rows', sum(amount),
       'dates ' || coalesce(min(d),'?') || ' .. ' || coalesce(max(d),'?')
       || ' · undated: ' || count(*) filter (where d is null)
       || ' · missing cover flag: ' || count(*) filter (where cover_expense is not true)
from rows_ group by kind

union all
select 4, '2. IN COVER', 'TOTAL TO REORGANISE', count(*)::text || ' rows', sum(amount), ''
from rows_

union all
-- ── 3. DATE ORDER + RUNNING TOTAL ───────────────────────────────────
-- Compare running_total against the total headroom from section 1: everything
-- up to it can be charged to a billing period, everything past it stays cover.
select 5, '3. DATE ORDER', d || '  ' || kind, label, amount,
       'running ' || round(running_total)
from dated

union all
-- ── 4. UNDATED — needs its own decision ─────────────────────────────
select 6, '4. UNDATED', kind, label, amount, 'no usable date — cannot be placed by date'
from rows_ where d is null

order by sort, item;
