-- ═════════════════════════════════════════════════
-- One-off correction, the user's decision of 3 Nov 2026: Los Churreros System
-- Plus · Pampanga reads WR-2026-0001, the same reference as Los Churreros ·
-- Dapitan, Manila. It becomes WR-2026-0003.
--
-- Run by the USER in the Supabase SQL editor. One transaction. Any failed guard
-- stops it and changes NOTHING.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It makes the change, checks it, prints a
--            red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- The reference is only a label: the fund, the reserve and Profit Sharing go by
-- the record's id, and no other table holds the number. This changes the
-- reference, adds one line to that record's history and stamps updated_at.
-- Nothing else on the record, and no other record, changes.
-- ═════════════════════════════════════════════════

do $$
declare
  v_dry boolean := true;
  c_id constant uuid := 'b3abda56-b5ae-404a-a819-f169d6c1b48f';
  before_row warranty_retentions;
  after_row warranty_retentions;
  others_before jsonb;
  others_after jsonb;
  total_before numeric;
  total_after numeric;
  n int;
begin
  select * into before_row from warranty_retentions where id = c_id for update;
  if not found then
    raise exception 'GUARD: the System Plus record is not there';
  end if;
  if before_row.ref_no = 'WR-2026-0003' then
    raise exception 'GUARD: already corrected, nothing to do';
  end if;
  if before_row.ref_no is distinct from 'WR-2026-0001' then
    raise exception 'GUARD: the record reads %, not WR-2026-0001', before_row.ref_no;
  end if;
  if before_row.project_name is distinct from 'Los Churreros System Plus' or left(before_row.project_id::text, 8) <> '732f858e'
     or before_row.deleted_at is not null or round(before_row.contributed_amount, 2) <> 6021.30 then
    raise exception 'GUARD: this is not the expected record (project, deleted, or reserve ₱6,021.30)';
  end if;
  if (select count(*) from warranty_retentions where ref_no = 'WR-2026-0001' and id <> c_id and deleted_at is null) <> 1 then
    raise exception 'GUARD: expected exactly one other record reading WR-2026-0001 (Dapitan)';
  end if;
  if exists (select 1 from warranty_retentions where ref_no = 'WR-2026-0003') then
    raise exception 'GUARD: another record already reads WR-2026-0003';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) into others_before from warranty_retentions r where r.id <> c_id;
  select sum(contributed_amount) into total_before from warranty_retentions where deleted_at is null;

  update warranty_retentions
     set ref_no = 'WR-2026-0003',
         history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'by', 'admin@dacsbuilding.com',
           'status', status,
           'note', 'Reference corrected from WR-2026-0001, which Los Churreros · Dapitan also read. Only the label changed.')),
         updated_at = now()
   where id = c_id;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'GUARD: % records changed, expected 1', n;
  end if;

  select * into after_row from warranty_retentions where id = c_id;
  if (to_jsonb(after_row) - 'ref_no' - 'history' - 'updated_at') is distinct from (to_jsonb(before_row) - 'ref_no' - 'history' - 'updated_at') then
    raise exception 'GUARD: something other than the reference changed on the record';
  end if;
  if jsonb_array_length(after_row.history) <> jsonb_array_length(coalesce(before_row.history, '[]'::jsonb)) + 1 then
    raise exception 'GUARD: the history did not gain exactly one line';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) into others_after from warranty_retentions r where r.id <> c_id;
  if others_after is distinct from others_before then
    raise exception 'GUARD: another record changed';
  end if;
  select sum(contributed_amount) into total_after from warranty_retentions where deleted_at is null;
  if total_after is distinct from total_before then
    raise exception 'GUARD: the fund total changed';
  end if;
  if (select count(*) from (select ref_no from warranty_retentions where deleted_at is null group by ref_no having count(*) > 1) d) <> 0 then
    raise exception 'GUARD: a reference is still repeated';
  end if;

  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): System Plus would read WR-2026-0003; reserve ₱%, fund total ₱% unchanged; no reference repeated.',
      round(after_row.contributed_amount, 2), round(total_after, 2);
  end if;
  raise notice 'CORRECTION DONE: System Plus reads WR-2026-0003; reserve ₱%, fund total ₱% unchanged; no reference repeated.',
    round(after_row.contributed_amount, 2), round(total_after, 2);
end $$;
