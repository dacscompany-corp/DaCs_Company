# Item history — clean-up and readiness (the Requests pilots' test records) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **Find Previous Item** (WorkMate) ready for the crew: no worker finds a test item — on the server or in a phone's saved copy — the pilots' records stay as history, real items get a historical reference only where there is evidence, and our notes say what is really live. **The Allow requests and Allow item history switches are not changed** (the user's decision A, 29 Oct).

**Architecture:** A worker's Find Previous Item lists only catalogue items that have a request line matched to them, or a live historical reference, that the worker may see (`pr_history_entries` / `pr_history_search_doc`, 0090); a phone's saved copy is cleaned against the same rule (`pr_history_visible`). Today the only such items are three test items, through the pilots' request lines on Barlin Residence. One guarded script, run once by the user, first checks that **every** pilot request, line, portion and test item is exactly as reviewed, then makes the office's own Dacs Web operations as the main owner — un-arrange, cancel with a reason, remove the catalogue match, deactivate — so every step lands in the request history like a click and nothing is deleted by hand. Afterwards no worker has anything to find under a test item, and every phone that cleans its saved copy is told to forget them.

**Tech stack:** PostgreSQL / Supabase (the existing 0086 / 0088 / 0090 / 0104 office functions); PGlite for the script's test; Dacs Web (office checks); WorkMate 0.9.0 (phone check).

