-- ════════════════════════════════════════════════════════════════════
-- 0100 — PM worker cash advances (tracking ledger).
-- Spec: docs/superpowers/specs/2026-10-19-worker-cash-advances-design.md
--
-- Money advanced to workers on a PM project and the repayments the owner
-- records by hand. OUTSIDE the money model: nothing here creates payroll,
-- an expense, invoice or accounting entry, nothing writes weekly_bills, and
-- no Spent / Earned / Profit code reads these tables. The suggested
-- repayment is computed in the browser and is never stored as a repayment.
--
-- • Four private tables. RLS on, NO policies, privileges revoked. Every
--   read and write goes through the security-definer functions below.
-- • Who: owner-role accounts of the company — pm_owner_company() (0098).
-- • project_id is a PLAIN value (no FK): deleting a project neither blocks
--   on nor erases the ledger. The project is checked only when an advance
--   is created or moved to another project (spec R15); otherwise an advance
--   is reached through its saved company_owner_id.
-- • Every write takes p_op_id. The first call with an id does the work and
--   stores its result; a repeat returns that result and writes nothing (R16).
-- • Every write that reads or changes a balance first locks the advance row
--   (select … for update), so concurrent saves run one after another (R13).
-- • Amounts and % are validated AS RECEIVED: more than two decimals is
--   refused (BAD_PRECISION), never rounded by the numeric(…,2) cast.
-- Requires 0098. Idempotent where practical.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tables ─────────────────────────────────────────────────────────
create table if not exists pm_cash_advances (
  id                    uuid primary key default gen_random_uuid(),
  company_owner_id      uuid not null,
  project_id            uuid not null,
  project_name_snapshot text,
  worker_name           text not null check (length(btrim(worker_name)) between 1 and 120),
  issued_on             date not null,
  amount                numeric(12,2) not null check (amount > 0),
  suggest_pct           numeric(5,2) not null default 30 check (suggest_pct >= 0 and suggest_pct <= 100),
  notes                 text,
  created_by            uuid not null,
  created_at            timestamptz not null default now(),
  updated_by            uuid,
  updated_at            timestamptz,
  voided_at             timestamptz,
  voided_by             uuid,
  void_reason           text,
  constraint pm_cash_advances_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0))
);
create index if not exists pm_cash_advances_company_idx on pm_cash_advances(company_owner_id, issued_on desc);
create index if not exists pm_cash_advances_project_idx on pm_cash_advances(project_id);

create table if not exists pm_cash_advance_repayments (
  id               uuid primary key default gen_random_uuid(),
  advance_id       uuid not null references pm_cash_advances(id) on delete restrict,
  company_owner_id uuid not null,
  paid_on          date not null,
  amount           numeric(12,2) not null check (amount > 0),
  -- Optional snapshot of the Labor line the suggestion was based on:
  -- { billId, entryIds[], day, details, amount }. Never a live link (R12).
  payroll_ref      jsonb,
  notes            text,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text,
  constraint pm_cash_advance_repayments_void_chk check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(void_reason)) > 0))
);
create index if not exists pm_cash_advance_repayments_advance_idx on pm_cash_advance_repayments(advance_id);

-- Append-only history. seq gives a stable order even inside one transaction.
create table if not exists pm_cash_advance_events (
  seq              bigint generated always as identity primary key,
  advance_id       uuid not null,
  company_owner_id uuid not null,
  kind             text not null check (kind in ('issued', 'edited', 'repaid', 'repayment_voided', 'voided')),
  repayment_id     uuid,
  changes          jsonb,
  reason           text,
  actor_id         uuid not null,
  actor_email      text,
  at               timestamptz not null default now()
);
create index if not exists pm_cash_advance_events_advance_idx on pm_cash_advance_events(advance_id, seq);

-- One row per submitted write (spec §5.3a).
create table if not exists pm_cash_advance_ops (
  op_id            uuid primary key,
  company_owner_id uuid not null,
  action           text not null check (action in ('record_advance', 'edit_advance', 'record_repayment',
                                                   'void_repayment', 'void_advance')),
  result           jsonb,
  actor_id         uuid not null,
  at               timestamptz not null default now()
);

