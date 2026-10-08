# WorkMate Stage 1a-4 — Requests Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Stage 1a meets every spec §9 row it is responsible for, on the server and on the phone with two workers and a leader. Fix what the pilot finds, starting with the known cancel misalignment.

**Architecture:** One small migration, **0088**, makes a worker's cancels behave like the office's. One self-rolling-back SQL acceptance script maps each 1a row of spec §9 to an assertion. It builds its own throwaway projects and teams, so the pilot's real test requests don't disturb it. A phone + Dacs Web checklist covers what SQL cannot reach: shared-phone account switching, offline survival, screens. Then comes a fix wave for anything found, and the close-out.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, storage), Dacs Web (vanilla JS), DAC'S WorkMate 0.4.0+1004 (Flutter, already on the test phone).

**Spec:** `docs/superpowers/specs/2026-09-29-unified-worker-app-design.md` — §3 (team leaders, Allow requests, completed work), §4A, §4B, §4E, §9. Roadmap: `docs/superpowers/plans/2026-10-02-workmate-stage1a-roadmap.md` row 1a-4.

## Global Constraints

- **Pilot accounts:**
  - **W-0007** (worker, John Tapales)
  - **W-0019** (worker, Danilo Tapales)
  - **W-0021** (teamLeader, Mark Frias)
  - All three are under owner `admin@dacsbuilding.com`.
  - Office: the owner account and the staff account.
- **Live destination:** Barlin Residence (Allow requests on). **Live team:** "Team test" (W-0021 leader, W-0007 member).
- **Migrations:** next number is **0088**. Never reuse. Never make SQL-editor-only changes. Claude's MCP DDL calls get declined, so hand the user a SQL file. After the user says "done apply", verify by query.
- **Never delete live records without the user's explicit approval.** Pilot test requests are closed through the office **Cancel** (history kept), and only if the user asks.
- **Don't touch W-0019's attendance:** they may be a real worker, so W-0019 never does Time In/Out in this pilot. W-0007 is the attendance test account.
- **Workers and team leaders never see money:** no price, amount or cost anywhere in `pr_*` (spec §2).
- **No commits:** Claude never commits or pushes; the user commits both repos.
- **Never run `npm run build`** in Dacs Web.
- **No WorkMate app change is planned.** If the fix wave needs one, it ships as 0.4.1+1005 and goes through `flutter analyze` / `flutter test` first.

## Decisions (made while planning)

