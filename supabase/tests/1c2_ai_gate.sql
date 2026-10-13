-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-2 acceptance — the AI request gate (migration 0095).
--
-- Self-wrapped in begin / rollback: nothing persists (the test empties
-- and refills ai_requests only inside its own transaction). Editor-safe.
-- Accounts: W-0007 (active worker), its owner, an active staff account of
-- that owner, and — if one exists — a module-focused owner account without
-- 'workplan' (admin-pm@). Every limit is checked at its exact boundary;
-- "24 hours" is a rolling window (rows 23 hours old count, 25 hours old do
-- not). Two SIMULTANEOUS requests at a limit need two connections:
-- supabase/tests/1c2_ai_gate_concurrency.mjs.
-- Success ends with '1c2 AI gate: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_w7 uuid; v_owner uuid; v_staff uuid; v_pm uuid;
begin
  select id into v_w7 from profiles where worker_no = 7 and role = 'worker' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null, 'W-0007 must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select role from profiles where id = v_owner) = 'owner', 'W-0007 belongs to an owner account';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  assert v_staff is not null, 'need an active staff account';
  select id into v_pm from profiles
   where role = 'owner' and jsonb_typeof(allowed_modules) = 'array' and allowed_modules ? 'pm'
     and not allowed_modules ? 'workplan' limit 1;
  delete from ai_requests where owner_id in (v_owner, coalesce(v_pm, v_owner)) or user_id in (v_owner, v_staff, v_w7);
  perform set_config('vai.w7', v_w7::text, true);
  perform set_config('vai.owner', v_owner::text, true);
  perform set_config('vai.staff', v_staff::text, true);
  perform set_config('vai.pm', coalesce(v_pm::text, ''), true);
end $$;

-- ═══ 1. Permissions ═══
do $$
begin
  assert has_function_privilege('authenticated', 'public.ai_authorize(text, integer)', 'execute'), '1a callable when signed in';
  assert not has_function_privilege('anon', 'public.ai_authorize(text, integer)', 'execute'), '1b never anon';
  assert not has_table_privilege('authenticated', 'public.ai_requests', 'select'), '1c no client reads';
  assert not has_table_privilege('authenticated', 'public.ai_requests', 'insert'), '1d no client writes';
end $$;

set local role authenticated;

-- ═══ 2. No session ═══
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_SIGNED_IN', '2 no session, got ' || sqlerrm; end;
end $$;

-- ═══ 3. Wrong account or feature ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.w7'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '3a a worker cannot draft, got ' || sqlerrm; end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('budget_summary', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '3b staff never get the money summary, got ' || sqlerrm; end;
  begin perform ai_authorize('health_briefing', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '3f staff never get the health briefing, got ' || sqlerrm; end;
  begin perform ai_authorize('chat', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '3c unknown feature, got ' || sqlerrm; end;
  begin perform ai_authorize('work_plan_draft', 40001); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_TOO_LARGE', '3d over 40,000 characters, got ' || sqlerrm; end;
  begin perform ai_authorize('work_plan_draft', 0); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_TOO_LARGE', '3e empty, got ' || sqlerrm; end;
end $$;

-- ═══ 4. Per-person limit: 10 drafts in 10 minutes ═══
do $$
begin
  for i in 1..10 loop
    assert (ai_authorize('work_plan_draft', 100) ->> 'ok')::boolean, '4a request ' || i || ' allowed';
  end loop;
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '4b the 11th is refused, got ' || sqlerrm; end;
end $$;

-- ═══ 5. The owner's summary; a module-focused account without Work Plan ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (ai_authorize('budget_summary', 900) ->> 'ok')::boolean, '5a the owner''s budget summary is allowed';
  assert (ai_authorize('work_plan_draft', 900) ->> 'ok')::boolean, '5b the owner may draft';
  assert (ai_authorize('health_briefing', 9000) ->> 'ok')::boolean, '5e the owner''s health briefing (up to 12,000 characters)';
  begin perform ai_authorize('health_briefing', 12001); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_TOO_LARGE', '5f a briefing over 12,000 characters, got ' || sqlerrm; end;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', coalesce(nullif(current_setting('vai.pm'), ''), current_setting('vai.owner')), 'role', 'authenticated')::text, true);
