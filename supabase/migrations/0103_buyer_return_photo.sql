-- 0103 — WorkMate Stage 2A-4b: a buyer sees the photo of their own petty-cash return.
--
-- Plan: docs/superpowers/plans/2026-10-23-workmate-stage2a4b-buyer-payments.md;
-- finding F3 of plan 2A-4a (execution notes, 23 Oct 2026).
--
-- 0102 kept a return's photo (pur_cash_returns.photo_url, in the private
-- pettyCash/ folder that only the main owner and the uploading buyer may read,
-- R13) but pur_cash_detail never sent it: the buyer's own "My cash" (pur_my_cash)
-- and the main owner's one-buyer view (pur_cash_buyer) both read through it.
-- pur_cash_detail is 0102's text plus one key, 'photo_url', on each return.
-- It stays internal (callable only through pur_my_cash / pur_cash_buyer, which
-- check their caller first). Opening the photo is still decided by Storage on
-- every download (uploads_can_read → pur_petty_reader).
--
-- pur_list_doc (one Purchases / My purchases row) is 0102's text plus one key,
-- 'supplier_id': the phone may record a payment from that supplier's credit
-- with no signal, from its saved copy of My purchases (2A-4b, Q6/Q11). The
-- row already carried the supplier's name; Purchasing reads it as before.
--
-- pur_my_ops_done (new): which of the CALLER'S OWN operation ids the server
-- already accepted (pur_ops, 0096). A phone whose answer was lost keeps the
-- payment queued; before it reads fresh balances it asks this, finishes what
-- the server already has, and so never counts that payment twice (2A-4b R38).
-- It reveals nothing but the caller's own ids, at most 200 asked at once.
--
-- Nothing else changes: no table, no money. pur_my_ops_done is the only grant.

create or replace function pur_cash_detail(p_owner uuid, p_buyer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select pur_cash_summary(p_owner, p_buyer) || jsonb_build_object(
    'holder', true,
    'issues', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'amount', i.amount, 'issued_on', i.issued_on,
                 'method', i.method, 'note', i.note, 'disputed_at', i.disputed_at, 'dispute_note', i.dispute_note,
                 'dispute_cleared_at', i.dispute_cleared_at, 'dispute_cleared_note', i.dispute_cleared_note,
                 'voided_at', i.voided_at, 'void_reason', i.void_reason) order by i.issued_on desc, i.created_at desc), '[]'::jsonb)
                 from pur_cash_issues i where i.owner_id = p_owner and i.buyer_id = p_buyer
                  and i.issued_on >= pur_manila_today() - 90),
    'returns', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'handed_on', r.handed_on,
                  'handed_to', r.handed_to, 'status', r.status, 'decided_at', r.decided_at, 'decision_note', r.decision_note,
                  'photo_url', r.photo_url, 'voided_at', r.voided_at) order by r.created_at desc), '[]'::jsonb)
                  from pur_cash_returns r where r.owner_id = p_owner and r.buyer_id = p_buyer
                   and (r.status = 'reported' or r.handed_on >= pur_manila_today() - 90)),
    'repayments', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'paid_on', x.paid_on,
                     'method', x.method, 'voided_at', x.voided_at) order by x.paid_on desc, x.created_at desc), '[]'::jsonb)
                     from pur_buyer_repayments x where x.owner_id = p_owner and x.buyer_id = p_buyer
                      and x.paid_on >= pur_manila_today() - 90),
    'counts', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'counted_on', k.counted_on, 'counted', k.counted,
                 'recorded', pur_cash_raw(p_owner, p_buyer, k.counted_on), 'note', k.note, 'voided_at', k.voided_at)
                 order by k.counted_on desc, k.created_at desc), '[]'::jsonb)
                 from pur_cash_counts k where k.owner_id = p_owner and k.buyer_id = p_buyer
                  and k.counted_on >= pur_manila_today() - 90))
$$;

revoke all on function pur_cash_detail(uuid, uuid) from public, anon, authenticated;

-- One purchases-list row (0101, 0102): plus the listed supplier.
create or replace function pur_list_doc(p_purchase uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', pu.id, 'status', pu.status, 'source', pu.source, 'purchase_date', pu.purchase_date,
           'supplier', pu.supplier, 'receipt_total', pu.receipt_total,
           'recorded_by_name', pur_person_name(pu.recorded_by),
           'bought_by_name', pur_person_name(coalesce(pu.bought_by, pu.recorded_by)),
           'projects', (select coalesce(jsonb_agg(distinct l.folder_name), '[]'::jsonb) from purchase_lines l
                         where l.purchase_id = pu.id and l.destination = 'project'),
           'warehouse', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.destination = 'warehouse'),
           'lines', (select count(*) from purchase_lines l where l.purchase_id = pu.id),
           'linked', (select count(*) from purchase_lines l where l.purchase_id = pu.id and l.request_line_id is not null),
           'unplanned', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unplanned_reason <> ''),
           'extra', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.extra_qty > 0),
           'unit_check', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.unit_check = 'pending'),
           'needs_review', exists (select 1 from purchase_lines l where l.purchase_id = pu.id and l.needs_funding_review),
           'pending_change', exists (select 1 from purchase_change_requests r where r.purchase_id = pu.id and r.status = 'pending'),
           'no_receipt_reason', pu.no_receipt_reason,
           'replaced_by', pu.replaced_by,
           'supplier_id', pu.supplier_id,
           'pay', pur_pay_state(pu.id))
    from purchases pu where pu.id = p_purchase
$$;

revoke all on function pur_list_doc(uuid) from public, anon, authenticated;

-- Which of the caller's own operation ids the server already has (R38).
create or replace function pur_my_ops_done(p_ops uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(cardinality(p_ops), 0) > 200 then raise exception 'BAD_OP' using errcode = 'P0001'; end if;
  return coalesce((select array_agg(o.op_id order by o.op_id) from pur_ops o
                    where o.actor_id = auth.uid() and o.op_id = any(coalesce(p_ops, '{}'::uuid[]))), '{}'::uuid[]);
end;
$$;

revoke all on function pur_my_ops_done(uuid[]) from public, anon;
grant execute on function pur_my_ops_done(uuid[]) to authenticated;
