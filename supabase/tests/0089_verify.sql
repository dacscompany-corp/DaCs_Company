-- 0089 receipt storage — live checks. Wraps itself in begin/rollback.
-- Self-rolling-back and safe to run in the Supabase SQL editor: no temp table
-- (context lives in transaction-local settings v89.*). Dry run = begin; + the 0089
-- migration + this file.
-- Success ends with the row '0089 verify: all checks passed'.
begin;
do $$
declare v_w7 uuid; v_owner uuid; v_staff uuid; v_other uuid; v_path text; v_path2 text; v_path3 text; v_path4 text;
begin
  select id into v_w7 from profiles where worker_no = 7 and role = 'worker';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  select id into v_other from profiles where role = 'owner' and id <> v_owner limit 1;
  assert v_w7 is not null and v_owner is not null and v_staff is not null and v_other is not null, 'need W-0007, its owner, a staff account and another owner';
  v_path  := 'expenseReceipts/' || v_owner || '/2026-10/' || gen_random_uuid() || '.jpg';
  v_path2 := 'payrollReceipts/' || v_owner || '/2026-10/' || gen_random_uuid() || '.jpg';
  v_path3 := 'expenseReceipts/' || v_owner || '/2026-10/' || gen_random_uuid() || '.jpg';
  v_path4 := 'expenseReceipts/' || v_owner || '/2026-10/' || gen_random_uuid() || '.jpg';
  perform set_config('v89.w7', v_w7::text, true);
  perform set_config('v89.owner', v_owner::text, true);
  perform set_config('v89.staff', v_staff::text, true);
  perform set_config('v89.other', v_other::text, true);
  perform set_config('v89.path', v_path::text, true);
  perform set_config('v89.path2', v_path2::text, true);
  perform set_config('v89.path3', v_path3::text, true);
  perform set_config('v89.path4', v_path4::text, true);
end $$;

-- ── 1. Storage rules per role ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v89.owner'), 'role', 'authenticated')::text, true);
do $$ begin
  assert uploads_can_read(current_setting('v89.path'), null), 'owner reads own company receipt';
  assert uploads_can_write(current_setting('v89.path')), 'owner writes own company receipt';
  assert not uploads_can_write('expenseReceipts/' || gen_random_uuid() || '/2026-10/' || gen_random_uuid() || '.jpg'), 'owner cannot write under another company';
  insert into receipt_uploads (path, owner_id, kind) values (current_setting('v89.path'), current_setting('v89.owner')::uuid, 'expense');
  insert into receipt_uploads (path, owner_id, kind) values (current_setting('v89.path2'), current_setting('v89.owner')::uuid, 'payroll');
  begin
    insert into receipt_uploads (path, owner_id, kind) values ('payrollReceipts/' || current_setting('v89.owner') || '/2026-10/' || gen_random_uuid() || '.jpg', current_setting('v89.owner')::uuid, 'expense');
    assert false, 'ledger accepted a kind/folder mismatch';
  exception when check_violation or insufficient_privilege then null; end;
  begin
    insert into receipt_uploads (path, owner_id, kind) values ('expenseReceipts/' || current_setting('v89.other') || '/2026-10/' || gen_random_uuid() || '.jpg', current_setting('v89.owner')::uuid, 'expense');
    assert false, 'ledger accepted another company''s path';
  exception when insufficient_privilege or check_violation then null; end;
  begin
    insert into receipt_uploads (path, owner_id, kind, state) values ('expenseReceipts/' || current_setting('v89.owner') || '/2026-10/' || gen_random_uuid() || '.jpg', current_setting('v89.owner')::uuid, 'expense', 'attached');
    assert false, 'ledger accepted a non-pending insert';
  exception when insufficient_privilege or check_violation then null; end;
  insert into receipt_uploads (path, owner_id, kind) values (current_setting('v89.path3'), current_setting('v89.owner')::uuid, 'expense');
  insert into receipt_uploads (path, owner_id, kind) values (current_setting('v89.path4'), current_setting('v89.owner')::uuid, 'expense');
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v89.staff'), 'role', 'authenticated')::text, true);
do $$ begin
  assert uploads_can_read(current_setting('v89.path'), null), 'staff reads own company receipt';
  assert uploads_can_write(current_setting('v89.path')), 'staff writes own company receipt';
  assert (select count(*) from receipt_uploads where path in (current_setting('v89.path'), current_setting('v89.path2'))) = 2, 'staff sees the company ledger';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v89.w7'), 'role', 'authenticated')::text, true);
