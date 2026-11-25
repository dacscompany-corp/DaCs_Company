-- ════════════════════════════════════════════════════════════════════
-- 0121 — Attendance → Weekly reports: every site in the week report
-- ════════════════════════════════════════════════════════════════════
--
-- The project report needs the company's sites even when nobody worked there.
-- att_week_report (0120) gains one key, 'projects':
--   [{ project_system, project_id, project_name, hidden, completed }]
-- ordered by lower(project_name). 'hidden' is the Time In picker flag (0072);
-- 'completed' is folders.completed_at (0064) for Project Control sites, always
-- false for Project Management sites (0072 lists only active ones). All sites
-- are sent; the browser decides what to show.
--
-- Everything else in the function is 0120's body, unchanged. Reads attendance
-- only; outside the money model. Execute stays granted to authenticated.
-- Spec: docs/superpowers/specs/2026-11-22-weekly-employee-report-mvp-terms.md
-- Test: supabase/tests/weekly_reports.pglite.mjs
-- Run after 0120. Idempotent.  
-- ════════════════════════════════════════════════════════════════════

create or replace function att_week_report(p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid := att_report_owner();
  v_end   date;
  v_hist  date;
  v_roster jsonb;
  v_recs   jsonb;
  v_duties jsonb;
  v_projects jsonb;
begin
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'WEEK_START_NOT_MONDAY' using errcode = 'P0001';
  end if;
  v_end := p_week_start + 6;

  select min(effective_on) into v_hist from att_report_eligibility where owner_id = v_owner;

  with ev as (select worker_id, eligible, effective_on, id from att_report_eligibility
               where owner_id = v_owner and effective_on <= v_end),
  start_state as (select distinct on (worker_id) worker_id, eligible from ev
                   where effective_on < p_week_start order by worker_id, effective_on desc, id desc),
  elig as (select worker_id from start_state where eligible
           union select worker_id from ev where eligible and effective_on between p_week_start and v_end),
  recs as (select distinct worker_id from attendance_records
            where owner_id = v_owner and work_date between p_week_start and v_end),
  members as (select coalesce(e.worker_id, r.worker_id) as worker_id,
                     case when e.worker_id is not null then 'eligible' else 'records' end as in_roster
                from elig e full join recs r on r.worker_id = e.worker_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'worker_id', m.worker_id, 'worker_no', p.worker_no,
           'name', coalesce(nullif(btrim(p.display_name), ''), split_part(p.email, '@', 1)),
           'position', p.position, 'role', p.role,
           'active', coalesce(p.status, 'active') = 'active',
           'in_roster', m.in_roster)
         order by lower(coalesce(nullif(btrim(p.display_name), ''), split_part(p.email, '@', 1))), m.worker_id), '[]'::jsonb)
    into v_roster
    from members m left join profiles p on p.id = m.worker_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'worker_id', r.worker_id, 'worker_name', r.worker_name,
           'worker_position', r.worker_position, 'work_date', r.work_date, 'status', r.status,
           'timein_at', r.timein_at, 'timein_project_system', r.timein_project_system,
           'timein_folder_id', r.timein_folder_id, 'timein_pm_project_id', r.timein_pm_project_id,
           'timein_project_name', r.timein_project_name, 'timein_photo_path', r.timein_photo_path,
           'timein_description', r.timein_description, 'timein_location_status', r.timein_location_status,
           'timein_is_mock', r.timein_is_mock, 'timein_was_offline', r.timein_was_offline,
           'timeout_at', r.timeout_at, 'timeout_project_system', r.timeout_project_system,
           'timeout_folder_id', r.timeout_folder_id, 'timeout_pm_project_id', r.timeout_pm_project_id,
           'timeout_project_name', r.timeout_project_name, 'timeout_photo_path', r.timeout_photo_path,
           'timeout_extra_photo_paths', to_jsonb(r.timeout_extra_photo_paths),
           'timeout_description', r.timeout_description, 'timeout_event_id', r.timeout_event_id,
           'timeout_location_status', r.timeout_location_status, 'timeout_is_mock', r.timeout_is_mock,
           'timeout_was_offline', r.timeout_was_offline, 'total_minutes', r.total_minutes,
           'abandoned_at', r.abandoned_at, 'abandoned_note', r.abandoned_note)
         order by r.work_date, r.timein_at, r.id), '[]'::jsonb)
    into v_recs
    from attendance_records r
   where r.owner_id = v_owner and r.work_date between p_week_start and v_end;

  select coalesce(jsonb_agg(jsonb_build_object('position', d.position, 'duties', d.duties, 'updated_at', d.updated_at)
         order by lower(d.position)), '[]'::jsonb)
    into v_duties
    from att_position_duties d where d.owner_id = v_owner and d.active;

  -- Every Attendance site of the company, from the same function the Time In
  -- picker's admin list uses. The browser decides which to show: hidden sites
  -- are flagged, and 'completed' is Project Control's folders.completed_at
  -- (PM sites are listed active-only by 0072, so never completed).
  select coalesce(jsonb_agg(jsonb_build_object(
           'project_system', s.project_system, 'project_id', s.project_id,
           'project_name', s.project_name, 'hidden', coalesce(s.hidden, false),
           'completed', (s.project_system = 'pc' and f.completed_at is not null))
         order by lower(s.project_name), s.project_system, s.project_id), '[]'::jsonb)
    into v_projects
    from attendance_projects_for_admin() s
    left join folders f on s.project_system = 'pc' and f.id = s.project_id;

  return jsonb_build_object(
    'week_start', to_char(p_week_start, 'YYYY-MM-DD'), 'week_end', to_char(v_end, 'YYYY-MM-DD'),
    'generated_at', now(), 'history_starts_on', to_char(v_hist, 'YYYY-MM-DD'),
    'roster', v_roster, 'records', v_recs, 'duties', v_duties, 'projects', v_projects);
end $$;
revoke all on function att_week_report(date) from public, anon;
grant execute on function att_week_report(date) to authenticated;
