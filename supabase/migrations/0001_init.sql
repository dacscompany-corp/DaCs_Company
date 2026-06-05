-- ════════════════════════════════════════════════════════════════════
-- DAC's — Supabase relational schema (port of Firestore)
-- Source of truth: docs/DATABASE_SCHEMA.md
-- Conventions:
--   • every business table: id uuid PK, legacy_id text (old Firestore doc id),
--     created_at/updated_at timestamptz
--   • ownership columns are uuid FKs to auth.users (mapped from Firebase UID at migration)
--   • confidential money lives in sibling tables (folder_budgets/project_budgets)
--   • document-like trees stay JSONB (boq cost_items, payment_details, receipt_images)
-- RLS lives in 0002_rls.sql.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Auto-maintain updated_at on UPDATE
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- 1. IDENTITY — unifies users + clientUsers + constructionClientUsers
-- ════════════════════════════════════════════════════════════════════
create table profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  kind               text not null default 'admin'
                       check (kind in ('admin','client','construction_client')),
  role               text,            -- owner | staff | worker | teamLeader | client
  owner_id           uuid references auth.users(id) on delete set null, -- staff/workers share this owner's data
  email              text,
  first_name         text,
  last_name          text,
  display_name       text,
  status             text default 'active',
  agreement_accepted boolean default false,
  legacy_uid         text,            -- original Firebase UID (traceability + migration)
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create index profiles_owner_idx on profiles(owner_id);
create index profiles_email_idx on profiles(lower(email));
create index profiles_legacy_idx on profiles(legacy_uid);

