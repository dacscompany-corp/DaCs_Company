// ════════════════════════════════════════════════════════════════════
// Linked Labor (0113) on PGlite: minimal copies of the live tables it
// touches, the live helpers it calls (lifted VERBATIM from their
// migrations), and 0098 (pm_main_owner_id) run verbatim. Shared by
// ll_linked_labor.pglite.mjs and ll_concurrency.mjs. Nothing here talks to
// the live database.
// ════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnText } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));

export const M98 = mig('0098_pm_profit_sharing.sql');
export const M113 = mig('0113_linked_labor.sql');

const M02 = mig('0002_rls.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
const M85 = mig('0085_workmate_requests.sql');

// Roles and the auth stub first, then Supabase's default grants, so every
// table and function made afterwards is granted the way live grants it and a
// migration that forgets a revoke fails the privilege checks.
export const LL_PRE = `
create role anon; create role authenticated;
create schema auth;
grant usage on schema auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

// Live columns (7 Nov 2026) of the tables 0113 reads or guards.
export const LL_TABLES = `
create table profiles (
  id uuid primary key, kind text, role text, owner_id uuid, email text,
  first_name text, last_name text, display_name text, status text,
  allowed_modules jsonb, position text, worker_no integer,
  partner_agreement_accepted boolean, partner_agreement_accepted_at timestamptz,
  partner_agreement_doc_version int, created_at timestamptz default now());
create table construction_projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid, project_name text, client_name text,
  client_email text, partner_email text, status text, terminated_at timestamptz);
create table warranty_retentions (
  id uuid primary key default gen_random_uuid(), owner_id uuid,
  project_id uuid references construction_projects(id) on delete set null,
  ref_no text, status text, total_paid numeric, direct_cost numeric, contributed_amount numeric,
  completed_at timestamptz, deleted_at timestamptz, updated_at timestamptz default now());
create table folders (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, name text,
  description text, client_email text, created_at timestamptz default now(), updated_at timestamptz default now(),
  parent_folder_id uuid references folders(id) on delete cascade, ocm_pct numeric, completed_at timestamptz);
create table labor_contracts (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid,
  folder_id uuid references folders(id) on delete cascade, worker_name text, scope text,
  agreed_amount numeric, pay_type text, status text, cap_history jsonb, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  agreement_signed boolean, agreement_signed_at timestamptz, agreement_signature text,
  agreement_signature_image text, agreement_terms_snapshot text, agreement_pdf_url text,
  agreement_pdf_name text, trade text, orientation_date text, category text, works jsonb,
  pay_basis text constraint labor_contracts_pay_basis_chk check (pay_basis = any (array['fixed','daily'])));
create table payroll (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, project_id uuid,
  worker_name text, role text, labor_type text, days_worked numeric, daily_rate numeric,
  total_salary numeric, payment_date text, notes text, receipt_images jsonb, cover_expense boolean,
  split_group text, split_index integer, split_total integer,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  contract_id uuid references labor_contracts(id) on delete set null, pay_milestone text,
  liability_for text check (liability_for is null or liability_for = any (array['direct','indirect'])),
  payment_method text check (payment_method is null or payment_method = any (array['cash','gcash','bank_transfer','cheque'])),
  client_submission_id uuid);
create table boq_documents (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid,
  folder_id uuid references folders(id) on delete cascade, date text, project_name text,
  cost_items jsonb default '[]'::jsonb, status text default 'draft', terms jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now());
