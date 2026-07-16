-- ════════════════════════════════════════════════════════════════════
-- 0032_uploads_no_overwrite.sql
--
-- TIGHTEN STORAGE WRITES. Migration 0027 made the `uploads` bucket private
-- but left three policies that only check `bucket_id = 'uploads'` — so ANY
-- authenticated user (owner, staff, client, partner) could not only INSERT
-- new objects but also UPDATE (overwrite) ANY existing object in the bucket.
--
-- The overwrite grant is the dangerous one: object paths are guessable
-- (signatures/{uid}_{ts}.png, signed-terms/{uid}/…, procurementReceipts/…,
-- expenseInbox/{ts}_…), and the storage shim uploads with upsert:true. A
-- client could therefore overwrite a signed agreement PDF, a signature image
-- or another project's receipt with a file of their own — silent tampering
-- with financial/e-sign evidence.
--
-- Every legitimate upload in the app writes a UNIQUE path (all of them embed
-- Date.now()), so no flow actually depends on overwriting an existing object.
-- We therefore restrict UPDATE to owner/staff only. Clients keep INSERT (the
-- procurement-receipt and signature flows need it) but can no longer overwrite
-- anything already in the bucket. Admin upsert:true still works because the
-- admin pages run as owner/staff.
--
-- SELECT (signed-URL creation) is unchanged: any logged-in user may read, as
-- before — receipts/agreements are shown across the client & partner portals.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- Overwriting an existing object now requires owner/staff. Clients/partners
-- can still create new objects (INSERT policy from 0027 is left in place).
drop policy if exists "uploads_auth_update"  on storage.objects;
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using      (bucket_id = 'uploads' and (is_owner() or is_staff()))
  with check (bucket_id = 'uploads' and (is_owner() or is_staff()));
