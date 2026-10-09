# WorkMate Stage 1b — Find Previous Item, product gallery and Request Again — design

**Date:** 2026-10-09 · **Status:** approved 2026-10-09 (user delegated the written-spec review;
self-review fixed offline per-entry cleanup, stale-link handling and catalogue-form compatibility)
**Follows:** Stage 1a Requests (migrations 0085–0088, app 0.4.0+1004, pilot passed 2026-10-08).
**Parent designs:** `2026-09-29-unified-worker-app-design.md` §G (Project Item History) and
`2026-09-29-workmate-prototype-and-workflow-guide.md` §13 — this spec settles their open
"before Stage 1b" decisions (history permissions, revocation/cache behaviour, cache size).

## 1. Why

A worker remembers an item used before ("the white two-gang outlet from Barlin") but not its
exact name. Today procurement digs through old Messenger photos to identify it. Stage 1b gives
workers and the office a searchable, photo-backed history of **catalogue items** with project
labels, and a **Request this item again** action that starts a normal request.

## 2. Scope

**In:**
- worker/leader app: Find Previous Item search, item detail, Request Again, bounded offline copy;
- Dacs Web (Requests section): Item history tab, photo review queue, hand-entered historical
  references, gallery photo management, catalogue **aliases** and **brand**, per-project
  **Allow item history** switch;
- server: migration **0090** (confirmed next unused number on 2026-10-09; re-check before writing).

**Out (agreed deferrals, 2026-10-09):**
- **Item-code search** — no item codes exist yet; add with a real column later.
- **Replacement-item link** for discontinued items — a discontinued item reads
  "No longer listed — ask the office" and cannot be requested again.
- Purchased / Received / Issued / Available events and any stock figure — later stages, only when
  backed by verified records.
- Photo cropping/editing in Dacs Web; bulk Messenger import; image recognition.
- Project Management (`construction_projects`) records — Project Control (`folders`) only.
- Deleting any storage file (gallery or request photos).

## 3. Decisions

| Question | Decision |
|---|---|
| Build approach | **A:** history is computed live from existing request records; only two new tables (gallery photos, historical references). No duplicate history table. |
| Who may browse a project's shared history | Projects whose **Allow item history** switch is on (per project, **off by default**, independent of Allow requests). Stays on after the project is completed until staff switch it off. Plus each worker's **own** past requests, under the existing request permissions. |
| What counts as a previous item | A **catalogue item** with at least one entry: a submitted request line linked to it (picked from the catalogue, or matched by the office), or a staff **historical reference**. Typed-in lines appear only once matched. |
| Cancelled lines | Shown, labelled **"Requested — cancelled"**. |
| Gallery photo source | Both: staff **approve a copy** of a worker's private request photo, or **upload** directly. Always reviewed. |
| Photos per item | **Several** approved photos, one **cover**. Retired, never deleted. |
| Request Again link | The new line carries the catalogue item **and** a link to the exact history entry the worker picked. |
| Trimmed | Item code, replacement link (see §2 Out). |

## 4. Design

### 4.1 Rules that hold everywhere

- **No pesos.** No price, cost, amount or receipt image reaches a worker, and no 1b table has a
  money column. Outside the money model: nothing here feeds Spent / Earned / Profit.
- **A historical reference creates no expense, purchase, stock, payment or accounting entry**, and
  is never presented as verified usage.
- **Workers never see** who requested something, request notes, contact details, raw request
  photos, or any "in stock" claim. Historical quantities are never current availability.
- **Tenant isolation:** every read and write is scoped to the caller's company
  (`can_access(owner_id)` / `data_owner_id()`).
- **Per-entry checks:** an item visible through one authorised project never exposes its entries
  from another project the caller may not browse. The check is per entry, on the server.
- **Additional Works** inherit their parent project's Allow item history switch; an AW reference
  must belong to the named parent.

### 4.2 Server — migration 0090

