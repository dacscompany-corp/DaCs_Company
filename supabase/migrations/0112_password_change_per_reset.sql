-- 0112 — WorkMate 3b-b: a password change confirms the reset it answers.
--
-- 0111's wk_password_changed() records "changed" for whatever reset is open
-- when the call arrives. A confirmation the phone sends late — its answer lost,
-- sent again at the next chance — can arrive after the main owner set a second
-- temporary password, and close that second reset although the worker never
-- changed it: they would keep a password the office knows, and never be asked.
-- And the order of the rows alone can't tell: a confirmation and a second reset
-- written at the same moment may land either way round.
--
-- So each "changed" row now names the reset it answers (reset_id), and a reset
-- stays open until a change names it. WorkMate 1012 reads the open reset's id
-- with the state, and confirms that reset only (wk_password_changed_for): a
-- confirmation for any other reset — an older one, or another account's —
-- records nothing. Answers stay {"must_change", "recorded"} as before, plus
-- "reset_id".
--
-- 0111's wk_password_changed() is kept as it was: nothing in 1012 calls it, and
-- its rows (no reset_id) still close every reset before them, as they always did.
-- Additive only: one nullable column, one rewritten reader (same must_change),
-- one helper, one action. No money; no policy; nothing the old Attendance app
-- reads changes. The way back: supabase/tests/3b_b_rollback.sql.

set local lock_timeout = '5s';

alter table wk_password_events add column if not exists reset_id bigint references wk_password_events(id);
alter table wk_password_events drop constraint if exists wk_password_events_reset_kind;
alter table wk_password_events add constraint wk_password_events_reset_kind check (reset_id is null or kind = 'changed');

-- A worker's open reset: their latest temporary password, unless a change names
-- it, or a change from before 0112 (no reset named) came after it.
create or replace function wk_password_open_reset(p_worker uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select t.id from wk_password_events t
   where t.id = (select max(x.id) from wk_password_events x where x.worker_id = p_worker and x.kind = 'temporary_set')
     and not exists (select 1 from wk_password_events c
                      where c.worker_id = p_worker and c.kind = 'changed'
                        and (c.reset_id = t.id or (c.reset_id is null and c.id > t.id)))
$$;

create or replace function wk_password_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('must_change', x.r is not null, 'reset_id', x.r)
    from (select wk_password_open_reset(auth.uid()) as r) x
$$;

-- The change of one reset's temporary password: recorded only while that reset
-- is the caller's open one, once. Anything else records nothing.
create or replace function wk_password_changed_for(p_reset bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('wk_password:' || auth.uid(), 0));
  if p_reset is null or wk_password_open_reset(auth.uid()) is distinct from p_reset then
    return jsonb_build_object('recorded', false);
  end if;
  select coalesce(owner_id, id) into v_owner from profiles where id = auth.uid();
  insert into wk_password_events (owner_id, worker_id, kind, actor_id, reset_id)
  values (v_owner, auth.uid(), 'changed', auth.uid(), p_reset);
  return jsonb_build_object('recorded', true);
end;
$$;

revoke all on function wk_password_open_reset(uuid) from public, anon, authenticated;
revoke all on function wk_password_state() from public, anon;
grant execute on function wk_password_state() to authenticated;
revoke all on function wk_password_changed_for(bigint) from public, anon;
grant execute on function wk_password_changed_for(bigint) to authenticated;
