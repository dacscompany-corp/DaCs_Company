-- 0083: record the storage policy that lets a worker REPLACE their own attendance photo.
--
-- Both worker apps (DACS Attendance and DAC'S WorkMate) upload with upsert=true, so a
-- retry after a failed Time In / Time Out RPC overwrites the same object path -- an UPDATE
-- on storage.objects. This policy existed only in the live database (found 2026-09-30);
-- 0050 created INSERT and SELECT only. Applying this file live is a no-op.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'attendance: worker replaces own photo'
  ) then
    create policy "attendance: worker replaces own photo" on storage.objects
      for update to authenticated
      using (bucket_id = 'attendance' and (storage.foldername(name))[1] = (auth.uid())::text)
      with check (bucket_id = 'attendance' and (storage.foldername(name))[1] = (auth.uid())::text);
  end if;
end $$;