| Topic | Decision | Why |
|---|---|---|
| Worker cancels its last open line | The request closes too (`request_cancelled`, `detail.by = 'worker'`), the same as `pr_office_cancel_line` (0086) | 1a-2 carry-over "align". Today the phone shows **Received** on a request with nothing left, and Dacs Web disagrees with the phone. |
| Cancel of something already cancelled | Quiet success: change nothing, write no event, record the op | A cancel queued offline that arrives after the office (or the worker's own last-line cancel) closed the request now shows **Failed** (`LINE_CLOSED`), though the worker got what they asked for. The app's `RequestSync` already treats any success as done. |
| Lock order in `pr_cancel_line` | Request first (FOR NO KEY UPDATE), then line — for all three request-first cancels | Same order as `pr_cancel_request` (0085) and `pr_office_cancel_line` (0086). Closing the request from the line path must not deadlock against them. |
| Acceptance script | A new `supabase/tests/1a_acceptance.sql`, not an edit of `0085_verify.sql` | 0085_verify assumes the accounts have no requests ("run immediately after apply only"), which is no longer true. The new script counts only what it created. |
| Spec §9 rows out of scope | Item history (1b), stock/reservations/receipts/returns/release (2), tool custody (3), cost transfer (4), live supplier search (§A1, unverified) | Roadmap: 1a covers requests only |

## Spec §9 → where it is proven

| §9 row (1a part) | Proven by |
|---|---|
| One login for attendance and requests | Task 3 (step 9) and the 1a-3 phone check |
| PC only; PM ids refused even bypassing the picker | Task 1 §2 |
| Eligible + Allow-requests projects before Time In; Attendance checks unchanged | Task 1 §2 (hidden + allowed offered, hidden-only not); Task 3 step 9 |
| Main Contract or a specific Additional Works job | Task 1 §2 |
| Weekly cycle; office date changes reach workers | Task 1 §1, §7–§8; Task 3 step 6 |
| After-cutoff joins next batch; a retry keeps its batch | Task 1 §1 (cutoff rule), §2 (retry = same answer incl. `batch_id`) |
| One urgent line ≠ whole request urgent; 10 arranged + 2 added stay separate | Task 1 §4, §8 |
| Hidden from Attendance ≠ requests off; completed blocks requests | Task 1 §2 |
| Leader: electrical + plumbing + tool in one request | Task 1 §4; Task 3 step 4 |
| teamLeader role acts only for the team they lead (UI + direct calls); authority rechecked | Task 1 §4, §6; Task 3 steps 3–4 |
| Completed AW refuses under an open parent; open child can't rescue a completed parent | Task 1 §2 |
| Unlisted item matched by the office | Task 1 §7–§8; Task 3 step 7 |
| 10 → 8 / 12 → 9 handled without erasing arranged quantity | Task 1 §8 |
| Duplicate clicks / retries cannot duplicate | Task 1 §2, §10 |
| Offline edits survive closing the app; conflicts reach the office | Task 1 §8–§9; Task 3 steps 1, 8 |
| Workers/leaders cannot retrieve money anywhere | Task 1 §11 + `no money keys` asserts |
| Legacy request access: own rows only, no writes; web sign-in refuses workers | Task 1 §3; 1a-2 browser check (worker refused at sign-in) |
| Raw request photos private (team leader: own team only) | Task 1 §5–§6 |
| Attendance unchanged | Task 3 step 9; 1a-3 phone check |

---

### Task 1: Migration 0088 + the 1a acceptance script

**Files:**
- Create: `supabase/migrations/0088_pr_worker_cancel_alignment.sql`
- Create: `supabase/tests/1a_acceptance.sql`
- Modify: `supabase/migrations/README.md` (0088 paragraph after the 0087 one; "Next number" line → **0089**, highest `0088_pr_worker_cancel_alignment.sql`). The file is **CRLF**: edit with a byte-safe script and check `file README.md` afterwards.
- Modify: `docs/DATABASE_SCHEMA.md` §13 worker-RPC sentence: add "A worker's cancel of the last open line closes the request (0088); cancelling something already cancelled succeeds without change."
- Hand-off file (not in the repo): `C:\Users\John Aerol Tapales\Downloads\0088_dry_run.sql`, which is `begin;` + the 0088 file + the acceptance file.

**Interfaces:**
- Produces: `pr_cancel_line(p_op uuid, p_line uuid) returns jsonb`, result `{status:'cancelled', version:int, request_closed:bool}`. The existing keys are unchanged, so the app's `rebaseAfter` still reads `version`.
- Produces: `pr_cancel_request(p_op uuid, p_request uuid) returns jsonb`, result `{status:'cancelled', lines:int}`, with `lines = 0` on the quiet-success path.

- [ ] **Step 1: Confirm the live functions still match 0085** before replacing them. Use read-only MCP `execute_sql`:

```sql
select p.proname,
       position('NOT_YOUR_LINE' in pg_get_functiondef(p.oid)) > 0 as has_line_check,
       position('request_closed' in pg_get_functiondef(p.oid)) > 0 as already_aligned
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('pr_cancel_line', 'pr_cancel_request');
```

Expected: `pr_cancel_line` has `has_line_check = true` and `already_aligned = false`. `pr_cancel_request` has `already_aligned = false`. Anything else means the live DB drifted: stop and compare `pg_get_functiondef` with 0085 §9 before writing 0088.

- [ ] **Step 2: Write `supabase/migrations/0088_pr_worker_cancel_alignment.sql`**

```sql
-- 0088 — WorkMate Requests: a worker's cancels line up with the office's.
--
-- ── WHY. Found while planning the Stage 1a pilot (2026-10-06):
--    1. pr_cancel_line (0085) left a request 'submitted' after the worker
--       cancelled its last open line, while the office cancel (0086
--       pr_office_cancel_line) closes it. The phone then showed "Received" on
--       a request with nothing left, and Dacs Web disagreed with the phone.
--    2. Cancelling something already cancelled raised LINE_CLOSED. A cancel
--       queued offline that reaches the server after the office (or the
--       worker's own last-line cancel) closed the request then showed as
--       Failed on the phone, though the worker got exactly what they asked.
--
-- ── WHAT.
--    • pr_cancel_line: when no open line is left, the request is cancelled
--      too (request_cancelled event, detail.by = 'worker'), like the office.
--    • pr_cancel_line on a line already cancelled, and pr_cancel_request on a
--      request already cancelled, answer success and change nothing (no
--      event); the op is still recorded, so a retry gets the same answer.
--    • Same checks, errors and result keys as before; pr_cancel_line adds
--      'request_closed'.
--    • All three request-first cancels (pr_cancel_line, pr_cancel_request,
--      pr_office_cancel_line) lock the request FOR NO KEY UPDATE: they still
--      wait for each other, but no longer block the KEY SHARE lock a
--      line-first RPC (quantity changes, office line actions) takes on the
--      request when it records an event, so neither side can deadlock.
--
-- ── SAFE. CREATE OR REPLACE keeps the grants. No table, policy or data
--    changes; pr_office_cancel_line keeps 0086's behaviour exactly.

create or replace function pr_cancel_line(p_op uuid, p_line uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
  v_closed boolean := false;
  l record;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_line is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('pr_op:' || v_uid::text || ':' || p_op::text));
  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  -- Request first, then line: the order of pr_cancel_request and
  -- pr_office_cancel_line. NO KEY UPDATE still serialises the cancels, but
  -- does not block the KEY SHARE lock a line-first RPC takes on the request
  -- when it records a pr_events row, so the two cannot deadlock.
  perform 1 from pr_requests r where r.id = (select x.request_id from pr_lines x where x.id = p_line) for no key update;
  select ln.id, ln.owner_id, ln.request_id, ln.status, ln.version, r.requester_id, r.status as request_status
    into l
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line
     for update of ln;
  if not found or l.requester_id <> v_uid then
    raise exception 'NOT_YOUR_LINE' using errcode = 'P0001';
  end if;

  if l.status = 'cancelled' then
    -- Already what the worker asked for (the office, or an earlier cancel).
    v_result := jsonb_build_object('status', 'cancelled', 'version', l.version,
                                   'request_closed', l.request_status = 'cancelled');
  else
    if l.request_status <> 'submitted' then
      raise exception 'LINE_CLOSED' using errcode = 'P0001';
    end if;
    perform pr_apply_quantity(p_line, 0, l.owner_id);
    update pr_lines set status = 'cancelled', version = version + 1 where id = p_line;
    insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
    values (l.owner_id, l.request_id, p_line, v_uid, 'line_cancelled', '{}'::jsonb);

    if not exists (select 1 from pr_lines x where x.request_id = l.request_id and x.status = 'open') then
      update pr_requests set status = 'cancelled', cancelled_at = now() where id = l.request_id and status = 'submitted';
      insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
      values (l.owner_id, l.request_id, null, v_uid, 'request_cancelled', jsonb_build_object('by', 'worker'));
      v_closed := true;
    end if;
    v_result := jsonb_build_object('status', 'cancelled', 'version', l.version + 1, 'request_closed', v_closed);
  end if;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'cancel_line', v_result);
  return v_result;
end;
$$;

create or replace function pr_cancel_request(p_op uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_prev jsonb;
  v_result jsonb;
  v_count int := 0;
  r record;
  ln record;
begin
  if v_uid is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if p_op is null or p_request is null then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('pr_op:' || v_uid::text || ':' || p_op::text));
  select o.result into v_prev from pr_ops o where o.actor_id = v_uid and o.op_id = p_op;
  if found then
    return v_prev;
  end if;

  select id, owner_id, requester_id, status into r from pr_requests where id = p_request for no key update;
  if not found or r.requester_id <> v_uid then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'P0001';
  end if;

  if r.status = 'cancelled' then
    -- Already what the worker asked for: nothing to change, no event.
    v_result := jsonb_build_object('status', 'cancelled', 'lines', 0);
  else
    for ln in select id from pr_lines where request_id = p_request and status = 'open' order by position for update loop
      perform pr_apply_quantity(ln.id, 0, r.owner_id);
      update pr_lines set status = 'cancelled', version = version + 1 where id = ln.id;
      v_count := v_count + 1;
    end loop;
    update pr_requests set status = 'cancelled', cancelled_at = now() where id = p_request;
    insert into pr_events (owner_id, request_id, actor_id, kind, detail)
    values (r.owner_id, p_request, v_uid, 'request_cancelled', jsonb_build_object('lines', v_count));
    v_result := jsonb_build_object('status', 'cancelled', 'lines', v_count);
  end if;

  insert into pr_ops (op_id, actor_id, kind, result) values (p_op, v_uid, 'cancel_request', v_result);
  return v_result;
end;
$$;

-- Same lock change for the office cancel (0086): request lock FOR NO KEY UPDATE; nothing else changes.
-- The office cancels a line (with a reason). Unarranged quantity goes;
-- arranged quantity is flagged for the office to resolve, like a worker's
-- cancel. When no open line is left, the request is marked cancelled.
create or replace function pr_office_cancel_line(p_line uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_closed boolean := false;
  l record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  -- Same lock order as the worker's pr_cancel_request (0085): request, then line.
  perform 1 from pr_requests r where r.id = (select x.request_id from pr_lines x where x.id = p_line) for no key update;
  select ln.id, ln.owner_id, ln.request_id, ln.status into l from pr_lines ln where ln.id = p_line for update;
  if not found or not can_access(l.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if l.status <> 'open' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;

  perform pr_apply_quantity(p_line, 0, l.owner_id);
  update pr_lines set status = 'cancelled', version = version + 1 where id = p_line;
  insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
  values (l.owner_id, l.request_id, l.id, v_uid, 'office_line_cancelled', jsonb_build_object('reason', btrim(p_reason)));

  if not exists (select 1 from pr_lines x where x.request_id = l.request_id and x.status = 'open') then
    update pr_requests set status = 'cancelled', cancelled_at = now() where id = l.request_id and status = 'submitted';
    insert into pr_events (owner_id, request_id, line_id, actor_id, kind, detail)
    values (l.owner_id, l.request_id, null, v_uid, 'request_cancelled', jsonb_build_object('by', 'office'));
    v_closed := true;
  end if;
  return jsonb_build_object('status', 'cancelled', 'request_closed', v_closed);
end;
$$;
```

`pr_requests.status` is only ever `'submitted'` or `'cancelled'` (0085 check constraint), so the old `<> 'submitted'` refusal is fully covered by the new branch.

- [ ] **Step 3: Write `supabase/tests/1a_acceptance.sql`**

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 1a acceptance — the spec §9 rows that Stage 1a delivers.
--
-- Wraps itself in begin / rollback: nothing persists. Safe to run at any
-- time: it builds its own throwaway projects, teams and catalogue items and
-- only counts what it created, so real pilot requests do not disturb it.
-- Needs 0085–0088 live. Dry run with 0088:  begin;  <0088>  <this file>
-- (its own begin only warns; its rollback undoes the migration too).
--
-- Accounts: W-0007 and W-0019 (workers), W-0021 (teamLeader), their owner.
-- A failed check aborts with its message; success ends with the row
-- '1a acceptance: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

-- ── 0. Accounts and throwaway projects, teams, items (as the database owner) ──
do $$
declare
  v_w7 uuid; v_w19 uuid; v_w21 uuid; v_owner uuid;
  v_p uuid; v_aw uuid; v_done_aw uuid; v_done_parent uuid; v_open_child uuid; v_hid_ok uuid; v_hid_no uuid; v_pm uuid;
  v_ta uuid; v_tb uuid; v_tc uuid; v_item uuid; v_elbow uuid;
begin
  select id into v_w7  from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w19 from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w21 from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null and v_w19 is not null and v_w21 is not null,
    'W-0007 and W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select role from profiles where id = v_owner) = 'owner', 'W-0007''s owner must be an owner account';
  assert (select coalesce(owner_id, id) from profiles where id = v_w19) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_w21) = v_owner, 'the three accounts must share one owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1a acceptance project') returning id into v_p;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 1a acceptance AW', v_p) returning id into v_aw;
  insert into folders (owner_id, name, parent_folder_id, completed_at) values (v_owner, 'ZZ 1a acceptance done AW', v_p, now()) returning id into v_done_aw;
  insert into folders (owner_id, name, completed_at) values (v_owner, 'ZZ 1a acceptance done project', now()) returning id into v_done_parent;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 1a acceptance open child of done', v_done_parent) returning id into v_open_child;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 1a acceptance hidden + allowed') returning id into v_hid_ok;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 1a acceptance hidden only') returning id into v_hid_no;
  insert into pr_project_settings (folder_id, owner_id, allow_requests)
  values (v_p, v_owner, true), (v_done_parent, v_owner, true), (v_hid_ok, v_owner, true);
  insert into attendance_project_config (project_system, folder_id, owner_id, attendance_enabled)
  values ('pc', v_hid_ok, v_owner, false), ('pc', v_hid_no, v_owner, false);

  -- Team A: W-0021 leads, W-0007 member. Team B: W-0021 and W-0019 plain members. Team C: W-0019 only.
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1a team A') returning id into v_ta;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1a team B') returning id into v_tb;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1a team C') returning id into v_tc;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values
    (v_owner, v_ta, v_w21, true), (v_owner, v_ta, v_w7, false),
    (v_owner, v_tb, v_w21, false), (v_owner, v_tb, v_w19, false),
    (v_owner, v_tc, v_w19, false);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1a outlet', '2-gang', 'pc', 'electrical') returning id into v_item;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1a elbow', '1/2 in', 'pc', 'plumbing') returning id into v_elbow;
  select id into v_pm from construction_projects limit 1;

  insert into t_ctx values ('w7', v_w7), ('w19', v_w19), ('w21', v_w21), ('owner', v_owner),
    ('p', v_p), ('aw', v_aw), ('done_aw', v_done_aw), ('done_parent', v_done_parent), ('open_child', v_open_child),
    ('hid_ok', v_hid_ok), ('hid_no', v_hid_no), ('pm', coalesce(v_pm, gen_random_uuid())::text),
    ('ta', v_ta), ('tb', v_tb), ('tc', v_tc), ('item', v_item), ('elbow', v_elbow);