-- ════════════════════════════════════════════════════════════════════
-- 2. EXPENSES CORE
-- ════════════════════════════════════════════════════════════════════
create table folders (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text unique,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  description  text,
  client_email text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index folders_owner_idx on folders(owner_id);
create index folders_client_idx on folders(lower(client_email));

-- 🔒 confidential contract value (owner + assigned client only)
create table folder_budgets (
  folder_id    uuid primary key references folders(id) on delete cascade,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  total_budget numeric not null default 0,
  updated_at   timestamptz default now()
);

create table projects (
  id             uuid primary key default gen_random_uuid(),
  legacy_id      text unique,
  owner_id       uuid not null references auth.users(id) on delete cascade,
  folder_id      uuid references folders(id) on delete cascade,
  month          text,
  year           int,
  funding_type   text,        -- progress | president
  billing_number int,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index projects_owner_idx on projects(owner_id);
create index projects_folder_idx on projects(folder_id);

-- 🔒 confidential fund allocated (owner + assigned client only)
create table project_budgets (
  project_id     uuid primary key references projects(id) on delete cascade,
  owner_id       uuid not null references auth.users(id) on delete cascade,
  monthly_budget numeric not null default 0,
  updated_at     timestamptz default now()
);

create table expenses (
  id                   uuid primary key default gen_random_uuid(),
  legacy_id            text unique,
  owner_id             uuid not null references auth.users(id) on delete cascade,
  project_id           uuid references projects(id) on delete cascade,
  expense_name         text,
  category             text,
  quantity             numeric,
  amount               numeric,
  date_time            text,
  notes                text,
  payment_method       text,
  po_image_url         text,   -- base64
  delivery_receipt_url text,
  supplier_invoice_url text,
  payment_receipt_url  text,
  in_inventory         boolean default false,
  cover_expense        boolean default false,
  split_group          text,
  split_index          int,
  split_total          int,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);
create index expenses_owner_idx on expenses(owner_id);
create index expenses_project_idx on expenses(project_id);

create table payroll (
  id             uuid primary key default gen_random_uuid(),
  legacy_id      text unique,
  owner_id       uuid not null references auth.users(id) on delete cascade,
  project_id     uuid references projects(id) on delete cascade,
  worker_name    text,
  role           text,
  labor_type     text,
  days_worked    numeric,
  daily_rate     numeric,
  total_salary   numeric,
  payment_date   text,
  notes          text,
  receipt_images jsonb default '[]'::jsonb,  -- base64[]
  cover_expense  boolean default false,
  split_group    text,
  split_index    int,
  split_total    int,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index payroll_owner_idx on payroll(owner_id);
create index payroll_project_idx on payroll(project_id);

create table categories (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text,
  color      text,
  created_at timestamptz default now()
);
create index categories_owner_idx on categories(owner_id);

create table overhead_expenses (
  id          uuid primary key default gen_random_uuid(),
  legacy_id   text unique,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  category    text,
  amount      numeric,
  date        text,
  description text,
  created_at  timestamptz default now()
);
create index overhead_owner_idx on overhead_expenses(owner_id);

-- ════════════════════════════════════════════════════════════════════
-- 3. BOQ  (cost_items tree stays JSONB by design)
-- ════════════════════════════════════════════════════════════════════
create table boq_documents (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text unique,
  owner_id     uuid not null references auth.users(id) on delete cascade,
  folder_id    uuid references folders(id) on delete cascade,
  date         text,
  project_name text,
  area         text,
  owner_name   text,
  location     text,
  subject      text,
  discount     numeric default 0,
  cost_items   jsonb default '[]'::jsonb,
  client_email text,
  status       text default 'draft',
  terms        jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index boq_owner_idx on boq_documents(owner_id);
create index boq_folder_idx on boq_documents(folder_id);
create index boq_client_idx on boq_documents(lower(client_email));

create table boq_templates (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text,
  cost_items jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);
create index boq_templates_owner_idx on boq_templates(owner_id);

-- ════════════════════════════════════════════════════════════════════
-- 4. INVOICES  (line items normalized into child tables)
-- ════════════════════════════════════════════════════════════════════
create table invoices (
  id               uuid primary key default gen_random_uuid(),
  legacy_id        text unique,
  owner_id         uuid not null references auth.users(id) on delete cascade,
  invoice_no       text,
  date             text,
  business_name    text,
  business_tin     text,
  business_address text,
  client_name      text,
  client_tin       text,
  client_address   text,
  subtotal         numeric,
  total_amount     numeric,
  payment_details  jsonb,
  notes            text,
  status           text default 'draft',
  client_email     text,
  client_uid       uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index invoices_owner_idx on invoices(owner_id);
create index invoices_client_idx on invoices(lower(client_email));

create table invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  position    int default 0,
  description text,
  qty         numeric,
  unit_price  numeric,
  discount    numeric,
  amount      numeric
);
create index invoice_items_parent_idx on invoice_items(invoice_id);

create table labor_invoices (
  id               uuid primary key default gen_random_uuid(),
  legacy_id        text unique,
  owner_id         uuid not null references auth.users(id) on delete cascade,
  invoice_no       text,
  date             text,
  business_name    text,
  business_tin     text,
  business_address text,
  client_name      text,
  client_tin       text,
  client_address   text,
  subtotal         numeric,
  total_amount     numeric,
  payment_details  jsonb,
  notes            text,
  status           text default 'draft',
  client_email     text,
  client_uid       uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index labor_invoices_owner_idx on labor_invoices(owner_id);

create table labor_invoice_items (
  id                uuid primary key default gen_random_uuid(),
  labor_invoice_id  uuid not null references labor_invoices(id) on delete cascade,
  position          int default 0,
  description       text,
  qty               numeric,
  unit_price        numeric,
  discount          numeric,
  amount            numeric
);
create index labor_invoice_items_parent_idx on labor_invoice_items(labor_invoice_id);

-- ════════════════════════════════════════════════════════════════════
-- 5. CONSTRUCTION PROJECT MANAGEMENT  (+ subtables)
--    (must precede payment_requests / termination_requests FKs)
-- ════════════════════════════════════════════════════════════════════
create table construction_projects (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text unique,
  owner_id     uuid references auth.users(id) on delete set null,  -- role-based access; owner for traceability
  client_name  text,
  client_email text,
  project_name text,
  address      text,
  status       text default 'active',  -- active | on-hold | completed | terminated
  start_date   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index cproj_client_idx on construction_projects(lower(client_email));

create table weekly_bills (
  id               uuid primary key default gen_random_uuid(),
  legacy_id        text unique,
  project_id       uuid not null references construction_projects(id) on delete cascade,
  week_ending_date text,
  labor            numeric,
  materials        numeric,
  management_fee   numeric,
  grand_total      numeric,
  notes            text,
  status           text default 'Submitted',  -- Submitted | Partial | Paid
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index weekly_bills_project_idx on weekly_bills(project_id);

create table procurement_items (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique,
  project_id    uuid not null references construction_projects(id) on delete cascade,
  item          text,
  qty           text,
  est_price     numeric,
  notes         text,
  status        text default 'Pending',   -- Pending | Assigned… | Bought…
  bought_by     text,                      -- client | company | null
  actual_amount numeric,
  receipt_url   text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index procurement_project_idx on procurement_items(project_id);

-- revolving fund summary — one row per project (was doc id 'summary')
create table revolving_funds (
  project_id        uuid primary key references construction_projects(id) on delete cascade,
  initial_fund      numeric default 0,
  total_replenished numeric default 0,
  notes             text,
  updated_at        timestamptz default now()
);

create table revolving_fund_expenses (
  id          uuid primary key default gen_random_uuid(),
  legacy_id   text unique,
  project_id  uuid not null references construction_projects(id) on delete cascade,
  date        text,
  amount      numeric,
  description text,
  notes       text,
  created_at  timestamptz default now()
);
create index rf_expenses_project_idx on revolving_fund_expenses(project_id);

create table revolving_fund_replenishments (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  project_id uuid not null references construction_projects(id) on delete cascade,
  date       text,
  amount     numeric,
  notes      text,
  created_at timestamptz default now()
);
create index rf_repl_project_idx on revolving_fund_replenishments(project_id);

-- Site-progress subcollections. Exact field shapes vary; payload kept in `data` jsonb
-- plus the common columns the UI reads. (Refine to explicit columns when those views
-- are wired up — see plan.)
create table daily_logs (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  project_id uuid not null references construction_projects(id) on delete cascade,
  log_date   text,
  data       jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index daily_logs_project_idx on daily_logs(project_id);

create table milestones (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  project_id uuid not null references construction_projects(id) on delete cascade,
  data       jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index milestones_project_idx on milestones(project_id);

create table accomplishment_reports (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  project_id uuid not null references construction_projects(id) on delete cascade,
  data       jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index accomp_reports_project_idx on accomplishment_reports(project_id);

create table walkthroughs (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  project_id uuid not null references construction_projects(id) on delete cascade,
  data       jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index walkthroughs_project_idx on walkthroughs(project_id);

-- ════════════════════════════════════════════════════════════════════
-- 6. PAYMENT REQUESTS — one table, two workflows (kind discriminator)
-- ════════════════════════════════════════════════════════════════════
create table payment_requests (
  id                      uuid primary key default gen_random_uuid(),
  legacy_id               text unique,
  kind                    text not null default 'cost_plus'
                            check (kind in ('construction','cost_plus')),
  owner_id                uuid references auth.users(id) on delete set null,
  construction_project_id uuid references construction_projects(id) on delete set null,
  client_email            text,
  client_uid              uuid,
  client_name             text,
  project_name            text,
  week_ending_date        text,
  due_date                timestamptz,
  -- construction flow
  amount                  numeric,
  carryover               numeric,
  total_amount            numeric,
  amount_paid             numeric default 0,
  strict                  boolean default false,
  source                  text,
  billing_period          text,
  -- cost-plus flow
  paid_amount             numeric,
  proof_base64            text,
  reference_number        text,
  partial_reason          text,
  requested_partial_amount numeric,
  partial_requested_at    timestamptz,
  approved_partial_amount numeric,
  partial_approved_by     text,
  partial_approved_at     timestamptz,
  partial_declined_reason text,
  invoice_snapshot        jsonb,
  submitted_at            timestamptz,
  verified_at             timestamptz,
  verified_by             text,
  rejected_reason         text,
  rejected_at             timestamptz,
  created_by              text,
  -- shared
  status                  text,
  notes                   text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);
create index payreq_owner_idx on payment_requests(owner_id);
create index payreq_client_idx on payment_requests(lower(client_email));
create index payreq_cproj_idx on payment_requests(construction_project_id);

-- ════════════════════════════════════════════════════════════════════
-- 7. CONSTRUCTION PROCUREMENT / INVENTORY
-- ════════════════════════════════════════════════════════════════════
create table batches (
  id            uuid primary key default gen_random_uuid(),
  legacy_id     text unique,
  status        text default 'open',   -- open | closed | delivered
  delivery_date timestamptz,
  cutoff_date   timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  total_items   int default 0,
  closed_at     timestamptz,
  closed_by     uuid references auth.users(id) on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table requests (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text unique,
  requested_by uuid references auth.users(id) on delete set null,
  owner_id     uuid references auth.users(id) on delete set null,
  batch_id     uuid references batches(id) on delete set null,
  status       text default 'pending',
  is_urgent    boolean default false,
  is_editable  boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index requests_batch_idx on requests(batch_id);
create index requests_by_idx on requests(requested_by);

create table request_items (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references requests(id) on delete cascade,
  legacy_item_id text,             -- original item.id used in code
  position       int default 0,
  name           text,
  unit           text,
  quantity       numeric,
  status         text default 'pending',  -- pending | purchased | delivered
  purchased_date timestamptz,
  delivered_date timestamptz
);
create index request_items_parent_idx on request_items(request_id);

create table inventory (
  id               uuid primary key default gen_random_uuid(),
  legacy_id        text unique,
  owner_id         uuid references auth.users(id) on delete set null,
  item_name        text,
  unit             text,
  current_stock    numeric,
  min_stock        numeric,
  notes            text,
  last_updated     timestamptz,
  last_adjusted_by uuid references auth.users(id) on delete set null,
  created_at       timestamptz default now()
);
create index inventory_name_idx on inventory(lower(item_name));

-- ════════════════════════════════════════════════════════════════════
-- 8. CLIENT REQUESTS
-- ════════════════════════════════════════════════════════════════════
create table sowa_requests (
  id           uuid primary key default gen_random_uuid(),
  legacy_id    text unique,
  client_email text,
  client_name  text,
  client_uid   uuid,
  owner_uid    uuid references auth.users(id) on delete set null,
  status       text default 'pending',
  requested_at timestamptz default now()
);
create index sowa_owner_idx on sowa_requests(owner_uid);
create index sowa_client_idx on sowa_requests(lower(client_email));

create table termination_requests (
  id                uuid primary key default gen_random_uuid(),
  legacy_id         text unique,
  client_uid        uuid,
  client_email      text,
  client_name       text,
  project_id        uuid references construction_projects(id) on delete set null,
  total_labor       numeric,
  total_materials   numeric,
  management_fee    numeric,
  grand_total       numeric,
  total_paid        numeric,
  remaining_balance numeric,
  status            text default 'pending',
  requested_at      timestamptz default now()
);
create index termination_client_idx on termination_requests(client_uid);

-- ════════════════════════════════════════════════════════════════════
-- 9. NOTIFICATIONS, PUBLIC, SETTINGS
-- ════════════════════════════════════════════════════════════════════
-- Flattened from notifications/{userId}/items/{id}; user_id = recipient
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text,
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text,
  message    text,
  is_read    boolean default false,
  related_id text,
  created_at timestamptz default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc);

create table appointments (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  fullname   text,
  email      text,
  contact    text,
  service    text,
  message    text,
  status     text default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table testimonials (
  id         uuid primary key default gen_random_uuid(),
  legacy_id  text unique,
  name       text,
  location   text,
  rating     int,
  message    text,
  status     text default 'pending',  -- pending | approved
  created_at timestamptz default now()
);
create index testimonials_status_idx on testimonials(status, rating);

-- key/value config (settings/paymentQR, settings/invoiceDefaults, …)
create table settings (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz default now()
);

-- read-only aggregates
create table stats (
  key        text primary key,
  value      jsonb,
  updated_at timestamptz default now()
);

-- ════════════════════════════════════════════════════════════════════
-- updated_at triggers
-- ════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','folders','folder_budgets','projects','project_budgets','expenses','payroll',
    'boq_documents','invoices','labor_invoices','construction_projects','weekly_bills',
    'procurement_items','revolving_funds','daily_logs','milestones','accomplishment_reports',
    'walkthroughs','payment_requests','batches','requests','appointments'
  ]
  loop
    execute format(
      'create trigger %I_set_updated before update on %I for each row execute function set_updated_at()',
      t, t);
  end loop;
end $$;
