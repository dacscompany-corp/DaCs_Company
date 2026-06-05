-- ════════════════════════════════════════════════════════════════════
-- RESET the public schema to a clean slate, then re-run 0001 → 0002 → 0003.
-- Safe on a fresh project (no real data yet). Destroys ALL tables/functions
-- in `public`. Does NOT touch auth users or storage.
-- (This is Supabase's official "reset" snippet — restores default grants.)
-- ════════════════════════════════════════════════════════════════════
drop schema if exists public cascade;
create schema public;

grant usage on schema public to anon, authenticated, service_role;
grant all   on all tables    in schema public to anon, authenticated, service_role;
grant all   on all routines  in schema public to anon, authenticated, service_role;
grant all   on all sequences in schema public to anon, authenticated, service_role;

alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on routines  to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

-- If you previously ran 0003 (the auth trigger), drop it too so it can be re-created:
drop trigger if exists on_auth_user_created on auth.users;
