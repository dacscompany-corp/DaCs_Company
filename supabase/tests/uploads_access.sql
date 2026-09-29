-- ════════════════════════════════════════════════════════════════════
-- uploads_access.sql — LIVE check of who can see / upload what in the
-- `uploads` storage bucket (migration 0081).
--
-- SAFE ON PRODUCTION: everything runs in one transaction that is always
-- ROLLED BACK, it writes no rows, and every check is a read. It acts as
-- real accounts by setting the same JWT claims PostgREST sets, switching
-- to the `authenticated` / `anon` role, counting what storage RLS lets
-- through, and switching back to compare as postgres.
--
-- Run: paste into the Supabase SQL editor, or via the Supabase MCP
-- execute_sql tool, or  psql "$DB_URL" -f supabase/tests/uploads_access.sql
-- Pass:  one row  'uploads access: all checks passed'
-- Fail:  ERROR  'FAIL: <which check>'  (stops at the first failure)
--
-- The expectation (pg_temp.expected_for) is written independently of the
-- policy functions, as plain joins, so a bug in one is caught by the other.
-- ════════════════════════════════════════════════════════════════════
begin;

create function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAIL: %', p_label; end if;
end $$;

-- Set the JWT claims for an account (call as postgres; takes effect when
-- the role is switched to authenticated).
create function pg_temp.act_as(p_uid uuid) returns void
language plpgsql as $$
declare v_email text;
begin
  if p_uid is null then raise exception 'FAIL: fixture account missing'; end if;
  select email into v_email from auth.users where id = p_uid;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'email', v_email, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end $$;

-- What an account SHOULD see, from the access map, as plain joins.
create function pg_temp.expected_for(p_uid uuid) returns int
language sql as $$
  with me as (
    select p.id, lower(u.email) as email, coalesce(p.role, '') as role
      from profiles p join auth.users u on u.id = p.id
     where p.id = p_uid
  ),
  mine as (
    select c.id from construction_projects c, me
     where lower(c.client_email) = me.email or lower(c.partner_email) = me.email
  )
  select count(*)::int
    from storage.objects o, me
   where o.bucket_id = 'uploads'
     and (   o.owner_id = p_uid::text
          or (split_part(o.name, '/', 1) in ('quotations', 'reimbursementReceipts') and me.role = 'owner')
          or (split_part(o.name, '/', 1) not in ('quotations', 'reimbursementReceipts') and me.role in ('owner', 'staff'))
          or (split_part(o.name, '/', 1) in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms')
              and split_part(o.name, '/', 2) in (select id::text from mine))
          or (split_part(o.name, '/', 1) = 'employeeTermsGlobal' and me.role in ('worker', 'teamLeader'))
          or (split_part(o.name, '/', 1) = 'agreementDocs' and me.role not in ('worker', 'teamLeader')))
$$;

-- ── Fixtures: one real account per role (all exist on 2026-09-29) ─────
select set_config('t.owner',   (select id::text from profiles where role = 'owner' and owner_id is null limit 1), true);
select set_config('t.subowner',(select id::text from profiles where role = 'owner' and owner_id is not null limit 1), true);
select set_config('t.staff',   (select id::text from profiles where role = 'staff' limit 1), true);
select set_config('t.worker',  (select id::text from profiles where role in ('worker', 'teamLeader')
                                  and coalesce(status, 'active') = 'active' limit 1), true);
select set_config('t.client',  (select p.id::text from profiles p join construction_projects c
                                   on lower(c.client_email) = lower(p.email)
                                 where exists (select 1 from storage.objects o where o.bucket_id = 'uploads'
                                                 and o.name like 'weeklyBillReceipts/' || c.id || '/%')
                                 limit 1), true);
select set_config('t.client_pid', (select c.id::text from construction_projects c
                                     join profiles p on lower(c.client_email) = lower(p.email)
                                    where p.id::text = current_setting('t.client')
                                      and exists (select 1 from storage.objects o where o.bucket_id = 'uploads'
                                                    and o.name like 'weeklyBillReceipts/' || c.id || '/%')
                                    limit 1), true);
-- On 2026-09-29 ONE client account owns every PM project that has receipts,
-- so "another project's receipts" can't be a real file. The cross-project
-- checks use a project id that belongs to nobody, through the rule functions.
select set_config('t.other_pid', '00000000-0000-4000-8000-000000000000', true);
select set_config('t.partner', (select p.id::text from profiles p join construction_projects c
                                   on lower(c.partner_email) = lower(p.email) limit 1), true);
