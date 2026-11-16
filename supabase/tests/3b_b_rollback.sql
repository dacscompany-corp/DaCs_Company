-- ═══════════════════════════════════════
-- Stage 3b-b rollback. Run only if 0112 must be undone on live.
-- Restores wk_password_state exactly as 0111 defined it. Nothing is deleted:
-- the reset_id column, its rows and the two new functions stay. WorkMate 1012
-- then reads no reset_id, so it asks for no change and confirms none; the
-- events recorded so far keep their meaning.
-- ═══════════════════════════════════════

create or replace function wk_password_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('must_change', coalesce((
    select e.kind = 'temporary_set' from wk_password_events e
     where e.worker_id = auth.uid() and e.kind in ('temporary_set', 'changed')
     order by e.id desc limit 1), false))
$$;
