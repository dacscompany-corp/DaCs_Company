-- ════════════════════════════════════════════════════════════════════
-- 0028_client_errors.sql
--
-- CLIENT ERROR TELEMETRY. Until now, when the app broke in a client's or
-- partner's browser, nobody was told — you found out when they called.
-- js/supabase-config.js (§14) now reports uncaught JS errors and unhandled
-- promise rejections into this table (deduped, max 15 per session, fields
-- truncated client-side AND enforced here).
--
-- Read them in the Supabase SQL editor:
--   select at, page, kind, message, source, line, uid
--   from client_errors order by at desc limit 100;
--
-- Write-only for visitors (errors happen on login pages too, so anon may
-- insert); ONLY the owner can read. Nobody can update or delete via the API.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════

create table if not exists client_errors (
  id      bigint generated always as identity primary key,
  at      timestamptz default now(),
  kind    text,   -- 'error' | 'unhandledrejection'
  message text,
  source  text,   -- script URL
  line    int,
  col     int,
  stack   text,
  page    text,   -- location.pathname
  ua      text,   -- user agent
  uid     uuid    -- auth user id when logged in, else null
);

create index if not exists client_errors_at_idx on client_errors(at desc);

alter table client_errors enable row level security;

drop policy if exists client_errors_insert on client_errors;
create policy client_errors_insert on client_errors
  for insert to anon, authenticated
  with check (
    char_length(coalesce(message, '')) <= 500
    and char_length(coalesce(stack, ''))  <= 4000
    and char_length(coalesce(source, '')) <= 300
    and char_length(coalesce(page, ''))   <= 300
    and char_length(coalesce(ua, ''))     <= 300
    and char_length(coalesce(kind, ''))   <= 30
  );

drop policy if exists client_errors_select on client_errors;
create policy client_errors_select on client_errors
  for select to authenticated
  using (is_owner());
