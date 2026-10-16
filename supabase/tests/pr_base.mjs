// ════════════════════════════════════════════════════════════════════
// The extra tables and helpers migration 0097 needs on PGlite, on top of
// the 2A-1 base schema (2a1_purchase.pglite.mjs): minimal copies of the
// Requests tables (0085), the request helpers 0097 calls (lifted VERBATIM
// from their migrations), and stand-ins for Supabase Storage. Shared by
// 2a2_purchasing.pglite.mjs and by the 2A-1 suite's --with-0097 run.
// ════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export const fnText = (src, name) => {
  const m = src.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i'));
  if (!m) throw new Error('function ' + name + ' not found');
  return m[0];
};

export function prBase(ROOT) {
  const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
  const M02 = mig('0002_rls.sql');
  const M85 = mig('0085_workmate_requests.sql');
  const M87 = mig('0087_pr_person_name_office.sql');
  const M86 = mig('0086_workmate_requests_office.sql');
  const M89 = mig('0089_receipt_storage.sql');
  return `
alter table profiles add column if not exists display_name text;
alter table profiles add column if not exists email text;
alter table profiles add column if not exists worker_no int;
create table pr_catalog_items (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null);
create table pr_batches (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  cutoff_at timestamptz not null, purchase_on date not null, delivery_on date not null,
  updated_by uuid, updated_at timestamptz not null default now(), unique (owner_id, cutoff_at));
create table pr_requests (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  requester_id uuid not null references profiles(id), team_id uuid, folder_id uuid not null references folders(id),
  work_folder_id uuid not null references folders(id), client_op_id uuid not null default gen_random_uuid(),
  drafted_at timestamptz, received_at timestamptz not null default now(), note text not null default '',
  status text not null default 'submitted' check (status in ('submitted', 'cancelled')), cancelled_at timestamptz);
create table pr_lines (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id), position int not null default 0,
  kind text not null default 'material', catalog_item_id uuid references pr_catalog_items(id),
  description text not null, spec text not null default '', unit text not null, category text not null default '',
  intended_member_id uuid, urgent boolean not null default false, urgent_reason text, needed_by date,
  notes text not null default '', status text not null default 'open' check (status in ('open', 'cancelled')),
  version int not null default 1, has_conflict boolean not null default false, created_at timestamptz not null default now());
create table pr_line_portions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  line_id uuid not null references pr_lines(id), batch_id uuid not null references pr_batches(id),
  quantity numeric(12,3) not null check (quantity > 0), arranged_at timestamptz, arranged_by uuid references profiles(id),
  pending_reduction numeric(12,3) not null default 0 check (pending_reduction >= 0 and pending_reduction <= quantity),
  created_at timestamptz not null default now());
create table pr_events (
  id bigserial primary key, owner_id uuid not null references profiles(id), request_id uuid not null references pr_requests(id),
  line_id uuid references pr_lines(id), actor_id uuid not null references profiles(id), kind text not null,
  detail jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
${fnText(M85, 'pr_cutoff_after')}
${fnText(M85, 'pr_batch_for')}
${fnText(M87, 'pr_person_name')}
${fnText(M86, 'pr_office_change_quantity')}
${fnText(M86, 'pr_office_set_arranged')}
${fnText(M02, 'is_worker')}
create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function dacs_try_uuid(p text) returns uuid language plpgsql immutable as
  $f$ begin return p::uuid; exception when others then return null; end $f$;
create function cproj_client_can_read(p uuid) returns boolean language sql stable as $f$ select false $f$;
create function cproj_partner_can_read(p uuid) returns boolean language sql stable as $f$ select false $f$;
create table receipt_uploads (
  path text primary key constraint receipt_uploads_path_check
    check (path ~ '^(expenseReceipts|payrollReceipts)/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\\.jpg$'),
  owner_id uuid not null references profiles(id),
  kind text not null constraint receipt_uploads_kind_check check (kind in ('expense', 'payroll')),
  uploaded_by uuid, state text not null default 'pending', created_at timestamptz not null default now(),
  attached_at timestamptz, deleted_at timestamptz);
alter table receipt_uploads enable row level security;
${fnText(M89, 'public.receipt_paths_of')}
`;
}
