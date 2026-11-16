-- ════════════════════════════════════════════════════════════════════
-- Stage 4 live check (question 14) — READ ONLY. Run through MCP execute_sql
-- (or the SQL editor) before launch and whenever the owner asks.
--
-- It works out "where every purchase peso is" a SECOND way and compares it
-- with what the Reconciliation tab shows (rec_purchase_places, run as the
-- main owner inside a transaction that is rolled back):
--   the tab counts expense ROWS (own rows, cost-move rows);
--   this check counts cost-move VALUES (stk_cost_moves) and holders.
-- Then three more things that must always hold:
--   · the cost-move log matches the rows that exist (added − removed);
--   · every line waiting for a billing period is all Cover;
--   · (for information) the lines waiting, and the marks that apply.
-- Each check is one row: ok = true, or false with what differs.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
-- admin@, the main owner (the tab is read as that account).
select set_config('request.jwt.claims', json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
  from profiles p
 where p.id = '869c0be7-da92-44d4-a2b1-03dac7fed7e9' and p.role = 'owner' and p.owner_id is null
   and coalesce(p.status, 'active') = 'active';

with screen as (
  select (x ->> 'id')::uuid as id, (x ->> 'recorded')::numeric as recorded, (x ->> 'own')::numeric as own,
         (x ->> 'other')::numeric as other, (x ->> 'company')::numeric as company, (x ->> 'loss')::numeric as loss,
         (x ->> 'difference')::numeric as difference
    from jsonb_array_elements(rec_purchase_places(((now() at time zone 'Asia/Manila')::date - 3650)::text,
                                                  ((now() at time zone 'Asia/Manila')::date + 1)::text) -> 'purchases') x),
own_rows as (
  select x.pid, sum(x.amount) as amt from (
    select l.purchase_id as pid, e.amount from expenses e join purchase_lines l on l.id = e.purchase_line_id
    union all
    select c.purchase_id, e.amount from expenses e join purchase_charges c on c.id = e.purchase_charge_id) x
   group by x.pid),
moves as (
  -- Approved, unreversed cost moves by value: into a holder +, out of a holder −.
  select lt.purchase_id as pid,
         sum(case when c.kind <> 'loss' and c.to_folder is not distinct from lt.cost_folder_id and lt.cost_folder_id is not null then c.value else 0 end)
         - sum(case when c.from_folder is not distinct from lt.cost_folder_id and lt.cost_folder_id is not null then c.value else 0 end) as own_v,
         sum(case when c.kind <> 'loss' and c.to_folder is not null and c.to_folder is distinct from lt.cost_folder_id then c.value else 0 end)
         - sum(case when c.from_folder is not null and c.from_folder is distinct from lt.cost_folder_id then c.value else 0 end) as other_v,
         sum(case when c.kind = 'loss' then c.value else 0 end) as loss_v
    from stk_cost_moves c join stk_lots lt on lt.id = c.lot_id
   where c.status = 'approved' and c.reversed_at is null
   group by lt.purchase_id),
second as (
  select pu.id, pu.receipt_total as recorded,
         round(coalesce(o.amt, 0) + coalesce(m.own_v, 0), 2) as own,
         round(coalesce(m.other_v, 0), 2) as other,
         round(coalesce(m.loss_v, 0), 2) as loss
    from purchases pu
    left join own_rows o on o.pid = pu.id
    left join moves m on m.pid = pu.id
   where pu.status = 'recorded'
     and pu.purchase_date between (now() at time zone 'Asia/Manila')::date - 3650 and (now() at time zone 'Asia/Manila')::date + 1),
log_net as (
  select r.cost_move_id, round(sum(case when r.change = 'added' then r.amount else -r.amount end), 2) as net
    from rec_cost_row_log r group by r.cost_move_id),
rows_now as (
  select e.stk_cost_move_id as cost_move_id, round(sum(e.amount), 2) as amt
    from expenses e where e.stk_cost_move_id is not null group by e.stk_cost_move_id)
select 'C1 the tab and this check agree for every purchase (own, other, loss)' as check_name,
       not exists (select 1 from screen s full join second d on d.id = s.id
                    where s.id is null or d.id is null or s.own <> d.own or s.other <> d.other or s.loss <> d.loss) as ok,
       (select coalesce(string_agg(left(coalesce(s.id, d.id)::text, 8) || ' tab ' || coalesce(s.own::text, '-') || '/' || coalesce(s.other::text, '-')
               || '/' || coalesce(s.loss::text, '-') || ' check ' || coalesce(d.own::text, '-') || '/' || coalesce(d.other::text, '-')
               || '/' || coalesce(d.loss::text, '-'), '; '), '')
          from screen s full join second d on d.id = s.id
         where s.id is null or d.id is null or s.own <> d.own or s.other <> d.other or s.loss <> d.loss) as detail
union all
select 'C2 every purchase adds up on the tab (difference ₱0)',
       not exists (select 1 from screen where difference <> 0),
       (select coalesce(string_agg(left(id::text, 8) || ' ₱' || difference, '; '), '') from screen where difference <> 0)
union all
select 'C3 the purchases counted: ' || (select count(*) from screen) || ', ₱' || (select coalesce(sum(recorded), 0) from screen),
       (select count(*) from screen) = (select count(*) from second), ''
union all
select 'C4 the cost-move log matches the rows that exist (added − removed)',
       not exists (select 1 from log_net l full join rows_now r on r.cost_move_id = l.cost_move_id
                    where coalesce(l.net, 0) <> coalesce(r.amt, 0)),
       (select coalesce(string_agg(left(coalesce(l.cost_move_id, r.cost_move_id)::text, 8) || ' log ' || coalesce(l.net, 0)
               || ' rows ' || coalesce(r.amt, 0), '; '), '')
          from log_net l full join rows_now r on r.cost_move_id = l.cost_move_id where coalesce(l.net, 0) <> coalesce(r.amt, 0))
union all
select 'C5 every line waiting for a billing period is all Cover',
       not exists (select 1 from purchase_lines l join purchases pu on pu.id = l.purchase_id join expenses e on e.purchase_line_id = l.id
                    where pu.status = 'recorded' and l.needs_funding_review and not coalesce(e.cover_expense, false)),
       ''
union all
select 'C6 (information) lines waiting for a billing period: '
         || (select count(*) from purchase_lines l join purchases pu on pu.id = l.purchase_id
              where pu.status = 'recorded' and l.needs_funding_review)
         || '; "Cover is right" marks that apply: ' || (select count(*) from rec_cover_marks m where rec_mark_current(m.id)),
       true,
       (select coalesce(string_agg(left(l.purchase_id::text, 8) || ' line ' || l.line_no || ' ₱' || l.gross_amount, '; '
                                   order by pu.purchase_date), '')
          from purchase_lines l join purchases pu on pu.id = l.purchase_id
         where pu.status = 'recorded' and l.needs_funding_review);
rollback;
