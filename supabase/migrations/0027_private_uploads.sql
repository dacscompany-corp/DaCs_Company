-- ════════════════════════════════════════════════════════════════════
-- 0027_private_uploads.sql
--
-- PRIVATE STORAGE. The `uploads` bucket holds financial receipts (overhead,
-- weekly-bill, procurement), labor/outsource contract files, signature images
-- and agreement/terms PDFs. It has been PUBLIC since day one: anyone with a
-- link could read supplier names, amounts, invoice numbers and signatures,
-- and the path pattern (overheadReceipts/{uid}_{timestamp}.jpg) is guessable.
--
-- This flips the bucket private. Reads now require a SIGNED URL, which only
-- an authenticated user can mint (RLS below). The app resolves its stored
-- public-format URLs into signed URLs transparently — see section 11b of
-- js/supabase-config.js (clicks, <img>/<iframe>, fetch and window.open are
-- all covered globally; stored URLs in the DB stay untouched).
--
-- ⚠ DEPLOY ORDER MATTERS:
--     1. Deploy the updated js/supabase-config.js (+ print-utils.js) FIRST.
--     2. THEN run this migration.
--   Running this first breaks every receipt/PDF link until the JS ships.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

update storage.buckets set public = false where id = 'uploads';

-- Any logged-in user (owner, staff, client, partner) may read — signed-URL
-- creation is gated by this SELECT. Anonymous visitors cannot mint links.
drop policy if exists "uploads_auth_select" on storage.objects;
create policy "uploads_auth_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads');

-- Uploads come from logged-in sessions only (admin pages + the client/partner
-- procurement receipt flow).
drop policy if exists "uploads_auth_insert" on storage.objects;
create policy "uploads_auth_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads');

-- The shim uploads with upsert:true — overwriting an existing path needs UPDATE.
drop policy if exists "uploads_auth_update" on storage.objects;
create policy "uploads_auth_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads')
  with check (bucket_id = 'uploads');