**Spec:** [Stage 1b item history design](../specs/2026-10-09-workmate-stage1b-item-history-design.md) (who sees what, "deactivate, never delete", §4.4 the phone's saved copy); the 1a pilot plan's rule — [2026-10-06-workmate-stage1a4-pilot.md](2026-10-06-workmate-stage1a4-pilot.md): *"Never delete live records without the user's explicit approval. Pilot test requests are closed through the office Cancel (history kept)"*; the publish-day to-dos in [2026-10-12-next-three-priorities.md](2026-10-12-next-three-priorities.md).

**Repo:** **Dacs Web** only (base `4dcfa7e`): the script, its exported records and its test, this plan, two dated correction notes. No app code, no migration. WorkMate is untouched.

**Status:** Revision 2, 29 October 2026 — **approved by the user on 29 October 2026 for Task 1 only** ("Don't run the real clean-up or push yet … keep the switches unchanged. R7 remains undecided. Seed the phone before any real clean-up."). Revision 2 follows the user's review of revision 1: (1) **the guards check every affected record exactly** — each line's words, spec, unit, kind, status, catalogue match, version and what it still needs, each portion's quantity, pending reduction, buyer and arranged flag (the arranged one exactly 5 pc), each request and test item — against the live records exported read-only into one file; any difference stops the whole script before it changes anything; **a PGlite test proves 18 kinds of changed data are refused with nothing changed**; (2) **the phone check seeds a saved test item first**, proves the phone's clean-up ran and succeeded (from the server's API log) before testing offline, and says what to do if it fails. Nothing has been changed: the revised script was **dry-run against the live database through MCP and rolled itself back** ("DRY RUN OK", every guard passed); the counts afterwards were identical to before (17 requests, 5 open; 20 lines, 7 open; 7 portions; 58 events; 15 matched lines; 6 active items; 10 projects with Item history on). **R7 — real crew seeing their own cancelled pilot requests — stays a separate owner decision.** The rulings R1–R9 are this plan's own decisions where the review left a detail open.

## Global Constraints

- **The switches stay as they are** — Allow requests (Barlin only) and Allow item history (all 10 open projects) — the user's decision, 29 Oct.
- **All request history is kept; nothing is deleted by hand.** Every change is an office operation that writes the request history (the 1a rule above).
- **The script refuses unless every record is exactly as reviewed** — the 17 requests, their 20 lines, the 7 portions and the 3 test items, as exported on 29 Oct — and changes nothing when it refuses.
- **Real requests are preserved:** there is none on record — all 17 requests are the pilots' (evidence below); a new request of any kind stops the script.
- **No invented history:** a historical reference is added only from evidence the user supplies (R6).
- **Live data:** the user runs the script in the Supabase SQL editor, **dry run first**; Claude verifies read-only. The user commits and pushes.
- **Kept separate (not in this plan):** Stage 3b with 0E; office staff's stock on the phone; R7 (an owner decision); the pilots' test teams ("Team test", "Team pilot B") and Work Plan test tasks ("ZZ 1c3 …") — they touch no item history.

## What is on record (29 Oct, read-only)

**The switch:** *Allow item history* is **on for all 10 open projects** — Barlin since 12 Oct 10:40, the other nine since 12 Oct 12:48 (admin@, within 20 seconds). *Allow requests* is on for Barlin only. WorkMate with Find Previous Item is published (0.8.1 on 24 Oct, 0.9.0 on 28 Oct).

**Who can see it:** workers and team leaders signed in to WorkMate — only W-0007 (the test account, on the test phone) so far; the crew are still on the old Attendance app until 0E. The office sees everything in Dacs Web → Requests → Item history, whatever the switch. Buyers (staff@ on the phone) do not have Find Previous Item.

**What a worker would find today:** only the three test items — through 15 matched lines on Barlin. The three real items (PVC Sanitary Pipe, PVC Electrical Conduit, PVC Conduit Coupling) have a cover photo each but **no history**, so no worker finds them. Deactivating alone would not hide the test items: the app lists an inactive item that has history, marked "no longer listed".

**The 17 requests — all test, on Barlin Residence** (every value the script checks is in [`supabase/tests/ih_pilot_records.json`](../../../supabase/tests/ih_pilot_records.json)):

| Received (Manila) | By | Lines (worker's words → item, unit, still needed) | Status | Pilot |
|---|---|---|---|---|
| 6 Oct 12:05, 12:10 | W-0007 | ZZ test pipe → ZZ test pipe, pc (×2 requests) | cancelled | 1a |
| 6 Oct 12:33 | W-0007 | pako (unlisted, unit "6 pc", 1 photo) | cancelled | 1a |
| 6 Oct 12:41 | W-0007 | ZZ test pipe → ZZ test pipe; pako (unlisted, pc) — 2 photos | cancelled | 1a |
| 6 Oct 12:49 | W-0021 | ZZ test pipe → ZZ test pipe — **open, 5 pc arranged** | submitted | 1a |
| 7 Oct 12:00 | W-0019 | ZZ test pipe → ZZ test pipe — **open, 6 pc** | submitted | 1a |
| 7 Oct 18:04 | W-0019 | test (spec "7") → ZZ test pipe — **open, 6 pc** | submitted | 1a |
| 7 Oct 18:12 | W-0021 | ZZ test pipe → ZZ test pipe | cancelled | 1a |
| 7 Oct 18:13 | W-0021 | ZZ test pipe → ZZ test pipe — **open, 2 pc** | submitted | 1a |
| 7 Oct 18:21 | W-0021 | ZZ outlet **3 pc**, ZZ PVC pipe **3 pc** (unlisted); ZZ pilot drill → ZZ pilot drill **1 pc** (tool) — **all 3 open** | submitted | 1a |
| 8 Oct 11:41 | W-0021 | ZZ test pipe → ZZ test pipe | cancelled | 1a |
| 12 Oct 10:19, 10:25, 10:33 | W-0007 | ZZ test pipe → ZZ test pipe (Request Again ×3) | cancelled | 1b-4 |
| 12 Oct 10:29 | W-0007 | RAM → RAM | cancelled | 1b-4 |
| 12 Oct 10:47 | W-0019 | ZZ test pipe → ZZ test pipe | cancelled | 1b-4 |
| 14 Oct 13:29 | W-0007 | Cement (unlisted, bag) — linked to the Work Plan problem "Test - no cement" on task "ZZ 1c3 A – skim coat" | cancelled | 1c-3 |

**Why they are test, not real:** W-0007 is the attendance test account; W-0007, W-0019 and W-0021 are named *"Pilot accounts … (test workers)"* in the 1b-4 plan; every request falls on a pilot day (1a 6–8 Oct, 1b-4 12 Oct, 1c-3 14 Oct); the 1b-4 plan's notes list the 12 Oct ones (including "10:29 RAM") as *pilot data left*; the 14 Oct Cement request is the 1c-3 pilot's ("Test - no cement", task "ZZ 1c3 A"). The plain words "pako", "RAM" and "Cement" are pilot inputs, not crew requests. **None is linked to a purchase, stock or tool record.**

**Also on record (all kept):** 58 history events; 4 request photo rows (2 on the "pako" lines; the 2 on ZZ test pipe lines already reviewed — one copied to the gallery, one kept private) and their files; 1 offline conflict; 1 Work Plan blocker (cleared, on the ZZ 1c3 test task); ZZ test pipe's 2 historical references and 5 gallery photos — **all already retired** "test"/"pilot test", so no worker sees them; the real items' gallery rows (3 approved covers, 2 retired "wrong images" / "wrong item" on PVC Electrical Conduit).

**Catalogue:** 6 items, all active — test: **ZZ test pipe** (5 Oct, brand ZZBrand, aliases "plug", "saksakan"), **ZZ pilot drill** (tool, 7 Oct, the 1a pilot's tool item), **RAM** (9 Oct, spec "1/2", used only by the 12 Oct pilot line); real: the three PVC items (12 Oct, the 1b-3 seeding).

**The phone's saved copy** (WorkMate `lib/history/`): an item is saved only when a worker **opens its page** online (not from a search list); saved items show offline for 14 days. Each time **Find Previous Item opens**, the app asks the server which saved items are still visible (`pr_history_visible`) and forgets the rest — silently: with no signal it skips; on an error it only writes a debug line. Opening a no-longer-visible item's page online also forgets it, and **signing out wipes the phone's whole saved copy** (spec 1b §4.4). The **Add item list** (the catalogue a new request picks from) is kept on the phone too: it is replaced whenever *New request* opens with signal (`pr_catalog`, active items only), and offline the last saved list is shown — so after the clean-up a phone still offers the test items offline until it next opens *New request* online (found during the seed, 30 Oct; P4b).

## Rulings (review these)

| # | Ruling |
|---|---|
| **R1** | **Hide the test items by removing their catalogue match, not by deleting.** Each of the 15 lines matched to a test item gets the office's **Catalogue → Change → "— No match —"** (`pr_office_match_item(line, null)`, recorded as *"Removed the catalogue match"*); the worker's own words stay on the line. With no matched line and only retired references, a test item has nothing any worker may see, so Find Previous Item never lists it and `pr_history_visible` tells every phone to forget it — for the pilot accounts too (their own lines count for them only while matched). *Not taken:* deleting the pilot requests (the 1a rule; the history would go); a server change hiding inactive items from workers (1b shows inactive items on purpose — that would change real items too); turning Barlin's Item history off (switches stay, and the pilots' own lines would still show). |
| **R2** | **Deactivate the three test items** — ZZ test pipe, ZZ pilot drill, RAM (the 12 Oct to-do; "deactivate, never delete"). No new request (the phone's item picker offers active items only), tool or stock can use them — the Tools register stops offering "ZZ pilot drill", the item behind this morning's TOOL-0007 slip. The office still sees them, inactive. |
| **R3** | **Close the 7 still-open test lines with the office Cancel and a reason** — *"Pilot test data (Requests pilots, 6–14 Oct) — closed before the Item history launch"*. The one **arranged** portion (5 pc ZZ test pipe, 6 Oct) is **un-arranged first**, otherwise the cancel would leave a pending reduction for the office to resolve. As every office cancel does, the not-yet-arranged quantities (the 7 portion rows) are removed and a request whose last line is cancelled closes; the history records each cancel with its reason. |
| **R4** | **Exact guards from one source (revision 2).** The live records were exported read-only on 29 Oct into [`supabase/tests/ih_pilot_records.json`](../../../supabase/tests/ih_pilot_records.json); the script's expected values are generated from that file and its test loads the same file, so the two cannot drift (the test also checks they are equal). Before changing anything the script compares, record by record: **every request** of the company (who, project, status, received and cancelled times — so a new or changed request stops it); **every line** of those requests and every line anywhere matched to a test item (position, kind, the worker's words, spec, unit, status, catalogue match, version — any edit moves it — and what it still needs); **every portion** on those lines (quantity, pending reduction, buyer, arranged — the arranged one exactly **5 pc**); and **the three test items** (name, kind, spec, unit, category, active). Any difference raises `GUARD: …` naming what differs, and the whole transaction is undone — nothing changes. After the operations it checks the result just as exactly: each line's words kept, all cancelled, test matches removed, the 7 cancelled lines' version + 1, nothing still needed; exactly 28 new history events, by admin@, of the four kinds, with the reason; the test items inactive and otherwise unchanged; every other catalogue item untouched; for **every** active crew member, nothing found and `pr_history_visible` empty; photos, references, gallery, blocker, conflict, money, purchases, stock, tools and the 10 project switches unchanged. |
| **R5** | **One guarded script, run once by the user as the office** (`set_config('request.jwt.claims', …)` → admin@, the main owner), calling only the office functions — 1 un-arrange, 7 cancels, 15 matches removed, 3 deactivations. Its dry run undoes everything. A second run refuses (the records are no longer as reviewed). *Alternative:* the same 26 actions clicked in Dacs Web — the same result and history, without the exact guards. |
| **R6** | **Verified references only — none can come from the system.** No expense, purchase, weekly bill, overhead row, inventory row, old request or quotation names any of the three real items; the BOQs (J. Apo, Sulit, Eagle, Barlin, Prado) and the one accomplishment report have only the general line *"Supply and Installation of Conduits, Pipes, Boxes and Fittings"* — not evidence that these items were used. A reference is added **only** from evidence the user supplies — a receipt, delivery receipt, supplier invoice, a dated site photo, or the owner's own first-hand knowledge — written in its source note, through **Dacs Web → Requests → Item history → the item → Add reference** (it creates no expense, purchase or stock). Without evidence, the real items simply stay unfound until a real request is matched to them; workers can still pick them from the catalogue when requesting. |
| **R7** | **Separate owner decision — not in this plan.** A worker's own *My requests* (last 50) still lists their pilot requests, all cancelled — W-0007 (test) now, and W-0019 / W-0021 (real crew) once they move to WorkMate (0E). This plan keeps them as history and changes nothing about it. |
| **R8** | **Correct the outdated notes:** Claude's memory (the Requests note said "only Barlin is ON" and "switching on deferred to the publish"; the 24 Oct note said "Item history switch stays OFF"; the index line said "Item history ON deferred to publish") — rewritten to what is live; in the repo, a dated correction under the two docs that say the switch still had to be turned on — `2026-10-12-next-three-priorities.md` (publish-day to-dos) and `2026-10-28-workmate-stage3-tools-questions.md` ("turning on the Item history switch now that the app is published"). The original sentences are kept. |
| **R9** | **The phone check proves the saved copy is cleaned, not just the server (revision 2).** A clean online search shows only what the server returns; it says nothing about what the phone saved. So the check **seeds** a saved test item on W-0007's phone first (opens ZZ test pipe's page, then proves offline that it is saved), then after the clean-up opens Find Previous Item online — which runs the phone's clean-up — and **Claude confirms from the API log that the phone's `pr_history_visible` call after the script returned 200** (the server's answer for W-0007 is already proved empty by the script), and only then tests offline. If the clean-up did not run or failed, the steps in Task 3 F1–F4 apply. Only the test phone has a WorkMate worker account today, so no other phone holds a saved copy. |

---

### Task 1: Repo — the script, its records and test, this plan, the dated corrections (Claude; the user reviews and commits)

**Files:**
- Create: `supabase/tests/item_history_pilot_close.sql` (generated from the records — as below)
- Create: `supabase/tests/ih_pilot_records.json` (the live records, exported read-only on 29 Oct — as below)
- Create: `supabase/tests/ih_pilot_close.pglite.mjs` (the test — as below)
- Modify: `package.json` (`test:sql` runs the new test)
- Create: `docs/superpowers/plans/2026-10-29-item-history-readiness.md` (this plan)
- Modify: `docs/superpowers/plans/2026-10-12-next-three-priorities.md`, `docs/superpowers/specs/2026-10-28-workmate-stage3-tools-questions.md` (a dated correction each)

**Create:** `supabase/tests/item_history_pilot_close.sql`

```sql
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
```

**Create:** `supabase/tests/ih_pilot_records.json`

```json
{
  "_about": "The Requests pilots' records on the live database, exported read-only on 29 Oct 2026 for the Item history readiness plan (docs/superpowers/plans/2026-10-29-item-history-readiness.md). The single source of item_history_pilot_close.sql's expected values and of ih_pilot_close.pglite.mjs's copy.",
  "owner": "869c0be7-da92-44d4-a2b1-03dac7fed7e9",
  "pilots": [
    {"id": "524f563d-9e27-4897-8064-16f453ef924e", "role": "worker", "worker_no": 7},
    {"id": "08b68836-c9bd-4cf1-b4f1-2695b5b6cc22", "role": "worker", "worker_no": 19},
    {"id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "role": "teamLeader", "worker_no": 21}
  ],
  "barlin": "52bd467a-be33-4282-b676-bfe644f7dd90",
  "test_items": ["eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "f302bd4d-eec5-484c-89a5-3b2bd2f17557", "fdfaa19d-becc-4ca5-aba0-947d76f3b953"],
  "items": [
    {"id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "name": "ZZ test pipe", "kind": "material", "spec": "1/2 in", "unit": "pc", "category": "electrical", "aliases": ["plug", "saksakan"], "brand": "ZZBrand", "active": true, "created_at": "2026-10-05T05:09:07.977756+00:00"},
    {"id": "f302bd4d-eec5-484c-89a5-3b2bd2f17557", "name": "ZZ pilot drill", "kind": "tool", "spec": "", "unit": "pc", "category": "", "aliases": [], "brand": "", "active": true, "created_at": "2026-10-07T02:45:54.622208+00:00"},
    {"id": "fdfaa19d-becc-4ca5-aba0-947d76f3b953", "name": "RAM", "kind": "material", "spec": "1/2", "unit": "pc", "category": "electrical", "aliases": [], "brand": "", "active": true, "created_at": "2026-10-09T06:55:20.630177+00:00"},
    {"id": "86a02de4-db1d-40f2-8868-46686f11abb8", "name": "PVC Sanitary Pipe", "kind": "material", "spec": "4 inches × 3 meters, Series 1000", "unit": "length", "category": "Plumbing Works", "aliases": ["4-inch tubo", "PVC pipe", "sanitary pipe", "Tubo"], "brand": "Atlanta", "active": true, "created_at": "2026-10-12T03:54:42.738977+00:00"},
    {"id": "ec4a0954-8fd7-47b8-bd6b-4b90b4c17d21", "name": "PVC Electrical Conduit", "kind": "material", "spec": "20 mm × 3 m", "unit": "length", "category": "Electrical Works", "aliases": ["conduit pipe", "electrical pipe", "Electrical tubo", "PVC conduit", "PVC electrical", "tubo ng kuryente"], "brand": "Neltex", "active": true, "created_at": "2026-10-12T04:03:56.313179+00:00"},
    {"id": "299e603b-2a80-494a-af45-88f8e72d34e1", "name": "PVC Conduit Coupling", "kind": "material", "spec": "20 mm", "unit": "pc", "category": "Electrical Works", "aliases": ["Coupling", "dugtungan ng tubo"], "brand": "Neltex", "active": true, "created_at": "2026-10-12T04:09:51.07798+00:00"}
  ],
  "requests": [
    {"id": "ea021893-12fa-46be-a1b2-1f654c5c5196", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-06T04:04:45.162937+00:00", "received_at": "2026-10-06T04:05:14.238236+00:00", "status": "cancelled", "cancelled_at": "2026-10-06T04:21:48.746468+00:00", "client_op_id": "4db9e18e-870d-4679-8417-7d248f4acb3f"},
    {"id": "435df1bd-4dd6-42c7-b86c-4467069f8f47", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-06T04:05:28.930525+00:00", "received_at": "2026-10-06T04:10:07.028679+00:00", "status": "cancelled", "cancelled_at": "2026-10-06T04:34:49.358951+00:00", "client_op_id": "adc84201-fee2-4032-a98b-6accc2d024b2"},
    {"id": "396c68b0-a167-4b73-9d71-3a32202b40d1", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": "3efc0b97-9036-4abb-a754-ec39b713431c", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-06T04:32:38.007482+00:00", "received_at": "2026-10-06T04:33:35.663818+00:00", "status": "cancelled", "cancelled_at": "2026-10-06T04:34:56.350846+00:00", "client_op_id": "53c8f089-3def-4f63-9aa7-f6d3b62053b2"},
    {"id": "448b2fce-8480-40cd-a42d-59acba87c066", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": "3efc0b97-9036-4abb-a754-ec39b713431c", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-06T04:40:53.570149+00:00", "received_at": "2026-10-06T04:41:36.879103+00:00", "status": "cancelled", "cancelled_at": "2026-10-13T18:45:14.493671+00:00", "client_op_id": "659bfc03-dc77-4183-8cd5-e281b48ae30b"},
    {"id": "edc66d2f-cecf-4016-b9a5-e6638ab6d46f", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "team_id": "3efc0b97-9036-4abb-a754-ec39b713431c", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-06T04:45:43.36924+00:00", "received_at": "2026-10-06T04:49:45.286604+00:00", "status": "submitted", "cancelled_at": null, "client_op_id": "36cdb780-4f79-4cfe-8a25-b4ffd017495a"},
    {"id": "34102228-3393-4a15-9f0c-ef629893b86c", "requester_id": "08b68836-c9bd-4cf1-b4f1-2695b5b6cc22", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-07T03:59:38.134231+00:00", "received_at": "2026-10-07T04:00:17.019655+00:00", "status": "submitted", "cancelled_at": null, "client_op_id": "89202e99-63dc-407f-9d8e-901fd96adc6b"},
    {"id": "088d08cd-0059-4765-8ab4-5447b70e7058", "requester_id": "08b68836-c9bd-4cf1-b4f1-2695b5b6cc22", "team_id": "9b5fd5c9-9e7f-4203-bf4e-fd5a1bb82bb7", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-07T04:09:54.760669+00:00", "received_at": "2026-10-07T10:04:53.109554+00:00", "status": "submitted", "cancelled_at": null, "client_op_id": "995d0c29-cb4b-413b-8c74-154f48362dfa"},
    {"id": "34e20cff-6d0e-4b68-96a6-16e5356f3404", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "team_id": "9b5fd5c9-9e7f-4203-bf4e-fd5a1bb82bb7", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-07T10:12:07.735687+00:00", "received_at": "2026-10-07T10:12:49.308455+00:00", "status": "cancelled", "cancelled_at": "2026-10-08T06:28:56.133911+00:00", "client_op_id": "bc220013-afd2-4bb1-be7f-24e4b74fb964"},
    {"id": "92347aad-7ccb-4b02-8c86-0f35623bba49", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "team_id": "3efc0b97-9036-4abb-a754-ec39b713431c", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-07T10:12:56.011008+00:00", "received_at": "2026-10-07T10:13:28.829806+00:00", "status": "submitted", "cancelled_at": null, "client_op_id": "fccc5fb9-b0a0-414b-9261-f1c313f31401"},
    {"id": "763ed71c-ccc3-447a-b6d9-e94cdfd757b9", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "team_id": "3efc0b97-9036-4abb-a754-ec39b713431c", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-07T10:17:37.963659+00:00", "received_at": "2026-10-07T10:21:06.384367+00:00", "status": "submitted", "cancelled_at": null, "client_op_id": "58bc38a3-f2b6-4cac-84e3-d2cb474f93a6"},
    {"id": "45cc54bb-38c3-4391-b9c9-d552a4a898a8", "requester_id": "b76a6e2c-bb06-4331-bbfa-9aab86f34a22", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-08T03:39:46.37049+00:00", "received_at": "2026-10-08T03:41:07.744523+00:00", "status": "cancelled", "cancelled_at": "2026-10-08T06:27:13.786399+00:00", "client_op_id": "18d7fe92-9152-4b01-b3ef-3aef3f6284e9"},
    {"id": "517ddde6-57f9-488a-83ea-5d63e8dd3c1a", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-12T02:18:51.35268+00:00", "received_at": "2026-10-12T02:19:27.227996+00:00", "status": "cancelled", "cancelled_at": "2026-10-12T03:05:33.205236+00:00", "client_op_id": "a32e8950-cd1e-472b-96b8-23c91239c428"},
    {"id": "f13b4de3-5666-4bd0-b37c-85fd80498a87", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-12T02:22:21.977753+00:00", "received_at": "2026-10-12T02:25:38.592556+00:00", "status": "cancelled", "cancelled_at": "2026-10-12T03:05:40.678228+00:00", "client_op_id": "98a23789-eeaa-46f4-a5bd-d2151f5b0037"},
    {"id": "22049a90-2910-4df3-b903-e6538c9110cc", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-12T02:28:18.288492+00:00", "received_at": "2026-10-12T02:29:52.674548+00:00", "status": "cancelled", "cancelled_at": "2026-10-12T03:05:46.150988+00:00", "client_op_id": "6592e67b-c0fb-46e9-8f88-a9a173b29b54"},
    {"id": "4e238a3a-36e0-4d06-a793-68149b080a59", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-12T02:32:40.66175+00:00", "received_at": "2026-10-12T02:33:30.551349+00:00", "status": "cancelled", "cancelled_at": "2026-10-12T03:05:51.504286+00:00", "client_op_id": "b1d607b3-8521-4846-a85b-0aa59226fa81"},
    {"id": "5ee53a74-dc5b-4fee-a43e-32c90c6d6cde", "requester_id": "08b68836-c9bd-4cf1-b4f1-2695b5b6cc22", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-12T02:44:40.79359+00:00", "received_at": "2026-10-12T02:47:02.393841+00:00", "status": "cancelled", "cancelled_at": "2026-10-12T03:05:56.948211+00:00", "client_op_id": "a162881a-f86f-425a-bd45-5b0a417ab98e"},
    {"id": "667e13b8-ae9a-4920-b9b0-6a0b5c66645d", "requester_id": "524f563d-9e27-4897-8064-16f453ef924e", "team_id": null, "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "drafted_at": "2026-10-14T05:28:51.008895+00:00", "received_at": "2026-10-14T05:29:32.507012+00:00", "status": "cancelled", "cancelled_at": "2026-10-14T11:47:12.272051+00:00", "client_op_id": "f01fbb80-ce2a-40ea-84a7-9311ce8a7bf8"}
  ],
  "lines": [
    {"id": "b003f79b-cfc4-498d-8bc2-0b391d851e02", "request_id": "ea021893-12fa-46be-a1b2-1f654c5c5196", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 5, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-06T04:05:14.238236+00:00"},
    {"id": "7f5c8210-1e4a-4ec9-aecf-227106f29040", "request_id": "435df1bd-4dd6-42c7-b86c-4467069f8f47", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 3, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-06T04:10:07.028679+00:00"},
    {"id": "3d08f1d2-6ff6-4178-858f-e6ecefe5c754", "request_id": "396c68b0-a167-4b73-9d71-3a32202b40d1", "position": 0, "kind": "material", "description": "pako", "spec": "6", "unit": "6 pc", "status": "cancelled", "catalog_item_id": null, "version": 2, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-06T04:33:35.663818+00:00"},
    {"id": "81e91fe6-89f8-49b6-8b1b-2498e60244c0", "request_id": "448b2fce-8480-40cd-a42d-59acba87c066", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-06T04:41:36.879103+00:00"},
    {"id": "2f08fa44-eb84-4696-a3be-50d82f592e80", "request_id": "448b2fce-8480-40cd-a42d-59acba87c066", "position": 1, "kind": "material", "description": "pako", "spec": "6", "unit": "pc", "status": "cancelled", "catalog_item_id": null, "version": 2, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-06T04:41:36.879103+00:00"},
    {"id": "10128bce-5568-49c0-9052-fe4df4d6cb06", "request_id": "edc66d2f-cecf-4016-b9a5-e6638ab6d46f", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "open", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 3, "ref_kind": null, "ref_id": null, "needed": 5, "created_at": "2026-10-06T04:49:45.286604+00:00"},
    {"id": "67e2a223-3064-49f1-ae47-15c4c1bede9f", "request_id": "34102228-3393-4a15-9f0c-ef629893b86c", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "open", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 1, "ref_kind": null, "ref_id": null, "needed": 6, "created_at": "2026-10-07T04:00:17.019655+00:00"},
    {"id": "0f204a72-6cb5-4061-b178-71617de1e7b6", "request_id": "088d08cd-0059-4765-8ab4-5447b70e7058", "position": 0, "kind": "material", "description": "test", "spec": "7", "unit": "pc", "status": "open", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 1, "ref_kind": null, "ref_id": null, "needed": 6, "created_at": "2026-10-07T10:04:53.109554+00:00"},
    {"id": "f973d038-45b3-4f08-97cb-e7447a733e87", "request_id": "34e20cff-6d0e-4b68-96a6-16e5356f3404", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-07T10:12:49.308455+00:00"},
    {"id": "f8cd7dd9-4617-4efe-bc9a-6136bbde4b89", "request_id": "92347aad-7ccb-4b02-8c86-0f35623bba49", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "open", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 1, "ref_kind": null, "ref_id": null, "needed": 2, "created_at": "2026-10-07T10:13:28.829806+00:00"},
    {"id": "5683408d-d145-4fd3-aac4-086a395b378e", "request_id": "763ed71c-ccc3-447a-b6d9-e94cdfd757b9", "position": 0, "kind": "material", "description": "ZZ outlet", "spec": "", "unit": "pc", "status": "open", "catalog_item_id": null, "version": 1, "ref_kind": null, "ref_id": null, "needed": 3, "created_at": "2026-10-07T10:21:06.384367+00:00"},
    {"id": "8cccdea1-d0b6-4324-a6d1-e2511db3a274", "request_id": "763ed71c-ccc3-447a-b6d9-e94cdfd757b9", "position": 1, "kind": "material", "description": "ZZ PVC pipe", "spec": "", "unit": "pc", "status": "open", "catalog_item_id": null, "version": 1, "ref_kind": null, "ref_id": null, "needed": 3, "created_at": "2026-10-07T10:21:06.384367+00:00"},
    {"id": "ec313aee-d8fa-4cda-82a1-783acaf324bc", "request_id": "763ed71c-ccc3-447a-b6d9-e94cdfd757b9", "position": 2, "kind": "tool", "description": "ZZ pilot drill", "spec": "", "unit": "pc", "status": "open", "catalog_item_id": "f302bd4d-eec5-484c-89a5-3b2bd2f17557", "version": 1, "ref_kind": null, "ref_id": null, "needed": 1, "created_at": "2026-10-07T10:21:06.384367+00:00"},
    {"id": "0b17cfff-ad75-4997-9c2a-5fc6b9ec1f3f", "request_id": "45cc54bb-38c3-4391-b9c9-d552a4a898a8", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-08T03:41:07.744523+00:00"},
    {"id": "672bb207-5818-4f9c-9b80-2019ed87ff79", "request_id": "517ddde6-57f9-488a-83ea-5d63e8dd3c1a", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "ref_kind": "request_line", "ref_id": "0b17cfff-ad75-4997-9c2a-5fc6b9ec1f3f", "needed": 0, "created_at": "2026-10-12T02:19:27.227996+00:00"},
    {"id": "acca0f2f-37da-414f-8713-ca48194066b9", "request_id": "f13b4de3-5666-4bd0-b37c-85fd80498a87", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "ref_kind": "reference", "ref_id": "bfad2547-3881-48c2-80cc-e18d1bb820bb", "needed": 0, "created_at": "2026-10-12T02:25:38.592556+00:00"},
    {"id": "90a9736c-e90f-43c0-85a9-e1bb1ff7e167", "request_id": "22049a90-2910-4df3-b903-e6538c9110cc", "position": 0, "kind": "material", "description": "RAM", "spec": "1/2", "unit": "pc", "status": "cancelled", "catalog_item_id": "fdfaa19d-becc-4ca5-aba0-947d76f3b953", "version": 2, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-12T02:29:52.674548+00:00"},
    {"id": "46f513d8-6c77-4cec-bfef-402429d5c84d", "request_id": "4e238a3a-36e0-4d06-a793-68149b080a59", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "ref_kind": "request_line", "ref_id": "acca0f2f-37da-414f-8713-ca48194066b9", "needed": 0, "created_at": "2026-10-12T02:33:30.551349+00:00"},
    {"id": "523e2b97-de01-4412-be6b-06f1082d8b7c", "request_id": "5ee53a74-dc5b-4fee-a43e-32c90c6d6cde", "position": 0, "kind": "material", "description": "ZZ test pipe", "spec": "1/2 in", "unit": "pc", "status": "cancelled", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "version": 2, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-12T02:47:02.393841+00:00"},
    {"id": "a234bf38-d6c9-4572-861c-f236c80e48f5", "request_id": "667e13b8-ae9a-4920-b9b0-6a0b5c66645d", "position": 0, "kind": "material", "description": "Cement", "spec": "", "unit": "bag", "status": "cancelled", "catalog_item_id": null, "version": 2, "ref_kind": null, "ref_id": null, "needed": 0, "created_at": "2026-10-14T05:29:32.507012+00:00"}
  ],
  "batches": [
    {"id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "cutoff_at": "2026-10-10T04:00:00+00:00", "purchase_on": "2026-10-12", "delivery_on": "2026-10-14"}
  ],
  "portions": [
    {"id": "e65f8f0f-9715-496f-be4d-6f923e342b01", "line_id": "10128bce-5568-49c0-9052-fe4df4d6cb06", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 5, "pending_reduction": 0, "arranged_at": "2026-10-07T10:51:50.004717+00:00", "arranged_by": "869c0be7-da92-44d4-a2b1-03dac7fed7e9", "created_at": "2026-10-06T04:49:45.286604+00:00"},
    {"id": "68a58f43-e00c-435c-b7b1-ddea4c51920a", "line_id": "67e2a223-3064-49f1-ae47-15c4c1bede9f", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 6, "pending_reduction": 0, "arranged_at": null, "arranged_by": null, "created_at": "2026-10-07T04:00:17.019655+00:00"},
    {"id": "09e0ebc0-5dc3-4aff-94a5-5f1cd51b59c9", "line_id": "0f204a72-6cb5-4061-b178-71617de1e7b6", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 6, "pending_reduction": 0, "arranged_at": null, "arranged_by": null, "created_at": "2026-10-07T10:04:53.109554+00:00"},
    {"id": "026cc319-0af4-4985-b0d3-386e41075b61", "line_id": "f8cd7dd9-4617-4efe-bc9a-6136bbde4b89", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 2, "pending_reduction": 0, "arranged_at": null, "arranged_by": null, "created_at": "2026-10-07T10:13:28.829806+00:00"},
    {"id": "0bb63cc1-96d4-415a-a5d2-572c50c74769", "line_id": "ec313aee-d8fa-4cda-82a1-783acaf324bc", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 1, "pending_reduction": 0, "arranged_at": null, "arranged_by": null, "created_at": "2026-10-07T10:21:06.384367+00:00"},
    {"id": "8617eedf-973a-42cf-9f2b-11b7461cad28", "line_id": "8cccdea1-d0b6-4324-a6d1-e2511db3a274", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 3, "pending_reduction": 0, "arranged_at": null, "arranged_by": null, "created_at": "2026-10-07T10:21:06.384367+00:00"},
    {"id": "b1569a32-25e6-4b56-86be-28e4d8e38140", "line_id": "5683408d-d145-4fd3-aac4-086a395b378e", "batch_id": "08c4f2d5-fdeb-4d85-b239-609990d2825a", "quantity": 3, "pending_reduction": 0, "arranged_at": null, "arranged_by": null, "created_at": "2026-10-07T10:21:06.384367+00:00"}
  ],
  "settings": [
    {"folder_id": "0d3ef792-e560-45f6-bcad-9b43c7c78d55", "allow_requests": false, "allow_history": true},
    {"folder_id": "23ab745e-6984-407a-ae0c-5ce286258713", "allow_requests": false, "allow_history": true},
    {"folder_id": "3ac47788-a517-4036-a122-22d6a70d4f96", "allow_requests": false, "allow_history": true},
    {"folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "allow_requests": true, "allow_history": true},
    {"folder_id": "56bc70b1-6675-4329-bebe-9365eb8baa4d", "allow_requests": false, "allow_history": true},
    {"folder_id": "6ed03657-5620-4bc2-a402-3ce9451609aa", "allow_requests": false, "allow_history": true},
    {"folder_id": "9ffb2858-b6a5-4857-b687-ab4258d659e8", "allow_requests": false, "allow_history": true},
    {"folder_id": "cc5834a9-af86-4656-8121-5077da62d55e", "allow_requests": false, "allow_history": true},
    {"folder_id": "dd274447-91bd-4347-b93c-d2e46aa9fa81", "allow_requests": false, "allow_history": true},
    {"folder_id": "f91c4f4a-60d3-468e-8b17-758d2546e847", "allow_requests": false, "allow_history": true}
  ],
  "refs": [
    {"id": "5e5ae8ab-c5d1-46c0-8b63-af02fe6b742b", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "description": "ZZ test", "ref_date": "2026-08-11", "date_precision": "approximate", "source_note": "", "created_at": "2026-10-11T00:50:41.77634+00:00", "retired_at": "2026-10-11T00:51:29.501354+00:00", "retire_reason": "test"},
    {"id": "bfad2547-3881-48c2-80cc-e18d1bb820bb", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "work_folder_id": "52bd467a-be33-4282-b676-bfe644f7dd90", "description": "Kitchen outlets", "ref_date": "2026-08-12", "date_precision": "approximate", "source_note": "old Messenger photo", "created_at": "2026-10-12T02:10:13.760178+00:00", "retired_at": "2026-10-12T02:46:47.27118+00:00", "retire_reason": "pilot test"}
  ],
  "photos": [
    {"id": "85d2a869-c2d8-4937-a2e4-2b171b44bc70", "request_id": "396c68b0-a167-4b73-9d71-3a32202b40d1", "line_id": "3d08f1d2-6ff6-4178-858f-e6ecefe5c754", "storage_path": "524f563d-9e27-4897-8064-16f453ef924e/396c68b0-a167-4b73-9d71-3a32202b40d1/20b804dc-2305-4764-a706-03d4afd1dd52.jpg", "gallery_review": null},
    {"id": "439186c2-66e0-40d3-abef-659c980b360d", "request_id": "448b2fce-8480-40cd-a42d-59acba87c066", "line_id": "2f08fa44-eb84-4696-a3be-50d82f592e80", "storage_path": "524f563d-9e27-4897-8064-16f453ef924e/448b2fce-8480-40cd-a42d-59acba87c066/30ffff53-ac6a-4cd2-81bf-068cdee7b874.jpg", "gallery_review": null},
    {"id": "4c71a3cb-242a-4dfe-9d03-c22178bba2f9", "request_id": "448b2fce-8480-40cd-a42d-59acba87c066", "line_id": "81e91fe6-89f8-49b6-8b1b-2498e60244c0", "storage_path": "524f563d-9e27-4897-8064-16f453ef924e/448b2fce-8480-40cd-a42d-59acba87c066/de4b499e-6873-4358-8d70-5d6db51caf6f.jpg", "gallery_review": "published"},
    {"id": "d11968b5-c876-4946-a6f2-d799dcf16969", "request_id": "435df1bd-4dd6-42c7-b86c-4467069f8f47", "line_id": "7f5c8210-1e4a-4ec9-aecf-227106f29040", "storage_path": "524f563d-9e27-4897-8064-16f453ef924e/435df1bd-4dd6-42c7-b86c-4467069f8f47/de8d8b1a-c3bd-49fb-b384-2b0984accdf2.jpg", "gallery_review": "kept_private"}
  ],
  "gallery": [
    {"id": "8741000e-221c-425d-9df7-711431d5291f", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/eb89b45d-5af1-4661-bbd6-7bc08ca1a73d/f97a6095-0dd0-4ba7-a38f-6bcbb6850580.jpg", "source": "upload", "source_photo_id": null, "is_cover": false, "status": "retired", "approved_at": "2026-10-11T00:59:08.558057+00:00", "retired_at": "2026-10-11T00:59:45.872546+00:00", "retire_reason": "test — shows faces"},
    {"id": "24ef82bc-e499-4b61-977c-43c70dde33c8", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/eb89b45d-5af1-4661-bbd6-7bc08ca1a73d/f658aaa6-5968-4f3e-9df7-e6470609020e.jpg", "source": "upload", "source_photo_id": null, "is_cover": false, "status": "retired", "approved_at": "2026-10-11T00:57:14.308945+00:00", "retired_at": "2026-10-11T01:14:20.67223+00:00", "retire_reason": "test"},
    {"id": "4e070098-05bb-4168-916e-a24acc668839", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/eb89b45d-5af1-4661-bbd6-7bc08ca1a73d/ad52512b-678c-4465-bdb3-f0faa077b376.jpg", "source": "upload", "source_photo_id": null, "is_cover": false, "status": "retired", "approved_at": "2026-10-11T00:58:52.589681+00:00", "retired_at": "2026-10-11T01:14:25.762885+00:00", "retire_reason": "test"},
    {"id": "3a14bcea-f3c1-4a21-93b3-0c7edac1c37c", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/eb89b45d-5af1-4661-bbd6-7bc08ca1a73d/ae7fe6de-ec23-4af6-be34-4b1487943e99.jpg", "source": "request_photo", "source_photo_id": "4c71a3cb-242a-4dfe-9d03-c22178bba2f9", "is_cover": false, "status": "retired", "approved_at": "2026-10-11T01:18:12.843047+00:00", "retired_at": "2026-10-11T01:21:22.293734+00:00", "retire_reason": "test"},
    {"id": "0f703785-751f-4d9e-83c1-f0c19c75ecb6", "catalog_item_id": "eb89b45d-5af1-4661-bbd6-7bc08ca1a73d", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/eb89b45d-5af1-4661-bbd6-7bc08ca1a73d/52fe961d-7ccd-4904-9b88-52638a6726ed.jpg", "source": "upload", "source_photo_id": null, "is_cover": false, "status": "retired", "approved_at": "2026-10-12T02:07:21.774419+00:00", "retired_at": "2026-10-12T02:50:52.318309+00:00", "retire_reason": "pilot test"},
    {"id": "671c4120-521f-4b4b-9dc6-250b31ed241c", "catalog_item_id": "86a02de4-db1d-40f2-8868-46686f11abb8", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/86a02de4-db1d-40f2-8868-46686f11abb8/2cd63f0f-b252-47fe-912d-1bf345b21bac.jpg", "source": "upload", "source_photo_id": null, "is_cover": true, "status": "approved", "approved_at": "2026-10-12T04:00:10.234425+00:00", "retired_at": null, "retire_reason": null},
    {"id": "e5fe16cd-2db7-4fdb-a9a1-47f8134e8285", "catalog_item_id": "ec4a0954-8fd7-47b8-bd6b-4b90b4c17d21", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/ec4a0954-8fd7-47b8-bd6b-4b90b4c17d21/624693a2-12c0-45ef-b199-abee4c9c76b8.jpg", "source": "upload", "source_photo_id": null, "is_cover": false, "status": "retired", "approved_at": "2026-10-12T04:05:17.195408+00:00", "retired_at": "2026-10-12T04:06:06.652354+00:00", "retire_reason": "wrong images"},
    {"id": "c4a90990-c20f-404c-84af-0712ecd30d3b", "catalog_item_id": "ec4a0954-8fd7-47b8-bd6b-4b90b4c17d21", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/ec4a0954-8fd7-47b8-bd6b-4b90b4c17d21/f983e69d-de9f-44a0-97a2-eb1537cbfd23.jpg", "source": "upload", "source_photo_id": null, "is_cover": false, "status": "retired", "approved_at": "2026-10-12T04:06:49.61744+00:00", "retired_at": "2026-10-12T04:08:13.988069+00:00", "retire_reason": "wrong item"},
    {"id": "cb1cb2f0-5f75-466f-9bc6-d9c6e05da3cd", "catalog_item_id": "ec4a0954-8fd7-47b8-bd6b-4b90b4c17d21", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/ec4a0954-8fd7-47b8-bd6b-4b90b4c17d21/97ecbd89-0201-4af5-9be2-daf2b83c97bd.jpg", "source": "upload", "source_photo_id": null, "is_cover": true, "status": "approved", "approved_at": "2026-10-12T04:08:21.150906+00:00", "retired_at": null, "retire_reason": null},
    {"id": "78716b3a-e393-4ebd-97a6-45832da7419d", "catalog_item_id": "299e603b-2a80-494a-af45-88f8e72d34e1", "storage_path": "869c0be7-da92-44d4-a2b1-03dac7fed7e9/299e603b-2a80-494a-af45-88f8e72d34e1/97d8fd86-1df1-44a6-a808-24576b046d07.jpg", "source": "upload", "source_photo_id": null, "is_cover": true, "status": "approved", "approved_at": "2026-10-12T04:11:51.806477+00:00", "retired_at": null, "retire_reason": null}
  ],
  "conflicts": [{"id": "ad65e8aa-7905-4ea7-8e03-bd55114ae34a", "line_id": "b003f79b-cfc4-498d-8bc2-0b391d851e02"}],
  "blockers": [{"id": "980d016e-3306-4bca-b69a-a24e72b2b0fb", "request_id": "667e13b8-ae9a-4920-b9b0-6a0b5c66645d"}],
  "events_on_record": 58
}
```

**Create:** `supabase/tests/ih_pilot_close.pglite.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// ITEM HISTORY READINESS — THE PILOT CLOSE SCRIPT ON PGLITE
//   npm run test:sql
//
// Runs supabase/tests/item_history_pilot_close.sql, unchanged, against an
// exact copy of the live Requests pilot records (ih_pilot_records.json,
// exported read-only on 29 Oct 2026) on PGlite, with the real office
// functions it calls (0086, 0088, 0090, 0097, 0104, 0107 — lifted verbatim).
// Proves: its expectations are the exported records; the dry run changes
// nothing; the real run makes exactly the intended changes and no worker then
// finds a test item; and any changed record is refused with nothing changed.
// Nothing here talks to the live database.
// ════════════════════════════════════════════════════════════════════
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const tableText = (src, name) => {
  const m = src.match(new RegExp('create table if not exists ' + name + ' \\([\\s\\S]*?\\n\\);'));
  if (!m) throw new Error('table ' + name + ' not found');
  return m[0];
};
const M02 = mig('0002_rls.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
const M85 = mig('0085_workmate_requests.sql');
const M86 = mig('0086_workmate_requests_office.sql');
const M88 = mig('0088_pr_worker_cancel_alignment.sql');
const M90 = mig('0090_workmate_item_history.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');
const M96 = mig('0096_purchase_recording.sql');
const M97 = mig('0097_purchasing_office.sql');
const M98 = mig('0098_pm_profit_sharing.sql');
const M101 = mig('0101_purchasing_phone.sql');
const M102 = mig('0102_purchase_payments.sql');
const M103 = mig('0103_buyer_return_photo.sql');
const M104 = mig('0104_stock.sql');
const M105 = mig('0105_stock_cost_moves.sql');
const M106 = mig('0106_workmate_phone_stock.sql');
const M107 = mig('0107_tools.sql');
const M108 = mig('0108_tools_crew_numbers.sql');
const SCRIPT = read(path.join(ROOT, 'supabase/tests/item_history_pilot_close.sql'));
const REC = JSON.parse(read(path.join(ROOT, 'supabase/tests/ih_pilot_records.json')));
const real = () => {
  const s = SCRIPT.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
  if (s === SCRIPT) throw new Error('the setting line is not in the script');
  return s;
};

// The 3a suite's base (auth.uid() also reads the JWT claims the script sets).
const BASE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('test.uid', true), ''),
                     nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id) on delete cascade, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null,
  monthly_budget numeric not null default 0);
create table expenses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false,
  split_group text, split_index int, split_total int, client_submission_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  total_salary numeric, cover_expense boolean default false);
create table inventory (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid,
  created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}
`;
const REQUESTS_0085 = `
create table pr_teams (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  name text not null, active boolean not null default true, created_at timestamptz not null default now());
create table pr_team_members (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  team_id uuid not null references pr_teams(id), worker_id uuid not null references profiles(id), is_leader boolean not null default false,
  added_at timestamptz not null default now(), removed_at timestamptz);
create table pr_photos (id uuid primary key default gen_random_uuid(), owner_id uuid not null references profiles(id),
  request_id uuid not null references pr_requests(id), line_id uuid references pr_lines(id), storage_path text not null unique,
  uploaded_by uuid not null references profiles(id), created_at timestamptz not null default now());
${fnText(M85, 'pr_is_requester')}
${fnText(M85, 'pr_is_current_leader')}
${fnText(M51, 'attendance_data_owner')}
`;
// What the script reads beyond the 3a base: 0085's project switches and conflicts, 0090's history (tables and
// readers), the office operations it calls, and the Work Plan blocker table (its one column that matters).
const HISTORY = `
alter table pr_catalog_items add column if not exists created_at timestamptz not null default now();
alter table pr_lines add column if not exists ref_kind text;
alter table pr_lines add column if not exists ref_id uuid;
${tableText(M85, 'pr_project_settings')}
alter table pr_project_settings add column if not exists allow_history boolean not null default false;
${tableText(M85, 'pr_line_conflicts')}
alter table pr_photos add column if not exists gallery_review text;
alter table pr_photos add column if not exists gallery_reviewed_by uuid references profiles(id);
alter table pr_photos add column if not exists gallery_reviewed_at timestamptz;
${tableText(M90, 'pr_item_refs')}
${tableText(M90, 'pr_gallery_photos')}
create table if not exists wp_blockers (id uuid primary key default gen_random_uuid(), request_id uuid references pr_requests(id));
${fnText(M90, 'pr_history_open')}
${fnText(M90, 'pr_history_entries')}
${fnText(M90, 'pr_entry_label')}
${fnText(M90, 'pr_history_search_doc')}
${fnText(M90, 'pr_history_visible')}
${fnText(M86, 'pr_office_match_item')}
${fnText(M88, 'pr_office_cancel_line')}
`;

const OWNER = REC.owner;
const W7 = REC.pilots[0].id, W19 = REC.pilots[1].id, W21 = REC.pilots[2].id;
const W27 = '00000000-0000-0000-0000-000000000027';   // another active worker — not in the pilots
const BARLIN = REC.barlin;
const TEST_ITEMS = REC.test_items;

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function refused(p, want, why) {
  let msg = null;
  try { await p; } catch (e) { msg = e.message; }
  assert(msg !== null, (why || 'expected a refusal') + ': it ran');
  assert(msg.includes(want), (why || '') + ': expected "' + want + '", got "' + msg + '"');
  return msg;
}

// The live pilot records, exactly, on the real functions.
async function copy() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(M96);
  await db.exec(prBase(ROOT));
  await db.exec(CATALOG_0085);
  await db.exec(fnText(M90, 'pr_clean_aliases'));
  await db.exec(M97);
  await db.exec(M101);
  await db.exec(fnText(M98, 'pm_main_owner_id'));
  await db.exec(M102);
  await db.exec(M103);
  await db.exec(M104);
  await db.exec(M105);
  await db.exec(REQUESTS_0085);
  await db.exec(M106);
  await db.exec(M107);
  await db.exec(M108);
  await db.exec(HISTORY);
  const q = (sql, params) => db.query(sql, params);
  await q(`insert into profiles (id, role, owner_id, status) values ($1, 'owner', null, 'active')`, [OWNER]);
  await q(`update profiles set email = 'admin@dacs.test' where id = $1`, [OWNER]);
  for (const p of REC.pilots) {
    await q(`insert into profiles (id, role, owner_id, status, worker_no) values ($1, $2, $3, 'active', $4)`, [p.id, p.role, OWNER, p.worker_no]);
  }
  await q(`insert into profiles (id, role, owner_id, status, worker_no) values ($1, 'worker', $2, 'active', 27)`, [W27, OWNER]);
  for (const [n, s] of REC.settings.entries()) {
    await q(`insert into folders (id, owner_id, name) values ($1, $2, $3)`, [s.folder_id, OWNER, s.folder_id === BARLIN ? 'Barlin Residence' : 'Project ' + n]);
    await q(`insert into pr_project_settings (folder_id, owner_id, allow_requests, allow_history, updated_by) values ($1, $2, $3, $4, $2)`,
      [s.folder_id, OWNER, s.allow_requests, s.allow_history]);
  }
  for (const b of REC.batches) {
    await q(`insert into pr_batches (id, owner_id, cutoff_at, purchase_on, delivery_on) values ($1, $2, $3, $4, $5)`,
      [b.id, OWNER, b.cutoff_at, b.purchase_on, b.delivery_on]);
  }
  for (const i of REC.items) {
    await q(`insert into pr_catalog_items (id, owner_id, name, kind, spec, unit, category, active, aliases, brand, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [i.id, OWNER, i.name, i.kind, i.spec, i.unit, i.category, i.active, i.aliases, i.brand, i.created_at]);
  }
  for (const r of REC.requests) {
    await q(`insert into pr_requests (id, owner_id, requester_id, team_id, folder_id, work_folder_id, client_op_id, drafted_at, received_at,
             status, cancelled_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [r.id, OWNER, r.requester_id, r.team_id, r.folder_id, r.work_folder_id, r.client_op_id, r.drafted_at, r.received_at, r.status, r.cancelled_at]);
    await q(`insert into pr_events (owner_id, request_id, actor_id, kind) values ($1, $2, $3, 'submitted')`, [OWNER, r.id, r.requester_id]);
  }
  for (const l of REC.lines) {
    await q(`insert into pr_lines (id, owner_id, request_id, position, kind, catalog_item_id, description, spec, unit, status, version,
             ref_kind, ref_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [l.id, OWNER, l.request_id, l.position, l.kind, l.catalog_item_id, l.description, l.spec, l.unit, l.status, l.version,
       l.ref_kind, l.ref_id, l.created_at]);
  }
  for (const p of REC.portions) {
    await q(`insert into pr_line_portions (id, owner_id, line_id, batch_id, quantity, arranged_at, arranged_by, pending_reduction, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [p.id, OWNER, p.line_id, p.batch_id, p.quantity, p.arranged_at, p.arranged_by, p.pending_reduction, p.created_at]);
  }
  const requester = (rid) => REC.requests.find(r => r.id === rid).requester_id;
  for (const p of REC.photos) {
    await q(`insert into pr_photos (id, owner_id, request_id, line_id, storage_path, uploaded_by, gallery_review) values ($1, $2, $3, $4, $5, $6, $7)`,
      [p.id, OWNER, p.request_id, p.line_id, p.storage_path, requester(p.request_id), p.gallery_review]);
  }
  for (const r of REC.refs) {
    await q(`insert into pr_item_refs (id, owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision,
             source_note, created_by, created_at, retired_by, retired_at, retire_reason) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $2, $10, $2, $11, $12)`,
      [r.id, OWNER, r.catalog_item_id, r.folder_id, r.work_folder_id, r.description, r.ref_date, r.date_precision, r.source_note,
       r.created_at, r.retired_at, r.retire_reason]);
  }
  for (const g of REC.gallery) {
    await q(`insert into pr_gallery_photos (id, owner_id, catalog_item_id, storage_path, source, source_photo_id, is_cover, status,
             checklist_confirmed, approved_by, approved_at, retired_by, retired_at, retire_reason)
             values ($1, $2, $3, $4, $5, $6, $7, $8, true, $2, $9, $10, $11, $12)`,
      [g.id, OWNER, g.catalog_item_id, g.storage_path, g.source, g.source_photo_id, g.is_cover, g.status, g.approved_at,
       g.retired_at ? OWNER : null, g.retired_at, g.retire_reason]);
  }
  for (const c of REC.conflicts) {
    await q(`insert into pr_line_conflicts (id, owner_id, line_id, proposed_by, base_version, current_version, proposed_quantity, current_quantity)
             values ($1, $2, $3, $4, 1, 2, 1, 1)`, [c.id, OWNER, c.line_id, W7]);
  }
  for (const b of REC.blockers) await q(`insert into wp_blockers (id, request_id) values ($1, $2)`, [b.id, b.request_id]);
  return db;
}

// Everything the script could touch, in one value.
async function fingerprint(db) {
  const parts = [];
  for (const [t, order] of [['pr_requests', 'id'], ['pr_lines', 'id'], ['pr_line_portions', 'id'], ['pr_events', 'id'],
                            ['pr_catalog_items', 'id'], ['pr_project_settings', 'folder_id'], ['pr_photos', 'id'], ['pr_item_refs', 'id'],
                            ['pr_gallery_photos', 'id'], ['wp_blockers', 'id'], ['pr_line_conflicts', 'id']]) {
    parts.push((await one(db, `select md5(coalesce(jsonb_agg(to_jsonb(t) order by ${order})::text, '')) h from ${t} t`)).h);
  }
  return parts.join('');
}
async function workerSees(db, worker) {
  return (await one(db, `select pr_history_search_doc($1, $2, false, null, null, null, null, null, null, 50, 0) d`, [OWNER, worker])).d.items
    .map(x => x.name).sort();
}
async function phoneKeeps(db, worker) {
  await db.exec(`select set_config('test.uid', '${worker}', false)`);
  const v = (await one(db, `select pr_history_visible($1::uuid[]) v`, ['{' + TEST_ITEMS.join(',') + '}'])).v;
  await db.exec(`select set_config('test.uid', '', false)`);
  return v.map(x => x.item_id);
}

console.log('\nItem history readiness — the pilot close script (0085 … 0108 on PGlite, the live pilot records)');

await test('the script expects exactly the exported records (one source: ih_pilot_records.json)', async () => {
  const lit = JSON.parse(SCRIPT.split('$exp$')[1]);
  const tests = new Set(REC.test_items);
  eq(lit.requests, REC.requests.map(r => ({ id: r.id, requester_id: r.requester_id, folder_id: r.folder_id, work_folder_id: r.work_folder_id,
    status: r.status, received_at: r.received_at, cancelled_at: r.cancelled_at })), 'requests');
  eq(lit.lines, REC.lines.map(l => ({ id: l.id, request_id: l.request_id, position: l.position, kind: l.kind, description: l.description,
    spec: l.spec, unit: l.unit, status: l.status, catalog_item_id: l.catalog_item_id, version: l.version, needed: l.needed })), 'lines');
  eq(lit.portions, REC.portions.map(p => ({ id: p.id, line_id: p.line_id, batch_id: p.batch_id, quantity: p.quantity,
    pending_reduction: p.pending_reduction, arranged: p.arranged_at !== null })), 'portions');
  eq(lit.items, REC.items.filter(i => tests.has(i.id)).map(i => ({ id: i.id, name: i.name, kind: i.kind, spec: i.spec, unit: i.unit,
    category: i.category, active: i.active })), 'items');
  eq([lit.requests.length, lit.lines.length, lit.portions.length, lit.items.length], [17, 20, 7, 3]);
  eq(lit.portions.filter(p => p.arranged).map(p => p.quantity), [5], 'one arranged portion, 5 pc');
});

await test('before: workers find only the three test items; the phone keeps them', async () => {
  const db = await copy();
  eq(await workerSees(db, W27), ['RAM', 'ZZ pilot drill', 'ZZ test pipe'], 'any worker — through Barlin, history on');
  eq((await phoneKeeps(db, W7)).length, 3, 'pr_history_visible keeps all three for W-0007');
});

await test('the dry run passes every guard on the exact copy and changes nothing', async () => {
  const db = await copy();
  const before = await fingerprint(db);
  const msg = await refused(db.exec(SCRIPT), 'DRY RUN OK (nothing changed)', 'the dry run');
  assert(msg.includes('7 open lines cancelled') && msg.includes('15 catalogue matches removed') && msg.includes('28 history events')
         && msg.includes('0 pilot portions left'), msg);
  eq(await fingerprint(db), before, 'nothing changed');
});

await test('the real run makes exactly the intended changes; no worker finds a test item; the phone forgets them; history kept', async () => {
  const db = await copy();
  const ev0 = Number((await one(db, `select count(*) n from pr_events`)).n);
  await db.exec(real());
  eq(Number((await one(db, `select count(*) n from pr_requests where status = 'cancelled'`)).n), 17, 'all 17 cancelled, none deleted');
  eq(Number((await one(db, `select count(*) n from pr_lines`)).n), 20, 'the 20 lines kept');
  eq(Number((await one(db, `select count(*) n from pr_lines where status = 'open' or catalog_item_id = any($1::uuid[])`, ['{' + TEST_ITEMS.join(',') + '}'])).n), 0);
  eq((await all(db, `select description from pr_lines where id = '5683408d-d145-4fd3-aac4-086a395b378e'`)).map(r => r.description), ['ZZ outlet'], 'the worker\'s words kept');
  eq(Number((await one(db, `select count(*) n from pr_events`)).n), ev0 + 28, '28 events');
  eq((await all(db, `select kind, count(*)::int n from pr_events where actor_id = $1 group by kind order by kind`, [OWNER])),
     [{ kind: 'item_matched', n: 15 }, { kind: 'office_line_cancelled', n: 7 }, { kind: 'portion_unarranged', n: 1 }, { kind: 'request_cancelled', n: 5 }]);
  eq((await all(db, `select active from pr_catalog_items where id = any($1::uuid[])`, ['{' + TEST_ITEMS.join(',') + '}'])).map(r => r.active), [false, false, false]);
  eq((await all(db, `select count(*)::int n from pr_catalog_items where active`)).map(r => r.n), [3], 'the three real items still active');
  for (const w of [W7, W19, W21, W27]) {
    eq(await workerSees(db, w), [], 'worker ' + w + ' finds nothing');
    eq(await phoneKeeps(db, w), [], 'the phone clean-up keeps nothing for ' + w);
  }
  eq(Number((await one(db, `select count(*) n from pr_photos`)).n), 4, 'photos kept');
  eq(Number((await one(db, `select count(*) n from pr_item_refs`)).n), 2, 'references kept');
  eq(Number((await one(db, `select count(*) n from pr_gallery_photos`)).n), 10, 'gallery kept');
  eq(Number((await one(db, `select count(*) n from wp_blockers`)).n), 1, 'the blocker kept');
  eq((await all(db, `select allow_requests, allow_history from pr_project_settings where folder_id = $1`, [BARLIN])),
     [{ allow_requests: true, allow_history: true }], 'Barlin\'s switches unchanged');
  const again = await refused(db.exec(SCRIPT), 'GUARD: a request is not as reviewed', 'a second run');
  assert(!again.includes('after'), again);
});

// Every changed record is refused before anything happens, and nothing changes.
const L = (id) => id;   // readability below
const SPOILS = [
  ['a line\'s words changed', `update pr_lines set description = 'ZZ outlet box' where id = '5683408d-d145-4fd3-aac4-086a395b378e'`,
   'GUARD: a line is not as reviewed', '5683408d'],
  ['a line\'s unit changed', `update pr_lines set unit = 'box' where id = '67e2a223-3064-49f1-ae47-15c4c1bede9f'`,
   'GUARD: a line is not as reviewed', '67e2a223'],
  ['a line\'s spec changed', `update pr_lines set spec = '8' where id = '0f204a72-6cb5-4061-b178-71617de1e7b6'`,
   'GUARD: a line is not as reviewed', '0f204a72'],
  ['a line\'s quantity changed (6 → 7)', `update pr_line_portions set quantity = 7 where id = '68a58f43-e00c-435c-b7b1-ddea4c51920a'`,
   'GUARD: a line is not as reviewed', '67e2a223'],
  ['an open line cancelled meanwhile', `update pr_lines set status = 'cancelled' where id = 'f8cd7dd9-4617-4efe-bc9a-6136bbde4b89'`,
   'GUARD: a line is not as reviewed', 'f8cd7dd9'],
  ['a test line matched to a real item', `update pr_lines set catalog_item_id = '86a02de4-db1d-40f2-8868-46686f11abb8' where id = '0f204a72-6cb5-4061-b178-71617de1e7b6'`,
   'GUARD: a line is not as reviewed', '0f204a72'],
  ['an unmatched line matched to a test item', `update pr_lines set catalog_item_id = 'eb89b45d-5af1-4661-bbd6-7bc08ca1a73d' where id = '3d08f1d2-6ff6-4178-858f-e6ecefe5c754'`,
   'GUARD: a line is not as reviewed', '3d08f1d2'],
  ['a line edited and put back (version moved)', `update pr_lines set version = version + 1 where id = 'b003f79b-cfc4-498d-8bc2-0b391d851e02'`,
   'GUARD: a line is not as reviewed', 'b003f79b'],
  ['a line added to a pilot request', `insert into pr_lines (owner_id, request_id, description, unit) values ('${OWNER}', '763ed71c-ccc3-447a-b6d9-e94cdfd757b9', 'ZZ extra', 'pc')`,
   'GUARD: a line is not as reviewed', 'ZZ extra'],
  ['a real line elsewhere matched to a test item', `insert into pr_requests (id, owner_id, requester_id, folder_id, work_folder_id) values ('00000000-0000-0000-0000-0000000000f1', '${OWNER}', '${W27}', '${BARLIN}', '${BARLIN}');
     insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id) values ('${OWNER}', '00000000-0000-0000-0000-0000000000f1', 'pipe', 'pc', 'eb89b45d-5af1-4661-bbd6-7bc08ca1a73d')`,
   'GUARD: a request is not as reviewed', '0000000000f1'],
  ['a new real request', `insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ('${OWNER}', '${W27}', '${BARLIN}', '${BARLIN}')`,
   'GUARD: a request is not as reviewed', ''],
  ['a pilot request cancelled meanwhile', `update pr_requests set status = 'cancelled', cancelled_at = now() where id = 'edc66d2f-cecf-4016-b9a5-e6638ab6d46f'`,
   'GUARD: a request is not as reviewed', 'edc66d2f'],
  ['the arranged portion split 4 + 1 (same total)', `update pr_line_portions set quantity = 4 where id = 'e65f8f0f-9715-496f-be4d-6f923e342b01';
     insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ('${OWNER}', '10128bce-5568-49c0-9052-fe4df4d6cb06', '08c4f2d5-fdeb-4d85-b239-609990d2825a', 1)`,
   'GUARD: a portion is not as reviewed', 'e65f8f0f'],
  ['the arranged portion un-arranged meanwhile', `update pr_line_portions set arranged_at = null, arranged_by = null where id = 'e65f8f0f-9715-496f-be4d-6f923e342b01'`,
   'GUARD: a portion is not as reviewed', 'e65f8f0f'],
  ['a pending reduction (same still-needed)', `update pr_line_portions set quantity = 7, pending_reduction = 1 where id = '68a58f43-e00c-435c-b7b1-ddea4c51920a'`,
   'GUARD: a portion is not as reviewed', '68a58f43'],
  ['a buyer took a portion', `update pr_line_portions set buyer_id = '${OWNER}' where id = '09e0ebc0-5dc3-4aff-94a5-5f1cd51b59c9'`,
   'GUARD: a portion is not as reviewed', '09e0ebc0'],
  ['a test item renamed', `update pr_catalog_items set name = 'ZZ test pipe 2' where id = 'eb89b45d-5af1-4661-bbd6-7bc08ca1a73d'`,
   'GUARD: a test item is not as reviewed', 'ZZ test pipe'],
  ['a test item deactivated already', `update pr_catalog_items set active = false where id = 'fdfaa19d-becc-4ca5-aba0-947d76f3b953'`,
   'GUARD: a test item is not as reviewed', 'RAM'],
];
for (const [why, spoil, want, names] of SPOILS) {
  await test('refused, nothing changed: ' + why, async () => {
    const db = await copy();
    await db.exec(spoil);
    const before = await fingerprint(db);
    for (const run of [SCRIPT, real()]) {
      const msg = await refused(db.exec(run), want, why);
      assert(!msg.includes('GUARD: after'), 'refused before any change: ' + msg);
      assert(msg.includes(names), 'names what differs (' + names + '): ' + msg);
      eq(await fingerprint(db), before, why + ': nothing changed');
    }
  });
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Modify:** `package.json`

```diff
diff --git a/package.json b/package.json
index c1c36e0..a9a2550 100644
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/3a_tools.pglite.mjs && node supabase/tests/3a_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0107 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0107 && node supabase/tests/2a3_server.pglite.mjs --with-0107 && node supabase/tests/2a4_payments.pglite.mjs --with-0107 && node supabase/tests/2b_stock.pglite.mjs --with-0107 && node supabase/tests/2c_cost.pglite.mjs --with-0107 && node supabase/tests/2bb_phone.pglite.mjs --with-0107 && node supabase/tests/3a_tools.pglite.mjs --with-0108 && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/3a_tools.pglite.mjs && node supabase/tests/3a_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0107 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0107 && node supabase/tests/2a3_server.pglite.mjs --with-0107 && node supabase/tests/2a4_payments.pglite.mjs --with-0107 && node supabase/tests/2b_stock.pglite.mjs --with-0107 && node supabase/tests/2c_cost.pglite.mjs --with-0107 && node supabase/tests/2bb_phone.pglite.mjs --with-0107 && node supabase/tests/3a_tools.pglite.mjs --with-0108 && node supabase/tests/ih_pilot_close.pglite.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**The two corrections** (added on the line after the outdated sentence, which stays):

```markdown
> **Correction (29 Oct 2026):** Item history was already **on** for all 10 open sites — Barlin since 12 Oct 10:40, the other nine since 12 Oct 12:48 (admin@). What remained is the clean-up and readiness in [2026-10-29-item-history-readiness.md](2026-10-29-item-history-readiness.md).
```

(In the spec, the link is `../plans/2026-10-29-item-history-readiness.md`.)

- [ ] **Step 1: Apply** the files; keep each file's line endings.
- [ ] **Step 2: Checks.** `node supabase/tests/ih_pilot_close.pglite.mjs` → **22 passed** (its expectations are the records; the dry run changes nothing; the real run does exactly what R1–R4 say; 18 kinds of changed data refused with nothing changed). `npm run test:sql` → every suite passes (**45**, 1,376 tests). `npm test` → every suite passes (**42**). The script's `v_dry boolean := true;` as committed.
- [ ] **Step 3: Claude's memory** corrected (R8): the Requests note, the Stage 2/3 decisions note, the index line.
- [ ] **Step 4: Stop for the user** to review and commit. Do not push yet.

### Task 2: Live — the clean-up (the user runs it; Claude verifies)

- [ ] **Step 1: Phone seed first** — Task 3, S1–S2 (before the script; the seeded item must be saved while it is still visible).
- [ ] **Step 2: Dry run.** Supabase SQL editor → paste the committed `supabase/tests/item_history_pilot_close.sql` → **Run** as is. Expect a red **"DRY RUN OK (nothing changed): 17 pilot requests kept (all now cancelled), 20 lines kept with their words; 1 portion un-arranged, 7 open lines cancelled with a reason, 15 catalogue matches removed, 3 test items deactivated; 28 history events written (admin@); 0 pilot portions left; no worker finds a test item and every phone is told to forget them; the office still sees them; photos, references, gallery, blocker, conflict, money, purchases, stock, tools and the project switches unchanged."** If it says **GUARD: …**, stop and send the message — it names what differs from the reviewed records; nothing was changed.
- [ ] **Step 3: The real run.** Change `v_dry boolean := true;` to `false;` → **Run** → "Success. No rows returned". Note the time.
- [ ] **Step 4: Verify (MCP, read-only):** 17 requests, all cancelled; 20 lines, none open, none matched to a test item, words kept; 86 events (the 28 new ones by admin@, with the reason); the three test items inactive; for every active crew member, `pr_history_search_doc` lists no test item and `pr_history_visible` (as that worker) returns `[]`; the office still finds the two ZZ items; photos, references, gallery, blocker, conflict, expenses (count and sum), purchases, stock, tools and the 10 project switches as before.

### Task 3: Checks — office and phone (the user; Claude reads the log)

**Office (Dacs Web, owner), after Task 2:**

| # | Do | Expect |
|---|---|---|
| O1 | Requests → **Queue** | No pilot request waiting |
| O2 | Open the 7 Oct 18:21 request (W-0021) | Its 3 lines **Cancelled**; history: *Cancelled — Pilot test data …*, and *Removed the catalogue match* on "ZZ pilot drill"; the worker's words kept |
| O3 | Requests → **Catalogue** | ZZ test pipe, ZZ pilot drill, RAM **inactive**; the three PVC items active |
| O4 | Requests → **Item history** → search "ZZ" | The two ZZ items, inactive, no requests listed — only their retired references and photos |

**Phone (WorkMate 0.9.0, W-0007, the test phone):**

*Before Task 2 — seed a saved test item:*

| # | Do | Expect |
|---|---|---|
| S1 | Online: Requests → **Find Previous Item** → tap **ZZ test pipe** to open its page; back | The item page opens (this saves it on the phone) |
| S2 | **Airplane mode on** → open Find Previous Item | **ZZ test pipe** listed from the phone's saved copy (marked as saved / offline). *If it is not listed, the seed failed — repeat S1 with signal; don't go on until S2 shows it.* Airplane **off** |

*After Task 2:*

| # | Do | Expect |
|---|---|---|
| P1 | With signal: open **Find Previous Item**, wait about 10 seconds, search "pipe" | **No test item.** Opening the screen runs the phone's clean-up |
| P1b | *(Claude)* Read the API log for the phone's `POST /rest/v1/rpc/pr_history_visible` after Task 2 Step 3's time | **Status 200** — the clean-up ran and got the server's answer, which the script proved is empty for W-0007 |
| P2 | **Airplane mode on** → open Find Previous Item; search "pipe", "plug", "RAM" | **No test item** — the saved ZZ test pipe is gone. Airplane **off** |
| P3 | **My requests** | W-0007's pilot requests still there, all **Cancelled**, with their own words (R7) |
| P4 | **New request** on Barlin → pick an item | No ZZ test pipe, ZZ pilot drill or RAM; the three PVC items offered. **Back out without sending** (opening it with signal also replaces the phone's saved Add item list) |
| P4b | Then **airplane mode on** → **New request** on Barlin → pick an item | The phone's saved Add item list shows **no ZZ test pipe, ZZ pilot drill or RAM**; the three PVC items still there. **Back out without sending**; airplane **off**. *If a test item still shows: with signal, open New request once more (that replaces the saved list), then repeat P4b; still there → record it as an app finding in the notes — online the server offers active items only* |
| P5 | Only if Task 4 added a reference: search "sanitary" | The item with its photo and a *Historical reference* entry |

*If the clean-up fails* — P1b shows no `pr_history_visible` call after the script, or not 200, or P2 still lists a test item:

| # | Do | Then |
|---|---|---|
| F1 | With good signal, close Find Previous Item and open it again; wait about 10 seconds | Claude reads the log again; when a 200 call appears, repeat P2 |
| F2 | Still listed: check the phone has nothing waiting to send (no request or attendance marked waiting), then **sign out of WorkMate** and sign back in as W-0007 | Signing out wipes the phone's whole saved copy (spec 1b §4.4); repeat P2 — expect nothing saved |
| F3 | Still listed after F2 | Stop; record it as an **app defect** in this plan's notes (with the log lines) — the server side is already clean, so no worker finds a test item online, and the saved copy expires on its own 14 days after S1 |
| F4 | P1b shows the call **failing** (an error status) | Send Claude the time; Claude reads the server's logs for that call. A server error is investigated before F1 is repeated — any fix is its own reviewed change |

### Task 4: Verified references (only with evidence)

- [ ] **Step 1:** The user says, for each real item, whether there is evidence (R6) — what, where, when. None is a valid answer.
- [ ] **Step 2:** For each item with evidence, the office adds the reference in Dacs Web (project, date — exact / approximate / unknown — description, and the evidence in the source note). Claude checks it read-only and P5 is run.

### Task 5: Notes

- [ ] **Step 1:** Execution notes in this plan (what ran, the counts, the checks, the log lines of P1b, any references and their evidence); memory updated; the user commits.

---

## Self-review

| Asked | Where |
|---|---|
| Identify the exact test records | *What is on record* and the exported records file — the 17 requests, 20 lines, 7 portions, 3 test items, each value; the script refuses anything else |
| **Guards verify each affected line's description, quantity, unit, status and catalogue match, plus the arranged portion's exact quantity; any mismatch stops the whole script** | R4 — every line (also spec, kind, position, version), every portion (the arranged one exactly 5 pc), every request and test item; `GUARD: …` before any change, the transaction undone |
| **Test that changed data is refused without changes** | `ih_pilot_close.pglite.mjs`: 18 changed-data cases, each run as dry run and as real run — refused with a `GUARD` before any change, naming what differs, and the database's fingerprint identical before and after |
| Preserve real requests and all request history | None real exists (guarded); nothing deleted by hand; every change an office operation in the history; the 28 new events checked exactly (R1–R5) |
| Explain how test items are hidden from search | R1 (no matched line, references already retired → nothing to show; `pr_history_visible` forgets them on phones), R2 (inactive → not offered for new use); checked for every crew member |
| **The offline check proves the saved copy was cleaned; what to do if that fails** | R9; Task 3 S1–S2 (seed, proved offline), P1–P2 (clean-up run, confirmed in the API log, then offline), F1–F4; P4–P4b (the phone's saved Add item list refreshed online, then checked offline) |
| Only verified references | R6, Task 4 — none from the system; only the user's evidence |
| Correct the outdated notes | R8, Task 1 Steps 1 and 3 |
| Switches unchanged | Global constraints; the script checks the 10 project rows are as before |
| R7 stays separate | Global constraints; R7 |

## Proof

- **Read-only investigation (29 Oct):** the switch rows (`pr_project_settings`, with who and when); every request, line, portion, photo, conflict, event count, reference and gallery row — exported into `ih_pilot_records.json`; the foreign keys and triggers on the request tables (none blocks or audits outside `pr_events`); every link from purchases, stock, tools and the Work Plan; the worker and office search functions and `pr_history_visible` (0090) and the phone's item picker (`pr_catalog`, active only); WorkMate's history code (saved only from an opened item page, 14-day limit, clean-up on opening Find Previous Item — silent on failure — and the sign-out wipe); expenses, purchases, weekly bills, overhead, inventory, old requests, quotations, BOQs and accomplishment reports for the real items.
- **The test (PGlite, the live records, the real office functions 0085 … 0108):** 22 tests — the script's expectations are exactly the exported records; before the clean-up any worker finds only the three test items and the phone keeps them; the dry run passes every guard and changes nothing (the fingerprint of every request, line, portion, event, catalogue, switch, photo, reference, gallery, blocker and conflict row identical); the real run cancels and unlinks exactly as R1–R4 say — 17 requests and 20 lines kept with their words, 28 events by admin@ (15 matches removed, 7 line and 5 request cancels, 1 un-arrange), the three test items inactive, the real items active, nothing found by W-0007, W-0019, W-0021 or another worker and `pr_history_visible` empty for each, photos, references, gallery and blocker kept, Barlin's switches unchanged — and a second run refuses; and **18 kinds of changed data refused with nothing changed**, each as a dry run and as a real run: a line's words, unit, spec, quantity (6 → 7), status or catalogue match changed, an unmatched line matched to a test item, a line edited and put back (version), a line added, a real request with a line matched to a test item, a new request, a pilot request cancelled meanwhile, the arranged portion split 4 + 1 (same total) or un-arranged, a pending reduction with the same still-needed, a buyer on a portion, a test item renamed or already deactivated — every one stopped by a `GUARD` before any change, naming what differs.
- **Breakage run:** **10 / 10 caught** — each guard switched off, or made to ignore one field, one at a time, and the test must fail: the requests, lines, portions and test-items guards off; the lines guard ignoring the words, the unit, the quantity, the status or the catalogue match; the portions guard ignoring arranged. The file restored and compared afterwards. (The first run of the test also caught a real defect in the draft script: a table alias `c` clashing with the script's loop variable `c` — renamed `ci`.).
- **The script, dry-run on the live database (MCP), rolled back:** the whole `do` block exactly as committed — every guard passed (so every exported value matches live) and it reported exactly Task 2 Step 2's message. Before and after, read-only: requests 17 (5 open), lines 20 (7 open), portions 7, events 58, matched lines 15, active items 6, projects with Item history on 10 — unchanged.
- **Suites (scratch clone on `4dcfa7e`, Task 1 applied):** `npm test` 42 suites, none failed; `npm run test:sql` **45** suites, **1,376** tests, none failed (before this plan 44 / 1,354, plus the new 22).
- **Rehearsal:** the plan's own text (`_ih_rehearse.py`: Create blocks written as given, the `package.json` diff through `git apply --ignore-whitespace`) applied to fresh clones at `4dcfa7e` — plain, and with the user's own one-space `admin.html` edit made first: the 4 files byte-identical to the tested build; nothing stray.
- **Not done here:** the office and phone checks (Task 3), the real run (Task 2) — the live database was not changed.