select set_config('t.design',  (select id::text from profiles where kind = 'client' limit 1), true);
select set_config('t.total',   (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);

-- A fixture that found no row reads back as '' (set_config stores NULL as an
-- empty string), so test for '' rather than NULL.
select pg_temp.check(current_setting('t.owner')      <> '', 'fixture: main owner account');
select pg_temp.check(current_setting('t.subowner')   <> '', 'fixture: sub-owner account');
select pg_temp.check(current_setting('t.staff')      <> '', 'fixture: staff account');
select pg_temp.check(current_setting('t.worker')     <> '', 'fixture: active worker account');
select pg_temp.check(current_setting('t.client')     <> '', 'fixture: construction client with receipts');
select pg_temp.check(current_setting('t.client_pid') <> '', 'fixture: that client''s project with receipts');
select pg_temp.check(not exists (select 1 from construction_projects where id::text = current_setting('t.other_pid')),
                 'fixture: the "nobody''s project" id really belongs to nobody');
select pg_temp.check(current_setting('t.partner')    <> '', 'fixture: partner account');
select pg_temp.check(current_setting('t.design')     <> '', 'fixture: design client account');

-- ── 0. Policy shape: no storage.objects policy at all is granted to ───
--    public/anon (a catch-all like `using (true)` would reach uploads too;
--    app-releases is a public BUCKET, which needs no public policy).
select pg_temp.check(not exists (
  select 1 from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and ('public' = any(roles) or 'anon' = any(roles))), 'no storage.objects policy is granted to public/anon');

-- ── 1. Not logged in: sees nothing ────────────────────────────────────
select set_config('request.jwt.claims', '', true);
set local role anon;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = 0, 'anon sees 0 uploads (saw ' || current_setting('t.seen') || ')');

-- ── 2. Every persona sees exactly its expected set ────────────────────
-- (repeated block: act_as → authenticated → count → back to postgres → compare)
select pg_temp.act_as(current_setting('t.owner')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = current_setting('t.total')::int
                 and current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.owner')::uuid),
                 'main owner sees every upload');

select pg_temp.act_as(current_setting('t.subowner')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.subowner')::uuid),
                 'sub-owner sees the owner set');

select pg_temp.act_as(current_setting('t.staff')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
select set_config('t.seen_q', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                  and split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts')
                                  and owner_id is distinct from auth.uid()::text), true);
select set_config('t.seen_inbox', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                      and split_part(name, '/', 1) = 'expenseInbox'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.staff')::uuid),
                 'staff sees exactly the staff set');
select pg_temp.check(current_setting('t.seen_q')::int = 0, 'staff sees no quotation / reimbursement files');
select pg_temp.check(current_setting('t.seen_inbox')::int =
                 (select count(*)::int from storage.objects where bucket_id = 'uploads' and split_part(name, '/', 1) = 'expenseInbox'),
                 'staff still sees every Expense Inbox receipt (encoding access kept)');

select pg_temp.act_as(current_setting('t.worker')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
select set_config('t.seen_other', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                      and split_part(name, '/', 1) <> 'employeeTermsGlobal'
                                      and owner_id is distinct from auth.uid()::text), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.worker')::uuid),
                 'worker sees exactly the worker set');
select pg_temp.check(current_setting('t.seen_other')::int = 0,
                 'worker sees nothing but the employee agreement PDF (saw ' || current_setting('t.seen_other') || ' other)');

select pg_temp.act_as(current_setting('t.client')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
select set_config('t.seen_own_wbr', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                        and name like 'weeklyBillReceipts/' || current_setting('t.client_pid') || '/%'), true);
select set_config('t.r_other_wbr', public.uploads_can_read(
                   'weeklyBillReceipts/' || current_setting('t.other_pid') || '/2026-09-01_0_0_1700000000000.jpg', null)::text, true);
select set_config('t.r_other_terms', public.uploads_can_read(
                   'projectTerms/' || current_setting('t.other_pid') || '/1700000000000_terms.pdf', null)::text, true);
select set_config('t.seen_admin', (select count(*)::text from storage.objects where bucket_id = 'uploads'
                                      and split_part(name, '/', 1) in ('expenseInbox', 'overheadReceipts', 'quotations',
                                          'reimbursementReceipts', 'workerAgreements', 'laborContractFiles')), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.client')::uuid),
                 'construction client sees exactly their set');
select pg_temp.check(current_setting('t.seen_own_wbr')::int > 0, 'client still sees their own project receipts');
select pg_temp.check(not current_setting('t.r_other_wbr')::boolean,   'client may not read another project''s receipts');
select pg_temp.check(not current_setting('t.r_other_terms')::boolean, 'client may not read another project''s terms');
select pg_temp.check(current_setting('t.seen_admin')::int = 0, 'client sees no admin-only files');

select pg_temp.act_as(current_setting('t.partner')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.partner')::uuid),
                 'partner sees exactly their set');

select pg_temp.act_as(current_setting('t.design')::uuid);
set local role authenticated;
select set_config('t.seen', (select count(*)::text from storage.objects where bucket_id = 'uploads'), true);
reset role;
select pg_temp.check(current_setting('t.seen')::int = pg_temp.expected_for(current_setting('t.design')::uuid),
                 'design client sees only templates and their own files');

