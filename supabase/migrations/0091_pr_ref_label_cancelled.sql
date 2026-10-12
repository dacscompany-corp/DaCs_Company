-- 0091 — "Requested again from …" says when the source line was cancelled.
--
-- ── WHY. pr_ref_label (0090) ended every request-line source with the fixed
--    text " · Requested", so a line requested again from an entry that was
--    later cancelled read "Requested" in Dacs Web while the worker's phone
--    (pr_history_item → pr_entry_label) said "Requested — cancelled". Found
--    in the 1b-4 phone pilot, 2026-10-12.
--
-- ── WHAT. Re-declares pr_ref_label only. The request-line branch now takes
--    its label from pr_entry_label(kind, cancelled), with "cancelled" decided
--    exactly as pr_history_entries decides it (the line OR its request was
--    cancelled). The reference branch, the fallback text, the signature and
--    the permissions are unchanged. Display text only: no table, no data, no
--    money; nothing here feeds Spent / Earned / Profit.

set local lock_timeout = '5s';

create or replace function pr_ref_label(p_kind text, p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p_kind is null then null else coalesce(case
    when p_kind = 'request_line' then (
      select f.name || ' · ' || case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end
             || ' · ' || to_char(r.received_at at time zone 'Asia/Manila', 'FMMon FMDD, YYYY')
             || ' · ' || pr_entry_label('request_line', (l.status = 'cancelled' or r.status = 'cancelled'))
        from pr_lines l
        join pr_requests r on r.id = l.request_id
        join folders f on f.id = r.folder_id
        join folders w on w.id = r.work_folder_id
       where l.id = p_id)
    when p_kind = 'reference' then (
      select f.name || ' · ' || case when ir.work_folder_id = ir.folder_id then 'Main Contract' else w.name end
             || ' · ' || case ir.date_precision
                           when 'unknown' then 'Date unknown'
                           when 'approximate' then 'around ' || to_char(ir.ref_date, 'FMMon YYYY')
                           else to_char(ir.ref_date, 'FMMon FMDD, YYYY') end
             || ' · Historical reference'
        from pr_item_refs ir
        join folders f on f.id = ir.folder_id
        join folders w on w.id = ir.work_folder_id
       where ir.id = p_id)
  end, 'Source no longer available') end
$$;

revoke all on function pr_ref_label(text, uuid) from public, anon, authenticated;
