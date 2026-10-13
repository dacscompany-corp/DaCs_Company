-- 0095 — AI request gate for the dacs-ai Cloudflare worker.
--
-- ── WHY. The worker was public: any page or script could make it run
--    Workers AI. Now every request carries the caller's Supabase session
--    and the worker calls ai_authorize() AS THAT CALLER before running a
--    model. It runs nothing unless this function allows the request:
--      * signed in, and the profile is active;
--      * the feature is allowed for the account —
--          work_plan_draft: owner or staff; a module-focused account
--                           (allowed_modules) needs 'workplan';
--          budget_summary:  owner (staff never see the summary, which
--                           shows amounts); module-focused needs 'expenses';
--          health_briefing: owner (the Project Control AI health
--                           briefing, which also shows amounts);
--                           module-focused needs 'expenses';
--      * the input (characters the worker counted) fits the feature:
--          drafts 40,000, summaries 4,000, briefings 12,000;
--      * within the limits — per person per feature: drafts 10 per 10
--        minutes and 50 per rolling 24 hours, summaries 20 per 10 minutes
--        and 100 per rolling 24 hours, briefings 20 per 10 minutes and
--        100 per rolling 24 hours; per company: 300 AI requests per
--        rolling 24 hours. "Rolling" = the 24 hours before this request,
--        never a calendar day.
--    Each allowed request is recorded in ai_requests (who, which feature,
--    how many characters, when — never the text); rows older than 30 days
--    are removed as people use it. A refused request records nothing.
--
-- ── Outside the money model. No client reads or writes ai_requests.

set local lock_timeout = '5s';

create table if not exists ai_requests (
  id bigserial primary key,
  owner_id uuid not null references profiles(id),
  user_id uuid not null references profiles(id),
  feature text not null check (feature in ('budget_summary', 'work_plan_draft', 'health_briefing')),
  input_chars integer not null check (input_chars > 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_requests_user_recent on ai_requests (user_id, feature, created_at);
create index if not exists ai_requests_owner_recent on ai_requests (owner_id, created_at);
alter table ai_requests enable row level security;
-- No policies: only ai_authorize() (SECURITY DEFINER) reads or writes it.
revoke all on table ai_requests from anon, authenticated;
revoke all on sequence ai_requests_id_seq from anon, authenticated;

create or replace function ai_authorize(p_feature text, p_chars integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_p profiles;
  v_owner uuid;
  v_module text;
  v_max_chars integer;
  v_per_10min integer;
  v_per_day integer;
begin
  if v_uid is null then
    raise exception 'AI_NOT_SIGNED_IN' using errcode = 'P0001';
  end if;
  select * into v_p from profiles where id = v_uid;
  if not found or coalesce(v_p.status, 'active') <> 'active' then
    raise exception 'AI_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_feature = 'work_plan_draft' and v_p.role in ('owner', 'staff') then
    v_module := 'workplan'; v_max_chars := 40000; v_per_10min := 10; v_per_day := 50;
  elsif p_feature = 'budget_summary' and v_p.role = 'owner' then
    v_module := 'expenses'; v_max_chars := 4000; v_per_10min := 20; v_per_day := 100;
  elsif p_feature = 'health_briefing' and v_p.role = 'owner' then
    v_module := 'expenses'; v_max_chars := 12000; v_per_10min := 20; v_per_day := 100;
  else
    raise exception 'AI_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  -- A module-focused account (allowed_modules, e.g. admin-pm@ = ["pm"])
  -- may use only the AI of the sections it was granted.
  if jsonb_typeof(v_p.allowed_modules) = 'array' and jsonb_array_length(v_p.allowed_modules) > 0
     and not (v_p.allowed_modules ? v_module) then
    raise exception 'AI_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_chars is null or p_chars < 1 or p_chars > v_max_chars then
    raise exception 'AI_TOO_LARGE' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  -- One person, then one company, at a time: two requests at once cannot
  -- both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('ai_req_user:' || v_uid::text));
  perform pg_advisory_xact_lock(hashtext('ai_req_owner:' || v_owner::text));
  if (select count(*) from ai_requests r
       where r.user_id = v_uid and r.feature = p_feature and r.created_at > now() - interval '10 minutes') >= v_per_10min
     or (select count(*) from ai_requests r
          where r.user_id = v_uid and r.feature = p_feature and r.created_at > now() - interval '24 hours') >= v_per_day
     or (select count(*) from ai_requests r
          where r.owner_id = v_owner and r.created_at > now() - interval '24 hours') >= 300 then
    raise exception 'AI_RATE_LIMITED' using errcode = 'P0001';
  end if;
  delete from ai_requests where user_id = v_uid and created_at < now() - interval '30 days';
  insert into ai_requests (owner_id, user_id, feature, input_chars) values (v_owner, v_uid, p_feature, p_chars);
  return jsonb_build_object('ok', true, 'feature', p_feature);
end;
$$;

revoke all on function ai_authorize(text, integer) from public, anon;
grant execute on function ai_authorize(text, integer) to authenticated;
