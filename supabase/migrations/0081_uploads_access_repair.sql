-- ════════════════════════════════════════════════════════════════════
-- 0081_uploads_access_repair.sql
--
-- WHO MAY READ / UPLOAD WHICH FILE in the `uploads` bucket.
--
-- Before this migration (verified live 2026-09-29) the bucket had five
-- catch-all policies. Two of them, uploads_read and uploads_insert, were
-- granted to PUBLIC and exist in NO migration (hand-made drift): a visitor
-- who was not logged in could list and download all 745 files (receipts,
-- quotations, signatures, worker agreements) and upload new ones. 0027's
-- own policies let ANY logged-in user (workers and every client included)
-- read every file too. 0027's "private bucket" only hid the public URL.
--
-- Now a file follows the same rule as the database row it belongs to:
--   • the uploader can always read back their own file (the shim uploads
--     with upsert:true and signs every read as the logged-in user);
--   • quotations/ and reimbursementReceipts/ are OWNER-only (0045, 0041);
--   • owner and staff read everything else (staff keep encoding access);
--   • a construction client / partner reads weeklyBillReceipts/,
--     procurementReceipts/, accomplishmentReports/ and projectTerms/ ONLY
--     under their own construction project's id: the same test as the
--     weekly_bills _client_read / _partner_read policies. (0019's partner
--     "signed agreement" gate is NOT live, so it is deliberately not used;
--     owner decision 2026-07-03, partners sign the first-login agreement);
--   • agreementDocs/ (signing-gate templates) is readable by anyone logged
--     in except workers;
--   • workers and team leaders read only employeeTermsGlobal/ and upload
--     only their own employee signature and signed-terms copy: the
--     first-login employee agreement gate in admin.html (js/admin.js).
--     Nothing else (their Attendance app uses the `attendance` bucket).
--
-- No JavaScript change: js/supabase-config.js §11b already signs as the
-- logged-in user. Live check: supabase/tests/uploads_access.sql.
-- CI guard: tests/storage-access.test.js. Undo (never re-opens public):
-- supabase/rollback_0081_uploads_access.sql.
--
-- ADDING A NEW UPLOAD FOLDER: it is owner/staff-only until you give it a
-- rule in uploads_can_read / uploads_can_write (new migration) and add it
-- to FOLDERS in tests/storage-access.test.js.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. text → uuid, or null (a policy must never raise mid-listing) ──
create or replace function public.dacs_try_uuid(p text)
returns uuid language sql immutable set search_path = public as $$
  select case
           when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then p::uuid
         end
$$;

-- ── 2. READ rule ──────────────────────────────────────────────────────
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

-- ── 3. UPLOAD rule ────────────────────────────────────────────────────
create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;
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

revoke all on function public.dacs_try_uuid(text) from public;
revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.dacs_try_uuid(text) from anon;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.dacs_try_uuid(text) to authenticated;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- ── 4. Replace the catch-all policies ─────────────────────────────────
drop policy if exists "uploads_read"          on storage.objects;  -- live-only drift, PUBLIC
drop policy if exists "uploads_insert"        on storage.objects;  -- live-only drift, PUBLIC
drop policy if exists "uploads_auth_select"   on storage.objects;  -- 0027
drop policy if exists "uploads_auth_insert"   on storage.objects;  -- 0027
drop policy if exists "uploads_admin_update"  on storage.objects;  -- 0032, recreated below
drop policy if exists "uploads_select_scoped" on storage.objects;
drop policy if exists "uploads_insert_scoped" on storage.objects;

create policy "uploads_select_scoped" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and public.uploads_can_read(name, owner_id));

create policy "uploads_insert_scoped" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and public.uploads_can_write(name));

-- Overwrite (the shim's upsert:true on an existing path): owner/staff as in
-- 0032, except the owner-only folders.
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              else (is_owner() or is_staff()) end);

-- Keep the bucket private (0027); harmless if already false.
update storage.buckets set public = false where id = 'uploads';
