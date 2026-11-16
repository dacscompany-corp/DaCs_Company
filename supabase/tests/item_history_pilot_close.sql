-- ════════════════════════════════════════════════════════════════════
-- Item history readiness: close and unlink the Requests pilots' test
-- records, so Find Previous Item shows workers no test item.
--
-- Run by the USER in the Supabase SQL editor (plan
-- docs/superpowers/plans/2026-10-29-item-history-readiness.md, Task 2).
-- One transaction. Any failed guard stops it and changes NOTHING.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It does everything, checks the result,
--            prints it in a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- WHAT IT EXPECTS. v_exp below is every record the plan reviewed, exactly as
-- exported from the live database on 29 Oct 2026 (the same file the test
-- copies, supabase/tests/ih_pilot_records.json): the 17 pilot requests, their
-- 20 lines (position, kind, the worker's words, spec, unit, status, catalogue
-- match, version, and what each still needs), the 7 portions on the open lines
-- (quantity, pending reduction, arranged or not — the one arranged portion is
-- 5 pc) and the three test items. Any difference — a changed value, a missing
-- or an extra request, line or portion, a new line matched to a test item —
-- stops the whole script before it changes anything, naming what differs.
--
-- NOTHING IS DELETED BY HAND. Every change is one of the office's own
-- operations — the ones Dacs Web → Requests calls — made as the main owner
-- (admin@), so each lands in the request's history exactly as a click would:
--   1. un-arrange the one arranged test portion   (pr_office_set_arranged)
--   2. cancel the 7 still-open test lines, with a reason
--                                                  (pr_office_cancel_line —
--      as always, it removes the not-yet-arranged quantities and closes a
--      request whose last line it cancels; the history keeps both)
--   3. remove the catalogue match of the 15 test lines matched to the three
--      test items                                 (pr_office_match_item(line,
--      null) — "Removed the catalogue match"; the worker's own words stay)
--   4. deactivate the three test items            (pr_office_save_item,
--      every other field as it is)
-- A worker's Find Previous Item lists only items with a request line matched
-- to them, or a live historical reference, that the worker may see — after
-- step 3 the three test items have none (their two references are already
-- retired), so no worker finds them, and the phone's clean-up
-- (pr_history_visible) tells every phone to forget them. The office still
-- sees them, inactive.
--
-- The 17 requests, their 20 lines, the history events, the 4 photo rows, the
-- conflict, the Work Plan blocker, the two retired references and the 10
-- gallery rows all stay. The Allow requests / Item history switches are not
-- touched.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  v_owner constant uuid := '869c0be7-da92-44d4-a2b1-03dac7fed7e9';     -- admin@, the main owner (the office actor)
  v_exp constant jsonb := $exp$
{
  "requests": [
    {"id": "ea021893-12fa-46be-a1b2-1f654c5c5196", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-06T04:05:14.238236+00:00", "cancelled_at": "2026-10-06T04:21:48.746468+00:00"},
    {"id": "435df1bd-4dd6-42c7-b86c-4467069f8f47", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-06T04:10:07.028679+00:00", "cancelled_at": "2026-10-06T04:34:49.358951+00:00"},
    {"id": "396c68b0-a167-4b73-9d71-3a32202b40d1", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-06T04:33:35.663818+00:00", "cancelled_at": "2026-10-06T04:34:56.350846+00:00"},
    {"id": "448b2fce-8480-40cd-a42d-59acba87c066", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-06T04:41:36.879103+00:00", "cancelled_at": "2026-10-13T18:45:14.493671+00:00"},
    {"id": "edc66d2f-cecf-4016-b9a5-e6638ab6d46f", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "submitted", "received_at": "2026-10-06T04:49:45.286604+00:00", "cancelled_at": null},
    {"id": "34102228-3393-4a15-9f0c-ef629893b86c", "requester_id": "08b68836-c9bd-4cf1-b4f1-2695b5b6cc22", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "submitted", "received_at": "2026-10-07T04:00:17.019655+00:00", "cancelled_at": null},
    {"id": "088d08cd-0059-4765-8ab4-5447b70e7058", "requester_id": "08b68836-c9bd-4cf1-b4f1-2695b5b6cc22", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "submitted", "received_at": "2026-10-07T10:04:53.109554+00:00", "cancelled_at": null},
    {"id": "34e20cff-6d0e-4b68-96a6-16e5356f3404", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-07T10:12:49.308455+00:00", "cancelled_at": "2026-10-08T06:28:56.133911+00:00"},
    {"id": "92347aad-7ccb-4b02-8c86-0f35623bba49", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "submitted", "received_at": "2026-10-07T10:13:28.829806+00:00", "cancelled_at": null},
    {"id": "763ed71c-ccc3-447a-b6d9-e94cdfd757b9", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "submitted", "received_at": "2026-10-07T10:21:06.384367+00:00", "cancelled_at": null},
    {"id": "45cc54bb-38c3-4391-b9c9-d552a4a898a8", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-08T03:41:07.744523+00:00", "cancelled_at": "2026-10-08T06:27:13.786399+00:00"},
    {"id": "517ddde6-57f9-488a-83ea-5d63e8dd3c1a", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-12T02:19:27.227996+00:00", "cancelled_at": "2026-10-12T03:05:33.205236+00:00"},
    {"id": "f13b4de3-5666-4bd0-b37c-85fd80498a87", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-12T02:25:38.592556+00:00", "cancelled_at": "2026-10-12T03:05:40.678228+00:00"},
    {"id": "22049a90-2910-4df3-b903-e6538c9110cc", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-12T02:29:52.674548+00:00", "cancelled_at": "2026-10-12T03:05:46.150988+00:00"},
    {"id": "4e238a3a-36e0-4d06-a793-68149b080a59", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-12T02:33:30.551349+00:00", "cancelled_at": "2026-10-12T03:05:51.504286+00:00"},
    {"id": "5ee53a74-dc5b-4fee-a43e-32c90c6d6cde", "requester_id": "08b68836-c9bd-4cf1-b4f1-2695b5b6cc22", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-12T02:47:02.393841+00:00", "cancelled_at": "2026-10-12T03:05:56.948211+00:00"},
    {"id": "667e13b8-ae9a-4920-b9b0-6a0b5c66645d", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "status": "cancelled", "received_at": "2026-10-14T05:29:32.507012+00:00", "cancelled_at": "2026-10-14T11:47:12.272051+00:00"}
  ],
  "lines": [
    {"id": "b003f79b-cfc4-498d-8bc2-0b391d851e02", "request_id": "ea021893-12fa-46be-a1b2-1f654c5c5196", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 5, "needed": 0},
    {"id": "7f5c8210-1e4a-4ec9-aecf-227106f29040", "request_id": "435df1bd-4dd6-42c7-b86c-4467069f8f47", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 3, "needed": 0},
    {"id": "3d08f1d2-6ff6-4178-858f-e6ecefe5c754", "request_id": "396c68b0-a167-4b73-9d71-3a32202b40d1", "position": 0, "kind": "material", "description": "pako", "spec": "6", "unit": "6 pc", "status": "cancelled", "catalog_item_id": null, "version": 2, "needed": 0},
    {"id": "81e91fe6-89f8-49b6-8b1b-2498e60244c0", "request_id": "448b2fce-8480-40cd-a42d-59acba87c066", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "needed": 0},
    {"id": "2f08fa44-eb84-4696-a3be-50d82f592e80", "request_id": "448b2fce-8480-40cd-a42d-59acba87c066", "position": 1, "kind": "material", "description": "pako", "spec": "6", "unit": "pc", "status": "cancelled", "catalog_item_id": null, "version": 2, "needed": 0},
    {"id": "10128bce-5568-49c0-9052-fe4df4d6cb06", "request_id": "edc66d2f-cecf-4016-b9a5-e6638ab6d46f", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "open", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 3, "needed": 5},
    {"id": "67e2a223-3064-49f1-ae47-15c4c1bede9f", "request_id": "34102228-3393-4a15-9f0c-ef629893b86c", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "open", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 1, "needed": 6},
    {"id": "0f204a72-6cb5-4061-b178-71617de1e7b6", "request_id": "088d08cd-0059-4765-8ab4-5447b70e7058", "position": 0, "kind": "material", "description": "test", "spec": "7", "unit": "pc", "status": "open", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 1, "needed": 6},
    {"id": "f973d038-45b3-4f08-97cb-e7447a733e87", "request_id": "34e20cff-6d0e-4b68-96a6-16e5356f3404", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "needed": 0},
    {"id": "f8cd7dd9-4617-4efe-bc9a-6136bbde4b89", "request_id": "92347aad-7ccb-4b02-8c86-0f35623bba49", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "open", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 1, "needed": 2},
    {"id": "5683408d-d145-4fd3-aac4-086a395b378e", "request_id": "763ed71c-ccc3-447a-b6d9-e94cdfd757b9", "position": 0, "kind": "material", "description": "ZZ outlet", "spec": "", "unit": "pc", "status": "open", "catalog_item_id": null, "version": 1, "needed": 3},
    {"id": "8cccdea1-d0b6-4324-a6d1-e2511db3a274", "request_id": "763ed71c-ccc3-447a-b6d9-e94cdfd757b9", "position": 1, "kind": "material", "description": "ZZ PVC pipe", "spec": "", "unit": "pc", "status": "open", "catalog_item_id": null, "version": 1, "needed": 3},
    {"id": "ec313aee-d8fa-4cda-82a1-783acaf324bc", "request_id": "763ed71c-ccc3-447a-b6d9-e94cdfd757b9", "position": 2, "kind": "tool", "description": "ZZ pilot drill", "spec": "", "unit": "pc", "status": "open", "catalog_item_id": "f302bd4d-eec5-484c-89a5-3b2bd2f17557", "version": 1, "needed": 1},
    {"id": "0b17cfff-ad75-4997-9c2a-5fc6b9ec1f3f", "request_id": "45cc54bb-38c3-4391-b9c9-d552a4a898a8", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "needed": 0},
    {"id": "672bb207-5818-4f9c-9b80-2019ed87ff79", "request_id": "517ddde6-57f9-488a-83ea-5d63e8dd3c1a", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "needed": 0},
    {"id": "acca0f2f-37da-414f-8713-ca48194066b9", "request_id": "f13b4de3-5666-4bd0-b37c-85fd80498a87", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "needed": 0},
    {"id": "90a9736c-e90f-43c0-85a9-e1bb1ff7e167", "request_id": "22049a90-2910-4df3-b903-e6538c9110cc", "position": 0, "kind": "material", "description": "RAM", "spec": "1/2", "unit": "pc", "status": "cancelled", "catalog_item_id": "fdfaa19d-becc-4ca5-aba0-947d76f3b953", "version": 2, "needed": 0},
    {"id": "46f513d8-6c77-4cec-bfef-402429d5c84d", "request_id": "4e238a3a-36e0-4d06-a793-68149b080a59", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "needed": 0},
    {"id": "523e2b97-de01-4412-be6b-06f1082d8b7c", "request_id": "5ee53a74-dc5b-4fee-a43e-32c90c6d6cde", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "needed": 0},
    {"id": "a234bf38-d6c9-4572-861c-f236c80e48f5", "request_id": "667e13b8-ae9a-4920-b9b0-6a0b5c66645d", "position": 0, "kind": "material", "description": "Cement", "spec": "", "unit": "bag", "status": "cancelled", "catalog_item_id": null, "version": 2, "needed": 0}
  ],
  "portions": [
    {"id": "e65f8f0f-9715-496f-be4d-6f923e342b01", "line_id": "10128bce-5568-49c0-9052-fe4df4d6cb06", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 5, "pending_reduction": 0, "arranged": true},
    {"id": "68a58f43-e00c-435c-b7b1-ddea4c51920a", "line_id": "67e2a223-3064-49f1-ae47-15c4c1bede9f", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 6, "pending_reduction": 0, "arranged": false},
    {"id": "09e0ebc0-5dc3-4aff-94a5-5f1cd51b59c9", "line_id": "0f204a72-6cb5-4061-b178-71617de1e7b6", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 6, "pending_reduction": 0, "arranged": false},
    {"id": "026cc319-0af4-4985-b0d3-386e41075b61", "line_id": "f8cd7dd9-4617-4efe-bc9a-6136bbde4b89", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 2, "pending_reduction": 0, "arranged": false},
    {"id": "0bb63cc1-96d4-415a-a5d2-572c50c74769", "line_id": "ec313aee-d8fa-4cda-82a1-783acaf324bc", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 1, "pending_reduction": 0, "arranged": false},
    {"id": "8617eedf-973a-42cf-9f2b-11b7461cad28", "line_id": "8cccdea1-d0b6-4324-a6d1-e2511db3a274", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 3, "pending_reduction": 0, "arranged": false},
    {"id": "b1569a32-25e6-4b56-86be-28e4d8e38140", "line_id": "5683408d-d145-4fd3-aac4-086a395b378e", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 3, "pending_reduction": 0, "arranged": false}
  ],
  "items": [
    {"id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "name": "ZZ test pipe", "kind": "material", "spec": "1/2 in", "unit": "pc", "category": "electrical", "active": true},
    {"id": "f302bd4d-eec5-484c-89a5-3b2bd2f17557", "name": "ZZ pilot drill", "kind": "tool", "spec": "", "unit": "pc", "category": "", "active": true},
    {"id": "fdfaa19d-becc-4ca5-aba0-947d76f3b953", "name": "RAM", "kind": "material", "spec": "1/2", "unit": "pc", "category": "electrical", "active": true}
  ]
}
$exp$;
  v_reason constant text := 'Pilot test data (Requests pilots, 6–14 Oct) — closed before the Item history launch';
  v_requests uuid[]; v_pilots uuid[]; v_items uuid[]; v_open uuid[]; v_matched uuid[]; v_arranged uuid;
  v_barlin uuid; v_bad text; v_last_event bigint; v_others_before jsonb; v_items_before jsonb;
  b_photos bigint; b_refs bigint; b_gallery bigint; b_block bigint; b_conflicts bigint;
  b_exp_n bigint; b_exp_sum numeric; b_pur bigint; b_stk bigint; b_tools bigint; b_settings text;
  i uuid; c record; n int; msg text;
begin
  -- ---------- what the plan reviewed ----------
  v_requests := array(select (x ->> 'id')::uuid from jsonb_array_elements(v_exp -> 'requests') x);
  v_pilots := array(select distinct (x ->> 'requester_id')::uuid from jsonb_array_elements(v_exp -> 'requests') x);
  v_items := array(select (x ->> 'id')::uuid from jsonb_array_elements(v_exp -> 'items') x);
  v_open := array(select (x ->> 'id')::uuid from jsonb_array_elements(v_exp -> 'lines') x where x ->> 'status' = 'open');
  v_matched := array(select (x ->> 'id')::uuid from jsonb_array_elements(v_exp -> 'lines') x
                      where (x ->> 'catalog_item_id')::uuid = any(v_items));
  select (x ->> 'id')::uuid into v_arranged from jsonb_array_elements(v_exp -> 'portions') x where (x ->> 'arranged')::boolean;
  if cardinality(v_requests) <> 17 or cardinality(v_pilots) <> 3 or cardinality(v_items) <> 3 or cardinality(v_open) <> 7
     or cardinality(v_matched) <> 15 or jsonb_array_length(v_exp -> 'lines') <> 20 or jsonb_array_length(v_exp -> 'portions') <> 7
     or v_arranged is null then
    raise exception 'GUARD: the expected records are not the reviewed 17 requests / 20 lines / 7 portions / 3 items';
  end if;
  select id into v_barlin from folders where owner_id = v_owner and name = 'Barlin Residence' and parent_folder_id is null;
  if v_barlin is null or exists (select 1 from jsonb_array_elements(v_exp -> 'requests') x
                                  where (x ->> 'folder_id')::uuid <> v_barlin or (x ->> 'work_folder_id')::uuid <> v_barlin) then
    raise exception 'GUARD: the pilot requests are not all on Barlin Residence';
  end if;

  -- ---------- guards: every record exactly as reviewed ----------
  -- Requests: the company's requests are exactly these 17, as recorded.
  select string_agg(coalesce(e.id, a.id)::text, ', ' order by coalesce(e.id, a.id)) into v_bad
    from jsonb_to_recordset(v_exp -> 'requests') as e(id uuid, requester_id uuid, folder_id uuid, work_folder_id uuid, status text,
                                                      received_at timestamptz, cancelled_at timestamptz)
    full join (select r.id, r.requester_id, r.folder_id, r.work_folder_id, r.status, r.received_at, r.cancelled_at
                 from pr_requests r where r.owner_id = v_owner) a on a.id = e.id
   where (e.id, e.requester_id, e.folder_id, e.work_folder_id, e.status, e.received_at, e.cancelled_at)
         is distinct from (a.id, a.requester_id, a.folder_id, a.work_folder_id, a.status, a.received_at, a.cancelled_at);
  if v_bad is not null then
    raise exception 'GUARD: a request is not as reviewed (changed, missing or new): % — stop and check', v_bad;
  end if;
  -- Lines: every line of those requests, and every line matched to a test item, as recorded — the worker's words,
  -- spec, unit, kind, status, catalogue match, version and what it still needs.
  select string_agg(coalesce(e.id, a.id)::text || ' (' || coalesce(e.description, a.description) || ')', ', '
                    order by coalesce(e.id, a.id)) into v_bad
    from jsonb_to_recordset(v_exp -> 'lines') as e(id uuid, request_id uuid, position int, kind text, description text, spec text,
                                                   unit text, status text, catalog_item_id uuid, version int, needed numeric)
    full join (select l.id, l.request_id, l.position, l.kind, l.description, l.spec, l.unit, l.status, l.catalog_item_id, l.version,
                      (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id) as needed
                 from pr_lines l where l.request_id = any(v_requests) or l.catalog_item_id = any(v_items)) a on a.id = e.id
   where (e.id, e.request_id, e.position, e.kind, e.description, e.spec, e.unit, e.status, e.catalog_item_id, e.version, e.needed)
         is distinct from (a.id, a.request_id, a.position, a.kind, a.description, a.spec, a.unit, a.status, a.catalog_item_id, a.version, a.needed);
  if v_bad is not null then
    raise exception 'GUARD: a line is not as reviewed (changed, missing or new): % — stop and check', v_bad;
  end if;
  -- Portions: exactly the 7 on the open lines, each quantity, no pending reduction, no buyer, arranged as recorded.
  select string_agg(coalesce(e.id, a.id)::text, ', ' order by coalesce(e.id, a.id)) into v_bad
    from jsonb_to_recordset(v_exp -> 'portions') as e(id uuid, line_id uuid, batch_id uuid, quantity numeric,
                                                      pending_reduction numeric, arranged boolean)
    full join (select p.id, p.line_id, p.batch_id, p.quantity, p.pending_reduction, p.arranged_at is not null as arranged, p.buyer_id
                 from pr_line_portions p where p.line_id in (select id from pr_lines where request_id = any(v_requests))) a on a.id = e.id
   where (e.id, e.line_id, e.batch_id, e.quantity, e.pending_reduction, e.arranged, null::uuid)
         is distinct from (a.id, a.line_id, a.batch_id, a.quantity, a.pending_reduction, a.arranged, a.buyer_id);
  if v_bad is not null then
    raise exception 'GUARD: a portion is not as reviewed (quantity, arranged, a pending reduction, a buyer, missing or new): % — stop and check', v_bad;
  end if;
  if not exists (select 1 from pr_line_portions p where p.id = v_arranged and p.quantity = 5 and p.arranged_at is not null
                    and p.pending_reduction = 0) then
    raise exception 'GUARD: the arranged pilot portion is not exactly 5 pc arranged';
  end if;
  -- The three test items, as recorded and active.
  select string_agg(coalesce(e.id, a.id)::text || ' (' || coalesce(e.name, a.name) || ')', ', ') into v_bad
    from jsonb_to_recordset(v_exp -> 'items') as e(id uuid, name text, kind text, spec text, unit text, category text, active boolean)
    full join (select ci.id, ci.name, ci.kind, ci.spec, ci.unit, ci.category, ci.active from pr_catalog_items ci where ci.id = any(v_items)) a
      on a.id = e.id
   where (e.id, e.name, e.kind, e.spec, e.unit, e.category, e.active, v_owner)
         is distinct from (a.id, a.name, a.kind, a.spec, a.unit, a.category, a.active, (select owner_id from pr_catalog_items where id = a.id));
  if v_bad is not null then
    raise exception 'GUARD: a test item is not as reviewed: % — stop and check', v_bad;
  end if;
  -- Nothing else hangs on them.
  if exists (select 1 from purchase_lines where request_line_id in (select id from pr_lines where request_id = any(v_requests)))
     or exists (select 1 from purchase_line_covers where request_line_id in (select id from pr_lines where request_id = any(v_requests)))
     or exists (select 1 from stk_covers where request_line_id in (select id from pr_lines where request_id = any(v_requests)))
     or exists (select 1 from stk_records where request_line_id in (select id from pr_lines where request_id = any(v_requests)))
     or exists (select 1 from tl_covers where request_line_id in (select id from pr_lines where request_id = any(v_requests)))
     or exists (select 1 from tl_records where request_line_id in (select id from pr_lines where request_id = any(v_requests))) then
    raise exception 'GUARD: a purchase, stock or tool record points at a pilot request — stop and check';
  end if;
  if exists (select 1 from tl_tools where item_id = any(v_items)) or exists (select 1 from stk_lots where item_id = any(v_items))
     or exists (select 1 from stk_matches where item_id = any(v_items)) then
    raise exception 'GUARD: a test item is used by tools or stock — stop and check';
  end if;

  -- ---------- before ----------
  select coalesce(max(id), 0) into v_last_event from pr_events;
  select jsonb_agg(to_jsonb(ci) - 'updated_at' order by ci.id) into v_others_before from pr_catalog_items ci where not ci.id = any(v_items);
  select jsonb_agg(to_jsonb(ci) - 'active' - 'updated_at' order by ci.id) into v_items_before from pr_catalog_items ci where ci.id = any(v_items);
  select count(*) into b_photos from pr_photos;
  select count(*) into b_refs from pr_item_refs;
  select count(*) into b_gallery from pr_gallery_photos;
  select count(*) into b_block from wp_blockers;
  select count(*) into b_conflicts from pr_line_conflicts;
  select count(*), coalesce(sum(amount), 0) into b_exp_n, b_exp_sum from expenses;
  select count(*) into b_pur from purchases;
  select count(*) into b_stk from stk_records;
  select count(*) into b_tools from tl_tools;
  select string_agg(folder_id || ':' || allow_requests || '/' || allow_history, ',' order by folder_id) into b_settings from pr_project_settings;

  -- ---------- the office's own operations, as the main owner ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform pr_office_set_arranged(v_arranged, false);
  foreach i in array v_open loop
    perform pr_office_cancel_line(i, v_reason);
  end loop;
  foreach i in array v_matched loop
    perform pr_office_match_item(i, null);
  end loop;
  for c in select * from pr_catalog_items where id = any(v_items) order by id loop
    perform pr_office_save_item(c.id, c.kind, c.name, c.spec, c.unit, c.category, false, c.aliases, c.brand);
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- ---------- after: exactly the intended changes ----------
  -- Requests: all 17 cancelled; who, where and when unchanged; the already-cancelled keep their time.
  select string_agg(e.id::text, ', ' order by e.id) into v_bad
    from jsonb_to_recordset(v_exp -> 'requests') as e(id uuid, requester_id uuid, folder_id uuid, status text,
                                                      received_at timestamptz, cancelled_at timestamptz)
    left join pr_requests a on a.id = e.id
   where a.id is null or (a.requester_id, a.folder_id, a.received_at, a.status) is distinct from (e.requester_id, e.folder_id, e.received_at, 'cancelled')
      or (e.status = 'cancelled' and a.cancelled_at is distinct from e.cancelled_at) or (e.status <> 'cancelled' and a.cancelled_at is null);
  if v_bad is not null or (select count(*) from pr_requests where owner_id = v_owner) <> 17 then
    raise exception 'GUARD: after — a request is not as intended: %', v_bad;
  end if;
  -- Lines: words, spec, unit, kind, position unchanged; all cancelled; test matches removed, others as they were;
  -- the 7 cancelled now have version + 1 (the office cancel), the rest the same; nothing still needed.
  select string_agg(coalesce(e.id, a.id)::text, ', ' order by coalesce(e.id, a.id)) into v_bad
    from jsonb_to_recordset(v_exp -> 'lines') as e(id uuid, request_id uuid, position int, kind text, description text, spec text,
                                                   unit text, status text, catalog_item_id uuid, version int)
    full join (select l.id, l.request_id, l.position, l.kind, l.description, l.spec, l.unit, l.status, l.catalog_item_id, l.version,
                      (select coalesce(sum(p.quantity - p.pending_reduction), 0) from pr_line_portions p where p.line_id = l.id) as needed
                 from pr_lines l where l.request_id = any(v_requests) or l.catalog_item_id = any(v_items)) a on a.id = e.id
   where (e.id, e.request_id, e.position, e.kind, e.description, e.spec, e.unit, 'cancelled',
          case when e.catalog_item_id = any(v_items) then null else e.catalog_item_id end,
          e.version + case when e.status = 'open' then 1 else 0 end, 0::numeric)
         is distinct from (a.id, a.request_id, a.position, a.kind, a.description, a.spec, a.unit, a.status, a.catalog_item_id, a.version, a.needed);
  if v_bad is not null then
    raise exception 'GUARD: after — a line is not as intended: %', v_bad;
  end if;
  if exists (select 1 from pr_lines where catalog_item_id = any(v_items)) then
    raise exception 'GUARD: after — a line is still matched to a test item';
  end if;
  -- History: exactly 28 new events, all by the office (admin@) on the pilot requests, of the four kinds, with the reason.
  if (select count(*) from pr_events where id > v_last_event) <> 28
     or (select count(*) from pr_events where id > v_last_event and kind = 'portion_unarranged' and line_id = '10128bce-5568-49c0-9052-fe4df4d6cb06') <> 1
     or (select count(*) from pr_events where id > v_last_event and kind = 'office_line_cancelled' and line_id = any(v_open)
                                         and detail ->> 'reason' = v_reason) <> 7
     or (select count(*) from pr_events where id > v_last_event and kind = 'request_cancelled' and line_id is null) <> 5
     or (select count(*) from pr_events where id > v_last_event and kind = 'item_matched' and line_id = any(v_matched)
                                         and detail -> 'catalog_item_id' = 'null'::jsonb) <> 15
     or exists (select 1 from pr_events where id > v_last_event and (actor_id <> v_owner or not request_id = any(v_requests))) then
    raise exception 'GUARD: after — the history is not the 28 office events expected';
  end if;
  -- Catalogue: the three test items inactive, everything else about them unchanged; every other item untouched.
  if exists (select 1 from pr_catalog_items where id = any(v_items) and active)
     or (select jsonb_agg(to_jsonb(ci) - 'active' - 'updated_at' order by ci.id) from pr_catalog_items ci where ci.id = any(v_items)) <> v_items_before
     or (select jsonb_agg(to_jsonb(ci) - 'updated_at' order by ci.id) from pr_catalog_items ci where not ci.id = any(v_items)) <> v_others_before then
    raise exception 'GUARD: after — the catalogue is not as intended';
  end if;
  -- No worker finds a test item, and every phone is told to forget them: every active crew member of the company
  -- (the pilot accounts included — their own lines count for them), as Find Previous Item and the phone's clean-up ask.
  for c in select p.id from profiles p where p.role in ('worker', 'teamLeader') and coalesce(p.status, 'active') = 'active'
                                         and coalesce(p.owner_id, p.id) = v_owner loop
    if exists (select 1 from jsonb_array_elements(pr_history_search_doc(v_owner, c.id, false, null, null, null, null, null, null, 50, 0) -> 'items') x
                where (x ->> 'id')::uuid = any(v_items))
       or exists (select 1 from pr_history_entries(v_owner, c.id, false, null) e where e.catalog_item_id = any(v_items) and not e.retired) then
      raise exception 'GUARD: after — worker % still finds a test item', c.id;
    end if;
    perform set_config('request.jwt.claims', json_build_object('sub', c.id, 'role', 'authenticated')::text, true);
    if pr_history_visible(v_items) <> '[]'::jsonb then
      raise exception 'GUARD: after — the phone clean-up would keep a test item for worker %', c.id;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  -- The office still sees them (inactive).
  if (select count(*) from jsonb_array_elements(pr_history_search_doc(v_owner, v_owner, true, 'ZZ', null, null, null, null, null, 50, 0) -> 'items') x
       where (x ->> 'id')::uuid = any(v_items) and (x ->> 'active')::boolean = false) <> 2 then
    raise exception 'GUARD: after — the office no longer finds the two ZZ items';
  end if;
  -- Nothing else moved.
  if (select count(*) from pr_photos) <> b_photos or (select count(*) from pr_item_refs) <> b_refs
     or (select count(*) from pr_gallery_photos) <> b_gallery or (select count(*) from wp_blockers) <> b_block
     or (select count(*) from pr_line_conflicts) <> b_conflicts
     or (select count(*) from expenses) <> b_exp_n or (select coalesce(sum(amount), 0) from expenses) <> b_exp_sum
     or (select count(*) from purchases) <> b_pur or (select count(*) from stk_records) <> b_stk
     or (select count(*) from tl_tools) <> b_tools
     or (select string_agg(folder_id || ':' || allow_requests || '/' || allow_history, ',' order by folder_id) from pr_project_settings) <> b_settings then
    raise exception 'GUARD: after — a photo, reference, gallery row, blocker, conflict, money, purchase, stock, tool or project switch changed';
  end if;

  msg := '17 pilot requests kept (all now cancelled), 20 lines kept with their words; 1 portion un-arranged, 7 open lines cancelled '
         || 'with a reason, 15 catalogue matches removed, 3 test items deactivated; 28 history events written (admin@); '
         || (select count(*) from pr_line_portions where line_id in (select id from pr_lines where request_id = any(v_requests)))
         || ' pilot portions left; no worker finds a test item and every phone is told to forget them; the office still sees them; '
         || 'photos, references, gallery, blocker, conflict, money, purchases, stock, tools and the project switches unchanged.';
  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): %', msg;
  end if;
  raise notice 'DONE: %', msg;
end $$;