do $$
begin
  if current_setting('vai.pm') <> '' then
    begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
    exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '5c a PM-only account cannot draft, got ' || sqlerrm; end;
    begin perform ai_authorize('budget_summary', 100); raise exception 'no error';
    exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '5d a PM-only account cannot summarise, got ' || sqlerrm; end;
    begin perform ai_authorize('health_briefing', 100); raise exception 'no error';
    exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '5g a PM-only account gets no health briefing, got ' || sqlerrm; end;
  else
    raise notice '5c/5d skipped: no module-focused owner account without workplan';
  end if;
end $$;

-- ═══ 6. Inactive account ═══
reset role;
update profiles set status = 'inactive' where id = current_setting('vai.staff')::uuid;
delete from ai_requests where user_id = current_setting('vai.staff')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '6 an inactive account is refused, got ' || sqlerrm; end;
end $$;

-- ═══ 7. Company limit: 300 in any 24 hours, at the boundary ═══
reset role;
update profiles set status = 'active' where id = current_setting('vai.staff')::uuid;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.w7')::uuid, 'work_plan_draft', 10, now() - interval '25 hours'
  from generate_series(1, 400);
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.w7')::uuid, 'work_plan_draft', 10, now() - interval '23 hours'
  from generate_series(1, 299);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (ai_authorize('work_plan_draft', 100) ->> 'ok')::boolean, '7a the 300th in 24 hours is allowed (25-hour-old rows do not count)';
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '7b the 301st is refused, got ' || sqlerrm; end;
end $$;

-- ═══ 8. Drafts: 50 per person in any 24 hours, at the boundary ═══
reset role;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.staff')::uuid, 'work_plan_draft', 10, now() - interval '25 hours'
  from generate_series(1, 60);
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.staff')::uuid, 'work_plan_draft', 10, now() - interval '23 hours'
  from generate_series(1, 48);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (ai_authorize('work_plan_draft', 100) ->> 'ok')::boolean, '8a the 49th draft in 24 hours is allowed';
  assert (ai_authorize('work_plan_draft', 100) ->> 'ok')::boolean, '8b the 50th draft in 24 hours is allowed';
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '8c the 51st is refused (only 3 in 10 minutes), got ' || sqlerrm; end;
end $$;

-- ═══ 9. Summaries: 20 per person in 10 minutes, 100 in any 24 hours; size; features apart ═══
reset role;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('budget_summary', 4001); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_TOO_LARGE', '9a a summary over 4,000 characters, got ' || sqlerrm; end;
  for i in 1..20 loop
    assert (ai_authorize('budget_summary', 900) ->> 'ok')::boolean, '9b summary ' || i || ' allowed';
  end loop;
  begin perform ai_authorize('budget_summary', 900); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '9c the 21st summary in 10 minutes is refused, got ' || sqlerrm; end;
  assert (ai_authorize('work_plan_draft', 900) ->> 'ok')::boolean, '9d the summary limit does not block drafting';
end $$;

reset role;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.owner')::uuid, 'budget_summary', 900, now() - interval '25 hours'
  from generate_series(1, 30);
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.owner')::uuid, 'budget_summary', 900, now() - interval '23 hours'
  from generate_series(1, 99);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (ai_authorize('budget_summary', 900) ->> 'ok')::boolean, '9e the 100th summary in 24 hours is allowed';
  begin perform ai_authorize('budget_summary', 900); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '9f the 101st is refused, got ' || sqlerrm; end;
end $$;

-- ═══ 10. Rows older than 30 days are removed as the person uses the AI ═══
reset role;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
values (current_setting('vai.owner')::uuid, current_setting('vai.staff')::uuid, 'work_plan_draft', 10, now() - interval '31 days');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$ begin perform ai_authorize('work_plan_draft', 100); end $$;
reset role;
do $$
begin
  assert not exists (select 1 from ai_requests where user_id = current_setting('vai.staff')::uuid and created_at < now() - interval '30 days'),
    '10 rows older than 30 days are removed';
end $$;

reset role;
select '1c2 AI gate: all checks passed' as result;

rollback;
