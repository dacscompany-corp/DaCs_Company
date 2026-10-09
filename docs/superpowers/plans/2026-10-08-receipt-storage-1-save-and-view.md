# Receipt Photos to File Storage — Plan 1: Safe Saving + Every Viewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New expense and payroll receipt photos are saved as files in the private `uploads` bucket, never inside database rows. Split entries save all-or-nothing, a retried save can never duplicate, and every screen and print window shows both old (inline) and new (file) photos.

**Architecture:**
- **Migration 0089** adds:
  - tenant-locked storage rules for two new folders (`expenseReceipts/`, `payrollReceipts/`);
  - an upload ledger (`receipt_uploads`), plus a trigger that marks a file `attached` when a row references it;
  - a `client_submission_id` column with a unique index for duplicate-proof saves.
- **A new `js/receipt-storage.js`** does the photo work: compress to a Blob, upload with no overwrite, return the public-format URL, and sign photo links inside HTML for separate print windows.
- **The shim gains `CollectionRef.addMany()`**, one bulk insert, which is atomic.
- **`expenses-module.js`'s four save paths** use these instead of base64. Its two print popups sign their photo links before writing.

**Tech Stack:** Supabase Postgres (plpgsql, RLS, storage policies), supabase-js v2 (CDN), vanilla JS (no build step), node zero-dependency tests (`npm test`).

**Spec:** `docs/superpowers/specs/2026-10-08-receipt-photos-storage-design.md` (phases A and B). Plans 2 (move tool) and 3 (cleanup) follow.

## Global Constraints

- **No commits or pushes by Claude** — the user commits. **Never run `npm run build`.**
- **Migrations:** next number **0089**. Never reuse. Never make SQL-editor-only changes. MCP DDL is declined, so the user applies the file. Self-rolling-back verify scripts are run by Claude through MCP `execute_sql`, never the Supabase SQL editor: its RLS prompt breaks temp tables (42P01).
- **Storage path:** `<expenseReceipts|payrollReceipts>/<owner_id>/<yyyy-mm>/<uuid>.jpg` — local month, a lowercase uuid from `crypto.randomUUID()`, **`upsert:false`**, `contentType:'image/jpeg'`.
- **What the row stores:** the public-format URL `…/storage/v1/object/public/uploads/<path>` returned by `getPublicUrl`.
- **Access:** owner and staff of the owning company only — segment 2 = `data_owner_id()`. Workers, clients and partners: never.
- **New-photo processing (unchanged):** max 900 px, JPEG quality 0.75.
- **Money:** no amount, split, priority, cover-expense or contract logic changes. `npm test` (the money suite) must stay green.
- **Every viewer accepts both formats** (`data:` and file URL) — no switch-over moment.
- **Failure behaviour:**
  - a failed upload or save keeps the form filled and its attachments, shows a clear message, and lets the user press Save again;
  - a retry reuses already-uploaded files and the same submission id;
  - photos never fall back to base64.
- **Popups:** a window opened with `window.open('', …)` must be opened **synchronously in the click** (pop-up blockers); signing happens after it opens.
- **Line endings:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are CRLF — edit them byte-safely and check with `file`. `js/admin.js` is CRLF in git. New files are LF.

## File map

