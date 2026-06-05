-- ════════════════════════════════════════════════════════════════════
-- Enable Realtime (live updates) on all public tables.
-- The Firestore-compat shim's .onSnapshot() listens to postgres_changes;
-- a table only broadcasts once it's in the `supabase_realtime` publication.
-- (New tables created via SQL are NOT auto-added, which is why edits only
-- showed after a manual refresh.)
-- Idempotent: skips tables already in the publication.
-- ════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in (
        select tablename from pg_publication_tables where pubname = 'supabase_realtime'
      )
  loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;
