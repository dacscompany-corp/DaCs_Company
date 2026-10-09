# WorkMate Stage 1b-1 — Item History Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One migration (0090) gives Find Previous Item its server: a per-project *Allow item history* switch, catalogue aliases/brand, hand-entered historical references, a reviewed product-photo gallery in a private `item-gallery` bucket, worker search/detail/cleanup RPCs, office RPCs, and a Request Again link on request lines — with a live acceptance script and a static test suite.

**Architecture:** History is computed live from `pr_lines` (matched to a catalogue item) plus the new `pr_item_refs`; one internal function, `pr_history_entries(owner, viewer, office, item)`, decides per entry what a caller may see, and every worker RPC, the storage read policy and `pr_submit_request`'s link check go through it. Workers reach nothing directly (RLS, no worker policies); every write is an office `SECURITY DEFINER` RPC. Four 0085/0086 functions are re-declared by **adding lines only**, and a static test proves every original line survives in order.

**Tech Stack:** Supabase Postgres (SQL migration, plpgsql), Supabase Storage policies, Node zero-dependency static tests (as `tests/workmate-requests-office.test.js`), a self-rolling-back acceptance script (editor-safe: `set_config('v1b.*')`, no temp table).

**Spec:** `docs/superpowers/specs/2026-10-09-workmate-stage1b-item-history-design.md` (§3 decisions, §4.1 rules, §4.2 server, §6 testing).

## Global Constraints

- **Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs Web`. All paths are relative to it.
- **NEVER `git commit` / `git push`.** The user commits. Every task ends "Stop — no commit".
- **NEVER run `npm run build`.**
- **Migration number 0090**, file `supabase/migrations/0090_workmate_item_history.sql` (highest on disk is `0089_receipt_storage.sql`; re-check with `ls supabase/migrations | sort | tail -3` before creating). **Never apply anything to the live database from a task** — the user dry-runs and applies it (Task 6).
- **Idempotent DDL:** `add column if not exists`, `create table if not exists`, `create index if not exists`, `create or replace function`, `drop policy if exists` before every `create policy`, `drop constraint if exists` before every named `add constraint`. The file must apply cleanly twice.
- **`set local lock_timeout = '5s';`** directly after the header comment (as 0089).
- **No money:** no column, JSON key or function in 0090 may hold or return a price, amount, cost or total.
- **Workers reach `pr_*` only through RPCs:** RLS on every new table; **no policy grants workers anything**. Owner/staff get `select` policies only; all writes go through office RPCs. `revoke all ... from anon` and `revoke insert, update, delete, truncate, references, trigger ... from authenticated` on both new tables.
- **Every function** is `SECURITY DEFINER` with `set search_path = public`. Worker/office RPCs and storage-policy helpers: `revoke all ... from public, anon; grant execute ... to authenticated`. Internal helpers: `revoke all ... from public, anon, authenticated`, never granted.
- **Who:** worker = `pr_is_requester()` (role worker/teamLeader, active), company = `attendance_data_owner()`. Office = `pr_is_office()` (owner/staff), company = `data_owner_id()`, row check `can_access(owner_id)`.
- **History visibility (spec §3):** a worker sees an entry when it is (a) a `pr_lines` row with a catalogue item, in the worker's company, and either requested by the worker **or** on a project whose `pr_project_settings.allow_history` is true; or (b) a **non-retired** `pr_item_refs` row on a project with `allow_history` true. Additional Works inherit the parent project's switch. Completed projects keep history. The office sees every entry of its company, retired ones flagged.
- **Workers never receive:** requester names, line `notes`, line `description`, raw request photos, retired photos/references, or another company's anything.
- **Error codes** (`raise exception '<CODE>' using errcode = 'P0001'`), new in 0090: `HISTORY_NOT_AVAILABLE`, `TOO_MANY_ITEMS`, `BAD_REFERENCE`, `BAD_DESTINATION`, `REASON_REQUIRED`, `CHECKLIST_REQUIRED`, `BAD_PATH`, `FILE_MISSING`, `ALREADY_IN_GALLERY`, `ALREADY_REVIEWED`, `NOT_MATCHED`, `PHOTO_RETIRED`; reused: `NOT_A_REQUESTER`, `OFFICE_ONLY`, `NOT_FOUND`, `BAD_ITEM`, `DUPLICATE_ITEM`.
- **Gallery storage:** private bucket **`item-gallery`**, JPEG only, 5 MB (`5242880`). Path `<owner_id>/<catalog_item_id>/<uuid>.jpg`. Office of that company inserts and reads; a worker reads only an **approved** photo of an item with at least one entry visible to them. **No update or delete policy** for anyone.
- **Line endings:** SQL/JS files LF. `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md`, `package.json` are **CRLF** — keep them CRLF. Write files with the Edit tool or Python (`open(..., 'w', encoding='utf-8', newline='')`), **never PowerShell text output** (BOM/mojibake).
- **Re-declared functions** (`pr_submit_request` from 0085; `pr_request_doc`, `pr_office_catalog`, `pr_office_projects` from 0086) are copied **byte-for-byte** from their source file and changed **only by inserting whole new lines**. The live definitions were checked identical to the files on 2026-10-09 (md5 of the CR-stripped body).

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0090_workmate_item_history.sql` (create) | The whole server change, in sections §1–§7, each section ending with its own grants |
| `tests/workmate-history.test.js` (create) | Static shape tests for 0090; grows each task |
| `supabase/tests/1b_acceptance.sql` (create, Task 5) | Live behaviour, self-rolling-back, editor-safe |
| `package.json` (modify, Task 5) | Append the new static test to `npm test` |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` (modify, Task 5) | 0090 paragraph, next number 0091, new tables/columns/RPCs |

---

### Task 1: Schema, gallery storage and the visibility core

**Files:**
- Create: `supabase/migrations/0090_workmate_item_history.sql` (header + §1–§3)
- Create: `tests/workmate-history.test.js`

**Interfaces:**
- Produces (internal, used by Tasks 2–4):
  - `pr_history_open(p_folder uuid, p_owner uuid) returns boolean`
  - `pr_history_entries(p_owner uuid, p_viewer uuid, p_office boolean, p_item uuid) returns table (catalog_item_id uuid, entry_kind text, entry_id uuid, folder_id uuid, work_folder_id uuid, at_date date, date_precision text, cancelled boolean, retired boolean, quantity numeric, unit text, description text, note text, requester_id uuid, sort_at timestamptz)` — `entry_kind` is `'request_line'` or `'reference'`; `p_item` null = all items.
  - `pr_entry_label(p_kind text, p_cancelled boolean) returns text` → `'Historical reference'` / `'Requested — cancelled'` / `'Requested'`.
- Produces (storage-policy helpers, granted): `pr_can_read_gallery_path(p_name text)`, `pr_office_gallery_path_ok(p_name text)`.
- Produces (tables/columns): `pr_project_settings.allow_history`, `pr_catalog_items.aliases text[]`, `pr_catalog_items.brand text`, `pr_lines.ref_kind/ref_id`, `pr_photos.gallery_review/gallery_reviewed_by/gallery_reviewed_at`, tables `pr_item_refs`, `pr_gallery_photos`.

- [ ] **Step 1: Write the failing test file**

Create `tests/workmate-history.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// WORKMATE ITEM HISTORY (0090) STATIC TESTS:
//   run with  node tests/workmate-history.test.js
//
// Zero dependencies. Guards the shape of migration 0090 (Stage 1b-1):
// who may see history, the gallery bucket rules, no money, the RPC
// permissions, and that re-declared 0085/0086 functions only ADD lines.
// The LIVE behaviour is checked by supabase/tests/1b_acceptance.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = rel => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };
const MIGRATION = 'supabase/migrations/0090_workmate_item_history.sql';

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

const SQL = read(MIGRATION);
const CODE = SQL.replace(/--.*$/gm, '');
function fnBlockIn(code, name) {
  const m = code.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\$\\$;', 'i'));
  return m ? m[0] : '';
}
const fnBlock = name => fnBlockIn(CODE, name);

console.log('\nworkmate item history (0090)');

test('the migration exists and sets a lock timeout', () => {
  assert(SQL.length > 0, 'missing ' + MIGRATION);
  assert(/set local lock_timeout = '5s';/.test(CODE), 'no set local lock_timeout');
});

test('no money anywhere in 0090', () => {
  assert(!/\b[a-z_]*(price|amount|cost|peso)[a-z_]*\b/i.test(CODE), 'a money word appears in 0090 code');
});

test('Allow item history is its own switch, off by default', () => {
  assert(/alter table pr_project_settings add column if not exists allow_history boolean not null default false;/.test(CODE),
    'allow_history must be boolean not null default false');
});

test('aliases and brand are search aids, not part of the item identity', () => {
  assert(/add column if not exists aliases text\[\] not null default '\{\}'/.test(CODE), 'aliases text[] default {}');
  assert(/add column if not exists brand text not null default ''/.test(CODE), 'brand text default empty');
  assert(!/pr_catalog_identity/.test(CODE), '0090 must not touch the 0085 identity index');
});

test('a Request Again link is both-or-neither and only two kinds', () => {
  assert(/constraint pr_lines_ref_pair check \(\(ref_kind is null\) = \(ref_id is null\)/.test(CODE), 'pair check');
  assert(/ref_kind in \('request_line', 'reference'\)/.test(CODE), 'kind list');
});

test('the two new tables have RLS, office SELECT policies only, and no anon or direct writes', () => {
  for (const t of ['pr_item_refs', 'pr_gallery_photos']) {
    assert(new RegExp('alter table ' + t + ' enable row level security;').test(CODE), t + ' RLS');
    const policies = [...CODE.matchAll(new RegExp('create policy \\S+ on ' + t + ' for (\\w+)', 'g'))].map(m => m[1]);
    assert(policies.length === 1 && policies[0] === 'select', t + ' must have exactly one SELECT policy, got ' + policies);
    assert(new RegExp('revoke all on ' + t + ' from anon;').test(CODE), t + ' revoke from anon');
    assert(new RegExp('revoke insert, update, delete, truncate, references, trigger on ' + t + ' from authenticated;').test(CODE),
      t + ' revoke writes from authenticated');
  }
});

test('a historical reference: dated or explicitly unknown, retired with a reason, never deleted', () => {
  assert(/check \(\(date_precision = 'unknown'\) = \(ref_date is null\)\)/.test(CODE), 'unknown <=> no date');
  assert(/check \(retired_at is null or btrim\(coalesce\(retire_reason, ''\)\) <> ''\)/.test(CODE), 'retire needs a reason');
});

test('gallery photos: reviewed checklist required, one approved cover per item', () => {
  assert(/checklist_confirmed boolean not null check \(checklist_confirmed\)/.test(CODE), 'checklist must be true');
  assert(/create unique index if not exists pr_gallery_one_cover on pr_gallery_photos \(catalog_item_id\) where is_cover and status = 'approved';/.test(CODE),
    'one approved cover per item');
});

test('item-gallery bucket: private, JPEG only, 5 MB', () => {
  assert(/values \('item-gallery', 'item-gallery', false, 5242880, array\['image\/jpeg'\]\)/.test(CODE), 'bucket row');
});

test('item-gallery has insert and select policies only — no update or delete for anyone', () => {
  const pols = [...CODE.matchAll(/create policy "item-gallery:[^"]*" on storage\.objects for (\w+)/g)].map(m => m[1]);
  assert(pols.sort().join(',') === 'insert,select,select', 'expected insert + two selects, got ' + pols);
});

test('a worker reads only approved photos of an item they may see', () => {
  const b = fnBlock('pr_can_read_gallery_path');
  assert(/pr_is_requester\(\)/.test(b) && /g\.status = 'approved'/.test(b) && /pr_history_entries\(/.test(b)
    && /attendance_data_owner\(\)/.test(b), 'must check requester, approved, company and a visible entry');
});

test('the office gallery path is tenant-locked to its own catalogue item', () => {
  const b = fnBlock('pr_office_gallery_path_ok');
  assert(/is_owner\(\) or is_staff\(\)/.test(b), 'office only');
  assert(/\(storage\.foldername\(p_name\)\)\[1\] = data_owner_id\(\)::text/.test(b), 'owner segment');
  assert(/c\.owner_id = data_owner_id\(\)/.test(b), 'item belongs to the company');
});

test('history visibility: own line, or a switched-on project; references never retired', () => {
  const b = fnBlock('pr_history_entries');
  assert(/l\.catalog_item_id is not null/.test(b), 'only matched lines');
  assert(/p_office or r\.requester_id = p_viewer or pr_history_open\(r\.folder_id, p_owner\)/.test(b), 'line rule');
  assert(/p_office or \(ir\.retired_at is null and pr_history_open\(ir\.folder_id, p_owner\)\)/.test(b), 'reference rule');
  assert(/case when p_office then r\.requester_id end/.test(b), 'requester id only for the office');
});

test('the switch is read on the top-level project of the same company', () => {
  const b = fnBlock('pr_history_open');
  assert(/s\.allow_history/.test(b) && /f\.owner_id = p_owner/.test(b) && /f\.parent_folder_id is null/.test(b), 'pr_history_open');
});

test('every function in 0090 is SECURITY DEFINER with a pinned search_path', () => {
  const fns = [...CODE.matchAll(/create or replace function[\s\S]*?\$\$;/gi)].map(m => m[0]);
  assert(fns.length > 0, 'no functions');
  for (const f of fns) {
    assert(/security definer/i.test(f), 'not SECURITY DEFINER: ' + f.slice(0, 70));
    assert(/set search_path = public/i.test(f), 'no search_path: ' + f.slice(0, 70));
  }
});

// ── Tasks 2–5 append their tests above this line ──

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/workmate-history.test.js`
Expected: FAIL — "missing supabase/migrations/0090_workmate_item_history.sql" and most other tests failing; exit code 1.

- [ ] **Step 3: Create the migration with header, §1–§3**

Create `supabase/migrations/0090_workmate_item_history.sql` (LF):

```sql
-- 0090 — WorkMate Stage 1b-1: Find Previous Item — the server.
--
-- ── WHAT. Workers search items the company requested before and see a
--    dated, labelled history with reviewed product photos; "Request this
--    item again" starts a normal request that remembers the entry it came
--    from. The office switches history on per project, adds historical
--    references by hand, and reviews photos into a separate gallery.
--    Spec: docs/superpowers/specs/2026-10-09-workmate-stage1b-item-history-design.md.
--
-- ── WHO SEES WHAT. One function, pr_history_entries(), decides per ENTRY:
--    a worker sees a request line matched to a catalogue item when it is
--    their own, or when its project has "Allow item history" on; and a
--    non-retired historical reference on such a project. Additional Works
--    follow their parent project. Every worker read, the gallery storage
--    rule and the Request Again check go through it — nothing else decides.
--
-- ── WORKERS NEVER TOUCH TABLES. No policy grants a worker anything; every
--    worker read is a SECURITY DEFINER RPC. Workers never get requester
--    names, line notes, raw request photos or retired items.
--
-- ── NO MONEY. Nothing here holds or returns a price, amount or cost. A
--    historical reference creates no expense, purchase, stock or payment.
--    Outside the money model: nothing here feeds Spent / Earned / Profit.
--
-- ── RE-DECLARED. pr_submit_request (0085) and pr_request_doc,
--    pr_office_catalog, pr_office_projects (0086) are copied unchanged and
--    only GAIN lines; pr_office_save_item gains two optional arguments
--    (the old 7-argument call still works). App 0.4.0 keeps working.

set local lock_timeout = '5s';

-- ════ §1 New columns ═══════════════════════════════════════════════════

-- "Allow item history": separate from "Allow requests" on purpose (spec §3).
-- Off by default; stays on after the project is completed.
alter table pr_project_settings add column if not exists allow_history boolean not null default false;

-- Search aids for workers' own words. Not part of the item's identity.
alter table pr_catalog_items add column if not exists aliases text[] not null default '{}';
alter table pr_catalog_items add column if not exists brand text not null default '';

-- Request Again: the history entry a new line came from (a pr_lines id or a
-- pr_item_refs id — no foreign key, the entry may later be retired).
alter table pr_lines add column if not exists ref_kind text;
alter table pr_lines add column if not exists ref_id uuid;
alter table pr_lines drop constraint if exists pr_lines_ref_pair;
alter table pr_lines add constraint pr_lines_ref_pair check ((ref_kind is null) = (ref_id is null)
  and (ref_kind is null or ref_kind in ('request_line', 'reference')));

-- A private request photo the office has reviewed for the gallery: a copy
-- was published, or it was kept private. Either way it leaves the queue.
alter table pr_photos add column if not exists gallery_review text;
alter table pr_photos add column if not exists gallery_reviewed_by uuid references profiles(id);
alter table pr_photos add column if not exists gallery_reviewed_at timestamptz;
alter table pr_photos drop constraint if exists pr_photos_gallery_review_kind;
alter table pr_photos add constraint pr_photos_gallery_review_kind
  check (gallery_review is null or gallery_review in ('published', 'kept_private'));
alter table pr_photos drop constraint if exists pr_photos_gallery_review_pair;
alter table pr_photos add constraint pr_photos_gallery_review_pair
  check ((gallery_review is null) = (gallery_reviewed_at is null));

-- ════ §2 Historical references and gallery photos ═════════════════════

-- Staff-entered: "this item was used on project Y around date Z". Creates
-- no expense, stock or purchase. Retired, never deleted. Deleting the
-- project itself removes its references with it.
create table if not exists pr_item_refs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  catalog_item_id uuid not null references pr_catalog_items(id),
  folder_id uuid not null references folders(id) on delete cascade,
  work_folder_id uuid not null references folders(id) on delete cascade,
  description text not null check (btrim(description) <> ''),
  ref_date date,
  date_precision text not null check (date_precision in ('exact', 'approximate', 'unknown')),
  source_note text not null default '',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  retired_by uuid references profiles(id),
  retired_at timestamptz,
  retire_reason text,
  check ((date_precision = 'unknown') = (ref_date is null)),
  check ((retired_at is null) = (retired_by is null)),
  check (retired_at is null or btrim(coalesce(retire_reason, '')) <> '')
);
create index if not exists pr_item_refs_item on pr_item_refs (catalog_item_id);
alter table pr_item_refs enable row level security;

-- Reviewed product photos (bucket item-gallery). Never a raw request photo:
-- publishing makes a separate COPY. Several per item, one cover. Retired,
-- never deleted.
create table if not exists pr_gallery_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  catalog_item_id uuid not null references pr_catalog_items(id),
  storage_path text not null unique,
  source text not null check (source in ('upload', 'request_photo', 'reference')),
  source_photo_id uuid references pr_photos(id),
  source_ref_id uuid references pr_item_refs(id) on delete set null,
  is_cover boolean not null default false,
  status text not null default 'approved' check (status in ('approved', 'retired')),
  checklist_confirmed boolean not null check (checklist_confirmed),
  approved_by uuid not null references profiles(id),
  approved_at timestamptz not null default now(),
  retired_by uuid references profiles(id),
  retired_at timestamptz,
  retire_reason text,
  check ((status = 'retired') = (retired_at is not null)),
  check (status = 'approved' or not is_cover),
  check (source <> 'request_photo' or source_photo_id is not null),
  check (status <> 'retired' or btrim(coalesce(retire_reason, '')) <> '')
);
create unique index if not exists pr_gallery_one_cover on pr_gallery_photos (catalog_item_id) where is_cover and status = 'approved';
create index if not exists pr_gallery_item on pr_gallery_photos (catalog_item_id);
alter table pr_gallery_photos enable row level security;

-- The office reads; every change goes through an office RPC (§5).
drop policy if exists pr_item_refs_office_read on pr_item_refs;
create policy pr_item_refs_office_read on pr_item_refs for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));
drop policy if exists pr_gallery_photos_office_read on pr_gallery_photos;
create policy pr_gallery_photos_office_read on pr_gallery_photos for select to authenticated using ((is_owner() or is_staff()) and can_access(owner_id));