end $$;

-- ── 1. The weekly cutoff: Saturday 12:00 noon, Manila time (§9 weekly cycle, after-cutoff → next batch) ──
do $$
begin
  assert pr_cutoff_after('2026-10-03 11:59:59+08') = '2026-10-03 12:00:00+08', 'Saturday 11:59:59 → that Saturday''s batch';
  assert pr_cutoff_after('2026-10-03 12:00:00+08') = '2026-10-10 12:00:00+08', 'received at Saturday noon exactly → next week''s batch';
  assert pr_cutoff_after('2026-10-03 03:59:00+00') = '2026-10-03 12:00:00+08', 'a UTC instant is read in Manila time';
end $$;

-- ── 2. W-0007 (worker): destinations, completed work, PM ids, retries ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_aw uuid := (select v::uuid from t_ctx where k = 'aw');
  v_done_aw uuid := (select v::uuid from t_ctx where k = 'done_aw');
  v_done_parent uuid := (select v::uuid from t_ctx where k = 'done_parent');
  v_open_child uuid := (select v::uuid from t_ctx where k = 'open_child');
  v_hid_ok uuid := (select v::uuid from t_ctx where k = 'hid_ok');
  v_hid_no uuid := (select v::uuid from t_ctx where k = 'hid_no');
  v_pm uuid := (select v::uuid from t_ctx where k = 'pm');
  v_ta uuid := (select v::uuid from t_ctx where k = 'ta');
  v_item uuid := (select v::uuid from t_ctx where k = 'item');
  line jsonb;
  r jsonb; r2 jsonb;
