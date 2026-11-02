-- ════════════════════════════════════════════════════════════════════
-- 0110 — PM profit sharing: personal items.
-- Spec: docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md
--
-- An item the owner or the partner bought for THEMSELVES out of a PM
-- project's money. It lowers ONLY that person's sharing figure, after the
-- split (js/pm-sharing.js does the sum). OUTSIDE the money model: never a
-- bill, expense, Spent, Profit, payout, amount owed or accounting entry.
-- Nothing here reads or writes weekly_bills, expenses, warranty tables or
-- the sharing balance.
--
-- • Three private tables. RLS on, NO policies, privileges revoked. Reads go
--   through pm_sharing_read (restated below with an `items` key); writes
--   through pm_si_record / pm_si_correct / pm_si_void.
-- • Writes: MAIN OWNER only — pm_main_owner_id() (0098). Reads: owner-role
--   accounts of the company — pm_owner_company() (0098).
-- • Every write takes p_op_id: the first call with an id does the work and
--   stores its result; a repeat returns it and records nothing.
-- • Correct / void lock the item row and check its version (ITEM_CHANGED).
-- • Amounts are validated AS RECEIVED: more than two decimals is refused
--   (BAD_PRECISION), never rounded by the numeric(…,2) cast.
-- • project_id is a PLAIN value (no FK): deleting a project never erases
--   the items or their history (same as 0100).
-- • Receipt photos: pmSharing/<company>/<yyyy-mm>/<uuid>.jpg in `uploads`
--   (section 6): main owner writes, owner-role of that company reads.
-- Requires 0098 and 0102. Idempotent where practical.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Tables ─────────────────────────────────────────────────────────
create table if not exists pm_sharing_items (
  id               uuid primary key default gen_random_uuid(),
  company_owner_id uuid not null,
  project_id       uuid not null,
  charged_to       text not null check (charged_to in ('owner', 'partner')),
  item_name        text not null check (length(item_name) between 1 and 120),
  amount           numeric(14,2) not null check (amount > 0 and amount < 100000000),
  bought_on        date not null,
  note             text check (note is null or length(note) <= 500),
  receipt_path     text,
  status           text not null default 'active' check (status in ('active', 'voided')),
  void_reason      text,
  version          int not null default 1 check (version >= 1),
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_by       uuid not null,
  updated_at       timestamptz not null default now(),
  constraint pm_sharing_items_void_reason check ((status = 'voided') = (void_reason is not null))
);
create index if not exists pm_sharing_items_project_idx on pm_sharing_items(project_id);
create index if not exists pm_sharing_items_company_idx on pm_sharing_items(company_owner_id);

-- Append-only history: one row per record / correct / void.
create table if not exists pm_sharing_item_events (
  id               bigint generated always as identity primary key,
  item_id          uuid not null,
  company_owner_id uuid not null,
  kind             text not null check (kind in ('recorded', 'corrected', 'voided')),
  old_values       jsonb,
  new_values       jsonb not null,
  reason           text,
  actor_id         uuid not null,
  actor_email      text,
  at               timestamptz not null default now()
);
create index if not exists pm_sharing_item_events_item_idx on pm_sharing_item_events(item_id, id);

-- One row per submitted write.
create table if not exists pm_sharing_item_ops (
  op_id            uuid primary key,
  company_owner_id uuid not null,
  action           text not null check (action in ('record', 'correct', 'void')),
  result           jsonb,
  actor_id         uuid not null,
  at               timestamptz not null default now()
);

create or replace function pm_si_events_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists pm_si_events_immutable_trg on pm_sharing_item_events;
create trigger pm_si_events_immutable_trg
  before update or delete on pm_sharing_item_events
  for each row execute function pm_si_events_immutable();

