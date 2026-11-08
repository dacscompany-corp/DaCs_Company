-- 0113 — WorkMate Linked Labor: a Project Control labor contract linked to a
-- worker's WorkMate account, every contract's history, and the worker's own
-- view of their agreements.
--
-- Terms: docs/superpowers/specs/2026-11-04-workmate-linked-labor-contracts-mvp-terms.md
--        (approved 4 Nov 2026). Answers of 7 Nov: Q1–Q5 = A.
-- Design: docs/superpowers/specs/2026-11-07-workmate-linked-labor-design.md
--
-- A. labor_contracts.worker_id: the linked account. Only the main owner links,
--    relinks or unlinks (lc_link, or choosing an account when creating the
--    contract). Nothing links by name, and linking moves no money.
--
-- B. History for EVERY Project Control labor contract, linked or not (Q3). A
--    contract is "established" once it has a signed agreement or a payment.
--    After that its terms change only through lc_edit / lc_merge with a reason,
--    daily↔fixed and labor↔outsource never change (Q4), and it is deleted only
--    through lc_delete / lc_merge with a reason. A linked contract is never
--    deleted, except into a keeper linked to the same account. lc_events keeps
--    who, when, before, after and why, and can't be edited or deleted.
--
-- C. Ending a contract (lc_end) marks nothing paid and moves no payment; an
--    ended contract can still be paid to settle it. A replacement is simply a
--    new contract: the old one keeps its payments and its balance (Q4).
--
-- D. ll_my_agreements(): the signed-in worker's OWN linked labor contracts,
--    with the project's own BOQ progress (Q1: never the main project's figure
--    for Additional Works), agreed / paid / balance under lcPaid's rule, and
--    payments as date · amount · method (Q5). Nothing else: no notes, receipts,
--    signatures, history, billing periods or anyone else's money.
--
-- No money moves: nothing here inserts payroll, an expense, a payment or a bill.
-- lc_merge only repoints payroll rows to the keeper, as the office merge always
-- has, so agreed, paid and balance read the same before and after.

set local lock_timeout = '5s';

-- ════ 1. Columns ═══════════════════════════════════════════════════

alter table labor_contracts add column if not exists worker_id uuid references profiles(id);
alter table labor_contracts add column if not exists ended_at timestamptz;
alter table labor_contracts add column if not exists ended_by uuid references profiles(id);
create index if not exists labor_contracts_worker_idx on labor_contracts (worker_id) where worker_id is not null;

-- ════ 2. History ═══════════════════════════════════════════════════

-- contract_id has no foreign key on purpose: the record outlives a deleted contract.
create table if not exists lc_events (
  id bigserial primary key,
  owner_id uuid not null,
  contract_id uuid not null,
  kind text not null check (kind in ('created', 'linked', 'relinked', 'unlinked', 'edited',
                                     'ended', 'reopened', 'merged', 'deleted')),
  before jsonb,
  after jsonb,
  reason text not null default '' check (char_length(reason) <= 500),
  actor_id uuid,
  at timestamptz not null default clock_timestamp()
);
create index if not exists lc_events_contract_idx on lc_events (contract_id, id);

alter table lc_events enable row level security;
revoke all on lc_events from public, anon, authenticated;
revoke all on sequence lc_events_id_seq from public, anon, authenticated;
grant select on lc_events to authenticated;
-- Owner accounts of the company read it. Staff don't: it holds amounts.
drop policy if exists lc_events_owner_read on lc_events;
create policy lc_events_owner_read on lc_events for select to authenticated
  using (is_owner() and owner_id = attendance_data_owner());

create or replace function lc_events_no_change() returns trigger
language plpgsql as $$
begin
  raise exception 'LC_EVENTS_APPEND_ONLY' using errcode = 'P0001';
end;
$$;
drop trigger if exists lc_events_no_change on lc_events;
create trigger lc_events_no_change before update or delete on lc_events
  for each row execute function lc_events_no_change();
drop trigger if exists lc_events_no_truncate on lc_events;
create trigger lc_events_no_truncate before truncate on lc_events
  for each statement execute function lc_events_no_change();

-- ════ 3. Helpers (internal: no grant) ══════════════════════════════

-- What the parties agreed to. notes, status and updated_at stay free.
create or replace function lc_terms(c labor_contracts) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'worker_name', c.worker_name, 'scope', c.scope, 'trade', c.trade,
    'agreed_amount', c.agreed_amount, 'pay_type', c.pay_type, 'pay_basis', c.pay_basis,
    'category', c.category, 'works', c.works, 'folder_id', c.folder_id,
    'orientation_date', c.orientation_date,
    'agreement_signed', c.agreement_signed, 'agreement_signed_at', c.agreement_signed_at,
    'agreement_signature', c.agreement_signature, 'agreement_signature_image', c.agreement_signature_image,
    'agreement_terms_snapshot', c.agreement_terms_snapshot,
    'agreement_pdf_url', c.agreement_pdf_url, 'agreement_pdf_name', c.agreement_pdf_name)