create or replace function pm_ca_events_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists pm_ca_events_immutable_trg on pm_cash_advance_events;
create trigger pm_ca_events_immutable_trg
  before update or delete on pm_cash_advance_events
  for each row execute function pm_ca_events_immutable();

-- ── 2. Internal helpers (never granted to clients) ────────────────────
create or replace function pm_ca_clean(p text) returns text
language sql immutable set search_path = public, pg_temp as $$ select nullif(btrim(p), '') $$;

create or replace function pm_ca_check_amount(p numeric) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p = 'NaN'::numeric or p <= 0 or p >= 10000000000 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if p <> round(p, 2) then raise exception 'BAD_PRECISION' using errcode = 'P0001'; end if;
end;
$$;

create or replace function pm_ca_check_pct(p numeric) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p = 'NaN'::numeric or p < 0 or p > 100 then
    raise exception 'BAD_PCT' using errcode = 'P0001';
  end if;
  if p <> round(p, 2) then raise exception 'BAD_PRECISION' using errcode = 'P0001'; end if;
end;
$$;

-- Checked one step at a time: SQL does not promise left-to-right OR, and
-- jsonb_array_length on a non-array would raise its own error.
create or replace function pm_ca_clean_ref(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'BAD_REF' using errcode = 'P0001'; end if;
  if coalesce(jsonb_typeof(p->'billId'), '') <> 'string' or btrim(p->>'billId') = '' then
    raise exception 'BAD_REF' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_typeof(p->'entryIds'), '') <> 'array' then raise exception 'BAD_REF' using errcode = 'P0001'; end if;
  if jsonb_array_length(p->'entryIds') = 0
     or exists (select 1 from jsonb_array_elements(p->'entryIds') x where jsonb_typeof(x) <> 'string') then
    raise exception 'BAD_REF' using errcode = 'P0001';
  end if;
  if coalesce(jsonb_typeof(p->'day'), '') <> 'string' or coalesce(jsonb_typeof(p->'details'), '') <> 'string'
     or coalesce(jsonb_typeof(p->'amount'), '') <> 'number' then
    raise exception 'BAD_REF' using errcode = 'P0001';
  end if;
  return jsonb_build_object('billId', p->'billId', 'entryIds', p->'entryIds', 'day', p->'day',
                            'details', p->'details', 'amount', p->'amount');
end;
$$;

