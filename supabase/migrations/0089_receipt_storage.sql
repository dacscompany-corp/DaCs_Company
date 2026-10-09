-- ════════════════════════════════════════════════════════════════════
-- 0089 — Receipt photos as files (spec docs/superpowers/specs/
-- 2026-10-08-receipt-photos-storage-design.md, plan 1).
--
-- ── WHY. Expense/payroll receipt photos are inline base64 in the rows
--    (~15 MB, growing daily); that froze Project Control on 2026-10-03.
--    New photos go to the private `uploads` bucket instead; the row keeps
--    the public-FORMAT URL (supabase-config.js §11b signs it on use).
--
-- ── WHAT.
--    1. Folders expenseReceipts/ and payrollReceipts/: read, write and
--       overwrite only by owner/staff of THAT company (path segment 2 =
--       data_owner_id()). 0081 let owner/staff of ANY company read generic
--       folders; these two are tenant-locked.
--    2. receipt_uploads: one row per uploaded file (pending → attached),
--       so plan 3's cleanup can remove files whose save never happened.
--    3. A trigger marks a file 'attached' in the same transaction as the
--       expenses/payroll row that references it.
--    4. client_submission_id + unique index: a retried save can never
--       create a second copy of an expense or payroll entry.
--
-- ── SAFE. No data changes. New column is nullable; existing rows untouched.
--    Grants: uploads_can_read/write keep 0081's (authenticated only, not anon);
--    receipt_uploads is select + insert(path, owner_id, kind) for authenticated
--    only; the helper functions are not executable by anon.
-- ════════════════════════════════════════════════════════════════════

-- One transaction in the SQL editor: if a long read holds expenses/payroll,
-- give up after 5 s instead of stalling every file view. Safe to re-run.
set local lock_timeout = '5s';

-- ── 1. Storage rules ─────────────────────────────────────────────────
create or replace function public.uploads_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_pid    uuid := dacs_try_uuid(split_part(p_name, '/', 2));
begin
  if v_uid is null then return false; end if;

  -- The uploader can always read back their own file.
  if p_owner_id is not null and p_owner_id = v_uid::text then return true; end if;

  -- Owner-only modules (quotations 0045, reimbursements 0041).
  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- Owner and staff: everything else (staff encode receipts from here).
  if is_owner() or is_staff() then return true; end if;

  -- Construction client / partner: files filed under THEIR project. Same
  -- test as the weekly_bills _client_read / _partner_read policies.
  if v_folder in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms') then
    return v_pid is not null
       and (cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid));
  end if;

  -- Employee agreement PDF: every non-owner admin role (staff, worker,
  -- teamLeader) signs it at first login in admin.html (js/admin.js).
  if v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false); end if;

  -- Agreement templates shown at the client/partner signing gates.
  -- coalesce: a profile with a NULL role must not be denied (NOT NULL = NULL).
  if v_folder = 'agreementDocs' then return not coalesce(is_worker(), false); end if;

  return false;
end $$;

create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  if is_owner() or is_staff() then return true; end if;
  -- Signatures. Clients/partners (js/client-management-app.js):
  --   signatures/<uid>_<ts>.png  and  signatures/proj_<project>_<uid>_<ts>.png
  -- Workers/team leaders (employee agreement gate, js/admin.js):
  --   signatures/employee_<uid>_<ts>.png  only
  if v_folder = 'signatures' then
    if coalesce(is_worker(), false) then
      return p_name ~ ('^signatures/employee_' || v_uid::text || '_[0-9]+\.png$');
    end if;
    return p_name ~ ('^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\.png$');
  end if;
  --   signed-terms/<uid>/<ts>_<name>.pdf   (dacsSnapshotPdf, every signing gate)
  if v_folder = 'signed-terms'  then return v_seg2 = v_uid::text; end if;

  -- Workers and team leaders upload nothing else.
  if coalesce(is_worker(), false) then return false; end if;
  --   procurementReceipts/<project>/…  (client "bought by client" receipt; clients only,
  --   partners are read-only, same as the procurement_client_update table policy)
  if v_folder = 'procurementReceipts' then
    return dacs_try_uuid(v_seg2) is not null and cproj_client_can_read(dacs_try_uuid(v_seg2));
  end if;

  return false;
