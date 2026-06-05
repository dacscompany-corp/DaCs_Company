-- ════════════════════════════════════════════════════════════════════
-- DAC's — Row-Level Security (port of firestore.rules)
-- Roles: owner | staff | worker/teamLeader | client.  service_role bypasses RLS.
-- ════════════════════════════════════════════════════════════════════

-- ── Helper functions (SECURITY DEFINER → read profiles without RLS recursion) ──
create or replace function auth_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function is_owner()
returns boolean language sql stable as $$ select auth_role() = 'owner' $$;

create or replace function is_staff()
returns boolean language sql stable as $$ select auth_role() = 'staff' $$;

create or replace function is_worker()
returns boolean language sql stable as $$ select auth_role() in ('worker','teamLeader') $$;

-- Mirrors window.currentDataUserId / staffOwnerUid(): staff act as their owner.
create or replace function data_owner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select case
           when auth_role() = 'staff' then coalesce(owner_id, auth.uid())
           else auth.uid()
         end
  from profiles where id = auth.uid()
$$;

create or replace function auth_email()
returns text language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email','')) $$;

-- "owner or their staff" — the canAccessData / canWriteData unifier.
-- (NOTE: deliberately NOT used for *_budgets, so staff stay locked out of money.)
create or replace function can_access(p_owner uuid)
returns boolean language sql stable as $$
  select auth.uid() is not null and (
    p_owner = auth.uid() or (is_staff() and p_owner = data_owner_id())
  )
$$;

-- ── Guard: a normal user may not change their own role/owner_id (anti-escalation).
--    service_role (auth.uid() IS NULL) is exempt → edge function can assign roles.
create or replace function profiles_guard()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role or new.owner_id is distinct from old.owner_id then
      raise exception 'not allowed to change role/owner_id';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard_trg before update on profiles
  for each row execute function profiles_guard();

-- ════════════════════════════════════════════════════════════════════
-- Enable RLS everywhere
-- ════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','folders','folder_budgets','projects','project_budgets','expenses','payroll',
    'categories','overhead_expenses','boq_documents','boq_templates','invoices','invoice_items',
    'labor_invoices','labor_invoice_items','construction_projects','weekly_bills','procurement_items',
    'revolving_funds','revolving_fund_expenses','revolving_fund_replenishments','daily_logs',
    'milestones','accomplishment_reports','walkthroughs','payment_requests','batches','requests',
    'request_items','inventory','sowa_requests','termination_requests','notifications',
    'appointments','testimonials','settings','stats'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- profiles  (users readable by any authed; self insert/update; no role escalation)
-- ════════════════════════════════════════════════════════════════════
create policy profiles_read   on profiles for select using (auth.uid() is not null);
create policy profiles_insert on profiles for insert
  with check (id = auth.uid() and (role is null or role = 'client'));
create policy profiles_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
-- Expenses core — owner/staff shared; budgets owner-only (+ client by email)
-- ════════════════════════════════════════════════════════════════════
create policy folders_rw on folders for all
  using (can_access(owner_id)) with check (can_access(owner_id));
create policy folders_client_read on folders for select
  using (client_email is not null and lower(client_email) = auth_email());

create policy folder_budgets_owner on folder_budgets for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy folder_budgets_client_read on folder_budgets for select
  using (exists (select 1 from folders f
                 where f.id = folder_budgets.folder_id
                   and lower(f.client_email) = auth_email()));

create policy projects_rw on projects for all
  using (can_access(owner_id)) with check (can_access(owner_id));
create policy projects_client_read on projects for select
  using (exists (select 1 from folders f
                 where f.id = projects.folder_id
                   and lower(f.client_email) = auth_email()));

create policy project_budgets_owner on project_budgets for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy project_budgets_client_read on project_budgets for select
  using (exists (select 1 from projects p
                 join folders f on f.id = p.folder_id
                 where p.id = project_budgets.project_id
                   and lower(f.client_email) = auth_email()));

create policy expenses_rw on expenses for all
  using (can_access(owner_id)) with check (can_access(owner_id));
create policy payroll_rw on payroll for all
  using (can_access(owner_id)) with check (can_access(owner_id));