-- ── 3. Upload rule, per persona (needs 0081's uploads_can_write) ──────
select pg_temp.act_as(current_setting('t.client')::uuid);
set local role authenticated;
select set_config('t.w_own_proc',   public.uploads_can_write('procurementReceipts/' || current_setting('t.client_pid') || '/x_client_1.jpg')::text, true);
select set_config('t.w_other_proc', public.uploads_can_write('procurementReceipts/' || current_setting('t.other_pid') || '/x_client_1.jpg')::text, true);
select set_config('t.w_sig',        public.uploads_can_write('signatures/' || auth.uid() || '_1700000000000.png')::text, true);
select set_config('t.w_sig_proj',   public.uploads_can_write('signatures/proj_' || current_setting('t.client_pid') || '_' || auth.uid() || '_1700000000000.png')::text, true);
select set_config('t.w_sig_other',  public.uploads_can_write('signatures/' || current_setting('t.staff') || '_1700000000000.png')::text, true);
select set_config('t.w_terms',      public.uploads_can_write('signed-terms/' || auth.uid() || '/1700000000000_terms.pdf')::text, true);
select set_config('t.w_terms_other',public.uploads_can_write('signed-terms/' || current_setting('t.staff') || '/1700000000000_terms.pdf')::text, true);
select set_config('t.w_overhead',   public.uploads_can_write('overheadReceipts/x_1.jpg')::text, true);
reset role;
select pg_temp.check(current_setting('t.w_own_proc')::boolean,       'client may upload a receipt to their own project');
select pg_temp.check(not current_setting('t.w_other_proc')::boolean, 'client may not upload to another project');
select pg_temp.check(current_setting('t.w_sig')::boolean,            'client may upload their own signature');
select pg_temp.check(current_setting('t.w_sig_proj')::boolean,       'client may upload their own project-terms signature');
select pg_temp.check(not current_setting('t.w_sig_other')::boolean,  'client may not upload someone else''s signature');
select pg_temp.check(current_setting('t.w_terms')::boolean,          'client may snapshot signed terms under their own id');
select pg_temp.check(not current_setting('t.w_terms_other')::boolean,'client may not write under another user''s signed-terms');
select pg_temp.check(not current_setting('t.w_overhead')::boolean,   'client may not upload into admin folders');

select pg_temp.act_as(current_setting('t.worker')::uuid);
set local role authenticated;
select set_config('t.w_worker_sig',     public.uploads_can_write('signatures/' || auth.uid() || '_1700000000000.png')::text, true);
select set_config('t.w_worker_emp_sig', public.uploads_can_write('signatures/employee_' || auth.uid() || '_1700000000000.png')::text, true);
select set_config('t.w_worker_terms',   public.uploads_can_write('signed-terms/' || auth.uid() || '/1700000000000_employee-terms.pdf')::text, true);
select set_config('t.w_worker_proc',    public.uploads_can_write('procurementReceipts/' || current_setting('t.client_pid') || '/x.jpg')::text, true);
select set_config('t.w_worker_inbox',   public.uploads_can_write('expenseInbox/1700000000000_0_x.jpg')::text, true);
reset role;
select pg_temp.check(not current_setting('t.w_worker_sig')::boolean,   'worker may not upload a client-style signature');
select pg_temp.check(current_setting('t.w_worker_emp_sig')::boolean,   'worker may upload their own employee-agreement signature');
select pg_temp.check(current_setting('t.w_worker_terms')::boolean,     'worker may snapshot signed terms under their own id');
select pg_temp.check(not current_setting('t.w_worker_proc')::boolean,  'worker may not upload procurement receipts');
select pg_temp.check(not current_setting('t.w_worker_inbox')::boolean, 'worker may not upload to Expense Inbox');

select pg_temp.act_as(current_setting('t.staff')::uuid);
set local role authenticated;
select set_config('t.w_staff_inbox', public.uploads_can_write('expenseInbox/1700000000000_0_x.jpg')::text, true);
select set_config('t.w_staff_wbr',   public.uploads_can_write('weeklyBillReceipts/' || current_setting('t.client_pid') || '/x.jpg')::text, true);
select set_config('t.w_staff_quote', public.uploads_can_write('quotations/' || auth.uid() || '/x.jpg')::text, true);
reset role;
select pg_temp.check(current_setting('t.w_staff_inbox')::boolean,       'staff may upload to Expense Inbox');
select pg_temp.check(current_setting('t.w_staff_wbr')::boolean,         'staff may upload PM receipts');
select pg_temp.check(not current_setting('t.w_staff_quote')::boolean,   'staff may not upload quotation files');

select pg_temp.act_as(current_setting('t.owner')::uuid);
set local role authenticated;
select set_config('t.w_owner_quote', public.uploads_can_write('quotations/' || auth.uid() || '/x.jpg')::text, true);
reset role;
select pg_temp.check(current_setting('t.w_owner_quote')::boolean, 'owner may upload quotation files');

select 'uploads access: all checks passed' as result;
rollback;