| File | Change | Responsibility |
|---|---|---|
| `supabase/migrations/0089_receipt_storage.sql` | Create | Storage rules (tenant-locked folders), `receipt_uploads` ledger + RLS, attach trigger, `client_submission_id` + unique index |
| `supabase/tests/0089_verify.sql` | Create | Self-rolling-back live checks (run via MCP) |
| `tests/storage-access.test.js` | Modify | Classify the two new folders (`tenant`) |
| `js/supabase-config.js` | Modify | `CollectionRef.addMany(rows)` |
| `tests/shim-addmany.test.js` | Create | Guards `addMany` |
| `js/receipt-storage.js` | Create | `window.DacsReceipts` helpers |
| `tests/receipt-storage.test.js` | Create | Helper unit tests + 0089 static checks |
| `js/expenses-module.js` | Modify | Four save paths, `_uploadReceiptFile`, `_saveRowsOnce`, two print popups; remove `compressImageToBase64` |
| `tests/receipt-save-paths.test.js` | Create | Static fences on the save paths and popups |
| `admin.html` | Modify | `<script src="js/receipt-storage.js">` before `expenses-module.js`; bump `expenses-module.js?v=` |
| `package.json` | Modify | Add the three new test files to `npm test` |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` | Modify | 0089 note; `receipt_uploads` table + new columns |

---

### Task 1: Migration 0089 — storage rules, upload ledger, attach trigger, submission index

**Files:**
- Create: `supabase/migrations/0089_receipt_storage.sql`
- Create: `supabase/tests/0089_verify.sql`
- Modify: `tests/storage-access.test.js:64-76` (the `FOLDERS` map) and section III
- Modify: `supabase/migrations/README.md` (0089 paragraph after the 0088 one; "Next number" → **0090**, highest file `0089_receipt_storage.sql`) — CRLF
- Modify: `docs/DATABASE_SCHEMA.md` (expenses/payroll sections: `client_submission_id`; new `receipt_uploads` section) — CRLF

**Interfaces:**
- Produces:
  - table `public.receipt_uploads(path text pk, owner_id uuid, kind text, uploaded_by uuid, state text, created_at, attached_at, deleted_at)`;
  - columns `expenses.client_submission_id uuid` and `payroll.client_submission_id uuid`;
  - unique indexes `expenses_client_submission_uniq` and `payroll_client_submission_uniq` on `(client_submission_id, coalesce(split_index, 1)) where client_submission_id is not null`;
  - function `public.receipt_paths_of(text[]) returns text[]`.

- [ ] **Step 1: Write the failing static test.** In `tests/storage-access.test.js`:
  - add to `FOLDERS`: `expenseReceipts: 'tenant', payrollReceipts: 'tenant',`;
  - add this test at the end of section II, before `console.log('\nIII. …')`:

```js
test('receipt folders are tenant-locked (0089): owner/staff of THAT company only', () => {
  const r = lastFn('uploads_can_read');
  const w = lastFn('uploads_can_write');
  const RULE = "v_folder in ('expenseReceipts', 'payrollReceipts') then\n    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;";
  ok(r.includes(RULE), 'read rule for receipt folders missing or reshaped');
  ok(w.includes(RULE), 'write rule for receipt folders missing or reshaped');
  // Must run BEFORE the generic owner/staff grant, or any company's staff could read them.
  ok(r.indexOf("'expenseReceipts'") < r.indexOf('if is_owner() or is_staff() then return true'), 'read: tenant rule must precede the generic owner/staff rule');
  ok(w.indexOf("'expenseReceipts'") < w.indexOf('if is_owner() or is_staff() then return true'), 'write: tenant rule must precede the generic owner/staff rule');
  const sql = allRules();
  const upd = sql.slice(sql.lastIndexOf('create policy "uploads_admin_update"'));
  ok(upd.includes("split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')") && upd.includes("split_part(name, '/', 2) = data_owner_id()::text"),
    'overwrite policy is not tenant-locked for receipt folders');
});
```

- [ ] **Step 2: Run it to see it fail.** Run `node tests/storage-access.test.js`. Expected: the new test FAILS with "read rule for receipt folders missing or reshaped"; all existing tests pass.

- [ ] **Step 3: Write `supabase/migrations/0089_receipt_storage.sql`.** Bodies of `uploads_can_read` / `uploads_can_write` are copied from 0081 **verbatim** except for the new branch marked `-- 0089`.

```sql
-- ════════════════════════════════════════════════════════════════════
-- 0089 — Receipt photos as files (spec docs/superpowers/specs/
-- 2026-10-08-receipt-photos-storage-design.md, plan 1).
--
-- ── WHY. Expense/payroll receipt photos are inline base64 in the rows
--    (~15 MB, growing daily); that froze Project Control on 2026-10-03.
--    New photos go to the private `uploads` bucket instead; the row keeps
--    the public-FORMAT URL (supabase-config.js §11b signs it on use).
--
-- ── WHAT.
--    1. Folders expenseReceipts/ and payrollReceipts/: read, write and
--       overwrite only by owner/staff of THAT company (path segment 2 =
--       data_owner_id()). 0081 let owner/staff of ANY company read generic
--       folders; these two are tenant-locked.
--    2. receipt_uploads: one row per uploaded file (pending → attached),
--       so plan 3's cleanup can remove files whose save never happened.
--    3. A trigger marks a file 'attached' in the same transaction as the
--       expenses/payroll row that references it.
--    4. client_submission_id + unique index: a retried save can never
--       create a second copy of an expense or payroll entry.
--
-- ── SAFE. No data changes. New column is nullable; existing rows untouched.
--    Grants: functions keep 0081's (authenticated only, not anon).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Storage rules ─────────────────────────────────────────────────
create or replace function public.uploads_can_read(p_name text, p_owner_id text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_pid    uuid := dacs_try_uuid(split_part(p_name, '/', 2));
begin
  if v_uid is null then return false; end if;

  -- The uploader can always read back their own file.
  if p_owner_id is not null and p_owner_id = v_uid::text then return true; end if;

  -- Owner-only modules (quotations 0045, reimbursements 0041).
  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  -- Owner and staff: everything else (staff encode receipts from here).
  if is_owner() or is_staff() then return true; end if;

  -- Construction client / partner: files filed under THEIR project. Same
  -- test as the weekly_bills _client_read / _partner_read policies.
  if v_folder in ('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms') then
    return v_pid is not null
       and (cproj_client_can_read(v_pid) or cproj_partner_can_read(v_pid));
  end if;

  -- Employee agreement PDF: every non-owner admin role (staff, worker,
  -- teamLeader) signs it at first login in admin.html (js/admin.js).
  if v_folder = 'employeeTermsGlobal' then return coalesce(is_worker(), false); end if;

  -- Agreement templates shown at the client/partner signing gates.
  -- coalesce: a profile with a NULL role must not be denied (NOT NULL = NULL).
  if v_folder = 'agreementDocs' then return not coalesce(is_worker(), false); end if;

  return false;
end $$;

create or replace function public.uploads_can_write(p_name text)
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_folder text := split_part(p_name, '/', 1);
  v_seg2   text := split_part(p_name, '/', 2);
begin
  if v_uid is null then return false; end if;

  if v_folder in ('quotations', 'reimbursementReceipts') then return is_owner(); end if;

  -- 0089: expense/payroll receipts — owner/staff of THAT company only.
  if v_folder in ('expenseReceipts', 'payrollReceipts') then
    return (is_owner() or is_staff()) and split_part(p_name, '/', 2) = data_owner_id()::text;
  end if;

  if is_owner() or is_staff() then return true; end if;
  -- Signatures. Clients/partners (js/client-management-app.js):
  --   signatures/<uid>_<ts>.png  and  signatures/proj_<project>_<uid>_<ts>.png
  -- Workers/team leaders (employee agreement gate, js/admin.js):
  --   signatures/employee_<uid>_<ts>.png  only
  if v_folder = 'signatures' then
    if coalesce(is_worker(), false) then
      return p_name ~ ('^signatures/employee_' || v_uid::text || '_[0-9]+\.png$');
    end if;
    return p_name ~ ('^signatures/(proj_[0-9a-f-]{36}_)?' || v_uid::text || '_[0-9]+\.png$');
  end if;
  --   signed-terms/<uid>/<ts>_<name>.pdf   (dacsSnapshotPdf, every signing gate)
  if v_folder = 'signed-terms'  then return v_seg2 = v_uid::text; end if;

  -- Workers and team leaders upload nothing else.
  if coalesce(is_worker(), false) then return false; end if;
  --   procurementReceipts/<project>/…  (client "bought by client" receipt; clients only,
  --   partners are read-only, same as the procurement_client_update table policy)
  if v_folder = 'procurementReceipts' then
    return dacs_try_uuid(v_seg2) is not null and cproj_client_can_read(dacs_try_uuid(v_seg2));
  end if;

  return false;
end $$;

revoke all on function public.uploads_can_read(text, text) from public;
revoke all on function public.uploads_can_write(text) from public;
revoke all on function public.uploads_can_read(text, text) from anon;
revoke all on function public.uploads_can_write(text) from anon;
grant execute on function public.uploads_can_read(text, text) to authenticated;
grant execute on function public.uploads_can_write(text) to authenticated;

-- Overwrite (0081's shape) + the receipt folders tenant-locked. New receipt
-- uploads use upsert:false and never overwrite; this closes the door anyway.
drop policy if exists "uploads_admin_update" on storage.objects;
create policy "uploads_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end)
  with check (bucket_id = 'uploads' and
         case when split_part(name, '/', 1) in ('quotations', 'reimbursementReceipts') then is_owner()
              when split_part(name, '/', 1) in ('expenseReceipts', 'payrollReceipts')
                then (is_owner() or is_staff()) and split_part(name, '/', 2) = data_owner_id()::text
              else (is_owner() or is_staff()) end);

-- ── 2. Upload ledger ─────────────────────────────────────────────────
create table if not exists public.receipt_uploads (
  path        text primary key
              check (path ~ '^(expenseReceipts|payrollReceipts)/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.jpg$'),
  owner_id    uuid not null references public.profiles(id),
  kind        text not null check (kind in ('expense', 'payroll')),
  uploaded_by uuid not null default auth.uid() references public.profiles(id),
  state       text not null default 'pending' check (state in ('pending', 'attached', 'migrated', 'deleted')),
  created_at  timestamptz not null default now(),
  attached_at timestamptz,
  deleted_at  timestamptz
);
create index if not exists receipt_uploads_pending_idx on public.receipt_uploads (created_at) where state = 'pending';
alter table public.receipt_uploads enable row level security;

drop policy if exists receipt_uploads_insert on public.receipt_uploads;
create policy receipt_uploads_insert on public.receipt_uploads
  for insert to authenticated
  with check ((is_owner() or is_staff())
              and owner_id = data_owner_id()
              and uploaded_by = auth.uid()
              and state = 'pending'
              and split_part(path, '/', 2) = owner_id::text
              and split_part(path, '/', 1) = case kind when 'expense' then 'expenseReceipts' else 'payrollReceipts' end);
drop policy if exists receipt_uploads_select on public.receipt_uploads;
create policy receipt_uploads_select on public.receipt_uploads
  for select to authenticated
  using (can_access(owner_id));
-- No update/delete policies: state changes only through the trigger below
-- (and, in plans 2–3, owner/service functions).

-- ── 3. Attach trigger ────────────────────────────────────────────────
-- Storage paths named by a list of photo values ('data:' values are skipped).
create or replace function public.receipt_paths_of(p_values text[]) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(substring(v from '/storage/v1/object/public/uploads/([^?#]+)')), '{}')
    from unnest(p_values) v
   where v like '%/storage/v1/object/public/uploads/%'
$$;

create or replace function public.receipt_mark_attached() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_vals text[];
begin
  if tg_table_name = 'expenses' then
    v_vals := array[new.po_image_url, new.delivery_receipt_url, new.supplier_invoice_url, new.payment_receipt_url];
  else
    select coalesce(array_agg(x), '{}') into v_vals
      from jsonb_array_elements_text(case when jsonb_typeof(new.receipt_images) = 'array'
                                          then new.receipt_images else '[]'::jsonb end) x;
  end if;
  update receipt_uploads
     set state = 'attached', attached_at = now()
   where state = 'pending' and path = any (receipt_paths_of(v_vals));
  return null;
end $$;
revoke all on function public.receipt_mark_attached() from public;

drop trigger if exists expenses_receipt_attach on public.expenses;
create trigger expenses_receipt_attach
  after insert or update of po_image_url, delivery_receipt_url, supplier_invoice_url, payment_receipt_url
  on public.expenses for each row execute function public.receipt_mark_attached();
drop trigger if exists payroll_receipt_attach on public.payroll;
create trigger payroll_receipt_attach
  after insert or update of receipt_images
  on public.payroll for each row execute function public.receipt_mark_attached();

-- ── 4. Duplicate-proof saving ────────────────────────────────────────
alter table public.expenses add column if not exists client_submission_id uuid;
alter table public.payroll  add column if not exists client_submission_id uuid;
create unique index if not exists expenses_client_submission_uniq
  on public.expenses (client_submission_id, coalesce(split_index, 1)) where client_submission_id is not null;
create unique index if not exists payroll_client_submission_uniq
  on public.payroll (client_submission_id, coalesce(split_index, 1)) where client_submission_id is not null;
```

- [ ] **Step 4: Run the static tests.** Run `node tests/storage-access.test.js`. Expected: all pass, including the new test. Then run `npm test`. Expected: all suites pass (nothing else reads 0089 yet).

- [ ] **Step 5: Write `supabase/tests/0089_verify.sql`** (self-rolling-back; Claude runs it via MCP `execute_sql`). Accounts:
  - the owner: profile `role = 'owner'` whose id = `coalesce(owner_id, id)` of W-0007;
  - the staff account of that owner;
  - W-0007;
  - another owner (any `role = 'owner'` with a different data owner, e.g. the PM sub-owner).

```sql
-- 0089 receipt storage — live checks. Wraps itself in begin/rollback.
-- Run through MCP execute_sql (NOT the SQL editor: its RLS prompt breaks temp tables).
-- Success ends with the row '0089 verify: all checks passed'.
begin;
create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

do $$
declare v_w7 uuid; v_owner uuid; v_staff uuid; v_other uuid; v_path text; v_path2 text;
begin
  select id into v_w7 from profiles where worker_no = 7 and role = 'worker';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  select id into v_other from profiles where role = 'owner' and id <> v_owner limit 1;
  assert v_w7 is not null and v_owner is not null and v_staff is not null and v_other is not null, 'need W-0007, its owner, a staff account and another owner';
  v_path  := 'expenseReceipts/' || v_owner || '/2026-10/' || gen_random_uuid() || '.jpg';
  v_path2 := 'payrollReceipts/' || v_owner || '/2026-10/' || gen_random_uuid() || '.jpg';
  insert into t_ctx values ('w7', v_w7), ('owner', v_owner), ('staff', v_staff), ('other', v_other), ('path', v_path), ('path2', v_path2);
end $$;

-- ── 1. Storage rules per role ──
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'owner'), 'role', 'authenticated')::text, true);
do $$ begin
  assert uploads_can_read((select v from t_ctx where k = 'path'), null), 'owner reads own company receipt';
  assert uploads_can_write((select v from t_ctx where k = 'path')), 'owner writes own company receipt';
  assert not uploads_can_write('expenseReceipts/' || gen_random_uuid() || '/2026-10/' || gen_random_uuid() || '.jpg'), 'owner cannot write under another company';
  insert into receipt_uploads (path, owner_id, kind) values ((select v from t_ctx where k = 'path'), (select v::uuid from t_ctx where k = 'owner'), 'expense');
  insert into receipt_uploads (path, owner_id, kind) values ((select v from t_ctx where k = 'path2'), (select v::uuid from t_ctx where k = 'owner'), 'payroll');
  begin
    insert into receipt_uploads (path, owner_id, kind) values ('payrollReceipts/' || (select v from t_ctx where k = 'owner') || '/2026-10/' || gen_random_uuid() || '.jpg', (select v::uuid from t_ctx where k = 'owner'), 'expense');
    assert false, 'ledger accepted a kind/folder mismatch';
  exception when check_violation or insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'staff'), 'role', 'authenticated')::text, true);
