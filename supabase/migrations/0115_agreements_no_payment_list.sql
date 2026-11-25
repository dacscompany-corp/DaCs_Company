-- ════════════════════════════════════════════════════════════════════
-- 0115 · WorkMate Agreements: no payroll breakdown on the phone
--
-- Owner decision, 17 Nov 2026: a linked worker keeps seeing each agreement's
-- agreed amount, paid so far and balance ("Over by" when negative), but never
-- the list of payments (each one's date, amount and method). The server stops
-- sending it, so no app version and no download of the phone's data shows it.
-- Spec: docs/superpowers/specs/2026-11-17-workmate-agreements-no-payment-list-design.md
--
-- ll_my_agreements() is 0113's definition minus the 'payments' key: the same
-- checks, security definer, search_path, keys, values and order. Paid is the
-- same sum of the same payroll rows (lcPaid's rule: lc_draws_down; a split
-- payment's parts add up to it either way). No table, column or other
-- function changes; the office side (lc_*) is untouched.
-- ════════════════════════════════════════════════════════════════════

create or replace function ll_my_agreements() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_company := attendance_data_owner();
  return jsonb_build_object('agreements', coalesce((
    select jsonb_agg(x.a order by x.ended, lower(x.project), lower(x.scope), x.id)
      from (
        select c.id, c.ended_at is not null as ended, coalesce(f.name, '') as project, coalesce(c.scope, '') as scope,
               jsonb_build_object(
                 'id', c.id,
                 'project', coalesce(f.name, ''),
                 'main_project', pf.name,
                 'project_completed', f.completed_at is not null,
                 'progress_pct', ll_folder_progress(f.id) * 100,
                 'scope', coalesce(c.scope, ''),
                 'trade', coalesce(c.trade, ''),
                 'pay_basis', case when c.pay_basis = 'daily' then 'daily' else 'fixed' end,
                 'works', lc_works_list(c.works),
                 'agreed', case when c.pay_basis = 'daily' then null else coalesce(c.agreed_amount, 0) end,
                 'paid', pd.paid,
                 'balance', case when c.pay_basis = 'daily' then null else coalesce(c.agreed_amount, 0) - pd.paid end,
                 'ended', c.ended_at is not null,
                 'ended_at', c.ended_at) as a
          from labor_contracts c
          join folders f on f.id = c.folder_id
          left join folders pf on pf.id = f.parent_folder_id
          cross join lateral (
            select coalesce(sum(coalesce(p.total_salary, 0)), 0) as paid
              from payroll p
             where p.contract_id = c.id and lc_draws_down(p)) pd
         where c.worker_id = auth.uid() and c.owner_id = v_company
           and coalesce(c.category, 'labor') = 'labor') x), '[]'::jsonb));
end;
$$;

revoke all on function ll_my_agreements() from public, anon;
grant execute on function ll_my_agreements() to authenticated;
