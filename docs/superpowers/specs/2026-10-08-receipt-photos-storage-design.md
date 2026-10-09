# Receipt photos to private file storage — design

**Date:** 2026-10-08 · **Status:** approved in conversation, awaiting written-spec review
**Follows:** the Project Control freeze fix part 1 (2026-10-03: shim `Query.omit()` + lazy photo hydration in `portal-app.compiled.js`).

## 1. Why

Expense and payroll receipt photos are stored **inside database rows** as base64 `data:` URLs:

| Table | Rows | Rows with photos | Photo bytes |
|---|---|---|---|
| `expenses` (`po_image_url`, `delivery_receipt_url`, `supplier_invoice_url`, `payment_receipt_url`) | 551 | 162 | 7.9 MB |
| `payroll` (`receipt_images` jsonb array) | 242 | 154 | 6.9 MB |

That froze Project Control on 2026-10-03: every list load dragged ~15 MB along. Part 1 made Project Control skip the photos and load them per row on demand. **The data is still growing daily** (newest base64 photo saved 2026-10-08), and the expenses module, reports and realtime still move full rows.

**Goal:** every receipt photo becomes a file in the private `uploads` bucket. The row keeps only a short reference. No peso amount, total or report changes.

## 2. Scope

**In:**
- the four expense photo fields and `payroll.receipt_images`;
- every place they are **saved** (add expense, edit expense documents, add payroll, edit payroll receipts);
- every place they are **shown** (thumbnails, View, download, edit forms, payroll summary print, worker summary, ledger);
- a one-time **move** of existing photos, with a backup and per-row restore;
- a **cleanup** of uploaded-but-never-saved files.

**Also in, because the photo work depends on it:** split expense/payroll rows are saved **all-or-nothing**, and a retried submission can never create duplicate rows. These fix a real, pre-existing defect, described in §4.3.

**Out:**
- client payment proofs (`payment_requests`, `js/client-payment.js`, ~1 MB) and the client/partner portals;
- Project Management (`pm-admin.js`);
- quotations, BOQ, invoices;
- the WorkMate apps.

These keep their current photo handling.

## 3. Decisions

| Topic | Decision | Why |
|---|---|---|
| Where files live | Existing private `uploads` bucket, new top folders `expenseReceipts/` and `payrollReceipts/` | Same bucket, signing and rules as every other Dacs Web file |
| Path | `<folder>/<owner_id>/<yyyy-mm>/<uuid>.jpg` — a random UUID per file, **upsert disabled** | New path per file; nothing is ever overwritten (Supabase guidance) |
| What the row stores | The **public-format URL** of the file (`…/storage/v1/object/public/uploads/<path>`), the same format the bucket's other files use | `supabase-config.js` §11b already signs that format everywhere (`<img>`, `<a>`, `window.open`, `fetch`). It is a stable identifier, not an open link: the bucket is private and every view needs a fresh signed link |
| Who can open the files | **Owner and staff of the owning company only.** Path segment 2 must equal the reader's data owner. Workers, clients and partners: never | `expenses`/`payroll` rows are already owner/staff-only (`can_access`). Today 0081 lets owner/staff of *any* company read generic folders; these two folders are tenant-locked |
| Photo processing for new uploads | Unchanged: max 900 px, JPEG quality 0.75, then upload | Receipts are already readable at this size; keeps files ~50–80 KB |
| Existing photos (the move) | Uploaded **byte-for-byte**, never recompressed | No quality loss on evidence |
| Move method | An **owner-only tool in Dacs Web**, run in the browser, in batches, resumable | No service-role key leaves Supabase |
| Backup | Originals copied to an owner-only backup table **before** each row changes; kept **30 days**, then removed by a later migration after a verification run | Per-row restore; database backups do not cover Storage files and are all-or-nothing |
| Cleanup | A restricted **server function** (Supabase Edge Function, service role) deletes only *recorded, never-attached* uploads older than a grace period. Last phase | Nobody can delete Storage files today (no delete policy), and deleting evidence is the riskiest action |
| Display during transition | Every viewer accepts **both** formats (`data:` and file URL) | No switch-over moment; old and new photos show side by side throughout |

## 4. Design

### 4.1 Database — migration `0089_receipt_storage.sql`

1. **Storage rules.** Re-declare `uploads_can_read` / `uploads_can_write` (0081 bodies unchanged except for the new branch). Folders `expenseReceipts` and `payrollReceipts`:
   - **read** only when `(is_owner() or is_staff())` and path segment 2 = `data_owner_id()::text`;
   - **write** the same.
   - Add both folders to `FOLDERS` in `tests/storage-access.test.js` with their rule.
2. **Upload ledger** `receipt_uploads`: `path` text pk, `owner_id`, `kind` (`expense`|`payroll`), `uploaded_by`, `created_at`, `state` (`pending`|`attached`|`migrated`|`deleted`), `attached_at`, `deleted_at`.
   - RLS: owner/staff of the owner may insert `pending` rows for their own company and select them. No client update/delete; state changes happen only through triggers and owner/service functions.