do $$ begin
  assert uploads_can_read((select v from t_ctx where k = 'path'), null), 'staff reads own company receipt';
  assert uploads_can_write((select v from t_ctx where k = 'path')), 'staff writes own company receipt';
  assert (select count(*) from receipt_uploads where path in ((select v from t_ctx where k = 'path'), (select v from t_ctx where k = 'path2'))) = 2, 'staff sees the company ledger';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'w7'), 'role', 'authenticated')::text, true);
do $$ begin
  assert not uploads_can_read((select v from t_ctx where k = 'path'), null), 'a worker cannot read receipts';
  assert not uploads_can_write((select v from t_ctx where k = 'path')), 'a worker cannot upload receipts';
  assert (select count(*) from receipt_uploads) = 0, 'a worker sees no ledger rows';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from t_ctx where k = 'other'), 'role', 'authenticated')::text, true);
do $$ begin
  assert not uploads_can_read((select v from t_ctx where k = 'path'), null), 'another company''s owner cannot read';
  assert not uploads_can_write((select v from t_ctx where k = 'path')), 'another company''s owner cannot write';
end $$;

-- ── 2. Attach trigger + duplicate-proof index (as the database owner) ──
reset role;
do $$
declare v_url text := 'https://x.supabase.co/storage/v1/object/public/uploads/' || (select v from t_ctx where k = 'path');
        v_url2 text := 'https://x.supabase.co/storage/v1/object/public/uploads/' || (select v from t_ctx where k = 'path2');
        v_sub uuid := gen_random_uuid();
        v_owner uuid := (select v::uuid from t_ctx where k = 'owner');
begin
  assert receipt_paths_of(array['data:image/jpeg;base64,AAAA', v_url, null]) = array[(select v from t_ctx where k = 'path')], 'path extraction skips data: and null';
  insert into expenses (owner_id, expense_name, amount, payment_receipt_url, client_submission_id, split_index)
  values (v_owner, 'ZZ 0089 verify', 10, v_url, v_sub, 1);
  assert (select state from receipt_uploads where path = (select v from t_ctx where k = 'path')) = 'attached', 'expense insert attaches its file';
  insert into payroll (owner_id, worker_name, total_salary, receipt_images, client_submission_id)
  values (v_owner, 'ZZ 0089 verify', 10, jsonb_build_array('data:image/jpeg;base64,AAAA', v_url2), gen_random_uuid());
  assert (select state from receipt_uploads where path = (select v from t_ctx where k = 'path2')) = 'attached', 'payroll insert attaches its file';
  begin
    insert into expenses (owner_id, expense_name, amount, client_submission_id, split_index) values (v_owner, 'ZZ dup', 10, v_sub, 1);
    assert false, 'a second row with the same submission and split index was accepted';
  exception when unique_violation then null; end;
  insert into expenses (owner_id, expense_name, amount, client_submission_id, split_index) values (v_owner, 'ZZ split 2', 5, v_sub, 2);
  insert into expenses (owner_id, expense_name, amount) values (v_owner, 'ZZ legacy null', 1), (v_owner, 'ZZ legacy null', 1);
end $$;