revoke all on pr_item_refs from anon;
revoke all on pr_gallery_photos from anon;
revoke insert, update, delete, truncate, references, trigger on pr_item_refs from authenticated;
revoke insert, update, delete, truncate, references, trigger on pr_gallery_photos from authenticated;

-- ════ §3 Who may see history ══════════════════════════════════════════

-- "Allow item history" is on for this top-level project of this company.
create or replace function pr_history_open(p_folder uuid, p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from pr_project_settings s join folders f on f.id = s.folder_id
     where s.folder_id = p_folder and s.allow_history
       and f.owner_id = p_owner and f.parent_folder_id is null)
$$;

-- Every history entry the viewer may see, one row per entry. THE rule.
-- p_office: the office sees everything of its company (retired flagged);
-- otherwise a line counts when it is the viewer's own or its project has
-- history on, and a reference when it is not retired and its project has
-- history on. Only lines matched to a catalogue item are history.
-- Requested quantity = what is still needed; none for a cancelled line.
create or replace function pr_history_entries(p_owner uuid, p_viewer uuid, p_office boolean, p_item uuid)
returns table (catalog_item_id uuid, entry_kind text, entry_id uuid, folder_id uuid, work_folder_id uuid,
               at_date date, date_precision text, cancelled boolean, retired boolean, quantity numeric,
               unit text, description text, note text, requester_id uuid, sort_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.catalog_item_id, 'request_line'::text, l.id, r.folder_id, r.work_folder_id,
         (r.received_at at time zone 'Asia/Manila')::date, 'exact'::text,
         (l.status = 'cancelled' or r.status = 'cancelled'), false,
         case when l.status = 'cancelled' or r.status = 'cancelled' then null::numeric
              else (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id) end,
         l.unit, null::text, null::text,
         case when p_office then r.requester_id end,
         r.received_at
    from pr_lines l
    join pr_requests r on r.id = l.request_id
   where l.catalog_item_id is not null
     and r.owner_id = p_owner
     and (p_item is null or l.catalog_item_id = p_item)
     and (p_office or r.requester_id = p_viewer or pr_history_open(r.folder_id, p_owner))
  union all
  select ir.catalog_item_id, 'reference'::text, ir.id, ir.folder_id, ir.work_folder_id,
         ir.ref_date, ir.date_precision,
         false, ir.retired_at is not null, null::numeric,
         null::text, ir.description, ir.source_note, null::uuid,
         coalesce((ir.ref_date::timestamp at time zone 'Asia/Manila'), ir.created_at)
    from pr_item_refs ir
   where ir.owner_id = p_owner
     and (p_item is null or ir.catalog_item_id = p_item)
     and (p_office or (ir.retired_at is null and pr_history_open(ir.folder_id, p_owner)))
$$;

create or replace function pr_entry_label(p_kind text, p_cancelled boolean) returns text
language sql immutable security definer set search_path = public as $$
  select case when p_kind = 'reference' then 'Historical reference'
              when p_cancelled then 'Requested — cancelled'
              else 'Requested' end
$$;

-- Gallery files: private bucket, <owner_id>/<catalog_item_id>/<uuid>.jpg.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-gallery', 'item-gallery', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- A worker may read an APPROVED photo of an item with at least one entry
-- they may see. Retired photos and unrecorded uploads are never readable.
create or replace function pr_can_read_gallery_path(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select pr_is_requester() and exists (
    select 1 from pr_gallery_photos g
     where g.storage_path = p_name and g.status = 'approved'
       and g.owner_id = attendance_data_owner()
       and exists (select 1 from pr_history_entries(g.owner_id, auth.uid(), false, g.catalog_item_id)))
$$;

-- Owner/staff, under their own company's folder, for one of its own items.
create or replace function pr_office_gallery_path_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(is_owner() or is_staff(), false)
     and (storage.foldername(p_name))[1] = data_owner_id()::text
     and exists (select 1 from pr_catalog_items c
                  where c.id::text = (storage.foldername(p_name))[2] and c.owner_id = data_owner_id())
$$;

drop policy if exists "item-gallery: office uploads" on storage.objects;
create policy "item-gallery: office uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-gallery' and pr_office_gallery_path_ok(name));

drop policy if exists "item-gallery: office reads" on storage.objects;
create policy "item-gallery: office reads" on storage.objects for select to authenticated
  using (bucket_id = 'item-gallery' and pr_office_gallery_path_ok(name));

drop policy if exists "item-gallery: workers read approved" on storage.objects;
create policy "item-gallery: workers read approved" on storage.objects for select to authenticated
  using (bucket_id = 'item-gallery' and pr_can_read_gallery_path(name));

revoke all on function pr_history_open(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_history_entries(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function pr_entry_label(text, boolean) from public, anon, authenticated;
revoke all on function pr_can_read_gallery_path(text) from public, anon;
grant execute on function pr_can_read_gallery_path(text) to authenticated;
revoke all on function pr_office_gallery_path_ok(text) from public, anon;
grant execute on function pr_office_gallery_path_ok(text) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/workmate-history.test.js`
Expected: `15 passed, 0 failed`.

Run: `npm test`
Expected: every existing suite still green (0090 is not yet in `npm test`; nothing else reads it).

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 2: Worker read RPCs — search, item detail, offline cleanup

**Files:**
- Modify: `supabase/migrations/0090_workmate_item_history.sql` (append §4)
- Modify: `tests/workmate-history.test.js` (insert tests above the `// ── Tasks 2–5 append` marker)

**Interfaces:**
- Consumes (Task 1): `pr_history_entries(owner, viewer, office, item)`, `pr_entry_label(kind, cancelled)`.
- Produces (internal, reused by Task 3's office RPCs):
  - `pr_history_search_doc(p_owner uuid, p_viewer uuid, p_office boolean, p_query text, p_kind text, p_category text, p_folder uuid, p_from date, p_to date, p_limit int, p_offset int) returns jsonb` → `{"items": [card…], "has_more": bool}`. Card: `id, kind, name, spec, unit, category, brand, aliases, active, cover_path, latest` where `latest` = `{entry_kind, entry_id, label, project_id, project_name, work_id, work_name, date, date_precision}` or null.
  - `pr_history_item_doc(p_owner uuid, p_viewer uuid, p_office boolean, p_item uuid, p_folder uuid) returns jsonb` → item fields + `photos` + `entries`. Entry: `entry_kind, entry_id, label, project_id, project_name, work_id, work_name, date, date_precision, quantity, unit, description, note, retired, requester_name` (requester_name only for the office).
- Produces (worker RPCs, granted):
  - `pr_history_search(p_query text default '', p_kind text default null, p_category text default null, p_folder uuid default null, p_from date default null, p_to date default null, p_limit int default 30, p_offset int default 0) returns jsonb`
  - `pr_history_item(p_item uuid, p_folder uuid default null) returns jsonb` — raises `HISTORY_NOT_AVAILABLE` when the caller sees no entry of it.
  - `pr_history_visible(p_items uuid[]) returns jsonb` → `[{"item_id", "entries": ["request_line:<uuid>", "reference:<uuid>", …], "photo_ids": [uuid…]}]` for items still visible; raises `TOO_MANY_ITEMS` above 500.

- [ ] **Step 1: Add the failing tests**

Insert above `// ── Tasks 2–5 append their tests above this line ──` in `tests/workmate-history.test.js`:

```js
test('worker RPCs check the requester and use the worker company, never office mode', () => {
  for (const name of ['pr_history_search', 'pr_history_item', 'pr_history_visible']) {
    const b = fnBlock(name);
    assert(b, 'no function ' + name);
    assert(/pr_is_requester\(\)/.test(b), name + ' must check pr_is_requester()');
    assert(/attendance_data_owner\(\), auth\.uid\(\), false/.test(b), name + ' must call with (attendance_data_owner(), auth.uid(), false');
    assert(!/data_owner_id\(\)/.test(b), name + ' must not use the office company');
  }
});

test('search is bounded, paginated and treats % and _ literally', () => {
  const b = fnBlock('pr_history_search_doc');
  assert(/least\(greatest\(coalesce\(p_limit, 30\), 1\), 50\)/.test(b), 'limit 1..50, default 30');
  assert(/'has_more'/.test(b), 'has_more flag');
  assert(b.includes("replace(replace(replace(btrim(coalesce(p_query, '')), '\\', '\\\\'), '%', '\\%'), '_', '\\_')"), 'escapes backslash, % and _');
  for (const f of ['c.name', 'c.spec', 'c.brand', 'c.category']) assert(b.includes(f + ' ilike q.pat'), 'searches ' + f);
  assert(/unnest\(c\.aliases\) a where a ilike q\.pat/.test(b), 'searches aliases');
});

test('search: workers only get items with a visible entry; the office also finds items with none', () => {
  const b = fnBlock('pr_history_search_doc');
  assert(b.includes('(p_office and p_folder is null and p_from is null and p_to is null) or lt.catalog_item_id is not null'), 'inclusion rule');
  assert(/not v\.retired/.test(b), 'retired references never count as the latest entry');
});

test('item detail: no requester names, notes or retired photos for workers', () => {
  const b = fnBlock('pr_history_item_doc');
  assert(b.includes("'requester_name', case when p_office and e.requester_id is not null then pr_person_name(e.requester_id) end"), 'requester name office-only');
  assert(b.includes("p_office or g.status = 'approved'"), 'workers get approved photos only');
  assert(/limit 200/.test(b), 'entries are capped');
  assert(!/\bl\.notes\b/.test(b), 'never reads line notes');
});

test('item detail refuses an item the worker cannot see', () => {
  assert(/'HISTORY_NOT_AVAILABLE'/.test(fnBlock('pr_history_item')), 'HISTORY_NOT_AVAILABLE');
});

test('offline cleanup works per entry and per photo, capped at 500 items', () => {
  const b = fnBlock('pr_history_visible');
  assert(b.includes('cardinality(p_items), 0) > 500') && /'TOO_MANY_ITEMS'/.test(b), 'cap 500');
  assert(/'entries'/.test(b) && /'photo_ids'/.test(b), 'returns entry keys and photo ids');
  assert(b.includes("v.entry_kind || ':' || v.entry_id"), 'entry key = kind:id');
});
```

Note: `fnBlock('pr_history_search')` must not return `pr_history_search_doc`'s block — the regex requires `\s*\(` right after the name, so `pr_history_search_doc` does not match `pr_history_search\s*\(`.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node tests/workmate-history.test.js`
Expected: the 6 new tests FAIL (no such functions yet); the 15 Task 1 tests still pass; exit 1.

- [ ] **Step 3: Append §4 to the migration**

Append to `supabase/migrations/0090_workmate_item_history.sql`:

```sql

-- ════ §4 What a worker reads ══════════════════════════════════════════

-- One page of item cards. Workers: items with at least one visible entry.
-- Office: also items with no history yet (to seed them), unless a project
-- or date filter is set. "latest" is the newest entry the caller may see
-- inside the filters; retired references never count.
create or replace function pr_history_search_doc(p_owner uuid, p_viewer uuid, p_office boolean, p_query text, p_kind text,
                                                 p_category text, p_folder uuid, p_from date, p_to date,
                                                 p_limit int, p_offset int) returns jsonb
language sql stable security definer set search_path = public as $$
  with q as (
    select '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           btrim(coalesce(p_query, '')) = '' as everything,
           least(greatest(coalesce(p_limit, 30), 1), 50) as lim,
           greatest(coalesce(p_offset, 0), 0) as off
  ), e as (
    select v.catalog_item_id, v.entry_kind, v.entry_id, v.folder_id, v.work_folder_id,
           v.at_date, v.date_precision, v.cancelled, v.sort_at
      from pr_history_entries(p_owner, p_viewer, p_office, null) v
     where not v.retired
       and (p_folder is null or v.folder_id = p_folder)
       and (p_from is null or v.at_date >= p_from)
       and (p_to is null or v.at_date <= p_to)
  ), latest as (
    select distinct on (e.catalog_item_id) e.*
      from e
     order by e.catalog_item_id, e.sort_at desc, e.entry_id
  ), hits as (
    select c.id, c.kind, c.name, c.spec, c.unit, c.category, c.brand, c.aliases, c.active,
           lt.entry_kind, lt.entry_id, lt.folder_id, lt.work_folder_id, lt.at_date, lt.date_precision,
           lt.cancelled, lt.sort_at, pf.name as project_name,
           case when lt.work_folder_id = lt.folder_id then 'Main Contract' else wf.name end as work_name
      from pr_catalog_items c
      cross join q
      left join latest lt on lt.catalog_item_id = c.id
      left join folders pf on pf.id = lt.folder_id
      left join folders wf on wf.id = lt.work_folder_id
     where c.owner_id = p_owner
       and ((p_office and p_folder is null and p_from is null and p_to is null) or lt.catalog_item_id is not null)
       and (p_kind is null or c.kind = p_kind)
       and (p_category is null or lower(c.category) = lower(btrim(p_category)))
       and (q.everything or c.name ilike q.pat or c.spec ilike q.pat or c.brand ilike q.pat or c.category ilike q.pat
            or exists (select 1 from unnest(c.aliases) a where a ilike q.pat))
  ), page as (
    select h.*, row_number() over (order by h.sort_at desc nulls last, lower(h.name), h.id) as rn
      from hits h
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'kind', p.kind, 'name', p.name, 'spec', p.spec, 'unit', p.unit,
               'category', p.category, 'brand', p.brand, 'aliases', to_jsonb(p.aliases), 'active', p.active,
               'cover_path', (select g.storage_path from pr_gallery_photos g
                               where g.catalog_item_id = p.id and g.status = 'approved'
                               order by g.is_cover desc, g.approved_at desc, g.id
                               limit 1),
               'latest', case when p.entry_id is null then null else jsonb_build_object(
                           'entry_kind', p.entry_kind, 'entry_id', p.entry_id,
                           'label', pr_entry_label(p.entry_kind, p.cancelled),
                           'project_id', p.folder_id, 'project_name', p.project_name,
                           'work_id', p.work_folder_id, 'work_name', p.work_name,
                           'date', p.at_date, 'date_precision', p.date_precision) end)
             order by p.rn)
        from page p, q
       where p.rn > q.off and p.rn <= q.off + q.lim), '[]'::jsonb),
    'has_more', exists (select 1 from page p, q where p.rn > q.off + q.lim))
$$;

-- One item: photos (cover first) and its history, newest first, at most
-- 200 entries. Workers: approved photos only; never requester names.
-- Office: retired photos and references too, with who and why.
create or replace function pr_history_item_doc(p_owner uuid, p_viewer uuid, p_office boolean, p_item uuid, p_folder uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit, 'category', c.category,
    'brand', c.brand, 'aliases', to_jsonb(c.aliases), 'active', c.active,
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'path', g.storage_path, 'is_cover', g.is_cover, 'status', g.status,
               'source', case when p_office then g.source end,
               'approved_at', case when p_office then g.approved_at end,
               'approved_by_name', case when p_office then pr_person_name(g.approved_by) end,
               'retired_at', case when p_office then g.retired_at end,
               'retire_reason', case when p_office then g.retire_reason end)
             order by (g.status = 'approved') desc, g.is_cover desc, g.approved_at desc, g.id)
        from pr_gallery_photos g
       where g.catalog_item_id = c.id and (p_office or g.status = 'approved')), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entry_kind', e.entry_kind, 'entry_id', e.entry_id,
               'label', pr_entry_label(e.entry_kind, e.cancelled),
               'project_id', e.folder_id, 'project_name', pf.name,
               'work_id', e.work_folder_id,
               'work_name', case when e.work_folder_id = e.folder_id then 'Main Contract' else wf.name end,
               'date', e.at_date, 'date_precision', e.date_precision,
               'quantity', e.quantity, 'unit', e.unit,
               'description', e.description, 'note', e.note,
               'retired', e.retired,
               'requester_name', case when p_office and e.requester_id is not null then pr_person_name(e.requester_id) end)
             order by e.sort_at desc, e.entry_id)
        from (select v.* from pr_history_entries(p_owner, p_viewer, p_office, p_item) v
               where p_folder is null or v.folder_id = p_folder
               order by v.sort_at desc, v.entry_id
               limit 200) e
        join folders pf on pf.id = e.folder_id
        join folders wf on wf.id = e.work_folder_id), '[]'::jsonb))
  from pr_catalog_items c
  where c.id = p_item and c.owner_id = p_owner
$$;

create or replace function pr_history_search(p_query text default '', p_kind text default null, p_category text default null,
                                             p_folder uuid default null, p_from date default null, p_to date default null,
                                             p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  return pr_history_search_doc(attendance_data_owner(), auth.uid(), false, p_query, p_kind, p_category,
                               p_folder, p_from, p_to, p_limit, p_offset);
end;
$$;

create or replace function pr_history_item(p_item uuid, p_folder uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_doc jsonb;
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pr_history_entries(attendance_data_owner(), auth.uid(), false, p_item)) then
    raise exception 'HISTORY_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  v_doc := pr_history_item_doc(attendance_data_owner(), auth.uid(), false, p_item, p_folder);
  if v_doc is null then
    raise exception 'HISTORY_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  return v_doc;
end;
$$;

-- The phone sends the items it has saved; the answer lists, for each one
-- still visible, the entries and approved photos it may keep. Everything
-- else saved on the phone is deleted (spec §4.4: per entry, not per item).
create or replace function pr_history_visible(p_items uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_items), 0) > 500 then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', i.id,
             'entries', (select jsonb_agg(v.entry_kind || ':' || v.entry_id order by v.entry_kind, v.entry_id)
                           from pr_history_entries(attendance_data_owner(), auth.uid(), false, i.id) v),
             'photo_ids', coalesce((select jsonb_agg(g.id order by g.id) from pr_gallery_photos g
                                     where g.catalog_item_id = i.id and g.status = 'approved'), '[]'::jsonb))
           order by i.id), '[]'::jsonb)
      from (select distinct u.id from unnest(coalesce(p_items, '{}'::uuid[])) as u(id)) i
     where exists (select 1 from pr_history_entries(attendance_data_owner(), auth.uid(), false, i.id)));
end;
$$;

revoke all on function pr_history_search_doc(uuid, uuid, boolean, text, text, text, uuid, date, date, integer, integer) from public, anon, authenticated;
revoke all on function pr_history_item_doc(uuid, uuid, boolean, uuid, uuid) from public, anon, authenticated;
revoke all on function pr_history_search(text, text, text, uuid, date, date, integer, integer) from public, anon;
grant execute on function pr_history_search(text, text, text, uuid, date, date, integer, integer) to authenticated;
revoke all on function pr_history_item(uuid, uuid) from public, anon;
grant execute on function pr_history_item(uuid, uuid) to authenticated;
revoke all on function pr_history_visible(uuid[]) from public, anon;
grant execute on function pr_history_visible(uuid[]) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/workmate-history.test.js`
Expected: `21 passed, 0 failed`.

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 3: Office RPCs — switch, catalogue, references, gallery review

**Files:**
- Modify: `supabase/migrations/0090_workmate_item_history.sql` (append §5)
- Modify: `tests/workmate-history.test.js` (insert tests above the marker)

**Interfaces:**
- Consumes (Tasks 1–2): `pr_history_search_doc(...)`, `pr_history_item_doc(...)`, tables `pr_item_refs`, `pr_gallery_photos`, column `pr_photos.gallery_review`; 0086's `pr_is_office()`.
- Produces (internal): `pr_clean_aliases(text[]) returns text[]`, `pr_gallery_check_path(p_owner uuid, p_item uuid, p_path text) returns void`, `pr_gallery_ensure_cover(p_item uuid, p_photo uuid) returns void`.
- Produces (office RPCs, granted; used by plan 1b-2's Dacs Web screens):
  - `pr_office_save_item(p_item uuid, p_kind text, p_name text, p_spec text, p_unit text, p_category text, p_active boolean, p_aliases text[] default null, p_brand text default null) returns jsonb` → `{id}` (null alias/brand = leave unchanged; the 7-argument version is dropped)
  - `pr_office_set_allow_history(p_folder uuid, p_allow boolean) returns jsonb` → `{folder_id, allow_history}`
  - `pr_office_history_search(...same 8 parameters and defaults as pr_history_search...) returns jsonb`
  - `pr_office_history_item(p_item uuid, p_folder uuid default null) returns jsonb`
  - `pr_office_add_ref(p_item uuid, p_folder uuid, p_work uuid, p_description text, p_ref_date date, p_precision text, p_source_note text) returns jsonb` → `{id}`
  - `pr_office_retire_ref(p_ref uuid, p_reason text) returns jsonb` → `{id, retired: true}`
  - `pr_office_photo_queue() returns jsonb` → up to 200 newest unreviewed request photos on matched lines: `{photo_id, path, created_at, request_id, line_id, line_description, project_name, work_name, requester_name, item: {id, kind, name, spec, unit}}`
  - `pr_office_publish_photo(p_photo uuid, p_path text, p_checklist boolean, p_make_cover boolean default false) returns jsonb` → `{id, is_cover}` (`p_path` = the COPY already uploaded to `item-gallery`)
  - `pr_office_keep_private(p_photo uuid) returns jsonb` → `{photo_id, gallery_review}`
  - `pr_office_add_gallery_photo(p_item uuid, p_path text, p_checklist boolean, p_make_cover boolean default false, p_ref uuid default null) returns jsonb` → `{id, is_cover}`
  - `pr_office_set_cover(p_photo uuid) returns jsonb` → `{id, is_cover: true}`
  - `pr_office_retire_photo(p_photo uuid, p_reason text) returns jsonb` → `{id, status: 'retired'}`

- [ ] **Step 1: Add the failing tests**

Insert above the marker in `tests/workmate-history.test.js`:

```js
const OFFICE_RPCS_0090 = ['pr_office_save_item', 'pr_office_set_allow_history', 'pr_office_history_search',
  'pr_office_history_item', 'pr_office_add_ref', 'pr_office_retire_ref', 'pr_office_photo_queue',
  'pr_office_publish_photo', 'pr_office_keep_private', 'pr_office_add_gallery_photo', 'pr_office_set_cover',
  'pr_office_retire_photo'];

test('every 0090 office RPC refuses non-office callers', () => {
  for (const name of OFFICE_RPCS_0090) {
    const b = fnBlock(name);
    assert(b, 'no function ' + name);
    assert(/pr_is_office\(\)/.test(b), name + ' does not check pr_is_office()');
  }
});

test('office writes check the row company and record who', () => {
  for (const name of ['pr_office_add_ref', 'pr_office_retire_ref', 'pr_office_publish_photo', 'pr_office_keep_private',
                      'pr_office_add_gallery_photo', 'pr_office_set_cover', 'pr_office_retire_photo', 'pr_office_set_allow_history']) {
    const b = fnBlock(name);
    assert(/can_access\(/.test(b), name + ' must check can_access');
    // Choosing a cover is a display choice with no actor column; every other write stores who did it.
    if (name !== 'pr_office_set_cover') assert(/auth\.uid\(\)/.test(b), name + ' must record the actor');
  }
});

test('the old 7-argument save_item is dropped; aliases and brand are optional', () => {
  assert(CODE.includes('drop function if exists pr_office_save_item(uuid, text, text, text, text, text, boolean);'), 'drop old');
  const b = fnBlock('pr_office_save_item');
  assert(b.includes('p_aliases text[] default null, p_brand text default null'), 'optional new args');
  assert(b.includes('aliases = coalesce(v_aliases, aliases)') && b.includes('brand = coalesce(btrim(p_brand), brand)'),
    'null leaves aliases and brand unchanged');
  assert(/'DUPLICATE_ITEM'/.test(b) && /'BAD_ITEM'/.test(b), 'keeps the 0086 refusals');
});

test('history switch only touches allow_history', () => {
  const b = fnBlock('pr_office_set_allow_history');
  assert(b.includes('set allow_history = excluded.allow_history'), 'upsert sets allow_history');
  assert(!/allow_requests\s*=/.test(b), 'never changes allow_requests');
});

test('office reads use office mode and the office company', () => {
  assert(/pr_history_search_doc\(data_owner_id\(\), auth\.uid\(\), true/.test(fnBlock('pr_office_history_search')), 'search');
  assert(/pr_history_item_doc\(v_owner, auth\.uid\(\), true/.test(fnBlock('pr_office_history_item')), 'item');
});

test('a reference must sit on the project or one of its own Additional Works', () => {
  const b = fnBlock('pr_office_add_ref');
  assert(/f\.parent_folder_id is null/.test(b) && /c\.parent_folder_id = p_folder/.test(b), 'project/AW rule');
  assert(/'BAD_DESTINATION'/.test(b) && /'BAD_REFERENCE'/.test(b), 'refusals');
});

test('retiring needs a reason; nothing in 0090 deletes a reference or photo', () => {
  for (const name of ['pr_office_retire_ref', 'pr_office_retire_photo'])
    assert(/'REASON_REQUIRED'/.test(fnBlock(name)), name + ' needs a reason');
  assert(!/delete from pr_item_refs|delete from pr_gallery_photos|delete from storage\.objects/i.test(CODE), 'no deletes');
});

test('publishing needs the checklist and a real file at the right path, once', () => {
  const chk = fnBlock('pr_gallery_check_path');
  assert(chk.includes("o.bucket_id = 'item-gallery'") && /'FILE_MISSING'/.test(chk) && /'BAD_PATH'/.test(chk)
    && /'ALREADY_IN_GALLERY'/.test(chk), 'path check');
  for (const name of ['pr_office_publish_photo', 'pr_office_add_gallery_photo']) {
    const b = fnBlock(name);
    assert(/'CHECKLIST_REQUIRED'/.test(b) && /pr_gallery_check_path\(/.test(b), name + ' checklist + path');
  }
  assert(/'ALREADY_REVIEWED'/.test(fnBlock('pr_office_publish_photo')), 'a photo is reviewed once');
});

test('cover changes lock the catalogue item first', () => {
  for (const name of ['pr_office_publish_photo', 'pr_office_add_gallery_photo', 'pr_office_set_cover', 'pr_office_retire_photo']) {
    const b = fnBlock(name);
    const lock = b.search(/from pr_catalog_items where id = [a-z_.]+ for update/);
    const cover = b.indexOf('pr_gallery_ensure_cover(');
    assert(lock >= 0 && cover > lock, name + ' must lock the item before changing the cover');
  }
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node tests/workmate-history.test.js`
Expected: the 9 new tests FAIL; the 21 earlier tests pass; exit 1.

- [ ] **Step 3: Append §5 to the migration**

Append to `supabase/migrations/0090_workmate_item_history.sql`:

```sql

-- ════ §5 The office ═══════════════════════════════════════════════════

-- Aliases: trimmed, blanks dropped, one per spelling (case-insensitive).
create or replace function pr_clean_aliases(p_aliases text[]) returns text[]
language sql immutable security definer set search_path = public as $$
  select coalesce(array_agg(d.a order by lower(d.a)), '{}'::text[])
    from (select distinct on (lower(btrim(x))) btrim(x) as a
            from unnest(coalesce(p_aliases, '{}'::text[])) as x
           where btrim(coalesce(x, '')) <> ''
           order by lower(btrim(x)), btrim(x)) d
$$;

-- 0086's catalogue save, with two OPTIONAL search aids. Null leaves them
-- unchanged, so the 7-argument call Dacs Web makes today keeps working.
drop function if exists pr_office_save_item(uuid, text, text, text, text, text, boolean);
create or replace function pr_office_save_item(p_item uuid, p_kind text, p_name text, p_spec text, p_unit text,
                                               p_category text, p_active boolean,
                                               p_aliases text[] default null, p_brand text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
  v_aliases text[] := case when p_aliases is null then null else pr_clean_aliases(p_aliases) end;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('material', 'tool')
     or btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_unit, '')) = '' then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  if (v_aliases is not null and (cardinality(v_aliases) > 20
        or exists (select 1 from unnest(v_aliases) a where length(a) > 60)))
     or length(btrim(coalesce(p_brand, ''))) > 80 then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  begin
    if p_item is null then
      insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, active, aliases, brand)
      values (data_owner_id(), p_kind, btrim(p_name), btrim(coalesce(p_spec, '')), btrim(p_unit),
              btrim(coalesce(p_category, '')), coalesce(p_active, true), coalesce(v_aliases, '{}'::text[]),
              btrim(coalesce(p_brand, '')))
      returning id into v_id;
    else
      select owner_id into v_owner from pr_catalog_items where id = p_item;
      if v_owner is null or not can_access(v_owner) then
        raise exception 'NOT_FOUND' using errcode = 'P0001';
      end if;
      update pr_catalog_items
         set kind = p_kind, name = btrim(p_name), spec = btrim(coalesce(p_spec, '')), unit = btrim(p_unit),
             category = btrim(coalesce(p_category, '')), active = coalesce(p_active, active),
             aliases = coalesce(v_aliases, aliases), brand = coalesce(btrim(p_brand), brand), updated_at = now()
       where id = p_item
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE_ITEM' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', v_id);
end;
$$;

-- "Allow item history" per top-level project. Never touches Allow requests.
create or replace function pr_office_set_allow_history(p_folder uuid, p_allow boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from folders where id = p_folder and parent_folder_id is null;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  insert into pr_project_settings (folder_id, owner_id, allow_history, updated_by, updated_at)
  values (p_folder, v_owner, coalesce(p_allow, false), auth.uid(), now())
  on conflict (folder_id) do update
    set allow_history = excluded.allow_history, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('folder_id', p_folder, 'allow_history', coalesce(p_allow, false));
end;
$$;

create or replace function pr_office_history_search(p_query text default '', p_kind text default null, p_category text default null,
                                                    p_folder uuid default null, p_from date default null, p_to date default null,
                                                    p_limit int default 30, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  return pr_history_search_doc(data_owner_id(), auth.uid(), true, p_query, p_kind, p_category,
                               p_folder, p_from, p_to, p_limit, p_offset);
end;
$$;

create or replace function pr_office_history_item(p_item uuid, p_folder uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_catalog_items where id = p_item;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return pr_history_item_doc(v_owner, auth.uid(), true, p_item, p_folder);
end;
$$;

-- A hand-entered historical reference. The work is the project itself
-- (Main Contract) or one of its OWN Additional Works; completed is fine —
-- history outlives the job. Creates no expense, stock or purchase.
create or replace function pr_office_add_ref(p_item uuid, p_folder uuid, p_work uuid, p_description text,
                                             p_ref_date date, p_precision text, p_source_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
  v_work uuid := coalesce(p_work, p_folder);
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_catalog_items where id = p_item;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from folders f where f.id = p_folder and f.owner_id = v_owner and f.parent_folder_id is null)
     or not (v_work = p_folder
             or exists (select 1 from folders c where c.id = v_work and c.parent_folder_id = p_folder)) then
    raise exception 'BAD_DESTINATION' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_description, '')) = '' or p_precision is null
     or p_precision not in ('exact', 'approximate', 'unknown')
     or (p_precision = 'unknown') <> (p_ref_date is null) then
    raise exception 'BAD_REFERENCE' using errcode = 'P0001';
  end if;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date,
                            date_precision, source_note, created_by)
  values (v_owner, p_item, p_folder, v_work, btrim(p_description), p_ref_date, p_precision,
          btrim(coalesce(p_source_note, '')), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function pr_office_retire_ref(p_ref uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select ir.id, ir.owner_id, ir.retired_at into r from pr_item_refs ir where ir.id = p_ref for update;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.retired_at is null then
    update pr_item_refs set retired_at = now(), retired_by = auth.uid(), retire_reason = btrim(p_reason) where id = p_ref;
  end if;
  return jsonb_build_object('id', p_ref, 'retired', true);
end;
$$;

-- Private request photos waiting for review: on a line matched to a
-- catalogue item, not yet published or kept private. Newest first, 200.
create or replace function pr_office_photo_queue() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.doc order by x.created_at desc), '[]'::jsonb)
    from (
      select ph.created_at, jsonb_build_object(
               'photo_id', ph.id, 'path', ph.storage_path, 'created_at', ph.created_at,
               'request_id', r.id, 'line_id', l.id, 'line_description', l.description,
               'project_name', f.name,
               'work_name', case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end,
               'requester_name', pr_person_name(r.requester_id),
               'item', jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit)) as doc
        from pr_photos ph
        join pr_lines l on l.id = ph.line_id
        join pr_requests r on r.id = ph.request_id
        join pr_catalog_items c on c.id = l.catalog_item_id
        join folders f on f.id = r.folder_id
        join folders w on w.id = r.work_folder_id
       where pr_is_office() and ph.owner_id = data_owner_id() and ph.gallery_review is null
       order by ph.created_at desc
       limit 200) x
$$;

-- The file must already be in item-gallery, under this company and item,
-- with a uuid name, and not be in the gallery yet.
create or replace function pr_gallery_check_path(p_owner uuid, p_item uuid, p_path text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_path is null or p_path !~ ('^' || p_owner::text || '/' || p_item::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'BAD_PATH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'item-gallery' and o.name = p_path) then
    raise exception 'FILE_MISSING' using errcode = 'P0001';
  end if;
  if exists (select 1 from pr_gallery_photos g where g.storage_path = p_path) then
    raise exception 'ALREADY_IN_GALLERY' using errcode = 'P0001';
  end if;
end;
$$;

-- p_photo given: it becomes the only cover. Null: keep the current cover,
-- or promote the newest approved photo when the item has none.
-- Callers hold the pr_catalog_items row lock.
create or replace function pr_gallery_ensure_cover(p_item uuid, p_photo uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_photo is not null then
    update pr_gallery_photos set is_cover = false where catalog_item_id = p_item and is_cover and id <> p_photo;
    update pr_gallery_photos set is_cover = true where id = p_photo and status = 'approved';
  elsif not exists (select 1 from pr_gallery_photos g
                     where g.catalog_item_id = p_item and g.is_cover and g.status = 'approved') then
    update pr_gallery_photos set is_cover = true
     where id = (select g.id from pr_gallery_photos g
                  where g.catalog_item_id = p_item and g.status = 'approved'
                  order by g.approved_at desc, g.id desc
                  limit 1);
  end if;
end;
$$;

-- Publish a reviewed COPY of a private request photo. Dacs Web uploads the
-- copy to item-gallery first, then calls this. The original stays private.
create or replace function pr_office_publish_photo(p_photo uuid, p_path text, p_checklist boolean,
                                                   p_make_cover boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if not coalesce(p_checklist, false) then
    raise exception 'CHECKLIST_REQUIRED' using errcode = 'P0001';
  end if;
  select ph.id, ph.owner_id, ph.gallery_review, l.catalog_item_id into r
    from pr_photos ph left join pr_lines l on l.id = ph.line_id
   where ph.id = p_photo
     for update of ph;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.gallery_review is not null then
    raise exception 'ALREADY_REVIEWED' using errcode = 'P0001';
  end if;
  if r.catalog_item_id is null then
    raise exception 'NOT_MATCHED' using errcode = 'P0001';
  end if;
  perform 1 from pr_catalog_items where id = r.catalog_item_id for update;
  perform pr_gallery_check_path(r.owner_id, r.catalog_item_id, p_path);
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, source_photo_id,
                                 checklist_confirmed, approved_by)
  values (r.owner_id, r.catalog_item_id, p_path, 'request_photo', p_photo, true, auth.uid())
  returning id into v_id;
  update pr_photos set gallery_review = 'published', gallery_reviewed_by = auth.uid(), gallery_reviewed_at = now()
   where id = p_photo;
  perform pr_gallery_ensure_cover(r.catalog_item_id, case when coalesce(p_make_cover, false) then v_id end);
  return jsonb_build_object('id', v_id, 'is_cover', (select g.is_cover from pr_gallery_photos g where g.id = v_id));
end;
$$;

create or replace function pr_office_keep_private(p_photo uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select ph.id, ph.owner_id, ph.gallery_review into r from pr_photos ph where ph.id = p_photo for update;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.gallery_review is null then
    update pr_photos set gallery_review = 'kept_private', gallery_reviewed_by = auth.uid(), gallery_reviewed_at = now()
     where id = p_photo;
  end if;
  return jsonb_build_object('photo_id', p_photo,
                            'gallery_review', (select ph.gallery_review from pr_photos ph where ph.id = p_photo));
end;
$$;

-- A photo staff took or found themselves (optionally for one of the item's
-- historical references). Uploaded to item-gallery first, then recorded.
create or replace function pr_office_add_gallery_photo(p_item uuid, p_path text, p_checklist boolean,
                                                       p_make_cover boolean default false, p_ref uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_id uuid;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if not coalesce(p_checklist, false) then
    raise exception 'CHECKLIST_REQUIRED' using errcode = 'P0001';
  end if;
  select owner_id into v_owner from pr_catalog_items where id = p_item;
  if v_owner is null or not can_access(v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_ref is not null and not exists (
       select 1 from pr_item_refs ir where ir.id = p_ref and ir.catalog_item_id = p_item and ir.retired_at is null) then
    raise exception 'BAD_REFERENCE' using errcode = 'P0001';
  end if;
  perform 1 from pr_catalog_items where id = p_item for update;
  perform pr_gallery_check_path(v_owner, p_item, p_path);
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, source_ref_id,
                                 checklist_confirmed, approved_by)
  values (v_owner, p_item, p_path, case when p_ref is null then 'upload' else 'reference' end, p_ref, true, auth.uid())
  returning id into v_id;
  perform pr_gallery_ensure_cover(p_item, case when coalesce(p_make_cover, false) then v_id end);
  return jsonb_build_object('id', v_id, 'is_cover', (select g.is_cover from pr_gallery_photos g where g.id = v_id));
end;
$$;

create or replace function pr_office_set_cover(p_photo uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  select g.id, g.owner_id, g.catalog_item_id, g.status into r from pr_gallery_photos g where g.id = p_photo;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status <> 'approved' then
    raise exception 'PHOTO_RETIRED' using errcode = 'P0001';
  end if;
  perform 1 from pr_catalog_items where id = r.catalog_item_id for update;
  perform pr_gallery_ensure_cover(r.catalog_item_id, p_photo);
  return jsonb_build_object('id', p_photo, 'is_cover', true);
end;
$$;

-- Retired, never deleted: workers stop seeing it on their next refresh; the
-- office keeps it, greyed, with who and why. A retired cover hands the
-- cover to the newest remaining approved photo.
create or replace function pr_office_retire_photo(p_photo uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  select g.id, g.owner_id, g.catalog_item_id, g.status into r from pr_gallery_photos g where g.id = p_photo;
  if not found or not can_access(r.owner_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if r.status = 'approved' then
    perform 1 from pr_catalog_items where id = r.catalog_item_id for update;
    update pr_gallery_photos
       set status = 'retired', is_cover = false, retired_at = now(), retired_by = auth.uid(), retire_reason = btrim(p_reason)
     where id = p_photo;
    perform pr_gallery_ensure_cover(r.catalog_item_id, null);
  end if;
  return jsonb_build_object('id', p_photo, 'status', 'retired');
end;
$$;

revoke all on function pr_clean_aliases(text[]) from public, anon, authenticated;
revoke all on function pr_gallery_check_path(uuid, uuid, text) from public, anon, authenticated;
revoke all on function pr_gallery_ensure_cover(uuid, uuid) from public, anon, authenticated;
revoke all on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) from public, anon;
grant execute on function pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text) to authenticated;
revoke all on function pr_office_set_allow_history(uuid, boolean) from public, anon;
grant execute on function pr_office_set_allow_history(uuid, boolean) to authenticated;
revoke all on function pr_office_history_search(text, text, text, uuid, date, date, integer, integer) from public, anon;
grant execute on function pr_office_history_search(text, text, text, uuid, date, date, integer, integer) to authenticated;
revoke all on function pr_office_history_item(uuid, uuid) from public, anon;
grant execute on function pr_office_history_item(uuid, uuid) to authenticated;
revoke all on function pr_office_add_ref(uuid, uuid, uuid, text, date, text, text) from public, anon;
grant execute on function pr_office_add_ref(uuid, uuid, uuid, text, date, text, text) to authenticated;
revoke all on function pr_office_retire_ref(uuid, text) from public, anon;
grant execute on function pr_office_retire_ref(uuid, text) to authenticated;
revoke all on function pr_office_photo_queue() from public, anon;
grant execute on function pr_office_photo_queue() to authenticated;
revoke all on function pr_office_publish_photo(uuid, text, boolean, boolean) from public, anon;
grant execute on function pr_office_publish_photo(uuid, text, boolean, boolean) to authenticated;
revoke all on function pr_office_keep_private(uuid) from public, anon;
grant execute on function pr_office_keep_private(uuid) to authenticated;
revoke all on function pr_office_add_gallery_photo(uuid, text, boolean, boolean, uuid) from public, anon;
grant execute on function pr_office_add_gallery_photo(uuid, text, boolean, boolean, uuid) to authenticated;
revoke all on function pr_office_set_cover(uuid) from public, anon;
grant execute on function pr_office_set_cover(uuid) to authenticated;
revoke all on function pr_office_retire_photo(uuid, text) from public, anon;
grant execute on function pr_office_retire_photo(uuid, text) to authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tests/workmate-history.test.js`
Expected: `30 passed, 0 failed`.

- [ ] **Step 5: Stop — no commit.** Report to the controller.

---

### Task 4: Request Again link — re-declared submit and office views

**Files:**
- Modify: `supabase/migrations/0090_workmate_item_history.sql` (append §6 via the generator script below)
- Create (scratch, not committed): `.superpowers/sdd/1b1_redeclare.py` — or run it inline; it is a build helper, not product code
- Modify: `tests/workmate-history.test.js` (insert tests above the marker)

**Interfaces:**
- Consumes: `pr_history_entries` (Task 1); 0085 `pr_submit_request`; 0086 `pr_request_doc`, `pr_office_catalog`, `pr_office_projects`.
- Produces:
  - `pr_ref_label(p_kind text, p_id uuid) returns text` (internal) → e.g. `Barlin Residence · Main Contract · Oct 3, 2026 · Requested`, `Barlin Residence · Kitchen AW · around Aug 2026 · Historical reference`, `… · Date unknown · Historical reference`.
  - `pr_submit_request(p_op uuid, p_request jsonb)` — unchanged signature and result; each line may now carry `"ref_kind"` and `"ref_id"`.
  - `pr_request_doc` lines gain `ref_kind`, `ref_id`, `ref_label`; `pr_office_catalog` items gain `brand`, `aliases`; `pr_office_projects` rows gain `allow_history`.
- Link rules (spec §4.2, amended 2026-10-09):
  - refused with `BAD_REFERENCE`: `ref_kind` not `request_line`/`reference`, `ref_id` missing or not a uuid, a link on a line with no `catalog_item_id`, `ref_id` without `ref_kind`, or an entry id that does not exist **in the requester's company**;
  - **saved without the link** (request still accepted): a real entry the requester can no longer see, or one that now belongs to a different catalogue item.

- [ ] **Step 1: Add the failing tests**

Insert above the marker in `tests/workmate-history.test.js`:

```js
// A re-declared function may only GAIN lines: every original line, in order.
function missingOriginalLine(original, now) {
  const want = original.split('\n').map(s => s.trimEnd()).filter(s => s.trim() !== '');
  const have = now.split('\n').map(s => s.trimEnd());
  let j = 0;
  for (const line of want) {
    while (j < have.length && have[j] !== line) j++;
    if (j === have.length) return line;
    j++;
  }
  return null;
}
const CODE_0085 = read('supabase/migrations/0085_workmate_requests.sql').replace(/--.*$/gm, '');
const CODE_0086 = read('supabase/migrations/0086_workmate_requests_office.sql').replace(/--.*$/gm, '');

test('re-declared 0085/0086 functions keep every original line, in order', () => {
  for (const [src, name] of [[CODE_0085, 'pr_submit_request'], [CODE_0086, 'pr_request_doc'],
                             [CODE_0086, 'pr_office_catalog'], [CODE_0086, 'pr_office_projects']]) {
    const orig = fnBlockIn(src, name), now = fnBlock(name);
    assert(orig && now, 'missing ' + name);
    const lost = missingOriginalLine(orig, now);
    assert(lost === null, name + ' lost or changed the line: ' + lost);
    assert(now.split('\n').length > orig.split('\n').length, name + ' gained no lines');
  }
});

test('Request Again: malformed or unknown links refuse, stale links are dropped', () => {
  const b = fnBlock('pr_submit_request');
  assert(/'BAD_REFERENCE'/.test(b), 'BAD_REFERENCE');
  assert(b.includes("x.id = v_ref_id and x.owner_id = v_owner"), 'existence checked inside the company');
  assert(b.includes('pr_history_entries(v_owner, v_uid, false, v_item)'), 'visibility through the one rule');
  assert(/v_ref_kind := null;\s*v_ref_id := null;/.test(b), 'a stale link is dropped, not refused');
  assert(b.includes('update pr_lines set ref_kind = v_ref_kind, ref_id = v_ref_id where id = v_line_id;'), 'link stored on the line');
});

test('the office sees each line\'s source; catalogue and projects carry the new fields', () => {
  assert(fnBlock('pr_request_doc').includes("'ref_label', case when l.ref_kind is null then null else pr_ref_label(l.ref_kind, l.ref_id) end"), 'ref_label');
  assert(fnBlock('pr_office_catalog').includes("'brand', c.brand, 'aliases', to_jsonb(c.aliases),"), 'catalogue fields');
  assert(fnBlock('pr_office_projects').includes("'allow_history', coalesce(s.allow_history, false),"), 'allow_history');
  assert(CODE.includes('revoke all on function pr_ref_label(text, uuid) from public, anon, authenticated;'), 'pr_ref_label internal');
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node tests/workmate-history.test.js`
Expected: the 3 new tests FAIL (functions missing from 0090); the 30 earlier tests pass; exit 1.

- [ ] **Step 3: Append the hand-written part of §6**

Append to `supabase/migrations/0090_workmate_item_history.sql`:

```sql

-- ════ §6 Request Again: the link on a request line ═════════════════════

-- The office's readable name for a line's source entry.
create or replace function pr_ref_label(p_kind text, p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_kind = 'request_line' then (
      select f.name || ' · ' || case when r.work_folder_id = r.folder_id then 'Main Contract' else w.name end
             || ' · ' || to_char(r.received_at at time zone 'Asia/Manila', 'FMMon FMDD, YYYY') || ' · Requested'
        from pr_lines l
        join pr_requests r on r.id = l.request_id
        join folders f on f.id = r.folder_id
        join folders w on w.id = r.work_folder_id
       where l.id = p_id)
    when p_kind = 'reference' then (
      select f.name || ' · ' || case when ir.work_folder_id = ir.folder_id then 'Main Contract' else w.name end
             || ' · ' || case ir.date_precision
                           when 'unknown' then 'Date unknown'
                           when 'approximate' then 'around ' || to_char(ir.ref_date, 'FMMon YYYY')
                           else to_char(ir.ref_date, 'FMMon FMDD, YYYY') end
             || ' · Historical reference'
        from pr_item_refs ir
        join folders f on f.id = ir.folder_id
        join folders w on w.id = ir.work_folder_id
       where ir.id = p_id)
  end
$$;

-- The four functions below are 0085/0086 copied unchanged; the only
-- differences are ADDED lines (tests/workmate-history.test.js checks).
```

- [ ] **Step 4: Generate and append the four re-declared functions**

Run this Python from the repo root (it copies each function byte-for-byte from its source file, inserts only new lines at exact, unique anchors, and appends the result plus §6 grants):

```python
import re

MIG = 'supabase/migrations/0090_workmate_item_history.sql'

def extract(path, name):
    s = open(path, encoding='utf-8').read()
    m = re.search(r'create or replace function ' + name + r'\s*\(.*?\$\$;', s, re.S)
    assert m, name
    return m.group(0)

def add_after(block, anchor, new):
    assert block.count(anchor) == 1, 'anchor not unique/missing: ' + anchor
    return block.replace(anchor, anchor + new)

submit = extract('supabase/migrations/0085_workmate_requests.sql', 'pr_submit_request')
submit = add_after(submit, "  v_drafted timestamptz;\n", "  v_ref_kind text;\n  v_ref_id uuid;\n")
submit = add_after(submit,
    "      raise exception 'BAD_CATALOG_ITEM' using errcode = 'P0001';\n    end if;\n",
    "    -- Request Again (0090): the line may name the history entry it came\n"
    "    -- from. A malformed link, or one naming no entry of this company, is a\n"
    "    -- client bug and refuses the request. A real entry this worker can no\n"
    "    -- longer see, or one the office has since matched to another item,\n"
    "    -- only drops the link: an offline draft must never get stuck.\n"
    "    v_ref_kind := nullif(v_line ->> 'ref_kind', '');\n"
    "    v_ref_id := null;\n"
    "    if v_ref_kind is not null or nullif(v_line ->> 'ref_id', '') is not null then\n"
    "      begin\n"
    "        v_ref_id := nullif(v_line ->> 'ref_id', '')::uuid;\n"
    "      exception when invalid_text_representation then\n"
    "        raise exception 'BAD_REFERENCE' using errcode = 'P0001';\n"
    "      end;\n"
    "      if v_ref_kind is null or v_ref_kind not in ('request_line', 'reference') or v_ref_id is null or v_item is null\n"
    "         or (v_ref_kind = 'request_line' and not exists (\n"
    "               select 1 from pr_lines x where x.id = v_ref_id and x.owner_id = v_owner))\n"
    "         or (v_ref_kind = 'reference' and not exists (\n"
    "               select 1 from pr_item_refs x where x.id = v_ref_id and x.owner_id = v_owner)) then\n"
    "        raise exception 'BAD_REFERENCE' using errcode = 'P0001';\n"
    "      end if;\n"
    "      if not exists (select 1 from pr_history_entries(v_owner, v_uid, false, v_item) e\n"
    "                      where e.entry_kind = v_ref_kind and e.entry_id = v_ref_id) then\n"
    "        v_ref_kind := null;\n"
    "        v_ref_id := null;\n"
    "      end if;\n"
    "    end if;\n")
submit = add_after(submit, "    returning id into v_line_id;\n",
    "    if v_ref_kind is not null then\n"
    "      update pr_lines set ref_kind = v_ref_kind, ref_id = v_ref_id where id = v_line_id;\n"
    "    end if;\n")

doc = extract('supabase/migrations/0086_workmate_requests_office.sql', 'pr_request_doc')
doc = add_after(doc,
    "               'catalog_item_id', l.catalog_item_id, 'catalog_name', c.name, 'catalog_spec', c.spec, 'catalog_unit', c.unit,\n",
    "               'ref_kind', l.ref_kind, 'ref_id', l.ref_id,\n"
    "               'ref_label', case when l.ref_kind is null then null else pr_ref_label(l.ref_kind, l.ref_id) end,\n")

cat = extract('supabase/migrations/0086_workmate_requests_office.sql', 'pr_office_catalog')
cat = add_after(cat,
    "           'id', c.id, 'kind', c.kind, 'name', c.name, 'spec', c.spec, 'unit', c.unit,\n",
    "           'brand', c.brand, 'aliases', to_jsonb(c.aliases),\n")

proj = extract('supabase/migrations/0086_workmate_requests_office.sql', 'pr_office_projects')
proj = add_after(proj,
    "           'allow_requests', coalesce(s.allow_requests, false),\n",
    "           'allow_history', coalesce(s.allow_history, false),\n")

grants = (
    "revoke all on function pr_ref_label(text, uuid) from public, anon, authenticated;\n"
    "revoke all on function pr_request_doc(uuid, boolean) from public, anon, authenticated;\n"
    "revoke all on function pr_submit_request(uuid, jsonb) from public, anon;\n"
    "grant execute on function pr_submit_request(uuid, jsonb) to authenticated;\n"
    "revoke all on function pr_office_catalog() from public, anon;\n"
    "grant execute on function pr_office_catalog() to authenticated;\n"
    "revoke all on function pr_office_projects() from public, anon;\n"
    "grant execute on function pr_office_projects() to authenticated;\n")

with open(MIG, 'a', encoding='utf-8', newline='') as f:
    f.write('\n' + submit + '\n\n' + doc + '\n\n' + cat + '\n\n' + proj + '\n\n' + grants)
print('appended §6 re-declares')
```

Expected output: `appended §6 re-declares`. If an `assert` fires, the source file changed — stop and report (do not edit the anchors by hand).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node tests/workmate-history.test.js`
Expected: `33 passed, 0 failed`.

Run: `npm test`
Expected: every existing suite green — in particular `tests/workmate-requests.test.js` and `tests/workmate-requests-office.test.js` still read 0085/0086 unchanged.

- [ ] **Step 6: Stop — no commit.** Report to the controller.

---

### Task 5: Acceptance script, permissions fence, docs and `npm test`

**Files:**
- Create: `supabase/tests/1b_acceptance.sql`
- Modify: `tests/workmate-history.test.js` (insert tests above the marker)
- Modify: `package.json` (CRLF) — append the new test to `scripts.test`
- Modify: `supabase/migrations/README.md` (CRLF) — next number 0091 + a 0090 paragraph
- Modify: `docs/DATABASE_SCHEMA.md` (CRLF) — §13 gains the 0090 tables, columns and RPCs

**Interfaces:**
- Consumes: every function from Tasks 1–4 (exact signatures below).
- Produces: `supabase/tests/1b_acceptance.sql` — run by the controller/user in Task 6; ends with the row `1b acceptance: all checks passed`.

- [ ] **Step 1: Add the failing tests**

Insert above the marker in `tests/workmate-history.test.js`:

```js
const GRANTED_0090 = [
  // worker
  'pr_history_search(text, text, text, uuid, date, date, integer, integer)', 'pr_history_item(uuid, uuid)',
  'pr_history_visible(uuid[])', 'pr_submit_request(uuid, jsonb)',
  // storage-policy helpers
  'pr_can_read_gallery_path(text)', 'pr_office_gallery_path_ok(text)',
  // office
  'pr_office_save_item(uuid, text, text, text, text, text, boolean, text[], text)', 'pr_office_set_allow_history(uuid, boolean)',
  'pr_office_history_search(text, text, text, uuid, date, date, integer, integer)', 'pr_office_history_item(uuid, uuid)',
  'pr_office_add_ref(uuid, uuid, uuid, text, date, text, text)', 'pr_office_retire_ref(uuid, text)', 'pr_office_photo_queue()',
  'pr_office_publish_photo(uuid, text, boolean, boolean)', 'pr_office_keep_private(uuid)',
  'pr_office_add_gallery_photo(uuid, text, boolean, boolean, uuid)', 'pr_office_set_cover(uuid)',
  'pr_office_retire_photo(uuid, text)', 'pr_office_catalog()', 'pr_office_projects()'];
const INTERNAL_0090 = [
  'pr_history_open(uuid, uuid)', 'pr_history_entries(uuid, uuid, boolean, uuid)', 'pr_entry_label(text, boolean)',
  'pr_history_search_doc(uuid, uuid, boolean, text, text, text, uuid, date, date, integer, integer)',
  'pr_history_item_doc(uuid, uuid, boolean, uuid, uuid)', 'pr_clean_aliases(text[])', 'pr_gallery_check_path(uuid, uuid, text)',
  'pr_gallery_ensure_cover(uuid, uuid)', 'pr_ref_label(text, uuid)', 'pr_request_doc(uuid, boolean)'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('every function in 0090 has exactly one permission decision', () => {
  const count = [...CODE.matchAll(/create or replace function\s+(\w+)\s*\(/gi)].length;
  assert(count === GRANTED_0090.length + INTERNAL_0090.length,
    'expected ' + (GRANTED_0090.length + INTERNAL_0090.length) + ' functions, found ' + count);
  for (const sig of GRANTED_0090) {
    assert(new RegExp('revoke all on function ' + esc(sig) + ' from public, anon;').test(CODE), 'no revoke for ' + sig);
    assert(new RegExp('grant execute on function ' + esc(sig) + ' to authenticated;').test(CODE), 'no grant for ' + sig);
  }
  for (const sig of INTERNAL_0090) {
    assert(new RegExp('revoke all on function ' + esc(sig) + ' from public, anon, authenticated;').test(CODE), 'not internal: ' + sig);
    assert(!new RegExp('grant execute on function ' + esc(sig)).test(CODE), 'internal function granted: ' + sig);
  }
});

test('nothing in 0090 is granted to anon or public', () => {
  assert(!/grant [^;]* to (anon|public)\b/i.test(CODE), 'a grant to anon/public');
});

test('the acceptance script exists, is self-rolling-back and editor-safe', () => {
  const t = read('supabase/tests/1b_acceptance.sql');
  assert(t.length > 0, 'missing supabase/tests/1b_acceptance.sql');
  assert(/^begin;$/m.test(t) && /rollback;\s*$/.test(t), 'begin … rollback');
  assert(!/create temp/i.test(t), 'no temp tables (the SQL editor breaks them)');
  assert(t.includes("'1b acceptance: all checks passed'"), 'success row');
});

test('package.json runs this suite', () => {
  assert(read('package.json').includes('node tests/workmate-history.test.js'), 'npm test does not run workmate-history');
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node tests/workmate-history.test.js`
Expected: "the acceptance script exists…" and "package.json runs this suite" FAIL; the permission tests PASS already if Tasks 1–4 are complete (they are a fence, not new behaviour); exit 1.

- [ ] **Step 3: Create `supabase/tests/1b_acceptance.sql`**

Create the file (LF) with exactly this content:

````sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 1b-1 acceptance — item history server (migration 0090).
--
-- Wraps itself in begin / rollback: nothing persists. Builds its own
-- throwaway projects, items, requests, references and gallery rows (names
-- start "ZZ 1b") and checks only what it built. Editor-safe: context lives
-- in transaction-local settings (set_config 'v1b.*'), never a temp table.
-- Dry run with 0090:  begin;  <0090>  <this file>  (its own begin only
-- warns; its rollback undoes the migration too).
--
-- Accounts: W-0007 and W-0019 (active workers of one owner), an active
-- staff account of that owner, and another owner account.
-- A failed check aborts with its message; success ends with the row
-- '1b acceptance: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 0. Throwaway data (as the database owner) ──
do $$
declare
  v_w7 uuid; v_w19 uuid; v_owner uuid; v_staff uuid; v_other uuid;
  v_on uuid; v_aw uuid; v_off uuid; v_done uuid; v_oth_p uuid;
  v_item uuid; v_item2 uuid; v_bare uuid; v_old uuid; v_oth_item uuid;
  v_batch uuid; v_r_on uuid; v_r_off uuid; v_r_mine uuid;
  v_l_on uuid; v_l_cx uuid; v_l_free uuid; v_l_off uuid; v_l_mine uuid;
  v_ref_on uuid; v_ref_off uuid; v_ref_ret uuid; v_ref_done uuid; v_ref_oth uuid;
  v_ph1 uuid; v_ph2 uuid; v_g_appr uuid; v_g_ret uuid;
  v_p_appr text; v_p_ret text; v_p_oth text; v_p_unrec text; v_p_new text; v_p_rq1 text; v_p_rq2 text;
begin
  select id into v_w7  from profiles where worker_no = 7  and role = 'worker' and coalesce(status, 'active') = 'active';
  select id into v_w19 from profiles where worker_no = 19 and role = 'worker' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null and v_w19 is not null, 'W-0007 and W-0019 must exist as active workers';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select coalesce(owner_id, id) from profiles where id = v_w19) = v_owner, 'W-0007 and W-0019 must share one owner';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  select id into v_other from profiles where role = 'owner' and id <> v_owner limit 1;
  assert v_staff is not null and v_other is not null, 'need an active staff account of that owner and another owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1b history on') returning id into v_on;
  insert into folders (owner_id, name, parent_folder_id) values (v_owner, 'ZZ 1b AW', v_on) returning id into v_aw;
  insert into folders (owner_id, name) values (v_owner, 'ZZ 1b history off') returning id into v_off;
  insert into folders (owner_id, name, completed_at) values (v_owner, 'ZZ 1b done', now()) returning id into v_done;
  insert into folders (owner_id, name) values (v_other, 'ZZ 1b other company') returning id into v_oth_p;
  insert into pr_project_settings (folder_id, owner_id, allow_requests, allow_history) values
    (v_on, v_owner, true, true), (v_off, v_owner, true, false), (v_done, v_owner, false, true), (v_oth_p, v_other, true, true);

  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, aliases, brand)
  values (v_owner, 'material', 'ZZ 1b outlet', '2-gang', 'pc', 'electrical', '{saksakan}', 'ZZBrand') returning id into v_item;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1b elbow', '1/2 in', 'pc', 'plumbing') returning id into v_item2;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1b bare', '', 'pc', 'misc') returning id into v_bare;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category, active)
  values (v_owner, 'material', 'ZZ 1b old pipe', '3 in', 'length', 'plumbing', false) returning id into v_old;
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_other, 'material', 'ZZ 1b outlet', '2-gang', 'pc', 'electrical') returning id into v_oth_item;

  v_batch := pr_batch_for(v_owner, now());
  -- W-0019 on the history-on project's Additional Works: live, cancelled and unmatched lines.
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_w19, v_on, v_aw, gen_random_uuid()) returning id into v_r_on;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit, notes)
  values (v_owner, v_r_on, 0, 'material', v_item, 'outlet po', 'pc', 'ZZPRIVATENOTE') returning id into v_l_on;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit, status)
  values (v_owner, v_r_on, 1, 'material', v_item, 'outlet ulit', 'pc', 'cancelled') returning id into v_l_cx;
  insert into pr_lines (owner_id, request_id, position, kind, description, unit)
  values (v_owner, v_r_on, 2, 'material', 'yung malaking pako', 'pc') returning id into v_l_free;
  -- W-0019 on the history-off project.
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_w19, v_off, v_off, gen_random_uuid()) returning id into v_r_off;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit)
  values (v_owner, v_r_off, 0, 'material', v_item, 'outlet', 'pc') returning id into v_l_off;
  -- W-0007's own line on the history-off project, for an item no longer listed.
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_w7, v_off, v_off, gen_random_uuid()) returning id into v_r_mine;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit)
  values (v_owner, v_r_mine, 0, 'material', v_old, 'old pipe', 'length') returning id into v_l_mine;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values
    (v_owner, v_l_on, v_batch, 6), (v_owner, v_l_cx, v_batch, 2), (v_owner, v_l_free, v_batch, 1),
    (v_owner, v_l_off, v_batch, 3), (v_owner, v_l_mine, v_batch, 1);

  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision, source_note, created_by)
  values (v_owner, v_item, v_on, v_aw, 'Outlet used in the AW kitchen', '2026-08-01', 'approximate', 'from an old Messenger photo', v_owner)
  returning id into v_ref_on;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision, created_by)
  values (v_owner, v_item, v_off, v_off, 'Outlet on the history-off site', '2026-07-15', 'exact', v_owner) returning id into v_ref_off;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, date_precision, created_by,
                            retired_at, retired_by, retire_reason)
  values (v_owner, v_item, v_on, v_on, 'Wrongly entered', 'unknown', v_owner, now(), v_owner, 'wrong item') returning id into v_ref_ret;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, date_precision, created_by)
  values (v_owner, v_item, v_done, v_done, 'Outlet on the finished job', 'unknown', v_owner) returning id into v_ref_done;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision, created_by)
  values (v_other, v_oth_item, v_oth_p, v_oth_p, 'Other company outlet', '2026-06-01', 'exact', v_other) returning id into v_ref_oth;

  v_p_appr  := v_owner || '/' || v_item || '/' || gen_random_uuid() || '.jpg';
  v_p_ret   := v_owner || '/' || v_item || '/' || gen_random_uuid() || '.jpg';
  v_p_unrec := v_owner || '/' || v_item || '/' || gen_random_uuid() || '.jpg';
  v_p_new   := v_owner || '/' || v_item || '/' || gen_random_uuid() || '.jpg';
  v_p_oth   := v_other || '/' || v_oth_item || '/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name, owner) values
    ('item-gallery', v_p_appr, v_owner), ('item-gallery', v_p_ret, v_owner),
    ('item-gallery', v_p_unrec, v_owner), ('item-gallery', v_p_oth, v_other);
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, is_cover, checklist_confirmed, approved_by)
  values (v_owner, v_item, v_p_appr, 'upload', true, true, v_owner) returning id into v_g_appr;
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, is_cover, status, checklist_confirmed, approved_by,
                                 retired_at, retired_by, retire_reason)
  values (v_owner, v_item, v_p_ret, 'upload', false, 'retired', true, v_owner, now(), v_owner, 'shows a price') returning id into v_g_ret;
  insert into pr_gallery_photos (owner_id, catalog_item_id, storage_path, source, is_cover, checklist_confirmed, approved_by)
  values (v_other, v_oth_item, v_p_oth, 'upload', true, true, v_other);

  v_p_rq1 := v_w19 || '/' || v_r_on || '/' || gen_random_uuid() || '.jpg';
  v_p_rq2 := v_w19 || '/' || v_r_on || '/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name, owner) values ('request-photos', v_p_rq1, v_w19), ('request-photos', v_p_rq2, v_w19);
  insert into pr_photos (owner_id, request_id, line_id, storage_path, uploaded_by) values (v_owner, v_r_on, v_l_on, v_p_rq1, v_w19)
  returning id into v_ph1;
  insert into pr_photos (owner_id, request_id, line_id, storage_path, uploaded_by) values (v_owner, v_r_on, v_l_on, v_p_rq2, v_w19)
  returning id into v_ph2;

  perform set_config('v1b.w7', v_w7::text, true);       perform set_config('v1b.w19', v_w19::text, true);
  perform set_config('v1b.owner', v_owner::text, true); perform set_config('v1b.staff', v_staff::text, true);
  perform set_config('v1b.other', v_other::text, true);
  perform set_config('v1b.on', v_on::text, true);       perform set_config('v1b.aw', v_aw::text, true);
  perform set_config('v1b.off', v_off::text, true);     perform set_config('v1b.done', v_done::text, true);
  perform set_config('v1b.oth_p', v_oth_p::text, true);
  perform set_config('v1b.item', v_item::text, true);   perform set_config('v1b.item2', v_item2::text, true);
  perform set_config('v1b.bare', v_bare::text, true);   perform set_config('v1b.old', v_old::text, true);
  perform set_config('v1b.oth_item', v_oth_item::text, true);
  perform set_config('v1b.l_on', v_l_on::text, true);   perform set_config('v1b.l_cx', v_l_cx::text, true);
  perform set_config('v1b.l_off', v_l_off::text, true); perform set_config('v1b.l_mine', v_l_mine::text, true);
  perform set_config('v1b.ref_on', v_ref_on::text, true);     perform set_config('v1b.ref_off', v_ref_off::text, true);
  perform set_config('v1b.ref_ret', v_ref_ret::text, true);   perform set_config('v1b.ref_done', v_ref_done::text, true);
  perform set_config('v1b.ref_oth', v_ref_oth::text, true);
  perform set_config('v1b.ph1', v_ph1::text, true);     perform set_config('v1b.ph2', v_ph2::text, true);
  perform set_config('v1b.g_appr', v_g_appr::text, true); perform set_config('v1b.g_ret', v_g_ret::text, true);
  perform set_config('v1b.p_appr', v_p_appr, true);     perform set_config('v1b.p_ret', v_p_ret, true);
  perform set_config('v1b.p_unrec', v_p_unrec, true);   perform set_config('v1b.p_new', v_p_new, true);
  perform set_config('v1b.p_oth', v_p_oth, true);
end $$;

-- ── 1. W-0007: search, detail, cleanup, storage and direct access ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb; v_keys text[]; v_e jsonb;
  v_item uuid := current_setting('v1b.item')::uuid;
  v_old uuid := current_setting('v1b.old')::uuid;
begin
  v := pr_history_search('ZZ 1b');
  assert (select array_agg((i ->> 'id')::uuid order by i ->> 'name') from jsonb_array_elements(v -> 'items') i
           where i ->> 'name' like 'ZZ 1b%') = array[v_old, v_item],
    'W-0007 finds only the old pipe (own request) and the outlet: ' || v::text;
  assert not exists (select 1 from jsonb_array_elements(v -> 'items') i
                      where i -> 'latest' ->> 'project_name' = 'ZZ 1b history off' and (i ->> 'id')::uuid = v_item),
    'the outlet''s latest entry never comes from the history-off project';
  assert (select count(*) from jsonb_array_elements(pr_history_search('saksakan') -> 'items') i where (i ->> 'id')::uuid = v_item) = 1, 'alias search';
  assert (select count(*) from jsonb_array_elements(pr_history_search('zzbrand') -> 'items') i where (i ->> 'id')::uuid = v_item) = 1, 'brand search';
  assert not exists (select 1 from jsonb_array_elements(pr_history_search('ZZ%1b') -> 'items') i where i ->> 'name' like 'ZZ 1b%'),
    '% is matched literally, not as a wildcard';
  assert not exists (select 1 from jsonb_array_elements(pr_history_search('ZZ 1b', 'tool') -> 'items') i where i ->> 'name' like 'ZZ 1b%'),
    'kind filter';
  v := pr_history_search('ZZ 1b', null, null, current_setting('v1b.off')::uuid);
  assert (select array_agg((i ->> 'id')::uuid) from jsonb_array_elements(v -> 'items') i where i ->> 'name' like 'ZZ 1b%') = array[v_old],
    'project filter on the history-off project: only the own line';
  v := pr_history_search('ZZ 1b', null, null, null, '2026-07-31', '2026-08-02');
  assert (select array_agg((i ->> 'id')::uuid) from jsonb_array_elements(v -> 'items') i where i ->> 'name' like 'ZZ 1b%') = array[v_item]
     and (select i -> 'latest' ->> 'date_precision' from jsonb_array_elements(v -> 'items') i where (i ->> 'id')::uuid = v_item) = 'approximate',
    'date filter finds the approximate August reference';
  v := pr_history_search('ZZ 1b', null, null, null, null, null, 1, 0);
  assert jsonb_array_length(v -> 'items') = 1 and (v ->> 'has_more')::boolean, 'pagination: one item and more to come';

  v := pr_history_item(v_item);
  v_keys := array(select (e ->> 'entry_kind') || ':' || (e ->> 'entry_id') from jsonb_array_elements(v -> 'entries') e order by 1);
  assert v_keys = array(select unnest(array['request_line:' || current_setting('v1b.l_on'), 'request_line:' || current_setting('v1b.l_cx'),
                                            'reference:' || current_setting('v1b.ref_on'), 'reference:' || current_setting('v1b.ref_done')]) order by 1),
    'W-0007 sees exactly the history-on lines and the live references on switched-on projects: ' || array_to_string(v_keys, ', ');
  select e into v_e from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.l_on');
  assert v_e ->> 'label' = 'Requested' and (v_e ->> 'quantity')::numeric = 6 and v_e ->> 'work_name' = 'ZZ 1b AW'
     and v_e ->> 'project_name' = 'ZZ 1b history on', 'live line: ' || v_e::text;
  select e into v_e from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.l_cx');
  assert v_e ->> 'label' = 'Requested — cancelled' and v_e -> 'quantity' = 'null'::jsonb, 'cancelled line: ' || v_e::text;
  select e into v_e from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.ref_on');
  assert v_e ->> 'label' = 'Historical reference' and v_e ->> 'date_precision' = 'approximate'
     and v_e ->> 'note' = 'from an old Messenger photo', 'reference: ' || v_e::text;
  select e into v_e from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.ref_done');
  assert v_e ->> 'date_precision' = 'unknown' and v_e -> 'date' = 'null'::jsonb and v_e ->> 'project_name' = 'ZZ 1b done',
    'a completed project keeps its history: ' || v_e::text;
  assert v::text not like '%ZZPRIVATENOTE%', 'line notes never reach a worker';
  assert not exists (select 1 from jsonb_array_elements(v -> 'entries') e where e ->> 'requester_name' is not null), 'no requester names';
  assert (select array_agg((p ->> 'id')::uuid) from jsonb_array_elements(v -> 'photos') p) = array[current_setting('v1b.g_appr')::uuid],
    'only the approved photo, never the retired one';
  assert v::text !~* '"[a-z_]*(price|amount|cost|peso)[a-z_]*"\s*:', 'no money keys';

  begin perform pr_history_item(current_setting('v1b.oth_item')::uuid); assert false, 'saw another company''s item';
  exception when others then assert sqlerrm = 'HISTORY_NOT_AVAILABLE', 'other company: ' || sqlerrm; end;
  begin perform pr_history_item(current_setting('v1b.item2')::uuid); assert false, 'saw an item with no visible history';
  exception when others then assert sqlerrm = 'HISTORY_NOT_AVAILABLE', 'no history: ' || sqlerrm; end;
  v := pr_history_item(v_old);
  assert (v ->> 'active')::boolean = false and jsonb_array_length(v -> 'entries') = 1
     and v -> 'entries' -> 0 ->> 'entry_id' = current_setting('v1b.l_mine'), 'own request on a history-off project: ' || v::text;

  v := pr_history_visible(array[v_item, v_old, current_setting('v1b.oth_item')::uuid, current_setting('v1b.item2')::uuid]);
  assert jsonb_array_length(v) = 2, 'cleanup keeps exactly two items: ' || v::text;
  select x into v_e from jsonb_array_elements(v) x where (x ->> 'item_id')::uuid = v_item;
  assert jsonb_array_length(v_e -> 'entries') = 4 and v_e -> 'photo_ids' = jsonb_build_array(current_setting('v1b.g_appr')), 'cleanup detail: ' || v_e::text;
  begin perform pr_history_visible(array(select gen_random_uuid() from generate_series(1, 501))); assert false, '501 items accepted';
  exception when others then assert sqlerrm = 'TOO_MANY_ITEMS', 'cap: ' || sqlerrm; end;

  assert (select count(*) from storage.objects where bucket_id = 'item-gallery'
           and name in (current_setting('v1b.p_appr'), current_setting('v1b.p_ret'), current_setting('v1b.p_unrec'), current_setting('v1b.p_oth'))) = 1,
    'a worker reads only the approved photo';
  assert (select count(*) from pr_item_refs) = 0 and (select count(*) from pr_gallery_photos) = 0, 'no direct reads of the new tables';
  begin
    insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, date_precision, created_by)
    values (current_setting('v1b.owner')::uuid, v_item, current_setting('v1b.on')::uuid, current_setting('v1b.on')::uuid, 'x', 'unknown', auth.uid());
    assert false, 'a worker inserted a reference';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('item-gallery', current_setting('v1b.owner') || '/' || v_item || '/' || gen_random_uuid() || '.jpg', auth.uid());
    assert false, 'a worker uploaded to the gallery';
  exception when insufficient_privilege then null; end;
  begin perform pr_office_history_search('ZZ'); assert false, 'a worker used an office RPC';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'office RPC: ' || sqlerrm; end;
end $$;

-- ── 2. Switching history off: per-entry cleanup; own requests stay ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.owner'), 'role', 'authenticated')::text, true);
do $$
declare p jsonb;
begin
  perform pr_office_set_allow_history(current_setting('v1b.on')::uuid, false);
  select x into p from jsonb_array_elements(pr_office_projects()) x where (x ->> 'folder_id') = current_setting('v1b.on');
  assert (p ->> 'allow_history')::boolean = false and (p ->> 'allow_requests')::boolean = true,
    'the history switch never touches Allow requests: ' || p::text;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.w7'), 'role', 'authenticated')::text, true);
do $$
declare v jsonb;
begin
  v := pr_history_visible(array[current_setting('v1b.item')::uuid]);
  assert jsonb_array_length(v) = 1 and v -> 0 -> 'entries' = jsonb_build_array('reference:' || current_setting('v1b.ref_done')),
    'only the finished project''s entry stays; the switched-off project''s entries go: ' || v::text;
  assert (select count(*) from storage.objects where bucket_id = 'item-gallery' and name = current_setting('v1b.p_appr')) = 1,
    'the photo stays readable while the item is visible through another project';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.w19'), 'role', 'authenticated')::text, true);
do $$
declare v_keys text[];
begin
  v_keys := array(select (e ->> 'entry_kind') || ':' || (e ->> 'entry_id')
                    from jsonb_array_elements(pr_history_item(current_setting('v1b.item')::uuid) -> 'entries') e order by 1);
  assert v_keys = array(select unnest(array['request_line:' || current_setting('v1b.l_on'), 'request_line:' || current_setting('v1b.l_cx'),
                                            'request_line:' || current_setting('v1b.l_off'), 'reference:' || current_setting('v1b.ref_done')]) order by 1),
    'W-0019 keeps their own lines on switched-off projects, and only those: ' || array_to_string(v_keys, ', ');
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.owner'), 'role', 'authenticated')::text, true);
select pr_office_set_allow_history(current_setting('v1b.on')::uuid, true);

-- ── 3. Request Again (W-0007) ──
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_on uuid := current_setting('v1b.on')::uuid;
  v_item uuid := current_setting('v1b.item')::uuid;
  v jsonb; v2 jsonb;
  bad jsonb;
begin
  -- a: a visible entry is kept as the link; the retry returns the first answer
  v := pr_submit_request('00000000-0000-4000-8000-00000001b301', jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 2,
                            'catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_on')))));
  v2 := pr_submit_request('00000000-0000-4000-8000-00000001b301', jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 2,
                            'catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_on')))));
  assert v = v2, 'a retried Request Again returns the first answer';
  perform set_config('v1b.req_a', v ->> 'request_id', true);
  perform set_config('v1b.line_a', v -> 'line_ids' ->> 0, true);
  -- b: a real entry W-0007 cannot see (W-0019's line on the history-off project) → saved, link dropped
  v := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 1,
                            'catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_off')))));
  perform set_config('v1b.line_b', v -> 'line_ids' ->> 0, true);
  -- c: a real entry of ANOTHER item (re-matched case) → saved, link dropped
  v := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b elbow', 'unit', 'pc', 'quantity', 1,
                            'catalog_item_id', current_setting('v1b.item2'), 'ref_kind', 'reference', 'ref_id', current_setting('v1b.ref_on')))));
  perform set_config('v1b.line_c', v -> 'line_ids' ->> 0, true);
  -- e: no link at all (Stage 1a behaviour)
  v := pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
         jsonb_build_object('kind', 'material', 'description', 'ZZ 1b outlet', 'unit', 'pc', 'quantity', 1, 'catalog_item_id', v_item))));
  perform set_config('v1b.line_e', v -> 'line_ids' ->> 0, true);
  -- d: malformed or unknown links are refused
  foreach bad in array array[
      jsonb_build_object('catalog_item_id', v_item, 'ref_kind', 'bogus', 'ref_id', current_setting('v1b.l_on')),
      jsonb_build_object('catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', 'not-a-uuid'),
      jsonb_build_object('catalog_item_id', v_item, 'ref_kind', 'request_line', 'ref_id', gen_random_uuid()),
      jsonb_build_object('ref_kind', 'request_line', 'ref_id', current_setting('v1b.l_on')),
      jsonb_build_object('catalog_item_id', v_item, 'ref_id', current_setting('v1b.l_on')),
      jsonb_build_object('catalog_item_id', v_item, 'ref_kind', 'reference', 'ref_id', current_setting('v1b.ref_oth'))] loop
    begin
      perform pr_submit_request(gen_random_uuid(), jsonb_build_object('folder_id', v_on, 'lines', jsonb_build_array(
                jsonb_build_object('kind', 'material', 'description', 'ZZ 1b bad link', 'unit', 'pc', 'quantity', 1) || bad)));
      assert false, 'a bad link was accepted: ' || bad::text;
    exception when others then assert sqlerrm = 'BAD_REFERENCE', 'bad link ' || bad::text || ': ' || sqlerrm; end;
  end loop;
end $$;

reset role;
do $$
begin
  assert (select ref_kind = 'request_line' and ref_id = current_setting('v1b.l_on')::uuid from pr_lines where id = current_setting('v1b.line_a')::uuid),
    'a: the link is stored';
  assert (select ref_kind is null and ref_id is null from pr_lines where id = current_setting('v1b.line_b')::uuid), 'b: invisible entry dropped';
  assert (select ref_kind is null and ref_id is null from pr_lines where id = current_setting('v1b.line_c')::uuid), 'c: other item''s entry dropped';
  assert (select ref_kind is null from pr_lines where id = current_setting('v1b.line_e')::uuid), 'e: plain line';
  assert (select count(*) from pr_requests where client_op_id = '00000000-0000-4000-8000-00000001b301') = 1, 'one request for the retried op';
  assert (select l ->> 'ref_label' from jsonb_array_elements(pr_request_doc(current_setting('v1b.req_a')::uuid, false) -> 'lines') l)
           = 'ZZ 1b history on · ZZ 1b AW · ' || to_char(now() at time zone 'Asia/Manila', 'FMMon FMDD, YYYY') || ' · Requested',
    'the office sees the source as a readable label';
end $$;

-- ── 4. The office (owner, then staff, then another company) ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.owner'), 'role', 'authenticated')::text, true);
do $$
declare
  v jsonb; v_e jsonb; v_id uuid; v_new uuid;
  v_item uuid := current_setting('v1b.item')::uuid;
begin
  v := pr_office_history_search('ZZ 1b');
  assert (select count(*) from jsonb_array_elements(v -> 'items') i
           where (i ->> 'id')::uuid in (v_item, current_setting('v1b.item2')::uuid, current_setting('v1b.bare')::uuid, current_setting('v1b.old')::uuid)) = 4
     and not exists (select 1 from jsonb_array_elements(v -> 'items') i where (i ->> 'id')::uuid = current_setting('v1b.oth_item')::uuid),
    'the office finds all its own items, even with no history, and never another company''s';
  assert not exists (select 1 from jsonb_array_elements(pr_office_history_search('ZZ 1b', null, null, current_setting('v1b.off')::uuid) -> 'items') i
                      where (i ->> 'id')::uuid = current_setting('v1b.bare')::uuid), 'a project filter drops items with no history';

  v := pr_office_history_item(v_item);
  assert (select count(*) from jsonb_array_elements(v -> 'entries') e
           where e ->> 'entry_id' in (current_setting('v1b.l_off'), current_setting('v1b.ref_off'), current_setting('v1b.ref_ret'))) = 3,
    'the office sees switched-off and retired entries';
  assert (select (e ->> 'retired')::boolean from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.ref_ret')),
    'a retired reference is flagged';
  assert (select e ->> 'requester_name' from jsonb_array_elements(v -> 'entries') e where e ->> 'entry_id' = current_setting('v1b.l_on')) is not null,
    'the office sees who requested';
  assert (select p ->> 'retire_reason' from jsonb_array_elements(v -> 'photos') p where (p ->> 'id') = current_setting('v1b.g_ret')) = 'shows a price',
    'retired photos stay visible to the office with the reason';
  begin perform pr_office_history_item(current_setting('v1b.oth_item')::uuid); assert false, 'office saw another company''s item';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'other company item: ' || sqlerrm; end;

  -- historical references
  begin perform pr_office_add_ref(v_item, current_setting('v1b.on')::uuid, null, 'x', '2026-08-01', 'unknown', ''); assert false, 'unknown with a date';
  exception when others then assert sqlerrm = 'BAD_REFERENCE', 'unknown+date: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.on')::uuid, null, 'x', null, 'approximate', ''); assert false, 'approximate without a date';
  exception when others then assert sqlerrm = 'BAD_REFERENCE', 'approx no date: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.on')::uuid, null, '  ', null, 'unknown', ''); assert false, 'blank description';
  exception when others then assert sqlerrm = 'BAD_REFERENCE', 'blank: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.off')::uuid, current_setting('v1b.aw')::uuid, 'x', null, 'unknown', ''); assert false, 'AW of another project';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'wrong parent: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.aw')::uuid, null, 'x', null, 'unknown', ''); assert false, 'an AW as the project';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'AW as project: ' || sqlerrm; end;
  begin perform pr_office_add_ref(v_item, current_setting('v1b.oth_p')::uuid, null, 'x', null, 'unknown', ''); assert false, 'another company''s project';
  exception when others then assert sqlerrm = 'BAD_DESTINATION', 'other company project: ' || sqlerrm; end;
  v_id := (pr_office_add_ref(v_item, current_setting('v1b.done')::uuid, null, 'Seeded after the job', '2026-05-10', 'exact', 'site diary') ->> 'id')::uuid;
  begin perform pr_office_retire_ref(v_id, ' '); assert false, 'retired without a reason';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'retire reason: ' || sqlerrm; end;
  perform pr_office_retire_ref(v_id, 'test');
  perform pr_office_retire_ref(v_id, 'again');
  assert (select retire_reason from pr_item_refs where id = v_id) = 'test', 'retiring twice keeps the first record';

  -- photo review queue
  v := pr_office_photo_queue();
  assert (select count(*) from jsonb_array_elements(v) q where q ->> 'photo_id' in (current_setting('v1b.ph1'), current_setting('v1b.ph2'))) = 2
     and (select q -> 'item' ->> 'id' from jsonb_array_elements(v) q where q ->> 'photo_id' = current_setting('v1b.ph1')) = v_item::text,
    'both private photos wait for review, with their item';

  -- office upload policy: own item path yes, another company's path no
  insert into storage.objects (bucket_id, name, owner) values ('item-gallery', current_setting('v1b.p_new'), auth.uid());
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('item-gallery', current_setting('v1b.other') || '/' || current_setting('v1b.oth_item') || '/' || gen_random_uuid() || '.jpg', auth.uid());
    assert false, 'office uploaded under another company';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from storage.objects where bucket_id = 'item-gallery' and name = current_setting('v1b.p_ret')) = 1,
    'the office can still open a retired photo';

  -- publish a reviewed copy
  begin perform pr_office_publish_photo(current_setting('v1b.ph1')::uuid, current_setting('v1b.p_new'), false); assert false, 'no checklist';
  exception when others then assert sqlerrm = 'CHECKLIST_REQUIRED', 'checklist: ' || sqlerrm; end;
  begin perform pr_office_publish_photo(current_setting('v1b.ph1')::uuid,
          current_setting('v1b.owner') || '/' || current_setting('v1b.item2') || '/' || gen_random_uuid() || '.jpg', true); assert false, 'wrong item path';
  exception when others then assert sqlerrm = 'BAD_PATH', 'wrong path: ' || sqlerrm; end;
  begin perform pr_office_publish_photo(current_setting('v1b.ph1')::uuid,
          current_setting('v1b.owner') || '/' || v_item || '/' || gen_random_uuid() || '.jpg', true); assert false, 'no file';
  exception when others then assert sqlerrm = 'FILE_MISSING', 'missing file: ' || sqlerrm; end;
  v := pr_office_publish_photo(current_setting('v1b.ph1')::uuid, current_setting('v1b.p_new'), true);
  v_new := (v ->> 'id')::uuid;
  assert (v ->> 'is_cover')::boolean = false, 'publishing does not steal the cover unless asked';
  assert (select gallery_review from pr_photos where id = current_setting('v1b.ph1')::uuid) = 'published', 'the photo leaves the queue as published';
  begin perform pr_office_publish_photo(current_setting('v1b.ph1')::uuid, current_setting('v1b.p_unrec'), true); assert false, 'published twice';
  exception when others then assert sqlerrm = 'ALREADY_REVIEWED', 'twice: ' || sqlerrm; end;
  assert (pr_office_keep_private(current_setting('v1b.ph2')::uuid) ->> 'gallery_review') = 'kept_private', 'kept private';
  assert not exists (select 1 from jsonb_array_elements(pr_office_photo_queue()) q
                      where q ->> 'photo_id' in (current_setting('v1b.ph1'), current_setting('v1b.ph2'))), 'reviewed photos leave the queue';

  -- cover and retire
  perform pr_office_set_cover(v_new);
  assert (select array_agg(id) from pr_gallery_photos where catalog_item_id = v_item and is_cover) = array[v_new], 'exactly one cover, the new one';
  begin perform pr_office_retire_photo(v_new, ''); assert false, 'retired without a reason';
  exception when others then assert sqlerrm = 'REASON_REQUIRED', 'photo reason: ' || sqlerrm; end;
  perform pr_office_retire_photo(v_new, 'shows a face');
  assert (select status from pr_gallery_photos where id = v_new) = 'retired'
     and (select array_agg(id) from pr_gallery_photos where catalog_item_id = v_item and is_cover) = array[current_setting('v1b.g_appr')::uuid],
    'retiring the cover hands it to the remaining approved photo';
  begin perform pr_office_set_cover(current_setting('v1b.g_ret')::uuid); assert false, 'a retired photo became cover';
  exception when others then assert sqlerrm = 'PHOTO_RETIRED', 'retired cover: ' || sqlerrm; end;

  -- direct upload, for a reference
  begin perform pr_office_add_gallery_photo(v_item, current_setting('v1b.p_unrec'), false); assert false, 'no checklist';
  exception when others then assert sqlerrm = 'CHECKLIST_REQUIRED', 'upload checklist: ' || sqlerrm; end;
  begin perform pr_office_add_gallery_photo(v_item, current_setting('v1b.p_appr'), true); assert false, 'same file twice';
  exception when others then assert sqlerrm = 'ALREADY_IN_GALLERY', 'twice in gallery: ' || sqlerrm; end;
  v := pr_office_add_gallery_photo(v_item, current_setting('v1b.p_unrec'), true, false, current_setting('v1b.ref_on')::uuid);
  assert (select source from pr_gallery_photos where id = (v ->> 'id')::uuid) = 'reference', 'a photo for a reference';

  -- catalogue: the old 7-argument call still saves and leaves aliases/brand alone
  perform pr_office_save_item(p_item => v_item, p_kind => 'material', p_name => 'ZZ 1b outlet', p_spec => '2-gang',
                              p_unit => 'pc', p_category => 'electrical', p_active => true);
  assert (select aliases = '{saksakan}' and brand = 'ZZBrand' from pr_catalog_items where id = v_item), 'old call shape keeps aliases and brand';
  perform pr_office_save_item(p_item => v_item, p_kind => 'material', p_name => 'ZZ 1b outlet', p_spec => '2-gang',
                              p_unit => 'pc', p_category => 'electrical', p_active => true,
                              p_aliases => array[' Plug ', 'plug', '', 'SAKSAKAN'], p_brand => ' Omni ');
  assert (select array(select lower(a) from unnest(aliases) a order by 1) = array['plug', 'saksakan'] and brand = 'Omni'
            from pr_catalog_items where id = v_item), 'aliases cleaned, brand trimmed';
  begin
    perform pr_office_save_item(p_item => v_item, p_kind => 'material', p_name => 'ZZ 1b outlet', p_spec => '2-gang',
                                p_unit => 'pc', p_category => 'electrical', p_active => true,
                                p_aliases => array(select 'alias ' || g from generate_series(1, 21) g));
    assert false, '21 aliases accepted';
  exception when others then assert sqlerrm = 'BAD_ITEM', 'alias cap: ' || sqlerrm; end;
  assert (select c ->> 'brand' from jsonb_array_elements(pr_office_catalog()) c where (c ->> 'id')::uuid = v_item) = 'Omni', 'catalogue shows the brand';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (pr_office_history_item(current_setting('v1b.item')::uuid) ->> 'id') = current_setting('v1b.item'), 'staff use the office RPCs';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1b.other'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform pr_office_history_item(current_setting('v1b.item')::uuid); assert false, 'another company read the item';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'other owner item: ' || sqlerrm; end;
  begin perform pr_office_add_ref(current_setting('v1b.item')::uuid, current_setting('v1b.on')::uuid, null, 'x', null, 'unknown', ''); assert false, 'another company added a reference';
  exception when others then assert sqlerrm = 'NOT_FOUND', 'other owner ref: ' || sqlerrm; end;
  assert (select count(*) from storage.objects where bucket_id = 'item-gallery' and name = current_setting('v1b.p_appr')) = 0,
    'another company cannot open the photo';
end $$;

-- ── 5. Signed out ──
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
do $$
begin
  begin perform pr_history_search('x'); assert false, 'anon searched';
  exception when insufficient_privilege then null; end;
  begin perform pr_office_history_search('x'); assert false, 'anon used an office RPC';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from pr_item_refs; assert false, 'anon read references';
  exception when insufficient_privilege then null; end;
end $$;

-- ── 6. Permissions and shape (database owner) ──
reset role;
do $$
declare f text;
begin
  foreach f in array array['pr_history_open(uuid,uuid)', 'pr_history_entries(uuid,uuid,boolean,uuid)', 'pr_entry_label(text,boolean)',
      'pr_history_search_doc(uuid,uuid,boolean,text,text,text,uuid,date,date,integer,integer)', 'pr_history_item_doc(uuid,uuid,boolean,uuid,uuid)',
      'pr_clean_aliases(text[])', 'pr_gallery_check_path(uuid,uuid,text)', 'pr_gallery_ensure_cover(uuid,uuid)', 'pr_ref_label(text,uuid)',
      'pr_request_doc(uuid,boolean)'] loop
    assert not has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' must be internal';
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' must not be callable by anon';
  end loop;
  foreach f in array array['pr_history_search(text,text,text,uuid,date,date,integer,integer)', 'pr_history_item(uuid,uuid)',
      'pr_history_visible(uuid[])', 'pr_submit_request(uuid,jsonb)', 'pr_can_read_gallery_path(text)', 'pr_office_gallery_path_ok(text)',
      'pr_office_save_item(uuid,text,text,text,text,text,boolean,text[],text)', 'pr_office_set_allow_history(uuid,boolean)',
      'pr_office_history_search(text,text,text,uuid,date,date,integer,integer)', 'pr_office_history_item(uuid,uuid)',
      'pr_office_add_ref(uuid,uuid,uuid,text,date,text,text)', 'pr_office_retire_ref(uuid,text)', 'pr_office_photo_queue()',
      'pr_office_publish_photo(uuid,text,boolean,boolean)', 'pr_office_keep_private(uuid)',
      'pr_office_add_gallery_photo(uuid,text,boolean,boolean,uuid)', 'pr_office_set_cover(uuid)', 'pr_office_retire_photo(uuid,text)',
      'pr_office_catalog()', 'pr_office_projects()'] loop
    assert has_function_privilege('authenticated', 'public.' || f, 'execute'), f || ' must be callable when signed in';
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f || ' must not be callable by anon';
  end loop;
  assert to_regprocedure('public.pr_office_save_item(uuid,text,text,text,text,text,boolean)') is null, 'the 7-argument save_item is gone';
  assert not has_table_privilege('anon', 'public.pr_item_refs', 'select') and not has_table_privilege('anon', 'public.pr_gallery_photos', 'select'),
    'anon reads neither new table';
  assert not has_table_privilege('authenticated', 'public.pr_item_refs', 'insert')
     and not has_table_privilege('authenticated', 'public.pr_item_refs', 'update')
     and not has_table_privilege('authenticated', 'public.pr_item_refs', 'delete')
     and not has_table_privilege('authenticated', 'public.pr_gallery_photos', 'insert')
     and not has_table_privilege('authenticated', 'public.pr_gallery_photos', 'update')
     and not has_table_privilege('authenticated', 'public.pr_gallery_photos', 'delete'), 'no direct writes to the new tables';
  assert (select public = false from storage.buckets where id = 'item-gallery'), 'item-gallery is private';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name like 'pr\_%' and column_name ~* '(price|amount|cost|peso)'),
    'no pr_ table has a money column';
end $$;

select '1b acceptance: all checks passed' as result;

rollback;
````

- [ ] **Step 4: Append the suite to `npm test`**

`package.json` is **CRLF**. With Python, replace the substring `node tests/receipt-print-popups.test.js"` with `node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js"` (exactly one occurrence), writing with `newline=''` so CRLF is kept. Then:

Run: `git diff --stat -- package.json`
Expected: `1 file changed, 1 insertion(+), 1 deletion(-)`.

- [ ] **Step 5: Docs (both CRLF — edit with Python `newline=''` or the Edit tool, keep `\r\n`)**

`supabase/migrations/README.md`:
- In the "Next number" bullet change `(**0090** — highest on disk is` → `(**0091** — highest on disk is` and `` `0089_receipt_storage.sql`) `` → `` `0090_workmate_item_history.sql`) ``.
- After the **0089** paragraph add:

```markdown
**0090 (WorkMate Stage 1b-1 — item history server)** adds Find Previous Item: `pr_project_settings.allow_history` (per project, off by default, independent of Allow requests, kept after completion), catalogue `aliases`/`brand` (search aids, not identity), `pr_lines.ref_kind/ref_id` (Request Again link), `pr_photos.gallery_review*`, the tables `pr_item_refs` (hand-entered historical references; retired, never deleted; cascade with their project) and `pr_gallery_photos` (reviewed copies in the private `item-gallery` bucket, several per item, one cover), worker RPCs `pr_history_search/item/visible`, twelve office RPCs, and re-declares `pr_submit_request`, `pr_request_doc`, `pr_office_catalog`, `pr_office_projects` by adding lines only; `pr_office_save_item` gains two optional arguments (the 7-argument form is dropped; the old call shape still works). One function, `pr_history_entries`, decides per entry what a worker may see. No money. Dry-run with `supabase/tests/1b_acceptance.sql` (self-wrapped in begin/rollback, editor-safe), then re-run `1a_acceptance.sql`.
```

`docs/DATABASE_SCHEMA.md`, section `## 13. WorkMate Requests`:
- In the table rows: `pr_catalog_items` — append `; 0090: \`aliases\` text[] and \`brand\` (search aids, not identity)`. `pr_project_settings` — append `; 0090: \`allow_history\` (Find Previous Item, off by default, independent of allow_requests, survives completion)`. `pr_lines` — append `; 0090: \`ref_kind\`/\`ref_id\` = the history entry a Request Again line came from (both or neither)`. `pr_photos` — append `; 0090: \`gallery_review\` published / kept_private + who/when`.
- Add two rows after `pr_photos`:

```markdown
| `pr_item_refs` (0090) | Hand-entered **historical references**: item, project + Main Contract/AW, description, `ref_date` + `date_precision` exact/approximate/unknown, `source_note`. No expense, stock or purchase. Retired with a reason, never deleted; cascade with their project |
| `pr_gallery_photos` (0090) | Reviewed product photos in private bucket **`item-gallery`** (`<owner>/<item>/<uuid>.jpg`): source upload / request_photo (a COPY) / reference, `checklist_confirmed`, one approved `is_cover` per item, approved/retired with who, when, why |
```

- Before `## Relationship map` add:

```markdown
### Item history (0090)

Who sees what is decided in one place, `pr_history_entries(owner, viewer, office, item)`: a worker sees a request line matched to a catalogue item when it is **their own** or its project has **Allow item history** on, and a **non-retired** reference on such a project; Additional Works follow their parent. Workers never get requester names, line notes, raw request photos or retired items.

| RPC | Who | What it does |
|---|---|---|
| `pr_history_search(query, kind, category, folder, from, to, limit, offset)` | worker | Item cards with cover and latest visible entry; 30 per page (max 50) + `has_more` |
| `pr_history_item(item, folder)` | worker | Photos + dated entries (Requested / Requested — cancelled / Historical reference); `HISTORY_NOT_AVAILABLE` if none visible |
| `pr_history_visible(items[])` | worker | For each still-visible saved item: visible entry keys + approved photo ids (phone deletes the rest); max 500 |
| `pr_submit_request` (re-declared) | worker | Lines may carry `ref_kind/ref_id`: malformed or unknown → `BAD_REFERENCE`; no longer visible or now another item → saved without the link |
| `pr_office_set_allow_history`, `pr_office_history_search/item` | office | Switch; search including items with no history; detail with requester names and retired rows |
| `pr_office_add_ref`, `pr_office_retire_ref` | office | Reference on a project or its own AW; retire needs a reason |
| `pr_office_photo_queue`, `pr_office_publish_photo`, `pr_office_keep_private` | office | Review private request photos on matched lines; publishing records an already-uploaded COPY after the checklist |
| `pr_office_add_gallery_photo`, `pr_office_set_cover`, `pr_office_retire_photo` | office | Direct uploads (optionally for a reference), cover, retire with reason (cover passes to the newest approved) |
```

- [ ] **Step 6: Run everything**

Run: `node tests/workmate-history.test.js`
Expected: `37 passed, 0 failed`.

Run: `npm test`
Expected: all suites pass, including `workmate-history`; money `239 passed`.

Run: `file supabase/migrations/README.md docs/DATABASE_SCHEMA.md package.json`
Expected: each reports `with CRLF line terminators`.

- [ ] **Step 7: Stop — no commit.** Report to the controller.

---

### Task 6: Dry run, apply, live verification (controller + user)

No implementer. The controller prepares files and verifies; **the user** runs DDL in the Supabase SQL editor (MCP refuses DDL).

- [ ] **Step 1: Build the dry-run file**

With Python (bytes, no BOM, LF): `Downloads\0090_dry_run.sql` = `b'begin;\n\n' + migration.rstrip(b'\n') + b'\n\n' + acceptance`. Check: starts with `begin;`, contains no `\r`, no BOM.

- [ ] **Step 2: User dry run**

The user pastes `0090_dry_run.sql` into the SQL editor and runs it.
Expected: a single result row `1b acceptance: all checks passed` (the acceptance's own `rollback` undoes the migration too). Any error message names the failed check — fix in the files, rebuild, repeat.

- [ ] **Step 3: User applies 0090**

The user pastes `supabase/migrations/0090_workmate_item_history.sql` alone and runs it. Expected: "Success. No rows returned".

- [ ] **Step 4: Verify live (controller, MCP `execute_sql`, read-only)**

```sql
select
  (select count(*) from information_schema.columns where table_schema = 'public'
     and (table_name, column_name) in (('pr_project_settings','allow_history'), ('pr_catalog_items','aliases'), ('pr_catalog_items','brand'),
                                       ('pr_lines','ref_kind'), ('pr_lines','ref_id'), ('pr_photos','gallery_review'))) as cols,          -- 6
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('pr_history_entries','pr_history_search','pr_history_item','pr_history_visible',
          'pr_office_publish_photo','pr_office_add_ref','pr_ref_label')) as fns,                                                         -- 7
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pr_office_save_item') as save_item_versions,                                          -- 1
  to_regclass('public.pr_item_refs') is not null and to_regclass('public.pr_gallery_photos') is not null as tables,                  -- true
  (select public from storage.buckets where id = 'item-gallery') as bucket_public;                                                   -- false
```

Expected: `cols 6, fns 7, save_item_versions 1, tables true, bucket_public false`. If not, the apply did not land (memory: verify-user-applied-migrations) — ask the user to re-run.

- [ ] **Step 5: Live acceptance (controller, MCP `execute_sql`)**

Run `supabase/tests/1b_acceptance.sql` through MCP `execute_sql` (DML only; self-rolling-back). Expected: `1b acceptance: all checks passed`.
Then run `supabase/tests/1a_acceptance.sql` the same way. Expected: `1a acceptance: all checks passed` — proves the re-declared `pr_submit_request` and office views still behave as in Stage 1a.

- [ ] **Step 6: Close out**

`npm test` green; append "Execution notes" to this plan (rulings, deviations, live results); update memory `workmate-requests-0085.md` (1b-1 live; next 1b-2 Dacs Web office screens) and its `MEMORY.md` line. Tell the user to commit and push Dacs Web. **Deploy order:** 0090 is backward compatible (app 0.4.0 and today's Dacs Web keep working), so the push may follow the apply at any time.

---

## Execution notes (2026-10-09)

- Executed subagent-driven on `main`, no worktree, nothing committed by the agent (the user commits). Tasks 1–4 were transcribed byte-for-byte (controller verified each against the plan / a pre-checked scratch build); every task review was clean (no Critical/Important).
- Final whole-change review (opus): "Ready to dry-run". One fix wave folded in before the apply: pair checks (`gallery_reviewed_by`, `retired_by`), `pr_lines_catalog_item` index, catalogue-item locks changed to `FOR NO KEY UPDATE` (a worker's submit never waits on a photo action), `set_cover`/`retire_photo` re-read status after the item lock (race fix, no new lock order), new columns `pr_gallery_photos.cover_set_by/cover_set_at` (spec §4.2 who/when; spec updated), `pr_ref_label` fallback "Source no longer available", stronger acceptance (positive latest + cover_path, split storage checks incl. a no-history item, two-line Request Again per-line reset, cover who/when), docs. The scoped re-review found a flaky acceptance check (`ref_done.created_at = now()` tied with the request lines; random uuid tie-break) → `ref_done` backdated one day.
- Deviation from the plan text: the migration is 1,134 lines (plan ≈1,120) and the static suite has 38 tests (plan 37) because of the fix wave.
- Dry run (user, SQL editor): "1b acceptance: all checks passed"; rollback confirmed. Applied by the user 2026-10-09 16:28. Live verify (MCP): all columns, tables, index, functions, private bucket and 3 storage policies present; one `pr_office_save_item`; live `pr_submit_request` body equals the file. `1a_acceptance.sql` and `1b_acceptance.sql` both pass live (MCP `execute_sql`).
- The "other company" in the acceptance is the live sub-owner account (the only other owner); it is a separate company for office checks (`data_owner_id()` = own id).
- Deferred (later plans): reference text length caps; cancelled-source label wording in `pr_ref_label`; `cover_set_by/at` means "last made cover"; 1b-2's reference form should warn staff not to type prices or names (free text reaches workers).
- Next: plan 1b-2 (Dacs Web office screens: Projects switch, Catalogue aliases/brand, Item history tab, photo review), then 1b-3 seeding, 1b-4 app 0.5.0 + pilot.