3. **Attach trigger.** After insert or update on `expenses` / `payroll`, a `security definer` trigger marks every `receipt_uploads` path referenced by the new row's photo fields as `attached`. It runs in the same transaction, so a row that saved always has its files marked.
4. **Duplicate-proof saving.** Add `client_submission_id uuid` and keep `split_index` on both tables, with a unique index on `(client_submission_id, coalesce(split_index, 1)) where client_submission_id is not null`. Existing rows stay null and are unaffected.
5. **Move and restore** (all `security definer`, **owner-only** — `is_owner()` and `can_access(owner_id)` checked inside):
   - `receipt_move_status()`: counts of rows and photos still inline, moved, skipped and restored.
   - `receipt_move_claim(p_limit int)`: picks rows that still hold `data:` photos and copies each photo into `receipt_move_backup`:
     - backup columns: `table_name`, `row_id`, `field`, `item_index`, `original` text, `original_sha256`, `new_path`, `state`, timestamps;
     - it skips any photo already backed up, and returns `(backup_id, table, row, field, index, original)`.
   - `receipt_move_commit(p_backup_id, p_path, p_file_sha256)`:
     - succeeds only if `p_file_sha256 = original_sha256` **and** the row's current value at that field/index still hashes to `original_sha256`;
     - then it replaces just that value with the file URL, inserts the ledger row as `migrated`, and marks the backup `moved`;
     - otherwise it marks the backup `skipped_changed` and changes nothing.
   - `receipt_move_restore(p_row_table text, p_row_id uuid)`: puts the originals back for one row, but only where the current value still equals the moved URL, and marks the backups `restored`.
   - The backup table has RLS **owner-only select**, no direct insert/update/delete — only these functions write it.
6. **Grants and audit.** Execute is granted to `authenticated`; the functions refuse non-owners. The migration has no `for all` policies (repo test rule).

### 4.2 Upload helper — new `js/receipt-storage.js` (loaded by `admin.html` before `expenses-module.js`)

- `dacsReceiptUpload(kind, blob) → url` does three things:
  - inserts the `receipt_uploads` row (`pending`);
  - uploads with `upsert:false` and `contentType:'image/jpeg'` to `<folder>/<owner>/<yyyy-mm>/<uuid>.jpg`;
  - returns the public-format URL.
- Errors throw, and the caller shows them.
- `dacsReceiptFromFile(file)`: the existing 900 px / 0.75 compression, returning a **Blob** (not a data URL).
- `dacsIsInlinePhoto(v)` / `dacsPhotoSrcs(row)`: one place that lists a row's photos, in either format.

### 4.3 Saving — `js/expenses-module.js` (money code)

**Today's defect.** The shim's `batch.commit()` writes split rows **one at a time**, so it is not a transaction. A dropped connection mid-save can leave 1 of 2 split rows saved (wrong totals, no error), and a retry after a timeout can save twice.

**New flow for add expense and add payroll:**
1. Validate. Then mint a `submissionId` once per form submission, kept while the form stays open.
2. Process and upload all attached photos first; any failure → stop.
3. Build all split rows with `clientSubmissionId` + `splitIndex` and save them in **one bulk insert**: a new shim method `CollectionRef.addMany(rows)`, a single PostgREST insert, so it is all-or-nothing.
4. On a unique-violation (23505) for that submission → treat it as **already saved** (re-read the rows by `client_submission_id`) and show success, never a second copy.
5. On any failure: keep the form filled **and the selected attachments**, show a clear message, and let the user press Save again. The same `submissionId` and the already-uploaded file URLs are reused, so nothing is uploaded twice.