**Changed tables**
- `pr_project_settings` + `allow_history boolean not null default false` (+ `updated_by/at` as now).
- `pr_catalog_items` + `aliases text[] not null default '{}'` and `brand text not null default ''`.
  Identity (the unique index) is unchanged: aliases and brand are search aids, not identity.
- `pr_lines` + `ref_kind text` (`'request_line' | 'reference'`) and `ref_id uuid`, both null or
  both set. Set only by Request Again.
- `pr_photos` + `gallery_review text` (`'published' | 'kept_private'`), `gallery_reviewed_by`,
  `gallery_reviewed_at` — removes a reviewed photo from the review queue.

**New tables** (RLS on; office read through RLS where useful; **all writes through RPCs**)
1. `pr_gallery_photos` — `id`, `owner_id`, `catalog_item_id`, `storage_path` (unique, in bucket
   `item-gallery`), `source` (`'upload' | 'request_photo' | 'reference'`), `source_photo_id`
   (→ `pr_photos`, nullable), `source_ref_id` (→ `pr_item_refs`, nullable), `is_cover`,
   `status` (`'approved' | 'retired'`), `checklist_confirmed` (must be true), `approved_by`,
   `approved_at`, `cover_set_by`, `cover_set_at` (who made it the cover, and when), `retired_by`,
   `retired_at`, `retire_reason`. At most one approved cover per item
   (partial unique index).
   `pr_lines (catalog_item_id)` gets a partial index for history lookups.
2. `pr_item_refs` — `id`, `owner_id`, `catalog_item_id`, `folder_id` (top-level PC project),
   `work_folder_id` (= `folder_id` for Main Contract, or one of its AW children), `description`,
   `ref_date date` (nullable), `date_precision` (`'exact' | 'approximate' | 'unknown'`;
   `unknown` ⇔ no date), `source_note`, `created_by/at`, `retired_by/at`, `retire_reason`.
   Retired rows stay for the office and vanish from worker results.

**Storage:** new private bucket **`item-gallery`**, JPEG only, 5 MB limit. Path
`<owner_id>/<catalog_item_id>/<uuid>.jpg`.
- Insert: owner/staff of that company only (owner segment = `data_owner_id()`), no upsert.
- Read: office of that company; a worker only for a path whose `pr_gallery_photos` row is
  **approved** and whose item has at least one entry that worker may see.
- No update/delete policy for anyone in 1b.
- Raw request photos stay in `request-photos` under their existing rules; publishing copies the
  file and never widens the original's access.

**Worker functions** (security definer, pinned `search_path`, active worker/teamLeader of the
company, signed-in only):
- `pr_history_search(query, kind, category, folder, date_from, date_to, limit 30, offset)` →
  item cards: id, name, spec, unit, kind, category, brand, active, cover photo path, **latest
  visible entry** (label, project, work label, date) — computed only from entries the caller may
  see, honouring the project filter. Matches name, spec, brand, category and aliases
  (case-insensitive). Bounded and paginated.
- `pr_history_item(item, folder)` → item fields, approved photos (cover first), and visible
  entries, newest first: kind (`Requested` / `Requested — cancelled` / `Historical reference`),
  project, Main Contract or AW label, date (request received date in Manila; reference date with
  precision), quantity + unit where known (requested lines: still-needed quantity; none for
  cancelled), staff description/note for references. Each entry carries its `(ref_kind, ref_id)`
  for Request Again.