-- R16. Returns NULL when this call owns the operation, otherwise the stored
-- result of the first call. A concurrent call with the same id waits on the
-- primary key until the first one commits or rolls back.
create or replace function pm_ca_op_begin(p_op uuid, p_company uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_got uuid; v_row record;
begin
  if p_op is null then raise exception 'BAD_OP' using errcode = 'P0001'; end if;
  insert into pm_cash_advance_ops (op_id, company_owner_id, action, actor_id)
  values (p_op, p_company, p_action, auth.uid())
  on conflict (op_id) do nothing
  returning op_id into v_got;
  if v_got is not null then return null; end if;
  select company_owner_id, action, result into v_row from pm_cash_advance_ops where op_id = p_op;
  if v_row.company_owner_id is distinct from p_company or v_row.action is distinct from p_action
     or v_row.result is null then
    raise exception 'OP_CONFLICT' using errcode = 'P0001';
  end if;
  return v_row.result;
end;
$$;

create or replace function pm_ca_op_end(p_op uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update pm_cash_advance_ops set result = p_result where op_id = p_op;
  return p_result;
end;
$$;

-- R13. The one lock every balance-affecting write takes first.
create or replace function pm_ca_lock(p_id uuid, p_company uuid) returns pm_cash_advances
language plpgsql security definer set search_path = public, pg_temp as $$
declare v pm_cash_advances;
begin
  select * into v from pm_cash_advances where id = p_id and company_owner_id = p_company for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  return v;
end;
$$;

create or replace function pm_ca_repaid(p_id uuid) returns numeric
language sql security definer set search_path = public, pg_temp as $$
  select coalesce(sum(amount), 0) from pm_cash_advance_repayments where advance_id = p_id and voided_at is null
$$;

-- R15. A project being newly assigned must be live and in the caller's company.
create or replace function pm_ca_project_name(p_project uuid, p_company uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  select cp.project_name into v
    from pm_project_companies m join construction_projects cp on cp.id = m.project_id
   where m.project_id = p_project and m.company_owner_id = p_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  return coalesce(v, '');
end;
$$;

create or replace function pm_ca_event(p_advance uuid, p_company uuid, p_kind text, p_repayment uuid,
                                       p_changes jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into pm_cash_advance_events (advance_id, company_owner_id, kind, repayment_id, changes, reason, actor_id, actor_email)
  values (p_advance, p_company, p_kind, p_repayment, p_changes, p_reason, auth.uid(),
          (select email from profiles where id = auth.uid()));
end;
$$;

-- The one JSON shape every read and write returns. NO company check —
-- private; callers have already scoped p_id to the caller's company.
create or replace function pm_ca_advance_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', a.id, 'project_id', a.project_id, 'project_name', a.project_name_snapshot,
    'project_deleted', not exists (select 1 from construction_projects cp where cp.id = a.project_id),
    'worker_name', a.worker_name, 'issued_on', a.issued_on, 'amount', a.amount, 'suggest_pct', a.suggest_pct,
    'notes', a.notes, 'created_at', a.created_at, 'updated_at', a.updated_at,
    'voided_at', a.voided_at, 'void_reason', a.void_reason,
    'voided_by_email', (select email from profiles where id = a.voided_by),
    'repayments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'paid_on', r.paid_on, 'amount', r.amount, 'payroll_ref', r.payroll_ref,
               'notes', r.notes, 'created_at', r.created_at, 'voided_at', r.voided_at,
               'void_reason', r.void_reason,
               'voided_by_email', (select email from profiles where id = r.voided_by))
             order by r.paid_on, r.created_at, r.id)
        from pm_cash_advance_repayments r where r.advance_id = a.id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', e.kind, 'repayment_id', e.repayment_id, 'changes', e.changes,
               'reason', e.reason, 'actor_email', e.actor_email, 'at', e.at) order by e.seq)
        from pm_cash_advance_events e where e.advance_id = a.id), '[]'::jsonb))
  from pm_cash_advances a where a.id = p_id
$$;

-- ── 3. Reads ──────────────────────────────────────────────────────────
create or replace function pm_ca_projects() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid := pm_owner_company();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', cp.id, 'name', coalesce(cp.project_name, ''))
                     order by lower(coalesce(cp.project_name, '')), cp.id)
      from pm_project_companies m join construction_projects cp on cp.id = m.project_id
     where m.company_owner_id = v_company), '[]'::jsonb);
end;
$$;

create or replace function pm_ca_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid := pm_owner_company();
begin
  return coalesce((
    select jsonb_agg(pm_ca_advance_json(a.id) order by a.issued_on desc, a.created_at desc, a.id)
      from pm_cash_advances a where a.company_owner_id = v_company), '[]'::jsonb);
end;
$$;

-- ── 4. Writes ─────────────────────────────────────────────────────────
create or replace function pm_ca_record_advance(p_op_id uuid, p_project uuid, p_worker text, p_issued_on date,
                                                p_amount numeric, p_pct numeric, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_worker  text := pm_ca_clean(p_worker);
  v_name    text;
  v_id      uuid;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'record_advance');
  if v_prior is not null then return v_prior; end if;
  perform pm_ca_check_amount(p_amount);
  perform pm_ca_check_pct(p_pct);
  if v_worker is null or length(v_worker) > 120 then raise exception 'BAD_WORKER' using errcode = 'P0001'; end if;
  if p_issued_on is null then raise exception 'BAD_DATE' using errcode = 'P0001'; end if;
  v_name := pm_ca_project_name(p_project, v_company);
  insert into pm_cash_advances (company_owner_id, project_id, project_name_snapshot, worker_name, issued_on,
                                amount, suggest_pct, notes, created_by)
  values (v_company, p_project, v_name, v_worker, p_issued_on, p_amount, p_pct, pm_ca_clean(p_notes), auth.uid())
  returning id into v_id;
  perform pm_ca_event(v_id, v_company, 'issued', null, null, null);
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(v_id)));
end;
$$;

