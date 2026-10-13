-- ════════════════════════════════════════════════════════════════════
-- RECOVERY for supabase/tests/1c_concurrency.mjs — use only if that script
-- stopped before cleaning up AND its ledger file is gone (otherwise prefer
-- `node supabase/tests/1c_concurrency.mjs --cleanup`).
--
-- Deletes ONLY rows inside the two throwaway projects named
-- "ZZ 1c conc project 1/2" and the team "ZZ 1c conc team". It never commits
-- storage files (the script never creates committed ones). Run in the SQL
-- editor; it ends with a leftover count that must be all zeros.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

create temp table zz_conc_tasks on commit drop as
  select t.id from wp_tasks t
   where t.folder_id in (select f.id from folders f where f.name in ('ZZ 1c conc project 1', 'ZZ 1c conc project 2'))
     and t.title like 'ZZ 1c conc%';

delete from wp_photos       where task_id in (select id from zz_conc_tasks);
delete from wp_events       where task_id in (select id from zz_conc_tasks);
delete from wp_acks         where task_id in (select id from zz_conc_tasks);
delete from wp_blockers     where task_id in (select id from zz_conc_tasks);
delete from wp_dependencies where task_id in (select id from zz_conc_tasks) or depends_on in (select id from zz_conc_tasks);
delete from wp_task_people  where task_id in (select id from zz_conc_tasks);
delete from wp_tasks        where id in (select id from zz_conc_tasks);
delete from pr_team_members where team_id in (select id from pr_teams where name = 'ZZ 1c conc team');
delete from pr_teams        where name = 'ZZ 1c conc team';
delete from folders         where name in ('ZZ 1c conc project 1', 'ZZ 1c conc project 2');

select (select count(*) from folders  where name like 'ZZ 1c conc%') as folders,
       (select count(*) from pr_teams where name like 'ZZ 1c conc%') as teams,
       (select count(*) from wp_tasks where title like 'ZZ 1c conc%') as tasks;

commit;
