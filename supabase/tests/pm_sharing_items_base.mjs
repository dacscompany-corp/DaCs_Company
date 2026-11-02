// Shared by pm_sharing_items.pglite.mjs and pm_sharing_items_concurrency.mjs.
// 0110 needs 0098 (pm_main_owner_id, pm_owner_company, pm_project_companies,
// pm_sharing_read) and restates the uploads storage rules, so the storage
// table and the helpers its policy names get minimal stand-ins here.
// Nothing here talks to the live database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export { PM_BASE, IDS, seedProfiles } from './pm_sharing_base.mjs';
export { SUPABASE_DEFAULT_GRANTS } from './pm_cash_advances_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const migration = (f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8').replace(/\r\n/g, '\n');

export const M98 = migration('0098_pm_profit_sharing.sql');
export const M110 = migration('0110_pm_sharing_items.sql');

// Only what 0110's restated storage policy and rule functions need to be created.
export const STORAGE_STANDIN = `
create schema if not exists storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner_id text);
alter table storage.objects enable row level security;
create table storage.buckets (id text primary key, public boolean);
create or replace function is_owner() returns boolean language sql stable as
  $$ select (select role from profiles where id = auth.uid()) = 'owner' $$;
create or replace function is_staff() returns boolean language sql stable as
  $$ select (select role from profiles where id = auth.uid()) = 'staff' $$;
create or replace function data_owner_id() returns uuid language sql stable as $$ select auth.uid() $$;
create or replace function pur_buyer() returns boolean language sql stable as $$ select false $$;`;
