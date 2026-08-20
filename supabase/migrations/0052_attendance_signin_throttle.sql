-- ════════════════════════════════════════════════════════════════════
-- 0052_attendance_signin_throttle.sql
--
-- BRUTE-FORCE THROTTLE for the `attendance-signin` Edge Function.
--
-- ── WHY THIS EXISTS. The native Android worker app cannot solve the
--    Cloudflare Turnstile challenge this project enforces on auth:
--    Turnstile has no native Android SDK, and the only client-side way
--    to solve it is a WebView loading a web page — which the app is
--    deliberately not doing. Instead, `attendance-signin` signs the
--    worker in server-side with the service_role key, and service-role
--    callers skip the captcha check.
--
--    That trade is only safe with something in captcha's place. Worse:
--    GoTrue's own per-IP auth rate limit sees the EDGE FUNCTION's IP for
--    every worker in the country, so it protects nothing here. This
--    table is what replaces both.
--
-- ── WHAT IT IS NOT. Not an audit log of who signed in — that is
--    auth.audit_log_entries, which GoTrue writes on its own. Rows here
--    are throttle state and are deleted after 24 hours. Do not build a
--    report on them.
--
-- ── NO PASSWORDS, EVER. Only the lowercased email, the caller IP and
--    whether the attempt succeeded.
--
-- Idempotent. Safe on live and on a fresh database.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. The attempt log ──────────────────────────────────────────────
create table if not exists attendance_signin_attempts (
  id           bigserial primary key,
  email_key    text        not null,          -- lower(trim(email))
  ip           text,                          -- x-forwarded-for, may be null
  succeeded    boolean     not null default false,
  attempted_at timestamptz not null default now()
);

create index if not exists attendance_signin_attempts_email_idx
  on attendance_signin_attempts (email_key, attempted_at desc);
create index if not exists attendance_signin_attempts_ip_idx
  on attendance_signin_attempts (ip, attempted_at desc);

-- RLS on with NO policies at all: nothing but service_role (which
-- bypasses RLS) can read or write this. Workers must never be able to
-- see which accounts are being guessed at.
alter table attendance_signin_attempts enable row level security;


-- ── 2. Is this caller throttled? ────────────────────────────────────
-- Counts only FAILED attempts in the window, so a worker who logs in
-- successfully every morning never accumulates anything.
--
-- Two limits, deliberately different in kind:
--   · per email — stops one account being guessed at from many phones
--   · per IP    — stops one phone working through many accounts
-- The IP limit is the looser of the two because a whole site can sit
-- behind one mobile NAT, and locking out a crew at 07:45 because a
-- colleague fat-fingered their password is a worse failure than a slow
-- attacker.
create or replace function attendance_signin_is_throttled(
  p_email text,
  p_ip    text
) returns boolean
language sql
security definer
set search_path = public
as $$
  select
    (
      select count(*) >= 8
        from attendance_signin_attempts
       where email_key = lower(trim(coalesce(p_email, '')))
         and not succeeded
         and attempted_at > now() - interval '15 minutes'
    )
    or
    (
      p_ip is not null and (
        select count(*) >= 30
          from attendance_signin_attempts
         where ip = p_ip
           and not succeeded
           and attempted_at > now() - interval '15 minutes'
      )
    );
$$;


-- ── 3. Record an attempt ────────────────────────────────────────────
-- Also does the housekeeping: this table has no other reader, so a
-- sweep on write is cheaper than a cron job for 20 workers.
create or replace function attendance_signin_record(
  p_email     text,
  p_ip        text,
  p_succeeded boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into attendance_signin_attempts (email_key, ip, succeeded)
  values (lower(trim(coalesce(p_email, ''))), p_ip, coalesce(p_succeeded, false));

  delete from attendance_signin_attempts
   where attempted_at < now() - interval '24 hours';
end $$;


-- ── 4. Nobody but service_role calls these ──────────────────────────
-- The functions are security definer over a table workers cannot read;
-- leaving EXECUTE open to `authenticated` would let any signed-in user
-- probe which emails are locked out.
revoke execute on function attendance_signin_is_throttled(text, text) from public, anon, authenticated;
revoke execute on function attendance_signin_record(text, text, boolean) from public, anon, authenticated;
