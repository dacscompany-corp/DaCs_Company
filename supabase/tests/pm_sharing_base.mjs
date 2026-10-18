// Minimal copies of the live tables 0098 touches — enough to run the
// migration VERBATIM. Shared by pm_sharing.pglite.mjs and
// pm_sharing_concurrency.mjs. Nothing here talks to the live database.
export const PM_BASE = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (
  id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb, email text,
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
`;

export const IDS = {
  OWNER:      '00000000-0000-0000-0000-00000000000a', // main owner, company A
  PMOWNER:    '00000000-0000-0000-0000-000000000013', // owner-role, owner_id → OWNER, focused ['pm']
  STAFF:      '00000000-0000-0000-0000-00000000000b', // staff of OWNER
  CLIENT:     '00000000-0000-0000-0000-00000000000e',
  PARTNER:    '00000000-0000-0000-0000-00000000000f', // partner@x.test, accepted v3
  OTHER:      '00000000-0000-0000-0000-00000000000d', // main owner of company B
  INACT:      '00000000-0000-0000-0000-000000000021', // inactive main owner
  ORPHAN:     '00000000-0000-0000-0000-000000000022', // staff with null owner_id
  BADLINK:    '00000000-0000-0000-0000-000000000023', // owner whose owner_id → STAFF (not an owner)
  LINKPM:     '00000000-0000-0000-0000-000000000024', // staff whose owner_id → PMOWNER (target has owner_id)
  INACTLINK:  '00000000-0000-0000-0000-000000000025', // staff whose owner_id → INACT (inactive)
  INACTSTAFF: '00000000-0000-0000-0000-000000000026', // inactive staff of OWNER
  NOPROFILE:  '00000000-0000-0000-0000-000000000099', // signed in, no profile row
};

export async function seedProfiles(exec) {
  const I = IDS;
  await exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email,
      partner_agreement_accepted, partner_agreement_accepted_at, partner_agreement_doc_version) values
    ('${I.OWNER}',      'owner',   null,           'active',   null,            'admin@dacs.test',    null, null, null),
    ('${I.PMOWNER}',    'owner',   '${I.OWNER}',   'active',   '["pm"]'::jsonb, 'admin-pm@dacs.test', null, null, null),
    ('${I.STAFF}',      'staff',   '${I.OWNER}',   'active',   null,            'staff@dacs.test',    null, null, null),
    ('${I.CLIENT}',     'client',  null,           'active',   null,            'client@x.test',      null, null, null),
    ('${I.PARTNER}',    'partner', null,           'active',   null,            'partner@x.test',     true, '2026-08-12T02:00:00Z', 3),
    ('${I.OTHER}',      'owner',   null,           'active',   null,            'other@b.test',       null, null, null),
    ('${I.INACT}',      'owner',   null,           'inactive', null,            'inact@c.test',       null, null, null),
    ('${I.ORPHAN}',     'staff',   null,           'active',   null,            'orphan@x.test',      null, null, null),
    ('${I.BADLINK}',    'owner',   '${I.STAFF}',   'active',   null,            'badlink@x.test',     null, null, null),
    ('${I.LINKPM}',     'staff',   '${I.PMOWNER}', 'active',   null,            'linkpm@x.test',      null, null, null),
    ('${I.INACTLINK}',  'staff',   '${I.INACT}',   'active',   null,            'inactlink@x.test',   null, null, null),
    ('${I.INACTSTAFF}', 'staff',   '${I.OWNER}',   'inactive', null,            'inactstaff@x.test',  null, null, null);`);
}
