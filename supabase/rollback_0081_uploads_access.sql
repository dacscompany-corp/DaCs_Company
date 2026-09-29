-- ════════════════════════════════════════════════════════════════════
-- rollback_0081_uploads_access.sql: EMERGENCY undo of 0081.
--
-- Use ONLY if 0081 breaks a legitimate reader and the fix can't wait.
-- Restores the 0027/0032 state: any LOGGED-IN user may read and upload,
-- owner/staff may overwrite. It deliberately does NOT restore the
-- hand-made uploads_read / uploads_insert policies that were granted to
-- PUBLIC. Not-logged-in visitors stay locked out even after a rollback.
--
-- The helper functions are left in place (unused, harmless). 0081 is
-- LIVE (applied 2026-09-29 through the SQL editor; it has no
-- schema_migrations row). Ship any corrected rules as a NEW migration
-- (0082), never re-apply a changed 0081. This file is an emergency
-- script, not a migration: after running it, re-run 0081 (unchanged)
-- to restore the scoped rules.
-- ════════════════════════════════════════════════════════════════════
begin;

drop policy if exists "uploads_select_scoped" on storage.objects;
drop policy if exists "uploads_insert_scoped" on storage.objects;
drop policy if exists "uploads_admin_update"  on storage.objects;
drop policy if exists "uploads_auth_select"   on storage.objects;
drop policy if exists "uploads_auth_insert"   on storage.objects;

create policy "uploads_auth_select" on storage.objects
  for select to authenticated using (bucket_id = 'uploads');
create policy "uploads_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'uploads');
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using      (bucket_id = 'uploads' and (is_owner() or is_staff()))
  with check (bucket_id = 'uploads' and (is_owner() or is_staff()));

commit;