create or replace function pm_ca_edit_advance(p_op_id uuid, p_id uuid, p_project uuid, p_worker text, p_issued_on date,
                                              p_amount numeric, p_pct numeric, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_adv     pm_cash_advances;
  v_worker  text := pm_ca_clean(p_worker);
  v_notes   text := pm_ca_clean(p_notes);
  v_name    text;
  v_changes jsonb := '{}'::jsonb;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'edit_advance');
  if v_prior is not null then return v_prior; end if;
  v_adv := pm_ca_lock(p_id, v_company);
  if v_adv.voided_at is not null then raise exception 'VOIDED' using errcode = 'P0001'; end if;
  perform pm_ca_check_amount(p_amount);
  perform pm_ca_check_pct(p_pct);
  if v_worker is null or length(v_worker) > 120 then raise exception 'BAD_WORKER' using errcode = 'P0001'; end if;
  if p_issued_on is null then raise exception 'BAD_DATE' using errcode = 'P0001'; end if;
  if p_amount < pm_ca_repaid(p_id) then raise exception 'BELOW_REPAID' using errcode = 'P0001'; end if;

  v_name := v_adv.project_name_snapshot;
  if p_project is distinct from v_adv.project_id then
    v_name := pm_ca_project_name(p_project, v_company);
    v_changes := v_changes || jsonb_build_object('project', jsonb_build_array(v_adv.project_name_snapshot, v_name));
  end if;
  if v_worker is distinct from v_adv.worker_name then
    v_changes := v_changes || jsonb_build_object('worker_name', jsonb_build_array(v_adv.worker_name, v_worker));
  end if;
  if p_issued_on is distinct from v_adv.issued_on then
    v_changes := v_changes || jsonb_build_object('issued_on', jsonb_build_array(v_adv.issued_on, p_issued_on));
  end if;
  if p_amount <> v_adv.amount then
    v_changes := v_changes || jsonb_build_object('amount', jsonb_build_array(v_adv.amount, p_amount::numeric(12,2)));
  end if;
  if p_pct <> v_adv.suggest_pct then
    v_changes := v_changes || jsonb_build_object('suggest_pct', jsonb_build_array(v_adv.suggest_pct, p_pct::numeric(5,2)));
  end if;
  if v_notes is distinct from v_adv.notes then
    v_changes := v_changes || jsonb_build_object('notes', jsonb_build_array(v_adv.notes, v_notes));
  end if;

  if v_changes <> '{}'::jsonb then
    update pm_cash_advances
       set project_id = p_project, project_name_snapshot = v_name, worker_name = v_worker,
           issued_on = p_issued_on, amount = p_amount, suggest_pct = p_pct, notes = v_notes,
           updated_by = auth.uid(), updated_at = now()
     where id = p_id;
    perform pm_ca_event(p_id, v_company, 'edited', null, v_changes, null);
  end if;
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(p_id),
                                                  'changed', v_changes <> '{}'::jsonb));
end;
$$;

create or replace function pm_ca_record_repayment(p_op_id uuid, p_advance uuid, p_paid_on date, p_amount numeric,
                                                  p_payroll_ref jsonb, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_adv     pm_cash_advances;
  v_ref     jsonb;
  v_rid     uuid;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'record_repayment');
  if v_prior is not null then return v_prior; end if;
  v_adv := pm_ca_lock(p_advance, v_company);
  if v_adv.voided_at is not null then raise exception 'VOIDED' using errcode = 'P0001'; end if;
  perform pm_ca_check_amount(p_amount);
  if p_paid_on is null then raise exception 'BAD_DATE' using errcode = 'P0001'; end if;
  v_ref := pm_ca_clean_ref(p_payroll_ref);
  if p_amount > v_adv.amount - pm_ca_repaid(p_advance) then
    raise exception 'OVER_BALANCE' using errcode = 'P0001';
  end if;
  insert into pm_cash_advance_repayments (advance_id, company_owner_id, paid_on, amount, payroll_ref, notes, created_by)
  values (p_advance, v_company, p_paid_on, p_amount, v_ref, pm_ca_clean(p_notes), auth.uid())
  returning id into v_rid;
  perform pm_ca_event(p_advance, v_company, 'repaid', v_rid, null, null);
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(p_advance), 'repayment_id', v_rid));
end;
$$;