begin
  line := jsonb_build_object('kind', 'material', 'catalog_item_id', v_item, 'description', 'ZZ 1a outlet',
                             'spec', '2-gang', 'unit', 'pc', 'category', 'electrical', 'quantity', 10);

  assert exists (select 1 from pr_destinations() d where d.project_id = v_p and d.work_id = v_p and d.is_main), 'Main Contract offered';
  assert exists (select 1 from pr_destinations() d where d.project_id = v_p and d.work_id = v_aw and not d.is_main), 'open Additional Works offered';
  assert not exists (select 1 from pr_destinations() d where d.work_id = v_done_aw), 'completed Additional Works not offered';
  assert not exists (select 1 from pr_destinations() d where d.project_id = v_done_parent or d.work_id = v_open_child),
    'a completed parent and its open child are not offered';
  assert exists (select 1 from pr_destinations() d where d.project_id = v_hid_ok), 'hidden from Attendance but Allow requests on → offered';
  assert not exists (select 1 from pr_destinations() d where d.project_id = v_hid_no), 'hidden from Attendance, no Allow requests → not offered';

  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_done_aw, 'lines', jsonb_build_array(line)));
    assert false, 'a completed Additional Works job accepted a request under an open parent';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'completed AW: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_done_parent, 'work_id', v_open_child, 'lines', jsonb_build_array(line)));
    assert false, 'an open child rescued a completed parent';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'open child of a completed parent: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_pm, 'lines', jsonb_build_array(line)));
    assert false, 'a PM project id accepted';
  exception when others then assert sqlerrm = 'DESTINATION_CLOSED', 'PM id: ' || sqlerrm; end;

  -- Team A request (W-0007 is a plain member): a catalogue line + an unlisted line.
  r := pr_submit_request('00000000-0000-4000-8000-00000001a401', jsonb_build_object('folder_id', v_p, 'work_id', v_p, 'team_id', v_ta,
         'lines', jsonb_build_array(line,
           jsonb_build_object('kind', 'material', 'description', 'ZZ 1a unlisted elbow', 'spec', 'half inch', 'unit', 'pc', 'quantity', 3))));
  r2 := pr_submit_request('00000000-0000-4000-8000-00000001a401', jsonb_build_object('folder_id', v_p, 'lines', jsonb_build_array(line)));
  assert r2 = r, 'a retried request returns the first answer (same request, same batch) and writes nothing';
  assert (select count(*) from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = r ->> 'request_id') = 1, 'one request for the retried op';
  insert into t_ctx values ('reqA', r ->> 'request_id'), ('lineOutlet', r -> 'line_ids' ->> 0), ('lineElbow', r -> 'line_ids' ->> 1);

  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'work_id', v_aw, 'lines', jsonb_build_array(line)));
  assert (select e ->> 'work_name' from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = r ->> 'request_id') = 'ZZ 1a acceptance AW',
    'the request names its Additional Works job';
  insert into t_ctx values ('reqAW', r ->> 'request_id'), ('lineAW', r -> 'line_ids' ->> 0);

  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'lines', jsonb_build_array(line)));
  insert into t_ctx values ('reqSolo', r ->> 'request_id'), ('lineSolo', r -> 'line_ids' ->> 0);

  assert pr_my_requests(200)::text !~* '"[a-z_]*(price|amount|cost|peso)[a-z_]*"\s*:', 'W-0007: no money keys';
end $$;

-- ── 3. W-0019 (worker, in teams B and C, leads none) ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w19'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_tb uuid := (select v::uuid from t_ctx where k = 'tb');
  r jsonb; ids text[]; n int;