**Edit expense documents / edit payroll receipts.** Upload newly attached photos first, then the single-row update. Photos that fail processing now **stop the save with a message** instead of being silently dropped (today's `catch (_) {}`). Kept payroll photos stay as they are (either format).

**Unchanged:** the funding split and priority logic, the cover-expense rules, contract allocation, and every amount computation. `npm test` (money suite) must stay green.

### 4.4 Showing — every viewer accepts both formats

- In-page `<img>`, `<a>`, `window.open` and `fetch` are already signed by `supabase-config.js` §11b, so no change is needed beyond using `dacsPhotoSrcs`.
- **Separate windows** (`w.document.write(...)`), which lack §11b's observer, must **pre-sign** every photo URL with `dacsMaybeSignUrl` before writing HTML:
  - the payroll summary print (`expenses-module.js` ~3854);
  - the worker summary / ledger receipts (~8715, ~8754);
  - any other popup the implementation grep finds.
- Project Control's lazy hydration (`pcHydrateExpense`, `LazyReceiptThumb`) and `Query.omit()` stay as they are (still useful while old rows remain).
- Downloads use `dacsDownloadUpload`, which already handles stored files.

### 4.5 The move tool (owner only)

- **Where:** an owner-only "Move receipt photos" panel in Dacs Web. It is hidden from staff and every other role, and added through CLAUDE.md's "Adding a nav section" checklist (`PRIMARY_NAV`, `_FOCUS_SUBVIEWS`, `_visibleNav`); the server functions refuse non-owners anyway.
- **What it shows:** totals from `receipt_move_status()`, a progress bar, Start / Pause, and a list of skipped rows with **Restore** per row.
- **Per batch** (e.g. 10 photos):
  1. `claim` the batch.
  2. Decode each original to bytes **unchanged**.
  3. Upload with `upsert:false`.
  4. Download the file back through a signed link and SHA-256 it (Web Crypto).
  5. `commit` with that hash.
  6. On a mismatch or a failure, leave the row as it is; it will be retried or listed.
- **Pause / resume:** the tool can stop at any time; reopening it continues from `status`. Rows edited during the move are skipped (`skipped_changed`) and listed.
- **Totals check:** before the first batch and after the last, the tool shows the **sum of `amount` and `total_salary`** per table. They must match exactly.
- **Run timing:** after office hours. Expected run time is a few minutes for ~15 MB.

### 4.6 Backup retention

- The backup lives 30 days after the move finishes.
- Before removal, an owner "verify" run opens a signed link for every moved file and reports any that fail.
- A later migration (`00xx_drop_receipt_move_backup.sql`) drops the backup table only after that run is clean **and** the owner confirms.

### 4.7 Cleanup (last phase)

Supabase Edge Function `receipt-sweeper` (service role; never exposed to the browser). It runs daily on a schedule, and the owner can also trigger it.

**What it deletes:** only `receipt_uploads` rows in state `pending`, **older than 7 days**, whose path is **not referenced** by any `expenses` / `payroll` row (re-checked at deletion time).

**How:**
1. Delete the file through the Storage API. A file that is already gone counts as deleted: this happens when the ledger row was written but the upload itself failed.
2. Mark the ledger row `deleted`.
3. On any other failure, leave it `pending` and retry on the next run.

**What it never touches:** `attached` or `migrated` files, or files of rows deleted later (evidence is kept).

## 5. Rollout (phases, each tested before the next)

| Phase | Ships | Gate |
|---|---|---|
| **A. Safe saving** | 0089 (rules, ledger, trigger, submission index); `receipt-storage.js`; new save flows | Dry-run 0089 → apply → verify; `npm test`; browser: add/edit expense and payroll with photos, a split expense, interrupted upload, interrupted save, retry after failure (no duplicate) |
| **B. Every viewer** | Dual-format display, popup pre-signing | Browser: thumbnails, View, download, edit forms, payroll summary print, worker summary, ledger — for old *and* new photos |
| **C. Move** | Move/restore functions (in 0089 or 0090), owner tool | Dry-run on a copy of one row; then the owner runs it after hours; totals unchanged; restore tested on one row; skipped list empty or explained |
| **D. Cleanup** | `receipt-sweeper` Edge Function + schedule | Test with a deliberately failed save: its pending file is removed after the grace period, and attached files untouched |
| **E. Backup removal** | Drop migration | 30 days + clean verify run + owner OK |

**Deploy order:** the migration first, then JS (the new folders need their storage rule before the first upload). Each phase goes local (127.0.0.1:5501) → owner browser check → push to Vercel.

## 6. Testing

- **Static (`npm test`):**
  - storage-access `FOLDERS` with the new rule;
  - 0089 has no `for all` policy;
  - the save paths call `dacsReceiptUpload` and `addMany`, and no longer call `compressImageToBase64` for these fields;
  - popup builders pre-sign;
  - the money suite stays green.
- **SQL verify script** (`supabase/tests/0089_verify.sql`, self-rolling-back, **run by Claude through MCP `execute_sql`**, not the SQL editor):
  - tenant-locked reads;
  - a worker/client denied;
  - the attach trigger;
  - unique submission;
  - the move functions refuse staff;
  - commit refuses a changed row or a wrong hash;
  - restore puts the original back.
- **Browser checklist:** the phase gates above, plus denied access (a worker account cannot open a receipt link).
- **Money check:** `sum(amount)` / `sum(total_salary)` per table identical before and after the move.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A bug in the new save path blocks saving | The form is kept, there is a clear message and retry; phase A is tested in the browser before going live; money tests |
| A photo is missing in a print window | Every popup is on the checklist; pre-signing is fenced by a static test |
| The move corrupts a photo | Byte-for-byte upload, download-and-hash verify before the row changes, 30-day backup, per-row restore |
| A row is edited during the move | Compare-and-swap commit skips it and lists it |
| Cleanup deletes evidence | Only never-attached ledger entries, older than 7 days, re-checked for references at deletion time; service role only |
