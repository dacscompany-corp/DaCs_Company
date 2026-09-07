with params as (
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
  select *, sum(amount) over (order by d, kind, id) as running_total
  from rows_ where d is not null
)
select 0 as sort, '0. FOLDER' as section,
       f.name as item,
       ''::text as detail,
       null::numeric as amount,
       case when fo.id is not null then '<<< MATCHED — this is the one being reported below'
            else 'copy this name into the params line if it is the one you want' end as note
from folders f
left join folder fo on fo.id = f.id
union all
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
select 3, '2. IN COVER', kind, count(*)::text || ' rows', sum(amount),
       'dates ' || coalesce(min(d),'?') || ' .. ' || coalesce(max(d),'?')
       || ' · undated: ' || count(*) filter (where d is null)
       || ' · missing cover flag: ' || count(*) filter (where cover_expense is not true)
from rows_ group by kind
union all
select 4, '2. IN COVER', 'TOTAL TO REORGANISE', count(*)::text || ' rows', sum(amount), ''
from rows_
union all
select 5, '3. DATE ORDER', d || '  ' || kind, label, amount,
       'running ' || round(running_total)
from dated
union all
select 6, '4. UNDATED', kind, label, amount, 'no usable date — cannot be placed by date'
from rows_ where d is null
order by sort, item;
