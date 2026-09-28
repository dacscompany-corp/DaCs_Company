-- 0079 — Publish a new worker APK from the admin portal; the app requires it.
--
-- ── WHY. The worker app is sideloaded (a direct APK link, not Google Play),
--    so nothing tells a phone a newer build exists. 0077 lets the office
--    REFUSE an old build's attendance, but the worker only learns that from a
--    failed Time In. This adds the other half: the office uploads the APK in
--    admin.html → Attendance → App updates, and every older phone shows a
--    non-dismissable "New Update is Available" dialog that downloads and
--    installs it (Dacs Attendance → ui/update/).
--
-- ── EVERY RELEASE IS REQUIRED (decided 2026-09-28). Publishing raises
--    attendance_config.min_app_version to the new versionCode in the SAME
--    transaction as the release row, so the dialog and 0077's refusal can
--    never disagree: a phone that is told to update is exactly a phone whose
--    Time In would be refused.
--
-- ── ROLLOUT HAZARD, same shape as 0077's. versionCode 4 is the first build
--    that has the dialog; phones on 3 cannot show it. Install 4 on every
--    phone the old way FIRST, and only then publish 4 here. Publishing it
--    earlier refuses Time In on phones that have nothing to explain why
--    beyond 0077's generic update-required notice. Applying THIS migration
--    changes no min_app_version on its own -- only a publish does.
--
-- ── NOTHING IS LOST WHEN IT REFUSES. See 0077: a refused row stays queued
--    on the phone and the new build resends it with its original shutter time.
--
-- ── WHY THE BUCKET IS PUBLIC. The check and the download must work before
--    sign-in: an out-of-date build may be exactly what stops a worker signing
--    in. An APK carries no secret -- the anon key in it is already public by
--    design (see the app's build.gradle.kts). Upload is owner-only, and a
--    published APK cannot be deleted, so no download link ever breaks.
--
-- ── WHY OWNER-ONLY. A publish locks every older phone out of attendance.
--    That is an owner-level consequence, same tier as Reimbursement (0041)
--    and Warranty Fund (0043).
--
-- Outside the money model, like all of attendance: no peso column, no
-- accounting side effect.

-- ── The releases ─────────────────────────────────────────────────────

create table if not exists app_releases (
  version_code  integer     primary key,
  version_name  text        not null,
  release_notes text,
  storage_path  text        not null unique,
  size_bytes    bigint      not null,
  sha256        text        not null,
  published_at  timestamptz not null default now(),
  published_by  uuid        references auth.users(id) on delete set null,

  constraint app_releases_code_ck   check (version_code > 0),
  constraint app_releases_name_ck   check (length(btrim(version_name)) between 1 and 40),
  constraint app_releases_notes_ck  check (release_notes is null or length(release_notes) <= 500),
  constraint app_releases_size_ck   check (size_bytes > 0),
  constraint app_releases_sha_ck    check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint app_releases_path_ck   check (storage_path = version_code::text || '.apk')
);

comment on table app_releases is
  'Worker APKs published from admin.html (0079). The highest version_code is '
  'the one every phone must run. Written only by app_publish_release().';

-- No policies at all: every read and write goes through the functions below.
alter table app_releases enable row level security;
revoke all on app_releases from anon, authenticated;


-- ── Storage ──────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-releases', 'app-releases', true, 52428800,
        array['application/vnd.android.package-archive'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists app_releases_owner_insert on storage.objects;
create policy app_releases_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'app-releases' and is_owner());

-- Only an upload that never became a release may be removed -- the portal
-- cleans up after a publish the RPC refused. A published APK is what phones
-- download; deleting it would strand every one of them mid-update.
drop policy if exists app_releases_owner_delete on storage.objects;
create policy app_releases_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'app-releases'
    and is_owner()
    and not exists (select 1 from app_releases r where r.storage_path = objects.name)
  );

-- The owner must be able to SEE an object to delete it (storage checks
-- select before delete). Public download goes through the public URL and
-- does not need this.
drop policy if exists app_releases_owner_select on storage.objects;
create policy app_releases_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'app-releases' and is_owner());


-- ── What the app asks: "what must I be running?" ─────────────────────

create or replace function app_latest_release()
returns table (
  version_code  integer,
  version_name  text,
  release_notes text,
  storage_path  text,
  size_bytes    bigint,
  sha256        text
)
language sql
stable
security definer
set search_path = public
as $$
  select r.version_code, r.version_name, r.release_notes,
         r.storage_path, r.size_bytes, r.sha256
    from app_releases r
   order by r.version_code desc
   limit 1;
$$;

revoke all on function app_latest_release() from public;
grant execute on function app_latest_release() to anon, authenticated;


-- ── What the portal lists ────────────────────────────────────────────

create or replace function app_list_releases()
returns setof app_releases
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_owner() then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0001';
  end if;
  return query select * from app_releases order by version_code desc;
end;
$$;

revoke all on function app_list_releases() from public;
grant execute on function app_list_releases() to authenticated;


-- ── Publishing ───────────────────────────────────────────────────────

create or replace function app_publish_release(
  p_version_code  integer,
  p_version_name  text,
  p_release_notes text,
  p_size_bytes    bigint,
  p_sha256        text
)
returns app_releases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path     text := p_version_code::text || '.apk';
  v_latest   integer;
  v_min      integer;
  v_obj_size bigint;
  v_row      app_releases;
begin
  if not is_owner() then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0001';
  end if;

  -- One publish at a time: two owners racing must not both pass the
  -- "newer than latest" check with the same number.
  lock table app_releases in share row exclusive mode;

  select coalesce(max(version_code), 0) into v_latest from app_releases;
  select coalesce(max(min_app_version), 0) into v_min from attendance_config;

  -- Never a downgrade, and never a number phones already had to exceed.
  -- A mistake is fixed by publishing a HIGHER build, not by going back.
  if p_version_code is null or p_version_code <= greatest(v_latest, v_min) then
    raise exception 'VERSION_NOT_NEWER' using errcode = 'P0001',
      detail = format('latest=%s min_app_version=%s', v_latest, v_min);
  end if;

  -- The file must already be in the bucket, and be the size the browser
  -- measured. The hash is checked by every phone before installing.
  select (o.metadata ->> 'size')::bigint into v_obj_size
    from storage.objects o
   where o.bucket_id = 'app-releases' and o.name = v_path;

  if v_obj_size is null then
    raise exception 'APK_NOT_UPLOADED' using errcode = 'P0001';
  end if;
  if v_obj_size <> p_size_bytes then
    raise exception 'APK_SIZE_MISMATCH' using errcode = 'P0001',
      detail = format('uploaded=%s declared=%s', v_obj_size, p_size_bytes);
  end if;

  insert into app_releases (version_code, version_name, release_notes,
                            storage_path, size_bytes, sha256, published_by)
  values (p_version_code, btrim(p_version_name),
          nullif(btrim(coalesce(p_release_notes, '')), ''),
          v_path, p_size_bytes, lower(p_sha256), auth.uid())
  returning * into v_row;

  -- One APK serves every owner's workers, so every config row moves.
  -- The publisher gets a row if they had none, or 0077 would read "off"
  -- for their workers while the dialog was already asking them to update.
  update attendance_config
     set min_app_version = p_version_code
   where min_app_version < p_version_code;

  insert into attendance_config (owner_id, min_app_version)
  values (auth.uid(), p_version_code)
  on conflict (owner_id) do nothing;

  return v_row;
end;
$$;

revoke all on function app_publish_release(integer, text, text, bigint, text) from public;
grant execute on function app_publish_release(integer, text, text, bigint, text) to authenticated;