`;

// The live helpers, verbatim, and the live policies on these tables.
// 0002 writes is_owner, is_staff, is_worker and data_owner_id back to back as
// one-liners, so fnText's 'is_owner' block carries all four, verbatim.
export const LL_HELPERS = [
  fnText(M02, 'auth_role'), fnText(M02, 'is_owner'), fnText(M02, 'can_access'),
  fnText(M51, 'attendance_data_owner'), fnText(M85, 'pr_is_requester'),
].join('\n') + `
alter table labor_contracts enable row level security;
create policy lc_admin on labor_contracts for all using (is_owner() or is_staff()) with check (is_owner() or is_staff());
alter table payroll enable row level security;
create policy payroll_rw on payroll for all using (can_access(owner_id)) with check (can_access(owner_id));
alter table folders enable row level security;
create policy folders_rw on folders for all using (can_access(owner_id)) with check (can_access(owner_id));
alter table boq_documents enable row level security;
create policy boq_rw on boq_documents for all using (can_access(owner_id) or is_owner() or is_staff());
alter table profiles enable row level security;
create policy profiles_read on profiles for select using (auth.uid() is not null);
`;

export const IDS = {
  OWNER:   '00000000-0000-0000-0000-00000000000a', // main owner, company A
  PMOWNER: '00000000-0000-0000-0000-000000000013', // owner role, owner_id → OWNER (admin-pm@)
  STAFF:   '00000000-0000-0000-0000-00000000000b', // staff of OWNER
  CLIENT:  '00000000-0000-0000-0000-00000000000e',
  PARTNER: '00000000-0000-0000-0000-00000000000f',
  OTHER:   '00000000-0000-0000-0000-00000000000d', // main owner of company B
  W1:      '00000000-0000-0000-0000-000000000101', // worker, W-0013, company A
  W2:      '00000000-0000-0000-0000-000000000102', // worker, W-0015, SAME display name as W1
  LEAD:    '00000000-0000-0000-0000-000000000103', // team leader, W-0017
  HELPER:  '00000000-0000-0000-0000-000000000104', // worker, W-0023 (a helper in W1's crew)
  GONE:    '00000000-0000-0000-0000-000000000105', // switched-off worker, W-0031
  WB:      '00000000-0000-0000-0000-000000000106', // worker of company B, W-0013 there
};

export async function seed(exec) {
  const I = IDS;
  await exec(`insert into profiles (id, role, owner_id, status, email, display_name, first_name, last_name, position, worker_no) values
    ('${I.OWNER}',   'owner',      null,         'active',   'admin@dacs.test',   null, null, null, null, null),
    ('${I.PMOWNER}', 'owner',      '${I.OWNER}', 'active',   'admin-pm@dacs.test',null, null, null, null, null),
    ('${I.STAFF}',   'staff',      '${I.OWNER}', 'active',   'staff@dacs.test',   null, null, null, null, null),
    ('${I.CLIENT}',  'client',     null,         'active',   'client@x.test',     null, null, null, null, null),
    ('${I.PARTNER}', 'partner',    null,         'active',   'partner@x.test',    null, null, null, null, null),
    ('${I.OTHER}',   'owner',      null,         'active',   'other@b.test',      null, null, null, null, null),
    ('${I.W1}',      'worker',     '${I.OWNER}', 'active',   'w13@x.test',  'Juan Cruz', 'Juan', 'Cruz', 'Masonry', 13),
    ('${I.W2}',      'worker',     '${I.OWNER}', 'active',   'w15@x.test',  'Juan Cruz', 'Juan', 'Cruz', 'Tiling', 15),
    ('${I.LEAD}',    'teamLeader', '${I.OWNER}', 'active',   'w17@x.test',  'Lito Reyes', 'Lito', 'Reyes', 'Carpentry', 17),
    ('${I.HELPER}',  'worker',     '${I.OWNER}', 'active',   'w23@x.test',  'Ben Dizon', 'Ben', 'Dizon', 'Helper', 23),
    ('${I.GONE}',    'worker',     '${I.OWNER}', 'inactive', 'w31@x.test',  'Rey Santos', 'Rey', 'Santos', 'Painting', 31),
    ('${I.WB}',      'worker',     '${I.OTHER}', 'active',   'wb@b.test',   'Juan Cruz', 'Juan', 'Cruz', 'Masonry', 13);`);
}
