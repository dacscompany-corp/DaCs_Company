// ═════════════════════════════════════════════════
// PM Billing Documents (0116) on PGlite and real PostgreSQL: the 0114 base
// (br_base.mjs) plus the Project Management tables 0116 reads, with their
// live columns and live-style access (role based, owner_id null), and a
// stand-in for the storage schema so 0116's restated upload rules can be
// created and called. Shared by pmar_receipts.pglite.mjs and
// pmar_concurrency.mjs. Nothing here talks to the live database.
// ═════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { BR_SETUP, M114, IDS, seed, seedReceipts, F, P } from './br_base.mjs';
import { ROOT } from './ll_base.mjs';

export { M114, IDS, seed, seedReceipts, F, P };
export const M116 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0116_pm_billing_documents.sql'), 'utf8').replace(/\r\n/g, '\n');

// ll_base.mjs already made construction_projects with fewer columns; add the
// live ones 0116 reads. payment_requests is made here WITHOUT proof_url: 0116 adds it.
const PM_TABLES = `
alter table construction_projects add column address text, add column budget numeric,
  add column created_at timestamptz default now();
create table payment_requests (
  id uuid primary key default gen_random_uuid(), owner_id uuid, construction_project_id uuid,
  kind text, source text, status text, amount numeric, carryover numeric, total_amount numeric,
  amount_paid numeric default 0, paid_amount numeric, strict boolean default false,
  week_ending_date text, reference_number text, proof_base64 text, client_email text,
  created_at timestamptz default now(), updated_at timestamptz default now());
alter table construction_projects enable row level security;
create policy cproj_admin on construction_projects for all using (is_owner() or is_staff()) with check (is_owner() or is_staff());
alter table payment_requests enable row level security;
create policy payreq_admin on payment_requests for all
  using (is_owner() or is_staff() or can_access(owner_id)) with check (is_owner() or is_staff() or can_access(owner_id));
create policy payreq_client_read on payment_requests for select
  using (lower(client_email) = (select lower(email) from profiles where id = auth.uid()));
`;

// Only what 0116's restated storage rules need to be created and called. The
// role helpers (is_owner, is_staff, is_worker, data_owner_id) are the live ones from ll_base.
const STORAGE_STANDIN = `
create schema if not exists storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
create table storage.buckets (id text primary key, public boolean);
create or replace function dacs_try_uuid(p text) returns uuid language plpgsql immutable as
  $$ begin return p::uuid; exception when others then return null; end $$;
create or replace function pur_buyer() returns boolean language sql stable as $$ select false $$;
create or replace function pur_petty_reader(p text) returns boolean language sql stable as $$ select false $$;
create or replace function pm_si_file_ok(p text, w boolean) returns boolean language sql stable as $$ select false $$;
create or replace function cproj_client_can_read(p uuid) returns boolean language sql stable as $$ select false $$;
create or replace function cproj_partner_can_read(p uuid) returns boolean language sql stable as $$ select false $$;
`;

// The live upload rules: 0110's restatement (the latest), run verbatim. 0116 adds no
// storage rule of its own: paymentReceipts/ falls under 0110's office rule.
const M110 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0110_pm_sharing_items.sql'), 'utf8').replace(/\r\n/g, '\n');
export const M110_STORAGE = M110.slice(M110.indexOf('create or replace function public.uploads_can_read('));

export const PMAR_SETUP = [...BR_SETUP, PM_TABLES, STORAGE_STANDIN, M110_STORAGE];

const id = (n) => '00000000-0000-0000-0000-0000000' + n;
export const PM = { A: id('c0001'), B: id('c0002'), Z: id('c0003') };
export const PAY = { V1: id('d0001'), V2: id('d0002'), P1: id('d0003'), S1: id('d0004'), R1: id('d0005'),
                     U1: id('d0006'), B1: id('d0009') };

export async function seedPm(exec) {
  const I = IDS;
  await exec(`insert into construction_projects (id, owner_id, project_name, client_name, client_email, address, budget, status) values
    ('${PM.A}', null,       'Sample Residence', 'Sample Client', 'client@x.test', 'Quezon City', 1000000, 'active'),
    ('${PM.B}', '${I.OTHER}', 'Other Co House',  'Other Client',  'other@b.test',  '',            500000,  'active'),
    ('${PM.Z}', null,       'Zero House',       'Zero Client',   '',              '',            null,    'active');
  insert into payment_requests (id, owner_id, construction_project_id, kind, source, status, amount, total_amount,
                                amount_paid, paid_amount, week_ending_date, reference_number, client_email, created_at) values
    ('${PAY.V1}', null, '${PM.A}', 'construction', 'manual_payment', 'verified',  389000,   389000,   389000, 389000,   '2026-11-13', 'GC-123', 'client@x.test', '2026-11-13 10:00+08'),
    ('${PAY.V2}', null, '${PM.A}', 'construction', 'self_payment',   'verified',  140000.5, 140000.5, 0,      140000.5, '2026-10-02', null,     'client@x.test', '2026-10-02 10:00+08'),
    ('${PAY.P1}', null, '${PM.A}', 'construction', 'self_payment',   'paid',      200000,   200000,   200000, null,     '2026-07-24', null,     'client@x.test', '2026-07-24 10:00+08'),
    ('${PAY.S1}', null, '${PM.A}', 'construction', 'self_payment',   'submitted', 50000,    50000,    0,      50000,    '2026-11-14', null,     'client@x.test', '2026-11-14 10:00+08'),
    ('${PAY.R1}', null, '${PM.A}', 'construction', 'self_payment',   'rejected',  30000,    30000,    0,      30000,    '2026-11-01', null,     'client@x.test', '2026-11-01 10:00+08'),
    ('${PAY.U1}', null, '${PM.A}', 'construction', 'pm-admin',       'unpaid',    10000,    10000,    0,      null,     '2026-11-20', null,     'client@x.test', '2026-11-15 10:00+08'),
    ('${PAY.B1}', '${I.OTHER}', '${PM.B}', 'construction', 'manual_payment', 'verified', 5000, 5000, 5000, 5000, '2026-11-13', null, 'other@b.test', '2026-11-13 10:00+08');`);
}