- `pr_history_visible(item_ids uuid[])` → for each item the caller may still see: the keys of its
  **visible entries** and **approved photo ids**. The app deletes any saved item, entry or photo
  not returned (offline cleanup is per entry, not just per item — an item can stay visible
  through one project while another project's entries must disappear).
- `pr_submit_request` is **re-declared** from its latest live definition (0085; no later
  migration changed it) with one addition: a line may carry `ref_kind/ref_id`.
  - A **malformed** link (unknown kind, bad id, a link on a line with no catalogue item) or one
    naming an entry that **does not exist in the company** → **refused** (`BAD_REFERENCE`, a
    client bug, never silently accepted).
  - A link to a real entry that is **no longer visible** to the requester, or that now belongs to
    a **different catalogue item** (the office re-matched that line after the draft was made) →
    the line is **saved without the link**; the request is not refused, so an offline draft
    never gets stuck. (Amended 2026-10-09 while planning: re-matching is legitimate office work.)
  - The office request view (`pr_request_doc`, re-declared) shows each line's link as a readable
    source: project · Main Contract/AW · date · Requested / Historical reference.
  - Destination, team, cutoff and quantity rules are unchanged. An inactive catalogue item is
    refused as today.

**Backward compatibility (0090 goes live before the new Dacs Web and app):** app 0.4.0 sends no
link and keeps working; `pr_office_save_item` gains `p_aliases text[] default null` and
`p_brand text default null` (null = leave unchanged; the old 7-argument version is dropped), so
the live Catalogue form keeps saving between applying 0090 and pushing plan 1b-2. Migration uses
`set local lock_timeout = '5s'` like 0089.

**Office functions** (owner/staff, company-scoped, every change records who and when):
`pr_office_set_allow_history`, `pr_office_history_search`, `pr_office_history_item` (also shows
requester names and retired photos/references), `pr_office_add_ref`, `pr_office_retire_ref`,
`pr_office_photo_queue` (request photos on lines linked to a catalogue item, not yet reviewed),
`pr_office_publish_photo` (records the reviewed copy; refuses unless the file exists at the
expected path and the checklist is confirmed), `pr_office_keep_private`,
`pr_office_add_gallery_photo`, `pr_office_set_cover`, `pr_office_retire_photo`, and
`pr_office_save_item` **re-declared** with `aliases` and `brand` (see Backward compatibility). Grants: execute to `authenticated` only; internal helpers to nobody.

### 4.3 WorkMate app

- **Entry points:** a **Find Previous Item** button at the top of Requests; a **Find previous
  item** link in the add-item screen.
- **Search screen:** one box (name, alias, brand, spec, category); filter chips **Material/Tool**,
  **category**, **project**, **date**; photo cards (cover or placeholder, name, spec, unit,
  "**Latest: Requested · Oct 3 · Barlin Residence**"); 30 per page with **Show more**.
- **Item detail:** swipeable photos (cover first), full spec, history list newest first. Every
  entry shows project + Main Contract/AW, a date ("around Aug 2026", "Date unknown" where so),
  and its label. A discontinued item shows "No longer listed — ask the office" and hides Request
  Again.
- **Request this item again** (on an entry, or on the item using its latest visible entry):
  - **Mid-request:** keeps the draft's project, Main Contract/AW and team; opens the item editor
    with the item filled in to confirm **quantity** and **needed-by**, then adds the line.
  - **Standalone:** starts a new draft and asks for the destination, team, quantity and date.
  - The line stores the catalogue item id and the `(ref_kind, ref_id)` link; both survive saving,
    reopening and syncing the draft. The line shows the item's cover photo for recognition (not
    attached as a request photo).
  - Normal Submit and server checks; never auto-submits; copies no purchase, payment,
    reservation, custody or cost.
- **Screen states:** loading; "No matches"; "History isn't available for this project";
  "Can't connect — showing saved results from <date, time>"; "You don't have access to this".

### 4.4 Offline copy

- Stored in the app's existing sqflite database, **per signed-in account**; wiped on sign-out or
  account switch.
- Limit **200 items** and **200 photos** (card-sized, ~20 MB total); least-recently-viewed evicted
  first.
- Each item carries "Saved <date, time>"; offline results are labelled "Saved — may be out of
  date". Items saved more than **14 days** ago are not shown offline ("Connect to refresh").
- On each online refresh the app calls `pr_history_visible` for its saved items and deletes every
  saved item, entry and photo not returned (history switched off, photo retired, access lost).
  Fresh results always replace saved ones.
- Photos are cached as image files; signed links (~1 h) are never stored.
- Request Again works offline into a draft; the server re-checks everything on submit.