end $$;

revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- Overwrite (0081's shape) + the receipt folders tenant-locked. New receipt
-- uploads use upsert:false and never overwrite; this closes the door anyway.
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end);

-- ── 2. Upload ledger ─────────────────────────────────────────────────
create table if not exists public.receipt_uploads (
  path        text primary key
              check (path ~ '^(expenseReceipts|payrollReceipts)/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$'),
  owner_id    uuid not null references public.profiles(id),
  kind        text not null check (kind in ('expense', 'payroll')),
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  state       text not null default 'pending' check (state in ('pending', 'attached', 'migrated', 'deleted')),
  created_at  timestamptz not null default now(),
  attached_at timestamptz,
  deleted_at  timestamptz
);
create index if not exists receipt_uploads_pending_idx on public.receipt_uploads (created_at) where state = 'pending';
alter table public.receipt_uploads enable row level security;

drop policy if exists receipt_uploads_insert on public.receipt_uploads;
create policy receipt_uploads_insert on public.receipt_uploads
  for insert to authenticated
  with check ((is_owner() or is_staff())
              and owner_id = data_owner_id()
              and uploaded_by = auth.uid()
              and state = 'pending'
              and split_part(path, '/', 2) = owner_id::text
              and split_part(path, '/', 1) = case kind when 'expense' then 'expenseReceipts' else 'payrollReceipts' end);
drop policy if exists receipt_uploads_select on public.receipt_uploads;
create policy receipt_uploads_select on public.receipt_uploads
  for select to authenticated
  using (can_access(owner_id));
-- No update/delete policies: state changes only through the trigger below
-- (and, in plans 2–3, owner/service functions).

-- Explicit grants (0073 precedent): no anon access at all; authenticated may
-- read (RLS-scoped) and insert ONLY path, owner_id, kind — uploaded_by,
-- state and every timestamp always take their defaults.
revoke all on public.receipt_uploads from public, anon, authenticated;
grant select on public.receipt_uploads to authenticated;
grant insert (path, owner_id, kind) on public.receipt_uploads to authenticated;

-- ── 3. Attach trigger ────────────────────────────────────────────────
-- Storage paths named by a list of photo values ('data:' values are skipped).
create or replace function public.receipt_paths_of(p_values text[]) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(substring(v from '/storage/v1/object/public/uploads/([^?#]+)')), '{}')
    from unnest(p_values) v
   where v like '%/storage/v1/object/public/uploads/%'
$$;
revoke all on function public.receipt_paths_of(text[]) from public, anon;

create or replace function public.receipt_mark_attached() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_vals text[];
begin
  if tg_table_name = 'expenses' then
    v_vals := array[new.po_image_url, new.delivery_receipt_url, new.supplier_invoice_url, new.payment_receipt_url];
  else
    select coalesce(array_agg(x), '{}') into v_vals
      from jsonb_array_elements_text(case when jsonb_typeof(new.receipt_images) = 'array'
                                          then new.receipt_images else '[]'::jsonb end) x;
  end if;
  update receipt_uploads
     set state = 'attached', attached_at = now()
   where state = 'pending' and owner_id = new.owner_id and path = any (receipt_paths_of(v_vals));
  return null;
end $$;
revoke all on function public.receipt_mark_attached() from public, anon;

drop trigger if exists expenses_receipt_attach on public.expenses;
create trigger expenses_receipt_attach
  after insert or update of po_image_url, delivery_receipt_url, supplier_invoice_url, payment_receipt_url
  on public.expenses for each row execute function public.receipt_mark_attached();
drop trigger if exists payroll_receipt_attach on public.payroll;
create trigger payroll_receipt_attach
  after insert or update of receipt_images
  on public.payroll for each row execute function public.receipt_mark_attached();

-- ── 4. Duplicate-proof saving ────────────────────────────────────────
alter table public.expenses add column if not exists client_submission_id uuid;
alter table public.payroll  add column if not exists client_submission_id uuid;
create unique index if not exists expenses_client_submission_uniq
  on public.expenses (client_submission_id, coalesce(split_index, 1)) where client_submission_id is not null;
create unique index if not exists payroll_client_submission_uniq
  on public.payroll (client_submission_id, coalesce(split_index, 1)) where client_submission_id is not null;
