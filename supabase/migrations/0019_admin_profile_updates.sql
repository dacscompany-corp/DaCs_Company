-- 0019_admin_profile_updates.sql
-- The admin's Client Management edits (Account type client↔partner, names,
-- Deactivate) SILENTLY never persisted: RLS on profiles only allowed
-- self-updates (id = auth.uid()), and the profiles_guard trigger blocked ANY
-- role change by an authenticated user — so the UI showed "saved" while the
-- database updated zero rows and the change reverted on refresh.
--
-- This lets owner/staff admins update profile rows, with the guard rewritten
-- so privilege escalation stays impossible:
--   • service_role (edge function) remains fully exempt, as before;
--   • an admin may change ROLE only on OTHER people's rows, and only between
--     the non-privileged values 'client' and 'partner';
--   • nobody can change their own role, anyone's owner_id, or touch
--     privileged roles (owner/staff/worker/teamLeader) from the client.

create or replace function profiles_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role or new.owner_id is distinct from old.owner_id then
      if not (is_owner() or is_staff()) then
        raise exception 'not allowed to change role/owner_id';
      end if;
      if old.id = auth.uid() then
        raise exception 'not allowed to change your own role';
      end if;
      if new.owner_id is distinct from old.owner_id then
        raise exception 'not allowed to change owner_id';
      end if;
      if coalesce(old.role, 'client') not in ('client', 'partner')
         or coalesce(new.role, 'client') not in ('client', 'partner') then
        raise exception 'role may only be changed between client and partner';
      end if;
    end if;
  end if;
  return new;
end $$;

-- Owner/staff may update profile rows (names, status, role per the guard above).
drop policy if exists profiles_admin_update on profiles;
create policy profiles_admin_update on profiles for update
  using (is_owner() or is_staff())
  with check (is_owner() or is_staff());