create or replace function pm_ca_void_repayment(p_op_id uuid, p_repayment uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_reason  text := pm_ca_clean(p_reason);
  v_aid     uuid;
  v_rep     pm_cash_advance_repayments;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'void_repayment');
  if v_prior is not null then return v_prior; end if;
  if v_reason is null then raise exception 'BAD_REASON' using errcode = 'P0001'; end if;
  select advance_id into v_aid from pm_cash_advance_repayments
   where id = p_repayment and company_owner_id = v_company;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  perform pm_ca_lock(v_aid, v_company);                       -- parent first, always
  select * into v_rep from pm_cash_advance_repayments where id = p_repayment for update;
  if v_rep.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  update pm_cash_advance_repayments
     set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where id = p_repayment;
  perform pm_ca_event(v_aid, v_company, 'repayment_voided', p_repayment, null, v_reason);
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(v_aid)));
end;
$$;

create or replace function pm_ca_void_advance(p_op_id uuid, p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_owner_company();
  v_prior   jsonb;
  v_reason  text := pm_ca_clean(p_reason);
  v_adv     pm_cash_advances;
begin
  v_prior := pm_ca_op_begin(p_op_id, v_company, 'void_advance');
  if v_prior is not null then return v_prior; end if;
  if v_reason is null then raise exception 'BAD_REASON' using errcode = 'P0001'; end if;
  v_adv := pm_ca_lock(p_id, v_company);
  if v_adv.voided_at is not null then raise exception 'ALREADY_VOIDED' using errcode = 'P0001'; end if;
  if exists (select 1 from pm_cash_advance_repayments where advance_id = p_id and voided_at is null) then
    raise exception 'HAS_REPAYMENTS' using errcode = 'P0001';
  end if;
  update pm_cash_advances set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_id;
  perform pm_ca_event(p_id, v_company, 'voided', null, null, v_reason);
  return pm_ca_op_end(p_op_id, jsonb_build_object('advance', pm_ca_advance_json(p_id)));
end;
$$;

-- ── 5. Privileges ─────────────────────────────────────────────────────
alter table pm_cash_advances           enable row level security;
alter table pm_cash_advance_repayments enable row level security;
alter table pm_cash_advance_events     enable row level security;
alter table pm_cash_advance_ops        enable row level security;
revoke all on table pm_cash_advances, pm_cash_advance_repayments, pm_cash_advance_events, pm_cash_advance_ops
  from public, anon, authenticated;
-- The identity behind pm_cash_advance_events.seq (0095 precedent).
revoke all on sequence pm_cash_advance_events_seq_seq from public, anon, authenticated;
revoke all on function pm_ca_events_immutable(), pm_ca_clean(text), pm_ca_check_amount(numeric),
                       pm_ca_check_pct(numeric), pm_ca_clean_ref(jsonb), pm_ca_op_begin(uuid, uuid, text),
                       pm_ca_op_end(uuid, jsonb), pm_ca_lock(uuid, uuid), pm_ca_repaid(uuid),
                       pm_ca_project_name(uuid, uuid), pm_ca_event(uuid, uuid, text, uuid, jsonb, text),
                       pm_ca_advance_json(uuid)
  from public, anon, authenticated;
revoke all on function pm_ca_projects(), pm_ca_list(),
                       pm_ca_record_advance(uuid, uuid, text, date, numeric, numeric, text),
                       pm_ca_edit_advance(uuid, uuid, uuid, text, date, numeric, numeric, text),
                       pm_ca_record_repayment(uuid, uuid, date, numeric, jsonb, text),
                       pm_ca_void_repayment(uuid, uuid, text), pm_ca_void_advance(uuid, uuid, text)
  from public, anon;
grant execute on function pm_ca_projects(), pm_ca_list(),
                          pm_ca_record_advance(uuid, uuid, text, date, numeric, numeric, text),
                          pm_ca_edit_advance(uuid, uuid, uuid, text, date, numeric, numeric, text),
                          pm_ca_record_repayment(uuid, uuid, date, numeric, jsonb, text),
                          pm_ca_void_repayment(uuid, uuid, text), pm_ca_void_advance(uuid, uuid, text)
  to authenticated;