-- ── 2. Internal helpers (never granted to clients) ────────────────────
-- Trimmed text, NULL when blank; too long → p_code.
create or replace function pm_si_text(p text, p_max int, p_code text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := nullif(btrim(p), '');
begin
  if v is not null and length(v) > p_max then raise exception '%', p_code using errcode = 'P0001'; end if;
  return v;
end;
$$;

-- Every field rule for a record or a correction, checked one at a time.
create or replace function pm_si_check(p_company uuid, p_charged_to text, p_name text, p_amount numeric,
                                       p_bought_on date, p_receipt text) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_charged_to is null or p_charged_to not in ('owner', 'partner') then
    raise exception 'BAD_CHARGED_TO' using errcode = 'P0001';
  end if;
  if p_name is null or length(p_name) > 120 then raise exception 'BAD_NAME' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or p_amount >= 100000000 then
    raise exception 'BAD_AMOUNT' using errcode = 'P0001';
  end if;
  if p_amount <> round(p_amount, 2) then raise exception 'BAD_PRECISION' using errcode = 'P0001'; end if;
  if p_bought_on is null or p_bought_on > (now() at time zone 'Asia/Manila')::date then
    raise exception 'BAD_DATE' using errcode = 'P0001';
  end if;
  if p_receipt is not null
     and p_receipt !~ ('^pmSharing/' || p_company::text || '/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$') then
    raise exception 'BAD_RECEIPT_PATH' using errcode = 'P0001';
  end if;
end;
$$;

-- NULL when this call owns the operation, otherwise the first call's result.
-- A concurrent call with the same id waits on the primary key.
create or replace function pm_si_op_begin(p_op uuid, p_company uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_got uuid; v_row record;
begin
  if p_op is null then raise exception 'BAD_OP' using errcode = 'P0001'; end if;
  insert into pm_sharing_item_ops (op_id, company_owner_id, action, actor_id)
  values (p_op, p_company, p_action, auth.uid())
  on conflict (op_id) do nothing
  returning op_id into v_got;
  if v_got is not null then return null; end if;
  select company_owner_id, action, result into v_row from pm_sharing_item_ops where op_id = p_op;
  if v_row.company_owner_id is distinct from p_company or v_row.action is distinct from p_action
     or v_row.result is null then
    raise exception 'OP_REUSED' using errcode = 'P0001';
  end if;
  return v_row.result;
end;
$$;

create or replace function pm_si_op_end(p_op uuid, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update pm_sharing_item_ops set result = p_result where op_id = p_op;
  return p_result;
end;
$$;

create or replace function pm_si_project_ok(p_project uuid, p_company uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  select company_owner_id into v from pm_project_companies where project_id = p_project;
  if not found then raise exception 'PROJECT_UNMAPPED' using errcode = 'P0001'; end if;
  if v is distinct from p_company then raise exception 'WRONG_COMPANY' using errcode = 'P0001'; end if;
end;
$$;

create or replace function pm_si_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', i.id, 'project_id', i.project_id, 'charged_to', i.charged_to,
           'item_name', i.item_name, 'amount', i.amount, 'bought_on', i.bought_on, 'note', i.note,
           'receipt_path', i.receipt_path, 'status', i.status, 'void_reason', i.void_reason,
           'version', i.version, 'created_at', i.created_at, 'updated_at', i.updated_at)
    from pm_sharing_items i where i.id = p_id
$$;

create or replace function pm_si_event(p_item uuid, p_company uuid, p_kind text, p_old jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into pm_sharing_item_events (item_id, company_owner_id, kind, old_values, new_values, reason, actor_id, actor_email)
  values (p_item, p_company, p_kind, p_old, pm_si_json(p_item), p_reason, auth.uid(),
          (select email from profiles where id = auth.uid()));
end;
$$;

-- The locked, active item at the version the caller saw.
create or replace function pm_si_lock(p_id uuid, p_company uuid, p_expected_version int) returns pm_sharing_items
language plpgsql security definer set search_path = public, pg_temp as $$
declare v pm_sharing_items;
begin
  select * into v from pm_sharing_items where id = p_id and company_owner_id = p_company for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if v.status = 'voided' then raise exception 'ITEM_VOIDED' using errcode = 'P0001'; end if;
  if p_expected_version is null or p_expected_version <> v.version then
    raise exception 'ITEM_CHANGED' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- ── 3. Writes — main owner only ───────────────────────────────────────
create or replace function pm_si_record(p_op_id uuid, p_project uuid, p_charged_to text, p_item_name text,
                                        p_amount numeric, p_bought_on date, p_note text, p_receipt_path text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_main_owner_id();
  v_prior   jsonb;
  v_name    text;
  v_note    text;
  v_receipt text := nullif(btrim(p_receipt_path), '');
  v_id      uuid;
begin
  v_prior := pm_si_op_begin(p_op_id, v_company, 'record');
  if v_prior is not null then return v_prior; end if;
  perform pm_si_project_ok(p_project, v_company);
  v_name := pm_si_text(p_item_name, 120, 'BAD_NAME');
  v_note := pm_si_text(p_note, 500, 'BAD_NOTE');
  perform pm_si_check(v_company, p_charged_to, v_name, p_amount, p_bought_on, v_receipt);
  insert into pm_sharing_items (company_owner_id, project_id, charged_to, item_name, amount, bought_on, note,
                                receipt_path, created_by, updated_by)
  values (v_company, p_project, p_charged_to, v_name, p_amount, p_bought_on, v_note, v_receipt, auth.uid(), auth.uid())
  returning id into v_id;
  perform pm_si_event(v_id, v_company, 'recorded', null, null);
  return pm_si_op_end(p_op_id, jsonb_build_object('item', pm_si_json(v_id)));
end;
$$;

create or replace function pm_si_correct(p_op_id uuid, p_id uuid, p_expected_version int, p_charged_to text,
                                         p_item_name text, p_amount numeric, p_bought_on date, p_note text,
                                         p_receipt_path text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_main_owner_id();
  v_prior   jsonb;
  v_item    pm_sharing_items;
  v_old     jsonb;
  v_name    text;
  v_note    text;
  v_reason  text;
  v_receipt text := nullif(btrim(p_receipt_path), '');
begin
  v_prior := pm_si_op_begin(p_op_id, v_company, 'correct');
  if v_prior is not null then return v_prior; end if;
  v_item := pm_si_lock(p_id, v_company, p_expected_version);
  v_reason := pm_si_text(p_reason, 500, 'BAD_REASON');
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  v_name := pm_si_text(p_item_name, 120, 'BAD_NAME');
  v_note := pm_si_text(p_note, 500, 'BAD_NOTE');
  perform pm_si_check(v_company, p_charged_to, v_name, p_amount, p_bought_on, v_receipt);
  if (p_charged_to, v_name, p_amount, p_bought_on, v_note, v_receipt) is not distinct from
     (v_item.charged_to, v_item.item_name, v_item.amount, v_item.bought_on, v_item.note, v_item.receipt_path) then
    return pm_si_op_end(p_op_id, jsonb_build_object('item', pm_si_json(p_id), 'changed', false));
  end if;
  v_old := pm_si_json(p_id);
  update pm_sharing_items
     set charged_to = p_charged_to, item_name = v_name, amount = p_amount, bought_on = p_bought_on,
         note = v_note, receipt_path = v_receipt, version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform pm_si_event(p_id, v_company, 'corrected', v_old, v_reason);
  return pm_si_op_end(p_op_id, jsonb_build_object('item', pm_si_json(p_id), 'changed', true));
end;
$$;

create or replace function pm_si_void(p_op_id uuid, p_id uuid, p_expected_version int, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid := pm_main_owner_id();
  v_prior   jsonb;
  v_item    pm_sharing_items;
  v_old     jsonb;
  v_reason  text;
begin
  v_prior := pm_si_op_begin(p_op_id, v_company, 'void');
  if v_prior is not null then return v_prior; end if;
  v_item := pm_si_lock(p_id, v_company, p_expected_version);
  v_reason := pm_si_text(p_reason, 500, 'BAD_REASON');
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  v_old := pm_si_json(p_id);
  update pm_sharing_items
     set status = 'voided', void_reason = v_reason, version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform pm_si_event(p_id, v_company, 'voided', v_old, v_reason);
  return pm_si_op_end(p_op_id, jsonb_build_object('item', pm_si_json(p_id)));
end;
$$;

-- ── 4. Read — 0098's pm_sharing_read, unchanged, plus `items` ─────────
create or replace function pm_sharing_read(p_projects uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_company  uuid := pm_owner_company();
  v_can_edit boolean;
begin
  v_can_edit := exists (select 1 from profiles where id = auth.uid() and role = 'owner'
                          and owner_id is null and coalesce(status, 'active') = 'active');
  return jsonb_build_object(
    'can_edit', v_can_edit,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', m.project_id,
               'partner_pct', coalesce(a.partner_pct, 50),
               'is_default', a.project_id is null,
               'version', coalesce(a.version, 0)) order by m.project_id)
        from pm_project_companies m
        left join pm_sharing_agreements a on a.project_id = m.project_id
       where m.company_owner_id = v_company
         and (p_projects is null or m.project_id = any(p_projects))), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'project_id', h.project_id, 'old_pct', h.old_pct, 'new_pct', h.new_pct,
               'old_was_default', h.old_was_default, 'reason', h.reason,
               'actor_email', h.actor_email, 'changed_at', h.changed_at,
               'project_name', h.project_name_snapshot) order by h.changed_at desc, h.id)
        from pm_sharing_changes h
       where h.company_owner_id = v_company
         and (p_projects is null or h.project_id = any(p_projects))), '[]'::jsonb),
    'partners', coalesce((
      select jsonb_agg(s.x) from (
        select distinct on (lower(pr.email)) jsonb_build_object(
                 'email', lower(pr.email),
                 'accepted', coalesce(pr.partner_agreement_accepted, false),
                 'accepted_at', pr.partner_agreement_accepted_at,
                 'doc_version', pr.partner_agreement_doc_version) as x
          from pm_project_companies m
          join construction_projects cp on cp.id = m.project_id
          join profiles pr on lower(pr.email) = lower(btrim(cp.partner_email)) and pr.role = 'partner'
         where m.company_owner_id = v_company
           and (p_projects is null or m.project_id = any(p_projects))
           and coalesce(btrim(cp.partner_email), '') <> ''
         order by lower(pr.email), pr.partner_agreement_accepted_at desc nulls last) s), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(pm_si_json(i.id) || jsonb_build_object('events', coalesce((
               select jsonb_agg(jsonb_build_object('kind', e.kind, 'reason', e.reason, 'actor_email', e.actor_email,
                                                   'at', e.at, 'old', e.old_values, 'new', e.new_values) order by e.id)
                 from pm_sharing_item_events e where e.item_id = i.id), '[]'::jsonb))
             order by i.bought_on desc, i.created_at desc)
        from pm_sharing_items i
       where i.company_owner_id = v_company
         and (p_projects is null or i.project_id = any(p_projects))), '[]'::jsonb)
  );
