-- ════════════════════════════════════════════════════════════════════
-- 0067_attendance_reward_grants.sql
--
-- CLOSES A HOLE 0066 LEFT OPEN, and corrects an assumption the older
-- attendance migrations have been making all along.
--
-- ── WHAT WAS WRONG. 0066 deliberately did NOT grant execute on
--    attendance_week_days: it is security definer and takes a worker id,
--    so a grant lets any signed-in worker read any other worker's
--    attendance week simply by passing someone else's uuid. The file
--    says so in a comment and issues only:
--
--        revoke all on function attendance_week_days(uuid, date) from public;
--
--    0065_0066_verify.sql then reported the function GRANTED to
--    `authenticated` anyway.
--
-- ── WHY. `PUBLIC` and a named role are SEPARATE entries in a function's
--    ACL. This project carries Supabase's default privileges on schema
--    public, which grant execute on every newly created function to
--    anon, authenticated and service_role. Those grants are written
--    directly to the named roles, so revoking from PUBLIC does not touch
--    them -- it removes an entry that default privileges never created.
--
--    Every `revoke all ... from public` in 0050/0051/0059/0061/0065/0066
--    has therefore been decorative. It happens not to matter for the
--    other functions, because each of them is meant to be callable by
--    authenticated users and checks auth.uid() itself. It mattered here.
--
-- ── THE RULE GOING FORWARD. To keep a function off the client, revoke
--    from the ROLES, not from public. Naming them explicitly is the only
--    thing that works, and the verify script now checks anon as well.
--
-- Idempotent -- revoke is naturally so, and the roles are guarded in
-- case this is ever applied to a plain Postgres without Supabase's roles.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  -- ── 1. The hole ───────────────────────────────────────────────────
  -- attendance_week_days is INTERNAL. Its two callers,
  -- attendance_reward_progress and attendance_evaluate_week, are
  -- themselves security definer and reach it as the function owner, so
  -- they keep working with no grant at all. Every client goes through
  -- attendance_reward_progress, which checks who is asking.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function attendance_week_days(uuid, date) from authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function attendance_week_days(uuid, date) from anon';

    -- ── 2. Nothing in this feature is for signed-out callers ─────────
    -- The three reward RPCs already raise AUTH_REQUIRED when auth.uid()
    -- is null, so anon could never get an answer out of them. Revoking
    -- anyway is defence in depth: it costs nothing, and it means a
    -- future edit that drops an auth check does not silently open the
    -- function to the internet.
    execute 'revoke execute on function attendance_reward_progress(uuid, date) from anon';
    execute 'revoke execute on function attendance_evaluate_week(uuid, date) from anon';
    execute 'revoke execute on function attendance_reward_mark_paid(uuid, boolean) from anon';

    -- ── 3. The config helpers ────────────────────────────────────────
    -- These two have no auth check of their own -- they take an explicit
    -- owner id and answer from configuration. That is fine for a signed
    -- in worker reading their own employer's schedule, and not fine for
    -- an anonymous caller enumerating owners to learn their start times
    -- and closure dates. Authenticated keeps the grant; anon loses it.
    execute 'revoke execute on function attendance_start_time(text, uuid, uuid) from anon';
    execute 'revoke execute on function attendance_is_required_day(text, uuid, uuid, date) from anon';
  end if;
end $$;