begin
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_tb,
         'lines', jsonb_build_array(jsonb_build_object('kind', 'material', 'description', 'ZZ 1a sand', 'unit', 'bag', 'quantity', 5))));
  insert into t_ctx values ('reqB', r ->> 'request_id');

  select array_agg(e ->> 'id') into ids from jsonb_array_elements(pr_my_requests(200)) e;
  assert not ((select v from t_ctx where k = 'reqA') = any (ids)) and not ((select v from t_ctx where k = 'reqSolo') = any (ids)),
    'W-0019 does not see W-0007''s requests';
  assert not exists (select 1 from jsonb_array_elements(pr_my_requests(200)) e where not (e ->> 'mine')::boolean),
    'a worker who leads no team sees only their own requests';
  begin perform pr_cancel_request(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqA'));
    assert false, 'cancelled a colleague''s request';
  exception when others then assert sqlerrm = 'NOT_YOUR_REQUEST', 'foreign cancel: ' || sqlerrm; end;
  begin perform pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineOutlet'), 1, 1);
    assert false, 'changed a colleague''s line';
  exception when others then assert sqlerrm = 'NOT_YOUR_LINE', 'foreign edit: ' || sqlerrm; end;
  assert pr_my_requests(200)::text !~* '"[a-z_]*(price|amount|cost|peso)[a-z_]*"\s*:', 'W-0019: no money keys';

  -- Legacy request tables (spec §9: no browsing colleagues' requests): own rows only, no writes.
  assert (select count(*) from requests where requested_by is distinct from auth.uid()) = 0, 'legacy requests: own rows only';
  with d as (delete from request_items returning 1) select count(*) into n from d;
  assert n = 0, 'legacy request_items: a worker deletes nothing';
  begin
    insert into requests (requested_by, status) values (auth.uid(), 'pending');
    assert false, 'legacy requests: a worker inserted a row';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 4. W-0021 (teamLeader: leads A, plain member of B, not in C) ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w21'), 'role', 'authenticated')::text, true);
do $$
declare
  v_p uuid := (select v::uuid from t_ctx where k = 'p');
  v_ta uuid := (select v::uuid from t_ctx where k = 'ta');
  v_tb uuid := (select v::uuid from t_ctx where k = 'tb');
  v_tc uuid := (select v::uuid from t_ctx where k = 'tc');
  v_w7 uuid := (select v::uuid from t_ctx where k = 'w7');
  v_w19 uuid := (select v::uuid from t_ctx where k = 'w19');
  v_item uuid := (select v::uuid from t_ctx where k = 'item');
  r jsonb; req jsonb; ids text[];
begin
  -- One request: electrical, plumbing (urgent) and a tool (§9).
  r := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_ta, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'catalog_item_id', v_item, 'description', 'ZZ 1a outlet', 'spec', '2-gang', 'unit', 'pc',
                            'category', 'electrical', 'quantity', 10, 'intended_member_id', v_w7),
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1a PVC pipe', 'spec', '1/2 in, 3 m', 'unit', 'pc', 'category', 'plumbing',
                            'quantity', 6, 'urgent', true, 'urgent_reason', 'leak at the kitchen', 'needed_by', '2026-10-09'),
         jsonb_build_object('kind', 'tool', 'description', 'ZZ 1a drill', 'unit', 'pc', 'category', 'electrical', 'quantity', 1,
                            'intended_member_id', v_w7))));
  select e into req from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = r ->> 'request_id';
  assert jsonb_array_length(req -> 'lines') = 3, 'one request, three lines';
  assert (select array_agg(l ->> 'category' order by (l ->> 'position')::int) from jsonb_array_elements(req -> 'lines') l)
         = array['electrical', 'plumbing', 'electrical'], 'each line keeps its trade';
  assert (select array_agg((l ->> 'urgent')::boolean order by (l ->> 'position')::int) from jsonb_array_elements(req -> 'lines') l)
         = array[false, true, false], 'one urgent line does not make the whole request urgent';
  assert req -> 'lines' -> 0 ->> 'intended_member_id' = v_w7::text, 'the leader names a member on a material line';
  assert req -> 'lines' -> 2 ->> 'intended_member_id' is null, 'a tool line names nobody at request time';

  select array_agg(e ->> 'id') into ids from jsonb_array_elements(pr_my_requests(200)) e;
  assert (select v from t_ctx where k = 'reqA') = any (ids), 'the leader sees a member''s team A request';
  assert not ((select v from t_ctx where k = 'reqSolo') = any (ids)), 'the leader does not see a member''s individual request';
  assert not ((select v from t_ctx where k = 'reqB') = any (ids)), 'a teamLeader who is only a member of team B does not see its requests';

  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_tb, 'lines', jsonb_build_array(
          jsonb_build_object('kind', 'material', 'description', 'ZZ 1a sand', 'unit', 'bag', 'quantity', 1, 'intended_member_id', v_w19))));
    assert false, 'named a member of a team they do not lead';
  exception when others then assert sqlerrm = 'NOT_TEAM_LEADER', 'team B member: ' || sqlerrm; end;
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_p, 'team_id', v_tc, 'lines', jsonb_build_array(
          jsonb_build_object('kind', 'material', 'description', 'ZZ 1a sand', 'unit', 'bag', 'quantity', 1))));
    assert false, 'used a team they are not in';
  exception when others then assert sqlerrm = 'NOT_IN_TEAM', 'team C: ' || sqlerrm; end;
  begin perform pr_change_quantity(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineOutlet'), 1, 1);
    assert false, 'the leader changed a member''s line';
  exception when others then assert sqlerrm = 'NOT_YOUR_LINE', 'leader edit: ' || sqlerrm; end;
  assert pr_my_requests(200)::text !~* '"[a-z_]*(price|amount|cost|peso)[a-z_]*"\s*:', 'W-0021: no money keys';
end $$;

-- ── 5. Private photos (objects inserted by the database owner, standing in for the app's upload) ──
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('request-photos', (select v from t_ctx where k = 'w7') || '/' || (select v from t_ctx where k = 'reqA') || '/team.jpg',
   (select v::uuid from t_ctx where k = 'w7')),
  ('request-photos', (select v from t_ctx where k = 'w7') || '/' || (select v from t_ctx where k = 'reqSolo') || '/solo.jpg',
   (select v::uuid from t_ctx where k = 'w7'));
insert into t_ctx values
  ('pathTeam', (select v from t_ctx where k = 'w7') || '/' || (select v from t_ctx where k = 'reqA') || '/team.jpg'),
  ('pathSolo', (select v from t_ctx where k = 'w7') || '/' || (select v from t_ctx where k = 'reqSolo') || '/solo.jpg');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$
begin
  perform pr_attach_photo(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqA'), null, (select v from t_ctx where k = 'pathTeam'));
  perform pr_attach_photo(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqSolo'), null, (select v from t_ctx where k = 'pathSolo'));
  assert (select count(*) from storage.objects where bucket_id = 'request-photos'
            and name in ((select v from t_ctx where k = 'pathTeam'), (select v from t_ctx where k = 'pathSolo'))) = 2,
    'the requester sees both photos';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w21'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'request-photos' and name = (select v from t_ctx where k = 'pathTeam')) = 1,
    'the team''s leader sees a team request''s photo';
  assert (select count(*) from storage.objects where bucket_id = 'request-photos' and name = (select v from t_ctx where k = 'pathSolo')) = 0,
    'the leader does not see a member''s individual photo';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w19'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'request-photos'
            and name in ((select v from t_ctx where k = 'pathTeam'), (select v from t_ctx where k = 'pathSolo'))) = 0,
    'a colleague sees neither photo';
end $$;

-- ── 6. Leadership taken away: authority is rechecked on every call (spec §3) ──
reset role;
update pr_team_members set is_leader = false
 where team_id = (select v::uuid from t_ctx where k = 'ta') and worker_id = (select v::uuid from t_ctx where k = 'w21');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w21'), 'role', 'authenticated')::text, true);
do $$
declare ids text[];
begin
  select array_agg(e ->> 'id') into ids from jsonb_array_elements(pr_my_requests(200)) e;
  assert not ((select v from t_ctx where k = 'reqA') = any (ids)), 'a former leader no longer sees the team''s requests';
  assert (select count(*) from storage.objects where bucket_id = 'request-photos' and name = (select v from t_ctx where k = 'pathTeam')) = 0,
    'nor its photos';
  begin perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', (select v::uuid from t_ctx where k = 'p'),
          'team_id', (select v::uuid from t_ctx where k = 'ta'), 'lines', jsonb_build_array(
          jsonb_build_object('kind', 'material', 'description', 'ZZ 1a outlet', 'unit', 'pc', 'quantity', 1,
                             'intended_member_id', (select v::uuid from t_ctx where k = 'w7')))));
    assert false, 'a former leader named a member';
  exception when others then assert sqlerrm = 'NOT_TEAM_LEADER', 'former leader: ' || sqlerrm; end;
end $$;

-- ── 7. The office (owner): arrange, change a batch's dates, match the unlisted item ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$
declare v_portion uuid; v_batch uuid; v_new date;
begin
  select id, batch_id into v_portion, v_batch from pr_line_portions where line_id = (select v::uuid from t_ctx where k = 'lineOutlet');
  perform pr_office_set_arranged(v_portion, true);
  v_new := (select delivery_on from pr_batches where id = v_batch) + 1;
  perform pr_office_set_batch_dates(v_batch, (select purchase_on from pr_batches where id = v_batch), v_new);
  insert into t_ctx values ('newDelivery', v_new::text);
  perform pr_office_match_item((select v::uuid from t_ctx where k = 'lineElbow'), (select v::uuid from t_ctx where k = 'elbow'));
end $$;

-- ── 8. W-0007 sees the office's changes; quantity rules (spec §4B) ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_outlet text := (select v from t_ctx where k = 'lineOutlet');
  v_base int; r jsonb; l jsonb;
begin
  select x into l from jsonb_array_elements(pr_my_requests(200)) e, jsonb_array_elements(e -> 'lines') x where x ->> 'id' = v_outlet;
  assert l -> 'portions' -> 0 ->> 'delivery_on' = (select v from t_ctx where k = 'newDelivery'), 'the office''s new delivery date reaches the worker';
  assert (select x ->> 'catalog_item_id' from jsonb_array_elements(pr_my_requests(200)) e, jsonb_array_elements(e -> 'lines') x
           where x ->> 'id' = (select v from t_ctx where k = 'lineElbow')) = (select v from t_ctx where k = 'elbow'),
    'the unlisted line now carries the office''s catalogue match';
  v_base := (l ->> 'version')::int;

  r := pr_change_quantity(gen_random_uuid(), v_outlet::uuid, v_base, 12);
  assert r ->> 'status' = 'applied', '10 → 12 applied';
  select x into l from jsonb_array_elements(pr_my_requests(200)) e, jsonb_array_elements(e -> 'lines') x where x ->> 'id' = v_outlet;
  assert jsonb_array_length(l -> 'portions') = 2, 'adding 2 to an arranged 10 makes a second portion';
  assert exists (select 1 from jsonb_array_elements(l -> 'portions') p where (p ->> 'arranged')::boolean and (p ->> 'quantity')::numeric = 10),
    'the arranged 10 are untouched';
  assert exists (select 1 from jsonb_array_elements(l -> 'portions') p where not (p ->> 'arranged')::boolean and (p ->> 'quantity')::numeric = 2),
    'the extra 2 are scheduled separately, unarranged';

  r := pr_change_quantity(gen_random_uuid(), v_outlet::uuid, (r ->> 'version')::int, 9);
  select x into l from jsonb_array_elements(pr_my_requests(200)) e, jsonb_array_elements(e -> 'lines') x where x ->> 'id' = v_outlet;
  assert jsonb_array_length(l -> 'portions') = 1 and (l -> 'portions' -> 0 ->> 'quantity')::numeric = 10
     and (l -> 'portions' -> 0 ->> 'pending_reduction')::numeric = 1 and (l ->> 'needed')::numeric = 9,
    '12 → 9: the unarranged 2 go first, then 1 of the arranged 10 is flagged for the office';

  r := pr_change_quantity(gen_random_uuid(), v_outlet::uuid, v_base, 7);
  assert r ->> 'status' = 'conflict' and (r ->> 'needed')::numeric = 9, 'an offline edit against an old version is a conflict, nothing overwritten';
end $$;

-- ── 9. The office sees the conflict and the reduction; it cancels the Additional Works line ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  assert exists (select 1 from pr_line_conflicts where line_id = (select v::uuid from t_ctx where k = 'lineOutlet') and resolved_at is null),
    'the office has the conflict to resolve';
  assert exists (select 1 from jsonb_array_elements(pr_office_queue('open')) e where e ->> 'id' = (select v from t_ctx where k = 'reqA')),
    'the request is in the office''s open queue';
  r := pr_office_cancel_line((select v::uuid from t_ctx where k = 'lineAW'), '1a acceptance');
  assert (r ->> 'request_closed')::boolean, 'the office''s last-line cancel closes the request';
end $$;

-- ── 10. W-0007 cancels (0088): last line closes the request; a late cancel is a quiet success ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$
declare r jsonb;
begin
  r := pr_cancel_line(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineElbow'));
  assert r ->> 'status' = 'cancelled' and not (r ->> 'request_closed')::boolean, 'one of two lines cancelled: the request stays open';
  assert (select e ->> 'status' from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = (select v from t_ctx where k = 'reqA')) = 'submitted',
    'request A still submitted';

  r := pr_cancel_line('00000000-0000-4000-8000-00000001a402', (select v::uuid from t_ctx where k = 'lineSolo'));
  assert (r ->> 'request_closed')::boolean and (r ->> 'version')::int = 2, 'cancelling the last line closes the request';
  assert (select e ->> 'status' from jsonb_array_elements(pr_my_requests(200)) e where e ->> 'id' = (select v from t_ctx where k = 'reqSolo')) = 'cancelled',
    'the worker sees it cancelled';
  assert pr_cancel_line('00000000-0000-4000-8000-00000001a402', (select v::uuid from t_ctx where k = 'lineSolo')) = r,
    'a retried cancel returns the first answer';

  r := pr_cancel_request(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqSolo'));
  assert r ->> 'status' = 'cancelled' and (r ->> 'lines')::int = 0, 'cancelling an already-cancelled request: success, nothing changes';
  r := pr_cancel_line(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineSolo'));
  assert r ->> 'status' = 'cancelled' and (r ->> 'version')::int = 2, 'cancelling an already-cancelled line: success, version unchanged';
  r := pr_cancel_request(gen_random_uuid(), (select v::uuid from t_ctx where k = 'reqAW'));
  assert r ->> 'status' = 'cancelled', 'a cancel arriving after the office closed the request: success, not Failed';
  r := pr_cancel_line(gen_random_uuid(), (select v::uuid from t_ctx where k = 'lineAW'));
  assert r ->> 'status' = 'cancelled', 'a line cancel arriving after the office cancelled it: success';
end $$;

-- ── 11. Records and money (as the database owner) ──
reset role;
do $$
declare v_solo uuid := (select v::uuid from t_ctx where k = 'reqSolo');
begin
  assert (select count(*) from pr_events where request_id = v_solo and kind = 'line_cancelled') = 1
     and (select count(*) from pr_events where request_id = v_solo and kind = 'request_cancelled' and detail ->> 'by' = 'worker') = 1
     and (select count(*) from pr_events where request_id = v_solo and kind = 'request_cancelled') = 1,
    'one line cancel and one request close recorded; the late cancels recorded nothing';
  assert (select count(*) from pr_requests where client_op_id = '00000000-0000-4000-8000-00000001a401') = 1, 'one request for the retried op';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name like 'pr\_%' and column_name ~* '(price|amount|cost|peso)'),
    'no pr_ table has a money column';
end $$;

select '1a acceptance: all checks passed' as result;

rollback;
```

- [ ] **Step 4: Static checks.** Check line endings and that nothing else changed:

```bash
cd "/c/Users/John Aerol Tapales/Documents/Dacs Web" && file supabase/migrations/0088_pr_worker_cancel_alignment.sql supabase/tests/1a_acceptance.sql supabase/migrations/README.md && git diff --stat
```

Expected: the two new files are UTF-8 text; `README.md` still has CRLF line terminators; the diff stat lists only README.md and DATABASE_SCHEMA.md. Then run `npm test`. Expected: all suites pass. The repo test bans `for all` policies in migrations ≥ 0081; 0088 has no policies.

- [ ] **Step 5: Build the dry-run file** `C:\Users\John Aerol Tapales\Downloads\0088_dry_run.sql`: the line `begin;`, then the full 0088 file, then the full acceptance file. User step: paste it into the Supabase SQL editor and run it. **Expected:** the last result row is `1a acceptance: all checks passed`. Everything rolls back, the migration included.
  - If a check fails, its message names the §9 row. Treat it as a pilot finding and go to Task 4. Don't apply 0088 until the dry run passes.

- [ ] **Step 6: User applies 0088** (paste `0088_pr_worker_cancel_alignment.sql` into the SQL editor). Then **verify live** with read-only MCP:

```sql
select p.proname,
       position('request_closed' in pg_get_functiondef(p.oid)) > 0 as aligned,
       p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('pr_cancel_line', 'pr_cancel_request');
```

Expected: `pr_cancel_line` has `aligned = true`. `pr_cancel_request` has `aligned = false`: its new branch has no `request_closed` key, so instead check that `pg_get_functiondef` contains `Already what the worker asked for`. Both `acl` values are the same as before the apply (record them in Step 1).

- [ ] **Step 7: User runs `supabase/tests/1a_acceptance.sql` on its own** against the live DB. Expected: `1a acceptance: all checks passed`. This is the result of record.

- [ ] **Step 8: Stop — no commit.**

---

### Task 2: Prepare the live pilot data (read-only check + office setup by the user)

**Files:** none.

- [ ] **Step 1: Read-only check** (MCP):

```sql
select (select string_agg(f.name || ' allow=' || s.allow_requests, '; ') from pr_project_settings s join folders f on f.id = s.folder_id) as allow,
       (select string_agg(t.name || ':' || (select string_agg(p.worker_no || case when m.is_leader then '(L)' else '' end, ',')
                                             from pr_team_members m join profiles p on p.id = m.worker_id
                                            where m.team_id = t.id and m.removed_at is null), '; ')
          from pr_teams t where t.active) as teams,
       (select count(*) from pr_catalog_items where active) as catalogue_items,
       (select count(*) from pr_requests where status = 'submitted') as open_requests;
```

Expected: Barlin Residence `allow=true`, and `Team test:21(L),7`.

- [ ] **Step 2: Office setup in Dacs Web** (user, as owner) → **Requests → Teams**:
  - Create team **"Team pilot B"** with members **W-0019** and **W-0021**, and **no leader**. This mirrors acceptance team B on live data.
  - In **Catalogue**, add a **tool** item, e.g. "ZZ pilot drill", unit pc, category electrical. This is so a tool can be picked from the list.
- [ ] **Step 3: Re-run Step 1.** Expected: `Team pilot B:19,21` (no `(L)`), and `catalogue_items` up by one.

---

### Task 3: The phone + Dacs Web pilot (user, with Claude checking the database after each step)

**Files:** none. Use the test phone with WorkMate 0.4.0+1004 and Dacs Web as owner.

After each step the user sends screenshots. Claude confirms the server side with read-only queries on `pr_requests`, `pr_lines`, `pr_line_portions`, `pr_events` and `pr_photos` (the pattern from the 1a-3 phone check). A step passes only when **the phone, Dacs Web and the database agree**.

- [ ] **Step 1: Shared phone, account switching (spec §4E).**
  - Signed in as **W-0007**, start a New request with one item and **don't send it**. Back out, so it stays a Draft.
  - Sign out, then sign in as **W-0019**. Expected: **no** W-0007 draft or request is visible, and the Home card shows nothing of W-0007's.
  - Sign out, then back in as W-0007. Expected: the draft is still there. Delete it.
- [ ] **Step 2: W-0019, individual and team B.**
  - As **W-0019**, send one request with **no team** ("Just me") and one with **Team pilot B**.
  - Expected: W-0019 has **no member picker** on either, because they lead no team.
  - DB: both requests received; `team_id` is null on the first and Team pilot B on the second.
- [ ] **Step 3: The teamLeader role alone grants nothing.**
  - As **W-0021**, open Requests. Expected: W-0019's requests are **not** listed. W-0021 is only a member of Team pilot B, not its leader.
  - New request → **Team pilot B** → material item. Expected: **no member picker**.
  - New request → **Team test** → material item. Expected: the picker is there.
  - Send both. DB: the Team pilot B line has `intended_member_id` null.
- [ ] **Step 4: Leader's combined request (spec §9).** As **W-0021**, send **one** request under **Team test** with three lines:
  - an electrical material for John Tapales;
  - a plumbing material marked **Urgent** (reason + needed-by);
  - the catalogue **tool**.

  Expected:
  - Dacs Web shows only the plumbing line as urgent, at the top of the queue.
  - DB: three lines; `urgent` = false/true/false; the tool line has no member.
- [ ] **Step 5: Leadership change is rechecked.**
  - In Dacs Web → Teams → Team test, make **W-0007** the leader. W-0021 becomes a plain member.
  - On the phone as **W-0021**, pull down. Expected: W-0007's Team test requests **disappear**, and New request → Team test → material shows **no member picker**.
  - Make **W-0021** leader again. Pull down: they come back.
- [ ] **Step 6: Office batch dates reach the phone.**
  - In Dacs Web → Weekly batches, change the current batch's delivery from **Wed 14 Oct** to **Thu 15 Oct**.
  - As W-0007, pull down. Expected: "Expected Thu 15 Oct" on the lines and Home "Next delivery Thu 15 Oct".
  - Change it back to Wed 14 Oct.
- [ ] **Step 7: Arranged + increase + reduce (spec §4B, §9).**
  - In Dacs Web, **Mark arranged** the 6 pc ZZ test pipe on W-0021's own Team test request.
  - As **W-0021** (it's their line), change 6 → **8**. Expected: the phone shows 6 (arranged) and 2 (waiting) separately, and Dacs Web shows two batch rows.
  - Change 8 → **5**. Expected: the 2 go first, then 1 of the arranged 6 is flagged "Office checking", and Dacs Web shows a reduction to resolve.
  - Resolve it in Dacs Web. Expected: the phone line settles at 5.
  - Also **match** one unlisted line (W-0019's) to a catalogue item in Dacs Web. Expected: the line shows its catalogue name in Dacs Web.
- [ ] **Step 8: Offline survival and a closed destination (spec §4E, §3).**
  - As **W-0007**, turn on **airplane mode** and send a new request for Barlin Residence → Main Contract. Then **swipe the app away** (kill it) and reopen it. Expected: still **Pending sync**.
  - In Dacs Web → Projects, turn **Allow requests off** for Barlin Residence.
  - Turn airplane mode off. Expected: the request shows **Failed** with the "choose another / send again" copy, and nothing new appears in the queue.
  - Turn **Allow requests back on**. On the phone, **Edit and send again**. Expected: **Received**.
- [ ] **Step 9: 0088 on the phone.**
  - As **W-0007**, on a received **one-item** request, tap **Cancel item**. Expected: the request shows **Cancelled** on the phone and in Dacs Web. History: "Cancelled the item", then "Cancelled the request".
  - Then, with **airplane mode on**, open another one-item request and tap **Cancel item**. In Dacs Web, **cancel that same item** as the office first. Then turn airplane mode off. Expected: the phone shows **Cancelled**, **not Failed**.
- [ ] **Step 10: Attendance still untouched.** As **W-0007** (never W-0019), do Time In → Time Out. DB: `attendance_records` row with `timein_app_version = 1004`, received within seconds.

---

### Task 4: Fix wave (only for what Tasks 1 and 3 find)

**Files:** decided per finding. For each finding, record a line in the plan's Execution notes: `Finding → Ruling: fix / defer — why — cost if wrong`.

- [ ] **Step 1: Classify each finding.**
  - **Server** (a §9 row fails in the acceptance script or the DB disagrees): new migration **0089+**, the same dry-run → apply → verify cycle as Task 1 Steps 5–7, and the acceptance script extended with a check that fails before the fix.
  - **Dacs Web:** edit the `js/requests-admin-*.js` / `css/requests-admin.css` files, add a static check in `tests/requests-admin.test.js` or `tests/workmate-requests-office.test.js`, then `npm test`. Mirror nothing into the portals (they don't show requests).
  - **WorkMate app:** TDD in the WorkMate repo (`test/requests/**`), then `flutter analyze` and `flutter test` (all pass), bump to **0.4.1+1005**, `flutter build apk --release` with `JAVA_HOME` = JDK 21, `adb install -r`, and re-run only the failing Task 3 step.
- [ ] **Step 2: Re-run** `supabase/tests/1a_acceptance.sql` after any server fix. Expected: `1a acceptance: all checks passed`.
- [ ] **Step 3: Stop — no commit.**

---

### Task 5: Close-out

**Files:**
- Modify: `docs/superpowers/plans/2026-10-02-workmate-stage1a-roadmap.md` row 1a-4 → `(done YYYY-MM-DD; plan 2026-10-06-workmate-stage1a4-pilot.md)`
- Modify: this plan — append `## Execution notes (YYYY-MM-DD)` with the acceptance result, each Task 3 step's outcome, the findings and rulings, and the live migrations (0088, plus any 0089+).
- Modify: memory `workmate-requests-0085.md` (+ its `MEMORY.md` line): Stage 1a complete, what's live, and that Stage 1b comes next.

- [ ] **Step 1: Ask the user about the pilot test requests** (W-0007, W-0019 and W-0021 test requests in Barlin Residence). Options:
  - (a) leave them;
  - (b) close the open ones with the office **Cancel item** (history kept).

  **Never delete them.** Do (b) only if the user picks it, then confirm in the DB that `open_requests` for the pilot accounts = 0.
- [ ] **Step 2: Remove the pilot-only setup if the user wants:** deactivate "Team pilot B" and the "ZZ pilot drill" catalogue item in Dacs Web. This is a deactivate, not a delete.
- [ ] **Step 3: Write the docs and memory** listed above.
- [ ] **Step 4: Publishing decision** (only if the user asks): upload the WorkMate APK in Dacs Web → Attendance → App updates (stream `com.dacs.workmate`). Workers stay on the old Attendance app until the current project ends (0E deferred).
- [ ] **Step 5: Stop — the user commits both repos.**

---

## Execution notes (2026-10-08)

Executed subagent-driven (Task 1) with user + controller steps for Tasks 2–5. **Stage 1a is complete.**

**Task 1:**
- **0088 applied live on 2026-10-06** (the user applied it directly, skipping the dry run) and verified by query: all three request-first cancels take `FOR NO KEY UPDATE`; `pr_cancel_line` closes the request on the last line; late cancels are a quiet success; grants unchanged.
- Changes after review, before apply: the request lock is `FOR NO KEY UPDATE`, not `FOR UPDATE`, because `FOR UPDATE` blocked the FK `KEY SHARE` that line-first RPCs take when they insert `pr_events`. `pr_office_cancel_line` was re-declared with only that change. 6 new static checks in `tests/workmate-requests.test.js`.
- **Acceptance passed live on 2026-10-07:** `1a acceptance: all checks passed`, with nothing left behind. **Run it through the API (MCP `execute_sql`), not the Supabase SQL editor.** The editor rewrites any query that creates a table: its "enable RLS" step targets `public.t_ctx`, which fails for a temp table (42P01).

**Task 3, phone pilot (W-0007, W-0019, W-0021), checked against the DB after every step:**
1. **PASS** — Shared phone: no draft or request leaks between accounts, and a draft survives sign-out.
2. **PASS** — W-0019 "Just me" and Team pilot B requests; no member picker without leadership.
3. **PASS** — The teamLeader role alone gives nothing: no picker and no visibility in a team the worker doesn't lead. The picker appears and works in the led team.
4. **PASS** — One combined request (electrical + urgent plumbing + catalogue tool). Only the urgent line is urgent; the tool has no member.
5. **PASS** — Removing leadership hides the team's requests immediately; restoring it brings them back. Note: "Make leader" is offered only to teamLeader-role members, so the test used "No leader" / "Make leader" on W-0021.
6. **PASS** — An office batch date change (Wed 14 → Thu 15 Oct) reached the phone; "last changed" showed "Office".
7. **PASS** — Arranged 6 → 8 gives 6 arranged + 2 waiting; 8 → 5 removes the 2, then flags −1; the office resolved it to 5. The unlisted item was matched to the catalogue.
8. **PASS** — Offline send plus a killed app stayed Pending sync; it was received once when signal returned. *The closed-destination half was dropped:* Barlin is on the Time In list, so Allow requests off cannot close it without touching a live site. That path is covered by acceptance §2 and the app's unit tests.
9. **PASS** — Cancelling the last item closes the request (by worker). An offline cancel that arrives after the office cancel shows Cancelled, not Failed.
10. **PASS** — W-0007 Time In / Time Out reached the server in 6–7 s, app 1004.

**Task 4: no code fix needed.** App polish was batched for the next app release:
- the detail subtitle reads "Team Team test" (it prefixes "Team" to a name that already starts with it);
- the cancelled-line text is green (it should be grey);
- unlisted items have no unit hint ("e.g. pc, bag, m");
- empty 0-item drafts are kept.

**Task 5:**
- **Pilot data kept by the user's choice:** the test requests, "Team pilot B" and "ZZ pilot drill" were left as they are.
- **The APK was not published:** 0.4.0+1004 is still on the test phone only.

**Next:** Stage 1b (item history and photos) per spec §6. Before Stage 2, refuse changing the kind or identity of a catalogue item already matched to lines.