end;
$$;

-- ── 5. Privileges ─────────────────────────────────────────────────────
alter table pm_sharing_items       enable row level security;
alter table pm_sharing_item_events enable row level security;
alter table pm_sharing_item_ops    enable row level security;
revoke all on table pm_sharing_items, pm_sharing_item_events, pm_sharing_item_ops from public, anon, authenticated;
revoke all on sequence pm_sharing_item_events_id_seq from public, anon, authenticated;
revoke all on function pm_si_events_immutable(), pm_si_text(text, int, text),
                       pm_si_check(uuid, text, text, numeric, date, text), pm_si_op_begin(uuid, uuid, text),
                       pm_si_op_end(uuid, jsonb), pm_si_project_ok(uuid, uuid), pm_si_json(uuid),
                       pm_si_event(uuid, uuid, text, jsonb, text), pm_si_lock(uuid, uuid, int)
  from public, anon, authenticated;
revoke all on function pm_si_record(uuid, uuid, text, text, numeric, date, text, text),
                       pm_si_correct(uuid, uuid, int, text, text, numeric, date, text, text, text),
                       pm_si_void(uuid, uuid, int, text), pm_sharing_read(uuid[])
  from public, anon;
grant execute on function pm_si_record(uuid, uuid, text, text, numeric, date, text, text),
                          pm_si_correct(uuid, uuid, int, text, text, numeric, date, text, text, text),
                          pm_si_void(uuid, uuid, int, text), pm_sharing_read(uuid[])
  to authenticated;

