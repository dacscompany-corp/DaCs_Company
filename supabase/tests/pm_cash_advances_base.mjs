// Shared by pm_cash_advances.pglite.mjs and pm_cash_advances_concurrency.mjs.
// 0100 needs 0098 (pm_owner_company, pm_project_companies), so both
// migrations run VERBATIM over the minimal tables in pm_sharing_base.mjs.
// Nothing here talks to the live database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { PM_BASE, IDS, seedProfiles } from './pm_sharing_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const migration = (f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8').replace(/\r\n/g, '\n');

export const M98 = migration('0098_pm_profit_sharing.sql');
export const M100 = migration('0100_pm_cash_advances.sql');
// A stand-in payroll table: only there to prove the ledger never writes payroll.
export const PAYROLL_STANDIN = `create table weekly_bills (id uuid primary key default gen_random_uuid(), project_id uuid, entries jsonb);`;

// Supabase grants every new table, sequence and function in `public` to
// anon and authenticated by default. Mimic it BEFORE the migrations run, so
// the privilege checks fail if a migration ever forgets its revoke.
export const SUPABASE_DEFAULT_GRANTS = `
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;`;