$$;

-- The terms with every blank made the same: '' and [] read as NULL. The form
-- sends '' for an empty box and [] for no works, and the office live today
-- re-sends every field on each save, so a blank must never read as a change of
-- terms — on live, 5 contracts have no trade and 2 no agreement file.
create or replace function lc_blank_free(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(e.key, case when e.value in ('""'::jsonb, '[]'::jsonb) then 'null'::jsonb else e.value end),
                  '{}'::jsonb)
    from jsonb_each(p) e
$$;

-- Signed, or paid at least once.
create or replace function lc_established(p_id uuid, p_signed boolean) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_signed, false) or exists (select 1 from payroll where contract_id = p_id)
$$;

-- Every writer of cap_history only appends (Raise cap, Edit, Add file, merge):
-- the old array must be the start of the new one.
create or replace function lc_history_appended(p_old jsonb, p_new jsonb) returns boolean
language sql immutable as $$
  select case
    when p_old is null or jsonb_typeof(p_old) <> 'array' or jsonb_array_length(p_old) = 0 then true
    when p_new is null or jsonb_typeof(p_new) <> 'array'
         or jsonb_array_length(p_new) < jsonb_array_length(p_old) then false
    else not exists (select 1 from generate_series(0, jsonb_array_length(p_old) - 1) i
                      where (p_old -> i) is distinct from (p_new -> i))
  end
$$;

create or replace function lc_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(p.display_name), ''),
                  nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
                  case when p.worker_no is null then null else 'W-' || lpad(p.worker_no::text, 4, '0') end,
                  'Worker')
    from profiles p where p.id = p_id
$$;