-- ── 6. Receipt photos: pmSharing/<company>/<yyyy-mm>/<uuid>.jpg ───────
-- Write: the main owner. Read: owner-role accounts of that company (the main
-- owner and focused owners such as admin-pm@). data_owner_id() is the
-- caller's own id for a focused owner, so the company comes from 0098's
-- helpers. SECURITY DEFINER: those helpers are not granted to clients.
create or replace function public.pm_si_file_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_company uuid;
begin
  if auth.uid() is null then return false; end if;
  begin
    v_company := case when p_write then pm_main_owner_id() else pm_owner_company() end;
  exception when others then
    return false;
  end;
  return p_name ~ ('^pmSharing/' || v_company::text || '/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$');
end $$;
revoke all on function public.pm_si_file_ok(text, boolean) from public, anon;
grant execute on function public.pm_si_file_ok(text, boolean) to authenticated;

-- 0102's rules, plus the pmSharing folder.
create or replace function public.uploads_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_pid    uuid := dacs_try_uuid(split_part(p_name, '/', 2));
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only (not even the uploader once the switch is off).
  if v_folder = 'purchases' then
    return pur_buyer() and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- 0102: petty cash return photos — the main owner and the uploading buyer only.
  if v_folder = 'pettyCash' then
    return pur_petty_reader(p_name);
  end if;

  -- 0110: PM sharing personal-item receipts — owner-role accounts of THAT company only.
  if v_folder = 'pmSharing' then
    return pm_si_file_ok(p_name, false);
  end if;

  -- The uploader can always read back their own file.
  if p_owner_id is not null and p_owner_id = v_uid::text then return true; end if;

  -- Owner-only modules (quotations 0045, reimbursements 0041).
  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- Owner and staff: everything else (staff encode receipts from here).
  if is_owner() or is_staff() then return true; end if;

  -- Construction client / partner: files filed under THEIR project. Same
  -- test as the weekly_bills _client_read / _partner_read policies.
  if v_folder in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms') then
    return v_pid is not null
       and (cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid));
  end if;

  -- Employee agreement PDF: every non-owner admin role (staff, worker,
  -- teamLeader) signs it at first login in admin.html (js/admin.js).
  if v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false); end if;

  -- Agreement templates shown at the client/partner signing gates.
  -- coalesce: a profile with a NULL role must not be denied (NOT NULL = NULL).
  if v_folder = 'agreementDocs' then return not coalesce(is_worker(), false); end if;

  return false;
