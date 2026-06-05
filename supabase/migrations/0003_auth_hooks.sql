-- ════════════════════════════════════════════════════════════════════
-- Auto-provision a profile row for every auth user.
-- Guarantees profiles.id always exists (the unified identity table), so
-- self-signup (client portal) and the admin-create-user Edge Function can
-- simply UPSERT richer fields on top.
--
-- NOTE: For Firebase parity (no email-verification gate in the old app),
-- disable "Confirm email" in Supabase Auth settings, OR rely on this trigger
-- so the profile exists even before the first authenticated request.
-- ════════════════════════════════════════════════════════════════════
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, kind, role, status)
  values (new.id, new.email, 'client', 'client', 'active')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
