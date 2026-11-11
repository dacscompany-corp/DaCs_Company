// ═════════════════════════════════════════════════
// Billing Acknowledgement Receipts (0114) on PGlite and real PostgreSQL:
// the tables it reads, on top of the Linked Labor base (roles, auth stub,
// profiles, folders, payroll and the live helpers, lifted verbatim).
// Shared by br_receipts.pglite.mjs and br_concurrency.mjs. Nothing here talks
// to the live database.
// ═════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { LL_PRE, LL_TABLES, LL_HELPERS, IDS, seed, ROOT } from './ll_base.mjs';

export { IDS, seed };
export const M114 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0114_billing_acknowledgement_receipts.sql'), 'utf8').replace(/\r\n/g, '\n');

export const BR_TABLES = `
create table projects (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid not null,
  folder_id uuid references folders(id) on delete cascade, month text, year int, funding_type text,
  billing_number int, created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (
  project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null,
  monthly_budget numeric not null default 0, updated_at timestamptz default now());
create table settings (key text primary key, value jsonb, updated_at timestamptz default now());
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid, project_id uuid, amount numeric);
create table invoices (id uuid primary key default gen_random_uuid(), owner_id uuid, total_amount numeric);
alter table projects enable row level security;
create policy projects_rw on projects for all using (can_access(owner_id)) with check (can_access(owner_id));
alter table project_budgets enable row level security;
create policy project_budgets_owner on project_budgets for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
alter table settings enable row level security;
create policy settings_admin on settings for all using (is_owner() or is_staff()) with check (is_owner() or is_staff());
`;

export const BR_SETUP = [LL_PRE, LL_TABLES, LL_HELPERS, BR_TABLES];

const id = (n) => '00000000-0000-0000-0000-0000000' + n;
export const F = { A: id('f0001'), A2: id('f0002'), B: id('f0009') };
export const P = { BILL3: id('e0001'), DOWN: id('e0002'), COVER: id('e0003'), ZERO: id('e0004'), OTHER_SITE: id('e0005'), BLANK: id('e0006'), B: id('e0009') };

export const SETTINGS = {
  businessName: "DAC'S Building Design Services", businessTin: '123-456', businessAddress: 'Quezon City',
  paymentDetails: { method: 'bank', bank: 'Sample Bank', accountNo: '0001', accountName: 'Sample Name', branch: '' },
  logos: ['big-image-data'],
};

export async function seedReceipts(exec) {
  const I = IDS;
  await exec(`insert into folders (id, owner_id, name, description) values
    ('${F.A}',  '${I.OWNER}', 'Alpha House', 'Quezon City'),
    ('${F.A2}', '${I.OWNER}', 'Beta House',  ''),
    ('${F.B}',  '${I.OTHER}', 'Other Co House', '');
  insert into projects (id, owner_id, folder_id, month, year, funding_type, billing_number) values
    ('${P.BILL3}',      '${I.OWNER}', '${F.A}',  'November', 2026, 'progress',    3),
    ('${P.DOWN}',       '${I.OWNER}', '${F.A}',  'October',  2026, 'downpayment', null),
    ('${P.COVER}',      '${I.OWNER}', '${F.A}',  'November', 2026, 'president',   null),
    ('${P.ZERO}',       '${I.OWNER}', '${F.A}',  'December', 2026, 'progress',    4),
    ('${P.BLANK}',      '${I.OWNER}', '${F.A}',  'December', 2026, null,          null),
    ('${P.OTHER_SITE}', '${I.OWNER}', '${F.A2}', 'November', 2026, 'mobilization', null),
    ('${P.B}',          '${I.OTHER}', '${F.B}',  'November', 2026, 'progress',    1);
  insert into project_budgets (project_id, owner_id, monthly_budget) values
    ('${P.BILL3}',      '${I.OWNER}', 159000),
    ('${P.DOWN}',       '${I.OWNER}', 50000.5),
    ('${P.COVER}',      '${I.OWNER}', 900000),
    ('${P.ZERO}',       '${I.OWNER}', 0),
    ('${P.BLANK}',      '${I.OWNER}', 1000),
    ('${P.OTHER_SITE}', '${I.OWNER}', 70000),
    ('${P.B}',          '${I.OTHER}', 5000);
  insert into settings (key, value) values ('invoiceDefaults', '${JSON.stringify(SETTINGS).replace(/'/g, "''")}'::jsonb);`);
}