create policy categories_rw on categories for all
  using (can_access(owner_id)) with check (can_access(owner_id));
create policy overhead_rw on overhead_expenses for all
  using (can_access(owner_id)) with check (can_access(owner_id));

-- ════════════════════════════════════════════════════════════════════
-- BOQ
-- ════════════════════════════════════════════════════════════════════
create policy boq_rw on boq_documents for all
  using (can_access(owner_id) or is_owner() or is_staff())
  with check (can_access(owner_id));
create policy boq_client_read on boq_documents for select
  using (lower(client_email) = auth_email());

create policy boq_templates_rw on boq_templates for all
  using (can_access(owner_id)) with check (can_access(owner_id));

-- ════════════════════════════════════════════════════════════════════
-- Invoices (+ child items) — owner/staff; client read by email/uid
-- ════════════════════════════════════════════════════════════════════
create policy invoices_rw on invoices for all
  using (can_access(owner_id)) with check (can_access(owner_id));
create policy invoices_client_read on invoices for select
  using (lower(client_email) = auth_email() or client_uid = auth.uid());
create policy invoice_items_rw on invoice_items for all
  using (exists (select 1 from invoices i where i.id = invoice_items.invoice_id
                 and (can_access(i.owner_id) or lower(i.client_email)=auth_email() or i.client_uid=auth.uid())))
  with check (exists (select 1 from invoices i where i.id = invoice_items.invoice_id
                 and can_access(i.owner_id)));

create policy labor_invoices_rw on labor_invoices for all
  using (can_access(owner_id)) with check (can_access(owner_id));
create policy labor_invoice_items_rw on labor_invoice_items for all
  using (exists (select 1 from labor_invoices i where i.id = labor_invoice_items.labor_invoice_id
                 and can_access(i.owner_id)))
  with check (exists (select 1 from labor_invoices i where i.id = labor_invoice_items.labor_invoice_id
                 and can_access(i.owner_id)));

-- ════════════════════════════════════════════════════════════════════
-- Construction PM — owner/staff full; client read own; client write only procurement
-- ════════════════════════════════════════════════════════════════════
create policy cproj_admin on construction_projects for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
create policy cproj_client_read on construction_projects for select
  using (lower(client_email) = auth_email());

-- helper predicate for subtables: caller may read this project
create or replace function cproj_client_can_read(p uuid)
returns boolean language sql stable as $$
  select exists (select 1 from construction_projects cp
                 where cp.id = p and lower(cp.client_email) = auth_email())
$$;

-- subtables: admin full + client read of own project
do $$
declare t text;
begin
  foreach t in array array[
    'weekly_bills','procurement_items','revolving_fund_expenses','revolving_fund_replenishments',
    'daily_logs','milestones','accomplishment_reports','walkthroughs'
  ]
  loop
    execute format($f$
      create policy %1$s_admin on %1$I for all
        using (is_owner() or is_staff()) with check (is_owner() or is_staff());
      create policy %1$s_client_read on %1$I for select
        using (cproj_client_can_read(project_id));
    $f$, t);
  end loop;
end $$;

-- revolving_funds summary (PK = project_id)
create policy rf_admin on revolving_funds for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
create policy rf_client_read on revolving_funds for select
  using (cproj_client_can_read(project_id));

-- client may UPDATE only procurement_items of their own project (accept/decline)
create policy procurement_client_update on procurement_items for update
  using (cproj_client_can_read(project_id))
  with check (cproj_client_can_read(project_id));

-- ════════════════════════════════════════════════════════════════════
-- Payment requests — two flows
-- ════════════════════════════════════════════════════════════════════
create policy payreq_admin on payment_requests for all
  using (is_owner() or is_staff() or can_access(owner_id))
  with check (is_owner() or is_staff() or can_access(owner_id));
create policy payreq_client_read on payment_requests for select
  using (lower(client_email) = auth_email());
-- client self-initiates (status submitted, own email+uid)
create policy payreq_client_create on payment_requests for insert
  with check (lower(client_email) = auth_email()
              and client_uid = auth.uid()
              and status = 'submitted');