select '0089 verify: all checks passed' as result;
rollback;
```

- [ ] **Step 6: Docs.**
  - **README.md (CRLF, edit with Python bytes):** after the 0088 paragraph, add one paragraph — "**0089 (receipt photos as files)** tenant-locks two new upload folders `expenseReceipts/` and `payrollReceipts/` (owner/staff of THAT company only, also for overwrite), adds the `receipt_uploads` ledger with an attach trigger on `expenses`/`payroll`, and adds `client_submission_id` + a unique index so a retried save cannot duplicate. No data changes. Live check: `supabase/tests/0089_verify.sql`, run through MCP `execute_sql`, not the SQL editor." Then change the "Next number" line to **0090**, with highest file `0089_receipt_storage.sql`.
  - **DATABASE_SCHEMA.md (CRLF):**
    - in the expenses and payroll sections, add `client_submission_id uuid — one id per Save press; unique with split_index (0089), so a retry cannot duplicate`;
    - add a `receipt_uploads` section listing the columns and states (`pending → attached`; `migrated` and `deleted` come in plans 2–3).
  - Run `file` on both files: CRLF must be kept.

- [ ] **Step 7: Run all tests.** `npm test` → all suites pass. Stop — no commit.

---

### Task 2: Shim `CollectionRef.addMany()` — one atomic bulk insert

**Files:**
- Modify: `js/supabase-config.js:424-436` (class `CollectionRef`)
- Create: `tests/shim-addmany.test.js`
- Modify: `package.json` (append `&& node tests/shim-addmany.test.js` to `scripts.test`)

**Interfaces:**
- Produces: `db.collection(name).addMany(listOfDocData) → Promise<DocRef[]>`. It makes one `insert(rows, { defaultToNull: false })` call, so all rows commit together or none do. It throws the supabase error unchanged (with `.code`, e.g. `'23505'`). It is not supported for `kv`, `jsonbData` or `children` tables (throws).

- [ ] **Step 1: Write the failing test `tests/shim-addmany.test.js`:**

```js
// ════════════════════════════════════════════════════════════════════
// SHIM addMany() TESTS — run with:  node tests/shim-addmany.test.js
// Zero dependencies. Extracts the REAL CollectionRef / toRow from
// js/supabase-config.js and runs them against an in-memory supabase-js.
//
// WHY: split expenses/payroll used batch.commit(), which writes rows ONE AT
// A TIME — a dropped connection left 1 of 2 split rows saved (wrong totals,
// no error). addMany() is a single insert: all rows or none (spec
// 2026-10-08-receipt-photos-storage-design.md §4.3).
// If a test fails with "SLICE NOT FOUND", update the markers — don't delete it.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-config.js'), 'utf8');

let passed = 0, failed = 0; const failures = []; const pending = [];
function atest(name, fn) { pending.push([name, fn]); }
function ok(c, l) { if (!c) throw new Error(l || 'expected truthy'); }
function slice(start, end) {
  const i = src.indexOf(start); if (i === -1) throw new Error('SLICE NOT FOUND: ' + start);
  const j = src.indexOf(end, i); if (j === -1) throw new Error('SLICE NOT FOUND: end ' + end);
  return src.slice(i, j);
}

const calls = [];
let nextError = null;
const sb = {
  from(table) {
    return {
      insert(rows, opts) {
        calls.push({ table, rows, opts });
        return {
          select() {
            if (nextError) { const e = nextError; nextError = null; return Promise.resolve({ data: null, error: e }); }
            return Promise.resolve({ data: rows.map((r, i) => ({ id: 'id' + i, ...r })), error: null });
          },
        };
      },
    };
  },
};
const code = [
  slice('const camelToSnake', '\n') + '\n',
  slice('function fieldToCol(', '\n') + '\n',
  slice('const SERVER_TS', '\n') + '\n',
  slice('function tsToISO(', '\n}') + '\n}',
  slice('function toRow(cfg, data)', '// row (snake) → doc data'),
  'class Query { constructor(cfg, ctx) { this.cfg = cfg; this.ctx = ctx; } }',
  'class DocRef { constructor(cfg, id, ctx, pre) { this.cfg = cfg; this.id = id; this.ctx = ctx; this._pre = pre; } }',
  slice('class CollectionRef extends Query', 'class DocRef'),
  'return CollectionRef;',
].join('\n');
const CollectionRef = new Function('sb', 'writeChildren', code)(sb, async () => {});
const cfg = { table: 'expenses', rename: { userId: 'owner_id' }, ts: ['createdAt'] };

atest('one insert call carries every row (all-or-nothing)', async () => {
  calls.length = 0;
  const refs = await new CollectionRef(cfg).addMany([
    { userId: 'u1', amount: 7, splitIndex: 1, clientSubmissionId: 's1' },
    { userId: 'u1', amount: 3, splitIndex: 2, clientSubmissionId: 's1' },
  ]);
  ok(calls.length === 1, 'expected exactly one insert, got ' + calls.length);
  ok(calls[0].rows.length === 2, 'both rows in the one insert');
  ok(calls[0].rows[0].owner_id === 'u1' && calls[0].rows[1].client_submission_id === 's1', 'rows mapped to columns');
  ok(calls[0].opts && calls[0].opts.defaultToNull === false, 'missing keys must take column defaults, not null');
  ok(refs.length === 2 && refs[1].id === 'id1', 'returns a DocRef per row');
});
atest('an error is thrown unchanged (code kept for the 23505 retry check)', async () => {
  nextError = { code: '23505', message: 'duplicate key value violates unique constraint "expenses_client_submission_uniq"' };
  let caught = null;
  try { await new CollectionRef(cfg).addMany([{ userId: 'u1', amount: 1 }]); } catch (e) { caught = e; }
  ok(caught && caught.code === '23505', 'error code lost');
});
atest('an empty list does nothing', async () => {
  calls.length = 0;
  const refs = await new CollectionRef(cfg).addMany([]);
  ok(refs.length === 0 && calls.length === 0, 'no insert for an empty list');
});
atest('refuses tables it cannot insert in one statement', async () => {
  for (const bad of [{ table: 'settings', kv: true }, { table: 'milestones', jsonbData: true }, { table: 'x', children: { a: {} } }]) {
    let threw = false;
    try { await new CollectionRef(bad).addMany([{ a: 1 }]); } catch (_) { threw = true; }
    ok(threw, 'addMany accepted ' + bad.table);
  }
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
```

- [ ] **Step 2: Run it to see it fail.** Run `node tests/shim-addmany.test.js`. Expected: FAIL — "addMany is not a function". (The slices assume `const camelToSnake = …` and `function fieldToCol(…)` are one-liners and `const SERVER_TS = Symbol(…)` is on one line, as they are today. If one fails with SLICE NOT FOUND, adjust the marker to the real definition.)

- [ ] **Step 3: Implement.** In `js/supabase-config.js`, inside `class CollectionRef`, after `add(data) { … }`:

```js
  // One INSERT for many rows — a single statement, so all rows commit or none
  // do. batch.commit() writes rows one at a time (a split expense could half-
  // save). defaultToNull:false: a key missing from some rows takes the column
  // default, not NULL. Errors are thrown unchanged (callers read err.code).
  async addMany(list) {
    const c = this.cfg;
    if (c.kv || c.jsonbData || c.children) throw new Error('addMany: not supported for ' + c.table);
    if (!list || !list.length) return [];
    const rows = list.map((data) => {
      const row = toRow(c, data);
      if (this.ctx) row[this.ctx.col] = this.ctx.val;
      return row;
    });
    const { data: ins, error } = await sb.from(c.table).insert(rows, { defaultToNull: false }).select();
    if (error) throw error;
    return ins.map((r) => new DocRef(c, r.id, this.ctx, r));
  }
```

- [ ] **Step 4: Run the tests.** Run `node tests/shim-addmany.test.js` (expected: 4 passed). Then `node --check js/supabase-config.js`. Then add the file to `package.json` `scripts.test` (append `&& node tests/shim-addmany.test.js`), and run `npm test` (expected: all suites pass).

- [ ] **Step 5: Stop — no commit.**

---

### Task 3: `js/receipt-storage.js` — compress, upload, sign

**Files:**
- Create: `js/receipt-storage.js`
- Create: `tests/receipt-storage.test.js`
- Modify: `admin.html` — add `<script src="js/receipt-storage.js?v=20261008a"></script>` immediately **before** the `expenses-module.js` script tag (~line 5392)
- Modify: `package.json` (append `&& node tests/receipt-storage.test.js`)

**Interfaces:**
- Consumes:
  - `window.sbClient` (supabase-js client, `supabase-config.js:26`);
  - `window.dacsMaybeSignUrl(url) → Promise<url>` (`supabase-config.js` §11b: never throws, passes non-stored URLs through).
- Produces `window.DacsReceipts`:
  - `FOLDER` — `{ expense: 'expenseReceipts', payroll: 'payrollReceipts' }`;
  - `newId() → string` — a lowercase uuid;
  - `receiptPath(kind, ownerId, now?, id?) → string`;
  - `isInlinePhoto(v) → boolean` — true for `data:` strings;
  - `storagePathOf(url) → string|null`;
  - `compressToBlob(file, max = 900, quality = 0.75) → Promise<Blob>`;
  - `uploadReceipt(kind, blob, ownerId) → Promise<string>` — inserts the ledger row, then uploads with `upsert:false`, and returns the public-format URL; it throws on any failure;
  - `signHtml(html) → Promise<string>` — every stored-upload URL in the HTML is replaced by a signed link.

- [ ] **Step 1: Write the failing test `tests/receipt-storage.test.js`:**

```js
// ════════════════════════════════════════════════════════════════════
// RECEIPT STORAGE TESTS — run with:  node tests/receipt-storage.test.js
// Zero dependencies. Loads js/receipt-storage.js into a fake browser
// window and checks the helpers that every receipt save and print uses
// (spec docs/superpowers/specs/2026-10-08-receipt-photos-storage-design.md).
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0; const failures = []; const pending = [];
function atest(name, fn) { pending.push([name, fn]); }
function ok(c, l) { if (!c) throw new Error(l || 'expected truthy'); }

const log = [];
let failLedger = false, failUpload = false;
const fakeSb = {
  from(t) { return { insert(row) { log.push(['insert', t, row]); return Promise.resolve({ error: failLedger ? { message: 'ledger down' } : null }); } }; },
  storage: { from(b) { return {
    upload(p, blob, opts) { log.push(['upload', b, p, opts]); return Promise.resolve({ error: failUpload ? { message: 'upload down' } : null }); },
    getPublicUrl(p) { return { data: { publicUrl: 'https://proj.supabase.co/storage/v1/object/public/' + b + '/' + p } }; },
  }; } },
};
const win = {
  sbClient: fakeSb,
  crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
  dacsMaybeSignUrl: async (u) => (/\/object\/public\/uploads\//.test(u) ? u.replace('/object/public/', '/object/sign/') + '?token=t' : u),
};
new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'receipt-storage.js'), 'utf8'))(win);
const R = win.DacsReceipts;
const OWNER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