end $$;

create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  -- 0097: purchase receipts — buyers of THAT company only.
  if v_folder = 'purchases' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  -- 0102: petty cash return photos — buyers of THAT company (read back through the ledger).
  if v_folder = 'pettyCash' then
    return pur_buyer() and v_seg2 = data_owner_id()::text;
  end if;

  -- 0110: PM sharing personal-item receipts — the main owner only.
  if v_folder = 'pmSharing' then
    return pm_si_file_ok(p_name, true);
  end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  if is_owner() or is_staff() then return true; end if;
  -- Signatures. Clients/partners (js/client-management-app.js):
  --   signatures/<uid>_<ts>.png  and  signatures/proj_<project>_<uid>_<ts>.png
  -- Workers/team leaders (employee agreement gate, js/admin.js):
  --   signatures/employee_<uid>_<ts>.png  only
  if v_folder = 'signatures' then
    if coalesce(is_worker(), false) then
      return p_name ~ ('^signatures/employee_' || v_uid::text || '_[0-9]+\.png$');
    end if;
    return p_name ~ ('^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\.png$');
  end if;
  --   signed-terms/<uid>/<ts>_<name>.pdf   (dacsSnapshotPdf, every signing gate)
  if v_folder = 'signed-terms'  then return v_seg2 = v_uid::text; end if;

  -- Workers and team leaders upload nothing else.
  if coalesce(is_worker(), false) then return false; end if;
  --   procurementReceipts/<project>/…  (client "bought by client" receipt; clients only,
  --   partners are read-only, same as the procurement_client_update table policy)
  if v_folder = 'procurementReceipts' then
    return dacs_try_uuid(v_seg2) is not null and cproj_client_can_read(dacs_try_uuid(v_seg2));
  end if;

  return false;
end $$;

revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- 0102's overwrite policy; a personal-item receipt is never overwritten (each upload is a new uuid).
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) = 'pettyCash' then false
              when split_part(name, '/', 1) = 'pmSharing' then false
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) = 'purchases'
                then pur_buyer() and split_part(name, '/', 2) = data_owner_id()::text
              when split_part(name, '/', 1) = 'pettyCash' then false
              when split_part(name, '/', 1) = 'pmSharing' then false
              when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end);