### 4.5 Dacs Web

All inside the existing **Requests** section (`js/requests-admin-*.js`). The new tab is a new
view **`reqHistory`** ("Item history") in the Requests `modules[]` of `PRIMARY_NAV` (`js/admin.js`),
added to the Requests view group in `admin.html` and `switchView()`; `_FOCUS_SUBVIEWS` gains an
entry only if a hidden drill-down view is added. Same role access as the other Requests views
(owner + staff). No peso amounts, so owner and staff see the same screens.
- **Projects tab:** **Allow item history** checkbox beside Allow requests.
- **Catalogue tab:** **Aliases** and **Brand** in the item form and list; searchable.
- **New Item history tab:**
  - search (app filters + project);
  - item panel: photos (set cover, retire with reason, retired greyed), history (as workers see it
    plus requester names), **Add historical reference** (project → Main Contract or one of its AW,
    description, exact/approximate/unknown date, source note, optional photo), **Upload photo**;
  - **Photos to review** queue: **Approve a copy** or **Keep private**.
- Every publish or upload requires the reviewer to tick: **no prices · no personal info or faces ·
  product only**. A photo showing a price is kept private; staff may upload a clean one instead.
- Publishing: Dacs Web downloads the private request photo (office may read it), uploads a copy to
  `item-gallery`, then calls `pr_office_publish_photo`. A file uploaded but not recorded (call
  failed) stays invisible to workers; no cleanup in 1b.

## 5. Errors

Server refusals use stable codes mapped to plain messages in both clients (as Requests does):
history not available, item no longer listed, reference not visible / wrong item, not
authorised, checklist not confirmed, file missing.

## 6. Testing

- **SQL acceptance script** (self-rolling-back; run via MCP `execute_sql` or the editor-safe
  settings pattern — no temp tables): other company's items never show; history-off project
  hidden even when the item is visible through another project; own requests on a history-off or
  completed project still visible to their requester only; retired photos/references excluded and
  unreadable in storage; unapproved gallery path unreadable by workers; workers cannot write any
  table directly; anon gets nothing; a malformed or non-existent Request Again link refused, a
  link no longer visible or now on another item saved without the link; `pr_history_visible` drops a switched-off project's entries
  while the item stays visible through another project; the old 7-argument call shape of
  `pr_office_save_item` still saves; `pr_submit_request` behaviour otherwise unchanged
  (`1a_acceptance.sql` re-run).
- **Dacs Web `npm test`:** a static suite for 0090 (no money columns, definer + pinned path,
  grants, no for-all/anon policies, old `pr_office_save_item` overload dropped) and the new tab's
  helpers; existing suites stay green.
- **App:** unit/widget tests for search, filters, states, cache limits/expiry/cleanup, and Request
  Again draft prefill + link persistence; then a phone pilot with test workers.

## 7. Rollout (four plans, like 1a)

1. **1b-1 Server:** 0090 + acceptance script; user dry-runs and applies in the SQL editor;
   verified live before continuing.
2. **1b-2 Dacs Web:** office screens; `npm test`; user pushes.
3. **1b-3 Seeding:** staff add photos and historical references for active Project Control sites,
   starting with frequently requested or hard-to-identify items, and switch on Allow item history.
4. **1b-4 App 0.5.0 + pilot:** build, phone pilot with test workers; published only after it passes.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Re-declaring `pr_submit_request` regresses 1a | Copy from the latest live definition, change only the link check; re-run `1a_acceptance.sql`. |
| A price or face slips into the gallery | Mandatory checklist on every publish/upload; retire is instant and removes it from workers on next refresh. |
| Gallery empty at launch (switch off by default) | Seeding session (plan 1b-3) before the app pilot. |
| Stale offline copy after access is removed | `pr_history_visible` cleanup on every online refresh; 14-day offline expiry; wiped on sign-out. |
| Search slows as the catalogue grows | Bounded, paginated server search; add a trigram index if needed. |