atest('path: folder / owner / local yyyy-mm / uuid.jpg, matching 0089\'s ledger check', async () => {
  const p = R.receiptPath('payroll', OWNER, new Date(2026, 0, 31, 23, 30), 'ffffffff-0000-4000-8000-000000000001');
  ok(p === 'payrollReceipts/' + OWNER + '/2026-01/ffffffff-0000-4000-8000-000000000001.jpg', p);
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0089_receipt_storage.sql'), 'utf8');
  const re = new RegExp(sql.match(/check \(path ~ '([^']+)'\)/)[1]);
  ok(re.test(R.receiptPath('expense', OWNER)), 'generated path fails the ledger check constraint');
});
atest('path: unknown kind or missing owner throws', async () => {
  let a = false, b = false;
  try { R.receiptPath('bogus', OWNER); } catch (_) { a = true; }
  try { R.receiptPath('expense', ''); } catch (_) { b = true; }
  ok(a && b, 'bad input accepted');
});
atest('isInlinePhoto / storagePathOf', async () => {
  ok(R.isInlinePhoto('data:image/jpeg;base64,AAA') && !R.isInlinePhoto('https://x/y.jpg') && !R.isInlinePhoto(null), 'isInlinePhoto');
  ok(R.storagePathOf('https://p.supabase.co/storage/v1/object/public/uploads/expenseReceipts/a/b.jpg') === 'expenseReceipts/a/b.jpg', 'storagePathOf');
  ok(R.storagePathOf('data:image/jpeg;base64,AAA') === null, 'storagePathOf(data:)');
});
atest('upload: ledger row first, then upload with upsert:false + image/jpeg; returns the public-format URL', async () => {
  log.length = 0;
  const url = await R.uploadReceipt('expense', { size: 1 }, OWNER);
  ok(log[0][0] === 'insert' && log[0][1] === 'receipt_uploads', 'ledger insert must come first');
  ok(log[0][2].owner_id === OWNER && log[0][2].kind === 'expense' && /^expenseReceipts\//.test(log[0][2].path), 'ledger row');
  ok(log[1][0] === 'upload' && log[1][1] === 'uploads' && log[1][2] === log[0][2].path, 'upload to the same path');
  ok(log[1][3].upsert === false && log[1][3].contentType === 'image/jpeg', 'upload options');
  ok(url === 'https://proj.supabase.co/storage/v1/object/public/uploads/' + log[0][2].path, 'returned URL');
});
atest('upload: a ledger failure stops before uploading; an upload failure throws', async () => {
  log.length = 0; failLedger = true;
  let e1 = null; try { await R.uploadReceipt('payroll', {}, OWNER); } catch (e) { e1 = e; }
  failLedger = false;
  ok(e1 && log.length === 1, 'must not upload after a ledger failure');
  failUpload = true;
  let e2 = null; try { await R.uploadReceipt('payroll', {}, OWNER); } catch (e) { e2 = e; }
  failUpload = false;
  ok(e2, 'upload failure swallowed');
});
atest('signHtml signs stored links, leaves data: and other URLs alone', async () => {
  const stored = 'https://proj.supabase.co/storage/v1/object/public/uploads/payrollReceipts/a/2026-10/x.jpg';
  const html = '<img src="' + stored + '"><img src="data:image/jpeg;base64,AAA"><img src="' + stored + '"><a href="https://example.com/a">x</a>';
  const out = await R.signHtml(html);
  ok(!out.includes('/object/public/uploads/'), 'a stored link was left unsigned');
  ok((out.match(/\/object\/sign\/uploads\//g) || []).length === 2, 'both copies signed');
  ok(out.includes('data:image/jpeg;base64,AAA') && out.includes('https://example.com/a'), 'other values changed');
});

(async () => {
  for (const [name, fn] of pending) {
    try { await fn(); passed++; console.log('  ok  ' + name); }
    catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
```

- [ ] **Step 2: Run it to see it fail.** Run `node tests/receipt-storage.test.js`. Expected: FAIL — `ENOENT … receipt-storage.js`.

- [ ] **Step 3: Implement `js/receipt-storage.js`:**

```js
// ════════════════════════════════════════════════════════════════════
// RECEIPT STORAGE — expense / payroll receipt photos as FILES in the private
// `uploads` bucket, never base64 inside the row (spec docs/superpowers/specs/
// 2026-10-08-receipt-photos-storage-design.md). The row stores the public-
// FORMAT URL; supabase-config.js §11b signs it wherever the page shows it.
// Separate print windows don't run §11b, so their HTML goes through signHtml.
// Access (migration 0089): owner/staff of the company in path segment 2 only.
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const FOLDER = { expense: 'expenseReceipts', payroll: 'payrollReceipts' };
  const PUB_RE = /\/storage\/v1\/object\/public\/uploads\/([^?#"'\s<>)]+)/;
  const PUB_RE_G = /https?:\/\/[^"'\s<>)]*\/storage\/v1\/object\/public\/uploads\/[^"'\s<>)]+/g;

  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID().toLowerCase();
    const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // <folder>/<owner>/<yyyy-mm>/<uuid>.jpg — month from LOCAL parts (PH, UTC+8).
  function receiptPath(kind, ownerId, now, id) {
    const folder = FOLDER[kind];
    if (!folder) throw new Error('Unknown receipt kind: ' + kind);
    if (!ownerId) throw new Error('No company account to file the receipt under — sign in again.');
    const d = now || new Date();
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return folder + '/' + String(ownerId).toLowerCase() + '/' + ym + '/' + (id || newId()) + '.jpg';
  }

  function isInlinePhoto(v) { return typeof v === 'string' && v.startsWith('data:'); }
  function storagePathOf(url) {
    const m = String(url || '').match(PUB_RE);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Same processing receipts always had (max 900 px, JPEG 0.75), as a Blob.
  function compressToBlob(file, max, quality) {
    const MAX = max || 900, Q = quality || 0.75;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Couldn’t read the photo file.'));
      reader.onload = (ev) => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not a photo this browser can read.'));
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Couldn’t process the photo.'))), 'image/jpeg', Q);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Ledger row first (so a file can never exist without one), then the file.
  async function uploadReceipt(kind, blob, ownerId) {
    const sb = root.sbClient;
    const path = receiptPath(kind, ownerId);
    const { error: ledgerErr } = await sb.from('receipt_uploads').insert({ path, owner_id: String(ownerId).toLowerCase(), kind });
    if (ledgerErr) throw new Error('Couldn’t register the photo upload: ' + (ledgerErr.message || ledgerErr));
    const { error: upErr } = await sb.storage.from('uploads').upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
    if (upErr) throw new Error('Couldn’t upload the photo: ' + (upErr.message || upErr));
    return sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
  }

  // For window.open('')+document.write popups: sign every stored link first.
  async function signHtml(html) {
    const text = String(html || '');
    const urls = [...new Set(text.match(PUB_RE_G) || [])];
    if (!urls.length) return text;
    const sign = root.dacsMaybeSignUrl || ((u) => Promise.resolve(u));
    const signed = await Promise.all(urls.map((u) => sign(u)));
    let out = text;
    urls.forEach((u, i) => { out = out.split(u).join(signed[i]); });
    return out;
  }

  root.DacsReceipts = { FOLDER, newId, receiptPath, isInlinePhoto, storagePathOf, compressToBlob, uploadReceipt, signHtml };
})(window);
```

- [ ] **Step 4: Run the tests.** Run `node tests/receipt-storage.test.js` (expected: 6 passed) and `node --check js/receipt-storage.js`. Then add the `admin.html` script tag (the exact line: `<script src="js/receipt-storage.js?v=20261008a"></script>`, placed directly above `<script src="js/expenses-module.js?v=…">`) and the `package.json` entry. Run `npm test` (expected: all pass).

- [ ] **Step 5: Stop — no commit.**

---

### Task 4: The four save paths in `expenses-module.js` (money code)

**Files:**
- Modify: `js/expenses-module.js`:
  - remove `compressImageToBase64` (~2718-2741) and add the helpers in its place;
  - `handleAddExpense` (~2782-2837);
  - `handleAddPayroll` (~3159-3188);
  - `handleEditExpense` (~4216-4228);
  - `handleEditPayroll` (~4352-4354);
  - the success branches of both add handlers;
  - bump `admin.html`'s `expenses-module.js?v=` to `20261008a`.
- Create: `tests/receipt-save-paths.test.js`
- Modify: `package.json` (append `&& node tests/receipt-save-paths.test.js`)

**Interfaces:**
- Consumes: `DacsReceipts.compressToBlob`, `DacsReceipts.uploadReceipt`, `DacsReceipts.newId` (Task 3); `db.collection(x).addMany(rows)` (Task 2); `client_submission_id` + the unique indexes named `expenses_client_submission_uniq` / `payroll_client_submission_uniq` (Task 1); `_uid()` (`expenses-module.js:6`).
- Produces (module-level, used by Task 5's tests):
  - `_uploadReceiptFile(kind, file) → Promise<url>`, which caches by `File` object so a retry never re-uploads;
  - `_saveRowsOnce(collection, rows, submissionId) → Promise<'saved'|'already'>`;
  - `let _expSubmissionId` and `let _paySubmissionId`.

- [ ] **Step 1: Write the failing test `tests/receipt-save-paths.test.js`:**

```js
// ════════════════════════════════════════════════════════════════════
// RECEIPT SAVE PATHS — run with:  node tests/receipt-save-paths.test.js
// Zero dependencies. Static fences on js/expenses-module.js (spec
// 2026-10-08-receipt-photos-storage-design.md §4.3–4.4):
//   • the four receipt save paths upload files — never base64 in the row;
//   • add-expense / add-payroll save all split rows in ONE insert (addMany)
//     with a submission id, so a retry can't duplicate;
//   • a failure keeps the form (no reset in the catch);
//   • the two print popups sign photo links before writing the window.
// If a check fails with "SLICE NOT FOUND", update the markers — don't delete it.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'expenses-module.js'), 'utf8');

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, l) { if (!c) throw new Error(l || 'expected truthy'); }
function fn(name) {
  const i = src.indexOf(name);
  if (i === -1) throw new Error('SLICE NOT FOUND: ' + name);
  const next = src.slice(i + name.length).search(/\n(async )?function |\nwindow\.[A-Za-z_]+ = /);
  return src.slice(i, next === -1 ? undefined : i + name.length + next);
}

test('no base64 receipt compression is left in the module', () => {
  ok(!src.includes('compressImageToBase64'), 'compressImageToBase64 still present');
});
test('_uploadReceiptFile uploads through DacsReceipts and caches by file', () => {
  const f = fn('async function _uploadReceiptFile(');
  ok(f.includes('DacsReceipts.compressToBlob(') && f.includes('DacsReceipts.uploadReceipt(kind, blob, _uid())'), 'upload helper');
  ok(f.includes('_receiptUploadCache.get(file)') && f.includes('_receiptUploadCache.set(file, url)'), 'retry must reuse the uploaded file');
});
test('_saveRowsOnce: one addMany; a 23505 on the submission index means "already saved"', () => {
  const f = fn('async function _saveRowsOnce(');
  ok(f.includes('.addMany(rows)'), 'must save with addMany');
  ok(f.includes("err.code === '23505'") && f.includes('client_submission'), 'duplicate check');
  ok(f.includes("where('clientSubmissionId', '==', submissionId)"), 'must confirm the earlier rows exist');
});
for (const [name, kind, idVar] of [['async function handleAddExpense(', 'expense', '_expSubmissionId'], ['async function handleAddPayroll(', 'payroll', '_paySubmissionId']]) {
  test(name + ' uploads files, saves once with a submission id, never batches', () => {
    const f = fn(name);
    ok(f.includes("_uploadReceiptFile('" + kind + "'"), 'no file upload');
    ok(!f.includes('db.batch()') && !f.includes('batch.commit()'), 'still writes rows one at a time');
    ok(f.includes("_saveRowsOnce('" + (kind === 'expense' ? 'expenses' : 'payroll') + "', rows, " + idVar + ')'), 'not saved through _saveRowsOnce');
    ok(f.includes('clientSubmissionId: ' + idVar), 'rows lack the submission id');
    ok(f.includes(idVar + ' = null'), 'submission id not cleared after success');
    const c = f.slice(f.lastIndexOf('} catch'));
    ok(!/\.reset\(\)|clearPayReceiptPreview\(\)/.test(c), 'the catch branch must keep the form and its attachments');
  });
}
for (const [name, kind] of [['async function handleEditExpense(', 'expense'], ['async function handleEditPayroll(', 'payroll']]) {
  test(name + ' uploads newly attached photos and no longer swallows a failure', () => {
    const f = fn(name);
    ok(f.includes("_uploadReceiptFile('" + kind + "'"), 'no file upload');
    ok(!/catch \(_\) \{\}/.test(f), 'a photo failure is still swallowed silently');
  });
}
test('both print popups open in the click, then sign photo links before writing', () => {
  for (const name of ['function printWorkerReceiptSummary(', 'function printTransactionReceipt(']) {
    const f = fn(name);
    const open = f.indexOf("window.open('', '_blank'");
    const sign = f.indexOf('DacsReceipts.signHtml(');
    ok(open !== -1 && sign !== -1, name + ' must open a window and call DacsReceipts.signHtml');
    ok(open < sign, name + ': window.open must come before signing (pop-up blockers)');
    ok(!/\bawait\b/.test(f.slice(0, open)), name + ': nothing may be awaited before window.open');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Run it to see it fail.** Run `node tests/receipt-save-paths.test.js`. Expected: several FAILs (compressImageToBase64 still present, no `_uploadReceiptFile`, …). The popup test fails until Task 5; that is expected here.

- [ ] **Step 3: Replace `compressImageToBase64` (the whole function, ~2718-2741) with the helpers:**

```js
// ── Receipt photos as FILES (spec 2026-10-08) ─────────────────────────
// Photos are uploaded to the private `uploads` bucket BEFORE anything is
// saved; the row keeps the file's public-format URL. A failed upload stops
// the save and the form keeps its picks, so pressing Save again retries —
// reusing files already uploaded (cache keyed by the File object).
const _receiptUploadCache = new WeakMap();
async function _uploadReceiptFile(kind, file) {
    const hit = _receiptUploadCache.get(file);
    if (hit) return hit;
    const blob = await DacsReceipts.compressToBlob(file);
    const url  = await DacsReceipts.uploadReceipt(kind, blob, _uid());
    _receiptUploadCache.set(file, url);
    return url;
}

// One id per Save press, kept until the save succeeds, so a retry after a
// lost response can never create a second copy (0089 unique index).
let _expSubmissionId = null;
let _paySubmissionId = null;

// All rows in ONE insert (all-or-nothing). If this submission already landed
// (a retry after the response was lost), the unique index answers 23505 —
// confirm the rows exist and report 'already' instead of saving twice.
async function _saveRowsOnce(collection, rows, submissionId) {
    try {
        await db.collection(collection).addMany(rows);
        return 'saved';
    } catch (err) {
        if (err && err.code === '23505' && String(err.message || '').includes('client_submission')) {
            const snap = await db.collection(collection).where('clientSubmissionId', '==', submissionId).get();
            if (snap.size > 0) return 'already';
        }
        throw err;
    }
}
```

- [ ] **Step 4: `handleAddExpense`.**
  - Delete the block that starts `// Supporting docs (PO/DR/SI/PR) — compress only those the user selected` (the `_docMap` / `docUrls` loop, ~2782-2790) from **before** the split computation.
  - Replace everything from `const batch = db.batch();` through `await batch.commit();` (~2812-2837) with:

```js
        // Supporting docs (PO/DR/SI/PR): uploaded as files first — a failure
        // stops here with nothing saved and the form untouched.
        const _docMap = { po: 'expDocPO', dr: 'expDocDR', si: 'expDocSI', pay: 'expDocPR' };
        const docUrls = {};
        for (const [key, inputId] of Object.entries(_docMap)) {
            const file = document.getElementById(inputId)?.files?.[0];
            if (file) docUrls[key] = await _uploadReceiptFile('expense', file);
        }

        if (!_expSubmissionId) _expSubmissionId = DacsReceipts.newId();
        const rows = splits.map((sp, idx) => ({
            projectId:     sp.projectId,
            userId:        _uid(),
            expenseName:   expName + (splits.length > 1 ? ' (' + (idx + 1) + '/' + splits.length + ')' : ''),
            category,
            quantity:      splits.length > 1 ? 1 : qty,
            amount:        sp.amount,
            dateTime,
            notes,
            ...(paymentMethod ? { paymentMethod } : {}),
            // Supporting documents (PO/DR/SI/PR) attached only to the first split record.
            ...(idx === 0 && docUrls.po  ? { poImageUrl:         docUrls.po  } : {}),
            ...(idx === 0 && docUrls.dr  ? { deliveryReceiptUrl: docUrls.dr  } : {}),
            ...(idx === 0 && docUrls.si  ? { supplierInvoiceUrl: docUrls.si  } : {}),
            ...(idx === 0 && docUrls.pay ? { paymentReceiptUrl:  docUrls.pay } : {}),
            createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
            clientSubmissionId: _expSubmissionId,
            ...(toInventory ? { inInventory: true } : {}),
            ...(sp.coverExpense && { coverExpense: true }),
            ...(splits.length > 1 && { splitGroup: dateTime + '_' + expName, splitIndex: idx + 1, splitTotal: splits.length })
        }));
        const outcome = await _saveRowsOnce('expenses', rows, _expSubmissionId);
        _expSubmissionId = null;
        if (outcome === 'already') {
            showExpNotif('This expense was already saved earlier ✓', 'success');
            refreshOvAllData();
            document.getElementById('addExpenseForm').reset();
            document.getElementById('expSplitPreview').style.display = 'none';
            closeExpModal('addExpenseModal');
            return;
        }
```

  - **Must not change:** the inventory mirror, the success message, the `reset()` and the modal close that follow. The `catch` stays `showExpNotif('Error saving expense: ' + err.message, 'error')` with no reset, so the form and file picks survive.
  - The field list above is **identical** to today's `batch.set` object, plus `clientSubmissionId`. Diff it against the removed block before moving on.

- [ ] **Step 5: `handleAddPayroll`.** Replace from `const validReceipts = _stagedPayReceipts.filter(r => r !== null);` through `await batch.commit();` (~3161-3188) with:

```js
        const validReceipts = _stagedPayReceipts.filter(r => r !== null);
        const receiptImages = [];
        for (const item of validReceipts) receiptImages.push(await _uploadReceiptFile('payroll', item.file));

        if (!_paySubmissionId) _paySubmissionId = DacsReceipts.newId();
        const _splitStamp = String(Date.now());
        const rows = splits.map((sp, idx) => ({
            projectId: sp.projectId, userId: _uid(),
            workerName, role, laborType,
            ...(liabilityFor && { liabilityFor }),
            daysWorked: splits.length > 1 ? 0 : d, dailyRate: r,
            totalSalary: sp.amount,
            paymentDate, notes,
            ...(paymentMethod && { paymentMethod }),
            receiptImages: idx === 0 ? receiptImages : [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            clientSubmissionId: _paySubmissionId,
            ...(sp.contractId && { contractId: sp.contractId }),
            ...(payMilestone && { payMilestone }),
            ...(sp.coverExpense && { coverExpense: true }),
            // Dates are optional, so a dateless split falls back to the save
            // timestamp — otherwise two dateless splits for the same worker
            // would share one splitGroup key.
            ...(splits.length > 1 && { splitGroup: (paymentDate || _splitStamp) + '_' + workerName, splitIndex: idx + 1, splitTotal: splits.length })
        }));
        const outcome = await _saveRowsOnce('payroll', rows, _paySubmissionId);
        _paySubmissionId = null;
        if (outcome === 'already') {
            showExpNotif('This payroll entry was already saved earlier ✓', 'success');
            refreshOvAllData();
            document.getElementById('addPayrollForm').reset();
            lcResetContractPicks();
            if (typeof payResetMilestone === 'function') payResetMilestone();
            if (typeof payToggleMode === 'function') payToggleMode();
            clearPayReceiptPreview();
            closeExpModal('addPayrollModal');
            return;
        }
```

  The success branch after it (the message, `refreshOvAllData`, the reset, `clearPayReceiptPreview`, close) is unchanged. The `catch` stays as it is, without clearing `_stagedPayReceipts`.

- [ ] **Step 6: `handleEditExpense` (~4223-4228).** Replace the loop body:

```js
        for (const [field, inputId] of Object.entries(_editDocMap)) {
            const file = document.getElementById(inputId)?.files?.[0];
            if (file) updateData[field] = await _uploadReceiptFile('expense', file);
        }
```

  The previous `try { … } catch (_) {}` silently dropped a failed photo. Now the error reaches the existing `catch (err)`, which shows it, and the modal stays open.

- [ ] **Step 7: `handleEditPayroll` (~4352-4354).** Replace:

```js
        const newImgs = [];
        for (const item of _editPayStaged.filter(x => x !== null))
            newImgs.push(await _uploadReceiptFile('payroll', item.file));
```

  Kept images (`_editPayKept`, old base64 or file URLs) are unchanged.

- [ ] **Step 8: Bump the cache-buster.** In `admin.html` change `js/expenses-module.js?v=20261003a` to `js/expenses-module.js?v=20261008a`.

- [ ] **Step 9: Run the tests.** Run `node tests/receipt-save-paths.test.js`. Expected: everything passes except "both print popups …" (Task 5). Then `node --check js/expenses-module.js`, and `npm test`, which will be red only on that popup test because the file is now in the suite. **The money suite (`tests/money-math.test.js`) must pass unchanged.**

- [ ] **Step 10: Stop — no commit.**

---

### Task 5: Print popups sign their photo links

**Files:**
- Modify: `js/expenses-module.js` — `printWorkerReceiptSummary` (~3774-3928) and `printTransactionReceipt` (~5509-5653)

**Interfaces:**
- Consumes: `DacsReceipts.signHtml(html) → Promise<string>` (Task 3).

- [ ] **Step 1: The test already exists** (Task 4's "both print popups …"). Run `node tests/receipt-save-paths.test.js` and confirm only that test fails.

- [ ] **Step 2: `printWorkerReceiptSummary`.**
  1. Move `const w = window.open('', '_blank', 'width=820,height=1050');` and its `if (!w) { alert('Please allow pop-ups to print.'); return; }` to the **top of the function**, right after the `if (!entries.length) return;` line.
  2. Directly after it, add `w.document.write('<p style="font:14px Arial,sans-serif;padding:24px;color:#555">Preparing receipts…</p>');`.
  3. Change the existing `` w.document.write(`<!DOCTYPE html>…</body></html>`); `` into `` const html = `<!DOCTYPE html>…</body></html>`; `` (same template, unchanged).
  4. Replace the final `w.document.close();` with:

```js
    // A separate window doesn't run supabase-config §11b — sign the stored
    // photo links first, then write the page (its print script waits for load).
    DacsReceipts.signHtml(html).then((signed) => {
        w.document.open();
        w.document.write(signed);
        w.document.close();
    });
```

  Update the comment `// Sync on purpose (window.open below must stay in the click)` to `// window.open stays synchronous at the top (pop-up blockers); signing happens after.`

- [ ] **Step 3: `printTransactionReceipt`.**
  1. Move `const win = window.open('', '_blank', 'width=600,height=800');` and its `if (!win) { showExpNotif('Pop-up blocked. Please allow pop-ups for this site.', 'error'); return; }` to directly after `if (!record) { … return; }`.
  2. Add the same "Preparing receipts…" line.
  3. Replace the final `win.document.write(html); win.document.close();` with:

```js
    DacsReceipts.signHtml(html).then((signed) => {
        win.document.open();
        win.document.write(signed);
        win.document.close();
    });
```

- [ ] **Step 4: Run the tests.** Run `node tests/receipt-save-paths.test.js` (all pass), then `node --check js/expenses-module.js`, then `npm test` (all suites pass, money suite included).

- [ ] **Step 5: Stop — no commit.**

---

### Task 6: Apply, verify and browser-check (controller + user)

**Not for a subagent.**

- [ ] **Step 1: Dry run (Claude, MCP `execute_sql`).** Run `begin;` + the 0089 file + `supabase/tests/0089_verify.sql`, all in one call. Expected: `0089 verify: all checks passed`, and everything rolls back. Then confirm nothing persisted (`receipt_uploads` does not exist; no `ZZ 0089` rows).
- [ ] **Step 2: The user applies 0089** in the SQL editor. **Claude verifies live:**
  - `receipt_uploads` exists with RLS on;
  - the two triggers exist;
  - both unique indexes exist;
  - `uploads_can_read` contains `'expenseReceipts'`;
  - the grants on `uploads_can_read`/`write` are unchanged.

  Then Claude re-runs `0089_verify.sql` on its own. Expected: passed.
- [ ] **Step 3: Browser check on local Dacs Web** (127.0.0.1:5501, as owner, then as staff). Hard-refresh first.
  1. **Add expense with all 4 documents** → it saves. The DB row's four fields are `https://…/object/public/uploads/expenseReceipts/<owner>/…` URLs, and the ledger rows are `attached`. The PO/DR/SI/PR pills open the photos.
  2. **Split expense** (amount larger than the remaining budget, so it splits across sources) → **exactly** the expected rows, sharing one `client_submission_id`.
  3. **Add payroll with 2 receipts**, then an **edit** that adds 1 and keeps the others → all show. An old base64 entry still shows its photos.
  4. **Interrupted upload:** DevTools → Network → Offline, then Save → a clear error message, nothing saved, the form and photos still filled. Back Online → Save → it saves **once**.
  5. **Lost response:** DevTools → Network → block the `/rest/v1/expenses` request after it is sent (or throttle and close the response). Press Save again → "already saved earlier", with no duplicate (check the DB count for that `client_submission_id`).
  6. **Viewers:** thumbnails, lightbox, the worker summary modal, **payroll summary print** and **transaction receipt print** (photos appear in the print preview), the Project Control expense details, and downloads — for both old and new photos.
  7. **Denied access:** sign in as a worker on admin.html (refused at sign-in, 1a-2), so check with SQL instead — `uploads_can_read` for that worker is false (verify §1 covers it).
- [ ] **Step 4: Money check.** Run `npm test`. Also run `select sum(amount) from expenses` and `select sum(total_salary) from payroll` before and after the browser tests. The difference must equal exactly the test entries added; then delete those test entries **only with the user's OK**, or leave them labelled `ZZ`.
- [ ] **Step 5: Docs.** Add `ARCHITECTURE.md` §4 (module map): `js/receipt-storage.js`. Update memory `inline-base64-receipts.md`: part 2a live, and new photos are files. Append Execution notes to this plan. Stop — the user commits; deploying to Vercel happens on the user's push.