create or replace function lc_who(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('worker_id', p.id, 'worker_no', p.worker_no, 'name', lc_person_name(p.id))
    from profiles p where p.id = p_id
$$;

-- An active worker or team leader of this company. Never a client, partner,
-- office account, switched-off account or another company's worker.
create or replace function lc_eligible_worker(p_worker uuid, p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_worker is not null and p_company is not null and exists (
    select 1 from profiles p
     where p.id = p_worker and p.owner_id = p_company
       and p.role in ('worker', 'teamLeader') and coalesce(p.status, 'active') = 'active')
$$;

-- The caller's company, for an active owner or staff account (today's contract access).
create or replace function lc_office_company() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; v_owner uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select role, owner_id, status into v_role, v_owner, v_status from profiles where id = auth.uid();
  if v_role is null or v_role not in ('owner', 'staff') or (v_role = 'staff' and v_owner is null) then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if coalesce(v_status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  return coalesce(v_owner, auth.uid());
end;
$$;

-- The same, for an owner-role account only (end, reopen, delete, merge: the
-- contract card's owner toolbar).
create or replace function lc_owner_company() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; v_owner uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = 'P0001'; end if;
  select role, owner_id, status into v_role, v_owner, v_status from profiles where id = auth.uid();
  if v_role is distinct from 'owner' then raise exception 'OWNER_ROLE_ONLY' using errcode = 'P0001'; end if;
  if coalesce(v_status, 'active') <> 'active' then raise exception 'INACTIVE' using errcode = 'P0001'; end if;
  return coalesce(v_owner, auth.uid());
end;
$$;

-- Choosing an account when a contract is created: main owner only, an
-- eligible worker of the company, labor contracts only.
create or replace function lc_check_link(p_company uuid, p_worker uuid, p_category text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_main uuid := pm_main_owner_id();
begin
  if p_company is distinct from v_main then raise exception 'LC_NOT_FOUND' using errcode = 'P0001'; end if;
  if coalesce(p_category, 'labor') <> 'labor' then raise exception 'LABOR_ONLY' using errcode = 'P0001'; end if;
  perform 1 from profiles where id = p_worker for share;
  if not lc_eligible_worker(p_worker, p_company) then raise exception 'NOT_ELIGIBLE' using errcode = 'P0001'; end if;
end;
$$;

-- lcWorksList: names only, trimmed, empty ones dropped.
create or replace function lc_works_list(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(to_jsonb(n) order by o), '[]'::jsonb) from (
    select btrim(case when jsonb_typeof(w) = 'string' then w #>> '{}'
                      when jsonb_typeof(w) = 'object' then coalesce(w ->> 'name', '')
                      else '' end) n, o
      from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality x(w, o)) s
   where n <> ''
$$;

-- lcDrawsDown: indirect pay and indirect burden are Overhead and never draw a contract down.
create or replace function lc_draws_down(p payroll) returns boolean
language sql immutable as $$
  select not (coalesce(p.labor_type, '') = 'indirect'
              or (coalesce(p.labor_type, '') = 'liability' and coalesce(p.liability_for, '') = 'indirect'))
$$;

-- ════ 4. The guard and the log ═════════════════════════════════════
-- The lc_* functions open the guard with a transaction-local flag naming the
-- caller (dacs.lc_fn), as 0111's role switch does. PostgREST exposes no
-- set_config, so a browser can't set it.

create or replace function lc_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  -- coalesce: with the flag unset the comparison is NULL, and NOT NULL would
  -- let a direct write through.
  v_fn boolean := coalesce(auth.uid() is not null and current_setting('dacs.lc_fn', true) = auth.uid()::text, false);
  v_into text := coalesce(current_setting('dacs.lc_merge_into', true), '');
  v_reason text := coalesce(current_setting('dacs.lc_reason', true), '');
  v_paid numeric;
  v_n int;
begin
  if tg_op = 'INSERT' then
    if new.ended_at is not null or new.ended_by is not null then
      raise exception 'LC_FIELD_LOCKED' using errcode = 'P0001', detail = 'ended_at';
    end if;
    if new.worker_id is not null and not v_fn then
      perform lc_check_link(new.owner_id, new.worker_id, new.category);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Deleting a project folder takes its contracts with it, as it always has
    -- (the folder is already gone when its foreign key deletes them). Logged.
    if old.folder_id is null or exists (select 1 from folders where id = old.folder_id) then
      if old.worker_id is not null and not (v_fn and v_into <> '' and exists (
           select 1 from labor_contracts k where k.id::text = v_into and k.worker_id = old.worker_id)) then
        raise exception 'LC_LINKED' using errcode = 'P0001';
      end if;
      if not v_fn and lc_established(old.id, old.agreement_signed) then
        raise exception 'LC_REASON_NEEDED' using errcode = 'P0001';
      end if;
    elsif v_reason = '' then
      v_reason := 'Project folder deleted';
    end if;
    -- Logged here, before payroll.contract_id is set to null.
    select count(*), coalesce(sum(total_salary), 0) into v_n, v_paid
      from payroll p where p.contract_id = old.id and lc_draws_down(p);
    insert into lc_events (owner_id, contract_id, kind, before, after, reason, actor_id)
    values (old.owner_id, old.id,
            case when v_fn and v_into <> '' then 'merged' else 'deleted' end,
            lc_terms(old) || jsonb_build_object('worker_id', old.worker_id, 'ended_at', old.ended_at,
                                                'payments', v_n, 'paid', v_paid),
            case when v_fn and v_into <> '' then jsonb_build_object('merged_into', v_into) end,
            left(v_reason, 500), auth.uid());
    return old;
  end if;

  -- UPDATE
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id then
    raise exception 'LC_FIELD_LOCKED' using errcode = 'P0001', detail = 'owner_id';
  end if;
  if (new.worker_id is distinct from old.worker_id or new.ended_at is distinct from old.ended_at
      or new.ended_by is distinct from old.ended_by) and not v_fn then
    raise exception 'LC_USE_FUNCTION' using errcode = 'P0001';
  end if;
  if not lc_history_appended(old.cap_history, new.cap_history) then
    raise exception 'LC_HISTORY_APPEND_ONLY' using errcode = 'P0001';
  end if;
  if new.worker_id is not null and coalesce(new.category, 'labor') <> 'labor' then
    raise exception 'LABOR_ONLY' using errcode = 'P0001';
  end if;
  if lc_blank_free(lc_terms(new)) is distinct from lc_blank_free(lc_terms(old)) then
    -- A payroll insert's foreign-key check holds FOR KEY SHARE on this row
    -- until it commits; taking FOR UPDATE waits for it, so a payment saved at
    -- the same moment can't slip a reasonless edit through.
    perform 1 from labor_contracts where id = old.id for update;
    if lc_established(old.id, old.agreement_signed) then
      if coalesce(new.pay_basis, 'fixed') <> coalesce(old.pay_basis, 'fixed')
         or coalesce(new.category, 'labor') <> coalesce(old.category, 'labor') then
        raise exception 'LC_BASIS_LOCKED' using errcode = 'P0001';
      end if;
      if not v_fn then
        raise exception 'LC_REASON_NEEDED' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function lc_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason text := left(coalesce(current_setting('dacs.lc_reason', true), ''), 500);
  v_old jsonb; v_new jsonb; v_b jsonb; v_a jsonb;
begin
  if tg_op = 'INSERT' then
    insert into lc_events (owner_id, contract_id, kind, before, after, reason, actor_id)
    values (new.owner_id, new.id, 'created', null, lc_terms(new), '', auth.uid());
    if new.worker_id is not null then
      insert into lc_events (owner_id, contract_id, kind, before, after, reason, actor_id)
      values (new.owner_id, new.id, 'linked', null,
              lc_who(new.worker_id) || jsonb_build_object('recorded_name', new.worker_name), '', auth.uid());
    end if;
    return new;
  end if;
  v_old := lc_blank_free(lc_terms(old));
  v_new := lc_blank_free(lc_terms(new));
  if v_new is distinct from v_old then
    select jsonb_object_agg(o.key, o.value) into v_b from jsonb_each(v_old) o where o.value is distinct from (v_new -> o.key);
    select jsonb_object_agg(n.key, n.value) into v_a from jsonb_each(v_new) n where n.value is distinct from (v_old -> n.key);
    insert into lc_events (owner_id, contract_id, kind, before, after, reason, actor_id)
    values (new.owner_id, new.id, 'edited', v_b, v_a, v_reason, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists lc_guard on labor_contracts;
create trigger lc_guard before insert or update or delete on labor_contracts
  for each row execute function lc_guard();
drop trigger if exists lc_log on labor_contracts;
create trigger lc_log after insert or update on labor_contracts
  for each row execute function lc_log();

-- ════ 5. Office functions (only js/linked-labor.js calls these) ════

-- Who the main owner can link: active workers and team leaders of the company.
create or replace function lc_link_candidates() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', lc_person_name(p.id), 'worker_no', p.worker_no,
           'role', p.role, 'position', coalesce(p.position, ''))
         order by p.worker_no nulls last, lower(lc_person_name(p.id))), '[]'::jsonb)
    from profiles p
   where p.owner_id = pm_main_owner_id()
     and p.role in ('worker', 'teamLeader') and coalesce(p.status, 'active') = 'active'
$$;

-- Link, relink or unlink (p_worker null). The worker number must match the
-- account, so a same-name pick can't pass. Relinking or unlinking needs a reason.
create or replace function lc_link(p_contract uuid, p_worker uuid, p_worker_no integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_main uuid := pm_main_owner_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  c labor_contracts;
  v_kind text;
  v_no integer;
begin
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  select * into c from labor_contracts where id = p_contract for update;
  if c.id is null or c.owner_id is distinct from v_main then
    raise exception 'LC_NOT_FOUND' using errcode = 'P0001';
  end if;
  if coalesce(c.category, 'labor') <> 'labor' then raise exception 'LABOR_ONLY' using errcode = 'P0001'; end if;
  if p_worker is not distinct from c.worker_id then
    return jsonb_build_object('contract_id', c.id, 'worker_id', c.worker_id, 'changed', false);
  end if;
  if p_worker is not null then
    perform 1 from profiles where id = p_worker for share;
    if not lc_eligible_worker(p_worker, v_main) then raise exception 'NOT_ELIGIBLE' using errcode = 'P0001'; end if;
    select worker_no into v_no from profiles where id = p_worker;
    if p_worker_no is null or v_no is distinct from p_worker_no then
      raise exception 'WORKER_NO_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  v_kind := case when c.worker_id is null then 'linked' when p_worker is null then 'unlinked' else 'relinked' end;
  if v_kind <> 'linked' and v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  perform set_config('dacs.lc_fn', auth.uid()::text, true);
  update labor_contracts set worker_id = p_worker where id = c.id;
  perform set_config('dacs.lc_fn', '', true);
  insert into lc_events (owner_id, contract_id, kind, before, after, reason, actor_id)
  values (c.owner_id, c.id, v_kind,
          case when c.worker_id is not null then lc_who(c.worker_id) end,
          coalesce(lc_who(p_worker), jsonb_build_object('worker_id', null))
            || jsonb_build_object('recorded_name', c.worker_name),
          v_reason, auth.uid());
  return jsonb_build_object('contract_id', c.id, 'worker_id', p_worker, 'worker_no', v_no, 'changed', true);
end;
$$;

-- Edit a contract's terms (snake_case keys). Free while it is a draft; once it
-- is signed or paid a reason is required, and daily↔fixed and the category are
-- locked (Q4: end it and make a new one).
create or replace function lc_edit(p_contract uuid, p_changes jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := lc_office_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_allowed text[] := array['worker_name', 'scope', 'trade', 'agreed_amount', 'pay_type', 'pay_basis',
                            'category', 'works', 'notes', 'cap_history', 'orientation_date',
                            'agreement_signed', 'agreement_signed_at', 'agreement_signature',
                            'agreement_pdf_url', 'agreement_pdf_name'];
  c labor_contracts;
  n labor_contracts;
  k text;
  v_est boolean;
  v_changed text[] := '{}';
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'BAD_CHANGE' using errcode = 'P0001';
  end if;
  for k in select jsonb_object_keys(p_changes) loop
    if k in ('id', 'owner_id', 'folder_id', 'worker_id', 'ended_at', 'ended_by', 'created_at', 'legacy_id') then
      raise exception 'LC_FIELD_LOCKED' using errcode = 'P0001', detail = k;
    end if;
    if not (k = any (v_allowed)) then raise exception 'BAD_CHANGE' using errcode = 'P0001', detail = k; end if;
  end loop;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  select * into c from labor_contracts where id = p_contract for update;
  if c.id is null or c.owner_id is distinct from v_company then
    raise exception 'LC_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- A blank is a blank: the form sends '' for an empty box and [] for no
  -- works, which must not read as a change of terms against a NULL.
  n := jsonb_populate_record(c, (
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      from jsonb_each(p_changes) e
     where not (coalesce(e.value, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)
                and coalesce(to_jsonb(c) -> e.key, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '[]'::jsonb))));
  for k in select key from jsonb_each(to_jsonb(n)) loop
    if (to_jsonb(n) -> k) is distinct from (to_jsonb(c) -> k) then v_changed := v_changed || k; end if;
  end loop;
  if cardinality(v_changed) = 0 then
    return jsonb_build_object('contract_id', c.id, 'changed', '[]'::jsonb);
  end if;
  v_est := lc_established(c.id, c.agreement_signed);
  if v_est and lc_blank_free(lc_terms(n)) is distinct from lc_blank_free(lc_terms(c)) then
    if coalesce(n.pay_basis, 'fixed') <> coalesce(c.pay_basis, 'fixed')
       or coalesce(n.category, 'labor') <> coalesce(c.category, 'labor') then
      raise exception 'LC_BASIS_LOCKED' using errcode = 'P0001';
    end if;
    if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  end if;
  perform set_config('dacs.lc_fn', auth.uid()::text, true);
  perform set_config('dacs.lc_reason', v_reason, true);
  update labor_contracts set
    worker_name = n.worker_name, scope = n.scope, trade = n.trade, agreed_amount = n.agreed_amount,
    pay_type = n.pay_type, pay_basis = n.pay_basis, category = n.category, works = n.works,
    notes = n.notes, cap_history = n.cap_history, orientation_date = n.orientation_date,
    agreement_signed = n.agreement_signed, agreement_signed_at = n.agreement_signed_at,
    agreement_signature = n.agreement_signature, agreement_pdf_url = n.agreement_pdf_url,
    agreement_pdf_name = n.agreement_pdf_name, updated_at = now()
  where id = c.id;
  perform set_config('dacs.lc_fn', '', true);
  perform set_config('dacs.lc_reason', '', true);
  return jsonb_build_object('contract_id', c.id, 'established', v_est, 'changed', to_jsonb(v_changed));
end;
$$;

-- End a contract. Nothing is marked paid and no payment moves; it can still be
-- paid to settle it.
create or replace function lc_end(p_contract uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := lc_owner_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  c labor_contracts;
begin
  if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  select * into c from labor_contracts where id = p_contract for update;
  if c.id is null or c.owner_id is distinct from v_company then
    raise exception 'LC_NOT_FOUND' using errcode = 'P0001';
  end if;
  if c.ended_at is not null then
    return jsonb_build_object('contract_id', c.id, 'ended_at', c.ended_at, 'changed', false);
  end if;
  perform set_config('dacs.lc_fn', auth.uid()::text, true);
  update labor_contracts set ended_at = now(), ended_by = auth.uid() where id = c.id returning * into c;
  perform set_config('dacs.lc_fn', '', true);
  insert into lc_events (owner_id, contract_id, kind, before, after, reason, actor_id)
  values (c.owner_id, c.id, 'ended', null, jsonb_build_object('ended_at', c.ended_at), v_reason, auth.uid());
  return jsonb_build_object('contract_id', c.id, 'ended_at', c.ended_at, 'changed', true);
end;
$$;

create or replace function lc_reopen(p_contract uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := lc_owner_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  c labor_contracts;
begin
  if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  select * into c from labor_contracts where id = p_contract for update;
  if c.id is null or c.owner_id is distinct from v_company then
    raise exception 'LC_NOT_FOUND' using errcode = 'P0001';
  end if;
  if c.ended_at is null then
    return jsonb_build_object('contract_id', c.id, 'changed', false);
  end if;
  perform set_config('dacs.lc_fn', auth.uid()::text, true);
  update labor_contracts set ended_at = null, ended_by = null where id = c.id;
  perform set_config('dacs.lc_fn', '', true);
  insert into lc_events (owner_id, contract_id, kind, before, after, reason, actor_id)
  values (c.owner_id, c.id, 'reopened', jsonb_build_object('ended_at', c.ended_at), null, v_reason, auth.uid());
  return jsonb_build_object('contract_id', c.id, 'changed', true);
end;
$$;

-- Delete. A signed or paid contract needs a reason, and its terms stay in the
-- log; its payments become "Other (uncapped)" exactly as before (payroll's
-- foreign key sets them to null). A linked contract is never deleted.
create or replace function lc_delete(p_contract uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := lc_owner_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  c labor_contracts;
begin
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  select * into c from labor_contracts where id = p_contract for update;
  if c.id is null or c.owner_id is distinct from v_company then
    raise exception 'LC_NOT_FOUND' using errcode = 'P0001';
  end if;
  if c.worker_id is not null then raise exception 'LC_LINKED' using errcode = 'P0001'; end if;
  if lc_established(c.id, c.agreement_signed) and v_reason = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  perform set_config('dacs.lc_fn', auth.uid()::text, true);
  perform set_config('dacs.lc_reason', v_reason, true);
  delete from labor_contracts where id = c.id;
  perform set_config('dacs.lc_fn', '', true);
  perform set_config('dacs.lc_reason', '', true);
  return jsonb_build_object('contract_id', c.id, 'deleted', true);
end;
$$;

-- Merge one person's contracts into ONE lumpsum, in one step. Same company, project,
-- category and pay basis, and the same person: all linked to one account, or
-- all unlinked with the same typed name. The keeper takes the summed cap, the
-- works (in the order given) and the title; payments are repointed to it, then
-- the others are deleted. Agreed, paid and balance read the same.
create or replace function lc_merge(p_contracts uuid[], p_keeper uuid, p_title text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := lc_owner_company();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_title text := coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'General Works Package');
  v_n int := coalesce(cardinality(p_contracts), 0);
  k labor_contracts;
  v_others uuid[];
  v_total numeric;
  v_daily boolean;
  v_works jsonb;
  v_hist jsonb;
begin
  if v_n < 2 or p_keeper is null or not (p_keeper = any (p_contracts))
     or (select count(distinct x) from unnest(p_contracts) x) <> v_n
     or exists (select 1 from unnest(p_contracts) x where x is null) then
    raise exception 'BAD_MERGE' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  perform 1 from labor_contracts where id = any (p_contracts) order by id for update;
  if (select count(*) from labor_contracts where id = any (p_contracts) and owner_id = v_company) <> v_n then
    raise exception 'LC_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- One project only: a merge never moves pay or a cap between projects, and a
  -- project's Additional Works is a project of its own.
  if (select count(distinct coalesce(folder_id::text, '-')) from labor_contracts where id = any (p_contracts)) > 1 then
    raise exception 'LC_MERGE_FOLDER' using errcode = 'P0001';
  end if;
  if (select count(distinct coalesce(category, 'labor')) from labor_contracts where id = any (p_contracts)) > 1
     or (select count(distinct coalesce(worker_id::text, 'name:' || btrim(coalesce(worker_name, ''))))
           from labor_contracts where id = any (p_contracts)) > 1 then
    raise exception 'LC_MERGE_MIXED' using errcode = 'P0001';
  end if;
  if (select count(distinct coalesce(pay_basis, 'fixed')) from labor_contracts where id = any (p_contracts)) > 1 then
    raise exception 'LC_MERGE_BASIS' using errcode = 'P0001';
  end if;
  if v_reason = '' and exists (select 1 from labor_contracts where id = any (p_contracts)
                                  and lc_established(id, agreement_signed)) then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select * into k from labor_contracts where id = p_keeper;
  v_daily := coalesce(k.pay_basis, 'fixed') = 'daily';
  select coalesce(sum(coalesce(agreed_amount, 0)), 0) into v_total from labor_contracts where id = any (p_contracts);
  if v_daily then v_total := 0; end if;
  select coalesce(jsonb_agg(w.value order by a.ord, w.ordinality), '[]'::jsonb) into v_works
    from unnest(p_contracts) with ordinality a(id, ord)
    join labor_contracts c on c.id = a.id
    cross join lateral jsonb_array_elements(
      case when jsonb_array_length(lc_works_list(c.works)) > 0 then lc_works_list(c.works)
           else jsonb_build_array(coalesce(nullif(c.scope, ''), 'Untitled job')) end) with ordinality w;
  v_hist := case when jsonb_typeof(k.cap_history) = 'array' then k.cap_history else '[]'::jsonb end;
  if coalesce(k.agreed_amount, 0) <> v_total then
    v_hist := v_hist || jsonb_build_array(jsonb_build_object(
      'amount', v_total, 'at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'note', 'Merged ' || v_n || ' jobs into one lumpsum'));
  end if;
  select array_agg(x) into v_others from unnest(p_contracts) x where x <> p_keeper;
  perform set_config('dacs.lc_fn', auth.uid()::text, true);
  perform set_config('dacs.lc_reason', v_reason, true);
  perform set_config('dacs.lc_merge_into', p_keeper::text, true);
  update labor_contracts set scope = v_title, agreed_amount = v_total, works = v_works,
                             cap_history = v_hist, updated_at = now()
   where id = p_keeper;
  update payroll set contract_id = p_keeper where contract_id = any (v_others);
  delete from labor_contracts where id = any (v_others);
  perform set_config('dacs.lc_fn', '', true);
  perform set_config('dacs.lc_reason', '', true);
  perform set_config('dacs.lc_merge_into', '', true);
  return jsonb_build_object('keeper', p_keeper, 'merged', to_jsonb(v_others), 'agreed', v_total, 'works', v_works);
end;
$$;

-- ════ 6. Project progress (internal: no grant) ═════════════════════
-- A copy of _folderCompletion in js/portal-app.compiled.js: that folder's OWN
-- BOQ (the one with the most cost items), line total = qty × (material rate
-- unless overridden + labor rate unless overridden), accomplished = total × %
-- complete ÷ 100, progress = accomplished ÷ total kept between 0 and 1, and no
-- figure at all when either is 0. ll_linked_labor.pglite.mjs runs the real
-- _folderCompletion against this on the same BOQs.

-- _billNum: commas dropped, the leading number read the way parseFloat reads
-- it, anything else 0.
create or replace function ll_num(p jsonb) returns numeric
language plpgsql immutable as $$
declare s text; m text[];
begin
  if p is null then return 0; end if;
  if jsonb_typeof(p) = 'number' then return (p #>> '{}')::numeric; end if;
  if jsonb_typeof(p) <> 'string' then return 0; end if;
  s := replace(p #>> '{}', ',', '');
  m := regexp_match(s, '^\s*([+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)');
  if m is null then return 0; end if;
  return m[1]::numeric;
exception when others then
  return 0;
end;
$$;

-- JavaScript truthiness, for materialOverride / laborOverride.
create or replace function ll_truthy(p jsonb) returns boolean
language sql immutable as $$
  select case jsonb_typeof(p)
           when 'boolean' then (p #>> '{}')::boolean
           when 'number' then (p #>> '{}')::numeric <> 0
           when 'string' then (p #>> '{}') <> ''
           when 'array' then true
           when 'object' then true
           else false end
$$;

create or replace function ll_folder_progress(p_folder uuid) returns double precision
language sql stable security definer set search_path = public, pg_temp as $$
  with doc as (
    select b.cost_items from boq_documents b
     where b.folder_id = p_folder
     order by case when jsonb_typeof(b.cost_items) = 'array' then jsonb_array_length(b.cost_items) else 0 end desc,
              b.created_at, b.id
     limit 1),
  li as (
    select ll_num(l -> 'qty')
             * ((case when ll_truthy(l -> 'materialOverride') then 0 else ll_num(l -> 'materialRate') end)
              + (case when ll_truthy(l -> 'laborOverride') then 0 else ll_num(l -> 'laborRate') end)) as t,
           ll_num(l -> 'percentCompletion') as pc
      from doc
      cross join lateral jsonb_array_elements(case when jsonb_typeof(doc.cost_items) = 'array' then doc.cost_items else '[]'::jsonb end) ci
      cross join lateral jsonb_array_elements(case when jsonb_typeof(ci -> 'subItems') = 'array' then ci -> 'subItems' else '[]'::jsonb end) si
      cross join lateral jsonb_array_elements(case when jsonb_typeof(si -> 'lineItems') = 'array' then si -> 'lineItems' else '[]'::jsonb end) l),
  s as (select coalesce(sum(t), 0) as total, coalesce(sum(t * pc / 100), 0) as acc from li)
  select case when total > 0 and acc > 0 then greatest(0, least(1, acc / total))::double precision end from s
$$;

-- ════ 7. The worker's own agreements (WorkMate only) ════════════════
-- Only the caller's own linked LABOR contracts in their own company. Paid =
-- lcPaid's rule. A payment's split parts (one split_group) are one line.
create or replace function ll_my_agreements() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  v_company := attendance_data_owner();
  return jsonb_build_object('agreements', coalesce((
    select jsonb_agg(x.a order by x.ended, lower(x.project), lower(x.scope), x.id)
      from (
        select c.id, c.ended_at is not null as ended, coalesce(f.name, '') as project, coalesce(c.scope, '') as scope,
               jsonb_build_object(
                 'id', c.id,
                 'project', coalesce(f.name, ''),
                 'main_project', pf.name,
                 'project_completed', f.completed_at is not null,
                 'progress_pct', ll_folder_progress(f.id) * 100,
                 'scope', coalesce(c.scope, ''),
                 'trade', coalesce(c.trade, ''),
                 'pay_basis', case when c.pay_basis = 'daily' then 'daily' else 'fixed' end,
                 'works', lc_works_list(c.works),
                 'agreed', case when c.pay_basis = 'daily' then null else coalesce(c.agreed_amount, 0) end,
                 'paid', pd.paid,
                 'balance', case when c.pay_basis = 'daily' then null else coalesce(c.agreed_amount, 0) - pd.paid end,
                 'ended', c.ended_at is not null,
                 'ended_at', c.ended_at,
                 'payments', pd.payments) as a
          from labor_contracts c
          join folders f on f.id = c.folder_id
          left join folders pf on pf.id = f.parent_folder_id
          cross join lateral (
            select coalesce(sum(s.amount), 0) as paid,
                   coalesce(jsonb_agg(jsonb_build_object('date', s.d, 'amount', s.amount, 'method', s.m)
                                      order by s.d desc nulls last, s.k), '[]'::jsonb) as payments
              from (select coalesce(p.split_group, p.id::text) as k,
                           min(p.payment_date) as d,
                           sum(coalesce(p.total_salary, 0)) as amount,
                           (array_agg(p.payment_method order by p.split_index nulls first, p.created_at))[1] as m
                      from payroll p
                     where p.contract_id = c.id and lc_draws_down(p)
                     group by 1) s) pd
         where c.worker_id = auth.uid() and c.owner_id = v_company
           and coalesce(c.category, 'labor') = 'labor') x), '[]'::jsonb));
end;
$$;

-- ════ 8. Grants ════════════════════════════════════════════════════

revoke all on function lc_events_no_change() from public, anon, authenticated;
revoke all on function lc_terms(labor_contracts) from public, anon, authenticated;
revoke all on function lc_blank_free(jsonb) from public, anon, authenticated;
revoke all on function lc_established(uuid, boolean) from public, anon, authenticated;
revoke all on function lc_history_appended(jsonb, jsonb) from public, anon, authenticated;
revoke all on function lc_person_name(uuid) from public, anon, authenticated;
revoke all on function lc_who(uuid) from public, anon, authenticated;
revoke all on function lc_eligible_worker(uuid, uuid) from public, anon, authenticated;
revoke all on function lc_office_company() from public, anon, authenticated;
revoke all on function lc_owner_company() from public, anon, authenticated;
revoke all on function lc_check_link(uuid, uuid, text) from public, anon, authenticated;
revoke all on function lc_works_list(jsonb) from public, anon, authenticated;
revoke all on function lc_draws_down(payroll) from public, anon, authenticated;
revoke all on function lc_guard() from public, anon, authenticated;
revoke all on function lc_log() from public, anon, authenticated;
revoke all on function ll_num(jsonb) from public, anon, authenticated;
revoke all on function ll_truthy(jsonb) from public, anon, authenticated;
revoke all on function ll_folder_progress(uuid) from public, anon, authenticated;

revoke all on function lc_link_candidates() from public, anon;
revoke all on function lc_link(uuid, uuid, integer, text) from public, anon;
revoke all on function lc_edit(uuid, jsonb, text) from public, anon;
revoke all on function lc_end(uuid, text) from public, anon;
revoke all on function lc_reopen(uuid, text) from public, anon;
revoke all on function lc_delete(uuid, text) from public, anon;
revoke all on function lc_merge(uuid[], uuid, text, text) from public, anon;
revoke all on function ll_my_agreements() from public, anon;
grant execute on function lc_link_candidates() to authenticated;
grant execute on function lc_link(uuid, uuid, integer, text) to authenticated;
grant execute on function lc_edit(uuid, jsonb, text) to authenticated;
grant execute on function lc_end(uuid, text) to authenticated;
grant execute on function lc_reopen(uuid, text) to authenticated;
grant execute on function lc_delete(uuid, text) to authenticated;
grant execute on function lc_merge(uuid[], uuid, text, text) to authenticated;
grant execute on function ll_my_agreements() to authenticated;