-- client status-transition whitelist
create policy payreq_client_update on payment_requests for update
  using (lower(client_email) = auth_email())
  with check (lower(client_email) = auth_email());
  -- NOTE: the exact pending→partial_pending / rejected→submitted matrix is enforced
  -- in app code + a CHECK trigger (see payreq_transition_guard below) because RLS
  -- WITH CHECK cannot see the OLD row's status.

create or replace function payreq_transition_guard()
returns trigger language plpgsql as $$
begin
  -- only constrain client-initiated updates (admins: owner/staff bypass)
  if is_owner() or is_staff() or can_access(new.owner_id) then
    return new;
  end if;
  if not (
       (old.status = 'pending'         and new.status = 'partial_pending')
    or (old.status = 'partial_pending' and new.status = 'pending')
    or (old.status in ('pending','partial_approved') and new.status = 'submitted')
    or (old.status = 'rejected'        and new.status = 'submitted')
  ) then
    raise exception 'illegal payment status transition % -> %', old.status, new.status;
  end if;
  return new;
end $$;
create trigger payreq_transition_trg before update on payment_requests
  for each row execute function payreq_transition_guard();

-- ════════════════════════════════════════════════════════════════════
-- Construction procurement / inventory
-- ════════════════════════════════════════════════════════════════════
create policy requests_read on requests for select
  using (is_owner() or is_staff() or is_worker());
create policy requests_worker_create on requests for insert
  with check ((is_worker() or is_owner())
              and requested_by = auth.uid() and status = 'pending');
create policy requests_worker_update on requests for update
  using (is_worker() and requested_by = auth.uid() and status = 'pending')
  with check (requested_by = auth.uid() and status = 'pending');
create policy requests_admin_write on requests for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());

create policy request_items_rw on request_items for all
  using (exists (select 1 from requests r where r.id = request_items.request_id
                 and (is_owner() or is_staff() or is_worker())))
  with check (exists (select 1 from requests r where r.id = request_items.request_id
                 and (is_owner() or is_staff()
                      or (is_worker() and r.requested_by = auth.uid()))));

create policy batches_read on batches for select
  using (is_owner() or is_staff() or is_worker());
create policy batches_admin on batches for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());

create policy inventory_admin on inventory for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());

-- ════════════════════════════════════════════════════════════════════
-- Client requests
-- ════════════════════════════════════════════════════════════════════
create policy sowa_admin on sowa_requests for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
create policy sowa_client_create on sowa_requests for insert
  with check (client_uid = auth.uid());
create policy sowa_client_read on sowa_requests for select
  using (client_uid = auth.uid() or lower(client_email) = auth_email());

create policy termination_admin on termination_requests for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
create policy termination_client_create on termination_requests for insert
  with check (client_uid = auth.uid());
create policy termination_client_read on termination_requests for select
  using (client_uid = auth.uid());

-- ════════════════════════════════════════════════════════════════════
-- Notifications, public, settings
-- ════════════════════════════════════════════════════════════════════
create policy notif_insert on notifications for insert
  with check (auth.uid() is not null);            -- any authed may notify anyone
create policy notif_owner_read   on notifications for select using (user_id = auth.uid());
create policy notif_owner_update on notifications for update using (user_id = auth.uid());
create policy notif_owner_delete on notifications for delete using (user_id = auth.uid());

create policy appt_create on appointments for insert with check (true);  -- public booking
create policy appt_read   on appointments for select using (auth.uid() is not null);
create policy appt_admin  on appointments for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());

create policy testi_create on testimonials for insert
  with check (coalesce(status,'pending') = 'pending');     -- public, pending only
create policy testi_read on testimonials for select
  using (auth.uid() is not null or (status = 'approved' and rating >= 4));
create policy testi_admin on testimonials for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());

create policy settings_admin on settings for all
  using (is_owner() or is_staff()) with check (is_owner() or is_staff());
create policy settings_payment_qr_read on settings for select
  using (key = 'paymentQR' and auth.uid() is not null);

create policy stats_read on stats for select using (auth.uid() is not null);
-- (no write policy → only service_role can write stats)