do $$ begin
  assert not uploads_can_read(current_setting('v89.path'), null), 'a worker cannot read receipts';
  assert not uploads_can_write(current_setting('v89.path')), 'a worker cannot upload receipts';
  assert (select count(*) from receipt_uploads) = 0, 'a worker sees no ledger rows';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v89.other'), 'role', 'authenticated')::text, true);
do $$ begin
  assert not uploads_can_read(current_setting('v89.path'), null), 'another company''s owner cannot read';
  assert not uploads_can_write(current_setting('v89.path')), 'another company''s owner cannot write';
end $$;

-- ── 2. Attach trigger + duplicate-proof index (as the database owner) ──
reset role;
do $$
declare v_url text := 'https://x.supabase.co/storage/v1/object/public/uploads/' || current_setting('v89.path');
        v_url2 text := 'https://x.supabase.co/storage/v1/object/public/uploads/' || current_setting('v89.path2');
        v_sub uuid := gen_random_uuid();
        v_owner uuid := current_setting('v89.owner')::uuid;
begin
  assert receipt_paths_of(array['data:image/jpeg;base64,AAAA', v_url, null]) = array[current_setting('v89.path')], 'path extraction skips data: and null';
  insert into expenses (owner_id, expense_name, amount, payment_receipt_url, client_submission_id, split_index)
  values (v_owner, 'ZZ 0089 verify', 10, v_url, v_sub, 1);
  assert (select state from receipt_uploads where path = current_setting('v89.path')) = 'attached', 'expense insert attaches its file';
  insert into payroll (owner_id, worker_name, total_salary, receipt_images, client_submission_id)
  values (v_owner, 'ZZ 0089 verify', 10, jsonb_build_array('data:image/jpeg;base64,AAAA', v_url2), gen_random_uuid());
  assert (select state from receipt_uploads where path = current_setting('v89.path2')) = 'attached', 'payroll insert attaches its file';
  begin
    insert into expenses (owner_id, expense_name, amount, client_submission_id, split_index) values (v_owner, 'ZZ dup', 10, v_sub, 1);
    assert false, 'a second row with the same submission and split index was accepted';
  exception when unique_violation then null; end;
  insert into expenses (owner_id, expense_name, amount, client_submission_id, split_index) values (v_owner, 'ZZ split 2', 5, v_sub, 2);
  insert into expenses (owner_id, expense_name, amount) values (v_owner, 'ZZ legacy null', 1), (v_owner, 'ZZ legacy null', 1);
  -- UPDATE path of the trigger: adding a photo to an existing row attaches it.
  update expenses set po_image_url = 'https://x.supabase.co/storage/v1/object/public/uploads/' || current_setting('v89.path3') where expense_name = 'ZZ 0089 verify';
  assert (select state from receipt_uploads where path = current_setting('v89.path3')) = 'attached', 'expense update attaches its file';
  -- Cross-company guard: another company's row must not flip this company's ledger entry.
  insert into expenses (owner_id, expense_name, amount, payment_receipt_url)
  values (current_setting('v89.other')::uuid, 'ZZ 0089 cross', 1, 'https://x.supabase.co/storage/v1/object/public/uploads/' || current_setting('v89.path4'));
  assert (select state from receipt_uploads where path = current_setting('v89.path4')) = 'pending', 'another company''s row cannot attach this company''s file';
  assert not has_table_privilege('anon', 'public.receipt_uploads', 'select'), 'anon must not read the ledger';
  assert not has_table_privilege('authenticated', 'public.receipt_uploads', 'update'), 'authenticated must not update the ledger';
  assert not has_table_privilege('authenticated', 'public.receipt_uploads', 'delete'), 'authenticated must not delete ledger rows';
end $$;

select '0089 verify: all checks passed' as result;
rollback;
