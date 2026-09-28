-- 0080 — Close two holes 0079 left open on its owner-only functions.
--
-- ── FOUND 2026-09-28, the day 0079 was applied: a SIGNED-OUT request
--    (anon key only) to /rest/v1/rpc/app_list_releases returned 200 `[]`
--    instead of OWNER_REQUIRED. Two separate mistakes, both needed:
--
--  1. THE GRANT. 0079 revoked execute `from public` and granted it to
--     authenticated. That revoke was decorative: this project's default
--     privileges grant execute on every new function DIRECTLY to anon,
--     and a named-role grant is untouched by revoking PUBLIC. 0067 wrote
--     this rule down after hitting it the first time; 0079 missed it.
--     Fixed by revoking from anon BY NAME.
--
--  2. THE CHECK. `if not is_owner()` -- but is_owner() is
--     `auth_role() = 'owner'`, and auth_role() is NULL for a caller with
--     no profiles row (anon). `NULL = 'owner'` is NULL, `not NULL` is
--     NULL, and IF treats NULL as false: the refusal never ran. Fixed as
--     `is_owner() is not true`, which refuses NULL too. Either fix alone
--     closes the hole; both are applied so neither is load-bearing alone.
--
-- ── WHAT WAS EXPOSED. app_list_releases: the release list (version,
--    notes, size, hash) -- all of it already public through
--    app_latest_release and the public bucket, so nothing new leaked.
--    app_publish_release: an anon caller passed the owner check, but
--    could not have published -- it would need an APK already sitting in
--    the bucket under the new version's name, and uploading one is
--    owner-only (0079's storage policy, which uses is_owner() in a
--    policy, where NULL already means "no"). Closed anyway, not trusted.
--
-- app_latest_release stays callable by anon ON PURPOSE: a phone must be
-- able to ask before sign-in (see 0079's header).
--
-- Idempotent: create or replace, and revoke is naturally so.

create or replace function app_list_releases()
returns setof app_releases
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- is_owner() is NULL, not false, for a caller with no profile row
  -- (anon) -- and `if not NULL` does not fire. See this file's header.
  if is_owner() is not true then
    raise exception 'OWNER_REQUIRED' using errcode = 'P0001';
  end if;
  return query select * from app_releases order by version_code desc;
end;
$$;

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
  -- is_owner() is NULL, not false, for a caller with no profile row
  -- (anon) -- and `if not NULL` does not fire. See this file's header.
  if is_owner() is not true then
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function app_list_releases() from anon;
    revoke execute on function app_publish_release(integer, text, text, bigint, text) from anon;
  end if;
end;
$$;

revoke all on function app_list_releases() from public;
revoke all on function app_publish_release(integer, text, text, bigint, text) from public;
grant execute on function app_list_releases() to authenticated;
grant execute on function app_publish_release(integer, text, text, bigint, text) to authenticated;
