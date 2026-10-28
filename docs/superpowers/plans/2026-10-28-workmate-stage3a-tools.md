# WorkMate Stage 3a — Tools (server + Dacs Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office registers every real tool the company owns — numbered **TOOL-0001…** — and records who answers for each one, on which project: **issue**, **hand over** person to person, **return** with its condition, **repaired**, **lost** and **found**, **retired** — with Lost and Retire decided by the **main owner**. A tool request line is filled by tools **once**. No money anywhere. Then a **ZZ pilot** with a guarded clean-up, and the user keeps tools on (launch) or switches them off.

**Architecture:** One migration, **0107**, adds five private tables (`tl_settings`, `tl_tools`, `tl_records`, `tl_covers`, `tl_events`) read and written only through `tl_*` functions, in the same shape as stock (0104): a switch the main owner sets, an operation id on every write (`pur_ops`), the tool row locked for each action, and every record keeping the tool's custody **before and after** it — so a reversal, a withdrawal or an owner's rejection puts the tool back exactly. Tools join the request figures through one new term in `pr_line_bought` / `pr_portion_bought` (purchases + stock + **tools issued for the line that were not bought for it**), and triggers keep tool items out of quantity stock and keep a purchase line from losing the tools registered from it. Dacs Web gets **Requests → Tools** (`js/tools-admin.js`), the tools-out note in Project Control's **Mark as Complete**, and "Issued: TOOL-0007" on the shopping list. The phone part (**3b**) comes later, with the crew's move to WorkMate.

**Tech stack:** PostgreSQL / Supabase (SQL), vanilla JS and Node tests, PGlite, embedded PostgreSQL for the two-session tests.

**Spec:** [WorkMate guide](../specs/2026-09-29-workmate-prototype-and-workflow-guide.md) §12 *Reusable tools*, §16 Stage 3 · answers: [Stage 3 Tools questions](../specs/2026-10-28-workmate-stage3-tools-questions.md) — **Q1–Q2 = A (3a web first, 3b phone later), Q3–Q24 = A ("I approve all R", 28 Oct 2026)**, revision 2 with the user's corrections to Q7, Q8, Q10, Q14, Q16, Q17 and Q23 · built on: plans [2B-a](2026-10-25-workmate-stage2b-a-stock.md) (0104), [2C](2026-10-26-workmate-stage2c-cost-moves.md) (0105), [2B-b](2026-10-27-workmate-stage2b-b-phone.md) (0106) — all live, stock **on** since 28 Oct.

**Repo:** **Dacs Web** only (base `d00b0eb`). Tasks 1–2 build it; Task 3 puts 0107 live with tools **off** and pushes the web; Task 4 is the ZZ pilot and the launch decision. WorkMate is untouched (3b).

**Status:** Revision 3, 29 October 2026 — **approved by the user on 29 October 2026** ("Approved revision 3. Proceed with Task 1 only"). Revision 3 follows the user's review of revision 2: a tool **registered at a project as "Needs repair" or "Missing parts"** became Issued and could still be handed over. Now it **stays with its named person and project but is not usable**: a handover is refused (`NEEDS_REPAIR`) until it is marked **Repaired** where it is — which keeps the same person, project and days out — and then it can be handed over; it can always be returned (to the warehouse, Under repair) or reported lost. T1 = C stays accepted. Revision 2 followed the user's review of revision 1: (1) **the damaged-registration path** — revision 1 refused to register a tool already damaged beyond repair, so the only way in was to record a false condition; now it is registered **at the warehouse**, Under repair, with a **Retire request** for the main owner (as a damaged return), and refused at a project (`DAMAGED_AT_PROJECT`); (2) **Q7's opening photo is required again** — an opening registration without a photo is refused (`PHOTO_REQUIRED`); from a purchase line it stays optional (Q8); (3) **T1 (who can hold a tool): the user chose C** — anyone active in the company: workers, team leaders, office staff and owner accounts; never a client or partner account, a deactivated account or another company's people. Holders' names follow their kind of account (`tl_person_name`: the crew by name or worker number, the office by name or e-mail). Nothing is applied live and nothing is in the real repo. The code below was built and tested first in a scratch clone (one commit per task, every suite green after each), every important rule was broken on purpose to prove a test catches it (see *Proof*), and the plan was re-applied to a fresh clone from its own text and compared byte for byte (see *Rehearsal*). **The rulings T1–T20 below are this plan's own decisions where the answers left a detail open — please check them.**

## Global Constraints

- **No money (Q5):** nothing in tools reads or writes a peso, an `expenses` / `payroll` row or Spent; no value per tool, no depreciation, no charge for using one. The screens show no amount, to anyone.
- **Tools are never quantity stock (Q6):** a catalogue item of kind `tool` is only ever numbered tools. 0104's stock refuses it (`TOOL_ITEM`), and a purchase line with tools registered from it never becomes stock (`TOOL_LINE`).
- **The opening register keeps a photo of each tool (Q7):** an opening registration without one is refused (`PHOTO_REQUIRED`); one from a recorded purchase line may have one.
- **A named responsible person (rev 2, Q7–Q10):** a tool at a project always has one — the server refuses a registration, issue or handover at a project without one (`PERSON_REQUIRED`). There is no "at the site, no one".
- **The main owner decides Lost and Retire (rev 2, Q16–Q17):** while waiting, the tool cannot be issued, handed over or returned. A rejection (or the office's withdrawal) puts it back where it was; a rejected Retire leaves it **Under repair**.
- **One tool fills a request line once (rev 2–3, Q14):** covered = purchases + stock + tools issued for the line that were **not** bought for it. A return or handover keeps the line filled; reversing an issue reopens it only if that issue counted on its own; a tool bought for the same request stays counted through its purchase.
- **Never edited (Q18):** a mistake is reversed with a reason, while it is the tool's latest record.
- **Off until the main owner switches it on (Q23):** first for the ZZ pilot, then kept on (launch) or switched off. **Only the user presses the switch.**
- **New data needs real DB columns:** every column 0107 writes is created by 0107. Task 3 Step 1 checks the live functions 0107 redefines still match 0104's before applying.
- **Migrations:** next number = highest + 1 = **0107** (highest on disk: `0106_workmate_phone_stock.sql`). The user applies the **committed** file, unchanged, once (SQL editor); we then verify the live database ourselves.
- **Dates:** a tool's "days out" is counted by the Philippine calendar on the server (`tl_days`); a photo's month folder from local date parts, never `toISOString()`.
- **The user commits.** Executors never run `git commit` or `git push`. Each task ends at a "stop for the user" step. The user's own uncommitted edit in `admin.html` stays as it is: apply the Modify blocks with `git apply`, which leaves the rest of the file alone.
- **CRLF files:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are CRLF. Task 1's Step 1 restores CRLF after applying (the diffs are shown with LF).

## Rulings (3a)

Where the answers left a detail open, this plan decides as follows. Each is tested.

| # | Ruling |
|---|---|
| T1 | **Who can hold a tool — C (the user's decision, rev 2):** anyone **active in the company** — a worker, a team leader, office staff or an owner account (`tl_person`: roles worker, teamLeader, staff, owner of this company). Never a client or partner account, never another company's people (`BAD_PERSON`). A deactivated person keeps what they held (§12) but cannot receive more. The pickers list everyone active, the crew with their teams and the rest marked "(office)" / "(owner)"; names follow the account (`tl_person_name`). For 3b: office and owner accounts holding tools will need "My Tools" too. |
| T2 | **Who records:** owner and office staff allowed the Expenses section — stock's rule (`stk_can_record`, `pur_actor_owner('expenses_form')`). An owner-role account with its own scope records in its own scope (where tools are off until its own switch). Workers and team leaders record nothing in 3a. |
| T3 | **Numbers:** per company, the highest + 1 under a company lock (`tl_number:`), so two registrations at once never share or skip a number. A cancelled registration keeps its number. The pilot's clean-up removes its ZZ tools **with** their numbers, so the first real tool is TOOL-0001. |
| T4 | **Registering (rev 2):** 1–50 identical tools at a time, with a brand / model / serial note. Condition good, needs repair, missing parts — or **damaged beyond repair**, at the warehouse only: Under repair **plus a Retire request** for the main owner, as a damaged return (T7); at a project it is refused (`DAMAGED_AT_PROJECT`). At the warehouse: available if good, otherwise Under repair. At a project: **issued** to the named person — and if it **needs repair or is missing parts** it stays with that person and project but is **not usable** (rev 3): no handover until **Repaired** there (same person, project and days out; `NEEDS_REPAIR`), and it can always be returned. **The opening register needs a photo** (Q7, `PHOTO_REQUIRED`); several identical tools registered together share it (register them one at a time to give each its own). From a purchase line the photo is optional. |
| T5 | **From a purchase line:** never more tools than the line's quantity (`MORE_THAN_BOUGHT`); a warehouse line's tools start at the warehouse; a project line's at the warehouse or with someone on that project (`BAD_PLACE`); never a line already received or matched as stock (`LINE_IS_STOCK` — reverse its receipts first). The purchase lock is held, as stock does. |
| T6 | **"Tools to register":** recorded purchase lines bought for a **tool** request line (or with tools already registered from them) with places left. A warehouse line cannot be bought for a project's request (2A's rule), so an unlinked warehouse "grinder" line shows in Stock → Receiving until a tool is registered from it — then it leaves Receiving and never becomes stock. |
| T7 | **A damaged return** writes two records: the return (→ Under repair, condition damaged) and a pending **Retire** request. Rejecting it leaves the tool Under repair; withdrawing it too. |
| T21 | **Repaired (rev 3)** works on a tool Under repair at the warehouse (→ Available) and on an **issued** tool not in good condition (→ good, still with the same person and project, the same days out). Never on a tool in good condition (`NOT_IN_REPAIR`). Reversing it puts the condition back, and the tool is not usable again. |
| T8 | **Lost** can be reported for an available, issued or Under-repair tool, never one already waiting. A confirmed loss keeps who had it last; it is never reversed — **Found** brings it back (good → available, otherwise Under repair). A confirmed retirement is final. |
| T9 | **Filling a request (Q14):** an issue may name an open **tool** request line of the same project, of the tool's catalogue item (when the line names one) and unit. "Bought for it" is counted per purchase line: up to the quantity that purchase line covered on this request, its tools' issues count through the purchase; beyond that an issue counts on its own and must fit what the line still needs (`REQUEST_EXCEEDED` — issue it without a request). |
| T10 | **Reversing:** only the tool's **latest** record (`LATER_RECORDS`), by whoever recorded it or an owner; reversing a registration cancels the tool. Withdrawing a pending one: whoever recorded it or the main owner. |
| T11 | **Handover:** only a tool in good condition (`NEEDS_REPAIR` otherwise — rev 3); keeps the project unless another is picked; a tool on a project that has since been completed may still be handed over on that same project, never moved onto a completed one. |
| T12 | **Completed projects:** a tool is never issued, registered or moved **onto** one (`PROJECT_COMPLETED`); a tool already there can be returned, handed over or reported lost. Mark as Complete names the tools still out on the project **and its Additional Works jobs** and never blocks. |
| T13 | **The purchase guard** runs at the end of the transaction (a deferred constraint trigger), because a purchase correction deletes and re-inserts every line: the line with the same number must still exist with at least as many as were registered (`TOOLS_IN_USE`); a purchase with tools is never voided or replaced. |
| T14 | **A catalogue item used by a tool** keeps its kind and unit (`pr_item_in_use` counts tools — `ITEM_IN_USE`). |
| T15 | **Photos** (required for the opening register, T4) go to `uploads/tools/<company>/<yyyy-mm>/<uuid>.jpg` — readable and writable by owner and staff through 0081's generic rule (no new Storage rule; classified `admin` in the storage map). They are tool pictures, not receipts, so they skip the receipt ledger. A retried form uploads its photo once; nothing is overwritten. |
| T16 | **The shopping list** shows, per line, the tools issued for it ("Issued: TOOL-0007 (Mark, bought for this)"), a **Tools issued** figure and per weekly portion "… tools issued" — so Still to buy always adds up. Buyers and office accounts; empty while tools are off. |
| T17 | **The phone (0.9.0)** is unchanged in 3a: buyers' shopping lists already count tools through Still to buy; the words "Tools issued" come with 3b. Workers' own requests (`pr_my_requests`) are unchanged. 3b's "My Tools" must cover every kind of holder T1 allows (office and owner accounts sign in to WorkMate only as buyers today). |
| T18 | **The switch:** main owner only — **Switch tools on…** (type TOOLS) and **Switch tools off…** (type OFF), as stock's. Off refuses every write and undoes nothing. |
| T19 | **Request lines to fill** list open tool lines of the project with their Still to buy; the issue form offers those naming this tool's item or none. |
| T20 | **The clean-up** (`3a_pilot_cleanup.sql`) is 2B/2C's, word for word but for the `ZZ 3a` names, plus tools: it stops if a ZZ tool touched a real project, a real tool touched a ZZ project or request, or a ZZ purchase's tool was registered as a real item; it switches the tools history guards off for its own transaction only and checks they are back on. |

## File structure

| File | Task | What |
|---|---|---|
| `supabase/migrations/0107_tools.sql` | 1 | **New.** Tables, switch, operations, readers, request figures, stock and purchase guards, grants |
| `supabase/tests/3a_tools.pglite.mjs` | 1 | **New.** 45 tests on PGlite — every rule above (the opening photo and the damaged registration included), the live acceptance script (passes, and fails on five spoiled databases), the clean-up (a whole pilot beside real data; four spoiled pilots stopped) |
| `supabase/tests/3a_concurrency.mjs` | 1 | **New.** 7 two-session tests on real PostgreSQL, 15 rounds each |
| `supabase/tests/3a_acceptance.sql` | 1 | **New.** Live acceptance, rolls itself back (switches tools on and records a whole tool's life inside it) |
| `supabase/tests/3a_pilot_cleanup.sql` | 1 | **New.** The pilot's guarded clean-up (T20) |
| `supabase/tests/2a1…2a4, 2b_stock, 2c_cost, 2bb_phone` | 1 | `--with-0107`: each re-runs every test with 0107 on top |
| `package.json` | 1, 2 | `test:sql` runs the new suites and the seven re-runs (1); `test` runs `tools-admin.test.js` (2) |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` (CRLF), `CLAUDE.md` | 1 | Docs; the money invariant for tools |
| `js/tools-admin.js` | 2 | **New.** Requests → Tools |
| `tests/tools-admin.test.js` | 2 | **New.** 16 tests |
| `js/admin.js`, `admin.html`, `css/purchasing-admin.css` | 2 | The nav (Tools beside Stock; hidden until on; the focus exception), the page and script, styles |
| `js/expenses-module.js` | 2 | Mark as Complete names the tools still out (Q20) |
| `js/purchasing-admin-list.js` | 2 | The shopping list's tools (T16) |
| `tests/storage-access.test.js`, `tests/stock-admin.test.js`, `tests/purchasing-admin.test.js` | 2 | `tools` classified; the view list's order; `tl_line_tools` allowed |
| `docs/ARCHITECTURE.md` | 2 | The module map |

---

### Task 1: Dacs Web — 0107, its tests, the pilot's SQL, docs

**Interfaces produced:** the `tl_*` functions Task 2 calls — `tl_status()`, `tl_set_enabled(p_on)`, `tl_register(p_op, p_body)`, `tl_issue(p_op, p_body)`, `tl_handover(p_op, p_body)`, `tl_return(p_op, p_body)`, `tl_repaired(p_op, p_tool, p_note)`, `tl_report_lost(p_op, p_tool, p_reason)`, `tl_request_retire(p_op, p_tool, p_reason)`, `tl_found(p_op, p_body)`, `tl_decide(p_op, p_record, p_approve, p_note)`, `tl_reverse(p_op, p_record, p_reason)`, `tl_overview()`, `tl_tool(p_tool)`, `tl_choices()`, `tl_request_lines(p_folder)`, `tl_project_out(p_folder)`, `tl_line_tools(p_lines)`. Their answers: a tool `{id, number, label, item_id, item_name, item_spec, details, photo_path, state, condition, holder_id, holder_name, folder_id, folder_name, since, days, purchase_id, line_no, purchase_date, pending_record_id}`; a record `{id, tool_id, label, item_name, kind, status, before, after, holder_id, holder_name, folder_id, folder_name, from_holder_name, request_line_id, request_description, fills_request, condition, photo_path, note, recorded_by, recorded_by_name, recorded_at, decided_by_name, decided_at, decision_note, reversed, reversed_at, reverse_reason, reversed_by_name, latest}`.

**Create:** `supabase/migrations/0107_tools.sql`

```sql
-- 0107 — WorkMate Stage 3a: tools on the server (custody, no money).
--
-- Spec: docs/superpowers/specs/2026-09-29-workmate-prototype-and-workflow-guide.md
-- (§12 Reusable tools, §16 Stage 3); answers:
-- docs/superpowers/specs/2026-10-28-workmate-stage3-tools-questions.md (all A);
-- plan: docs/superpowers/plans/2026-10-28-workmate-stage3a-tools.md.
--
-- ── 1. What is a tool (Q3–Q6). Every catalogue item of kind "tool" is
--    tracked as NUMBERED tools — TOOL-0001, TOOL-0002… per company, never
--    reused (a cancelled, lost or retired tool keeps its number). From this
--    migration a tool item is never quantity stock: a match, a lot or a stock
--    record of a tool item is refused (TOOL_ITEM), and a purchase line that
--    has tools registered from it never becomes stock (TOOL_LINE).
--
-- ── 2. Getting tools in (Q7–Q9). The office registers each tool — from a
--    recorded purchase line (never more than it bought; its cost stays where
--    the purchase put it) or as an opening register, which needs a PHOTO of
--    the tool (Q7) — at the warehouse, or issued to a NAMED RESPONSIBLE
--    PERSON on a project. A tool at a project always has its person (Q10):
--    there is no "at the site, no one". A tool already damaged beyond repair
--    is registered at the warehouse: Under repair, with a Retire request
--    waiting for the main owner (as a damaged return, Q16).
--
-- ── 3. Custody (Q10–Q15). A tool is always in one state: available,
--    issued (one person, one project), repair, lost_pending, lost,
--    retire_pending, retired — or cancelled (registered by mistake). Only an
--    available tool is issued; an issued one is handed over person to person
--    (and project to project) or returned with its condition (Q16). A tool
--    registered at a project as needing repair or missing parts stays with
--    its named person and project but is NOT usable: it cannot be handed over
--    until it is marked Repaired there (or returned).
--
-- ── 4. Requests (Q13–Q14). A tool request line is filled by tools, each
--    counted once: FILLED = tools bought for the line (its purchases, as
--    before) + tools issued for it that were NOT bought for it (tl_covers).
--    A tool bought for the line and issued for it adds nothing — it is
--    already counted through its purchase. A return or a handover keeps the
--    line filled; reversing an issue reopens it only if that issue counted
--    on its own. pr_portion_bought / pr_line_bought (every Still to buy)
--    gain the tools term.
--
-- ── 5. The owner (Q16–Q17). Lost and Retire wait for the MAIN OWNER; while
--    they wait the tool cannot be issued, handed over or returned. Confirm →
--    lost / retired. Reject (or the office withdraws) → exactly where it was
--    before (a lost report), or Under repair (a retire request — it was
--    reported damaged). A lost tool can be Found.
--
-- ── 6. Never edited (Q18). A mistaken record is REVERSED with a reason, by
--    whoever recorded it or an owner, only while it is the tool's latest
--    record. A confirmed loss or retirement is not reversed (Found exists).
--
-- ── 7. No money (Q5). No peso amount is read or written here; nothing
--    touches expenses, Spent, Earned or Profit.
--
-- ── 8. Dormant until switched on (Q23). Every write is refused (TOOLS_OFF)
--    until the main owner switches tools on for the company — first for the
--    ZZ pilot, then kept on (launch) or switched off again.
--
-- Who holds a tool (T1 = C, the user's decision): anyone active in the
-- company — a worker, a team leader, office staff or an owner account —
-- never a client or partner account, never another company's people.
-- Who records: owner and office staff accounts allowed the Expenses section (the
-- same rule as stock); workers and team leaders record nothing in 3a (3b,
-- the phone, comes with the crew's move to WorkMate). Each call carries an
-- operation id (pur_ops): a retry returns the first answer. Locks: the
-- purchase, then the tool row, then request lines (pur_lock).

set local lock_timeout = '5s';

-- ════ 1. Tables ══════════════════════════════════════════════════════

-- The switch, one row per company that ever had it (main owner only).
create table if not exists tl_settings (
  owner_id uuid primary key references profiles(id),
  enabled boolean not null default false,
  updated_by uuid not null references profiles(id),
  updated_at timestamptz not null default now()
);

-- One real tool. folder_id is history, not a foreign key (as
-- purchase_lines.folder_id). holder / folder: who has it and where while
-- issued — and, while lost or waiting to be, who had it last.
create table if not exists tl_tools (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  number int not null check (number > 0),
  item_id uuid not null references pr_catalog_items(id),
  purchase_id uuid references purchases(id),
  line_no int,
  details text not null default '' check (char_length(details) <= 200),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  state text not null check (state in ('available', 'issued', 'repair', 'lost_pending', 'lost',
                                       'retire_pending', 'retired', 'cancelled')),
  condition text not null default 'good' check (condition in ('good', 'needs_repair', 'missing_parts', 'damaged')),
  holder_id uuid references profiles(id),
  folder_id uuid,
  since timestamptz not null default now(),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (owner_id, number),
  check ((purchase_id is null) = (line_no is null)),
  check (state <> 'issued' or (holder_id is not null and folder_id is not null)),
  check (state not in ('available', 'repair', 'retire_pending', 'retired', 'cancelled')
         or (holder_id is null and folder_id is null))
);
create index if not exists tl_tools_line on tl_tools (purchase_id, line_no) where purchase_id is not null;
create index if not exists tl_tools_holder on tl_tools (holder_id) where holder_id is not null;
create index if not exists tl_tools_folder on tl_tools (folder_id) where folder_id is not null;

-- One action on one tool. before / after: the tool's state, holder, folder
-- and condition around it (for a pending record, `after` is what the main
-- owner's confirmation sets). holder_id / folder_id: the custody the record
-- gave (issue, handover, register) or ended (return, lost).
create table if not exists tl_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id),
  tool_id uuid not null references tl_tools(id),
  kind text not null check (kind in ('register', 'issue', 'handover', 'return', 'repaired', 'lost', 'found', 'retire')),
  status text not null default 'done' check (status in ('done', 'pending', 'rejected', 'withdrawn')),
  before jsonb not null,
  after jsonb not null,
  holder_id uuid references profiles(id),
  folder_id uuid,
  request_line_id uuid references pr_lines(id),
  condition text check (condition is null or condition in ('good', 'needs_repair', 'missing_parts', 'damaged')),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  note text not null default '' check (char_length(note) <= 500),
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 500),
  reversed_by uuid references profiles(id),
  reversed_at timestamptz,
  reverse_reason text not null default '' check (char_length(reverse_reason) <= 500),
  check (status = 'done' or kind in ('lost', 'retire')),
  check (reversed_at is null or status = 'done')
);
create index if not exists tl_records_tool on tl_records (tool_id, recorded_at desc);
create index if not exists tl_records_owner on tl_records (owner_id, recorded_at desc);
create index if not exists tl_records_request_line on tl_records (request_line_id) where request_line_id is not null;

-- What an issue filled on a request line when the tool was NOT bought for
-- it (Q14). Counts while its issue is live.
create table if not exists tl_covers (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  record_id uuid not null references tl_records(id),
  request_line_id uuid not null references pr_lines(id),
  portion_id uuid references pr_line_portions(id) on delete set null,
  quantity numeric(14,3) not null check (quantity > 0)
);
create index if not exists tl_covers_portion on tl_covers (portion_id) where portion_id is not null;
create index if not exists tl_covers_request_line on tl_covers (request_line_id);
create index if not exists tl_covers_record on tl_covers (record_id);

-- Append-only: the switch, decisions, withdrawals and reversals.
create table if not exists tl_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references profiles(id),
  kind text not null check (kind in ('switched', 'confirmed', 'rejected', 'withdrawn', 'reversed')),
  record_id uuid references tl_records(id),
  detail jsonb not null default '{}'::jsonb,
  reason text not null default '',
  actor_id uuid not null references profiles(id),
  at timestamptz not null default now()
);

create or replace function tl_history_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'HISTORY_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists tl_events_no_change on tl_events;
create trigger tl_events_no_change before update or delete on tl_events
  for each row execute function tl_history_immutable();
drop trigger if exists tl_covers_no_change on tl_covers;
create trigger tl_covers_no_change before update or delete on tl_covers
  for each row execute function tl_history_immutable();
drop trigger if exists tl_records_no_delete on tl_records;
create trigger tl_records_no_delete before delete on tl_records
  for each row execute function tl_history_immutable();
drop trigger if exists tl_tools_no_delete on tl_tools;
create trigger tl_tools_no_delete before delete on tl_tools
  for each row execute function tl_history_immutable();

-- Every read and write goes through the functions below: no table policy.
alter table tl_settings enable row level security;
alter table tl_tools enable row level security;
alter table tl_records enable row level security;
alter table tl_covers enable row level security;
alter table tl_events enable row level security;

-- ════ 2. Who, and the switch ═════════════════════════════════════════

create or replace function tl_on(p_owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.enabled from tl_settings s where s.owner_id = p_owner), false)
$$;

-- The caller's company, for a tools write: an owner or office staff account
-- allowed the Expenses section (stock's rule), while tools are on there.
create or replace function tl_actor() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := pur_actor_owner('expenses_form');
begin
  if not tl_on(v_owner) then
    raise exception 'TOOLS_OFF' using errcode = 'P0001';
  end if;
  return v_owner;
end;
$$;

-- The caller's company, for a tools read: the same accounts, while on.
create or replace function tl_reader() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not stk_can_record() then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if not tl_on(data_owner_id()) then
    raise exception 'TOOLS_OFF' using errcode = 'P0001';
  end if;
  return data_owner_id();
end;
$$;

-- What the screens need to know.
create or replace function tl_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_can boolean := stk_can_record();
begin
  return jsonb_build_object('enabled', v_can and tl_on(data_owner_id()), 'can_record', v_can,
                            'is_main_owner', pur_is_main_owner(),
                            'is_owner', auth.uid() is not null and coalesce(is_owner(), false), 'user_id', auth.uid());
end;
$$;

-- The main owner switches tools on (the ZZ pilot, then launch) or off.
create or replace function tl_set_enabled(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid := pur_main_owner();
begin
  if p_on is null then
    raise exception 'BAD_SWITCH' using errcode = 'P0001';
  end if;
  insert into tl_settings (owner_id, enabled, updated_by, updated_at) values (v_owner, p_on, auth.uid(), now())
  on conflict (owner_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where tl_settings.enabled is distinct from excluded.enabled;
  if found then
    insert into tl_events (owner_id, kind, detail, actor_id) values (v_owner, 'switched', jsonb_build_object('enabled', p_on), auth.uid());
  end if;
  return jsonb_build_object('enabled', p_on);
end;
$$;

-- ════ 3. Checks and helpers ══════════════════════════════════════════

-- A tool row of this company, held for the rest of the transaction.
create or replace function tl_tool_lock(p_owner uuid, p_tool uuid) returns tl_tools
language plpgsql security definer set search_path = public as $$
declare v tl_tools;
begin
  select * into v from tl_tools where id = p_tool and owner_id = p_owner for update;
  if v.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- A named responsible person (T1 = C): anyone active in this company — a
-- worker, a team leader, office staff or an owner account; never a client or
-- a partner.
create or replace function tl_person(p_owner uuid, p_person uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if p_person is null then
    raise exception 'PERSON_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (
       select 1 from profiles p
        where p.id = p_person and p.role in ('worker', 'teamLeader', 'staff', 'owner')
          and coalesce(p.status, 'active') = 'active' and coalesce(p.owner_id, p.id) = p_owner) then
    raise exception 'BAD_PERSON' using errcode = 'P0001';
  end if;
  return p_person;
end;
$$;

-- A holder's name: the crew by their name or worker number (as requests show
-- them), office and owner accounts by their name or e-mail (as purchasing does).
create or replace function tl_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p.role in ('worker', 'teamLeader') then pr_person_name(p.id) else pur_person_name(p.id) end
    from profiles p where p.id = p_id
$$;

-- A project of this company (Main Contract or an Additional Works job);
-- not completed unless p_completed_ok (a tool already out there).
create or replace function tl_project(p_owner uuid, p_folder uuid, p_completed_ok boolean default false) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select f.id, f.completed_at is not null or coalesce(par.completed_at is not null, false) as done
    into v
    from folders f left join folders par on par.id = f.parent_folder_id
   where f.id = p_folder and f.owner_id = p_owner;
  if v.id is null then
    raise exception 'BAD_PROJECT' using errcode = 'P0001';
  end if;
  if v.done and not p_completed_ok then
    raise exception 'PROJECT_COMPLETED' using errcode = 'P0001';
  end if;
  return v.id;
end;
$$;

create or replace function tl_condition(p text, p_allow_damaged boolean) returns text
language plpgsql immutable as $$
begin
  if p is null or p not in ('good', 'needs_repair', 'missing_parts', 'damaged') or (p = 'damaged' and not p_allow_damaged) then
    raise exception 'BAD_CONDITION' using errcode = 'P0001';
  end if;
  return p;
end;
$$;

-- A photo: null, or a file this company's tools folder holds —
-- tools/<owner>/<yyyy-mm>/<uuid>.jpg (Dacs Web uploads it first).
create or replace function tl_photo(p_owner uuid, p text) returns text
language plpgsql immutable as $$
begin
  if coalesce(btrim(p), '') = '' then
    return null;
  end if;
  if p !~ ('^tools/' || p_owner::text || '/[0-9]{4}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'BAD_PHOTO' using errcode = 'P0001';
  end if;
  return p;
end;
$$;

-- The tool's custody as a record's before / after.
create or replace function tl_snap(t tl_tools) returns jsonb
language sql immutable as $$
  select jsonb_build_object('state', t.state, 'holder_id', t.holder_id, 'folder_id', t.folder_id,
                            'condition', t.condition, 'since', t.since)
$$;

-- Put a tool into a snapshot's custody (since = now unless the snapshot's own).
create or replace function tl_apply(p_tool uuid, p jsonb, p_keep_since boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  update tl_tools set state = p ->> 'state',
                      holder_id = (p ->> 'holder_id')::uuid,
                      folder_id = (p ->> 'folder_id')::uuid,
                      condition = p ->> 'condition',
                      since = case when p_keep_since and p ? 'since' then (p ->> 'since')::timestamptz else now() end
   where id = p_tool;
end;
$$;

-- The tool's latest record that still stands (done and not reversed, or
-- waiting for the owner).
create or replace function tl_latest(p_tool uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select r.id from tl_records r
   where r.tool_id = p_tool and r.status in ('done', 'pending') and r.reversed_at is null
   order by r.recorded_at desc, r.id desc limit 1
$$;

-- Write one record and move the tool into its `after` custody (a pending
-- record moves it into the waiting state its `after` names in `pending`).
create or replace function tl_write(p_owner uuid, t tl_tools, p_kind text, p_status text, p_after jsonb, p_extra jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_now jsonb := case when p_status = 'pending' then p_extra -> 'pending' else p_after end;
begin
  insert into tl_records (owner_id, tool_id, kind, status, before, after, holder_id, folder_id, request_line_id,
                          condition, photo_path, note, recorded_by)
  values (p_owner, t.id, p_kind, p_status, tl_snap(t), p_after,
          (p_extra ->> 'holder_id')::uuid, (p_extra ->> 'folder_id')::uuid, (p_extra ->> 'request_line_id')::uuid,
          p_extra ->> 'condition', p_extra ->> 'photo_path', coalesce(p_extra ->> 'note', ''), auth.uid())
  returning id into v_id;
  perform tl_apply(t.id, v_now, v_now ? 'since');
  return v_id;
end;
$$;

-- A purchase line counts as a TOOL line: tools were registered from it, or
-- it was bought for a tool request line.
create or replace function tl_tool_line(p_line purchase_lines) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from tl_tools t where t.purchase_id = p_line.purchase_id and t.line_no = p_line.line_no
                    and t.state <> 'cancelled')
      or exists (select 1 from pr_lines r where r.id = p_line.request_line_id and r.kind = 'tool')
      or exists (select 1 from purchase_line_covers c join pr_lines r on r.id = c.request_line_id
                  where c.line_id = p_line.id and r.kind = 'tool')
$$;

-- Tools registered from a purchase line (a cancelled registration frees its place).
create or replace function tl_line_registered(p_purchase uuid, p_line_no int) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from tl_tools t where t.purchase_id = p_purchase and t.line_no = p_line_no and t.state <> 'cancelled'
$$;

-- ════ 4. Requests: covered = purchases + stock + tools (Q14) ═════════

create or replace function pr_portion_from_tools(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0) from tl_covers c join tl_records r on r.id = c.record_id
   where c.portion_id = p_portion and r.status = 'done' and r.reversed_at is null
$$;

create or replace function pr_line_from_tools(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.quantity), 0) from tl_covers c join tl_records r on r.id = c.record_id
   where c.request_line_id = p_line and r.status = 'done' and r.reversed_at is null
$$;

-- COVERED, for every capacity formula of 0097 (Still to buy, splitting,
-- assigning, reducing): recorded purchases, live stock records, and tools
-- issued for the line that were not bought for it.
create or replace function pr_portion_bought(p_portion uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select pr_portion_purchased(p_portion) + pr_portion_from_stock(p_portion) + pr_portion_from_tools(p_portion)
$$;

create or replace function pr_line_bought(p_line uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select pr_line_purchased(p_line) + pr_line_from_stock(p_line) + pr_line_from_tools(p_line)
$$;

-- Is this issue already counted through the tool's purchase? The tool's
-- purchase line covered this request line, and fewer of that line's tools
-- than it covered are counted that way by live issues (so a line that
-- covered 2 counts 2 issues of its tools, never a 3rd).
create or replace function tl_bought_for(t tl_tools, p_line uuid, p_except uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select t.purchase_id is not null and
         coalesce((select floor(sum(c.quantity)) from purchase_line_covers c
                     join purchase_lines l on l.id = c.line_id join purchases pu on pu.id = l.purchase_id
                    where c.request_line_id = p_line and l.purchase_id = t.purchase_id and l.line_no = t.line_no
                      and pu.status = 'recorded'), 0)
         > (select count(*) from tl_records r join tl_tools x on x.id = r.tool_id
             where r.request_line_id = p_line and r.kind = 'issue' and r.status = 'done' and r.reversed_at is null
               and x.purchase_id = t.purchase_id and x.line_no = t.line_no and r.id is distinct from p_except
               and not exists (select 1 from tl_covers c where c.record_id = r.id))
$$;

-- Fill a tool request line with one tool NOT bought for it: the earliest
-- batch first, each portion up to its Still to buy. The caller holds the
-- 'pr_line:' lock.
create or replace function tl_cover(p_owner uuid, p_record uuid, p_folder uuid, p_line uuid, p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p record;
  v_left numeric := 1;
  v_take numeric;
  v_cap numeric;
begin
  for v_p in select p.* from pr_line_portions p join pr_batches b on b.id = p.batch_id
              where p.line_id = p_line order by b.cutoff_at, p.created_at, p.id for update of p
  loop
    exit when v_left <= 0;
    v_cap := greatest(0, v_p.quantity - v_p.pending_reduction - pr_portion_bought(v_p.id));
    v_take := least(v_left, v_cap);
    continue when v_take <= 0;
    insert into tl_covers (owner_id, record_id, request_line_id, portion_id, quantity)
    values (p_owner, p_record, p_line, v_p.id, v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    raise exception 'REQUEST_EXCEEDED' using errcode = 'P0001',
      hint = 'That request line is already filled. Issue the tool without a request.';
  end if;
end;
$$;

-- A tool request line this issue may name: open, of a submitted request for
-- this project, a TOOL line, of this tool's catalogue item (when it names
-- one) and unit.
create or replace function tl_request_line(p_owner uuid, p_line uuid, p_folder uuid, p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_item pr_catalog_items;
begin
  select ln.id, ln.kind, ln.unit, ln.catalog_item_id, ln.status as line_status, r.status as request_status, r.work_folder_id
    into v
    from pr_lines ln join pr_requests r on r.id = ln.request_id
   where ln.id = p_line and ln.owner_id = p_owner for update of ln;
  if v.id is null or v.work_folder_id <> p_folder then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  if v.kind <> 'tool' then
    raise exception 'NOT_A_TOOL_LINE' using errcode = 'P0001';
  end if;
  if v.line_status <> 'open' or v.request_status <> 'submitted' then
    raise exception 'LINE_CLOSED' using errcode = 'P0001';
  end if;
  select * into v_item from pr_catalog_items where id = p_item;
  if v.catalog_item_id is not null and v.catalog_item_id <> p_item then
    raise exception 'ITEM_MISMATCH' using errcode = 'P0001';
  end if;
  if lower(btrim(v.unit)) <> lower(btrim(v_item.unit)) then
    raise exception 'UNIT_MISMATCH' using errcode = 'P0001';
  end if;
end;
$$;

-- ════ 5. Guards: tools are never quantity stock (Q6) ═══════════════

-- A tool item never becomes stock: no match, lot or stock record of it.
-- A purchase line with tools registered from it never becomes stock either.
create or replace function tl_no_tool_stock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null and exists (select 1 from pr_catalog_items c where c.id = new.item_id and c.kind = 'tool') then
    raise exception 'TOOL_ITEM' using errcode = 'P0001',
      hint = 'A tool is not counted as stock — register it under Requests → Tools.';
  end if;
  if tg_table_name in ('stk_matches', 'stk_records') and new.purchase_id is not null
     and tl_line_registered(new.purchase_id, new.line_no) > 0 then
    raise exception 'TOOL_LINE' using errcode = 'P0001',
      hint = 'Tools were registered from this purchase line — it is never stock.';
  end if;
  return new;
end;
$$;
drop trigger if exists tl_no_tool_stock on stk_matches;
create trigger tl_no_tool_stock before insert or update of item_id on stk_matches
  for each row execute function tl_no_tool_stock();
drop trigger if exists tl_no_tool_stock on stk_lots;
create trigger tl_no_tool_stock before insert or update of item_id on stk_lots
  for each row execute function tl_no_tool_stock();
drop trigger if exists tl_no_tool_stock on stk_records;
create trigger tl_no_tool_stock before insert on stk_records
  for each row execute function tl_no_tool_stock();

-- A purchase line may not lose the tools registered from it: the line
-- (same purchase, same line number) stays, with at least that many. A
-- correction deletes and re-inserts every line, so this is checked at the
-- end of the transaction.
create or replace function tl_guard_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_purchase uuid := case when tg_op = 'DELETE' then old.purchase_id else new.purchase_id end;
  v_line_no int := case when tg_op = 'DELETE' then old.line_no else new.line_no end;
  v_n int := tl_line_registered(v_purchase, v_line_no);
  v_qty numeric;
begin
  if v_n = 0 then
    return null;
  end if;
  select l.quantity into v_qty from purchase_lines l where l.purchase_id = v_purchase and l.line_no = v_line_no;
  if v_qty is null or v_qty < v_n then
    raise exception 'TOOLS_IN_USE' using errcode = 'P0001',
      hint = 'Line ' || v_line_no || ' has ' || v_n || ' tool(s) registered from it. Cancel those registrations first, or keep the line and enough quantity.';
  end if;
  return null;
end;
$$;
drop trigger if exists tl_guard_line on purchase_lines;
create constraint trigger tl_guard_line after insert or update or delete on purchase_lines
  deferrable initially deferred for each row execute function tl_guard_line();

-- A purchase with tools registered from it is never voided (nor replaced,
-- nor voided by an approved change request — they all void it).
create or replace function tl_guard_void() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'recorded' and new.status = 'void'
     and exists (select 1 from tl_tools t where t.purchase_id = old.id and t.state <> 'cancelled') then
    raise exception 'TOOLS_IN_USE' using errcode = 'P0001',
      hint = 'Tools were registered from this purchase. Cancel those registrations first.';
  end if;
  return new;
end;
$$;
drop trigger if exists tl_guard_void on purchases;
create trigger tl_guard_void before update of status on purchases
  for each row execute function tl_guard_void();

-- A catalogue item is IN USE once tools use it too (0104's test plus
-- tl_tools): its kind and unit are then fixed (Q3), so a numbered tool can
-- never turn into a quantity item, nor the other way round.
create or replace function pr_item_in_use(p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pr_lines l where l.catalog_item_id = p_item)
      or exists (select 1 from stk_matches m where m.item_id = p_item)
      or exists (select 1 from stk_lots lt where lt.item_id = p_item)
      or exists (select 1 from stk_records r where r.item_id = p_item)
      or exists (select 1 from tl_tools t where t.item_id = p_item)
$$;

-- ════ 6. The operations ══════════════════════════════════════════════

-- Register tools (Q7–Q9). p_body: item_id, count (1–50), at ('warehouse' or
-- a project folder's id), holder_id (needed at a project), condition
-- ('good', 'needs_repair', 'missing_parts', or 'damaged' — at the warehouse
-- only), details, photo_path (needed for an opening register), note, and
-- optionally purchase_id + line_no (the purchase line they came from).
-- Several identical tools registered together share the one photo.
create or replace function tl_register(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  v_item pr_catalog_items;
  v_count int;
  v_at text := coalesce(btrim(p_body ->> 'at'), '');
  v_folder uuid;
  v_holder uuid;
  v_cond text := tl_condition(coalesce(nullif(p_body ->> 'condition', ''), 'good'), true);
  v_photo text := tl_photo(v_owner, p_body ->> 'photo_path');
  v_details text := btrim(coalesce(p_body ->> 'details', ''));
  v_purchase uuid := pur_uuid(p_body ->> 'purchase_id');
  v_line_no int;
  v_line purchase_lines;
  v_after jsonb;
  v_num int;
  t tl_tools;
  v_ids jsonb := '[]'::jsonb;
  v_retire uuid;
  i int;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  begin
    v_count := coalesce(nullif(p_body ->> 'count', ''), '1')::int;
  exception when others then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end;
  if v_count < 1 or v_count > 50 then
    raise exception 'BAD_QUANTITY' using errcode = 'P0001';
  end if;
  if char_length(v_details) > 200 then
    raise exception 'BAD_NOTE' using errcode = 'P0001';
  end if;
  select * into v_item from pr_catalog_items where id = pur_uuid(p_body ->> 'item_id') and owner_id = v_owner for share;
  if v_item.id is null or not v_item.active then
    raise exception 'BAD_ITEM' using errcode = 'P0001';
  end if;
  if v_item.kind <> 'tool' then
    raise exception 'NOT_A_TOOL' using errcode = 'P0001';
  end if;
  if v_at = 'warehouse' then
    v_after := jsonb_build_object('state', case when v_cond = 'good' then 'available' else 'repair' end,
                                  'holder_id', null, 'folder_id', null, 'condition', v_cond);
  else
    -- A tool damaged beyond repair waits at the warehouse for the owner (Q16).
    if v_cond = 'damaged' then
      raise exception 'DAMAGED_AT_PROJECT' using errcode = 'P0001';
    end if;
    -- At a project: always with its named responsible person (Q10).
    v_folder := tl_project(v_owner, pur_uuid(v_at));
    v_holder := tl_person(v_owner, pur_uuid(p_body ->> 'holder_id'));
    v_after := jsonb_build_object('state', 'issued', 'holder_id', v_holder, 'folder_id', v_folder, 'condition', v_cond);
  end if;
  if v_purchase is not null or nullif(p_body ->> 'line_no', '') is not null then
    begin
      v_line_no := (p_body ->> 'line_no')::int;
    exception when others then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end;
    perform pur_purchase_lock(v_purchase);
    v_line := stk_line(v_owner, v_purchase, v_line_no);
    if exists (select 1 from stk_records r where r.purchase_id = v_purchase and r.line_no = v_line_no
                  and r.status in ('done', 'pending') and r.reversed_at is null)
       or exists (select 1 from stk_matches m where m.purchase_id = v_purchase and m.line_no = v_line_no) then
      raise exception 'LINE_IS_STOCK' using errcode = 'P0001';
    end if;
    if tl_line_registered(v_purchase, v_line_no) + v_count > v_line.quantity then
      raise exception 'MORE_THAN_BOUGHT' using errcode = 'P0001',
        hint = 'Still to register from this line: ' || greatest(0, floor(v_line.quantity) - tl_line_registered(v_purchase, v_line_no)) || '.';
    end if;
    -- A warehouse line's tools start at the warehouse; a project line's at
    -- the warehouse or with a person on that project (Q8).
    if (v_line.destination = 'warehouse' and v_at <> 'warehouse')
       or (v_line.destination = 'project' and v_at <> 'warehouse' and v_folder is distinct from v_line.folder_id) then
      raise exception 'BAD_PLACE' using errcode = 'P0001';
    end if;
  end if;
  -- The opening register keeps a photo of each tool (Q7); one bought on a
  -- recorded purchase is traced by its purchase.
  if v_purchase is null and v_photo is null then
    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tl_number:' || v_owner, 0));
  select coalesce(max(number), 0) into v_num from tl_tools where owner_id = v_owner;
  for i in 1 .. v_count loop
    insert into tl_tools (owner_id, number, item_id, purchase_id, line_no, details, photo_path, state, condition, created_by)
    values (v_owner, v_num + i, v_item.id, v_purchase, case when v_purchase is null then null else v_line_no end,
            v_details, v_photo, 'cancelled', 'good', auth.uid())
    returning * into t;
    -- `before` of a registration: nothing yet (cancelled), so reversing it cancels the tool.
    perform tl_write(v_owner, t, 'register', 'done', v_after,
                     jsonb_build_object('holder_id', v_holder, 'folder_id', v_folder, 'condition', v_cond,
                                        'photo_path', v_photo, 'note', pur_note(p_body ->> 'note')));
    v_retire := null;
    if v_cond = 'damaged' then
      select * into t from tl_tools where id = t.id;
      v_retire := tl_write(v_owner, t, 'retire', 'pending',
                           jsonb_build_object('state', 'retired', 'holder_id', null, 'folder_id', null, 'condition', 'damaged'),
                           jsonb_build_object('note', coalesce(nullif(pur_note(p_body ->> 'note'), ''), 'Registered damaged beyond repair'),
                                              'pending', jsonb_build_object('state', 'retire_pending', 'holder_id', null,
                                                                            'folder_id', null, 'condition', 'damaged')));
    end if;
    v_ids := v_ids || jsonb_build_object('tool_id', t.id, 'number', t.number, 'retire_record_id', v_retire);
  end loop;
  return pur_op_done(v_owner, p_op, 'tl_register', jsonb_build_object('tools', v_ids));
end;
$$;

-- Issue an available tool to a named person on a project (Q10, Q13).
-- p_body: tool_id, holder_id, folder_id, request_line_id (optional), note, photo_path.
create or replace function tl_issue(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_holder uuid;
  v_folder uuid;
  v_req uuid := pur_uuid(p_body ->> 'request_line_id');
  v_rec uuid;
  v_counted boolean := false;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if t.state <> 'available' then
    raise exception 'NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  v_holder := tl_person(v_owner, pur_uuid(p_body ->> 'holder_id'));
  v_folder := tl_project(v_owner, pur_uuid(p_body ->> 'folder_id'));
  if nullif(p_body ->> 'request_line_id', '') is not null and v_req is null then
    raise exception 'BAD_REQUEST_LINK' using errcode = 'P0001';
  end if;
  if v_req is not null then
    perform pur_lock(array['pr_line:' || v_req]);
    perform tl_request_line(v_owner, v_req, v_folder, t.item_id);
    v_counted := not tl_bought_for(t, v_req);
  end if;
  v_rec := tl_write(v_owner, t, 'issue', 'done',
                    jsonb_build_object('state', 'issued', 'holder_id', v_holder, 'folder_id', v_folder, 'condition', t.condition),
                    jsonb_build_object('holder_id', v_holder, 'folder_id', v_folder, 'request_line_id', v_req,
                                       'photo_path', tl_photo(v_owner, p_body ->> 'photo_path'), 'note', pur_note(p_body ->> 'note')));
  if v_counted then
    perform tl_cover(v_owner, v_rec, v_folder, v_req, t.item_id);
  end if;
  return pur_op_done(v_owner, p_op, 'tl_issue', jsonb_build_object('record_id', v_rec, 'tool_id', t.id,
                                                                   'fills_request', v_counted, 'bought_for_request', v_req is not null and not v_counted));
end;
$$;

-- Hand an issued tool straight to another person (and, if need be, another
-- project) — never through the warehouse (Q15). p_body: tool_id, holder_id,
-- folder_id (optional: stays on its project), note.
create or replace function tl_handover(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_holder uuid;
  v_folder uuid;
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if t.state <> 'issued' then
    raise exception 'NOT_ISSUED' using errcode = 'P0001';
  end if;
  -- Not usable until repaired: it stays with its person and project (rev 3).
  if t.condition <> 'good' then
    raise exception 'NEEDS_REPAIR' using errcode = 'P0001';
  end if;
  v_holder := tl_person(v_owner, pur_uuid(p_body ->> 'holder_id'));
  if coalesce(p_body ->> 'folder_id', '') = '' or pur_uuid(p_body ->> 'folder_id') = t.folder_id then
    v_folder := t.folder_id;          -- staying on its project, completed or not
  else
    v_folder := tl_project(v_owner, pur_uuid(p_body ->> 'folder_id'));
  end if;
  if v_holder = t.holder_id and v_folder = t.folder_id then
    raise exception 'SAME_HOLDER' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'handover', 'done',
                    jsonb_build_object('state', 'issued', 'holder_id', v_holder, 'folder_id', v_folder, 'condition', t.condition),
                    jsonb_build_object('holder_id', v_holder, 'folder_id', v_folder, 'note', pur_note(p_body ->> 'note')));
  return pur_op_done(v_owner, p_op, 'tl_handover', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- A return, with its condition (Q16): good → available; needs repair or
-- missing parts → Under repair; damaged beyond repair → Under repair AND a
-- Retire request waiting for the main owner (cannot be issued meanwhile).
-- p_body: tool_id, condition, note, photo_path.
create or replace function tl_return(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_cond text := tl_condition(p_body ->> 'condition', true);
  v_rec uuid;
  v_retire uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if t.state <> 'issued' then
    raise exception 'NOT_ISSUED' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'return', 'done',
                    jsonb_build_object('state', case when v_cond = 'good' then 'available' else 'repair' end,
                                       'holder_id', null, 'folder_id', null, 'condition', v_cond),
                    jsonb_build_object('holder_id', t.holder_id, 'folder_id', t.folder_id, 'condition', v_cond,
                                       'photo_path', tl_photo(v_owner, p_body ->> 'photo_path'), 'note', pur_note(p_body ->> 'note')));
  if v_cond = 'damaged' then
    select * into t from tl_tools where id = t.id;
    v_retire := tl_write(v_owner, t, 'retire', 'pending',
                         jsonb_build_object('state', 'retired', 'holder_id', null, 'folder_id', null, 'condition', 'damaged'),
                         jsonb_build_object('note', coalesce(nullif(pur_note(p_body ->> 'note'), ''), 'Returned damaged beyond repair'),
                                            'pending', jsonb_build_object('state', 'retire_pending', 'holder_id', null,
                                                                          'folder_id', null, 'condition', 'damaged')));
  end if;
  return pur_op_done(v_owner, p_op, 'tl_return', jsonb_build_object('record_id', v_rec, 'tool_id', t.id, 'retire_record_id', v_retire));
end;
$$;

-- A tool is fixed. Under repair at the warehouse → available again. One
-- still with its person on a project, not in good condition (registered
-- there needing repair or missing parts) → good, with the SAME person,
-- project and days out (rev 3).
create or replace function tl_repaired(p_op uuid, p_tool uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, p_tool);
  if not (t.state = 'repair' or (t.state = 'issued' and t.condition <> 'good')) then
    raise exception 'NOT_IN_REPAIR' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'repaired', 'done',
                    case when t.state = 'issued'
                         then jsonb_build_object('state', 'issued', 'holder_id', t.holder_id, 'folder_id', t.folder_id,
                                                 'condition', 'good', 'since', t.since)
                         else jsonb_build_object('state', 'available', 'holder_id', null, 'folder_id', null, 'condition', 'good') end,
                    jsonb_build_object('holder_id', t.holder_id, 'folder_id', t.folder_id, 'condition', 'good', 'note', pur_note(p_note)));
  return pur_op_done(v_owner, p_op, 'tl_repaired', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- Report a tool lost (Q17): it waits for the main owner, and cannot be
-- issued, handed over or returned meanwhile; who had it stays recorded.
create or replace function tl_report_lost(p_op uuid, p_tool uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_reason text := pur_reason(p_reason);
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, p_tool);
  if t.state not in ('available', 'issued', 'repair') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'lost', 'pending',
                    jsonb_build_object('state', 'lost', 'holder_id', t.holder_id, 'folder_id', t.folder_id, 'condition', t.condition),
                    jsonb_build_object('holder_id', t.holder_id, 'folder_id', t.folder_id, 'note', v_reason,
                                       'pending', jsonb_build_object('state', 'lost_pending', 'holder_id', t.holder_id,
                                                                     'folder_id', t.folder_id, 'condition', t.condition)));
  return pur_op_done(v_owner, p_op, 'tl_report_lost', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- Ask the main owner to retire an Under-repair tool (Q16).
create or replace function tl_request_retire(p_op uuid, p_tool uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_reason text := pur_reason(p_reason);
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, p_tool);
  if t.state <> 'repair' then
    raise exception 'NOT_IN_REPAIR' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'retire', 'pending',
                    jsonb_build_object('state', 'retired', 'holder_id', null, 'folder_id', null, 'condition', t.condition),
                    jsonb_build_object('note', v_reason,
                                       'pending', jsonb_build_object('state', 'retire_pending', 'holder_id', null,
                                                                     'folder_id', null, 'condition', t.condition)));
  return pur_op_done(v_owner, p_op, 'tl_request_retire', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- A lost tool turned up (Q17): available if good, otherwise Under repair.
-- p_body: tool_id, condition, note.
create or replace function tl_found(p_op uuid, p_body jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  t tl_tools;
  v_cond text := tl_condition(p_body ->> 'condition', true);
  v_rec uuid;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  t := tl_tool_lock(v_owner, pur_uuid(p_body ->> 'tool_id'));
  if t.state <> 'lost' then
    raise exception 'NOT_LOST' using errcode = 'P0001';
  end if;
  v_rec := tl_write(v_owner, t, 'found', 'done',
                    jsonb_build_object('state', case when v_cond = 'good' then 'available' else 'repair' end,
                                       'holder_id', null, 'folder_id', null, 'condition', v_cond),
                    jsonb_build_object('condition', v_cond, 'note', pur_note(p_body ->> 'note')));
  return pur_op_done(v_owner, p_op, 'tl_found', jsonb_build_object('record_id', v_rec, 'tool_id', t.id));
end;
$$;

-- The main owner confirms or rejects a Lost report or a Retire request
-- (Q16–Q17). Confirm → its `after` (lost / retired). Reject → its `before`:
-- exactly where the tool was before the report — for a retire request that
-- is always Under repair.
create or replace function tl_decide(p_op uuid, p_record uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  r tl_records;
  t tl_tools;
  v_note text;
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  if not pur_is_main_owner() then
    raise exception 'OWNER_ONLY' using errcode = 'P0001';
  end if;
  v_note := case when p_approve then pur_note(p_note) else pur_reason(p_note) end;
  select * into r from tl_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  t := tl_tool_lock(v_owner, r.tool_id);
  select * into r from tl_records where id = p_record;
  if r.status <> 'pending' then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  update tl_records set status = case when p_approve then 'done' else 'rejected' end,
                        decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = r.id;
  perform tl_apply(t.id, case when p_approve then r.after else r.before end, not p_approve);
  insert into tl_events (owner_id, kind, record_id, reason, actor_id)
  values (v_owner, case when p_approve then 'confirmed' else 'rejected' end, r.id, v_note, auth.uid());
  return pur_op_done(v_owner, p_op, 'tl_decide', jsonb_build_object('record_id', r.id, 'approved', p_approve));
end;
$$;

-- Withdraw a record still waiting for the owner (whoever recorded it, or the
-- main owner) — the same result as a rejection; or reverse a mistaken one
-- (whoever recorded it, or an owner) while it is the tool's latest record.
-- Reversing a registration cancels the tool (its number is never reused);
-- reversing an issue drops what it filled on its request line.
create or replace function tl_reverse(p_op uuid, p_record uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid := tl_actor();
  v_prev jsonb;
  r tl_records;
  t tl_tools;
  v_reason text := pur_reason(p_reason);
begin
  v_prev := pur_op_begin(p_op);
  if v_prev is not null then
    return v_prev;
  end if;
  select * into r from tl_records where id = p_record and owner_id = v_owner;
  if r.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  t := tl_tool_lock(v_owner, r.tool_id);
  select * into r from tl_records where id = p_record;
  if r.request_line_id is not null then
    perform pur_lock(array['pr_line:' || r.request_line_id]);
  end if;
  if r.status = 'pending' then
    if auth.uid() <> r.recorded_by and not pur_is_main_owner() then
      raise exception 'NOT_YOURS' using errcode = 'P0001';
    end if;
    update tl_records set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = v_reason where id = r.id;
    perform tl_apply(t.id, r.before, true);
    insert into tl_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'withdrawn', r.id, v_reason, auth.uid());
    return pur_op_done(v_owner, p_op, 'tl_reverse', jsonb_build_object('record_id', r.id, 'status', 'withdrawn'));
  end if;
  if r.status <> 'done' or r.reversed_at is not null or r.kind in ('lost', 'retire') then
    raise exception 'BAD_STATE' using errcode = 'P0001';
  end if;
  if auth.uid() <> r.recorded_by and not is_owner() then
    raise exception 'NOT_YOURS' using errcode = 'P0001';
  end if;
  if tl_latest(t.id) <> r.id then
    raise exception 'LATER_RECORDS' using errcode = 'P0001';
  end if;
  update tl_records set reversed_by = auth.uid(), reversed_at = now(), reverse_reason = v_reason where id = r.id;
  perform tl_apply(t.id, r.before, true);
  insert into tl_events (owner_id, kind, record_id, reason, actor_id) values (v_owner, 'reversed', r.id, v_reason, auth.uid());
  return pur_op_done(v_owner, p_op, 'tl_reverse', jsonb_build_object('record_id', r.id, 'reversed', true));
end;
$$;

-- ════ 7. Reading (no money) ══════════════════════════════════════════

create or replace function tl_label(p_number int) returns text
language sql immutable as $$
  select 'TOOL-' || lpad(p_number::text, 4, '0')
$$;

create or replace function tl_folder_name(p_folder uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when f.parent_folder_id is null then f.name else coalesce(par.name, '') || ' — ' || f.name end
    from folders f left join folders par on par.id = f.parent_folder_id where f.id = p_folder
$$;

-- Whole days in the current state, by the Philippine calendar.
create or replace function tl_days(p_since timestamptz) returns int
language sql stable as $$
  select ((now() at time zone 'Asia/Manila')::date - (p_since at time zone 'Asia/Manila')::date)
$$;

create or replace function tl_tool_json(p_tool uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'number', t.number, 'label', tl_label(t.number),
    'item_id', t.item_id, 'item_name', c.name, 'item_spec', c.spec, 'details', t.details, 'photo_path', t.photo_path,
    'state', t.state, 'condition', t.condition,
    'holder_id', t.holder_id, 'holder_name', case when t.holder_id is null then null else tl_person_name(t.holder_id) end,
    'folder_id', t.folder_id, 'folder_name', case when t.folder_id is null then null else tl_folder_name(t.folder_id) end,
    'since', t.since, 'days', tl_days(t.since),
    'purchase_id', t.purchase_id, 'line_no', t.line_no,
    'purchase_date', (select pu.purchase_date from purchases pu where pu.id = t.purchase_id),
    'pending_record_id', (select r.id from tl_records r where r.tool_id = t.id and r.status = 'pending' limit 1))
  from tl_tools t join pr_catalog_items c on c.id = t.item_id
  where t.id = p_tool
$$;

create or replace function tl_record_json(p_record uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'tool_id', r.tool_id, 'label', tl_label(t.number), 'item_name', c.name,
    'kind', r.kind, 'status', r.status, 'before', r.before, 'after', r.after,
    'holder_id', r.holder_id, 'holder_name', case when r.holder_id is null then null else tl_person_name(r.holder_id) end,
    'folder_id', r.folder_id, 'folder_name', case when r.folder_id is null then null else tl_folder_name(r.folder_id) end,
    'from_holder_name', case when r.before ->> 'holder_id' is null then null else tl_person_name((r.before ->> 'holder_id')::uuid) end,
    'request_line_id', r.request_line_id, 'request_description', rl.description,
    'fills_request', exists (select 1 from tl_covers x where x.record_id = r.id),
    'condition', r.condition, 'photo_path', r.photo_path, 'note', r.note,
    'recorded_by', r.recorded_by, 'recorded_by_name', pur_person_name(r.recorded_by), 'recorded_at', r.recorded_at,
    'decided_by_name', case when r.decided_by is null then null else pur_person_name(r.decided_by) end,
    'decided_at', r.decided_at, 'decision_note', r.decision_note,
    'reversed', r.reversed_at is not null, 'reversed_at', r.reversed_at, 'reverse_reason', r.reverse_reason,
    'reversed_by_name', case when r.reversed_by is null then null else pur_person_name(r.reversed_by) end,
    'latest', tl_latest(r.tool_id) = r.id)
  from tl_records r join tl_tools t on t.id = r.tool_id join pr_catalog_items c on c.id = t.item_id
  left join pr_lines rl on rl.id = r.request_line_id
  where r.id = p_record
$$;

-- The Tools screen: every tool (not cancelled), the tools out (longest
-- first), what waits for the owner, and purchase lines with tools to register.
create or replace function tl_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  return jsonb_build_object(
    'tools', (select coalesce(jsonb_agg(tl_tool_json(t.id) order by t.number), '[]'::jsonb)
                from tl_tools t where t.owner_id = v_owner and t.state <> 'cancelled'),
    'out', (select coalesce(jsonb_agg(tl_tool_json(t.id) order by t.since, t.number), '[]'::jsonb)
              from tl_tools t where t.owner_id = v_owner and t.state = 'issued'),
    'pending', (select coalesce(jsonb_agg(tl_record_json(r.id) order by r.recorded_at), '[]'::jsonb)
                  from tl_records r where r.owner_id = v_owner and r.status = 'pending'),
    'to_register', (select coalesce(jsonb_agg(jsonb_build_object(
                      'purchase_id', l.purchase_id, 'line_no', l.line_no, 'item_name', l.item_name, 'unit', l.unit,
                      'quantity', l.quantity, 'destination', l.destination, 'folder_id', l.folder_id,
                      'folder_name', case when l.folder_id is null then null else coalesce(tl_folder_name(l.folder_id), l.folder_name) end,
                      'purchase_date', pu.purchase_date, 'registered', tl_line_registered(l.purchase_id, l.line_no),
                      'suggested_item_id', (select r.catalog_item_id from pr_lines r where r.id = l.request_line_id and r.kind = 'tool'))
                      order by pu.purchase_date, l.purchase_id, l.line_no), '[]'::jsonb)
                      from purchase_lines l join purchases pu on pu.id = l.purchase_id
                     where pu.owner_id = v_owner and pu.status = 'recorded' and tl_tool_line(l)
                       and tl_line_registered(l.purchase_id, l.line_no) < floor(l.quantity)
                       and not exists (select 1 from stk_matches m where m.purchase_id = l.purchase_id and m.line_no = l.line_no)));
end;
$$;

-- One tool and its whole history (newest first).
create or replace function tl_tool(p_tool uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  if not exists (select 1 from tl_tools t where t.id = p_tool and t.owner_id = v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  return tl_tool_json(p_tool) || jsonb_build_object(
    'records', (select coalesce(jsonb_agg(tl_record_json(r.id) order by r.recorded_at desc, r.id desc), '[]'::jsonb)
                  from tl_records r where r.tool_id = p_tool));
end;
$$;

-- What the forms pick from: tool items, people (everyone active in the
-- company — T1 = C — the crew with their teams) and the company's projects.
create or replace function tl_choices() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit)
                                        order by lower(c.name), lower(c.spec)), '[]'::jsonb)
                from pr_catalog_items c where c.owner_id = v_owner and c.active and c.kind = 'tool'),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', tl_person_name(p.id), 'role', p.role,
                 'teams', (select coalesce(jsonb_agg(tm.name order by lower(tm.name)), '[]'::jsonb)
                             from pr_team_members m join pr_teams tm on tm.id = m.team_id
                            where m.worker_id = p.id and m.removed_at is null and tm.active))
                 order by lower(tl_person_name(p.id))), '[]'::jsonb)
                 from profiles p
                where p.role in ('worker', 'teamLeader', 'staff', 'owner') and coalesce(p.status, 'active') = 'active'
                  and coalesce(p.owner_id, p.id) = v_owner),
    'projects', (select coalesce(jsonb_agg(jsonb_build_object('folder_id', f.id, 'name', tl_folder_name(f.id),
                   'main', f.parent_folder_id is null,
                   'completed', f.completed_at is not null or par.completed_at is not null)
                   order by coalesce(par.name, f.name), f.parent_folder_id is not null, f.name), '[]'::jsonb)
                   from folders f left join folders par on par.id = f.parent_folder_id
                  where f.owner_id = v_owner));
end;
$$;

-- Open TOOL request lines of a project with something still to fill, for an
-- issue's "Fills request".
create or replace function tl_request_lines(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := tl_reader();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'line_id', l.id, 'description', l.description, 'spec', l.spec, 'unit', l.unit,
            'catalog_item_id', l.catalog_item_id, 'requester_name', pr_person_name(r.requester_id),
            'still_to_buy', (select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0)
                               from pr_line_portions p where p.line_id = l.id),
            'bought', pr_line_purchased(l.id))
          order by r.received_at, l.position), '[]'::jsonb)
            from pr_lines l join pr_requests r on r.id = l.request_id
           where l.owner_id = v_owner and r.work_folder_id = p_folder and l.kind = 'tool'
             and l.status = 'open' and r.status = 'submitted');
end;
$$;

-- Tools still out on a project and its Additional Works jobs (Q20), for
-- Project Control's "Mark as Complete". Empty while tools are off.
create or replace function tl_project_out(p_folder uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := data_owner_id();
begin
  if not stk_can_record() or not tl_on(v_owner) then
    return '[]'::jsonb;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('label', tl_label(t.number), 'item_name', c.name,
                                                       'holder_name', tl_person_name(t.holder_id),
                                                       'folder_name', tl_folder_name(t.folder_id), 'days', tl_days(t.since))
                                    order by t.number), '[]'::jsonb)
            from tl_tools t join pr_catalog_items c on c.id = t.item_id
           where t.owner_id = v_owner and t.state = 'issued'
             and t.folder_id in (select f.id from folders f where f.owner_id = v_owner
                                   and (f.id = p_folder or f.parent_folder_id = p_folder)));
end;
$$;

-- The tools issued for request lines, for the shopping list (Q14): per line,
-- each tool issued for it ("counted": it filled the line on its own; not
-- counted: it was bought for the line and counts through its purchase), how
-- much tools filled, and per weekly portion. Buyers and office accounts;
-- empty while tools are off.
create or replace function tl_line_tools(p_lines uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := data_owner_id();
begin
  if auth.uid() is null or not (stk_can_record() or pur_buyer()) or not tl_on(v_owner) then
    return '{}'::jsonb;
  end if;
  return (select coalesce(jsonb_object_agg(x.line_id, jsonb_build_object(
            'tools', x.tools,
            'filled', pr_line_from_tools(x.line_id),
            'portions', (select coalesce(jsonb_object_agg(p.portion_id, p.q), '{}'::jsonb)
                           from (select c.portion_id, sum(c.quantity) as q
                                   from tl_covers c join tl_records cr on cr.id = c.record_id
                                  where c.request_line_id = x.line_id and c.portion_id is not null
                                    and cr.status = 'done' and cr.reversed_at is null
                                  group by c.portion_id) p))), '{}'::jsonb) from (
            select r.request_line_id as line_id,
                   jsonb_agg(jsonb_build_object('label', tl_label(t.number), 'holder_name', tl_person_name(r.holder_id),
                                                'counted', exists (select 1 from tl_covers c where c.record_id = r.id))
                             order by t.number) as tools
              from tl_records r join tl_tools t on t.id = r.tool_id
             where r.owner_id = v_owner and r.kind = 'issue' and r.status = 'done' and r.reversed_at is null
               and r.request_line_id = any (p_lines)
             group by r.request_line_id) x);
end;
$$;

-- 0104's Stock screen, its Receiving list without TOOL lines (Q6: they are
-- registered under Tools, never received as stock). Otherwise unchanged.
create or replace function stk_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid := stk_reader();
begin
  return jsonb_build_object(
    'warehouse_id', (select id from stk_locations where owner_id = v_owner and kind = 'warehouse'),
    'items', (select coalesce(jsonb_agg(x.doc order by x.name), '[]'::jsonb) from (
        select c.name, jsonb_build_object('item_id', c.id, 'name', c.name, 'spec', c.spec, 'unit', c.unit,
                 'total', sum(b.quantity),
                 'places', jsonb_agg(jsonb_build_object('location_id', b.location_id, 'name', stk_place_name(b.location_id),
                                                        'kind', l.kind, 'folder_id', l.folder_id, 'quantity', b.quantity)
                                     order by l.kind = 'site', stk_place_name(b.location_id))) as doc
          from (select s.item_id, s.location_id, sum(s.quantity) as quantity from stk_balances(v_owner) s
                 group by s.item_id, s.location_id having sum(s.quantity) <> 0) b
          join pr_catalog_items c on c.id = b.item_id
          join stk_locations l on l.id = b.location_id
         group by c.id, c.name, c.spec, c.unit) x),
    'awaiting', (select coalesce(jsonb_agg(stk_line_json(l) order by pu.purchase_date, l.purchase_id, l.line_no), '[]'::jsonb)
                   from purchase_lines l join purchases pu on pu.id = l.purchase_id
                  where pu.owner_id = v_owner and pu.status = 'recorded' and l.destination = 'warehouse'
                    and not tl_tool_line(l)
                    and (l.quantity - stk_received(l.purchase_id, l.line_no) - stk_received(l.purchase_id, l.line_no, 'not_delivered') > 0
                         or (not exists (select 1 from stk_matches m where m.purchase_id = l.purchase_id and m.line_no = l.line_no)
                             and stk_auto_item(l) is null))),
    'pending', (select coalesce(jsonb_agg(stk_record_json(r.id) order by r.recorded_at), '[]'::jsonb)
                  from stk_records r where r.owner_id = v_owner and r.status = 'pending'),
    'recent', (select coalesce(jsonb_agg(stk_record_json(x.id) order by x.recorded_at desc), '[]'::jsonb)
                 from (select r.id, r.recorded_at from stk_records r where r.owner_id = v_owner
                        order by r.recorded_at desc limit 50) x));
end;
$$;

-- ════ 8. Who may call what ═══════════════════════════════════════════

-- The operations and readers (each refuses the wrong caller itself).
revoke all on function tl_status() from public, anon;
grant execute on function tl_status() to authenticated;
revoke all on function tl_set_enabled(boolean) from public, anon;
grant execute on function tl_set_enabled(boolean) to authenticated;
revoke all on function tl_register(uuid, jsonb) from public, anon;
grant execute on function tl_register(uuid, jsonb) to authenticated;
revoke all on function tl_issue(uuid, jsonb) from public, anon;
grant execute on function tl_issue(uuid, jsonb) to authenticated;
revoke all on function tl_handover(uuid, jsonb) from public, anon;
grant execute on function tl_handover(uuid, jsonb) to authenticated;
revoke all on function tl_return(uuid, jsonb) from public, anon;
grant execute on function tl_return(uuid, jsonb) to authenticated;
revoke all on function tl_repaired(uuid, uuid, text) from public, anon;
grant execute on function tl_repaired(uuid, uuid, text) to authenticated;
revoke all on function tl_report_lost(uuid, uuid, text) from public, anon;
grant execute on function tl_report_lost(uuid, uuid, text) to authenticated;
revoke all on function tl_request_retire(uuid, uuid, text) from public, anon;
grant execute on function tl_request_retire(uuid, uuid, text) to authenticated;
revoke all on function tl_found(uuid, jsonb) from public, anon;
grant execute on function tl_found(uuid, jsonb) to authenticated;
revoke all on function tl_decide(uuid, uuid, boolean, text) from public, anon;
grant execute on function tl_decide(uuid, uuid, boolean, text) to authenticated;
revoke all on function tl_reverse(uuid, uuid, text) from public, anon;
grant execute on function tl_reverse(uuid, uuid, text) to authenticated;
revoke all on function tl_overview() from public, anon;
grant execute on function tl_overview() to authenticated;
revoke all on function tl_tool(uuid) from public, anon;
grant execute on function tl_tool(uuid) to authenticated;
revoke all on function tl_choices() from public, anon;
grant execute on function tl_choices() to authenticated;
revoke all on function tl_request_lines(uuid) from public, anon;
grant execute on function tl_request_lines(uuid) to authenticated;
revoke all on function tl_project_out(uuid) from public, anon;
grant execute on function tl_project_out(uuid) to authenticated;
revoke all on function tl_line_tools(uuid[]) from public, anon;
grant execute on function tl_line_tools(uuid[]) to authenticated;
-- (create or replace keeps a function's permissions; restated so they can never drift.)
revoke all on function stk_overview() from public, anon;
grant execute on function stk_overview() to authenticated;

-- Internal helpers: only the SECURITY DEFINER operations above call them.
revoke all on function tl_history_immutable() from public, anon, authenticated;
revoke all on function tl_on(uuid) from public, anon, authenticated;
revoke all on function tl_actor() from public, anon, authenticated;
revoke all on function tl_reader() from public, anon, authenticated;
revoke all on function tl_tool_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function tl_person(uuid, uuid) from public, anon, authenticated;
revoke all on function tl_person_name(uuid) from public, anon, authenticated;
revoke all on function tl_project(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function tl_condition(text, boolean) from public, anon, authenticated;
revoke all on function tl_photo(uuid, text) from public, anon, authenticated;
revoke all on function tl_snap(tl_tools) from public, anon, authenticated;
revoke all on function tl_apply(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function tl_latest(uuid) from public, anon, authenticated;
revoke all on function tl_write(uuid, tl_tools, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function tl_tool_line(purchase_lines) from public, anon, authenticated;
revoke all on function tl_line_registered(uuid, int) from public, anon, authenticated;
revoke all on function pr_portion_from_tools(uuid) from public, anon, authenticated;
revoke all on function pr_line_from_tools(uuid) from public, anon, authenticated;
revoke all on function pr_portion_bought(uuid) from public, anon, authenticated;
revoke all on function pr_line_bought(uuid) from public, anon, authenticated;
revoke all on function tl_bought_for(tl_tools, uuid, uuid) from public, anon, authenticated;
revoke all on function tl_cover(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function tl_request_line(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function tl_no_tool_stock() from public, anon, authenticated;
revoke all on function tl_guard_line() from public, anon, authenticated;
revoke all on function tl_guard_void() from public, anon, authenticated;
revoke all on function tl_label(int) from public, anon, authenticated;
revoke all on function tl_folder_name(uuid) from public, anon, authenticated;
revoke all on function tl_days(timestamptz) from public, anon, authenticated;
revoke all on function tl_tool_json(uuid) from public, anon, authenticated;
revoke all on function tl_record_json(uuid) from public, anon, authenticated;
revoke all on function pr_item_in_use(uuid) from public, anon, authenticated;
```

**Modify:** `supabase/migrations/README.md`

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
index 136837b..3e4910b 100644
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0107** — highest on disk is
-  `0106_workmate_phone_stock.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0108** — highest on disk is
+  `0107_tools.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -198,6 +198,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0106 (WorkMate Stage 2B-b — stock on the phone: "From stock" on the workers' requests; settling a lost answer)** redefines 0085's `pr_my_requests` with one key added to each request line and each weekly portion: `from_stock` — what the office issued from stock for it (0104's `pr_line_from_stock` / `pr_portion_from_stock`; live stock records only, so a reversed issue drops out and a return does not; 0 while stock is off). Nothing else in the answer changes (a test compares it with 0085's, key for key). It also lets the phone **settle** a stock submission whose answer was lost: `pur_op_cancel(op)` takes the operation's own lock (the one every write takes first) and either reports the operation `recorded` — changing nothing — or marks the id `cancelled` for good (a `pur_ops` row of kind `cancelled`); 0096's `pur_op_begin` is redefined, unchanged but for refusing a cancelled id (`OP_CANCELLED`), so a request that arrives after the cancel records nothing; `pur_op_state(op)` reads `recorded` / `cancelled` / `none`. No table or column changes. The buyer and office stock screens on the phone otherwise call 0104/0105's `stk_*` functions as the web does. Requires 0104 (and 0105 on the live order). Prove with `npm run test:sql` (`2bb_phone.pglite.mjs`, which also runs the joint pilot's guarded clean-up `supabase/tests/2bc_pilot_cleanup.sql` on a simulated pilot beside real data; `2bb_concurrency.mjs`: a cancel against a recording in flight, on real PostgreSQL); live: `supabase/tests/2bb_acceptance.sql` (read-only, rolls back).
 
+**0107 (WorkMate Stage 3a — tools: a numbered register, custody, condition-aware returns; OUTSIDE the money model)** adds five private tables (RLS on, no policies — reads and writes only through its functions): `tl_settings` (the company's tools switch, main owner only; every write is refused `TOOLS_OFF` until it is on — first for the ZZ pilot, then kept on or switched off), `tl_tools` (one real tool: `number` per company — TOOL-0001…, never reused; its catalogue item, which must be of kind `tool`; the purchase line it came from, if any; brand / model / serial; one photo under `uploads/tools/<company>/`; `state` available / issued / repair / lost_pending / lost / retire_pending / retired / cancelled; `condition`; `holder_id` + `folder_id` — an issued tool always has both: **a tool at a project always has a named responsible person**), `tl_records` (one action on one tool, with the tool's custody `before` and `after` it: register, issue, handover, return, repaired, lost, found, retire; Lost and Retire wait for the **main owner** — confirm → `after`, reject or withdraw → `before`, so a rejected Lost report puts the tool exactly back and a rejected Retire leaves it Under repair; a mistake is reversed with a reason while it is the tool's latest record, never edited), `tl_covers` (what an issue filled on a tool request line when the tool was NOT bought for it) and the append-only `tl_events`. Redefines 0104's `pr_portion_bought` / `pr_line_bought` as purchases + stock + tools (`pr_*_from_tools`), so every Still to buy counts a tool issued for the line once — a tool bought for the line counts through its purchase only (`tl_bought_for`); 0104's `stk_overview` (Receiving leaves out tool lines — `tl_tool_line`) and `pr_item_in_use` (tools fix an item's kind and unit). Triggers: a tool item is never quantity stock (`tl_no_tool_stock` on `stk_matches` / `stk_lots` / `stk_records` — `TOOL_ITEM`; a line with tools registered from it — `TOOL_LINE`); a purchase line keeps at least the tools registered from it, checked at the end of the transaction because a correction re-inserts every line (`tl_guard_line`, deferred — `TOOLS_IN_USE`), and such a purchase is never voided (`tl_guard_void`). Callable: `tl_register`, `tl_issue`, `tl_handover`, `tl_return`, `tl_repaired`, `tl_report_lost`, `tl_request_retire`, `tl_found`, `tl_decide` (main owner), `tl_reverse`, `tl_overview`, `tl_tool`, `tl_choices`, `tl_request_lines`, `tl_project_out` (Project Control's Mark as Complete), `tl_line_tools` (the shopping list), `tl_status`, `tl_set_enabled` (main owner). Who: owner and office staff allowed Expenses (stock's rule); workers and team leaders record nothing in 3a. **Writes and reads no peso amount**; nothing touches expenses, Spent, Earned or Profit. Requires 0104 (and 0105/0106 on the live order). Prove with `npm run test:sql` (`3a_tools.pglite.mjs`, `3a_concurrency.mjs`, and the 2A / 2B / 2C / 2B-b suites re-run `--with-0107`) and `node tests/tools-admin.test.js`; live: `supabase/tests/3a_acceptance.sql` (self-wrapped, rolls back).
+
 Get the truth before relying on this line:
 
 ```sql
````

**Modify:** `supabase/tests/2a1_purchase.pglite.mjs`

```diff
diff --git a/supabase/tests/2a1_purchase.pglite.mjs b/supabase/tests/2a1_purchase.pglite.mjs
index 376e414..680290d 100644
--- a/supabase/tests/2a1_purchase.pglite.mjs
+++ b/supabase/tests/2a1_purchase.pglite.mjs
@@ -24,7 +24,11 @@ const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
 // --with-0104: and 2B-a's 0104 (stock) on top, switched OFF as before launch —
 // the old tickbox and every purchase rule unchanged.
 // --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
-const WITH_0105 = process.argv.includes('--with-0105');
+// --with-0107: and 3a's 0107 (tools) on top of 0105, switched OFF — tools must not change
+// how a purchase is recorded, corrected or voided.
+const WITH_0107 = process.argv.includes('--with-0107');
+const M107 = WITH_0107 ? read(path.join(ROOT, 'supabase/migrations/0107_tools.sql')) : '';
+const WITH_0105 = process.argv.includes('--with-0105') || WITH_0107;
 const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
 const WITH_0102 = process.argv.includes('--with-0102') || WITH_0104;
 const M98 = WITH_0102 ? read(path.join(ROOT, 'supabase/migrations/0098_pm_profit_sharing.sql')) : '';
@@ -110,7 +114,7 @@ async function fresh() {
   if (WITH_0097) { await db.exec(PR_BASE); await db.exec(M97); }
   if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
-  if (WITH_0104) { await db.exec(PR_MOD.CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); }
+  if (WITH_0104) { await db.exec(PR_MOD.CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); if (WITH_0107) await db.exec(M107); }
   await db.exec(`insert into profiles values
     ('${OWNER}', 'owner', null, 'active', null), ('${STAFF}', 'staff', '${OWNER}', 'active', null),
     ('${WORKER}', 'worker', '${OWNER}', 'active', null), ('${OTHER}', 'owner', null, 'active', null),
```

**Modify:** `supabase/tests/2a2_purchasing.pglite.mjs`

```diff
diff --git a/supabase/tests/2a2_purchasing.pglite.mjs b/supabase/tests/2a2_purchasing.pglite.mjs
index 77b9c2f..dd8f986 100644
--- a/supabase/tests/2a2_purchasing.pglite.mjs
+++ b/supabase/tests/2a2_purchasing.pglite.mjs
@@ -26,7 +26,11 @@ const M97 = read(path.join(ROOT, 'supabase/migrations/0097_purchasing_office.sql
 // --with-0104: and 2B-a's 0104 (stock) on top, switched ON (launch) — stock
 // must not change how the Purchasing tab buys, covers, corrects or approves.
 // --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
-const WITH_0105 = process.argv.includes('--with-0105');
+// --with-0107: and 3a's 0107 (tools) on top of 0105, switched ON — tools must not change
+// how a purchase is recorded, corrected or voided.
+const WITH_0107 = process.argv.includes('--with-0107');
+const M107 = WITH_0107 ? read(path.join(ROOT, 'supabase/migrations/0107_tools.sql')) : '';
+const WITH_0105 = process.argv.includes('--with-0105') || WITH_0107;
 const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
 const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
 const M105 = WITH_0105 ? read(path.join(ROOT, 'supabase/migrations/0105_stock_cost_moves.sql')) : '';
@@ -104,7 +108,7 @@ async function fresh() {
   await db.exec(M97);
   if (WITH_0101) { await db.exec(`create role service_role`); await db.exec(M101); }
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
-  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); }
+  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); if (WITH_0107) await db.exec(M107); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -118,6 +122,7 @@ async function fresh() {
   await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
   await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
   if (WITH_0104) await db.query(`select stk_set_enabled(true)`);
+  if (WITH_0107) await db.query(`select tl_set_enabled(true)`);
   return db;
 }
 async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
```

**Modify:** `supabase/tests/2a3_server.pglite.mjs`

```diff
diff --git a/supabase/tests/2a3_server.pglite.mjs b/supabase/tests/2a3_server.pglite.mjs
index eb50073..1ef0b48 100644
--- a/supabase/tests/2a3_server.pglite.mjs
+++ b/supabase/tests/2a3_server.pglite.mjs
@@ -24,7 +24,11 @@ const M101 = read(path.join(ROOT, 'supabase/migrations/0101_purchasing_phone.sql
 // --with-0102: the same tests with 2A-4a's 0102 on top — payments must not change the phone server.
 // --with-0104: and 2B-a's 0104 (stock) on top, switched ON (launch).
 // --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
-const WITH_0105 = process.argv.includes('--with-0105');
+// --with-0107: and 3a's 0107 (tools) on top of 0105, switched ON — tools must not change
+// how a purchase is recorded, corrected or voided.
+const WITH_0107 = process.argv.includes('--with-0107');
+const M107 = WITH_0107 ? read(path.join(ROOT, 'supabase/migrations/0107_tools.sql')) : '';
+const WITH_0105 = process.argv.includes('--with-0105') || WITH_0107;
 const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
 const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
 const M105 = WITH_0105 ? read(path.join(ROOT, 'supabase/migrations/0105_stock_cost_moves.sql')) : '';
@@ -115,7 +119,7 @@ async function fresh() {
   await db.exec(M97);
   await db.exec(M101);
   if (WITH_0102) { await db.exec(fnText(M98, 'pm_main_owner_id')); await db.exec(M102); }
-  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); }
+  if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); if (WITH_0107) await db.exec(M107); }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', null),
@@ -134,6 +138,7 @@ async function fresh() {
   await db.query(`select pur_set_buyer($1, true)`, [GONE]);
   await db.query(`update profiles set status = 'inactive' where id = $1`, [GONE]);
   if (WITH_0104) await db.query(`select stk_set_enabled(true)`);
+  if (WITH_0107) await db.query(`select tl_set_enabled(true)`);
   return db;
 }
 async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
```

**Modify:** `supabase/tests/2a4_payments.pglite.mjs`

```diff
diff --git a/supabase/tests/2a4_payments.pglite.mjs b/supabase/tests/2a4_payments.pglite.mjs
index 85f4ca6..c06db40 100644
--- a/supabase/tests/2a4_payments.pglite.mjs
+++ b/supabase/tests/2a4_payments.pglite.mjs
@@ -27,7 +27,11 @@ const M102 = read(path.join(ROOT, 'supabase/migrations/0102_purchase_payments.sq
 // --with-0104: and 2B-a's 0104 (stock) on top of 0103, switched ON (launch) —
 // stock must not change how purchases are paid.
 // --with-0105: and 2C's 0105 (cost moves) on top of 0104 — it redefines 0096's two guards.
-const WITH_0105 = process.argv.includes('--with-0105');
+// --with-0107: and 3a's 0107 (tools) on top of 0105, switched ON — tools must not change
+// how a purchase is recorded, corrected or voided.
+const WITH_0107 = process.argv.includes('--with-0107');
+const M107 = WITH_0107 ? read(path.join(ROOT, 'supabase/migrations/0107_tools.sql')) : '';
+const WITH_0105 = process.argv.includes('--with-0105') || WITH_0107;
 const WITH_0104 = process.argv.includes('--with-0104') || WITH_0105;
 const M104 = WITH_0104 ? read(path.join(ROOT, 'supabase/migrations/0104_stock.sql')) : '';
 const M105 = WITH_0105 ? read(path.join(ROOT, 'supabase/migrations/0105_stock_cost_moves.sql')) : '';
@@ -121,7 +125,7 @@ async function fresh(opts = {}) {
     await db.exec(fnText(M98, 'pm_main_owner_id'));
     await db.exec(M102);
     if (WITH_0103) await db.exec(M103);
-    if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); }
+    if (WITH_0104) { await db.exec(CATALOG_0085); await db.exec(M104); if (WITH_0105) await db.exec(M105); if (WITH_0107) await db.exec(M107); }
   }
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
@@ -141,6 +145,7 @@ async function fresh(opts = {}) {
   await db.query(`select pur_set_buyer($1, true)`, [GONE]);
   await db.query(`update profiles set status = 'inactive' where id = $1`, [GONE]);
   if (WITH_0104 && !opts.without102) await db.query(`select stk_set_enabled(true)`);
+  if (WITH_0107 && !opts.without102) await db.query(`select tl_set_enabled(true)`);
   return db;
 }
 async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
```

**Modify:** `supabase/tests/2b_stock.pglite.mjs`

```diff
diff --git a/supabase/tests/2b_stock.pglite.mjs b/supabase/tests/2b_stock.pglite.mjs
index 38fbddd..975a0cc 100644
--- a/supabase/tests/2b_stock.pglite.mjs
+++ b/supabase/tests/2b_stock.pglite.mjs
@@ -28,7 +28,10 @@ const M103 = mig('0103_buyer_return_photo.sql');
 const M90 = mig('0090_workmate_item_history.sql');
 const M104 = mig('0104_stock.sql');
 // --with-0105: and 2C's 0105 (cost moves) on top — every 2B-a behaviour holds.
-const WITH_0105 = process.argv.includes('--with-0105');
+// --with-0107: and 3a's 0107 (tools) on top of 0105, switched ON — every 2B-a behaviour holds for materials.
+const WITH_0107 = process.argv.includes('--with-0107');
+const M107 = WITH_0107 ? mig('0107_tools.sql') : '';
+const WITH_0105 = process.argv.includes('--with-0105') || WITH_0107;
 const M105 = WITH_0105 ? mig('0105_stock_cost_moves.sql') : '';
 
 const BASE = `
@@ -110,6 +113,7 @@ async function fresh(opts = {}) {
   await db.exec(M103);
   await db.exec(M104);
   if (WITH_0105) await db.exec(M105);
+  if (WITH_0107) await db.exec(M107);
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
@@ -125,6 +129,7 @@ async function fresh(opts = {}) {
   await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
   await db.query(`select pur_set_buyer($1, true)`, [BUYER2]);
   if (opts.on !== false) await db.query(`select stk_set_enabled(true)`);
+  if (WITH_0107) await db.query(`select tl_set_enabled(true)`);
   return db;
 }
 async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
@@ -235,7 +240,7 @@ async function layersOf(db, takes) {
   return out;
 }
 
-console.log('\n2B-a stock (0096 + 0097 + 0101 + 0102 + 0103 + 0104' + (WITH_0105 ? ' + 0105' : '') + ' on PGlite)');
+console.log('\n2B-a stock (0096 + 0097 + 0101 + 0102 + 0103 + 0104' + (WITH_0105 ? ' + 0105' : '') + (WITH_0107 ? ' + 0107' : '') + ' on PGlite)');
 
 // ── A. The switch, and who ────────────────────────────────────────────
 
```

**Modify:** `supabase/tests/2bb_phone.pglite.mjs`

```diff
diff --git a/supabase/tests/2bb_phone.pglite.mjs b/supabase/tests/2bb_phone.pglite.mjs
index d6eeac2..8a5abe8 100644
--- a/supabase/tests/2bb_phone.pglite.mjs
+++ b/supabase/tests/2bb_phone.pglite.mjs
@@ -30,6 +30,9 @@ const M103 = mig('0103_buyer_return_photo.sql');
 const M90 = mig('0090_workmate_item_history.sql');
 const M104 = mig('0104_stock.sql');
 const M105 = mig('0105_stock_cost_moves.sql');
+// --with-0107: and 3a's 0107 (tools) on top, switched ON — every behaviour here holds.
+const WITH_0107 = process.argv.includes('--with-0107');
+const M107 = WITH_0107 ? mig('0107_tools.sql') : '';
 const M106 = mig('0106_workmate_phone_stock.sql');
 const M85 = mig('0085_workmate_requests.sql');
 const M51 = mig('0051_attendance_worker_owner.sql');
@@ -130,6 +133,7 @@ async function fresh(opts = {}) {
   await db.exec(M105);
   await db.exec(REQUESTS_0085);
   await db.exec(M106);
+  if (WITH_0107) await db.exec(M107);
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
```

**Modify:** `supabase/tests/2c_cost.pglite.mjs`

```diff
diff --git a/supabase/tests/2c_cost.pglite.mjs b/supabase/tests/2c_cost.pglite.mjs
index dcd6831..7ce7d64 100644
--- a/supabase/tests/2c_cost.pglite.mjs
+++ b/supabase/tests/2c_cost.pglite.mjs
@@ -28,6 +28,9 @@ const M103 = mig('0103_buyer_return_photo.sql');
 const M90 = mig('0090_workmate_item_history.sql');
 const M104 = mig('0104_stock.sql');
 const M105 = mig('0105_stock_cost_moves.sql');
+// --with-0107: and 3a's 0107 (tools) on top, switched ON — every behaviour here holds.
+const WITH_0107 = process.argv.includes('--with-0107');
+const M107 = WITH_0107 ? mig('0107_tools.sql') : '';
 
 const BASE = `
 create role anon; create role authenticated; create role service_role;
@@ -108,6 +111,7 @@ async function fresh(opts = {}) {
   await db.exec(M103);
   await db.exec(M104);
   await db.exec(M105);
+  if (WITH_0107) await db.exec(M107);
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
```

**Create:** `supabase/tests/3a_acceptance.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 3a acceptance — migration 0107 (live: tools). Self-wrapped in
-- begin / rollback: section D switches tools on and records a whole tool's
-- life on a ZZ item, then every row of it is rolled back.
-- Run it through MCP execute_sql. Success ends with the row
-- '3a acceptance: all checks passed'.
--   A. tools are still off: the main owner's status says so, every write is
--      refused TOOLS_OFF, Mark as Complete and the shopping list read nothing;
--      no tool rows exist;
--   B. who may call what: every tl_ operation and reader is for signed-in
--      accounts only, every helper for nobody;
--   C. nothing changed for requests: tools fill no request line, so every
--      line's covered figure is still purchases + stock;
--   D. as the main owner, with tools switched on inside this transaction: a
--      registration at a project needs its person, an opening one a photo; register, issue (a real
--      active worker, a real project in progress), hand back damaged → a
--      Retire request; rejected → Under repair; Lost reported, rejected →
--      exactly back; a tool item refused as stock (TOOL_ITEM); the readers
--      answer with no money. All rolled back.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';

do $$
declare
  v_owner uuid := (select id from profiles where role = 'owner' and owner_id is null and coalesce(status, 'active') = 'active'
                     order by created_at limit 1);
  v_worker uuid;
  v_folder uuid;
  v_item uuid;
  v_err text;
  r jsonb;
  t uuid;
  v_rec uuid;
  fn text;
  v_any_folder uuid := (select id from folders where owner_id = v_owner limit 1);
  v_lines uuid[] := array(select id from pr_lines limit 20);
begin
  -- A
  assert not coalesce((select s.enabled from tl_settings s where s.owner_id = v_owner), false), 'A1 tools must still be off live';
  assert (select count(*) from tl_tools) = 0 and (select count(*) from tl_records) = 0 and (select count(*) from tl_covers) = 0,
    'A2 no tool rows yet';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert (tl_status() ->> 'enabled')::boolean = false and (tl_status() ->> 'is_main_owner')::boolean, 'A3 status: off, main owner';
  begin
    perform tl_register(gen_random_uuid(), '{"item_id": null}'::jsonb);
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'TOOLS_OFF', 'A4 a write while off — got ' || coalesce(v_err, 'no refusal');
  assert tl_project_out(v_any_folder) = '[]'::jsonb, 'A5 Mark as Complete reads nothing while off';
  assert tl_line_tools(v_lines) = '{}'::jsonb, 'A6 the shopping list reads nothing while off';
  execute 'reset role';

  -- B
  foreach fn in array array['tl_status()', 'tl_set_enabled(boolean)', 'tl_register(uuid,jsonb)', 'tl_issue(uuid,jsonb)',
      'tl_handover(uuid,jsonb)', 'tl_return(uuid,jsonb)', 'tl_repaired(uuid,uuid,text)', 'tl_report_lost(uuid,uuid,text)',
      'tl_request_retire(uuid,uuid,text)', 'tl_found(uuid,jsonb)', 'tl_decide(uuid,uuid,boolean,text)', 'tl_reverse(uuid,uuid,text)',
      'tl_overview()', 'tl_tool(uuid)', 'tl_choices()', 'tl_request_lines(uuid)', 'tl_project_out(uuid)', 'tl_line_tools(uuid[])', 'stk_overview()'] loop
    assert has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute'), 'B1 signed-in only: ' || fn;
  end loop;
  foreach fn in array array['tl_actor()', 'tl_reader()', 'tl_write(uuid,tl_tools,text,text,jsonb,jsonb)', 'tl_apply(uuid,jsonb,boolean)',
      'tl_cover(uuid,uuid,uuid,uuid,uuid)', 'tl_bought_for(tl_tools,uuid,uuid)', 'pr_line_bought(uuid)', 'pr_portion_bought(uuid)',
      'pr_item_in_use(uuid)', 'tl_tool_json(uuid)', 'tl_record_json(uuid)'] loop
    assert not has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute'), 'B2 nobody: ' || fn;
  end loop;

  -- C
  assert not exists (select 1 from pr_lines l where pr_line_bought(l.id) <> pr_line_purchased(l.id) + pr_line_from_stock(l.id)),
    'C1 every request line: covered = purchases + stock (tools fill nothing yet)';

  -- D
  select p.id into v_worker from profiles p
   where p.role in ('worker', 'teamLeader') and coalesce(p.status, 'active') = 'active' and coalesce(p.owner_id, p.id) = v_owner limit 1;
  select f.id into v_folder from folders f left join folders par on par.id = f.parent_folder_id
   where f.owner_id = v_owner and f.completed_at is null and par.completed_at is null limit 1;
  assert v_worker is not null and v_folder is not null, 'D0 an active worker and a project in progress exist';
  insert into pr_catalog_items (owner_id, name, unit, kind) values (v_owner, 'ZZ 3a acceptance grinder', 'pc', 'tool') returning id into v_item;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform tl_set_enabled(true);
  v_err := null;
  begin
    perform tl_register(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'at', v_folder, 'condition', 'good'));
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'PERSON_REQUIRED', 'D1 at a project without a person — got ' || coalesce(v_err, 'no refusal');
  v_err := null;
  begin
    perform tl_register(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'at', 'warehouse', 'condition', 'good'));
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'PHOTO_REQUIRED', 'D1b an opening register without a photo — got ' || coalesce(v_err, 'no refusal');
  r := tl_register(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'at', 'warehouse', 'condition', 'good', 'details', 'ZZ',
                                                         'photo_path', 'tools/' || v_owner || '/2026-10/' || gen_random_uuid() || '.jpg'));
  t := (r -> 'tools' -> 0 ->> 'tool_id')::uuid;
  assert (r -> 'tools' -> 0 ->> 'number')::int = 1, 'D2 the first tool is TOOL-0001';
  perform tl_issue(gen_random_uuid(), jsonb_build_object('tool_id', t, 'holder_id', v_worker, 'folder_id', v_folder));
  assert (tl_project_out(v_folder) -> 0 ->> 'label') = 'TOOL-0001', 'D3 Mark as Complete would name it';
  r := tl_return(gen_random_uuid(), jsonb_build_object('tool_id', t, 'condition', 'damaged', 'note', 'ZZ'));
  v_rec := (r ->> 'retire_record_id')::uuid;
  assert (tl_tool(t) ->> 'state') = 'retire_pending', 'D4 damaged → waiting for the owner';
  v_err := null;
  begin
    perform tl_issue(gen_random_uuid(), jsonb_build_object('tool_id', t, 'holder_id', v_worker, 'folder_id', v_folder));
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'NOT_AVAILABLE', 'D5 not issued while waiting — got ' || coalesce(v_err, 'no refusal');
  perform tl_decide(gen_random_uuid(), v_rec, false, 'ZZ repair it');
  assert (tl_tool(t) ->> 'state') = 'repair', 'D6 a rejected retire → Under repair';
  perform tl_repaired(gen_random_uuid(), t, 'ZZ');
  perform tl_issue(gen_random_uuid(), jsonb_build_object('tool_id', t, 'holder_id', v_worker, 'folder_id', v_folder));
  v_rec := (tl_report_lost(gen_random_uuid(), t, 'ZZ') ->> 'record_id')::uuid;
  perform tl_decide(gen_random_uuid(), v_rec, false, 'ZZ it is on site');
  r := tl_tool(t);
  assert (r ->> 'state') = 'issued' and (r ->> 'holder_id')::uuid = v_worker, 'D7 a rejected Lost → exactly back';
  r := tl_overview();
  assert r::text !~ '"(amount|price|cost[a-z_]*|value|peso|gross[a-z_]*)"\s*:', 'D8 the Tools screen carries no money';
  v_err := null;
  begin
    perform stk_opening(gen_random_uuid(), jsonb_build_object('item_id', v_item, 'at', 'warehouse', 'quantity', '1',
                                                              'on', to_char(now() at time zone 'Asia/Manila', 'YYYY-MM-DD')));
  exception when others then v_err := sqlerrm;
  end;
  assert v_err = 'TOOL_ITEM', 'D9 a tool item is never stock — got ' || coalesce(v_err, 'no refusal');
  execute 'reset role';
  raise notice 'checked with worker % on folder %', v_worker, v_folder;
end $$;

select '3a acceptance: all checks passed' as result;
rollback;
```

**Create:** `supabase/tests/3a_concurrency.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 3a TOOLS — TWO SESSIONS AT ONCE, REAL POSTGRESQL
//   npm run test:sql      (runs after 3a_tools.pglite.mjs)
//
// Same approach as 2b_concurrency.mjs: a throwaway PostgreSQL on this
// machine (or the CI runner), migrations 0096 + 0097 + 0101 + 0102 + 0104 +
// 0107 VERBATIM over the same minimal tables, pairs of calls released at the
// same moment on two connections. Nothing touches the live database.
//   1. the same tool issued twice at once → one, never two holders
//   2. two registrations at once → every number once, none skipped
//   3. two registrations for the last place on a purchase line → one
//   4. a correction lowering a line while a tool is registered from it → never more tools than the line
//   5. two tools issued for the last place on a request line → one fills it, never past it
//   6. the owner confirms a Lost report while the office withdraws it → one wins, the tool matches it
//   7. a handover and a return of the same tool at once → one after the other, one unbroken history
//   8. a purchase and a tool issue for the last place on a request line at once → never filled twice
// ════════════════════════════════════════════════════════════════════
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prBase, fnText, CATALOG_0085 } from './pr_base.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DACS_ROOT || path.join(HERE, '..', '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const mig = (f) => read(path.join(ROOT, 'supabase/migrations', f));
const M02 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';
const BUYER = '00000000-0000-0000-0000-000000000011';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const WORKER2 = '00000000-0000-0000-0000-000000000019';
const ROUNDS = 15;
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; failures.push(name + ' — ' + detail); console.log('  FAIL ' + name + '\n       ' + detail); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dacs-3a-pg-'));
const port = 55000 + Math.floor(Math.random() * 4000);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const cfg = { host: 'localhost', port, user: 'postgres', password: 'pw', database: 'postgres' };

console.log('\n3a tools — two sessions at once (0096 + 0097 + 0101 + 0102 + 0104 + 0107 on PostgreSQL)');
await server.initialise();
await server.start();
const admin = new pg.Client(cfg);
await admin.connect();
try {
  await admin.query(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table profiles (id uuid primary key, role text, owner_id uuid, status text, allowed_modules jsonb);
create table folders (id uuid primary key default gen_random_uuid(), owner_id uuid not null, name text not null,
  parent_folder_id uuid references folders(id), completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table projects (id uuid primary key default gen_random_uuid(), owner_id uuid not null, folder_id uuid references folders(id) on delete cascade,
  month text, year int, funding_type text, billing_number int, created_at timestamptz default now(), updated_at timestamptz default now());
create table project_budgets (project_id uuid primary key references projects(id) on delete cascade, owner_id uuid not null, monthly_budget numeric not null default 0);
create table expenses (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade,
  expense_name text, category text, quantity numeric, amount numeric, date_time text, notes text, payment_method text,
  po_image_url text, delivery_receipt_url text, supplier_invoice_url text, payment_receipt_url text,
  in_inventory boolean default false, cover_expense boolean default false, split_group text, split_index int, split_total int,
  client_submission_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table payroll (id uuid primary key default gen_random_uuid(), owner_id uuid not null, project_id uuid references projects(id) on delete cascade, total_salary numeric);
create table inventory (id uuid primary key default gen_random_uuid(), legacy_id text unique, owner_id uuid, item_name text, unit text,
  current_stock numeric, min_stock numeric, notes text, last_updated timestamptz, last_adjusted_by uuid, created_at timestamptz default now());
${fnText(M02, 'auth_role')}
${fnText(M02, 'is_owner')}
${fnText(M02, 'is_staff')}
${fnText(M02, 'data_owner_id')}
${fnText(M02, 'can_access')}
${fnText(M94, 'pr_is_office')}`);
  await admin.query(mig('0096_purchase_recording.sql'));
  await admin.query(prBase(ROOT));
  await admin.query(CATALOG_0085);
  await admin.query(mig('0097_purchasing_office.sql'));
  await admin.query(mig('0101_purchasing_phone.sql'));
  await admin.query(fnText(mig('0098_pm_profit_sharing.sql'), 'pm_main_owner_id'));
  await admin.query(mig('0102_purchase_payments.sql'));
  await admin.query(fnText(mig('0090_workmate_item_history.sql'), 'pr_clean_aliases'));
  await admin.query(mig('0104_stock.sql'));
  await admin.query(mig('0107_tools.sql'));
  await admin.query(`insert into profiles (id, role, owner_id, status, display_name) values
    ('${OWNER}', 'owner', null, 'active', 'Owner'), ('${STAFF}', 'staff', '${OWNER}', 'active', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', 'Juan'), ('${WORKER}', 'worker', '${OWNER}', 'active', 'Mark'),
    ('${WORKER2}', 'worker', '${OWNER}', 'active', 'Rey');
    select set_config('test.uid', '${OWNER}', false);
    select pur_set_buyer('${BUYER}', true);
    select stk_set_enabled(true);
    select tl_set_enabled(true);`);

  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];
  const as = (uid) => admin.query(`select set_config('test.uid', '${uid}', false)`);
  const mkFolder = async (name) => (await one(`insert into folders (owner_id, name) values ($1, $2) returning id`, [OWNER, name])).id;
  const item = async (name) => (await one(`insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, $2, 'pc', 'tool') returning id`, [OWNER, name])).id;
  const purchase = (lines) => JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: lines.reduce((s, l) => s + l.amount, 0),
    lines: lines.map(l => ({ category: 'Tools', unit: 'pc', unplanned_reason: 'test', ...l })) });
  const record = async (lines) => {
    await as(BUYER);
    return (await one(`select pur_record(gen_random_uuid(), $1::jsonb) r`, [purchase(lines)])).r.purchase_id;
  };
  const call = async (uid, sql, args) => { await as(uid); return (await one(sql, args)).r; };
  const mkPeriod = async (f) => {
    const p = (await one(`insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                          values ($1, $2, to_char(now() at time zone 'Asia/Manila', 'FMMonth'),
                                  extract(year from now() at time zone 'Asia/Manila')::int, 'progress', 1) returning id`, [OWNER, f])).id;
    await admin.query(`insert into project_budgets values ($1, $2, 1000000)`, [p, OWNER]);
  };
  const REGISTER = `select tl_register(gen_random_uuid(), $1::jsonb) r`;
  const ISSUE = `select tl_issue(gen_random_uuid(), $1::jsonb) r`;
  // An opening register needs a photo (Q7): a path of this company's tools folder.
  const reg = (b) => JSON.stringify({ condition: 'good', at: 'warehouse',
    ...(b.purchase_id ? {} : { photo_path: `tools/${OWNER}/2026-10/${crypto.randomUUID()}.jpg` }), ...b });
  const oneTool = async (it) => (await call(STAFF, REGISTER, [reg({ item_id: it })])).tools[0].tool_id;
  const toolRow = (id) => one(`select state, holder_id from tl_tools where id = $1`, [id]);

  const session = async (uid) => {
    const c = new pg.Client(cfg); await c.connect();
    await c.query(`select set_config('test.uid', '${uid}', false)`);
    return c;
  };
  async function pair(uidA, sqlA, argsA, uidB, sqlB, argsB) {
    const [a, b] = [await session(uidA), await session(uidB)];
    const run = async (c, sql, args) => {
      try {
        await c.query('begin');
        const r = await c.query(sql, args);
        await c.query('select pg_sleep(0.03)');
        await c.query('commit');
        return { ok: true, r: r.rows[0] && r.rows[0].r };
      } catch (e) {
        try { await c.query('rollback'); } catch {}
        return { ok: false, code: e.code, msg: e.message };
      }
    };
    const out = await Promise.all([run(a, sqlA, argsA), run(b, sqlB, argsB)]);
    await a.end(); await b.end();
    return out;
  }
  const deadlock = (out) => out.some(o => !o.ok && o.code === '40P01');

  // 1
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Grinder ' + i);
      const f = await mkFolder('twice ' + i);
      const t = await oneTool(it);
      const out = await pair(STAFF, ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f })],
                             BUYER, ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER2, folder_id: f })]);
      if (deadlock(out)) dead++;
      const issues = Number((await one(`select count(*) n from tl_records where tool_id = $1 and kind = 'issue'`, [t])).n);
      const row = await toolRow(t);
      const winner = out[0].ok ? WORKER : WORKER2;
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /NOT_AVAILABLE/.test(o.msg))
          || issues !== 1 || row.state !== 'issued' || row.holder_id !== winner) bad++;
    }
    check('1. the same tool issued to two people at once: exactly one issue, one holder', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 2
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Drill ' + i);
      const before = Number((await one(`select coalesce(max(number), 0) m from tl_tools where owner_id = $1`, [OWNER])).m);
      const out = await pair(STAFF, REGISTER, [reg({ item_id: it, count: 2 })], BUYER, REGISTER, [reg({ item_id: it, count: 3 })]);
      if (deadlock(out)) dead++;
      const nums = (await admin.query(`select number from tl_tools where owner_id = $1 and number > $2 order by number`, [OWNER, before])).rows.map(r => r.number);
      const want = [1, 2, 3, 4, 5].map(n => before + n);
      if (out.filter(o => o.ok).length !== 2 || JSON.stringify(nums) !== JSON.stringify(want)) bad++;
    }
    check('2. two registrations at once: both accepted, every number once and none skipped', bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 3
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Mixer ' + i);
      const pid = await record([{ destination: 'warehouse', item_name: 'Mixer', quantity: 3, amount: 3000 }]);
      await call(STAFF, REGISTER, [reg({ item_id: it, purchase_id: pid, line_no: 1, count: 2 })]);
      const b = reg({ item_id: it, purchase_id: pid, line_no: 1 });
      const out = await pair(STAFF, REGISTER, [b], BUYER, REGISTER, [b]);
      if (deadlock(out)) dead++;
      const n = Number((await one(`select tl_line_registered($1, 1) n`, [pid])).n);
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /MORE_THAN_BOUGHT/.test(o.msg)) || n !== 3) bad++;
    }
    check('3. two registrations for the last place on a purchase line: one, never more tools than the line bought',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 4
  {
    let bad = 0, dead = 0;
    const FIX = `select pur_correct(gen_random_uuid(), $1, $2::jsonb, 'fix') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Saw ' + i);
      const pid = await record([{ destination: 'warehouse', item_name: 'Saw', quantity: 3, amount: 3000 }]);
      await call(STAFF, REGISTER, [reg({ item_id: it, purchase_id: pid, line_no: 1 })]);
      const fixed = purchase([{ destination: 'warehouse', item_name: 'Saw', quantity: 1, amount: 1000 }]);
      const out = await pair(OWNER, FIX, [pid, fixed], STAFF, REGISTER, [reg({ item_id: it, purchase_id: pid, line_no: 1 })]);
      if (deadlock(out)) dead++;
      const q = Number((await one(`select quantity q from purchase_lines where purchase_id = $1`, [pid])).q);
      const n = Number((await one(`select tl_line_registered($1, 1) n`, [pid])).n);
      const ok = out.filter(o => o.ok).length === 1 && n <= q
        && ((out[0].ok && q === 1 && n === 1 && /MORE_THAN_BOUGHT/.test(out[1].msg))
            || (out[1].ok && q === 3 && n === 2 && /TOOLS_IN_USE/.test(out[0].msg)));
      if (!ok) bad++;
    }
    check('4. a correction lowering a line while a tool is registered from it: one wins, never more tools than the line',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 5
  {
    let bad = 0, dead = 0;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Level ' + i);
      const f = await mkFolder('last place ' + i);
      const batch = (await one(`select pr_batch_for($1, now()) b`, [OWNER])).b;
      const req = (await one(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`, [OWNER, WORKER, f])).id;
      const line = (await one(`insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id, kind) values ($1, $2, 'Level', 'pc', $3, 'tool') returning id`, [OWNER, req, it])).id;
      await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 1)`, [OWNER, line, batch]);
      const [t1, t2] = [await oneTool(it), await oneTool(it)];
      const out = await pair(STAFF, ISSUE, [JSON.stringify({ tool_id: t1, holder_id: WORKER, folder_id: f, request_line_id: line })],
                             BUYER, ISSUE, [JSON.stringify({ tool_id: t2, holder_id: WORKER2, folder_id: f, request_line_id: line })]);
      if (deadlock(out)) dead++;
      const filled = Number((await one(`select pr_line_bought($1) b`, [line])).b);
      if (out.filter(o => o.ok).length !== 1 || !out.some(o => !o.ok && /REQUEST_EXCEEDED/.test(o.msg)) || filled !== 1) bad++;
    }
    check('5. two tools issued for the last place on a request line at once: one fills it, never past it',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 6
  {
    let bad = 0, dead = 0;
    const DECIDE = `select tl_decide(gen_random_uuid(), $1, true, 'gone') r`;
    const WITHDRAW = `select tl_reverse(gen_random_uuid(), $1, 'found it') r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Jack ' + i);
      const f = await mkFolder('lost ' + i);
      const t = (await call(STAFF, REGISTER, [reg({ item_id: it, at: f, holder_id: WORKER })])).tools[0].tool_id;
      const rec = (await call(STAFF, `select tl_report_lost(gen_random_uuid(), $1, 'missing') r`, [t])).record_id;
      const out = await pair(OWNER, DECIDE, [rec], STAFF, WITHDRAW, [rec]);
      if (deadlock(out)) dead++;
      const status = (await one(`select status from tl_records where id = $1`, [rec])).status;
      const row = await toolRow(t);
      const ok = out.filter(o => o.ok).length === 1 && /BAD_STATE/.test((out.find(o => !o.ok) || {}).msg || '')
        && ((out[0].ok && status === 'done' && row.state === 'lost') || (out[1].ok && status === 'withdrawn' && row.state === 'issued' && row.holder_id === WORKER));
      if (!ok) bad++;
    }
    check('6. the owner confirms a Lost report while the office withdraws it: one wins, and the tool is where that one says',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 7
  {
    let bad = 0, dead = 0;
    const HAND = `select tl_handover(gen_random_uuid(), $1::jsonb) r`;
    const RET = `select tl_return(gen_random_uuid(), $1::jsonb) r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Trowel ' + i);
      const f = await mkFolder('hand or return ' + i);
      const t = (await call(STAFF, REGISTER, [reg({ item_id: it, at: f, holder_id: WORKER })])).tools[0].tool_id;
      const out = await pair(STAFF, HAND, [JSON.stringify({ tool_id: t, holder_id: WORKER2 })],
                             BUYER, RET, [JSON.stringify({ tool_id: t, condition: 'good' })]);
      if (deadlock(out)) dead++;
      const row = await toolRow(t);
      // Either order is real: handed over then returned (both stand), or
      // returned first and the handover refused. Never a lost update: each
      // record starts where the one before it ended, and the tool is where
      // the last one left it.
      const chain = (await admin.query(`select before, after from tl_records where tool_id = $1 order by recorded_at, id`, [t])).rows;
      const linked = chain.every((r, k) => k === 0 || (r.before.state === chain[k - 1].after.state && r.before.holder_id === chain[k - 1].after.holder_id));
      const last = chain[chain.length - 1].after;
      const ok = linked && row.state === last.state && row.holder_id === last.holder_id && out[1].ok
        && ((out[0].ok && chain.length === 3 && row.state === 'available')
            || (!out[0].ok && /NOT_ISSUED/.test(out[0].msg) && chain.length === 2 && row.state === 'available'));
      if (!ok) bad++;
    }
    check('7. a handover and a return of the same tool at once: one after the other, never a lost update — the history is one chain',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
  // 8
  {
    let bad = 0, dead = 0;
    const RECORD = `select pur_record(gen_random_uuid(), $1::jsonb) r`;
    for (let i = 0; i < ROUNDS; i++) {
      const it = await item('Bender ' + i);
      const f = await mkFolder('bought or issued ' + i); await mkPeriod(f);
      const batch = (await one(`select pr_batch_for($1, now()) b`, [OWNER])).b;
      const req = (await one(`insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id) values ($1, $2, $3, $3) returning id`, [OWNER, WORKER, f])).id;
      const line = (await one(`insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id, kind) values ($1, $2, 'Bender', 'pc', $3, 'tool') returning id`, [OWNER, req, it])).id;
      await admin.query(`insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, 1)`, [OWNER, line, batch]);
      const t = await oneTool(it);
      const buy = JSON.stringify({ source: 'purchasing', purchase_date: TODAY, receipt_total: 1000,
        lines: [{ destination: 'project', folder_id: f, item_name: 'Bender', quantity: 1, unit: 'pc', category: 'Tools', amount: 1000, request_line_id: line }] });
      const out = await pair(BUYER, RECORD, [buy], STAFF, ISSUE, [JSON.stringify({ tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: line })]);
      if (deadlock(out)) dead++;
      const filled = Number((await one(`select pr_line_bought($1) b`, [line])).b);
      if (out.filter(o => o.ok).length !== 1 || filled !== 1) bad++;
    }
    check('8. a purchase and a tool issue for the last place on a request line at once: one fills it, never twice',
      bad === 0 && dead === 0, `wrong outcome ${bad}, deadlocks ${dead}`);
  }
} finally {
  await admin.end();
  await server.stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Create:** `supabase/tests/3a_pilot_cleanup.sql`

```sql
-- ════════════════════════════════════════════════════════════════════
-- WorkMate 3a tools pilot (Q24): remove the "ZZ 3a pilot" test data.
--
-- Run by the USER in the Supabase SQL editor, after the pilot (plan
-- docs/superpowers/plans/2026-10-28-workmate-stage3a-tools.md, Task 3).
-- One transaction. Any failed guard stops it and changes NOTHING.
--
-- RUN IT TWICE:
--   1st run: as is (v_dry := true). It deletes everything, prints what it
--            removed in a red "DRY RUN OK" message, then undoes it all.
--   2nd run: change  v_dry boolean := true;  to  false;  and run again.
--
-- What is "ZZ" (and nothing else is touched):
--   projects  — every folder whose name starts "ZZ 3a pilot" (with their
--               billing periods, budgets and settings: the folder cascade);
--   items     — every catalogue item whose name starts "ZZ 3a";
--   tools     — every tool of a ZZ item or from a ZZ purchase, with its
--               records, request fills and history;
--   purchases — every purchase with a line on a ZZ project, or a warehouse
--               line whose item name starts "ZZ 3a" (all of its lines must be ZZ);
--   stock     — every stock record of a ZZ item or of a ZZ purchase (the
--               pilot makes none: tools are never stock), as the 2B/2C clean-up;
--   requests  — every request for a ZZ project (lines, weekly portions,
--               events, conflicts, photo rows);
--   suppliers — named "ZZ 3a…" that no remaining purchase uses.
-- Not touched: the tools and stock switches (tl_settings / stk_settings and
-- their "switched" events), the company warehouse place, real projects,
-- items, tools, purchases, requests, stock and expenses, the workers the
-- ZZ tools were issued to, operation ids (pur_ops), and photo FILES (see the
-- end). The history guards of tools and stock are switched off for this
-- transaction only, and checked back on before it ends. The pilot's tool
-- numbers go with their rows: the first real tool is TOOL-0001.
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_dry boolean := true;
  zf uuid[]; zi uuid[]; zp uuid[]; zl uuid[]; zc uuid[]; zloc uuid[]; zlot uuid[]; zr uuid[]; zcm uuid[];
  zreq uuid[]; zrl uuid[]; zpor uuid[]; zper uuid[]; zt uuid[]; ztr uuid[];
  real_tools bigint; real_tl_rec bigint;
  real_exp_n bigint; real_exp_sum numeric; real_pur bigint; real_rec bigint; real_mov bigint; real_cm bigint; real_req bigint;
  n int; real_rec_tmp int; msg text := '';
begin
  -- ---------- what is ZZ ----------
  select coalesce(array_agg(id), '{}') into zf from folders where name like 'ZZ 3a pilot%';
  if cardinality(zf) = 0 then
    raise exception 'GUARD: no project named "ZZ 3a pilot…" — nothing to clean';
  end if;
  if exists (select 1 from folders f where f.parent_folder_id = any(zf) and not f.id = any(zf)) then
    raise exception 'GUARD: a job under a ZZ project is not named "ZZ 3a pilot…"';
  end if;
  if exists (select 1 from folders f where f.id = any(zf) and f.parent_folder_id is not null and not f.parent_folder_id = any(zf)) then
    raise exception 'GUARD: a "ZZ 3a pilot…" job sits under a real project';
  end if;
  select coalesce(array_agg(id), '{}') into zper from projects where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zi from pr_catalog_items where name like 'ZZ 3a%';
  select coalesce(array_agg(distinct purchase_id), '{}') into zp from purchase_lines
   where folder_id = any(zf) or (destination = 'warehouse' and item_name like 'ZZ 3a%');
  if exists (select 1 from purchase_lines where purchase_id = any(zp)
              and not (folder_id = any(zf) or (destination = 'warehouse' and item_name like 'ZZ 3a%'))) then
    raise exception 'GUARD: a ZZ purchase also has a real line — stop and check';
  end if;
  select coalesce(array_agg(id), '{}') into zl from purchase_lines where purchase_id = any(zp);
  select coalesce(array_agg(id), '{}') into zc from purchase_charges where purchase_id = any(zp);
  if exists (select 1 from pur_payments where purchase_id = any(zp) or first_purchase_id = any(zp))
     or exists (select 1 from pur_refunds where purchase_id = any(zp))
     or exists (select 1 from pur_supplier_credits where purchase_id = any(zp)) then
    raise exception 'GUARD: a ZZ purchase has payments, refunds or credits (the pilot records none) — stop and check';
  end if;

  -- Requests for ZZ projects; ZZ items never on a real request, nor ZZ requests filled by real purchases.
  select coalesce(array_agg(id), '{}') into zreq from pr_requests where folder_id = any(zf) or work_folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zrl from pr_lines where request_id = any(zreq);
  select coalesce(array_agg(id), '{}') into zpor from pr_line_portions where line_id = any(zrl);
  if exists (select 1 from pr_lines where catalog_item_id = any(zi) and not request_id = any(zreq)) then
    raise exception 'GUARD: a ZZ item is on a real request';
  end if;
  if exists (select 1 from purchase_lines where request_line_id = any(zrl) and not purchase_id = any(zp))
     or exists (select 1 from purchase_line_covers where (request_line_id = any(zrl) or portion_id = any(zpor)) and not line_id = any(zl)) then
    raise exception 'GUARD: a real purchase covers a ZZ request';
  end if;
  if exists (select 1 from wp_blockers where request_id = any(zreq)) then
    raise exception 'GUARD: a Work Plan blocker points at a ZZ request';
  end if;

  -- Stock: ZZ items and ZZ purchases only, at the warehouse or ZZ sites only.
  select coalesce(array_agg(id), '{}') into zloc from stk_locations where folder_id = any(zf);
  select coalesce(array_agg(id), '{}') into zlot from stk_lots where item_id = any(zi) or purchase_id = any(zp);
  if exists (select 1 from stk_lots where id = any(zlot) and not item_id = any(zi)) then
    raise exception 'GUARD: a ZZ purchase was matched to a real catalogue item';
  end if;
  if exists (select 1 from stk_lots where item_id = any(zi) and purchase_id is not null and not purchase_id = any(zp)) then
    raise exception 'GUARD: a ZZ item has stock from a real purchase';
  end if;
  if exists (select 1 from stk_matches where (item_id = any(zi)) <> (purchase_id = any(zp))) then
    raise exception 'GUARD: a match mixes a ZZ item with a real purchase (or the other way)';
  end if;
  select coalesce(array_agg(id), '{}') into zr from stk_records
   where item_id = any(zi) or purchase_id = any(zp) or lot_id = any(zlot);
  if exists (select 1 from stk_records where (from_location = any(zloc) or to_location = any(zloc)) and not id = any(zr)) then
    raise exception 'GUARD: real goods were recorded at a ZZ site';
  end if;
  if exists (select 1 from stk_records r where r.id = any(zr) and (
               (r.from_location is not null and not r.from_location = any(zloc)
                and r.from_location <> (select id from stk_locations w where w.owner_id = r.owner_id and w.kind = 'warehouse'))
            or (r.to_location is not null and not r.to_location = any(zloc)
                and r.to_location <> (select id from stk_locations w where w.owner_id = r.owner_id and w.kind = 'warehouse')))) then
    raise exception 'GUARD: ZZ goods were recorded at a real project''s site';
  end if;
  if exists (select 1 from stk_records where id = any(zr) and request_line_id is not null and not request_line_id = any(zrl))
     or exists (select 1 from stk_covers where (request_line_id = any(zrl) or portion_id = any(zpor)) and not record_id = any(zr))
     or exists (select 1 from stk_moves where (record_id = any(zr)) <> (lot_id = any(zlot))) then
    raise exception 'GUARD: ZZ stock and real requests or real stock are mixed';
  end if;
  select coalesce(array_agg(id), '{}') into zcm from stk_cost_moves where lot_id = any(zlot);
  if exists (select 1 from stk_cost_moves where (from_folder = any(zf) or to_folder = any(zf)) and not id = any(zcm))
     or exists (select 1 from stk_cost_moves where id = any(zcm)
                 and ((from_folder is not null and not from_folder = any(zf)) or (to_folder is not null and not to_folder = any(zf)))) then
    raise exception 'GUARD: a cost move links a ZZ project and real stock (or the other way)';
  end if;

  -- Tools: ZZ items and ZZ purchases only, on ZZ projects or the warehouse only.
  select coalesce(array_agg(id), '{}') into zt from tl_tools where item_id = any(zi) or purchase_id = any(zp);
  select coalesce(array_agg(id), '{}') into ztr from tl_records where tool_id = any(zt);
  if exists (select 1 from tl_tools where id = any(zt) and not item_id = any(zi)) then
    raise exception 'GUARD: a tool from a ZZ purchase was registered as a real catalogue item';
  end if;
  if exists (select 1 from tl_records where id = any(ztr) and folder_id is not null and not folder_id = any(zf))
     or exists (select 1 from tl_tools where id = any(zt) and folder_id is not null and not folder_id = any(zf)) then
    raise exception 'GUARD: a ZZ tool was recorded on a real project';
  end if;
  if exists (select 1 from tl_records where not id = any(ztr) and (folder_id = any(zf) or request_line_id = any(zrl))) then
    raise exception 'GUARD: a real tool was recorded on a ZZ project or request';
  end if;
  if exists (select 1 from tl_records where id = any(ztr) and request_line_id is not null and not request_line_id = any(zrl))
     or exists (select 1 from tl_covers where (request_line_id = any(zrl) or portion_id = any(zpor)) and not record_id = any(ztr))
     or exists (select 1 from tl_covers where record_id = any(ztr) and not request_line_id = any(zrl)) then
    raise exception 'GUARD: ZZ tools and real requests are mixed';
  end if;

  -- Nothing real hangs on a ZZ project.
  if exists (select 1 from construction_projects where folder_id = any(zf))
     or exists (select 1 from wp_tasks where folder_id = any(zf) or work_folder_id = any(zf))
     or exists (select 1 from payroll where project_id = any(zper))
     or exists (select 1 from overhead_expenses where folder_id = any(zf) or billing_period_id = any(zper))
     or exists (select 1 from reimbursements where folder_id = any(zf))
     or exists (select 1 from labor_contracts where folder_id = any(zf)) then
    raise exception 'GUARD: payroll, overhead, a contract, a reimbursement, a construction project or a Work Plan task is on a ZZ project';
  end if;
  if exists (select 1 from expenses
              where (folder_id = any(zf) or project_id = any(zper))
                and not (coalesce(purchase_line_id = any(zl), false) or coalesce(purchase_charge_id = any(zc), false)
                         or coalesce(stk_cost_move_id = any(zcm), false))) then
    raise exception 'GUARD: a hand-entered expense is on a ZZ project — stop and check';
  end if;
  if exists (select 1 from expenses where stk_cost_move_id = any(zcm)
              and not (coalesce(folder_id = any(zf), false) or coalesce(project_id = any(zper), false))) then
    raise exception 'GUARD: a ZZ cost move wrote a row on a real project';
  end if;
  if exists (select 1 from pr_gallery_photos where catalog_item_id = any(zi)) then
    raise exception 'GUARD: a ZZ item has gallery photos (the pilot adds none) — stop and check';
  end if;

  -- ---------- the real data, before ----------
  select count(*), coalesce(sum(amount), 0) into real_exp_n, real_exp_sum from expenses
   where not (coalesce(folder_id = any(zf), false) or coalesce(project_id = any(zper), false)
              or coalesce(purchase_line_id = any(zl), false) or coalesce(purchase_charge_id = any(zc), false)
              or coalesce(stk_cost_move_id = any(zcm), false));
  select count(*) into real_pur from purchases where not id = any(zp);
  select count(*) into real_rec from stk_records where not id = any(zr);
  select count(*) into real_mov from stk_moves where not record_id = any(zr);
  select count(*) into real_cm from stk_cost_moves where not id = any(zcm);
  select count(*) into real_req from pr_requests where not id = any(zreq);
  select count(*) into real_tools from tl_tools where not id = any(zt);
  select count(*) into real_tl_rec from tl_records where not id = any(ztr);

  -- ---------- tools (their history guards are off for this transaction only) ----------
  execute 'alter table tl_events disable trigger tl_events_no_change';
  execute 'alter table tl_covers disable trigger tl_covers_no_change';
  execute 'alter table tl_records disable trigger tl_records_no_delete';
  execute 'alter table tl_tools disable trigger tl_tools_no_delete';
  delete from tl_events where record_id = any(ztr);
  get diagnostics n = row_count; msg := msg || 'tool events ' || n;
  delete from tl_covers where record_id = any(ztr);
  get diagnostics n = row_count; msg := msg || ', tool request fills ' || n;
  delete from tl_records where id = any(ztr);
  get diagnostics n = row_count; msg := msg || ', tool records ' || n;
  delete from tl_tools where id = any(zt);
  get diagnostics n = row_count; msg := msg || ', tools ' || n || ', ';
  execute 'alter table tl_events enable trigger tl_events_no_change';
  execute 'alter table tl_covers enable trigger tl_covers_no_change';
  execute 'alter table tl_records enable trigger tl_records_no_delete';
  execute 'alter table tl_tools enable trigger tl_tools_no_delete';

  -- ---------- stock (its history guards are off for this transaction only) ----------
  perform set_config('dacs.purchase_write', 'on', true);
  execute 'alter table stk_events disable trigger stk_events_no_change';
  execute 'alter table stk_moves disable trigger stk_moves_no_change';
  execute 'alter table stk_covers disable trigger stk_covers_no_change';
  delete from expenses where stk_cost_move_id = any(zcm) or purchase_line_id = any(zl) or purchase_charge_id = any(zc);
  get diagnostics n = row_count; msg := msg || 'expense rows ' || n;
  delete from stk_events where cost_move_id = any(zcm) or record_id = any(zr) or purchase_id = any(zp);
  get diagnostics n = row_count; msg := msg || ', stock events ' || n;
  update stk_cost_moves set resubmits = null where id = any(zcm) and resubmits is not null;
  delete from stk_cost_moves where id = any(zcm);
  get diagnostics n = row_count; msg := msg || ', cost moves ' || n;
  delete from stk_covers where record_id = any(zr);
  get diagnostics n = row_count; msg := msg || ', request covers ' || n;
  delete from stk_moves where record_id = any(zr);
  get diagnostics n = row_count; msg := msg || ', stock moves ' || n;
  -- Returns first: a return always names its issue (it cannot be blanked).
  delete from stk_records where id = any(zr) and returns_record is not null;
  get diagnostics n = row_count;
  delete from stk_records where id = any(zr);
  get diagnostics real_rec_tmp = row_count; msg := msg || ', stock records ' || (n + real_rec_tmp);
  delete from stk_lots where id = any(zlot);
  get diagnostics n = row_count; msg := msg || ', lots ' || n;
  delete from stk_matches where purchase_id = any(zp) or item_id = any(zi);
  get diagnostics n = row_count; msg := msg || ', matches ' || n;
  delete from stk_locations where id = any(zloc);
  get diagnostics n = row_count; msg := msg || ', sites ' || n;
  execute 'alter table stk_events enable trigger stk_events_no_change';
  execute 'alter table stk_moves enable trigger stk_moves_no_change';
  execute 'alter table stk_covers enable trigger stk_covers_no_change';

  -- ---------- purchases ----------
  delete from purchase_change_requests where purchase_id = any(zp);
  delete from purchase_history where purchase_id = any(zp);
  delete from purchase_charge_shares where line_id = any(zl);
  delete from purchase_stock_moves where line_id = any(zl);
  delete from purchase_line_covers where line_id = any(zl);
  delete from purchase_charges where purchase_id = any(zp);
  delete from purchase_lines where purchase_id = any(zp);
  update purchases set replaced_by = null where id = any(zp) and replaced_by is not null;
  delete from purchases where id = any(zp);
  get diagnostics n = row_count; msg := msg || ', purchases ' || n;
  perform set_config('dacs.purchase_write', '', true);

  -- ---------- requests ----------
  delete from pr_photos where request_id = any(zreq);
  get diagnostics n = row_count; msg := msg || ', request photo rows ' || n;
  delete from pr_line_conflicts where line_id = any(zrl);
  delete from pr_events where request_id = any(zreq);
  delete from pr_line_portions where line_id = any(zrl);
  delete from pr_lines where request_id = any(zreq);
  delete from pr_requests where id = any(zreq);
  get diagnostics n = row_count; msg := msg || ', requests ' || n;

  -- ---------- catalogue, projects, suppliers ----------
  delete from pr_item_refs where catalog_item_id = any(zi);
  delete from pr_catalog_items where id = any(zi);
  get diagnostics n = row_count; msg := msg || ', catalogue items ' || n;
  delete from folders where id = any(zf) and parent_folder_id is not null;
  delete from folders where id = any(zf);
  if exists (select 1 from folders where id = any(zf)) then
    raise exception 'GUARD: a ZZ project is still there';
  end if;
  msg := msg || ', projects ' || cardinality(zf) || ' (with ' || cardinality(zper) || ' billing periods)';
  delete from suppliers s where s.name like 'ZZ 3a%' and not exists (select 1 from purchases p where p.supplier_id = s.id);
  get diagnostics n = row_count; msg := msg || ', suppliers ' || n;

  -- ---------- after: nothing ZZ left, nothing real moved, guards back on ----------
  if exists (select 1 from folders where name like 'ZZ 3a pilot%')
     or exists (select 1 from pr_catalog_items where name like 'ZZ 3a%')
     or exists (select 1 from purchase_lines where item_name like 'ZZ 3a%')
     or exists (select 1 from tl_tools t join pr_catalog_items c on c.id = t.item_id where c.name like 'ZZ 3a%') then
    raise exception 'GUARD: a ZZ row is still there';
  end if;
  if (select count(*) from expenses) <> real_exp_n or (select coalesce(sum(amount), 0) from expenses) <> real_exp_sum then
    raise exception 'GUARD: real expenses changed';
  end if;
  if (select count(*) from purchases) <> real_pur or (select count(*) from stk_records) <> real_rec
     or (select count(*) from stk_moves) <> real_mov or (select count(*) from stk_cost_moves) <> real_cm
     or (select count(*) from pr_requests) <> real_req then
    raise exception 'GUARD: real purchases, stock or requests changed';
  end if;
  if (select count(*) from tl_tools) <> real_tools or (select count(*) from tl_records) <> real_tl_rec then
    raise exception 'GUARD: real tools changed';
  end if;
  if (select count(*) from pg_trigger where tgname in ('tl_events_no_change', 'tl_covers_no_change', 'tl_records_no_delete', 'tl_tools_no_delete')
         and tgenabled = 'O') <> 4 then
    raise exception 'GUARD: a tools history guard is not back on';
  end if;
  if (select count(*) from pg_trigger where tgname in ('stk_events_no_change', 'stk_moves_no_change', 'stk_covers_no_change')
         and tgenabled = 'O') <> 3 then
    raise exception 'GUARD: a stock history guard is not back on';
  end if;
  msg := msg || '. Real: ' || real_exp_n || ' expense rows (₱' || real_exp_sum || '), ' || real_pur || ' purchases, '
         || real_rec || ' stock records, ' || real_cm || ' cost moves, ' || real_req || ' requests, ' || real_tools || ' tools, '
         || real_tl_rec || ' tool records — unchanged; history guards back on.';

  if v_dry then
    raise exception 'DRY RUN OK (nothing changed): would delete %', msg;
  end if;
  raise notice 'CLEAN-UP DONE: deleted %', msg;
end $$;

-- Request photos: the rows are gone, the FILES stay in Storage (Supabase does
-- not delete Storage files from SQL). The pilot takes none; if it did, delete
-- them by hand under request-photos/<worker id>/<request id>/.
```

**Create:** `supabase/tests/3a_tools.pglite.mjs`

```js
// ════════════════════════════════════════════════════════════════════
// STAGE 3a TOOLS — SERVER TESTS ON PGLITE
//   npm run test:sql
//
// Runs migrations 0096 … 0106 and 0107 VERBATIM on PGlite (PostgreSQL in
// memory) over the 2B-b suite's tables. Nothing here talks to the live
// database; supabase/tests/3a_acceptance.sql repeats the key cases there,
// rolled back.
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
const M02 = mig('0002_rls.sql');
const M94 = mig('0094_workmate_work_plan_office.sql');
const M96 = mig('0096_purchase_recording.sql');
const M97 = mig('0097_purchasing_office.sql');
const M98 = mig('0098_pm_profit_sharing.sql');
const M101 = mig('0101_purchasing_phone.sql');
const M102 = mig('0102_purchase_payments.sql');
const M103 = mig('0103_buyer_return_photo.sql');
const M90 = mig('0090_workmate_item_history.sql');
const M104 = mig('0104_stock.sql');
const M105 = mig('0105_stock_cost_moves.sql');
const M106 = mig('0106_workmate_phone_stock.sql');
const M107 = mig('0107_tools.sql');
const M85 = mig('0085_workmate_requests.sql');
const M51 = mig('0051_attendance_worker_owner.sql');
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
const BASE = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
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

const OWNER = '00000000-0000-0000-0000-00000000000a';
const STAFF = '00000000-0000-0000-0000-00000000000b';   // Expenses, no Buyer switch
const BUYER = '00000000-0000-0000-0000-000000000011';
const WORKER = '00000000-0000-0000-0000-00000000000c';
const WORKER2 = '00000000-0000-0000-0000-000000000019';
const LEADER = '00000000-0000-0000-0000-000000000015';
const GONE = '00000000-0000-0000-0000-00000000001a';     // a deactivated worker
const OTHER = '00000000-0000-0000-0000-00000000000d';    // another company's owner
const OTHERW = '00000000-0000-0000-0000-00000000001b';   // another company's worker
const CLIENT = '00000000-0000-0000-0000-00000000001c';   // a client account of this company
const PARTNER = '00000000-0000-0000-0000-00000000001d';  // a partner account of this company
const EXPOWNER = '00000000-0000-0000-0000-000000000014'; // owner-role account with PM + Expenses: its OWN scope (tools off there)
const PMSTAFF = '00000000-0000-0000-0000-000000000018';  // staff focused on PM only
let opSeq = 0;
const op = () => '40000000-0000-0000-0000-' + String(++opSeq).padStart(12, '0');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
const num = (x) => Number(x);
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

async function fresh(opts = {}) {
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
  await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
    ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
    ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
    ('${BUYER}', 'staff', '${OWNER}', 'active', null, 'juan@dacs.test', 'Juan'),
    ('${WORKER}', 'worker', '${OWNER}', 'active', null, null, 'Mark'),
    ('${WORKER2}', 'worker', '${OWNER}', 'active', null, null, 'Rey'),
    ('${LEADER}', 'teamLeader', '${OWNER}', 'active', null, null, 'Lito'),
    ('${GONE}', 'worker', '${OWNER}', 'inactive', null, null, 'Old'),
    ('${OTHER}', 'owner', null, 'active', null, 'other@x.test', null),
    ('${OTHERW}', 'worker', '${OTHER}', 'active', null, null, 'Far'),
    ('${CLIENT}', 'client', '${OWNER}', 'active', null, 'client@x.test', 'Cora'),
    ('${PARTNER}', 'partner', '${OWNER}', 'active', null, 'partner@x.test', 'Pat'),
    ('${EXPOWNER}', 'owner', '${OWNER}', 'active', '["pm", "expenses"]'::jsonb, 'admin-exp@dacs.test', null),
    ('${PMSTAFF}', 'staff', '${OWNER}', 'active', '["pm"]'::jsonb, 'pmstaff@dacs.test', 'Pia');`);
  await as(db, OWNER);
  await db.query(`select pur_set_buyer($1, true)`, [BUYER]);
  await db.query(`select stk_set_enabled(true)`);
  if (opts.on !== false) await db.query(`select tl_set_enabled(true)`);
  return db;
}
async function as(db, uid) { await db.exec(`select set_config('test.uid', '${uid}', false)`); }
async function one(db, sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function all(db, sql, params = []) { return (await db.query(sql, params)).rows; }
async function code(promise) {
  try { await promise; return 'no error'; } catch (e) { return e.message; }
}
async function refused(promise, want, m) {
  const got = await code(promise);
  assert(got.includes(want), (m || 'refused') + ': expected ' + want + ', got ' + got);
}
async function folder(db, name, opts = {}) {
  return (await one(db, `insert into folders (owner_id, name, parent_folder_id, completed_at) values ($1, $2, $3, $4) returning id`,
    [opts.owner || OWNER, name, opts.parent || null, opts.completed ? new Date().toISOString() : null])).id;
}
async function item(db, name, unit = 'pc', kind = 'tool', owner = OWNER) {
  return (await one(db, `insert into pr_catalog_items (owner_id, name, unit, kind) values ($1, $2, $3, $4) returning id`, [owner, name, unit, kind])).id;
}
// A request line for a project, one portion of NOW's batch.
async function request(db, folderId, opts = {}) {
  const batch = (await one(db, `select pr_batch_for($1, now()) b`, [OWNER])).b;
  const req = (await one(db, `insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id)
                               values ($1, $2, $3, $4) returning id`, [OWNER, WORKER, opts.project || folderId, folderId])).id;
  const line = (await one(db, `insert into pr_lines (owner_id, request_id, description, unit, catalog_item_id, kind)
                                values ($1, $2, $3, $4, $5, $6) returning id`,
    [OWNER, req, opts.description || 'Grinder', opts.unit || 'pc', opts.item || null, opts.kind || 'tool'])).id;
  const portion = (await one(db, `insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values ($1, $2, $3, $4) returning id`,
    [OWNER, line, batch, opts.quantity ?? 2])).id;
  return { req, line, portion, batch };
}
function body(lines) {
  const total = lines.reduce((s, l) => s + l.amount, 0);
  return { source: 'purchasing', purchase_date: TODAY, supplier: 'Wilcon', notes: '', payment_method: 'CASH',
           docs: {}, no_receipt_reason: 'test', receipt_total: Math.round(total * 100) / 100,
           lines: lines.map(l => ({ destination: 'project', category: 'Tools', unit: 'pc', unplanned_reason: 'needed', ...l })) };
}
async function record(db, b, who = BUYER) {
  await as(db, who);
  return (await one(db, `select pur_record($1, $2::jsonb) as r`, [op(), JSON.stringify(b)])).r;
}
async function warehouseBuy(db, name, qty, opts = {}) {
  const line = { destination: 'warehouse', item_name: name, quantity: qty, unit: opts.unit || 'pc', amount: opts.amount || qty * 1000 };
  if (opts.requestLine) { line.request_line_id = opts.requestLine; delete line.unplanned_reason; }
  return (await record(db, body([line]))).purchase_id;
}
async function projectBuy(db, f, name, qty, opts = {}) {
  const line = { folder_id: f, item_name: name, quantity: qty, unit: opts.unit || 'pc', amount: opts.amount || qty * 1000 };
  if (opts.requestLine) {
    line.request_line_id = opts.requestLine; delete line.unplanned_reason;
    if (opts.extra) { line.extra_reason = 'spare'; line.extra_location = 'project'; }
  }
  return (await record(db, body([line]))).purchase_id;
}
const rpc = async (db, who, fn, args) => {
  await as(db, who);
  const ph = args.map((_, i) => '$' + (i + 1)).join(', ');
  return (await one(db, `select ${fn}(${ph}) as r`, args)).r;
};
const j = (o) => JSON.stringify(o);
// An opening register needs a photo (Q7, rev 2): the tests give one unless they say otherwise.
const photoOf = (who) => `tools/${who === OTHER ? OTHER : OWNER}/2026-10/${crypto.randomUUID()}.jpg`;
const register = (db, who, b, opId = op()) => rpc(db, who, 'tl_register',
  [opId, j({ condition: 'good', at: 'warehouse', ...(b.purchase_id || 'photo_path' in b ? {} : { photo_path: photoOf(who) }), ...b })]);
const issue = (db, who, b, opId = op()) => rpc(db, who, 'tl_issue', [opId, j(b)]);
const handover = (db, who, b) => rpc(db, who, 'tl_handover', [op(), j(b)]);
const ret = (db, who, b) => rpc(db, who, 'tl_return', [op(), j({ condition: 'good', ...b })]);
const repaired = (db, who, tool, note = '') => rpc(db, who, 'tl_repaired', [op(), tool, note]);
const lost = (db, who, tool, reason = 'not on site') => rpc(db, who, 'tl_report_lost', [op(), tool, reason]);
const retire = (db, who, tool, reason = 'beyond repair') => rpc(db, who, 'tl_request_retire', [op(), tool, reason]);
const found = (db, who, b) => rpc(db, who, 'tl_found', [op(), j({ condition: 'good', ...b })]);
const decide = (db, who, rec, okay, note = 'checked') => rpc(db, who, 'tl_decide', [op(), rec, okay, note]);
const reverse = (db, who, rec, reason = 'mistake') => rpc(db, who, 'tl_reverse', [op(), rec, reason]);
async function tool(db, id) { return one(db, `select * from tl_tools where id = $1`, [id]); }
async function one1(db, who, b = {}) { return (await register(db, who, b)).tools[0].tool_id; }
async function still(db, line) {
  return num((await one(db, `select coalesce(sum(greatest(0, p.quantity - p.pending_reduction - pr_portion_bought(p.id))), 0) s
                               from pr_line_portions p where p.line_id = $1`, [line])).s);
}
async function money(db) {
  return one(db, `select (select count(*) from expenses) n, (select coalesce(sum(amount), 0) s from expenses) s,
                         (select count(*) from payroll) pr, (select count(*) from pur_payments) pay`);
}
async function latestRec(db, toolId) { return (await one(db, `select tl_latest($1) id`, [toolId])).id; }

console.log('\n3a tools (0096 … 0106 + 0107 on PGlite)');

// ── A. The switch, and who ────────────────────────────────────────────
await test('switched off: every write and read refused TOOLS_OFF; the completion and shopping-list helpers answer empty', async () => {
  const db = await fresh({ on: false });
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  await refused(register(db, OWNER, { item_id: g }), 'TOOLS_OFF');
  await refused(rpc(db, STAFF, 'tl_overview', []), 'TOOLS_OFF');
  await refused(rpc(db, STAFF, 'tl_choices', []), 'TOOLS_OFF');
  eq((await rpc(db, OWNER, 'tl_status', [])).enabled, false);
  eq(await rpc(db, OWNER, 'tl_project_out', [f]), []);
  eq(await rpc(db, BUYER, 'tl_line_tools', ['{}']), {});
  eq(num((await one(db, `select count(*) n from tl_tools`)).n), 0);
});
await test('only the main owner switches tools on or off; each change is in the history; off refuses writes and undoes nothing', async () => {
  const db = await fresh({ on: false });
  for (const who of [STAFF, EXPOWNER, BUYER]) await refused(rpc(db, who, 'tl_set_enabled', [true]), 'O', who + ' switched tools');
  eq(num((await one(db, `select count(*) n from tl_settings`)).n), 0);
  await rpc(db, OWNER, 'tl_set_enabled', [true]);
  await rpc(db, OWNER, 'tl_set_enabled', [true]);              // no change, no second event
  const g = await item(db, 'Grinder');
  const t = await one1(db, STAFF, { item_id: g });
  await rpc(db, OWNER, 'tl_set_enabled', [false]);
  await refused(issue(db, OWNER, { tool_id: t, holder_id: WORKER, folder_id: await folder(db, 'X') }), 'TOOLS_OFF');
  eq((await tool(db, t)).state, 'available', 'the tool stays');
  eq((await all(db, `select detail ->> 'enabled' e from tl_events where kind = 'switched' order by id`)).map(r => r.e), ['true', 'false']);
});
await test('who records: owner and office staff allowed Expenses; never workers, team leaders or a PM-only account', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  for (const who of [OWNER, STAFF, BUYER]) await one1(db, who, { item_id: g });
  await refused(register(db, EXPOWNER, { item_id: g }), 'TOOLS_OFF', 'an account with its own scope records there, where tools are off');
  await refused(register(db, WORKER, { item_id: g }), 'NOT_OFFICE');
  await refused(register(db, LEADER, { item_id: g }), 'NOT_OFFICE');
  await refused(register(db, PMSTAFF, { item_id: g }), 'NOT_ALLOWED');
  await refused(rpc(db, WORKER, 'tl_overview', []), 'NOT_ALLOWED');
  await refused(rpc(db, PMSTAFF, 'tl_overview', []), 'NOT_ALLOWED');
});
await test('another company sees none of these tools and cannot touch them', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const t = await one1(db, OWNER, { item_id: g });
  await as(db, OTHER);
  await db.query(`select tl_set_enabled(true)`);
  eq((await rpc(db, OTHER, 'tl_overview', [])).tools, []);
  await refused(rpc(db, OTHER, 'tl_tool', [t]), 'NOT_FOUND');
  await refused(issue(db, OTHER, { tool_id: t, holder_id: OTHERW, folder_id: await folder(db, 'Far', { owner: OTHER }) }), 'NOT_FOUND');
  await refused(register(db, OTHER, { item_id: g }), 'BAD_ITEM', 'another company\'s catalogue item');
});

// ── B. Registering ────────────────────────────────────────────────────
await test('numbers: TOOL-0001… per company, several at once, never reused — not even after a cancelled registration', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const r = await register(db, STAFF, { item_id: g, count: 3, details: 'Makita 9553' });
  eq(r.tools.map(x => x.number), [1, 2, 3]);
  eq((await rpc(db, STAFF, 'tl_tool', [r.tools[0].tool_id])).label, 'TOOL-0001');
  await reverse(db, STAFF, await latestRec(db, r.tools[2].tool_id), 'registered twice');
  eq((await tool(db, r.tools[2].tool_id)).state, 'cancelled');
  eq((await register(db, STAFF, { item_id: g })).tools[0].number, 4, 'TOOL-0003 is never reused');
  eq((await rpc(db, STAFF, 'tl_overview', [])).tools.map(x => x.label), ['TOOL-0001', 'TOOL-0002', 'TOOL-0004'], 'a cancelled tool is not listed');
  await as(db, OTHER); await db.query(`select tl_set_enabled(true)`);
  const og = await item(db, 'Drill', 'pc', 'tool', OTHER);
  eq((await register(db, OTHER, { item_id: og })).tools[0].number, 1, 'each company counts from 1');
  await refused(register(db, STAFF, { item_id: g, count: 0 }), 'BAD_QUANTITY');
  await refused(register(db, STAFF, { item_id: g, count: 51 }), 'BAD_QUANTITY');
  await refused(register(db, STAFF, { item_id: g, count: 'two' }), 'BAD_QUANTITY');
});
await test('at a project a tool always has a named responsible person (rev 2): anyone active in the company (T1 = C) — never a client, a partner, a deactivated account or another company', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  await refused(register(db, STAFF, { item_id: g, at: f }), 'PERSON_REQUIRED');
  await refused(register(db, STAFF, { item_id: g, at: f, holder_id: '' }), 'PERSON_REQUIRED');
  for (const who of [CLIENT, PARTNER, GONE, OTHERW, OTHER]) await refused(register(db, STAFF, { item_id: g, at: f, holder_id: who }), 'BAD_PERSON', who);
  for (const who of [WORKER, LEADER, STAFF, BUYER, OWNER, EXPOWNER]) {
    const t = await tool(db, await one1(db, STAFF, { item_id: g, at: f, holder_id: who }));
    eq([t.state, t.holder_id], ['issued', who], who + ' can hold a tool');
  }
  const out = (await rpc(db, STAFF, 'tl_overview', [])).out.map(x => x.holder_name).sort();
  eq(out, ['Ana', 'Juan', 'Lito', 'Mark', 'admin', 'admin-exp'], 'office accounts by their name or e-mail, the crew by theirs');
  await refused(register(db, STAFF, { item_id: g, at: await folder(db, 'Done', { completed: true }), holder_id: WORKER }), 'PROJECT_COMPLETED');
  await refused(register(db, STAFF, { item_id: g, at: 'somewhere' }), 'BAD_PROJECT');
  const t = await tool(db, await one1(db, STAFF, { item_id: g, at: f, holder_id: LEADER }));
  eq([t.state, t.holder_id, t.folder_id], ['issued', LEADER, f]);
  eq(num((await one(db, `select count(*) n from tl_tools where state = 'issued' and (holder_id is null or folder_id is null)`)).n), 0);
  await refused(db.query(`update tl_tools set holder_id = null where id = $1`, [t.id]), 'check', 'the table refuses it too');
});
await test('the item must be an active TOOL item; a condition the server knows', async () => {
  const db = await fresh();
  const cement = await item(db, 'Cement', 'bag', 'material');
  await refused(register(db, STAFF, { item_id: cement }), 'NOT_A_TOOL');
  const old = await item(db, 'Old saw');
  await db.query(`update pr_catalog_items set active = false where id = $1`, [old]);
  await refused(register(db, STAFF, { item_id: old }), 'BAD_ITEM');
  const g = await item(db, 'Grinder');
  eq((await tool(db, await one1(db, STAFF, { item_id: g, condition: 'needs_repair' }))).state, 'repair');
  eq((await tool(db, await one1(db, STAFF, { item_id: g, condition: 'missing_parts' }))).condition, 'missing_parts');
  await refused(register(db, STAFF, { item_id: g, condition: 'broken' }), 'BAD_CONDITION');
  await refused(register(db, STAFF, { item_id: g, details: 'x'.repeat(201) }), 'BAD_NOTE');
});
await test('the opening register needs a photo of the tool (Q7, rev 2); one from a purchase line does not', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  for (const none of [null, '', '   ']) await refused(register(db, STAFF, { item_id: g, photo_path: none }), 'PHOTO_REQUIRED', String(none));
  await refused(register(db, STAFF, { item_id: g, at: f, holder_id: WORKER, photo_path: null }), 'PHOTO_REQUIRED', 'at a project too');
  eq(num((await one(db, `select count(*) n from tl_tools`)).n), 0, 'nothing registered');
  const r = await register(db, STAFF, { item_id: g, count: 2 });
  const ps = (await all(db, `select photo_path from tl_tools order by number`)).map(x => x.photo_path);
  assert(ps[0] && ps[0] === ps[1], 'several identical tools share the one photo: ' + ps);
  eq(r.tools.length, 2);
  const pp = await projectBuy(db, f, 'Grinder', 1);
  eq((await tool(db, await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 }))).photo_path, null, 'from a purchase: optional');
});
await test('a tool already damaged beyond repair (rev 2): registered at the warehouse, Under repair, with a Retire request for the owner; never at a project', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  await refused(register(db, STAFF, { item_id: g, condition: 'damaged', at: f, holder_id: WORKER }), 'DAMAGED_AT_PROJECT');
  const r = await register(db, STAFF, { item_id: g, condition: 'damaged', count: 2, note: 'motor burnt' });
  for (const x of r.tools) {
    const t = await tool(db, x.tool_id);
    eq([t.state, t.condition], ['retire_pending', 'damaged'], 'waiting for the owner');
    const rec = await one(db, `select kind, status, note, before ->> 'state' b from tl_records where id = $1`, [x.retire_record_id]);
    eq([rec.kind, rec.status, rec.note, rec.b], ['retire', 'pending', 'motor burnt', 'repair']);
    await refused(issue(db, STAFF, { tool_id: x.tool_id, holder_id: WORKER, folder_id: f }), 'NOT_AVAILABLE');
  }
  await decide(db, OWNER, r.tools[0].retire_record_id, true);
  eq((await tool(db, r.tools[0].tool_id)).state, 'retired', 'confirmed: retired');
  await decide(db, OWNER, r.tools[1].retire_record_id, false, 'worth fixing');
  eq((await tool(db, r.tools[1].tool_id)).state, 'repair', 'rejected: Under repair, never Available');
  await repaired(db, STAFF, r.tools[1].tool_id);
  eq((await tool(db, r.tools[1].tool_id)).state, 'available');
  eq((await rpc(db, STAFF, 'tl_overview', [])).pending, [], 'nothing left waiting');
  await refused(reverse(db, STAFF, (await one(db, `select id from tl_records where tool_id = $1 and kind = 'register'`, [r.tools[0].tool_id])).id), 'LATER_RECORDS',
    'the registration of a decided tool stands');
  const pp = await projectBuy(db, f, 'Grinder', 1);
  eq((await tool(db, (await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, condition: 'damaged' })).tools[0].tool_id)).state,
     'retire_pending', 'from a purchase line too (at the warehouse)');
});
await test('a photo is a file of this company\'s tools folder', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const ok = `tools/${OWNER}/2026-10/11111111-2222-4333-8444-555555555555.jpg`;
  eq((await tool(db, await one1(db, STAFF, { item_id: g, photo_path: ok }))).photo_path, ok);
  for (const bad of [`tools/${OTHER}/2026-10/11111111-2222-4333-8444-555555555555.jpg`, `purchases/${OWNER}/2026-10/11111111-2222-4333-8444-555555555555.jpg`,
                     'https://x.test/a.jpg', `tools/${OWNER}/2026-10/../a.jpg`]) {
    await refused(register(db, STAFF, { item_id: g, photo_path: bad }), 'BAD_PHOTO', bad);
  }
});
await test('from a purchase line: never more than it bought; a warehouse line\'s tools start at the warehouse; a project line\'s there or with someone on that project', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House'), f2 = await folder(db, 'Shop');
  const wp = await warehouseBuy(db, 'Grinder', 2);
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1, count: 3 }), 'MORE_THAN_BOUGHT');
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1, at: f, holder_id: WORKER }), 'BAD_PLACE');
  await register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1, count: 2 });
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1 }), 'MORE_THAN_BOUGHT');
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 9 }), 'NOT_FOUND');
  const pp = await projectBuy(db, f, 'Grinder', 2);
  await refused(register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, at: f2, holder_id: WORKER }), 'BAD_PLACE');
  const t = await tool(db, await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, at: f, holder_id: WORKER }));
  eq([t.state, t.purchase_id, t.line_no], ['issued', pp, 1]);
  eq((await tool(db, await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 }))).state, 'available');
});
await test('"Tools to register": tool lines (bought for a tool request, or with tools from them), until all are registered', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const pp = await projectBuy(db, f, 'Grinder', 2, { requestLine: rq.line });
  await warehouseBuy(db, 'Cement', 5, { unit: 'bag' });             // not a tool line
  let ov = await rpc(db, STAFF, 'tl_overview', []);
  eq(ov.to_register.map(l => [l.item_name, num(l.quantity), l.registered, l.suggested_item_id]), [['Grinder', 2, 0, g]]);
  await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 });
  ov = await rpc(db, STAFF, 'tl_overview', []);
  eq(ov.to_register.map(l => l.registered), [1]);
  await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 });
  eq((await rpc(db, STAFF, 'tl_overview', [])).to_register, [], 'all registered');
  const free = await warehouseBuy(db, 'Drill', 2);                   // an unlinked line becomes a tool line once a tool is registered from it
  eq((await rpc(db, STAFF, 'tl_overview', [])).to_register, []);
  await register(db, STAFF, { item_id: g, purchase_id: free, line_no: 1 });
  eq((await rpc(db, STAFF, 'tl_overview', [])).to_register.map(l => l.registered), [1]);
});

// ── C. Tools are never quantity stock (Q6) ────────────────────────────
await test('a tool item is never stock: no match, opening, count or move of it (TOOL_ITEM)', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const wp = await warehouseBuy(db, 'Grinder', 2);
  await refused(rpc(db, STAFF, 'stk_match', [op(), wp, 1, g, '2', null]), 'TOOL_ITEM');
  await refused(rpc(db, STAFF, 'stk_opening', [op(), j({ item_id: g, at: 'warehouse', quantity: '2', on: TODAY })]), 'TOOL_ITEM');
  await refused(rpc(db, STAFF, 'stk_count', [op(), j({ item_id: g, at: 'warehouse', counted: '0', on: TODAY })]), 'TOOL_ITEM');
  // There is never any of it to move.
  await refused(rpc(db, STAFF, 'stk_move', [op(), j({ item_id: g, from: 'warehouse', to: f, quantity: '1', on: TODAY, unplanned_reason: 'x' })]), 'NOT_ENOUGH');
  eq(num((await one(db, `select (select count(*) from stk_matches) + (select count(*) from stk_lots) + (select count(*) from stk_records) n`)).n), 0);
});
await test('a line bought for a tool request never becomes stock (leftovers refused); a warehouse line leaves Receiving once tools are registered from it, and never becomes stock', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const pp = await projectBuy(db, f, 'Grinder', 2, { requestLine: rq.line });
  await refused(rpc(db, STAFF, 'stk_leftover', [op(), pp, 1, '1', 'site', TODAY, '']), 'TOOL_ITEM', 'auto-matched to the tool item');
  eq((await rpc(db, STAFF, 'stk_overview', [])).awaiting, [], 'a project line is never in Receiving');
  const free = await warehouseBuy(db, 'Drill', 3);
  eq((await rpc(db, STAFF, 'stk_overview', [])).awaiting.length, 1, 'an unlinked line is (it may be anything)');
  await register(db, STAFF, { item_id: g, purchase_id: free, line_no: 1 });
  eq((await rpc(db, STAFF, 'stk_overview', [])).awaiting, [], 'until a tool is registered from it');
  await refused(rpc(db, BUYER, 'stk_receive', [op(), free, 1, '1', TODAY, '']), 'TOOL_LINE');
  const mat = await item(db, 'Drill bits', 'pc', 'material');
  await refused(rpc(db, STAFF, 'stk_match', [op(), free, 1, mat, '3', null]), 'TOOL_LINE');
});
await test('a line already received as stock cannot have tools registered from it (LINE_IS_STOCK)', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const wp = await warehouseBuy(db, 'Grinder', 2);
  await rpc(db, BUYER, 'stk_receive', [op(), wp, 1, '1', TODAY, '']);   // unmatched receipt: recorded in line units
  await refused(register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1 }), 'LINE_IS_STOCK');
});
await test('purchase guards: a correction may not drop below the tools registered from a line, nor void the purchase (TOOLS_IN_USE) — until those are cancelled', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const pp = await projectBuy(db, f, 'Grinder', 2);
  const r = await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, count: 2 });
  const fix = (qty) => body([{ folder_id: f, item_name: 'Grinder', quantity: qty, unit: 'pc', amount: qty * 1000 }]);
  await refused(rpc(db, OWNER, 'pur_correct', [op(), pp, j(fix(1)), 'counted wrong']), 'TOOLS_IN_USE');
  await rpc(db, OWNER, 'pur_correct', [op(), pp, j(fix(3)), 'one more']);     // keeping enough is fine
  await refused(rpc(db, OWNER, 'pur_void', [op(), pp, 'wrong supplier']), 'TOOLS_IN_USE');
  for (const x of r.tools) await reverse(db, STAFF, await latestRec(db, x.tool_id), 'not ours');
  await rpc(db, OWNER, 'pur_correct', [op(), pp, j(fix(1)), 'counted wrong']);
  eq((await one(db, `select status from purchases where id = $1`, [pp])).status, 'recorded');
});
await test('a catalogue item used by a tool keeps its kind and unit (ITEM_IN_USE)', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  await one1(db, STAFF, { item_id: g });
  await refused(db.query(`update pr_catalog_items set kind = 'material' where id = $1`, [g]), 'ITEM_IN_USE');
  await refused(db.query(`update pr_catalog_items set unit = 'set' where id = $1`, [g]), 'ITEM_IN_USE');
});

// ── D. Custody ────────────────────────────────────────────────────────
await test('issue: only an Available tool, to a named person on a project that is not completed', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t = await one1(db, STAFF, { item_id: g });
  await refused(issue(db, STAFF, { tool_id: t, folder_id: f }), 'PERSON_REQUIRED');
  await refused(issue(db, STAFF, { tool_id: t, holder_id: OTHERW, folder_id: f }), 'BAD_PERSON');
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: await folder(db, 'Done', { completed: true }) }), 'PROJECT_COMPLETED');
  const parent = await folder(db, 'Closed', { completed: true });
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: await folder(db, 'Extra', { parent }) }), 'PROJECT_COMPLETED', 'a job under a completed project');
  await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, note: 'for the tiles' });
  eq([(await tool(db, t)).state, (await tool(db, t)).holder_id], ['issued', WORKER]);
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: f }), 'NOT_AVAILABLE', 'twice');
  const rp = await one1(db, STAFF, { item_id: g, condition: 'needs_repair' });
  await refused(issue(db, STAFF, { tool_id: rp, holder_id: WORKER, folder_id: f }), 'NOT_AVAILABLE', 'under repair');
});
await test('handover: person to person (and project to project), never through the warehouse; staying on a completed project is fine', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House'), f2 = await folder(db, 'Shop');
  const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER }), 'SAME_HOLDER');
  await handover(db, STAFF, { tool_id: t, holder_id: WORKER2 });
  eq([(await tool(db, t)).holder_id, (await tool(db, t)).folder_id], [WORKER2, f], 'same project');
  await handover(db, STAFF, { tool_id: t, holder_id: LEADER, folder_id: f2 });
  eq([(await tool(db, t)).holder_id, (await tool(db, t)).folder_id], [LEADER, f2]);
  await db.query(`update folders set completed_at = now() where id = $1`, [f2]);
  await handover(db, STAFF, { tool_id: t, holder_id: WORKER });                  // stays on the completed project
  await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: await folder(db, 'Old', { completed: true }) }), 'PROJECT_COMPLETED');
  await refused(handover(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g }), holder_id: WORKER }), 'NOT_ISSUED');
  const h = await rpc(db, STAFF, 'tl_tool', [t]);
  eq(h.records.map(r => r.kind), ['handover', 'handover', 'handover', 'register']);
  eq(h.records[0].from_holder_name, 'Lito');
});
await test('return with its condition: good → Available; needs repair or missing parts → Under repair; then Repaired → Available', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  for (const [cond, state] of [['good', 'available'], ['needs_repair', 'repair'], ['missing_parts', 'repair']]) {
    const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
    const r = await ret(db, STAFF, { tool_id: t, condition: cond, note: 'back' });
    eq([(await tool(db, t)).state, (await tool(db, t)).condition], [state, cond], cond);
    const rec = await one(db, `select holder_id, folder_id from tl_records where id = $1`, [r.record_id]);
    eq([rec.holder_id, rec.folder_id], [WORKER, f], 'the return keeps who had it');
    if (state === 'repair') {
      await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f }), 'NOT_AVAILABLE');
      await repaired(db, STAFF, t, 'new brushes');
      eq([(await tool(db, t)).state, (await tool(db, t)).condition], ['available', 'good']);
    }
  }
  await refused(ret(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g }) }), 'NOT_ISSUED');
  await refused(ret(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER }), condition: 'broken' }), 'BAD_CONDITION');
  await refused(repaired(db, STAFF, await one1(db, STAFF, { item_id: g })), 'NOT_IN_REPAIR');
});

await test('registered at a project needing repair or missing parts (rev 3): kept with its person and project, NOT usable — no handover until Repaired there; then handed over', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House'), f2 = await folder(db, 'Shop');
  for (const cond of ['needs_repair', 'missing_parts']) {
    const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER, condition: cond });
    let row = await tool(db, t);
    eq([row.state, row.holder_id, row.folder_id, row.condition], ['issued', WORKER, f, cond], cond + ': with its person, on its project');
    await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2 }), 'NEEDS_REPAIR', cond + ': no handover before repair');
    await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: f2 }), 'NEEDS_REPAIR', cond + ': nor onto another project');
    await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: f }), 'NOT_AVAILABLE', cond + ': never issued again');
    row = await tool(db, t);
    eq([row.state, row.holder_id, row.folder_id], ['issued', WORKER, f], cond + ': the refusals moved nothing');
    await db.query(`update tl_tools set since = now() - interval '4 days' where id = $1`, [t]);
    const before = await tool(db, t);
    await repaired(db, STAFF, t, 'new switch');
    row = await tool(db, t);
    eq([row.state, row.holder_id, row.folder_id, row.condition, new Date(row.since).getTime()],
       ['issued', WORKER, f, 'good', new Date(before.since).getTime()], cond + ': repaired where it is — same person, project and days out');
    eq((await rpc(db, STAFF, 'tl_tool', [t])).days, 4);
    const h = await rpc(db, STAFF, 'tl_tool', [t]);
    eq([h.records[0].kind, h.records[0].holder_name, h.records[0].folder_name], ['repaired', 'Mark', 'House']);
    await handover(db, STAFF, { tool_id: t, holder_id: WORKER2 });
    row = await tool(db, t);
    eq([row.state, row.holder_id, row.folder_id], ['issued', WORKER2, f], cond + ': handed over after repair');
  }
  // Returned before it was repaired: back at the warehouse, Under repair.
  const t2 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER, condition: 'needs_repair' });
  await ret(db, STAFF, { tool_id: t2, condition: 'needs_repair' });
  eq([(await tool(db, t2)).state, (await tool(db, t2)).holder_id], ['repair', null], 'a return is always allowed');
  // A good issued tool is not "repaired"; reversing a repair puts it back as it was.
  const t3 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await refused(repaired(db, STAFF, t3), 'NOT_IN_REPAIR', 'an issued tool in good condition');
  const t4 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER, condition: 'missing_parts' });
  await repaired(db, STAFF, t4);
  await reverse(db, STAFF, await latestRec(db, t4), 'parts not fitted yet');
  eq([(await tool(db, t4)).condition, (await tool(db, t4)).state, (await tool(db, t4)).holder_id], ['missing_parts', 'issued', WORKER], 'reversed: as before');
  await refused(handover(db, STAFF, { tool_id: t4, holder_id: WORKER2 }), 'NEEDS_REPAIR', 'and not usable again');
});

// ── E. The owner: Lost and Retire (Q16–Q17, rev 2) ────────────────────
await test('returned damaged beyond repair → Retire waits for the main owner; meanwhile it cannot be issued, handed over or returned', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  const r = await ret(db, STAFF, { tool_id: t, condition: 'damaged', note: 'motor burnt' });
  eq((await tool(db, t)).state, 'retire_pending');
  const rec = await one(db, `select kind, status, before ->> 'state' b, after ->> 'state' a from tl_records where id = $1`, [r.retire_record_id]);
  eq([rec.kind, rec.status, rec.b, rec.a], ['retire', 'pending', 'repair', 'retired']);
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f }), 'NOT_AVAILABLE');
  await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2 }), 'NOT_ISSUED');
  await refused(ret(db, STAFF, { tool_id: t }), 'NOT_ISSUED');
  await refused(repaired(db, STAFF, t), 'NOT_IN_REPAIR');
  eq((await rpc(db, STAFF, 'tl_overview', [])).pending.map(p => p.kind), ['retire']);
});
await test('the owner REJECTS a retire request → Under repair, never straight to Available; CONFIRMS → Retired for good', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const t = await one1(db, STAFF, { item_id: g, condition: 'needs_repair' });
  let req = await retire(db, STAFF, t, 'cracked housing');
  eq((await tool(db, t)).state, 'retire_pending');
  await refused(decide(db, OWNER, req.record_id, false, ''), 'REASON_REQUIRED', 'a rejection needs a reason');
  await decide(db, OWNER, req.record_id, false, 'a new housing is cheap');
  eq((await tool(db, t)).state, 'repair');
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: await folder(db, 'H') }), 'NOT_AVAILABLE');
  req = await retire(db, STAFF, t, 'housing out of stock');
  await decide(db, OWNER, req.record_id, true);
  eq((await tool(db, t)).state, 'retired');
  await refused(decide(db, OWNER, req.record_id, true), 'BAD_STATE');
  await refused(reverse(db, OWNER, req.record_id), 'BAD_STATE', 'a confirmed retirement is final');
  await refused(retire(db, STAFF, await one1(db, STAFF, { item_id: g })), 'NOT_IN_REPAIR', 'only an Under-repair tool');
});
await test('Lost: waits for the main owner; REJECTED → exactly where it was (same person, project and since); CONFIRMED → Lost, who had it kept; Found → back', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await db.query(`update tl_tools set since = now() - interval '5 days' where id = $1`, [t]);
  const before = await tool(db, t);
  let rep = await lost(db, STAFF, t, 'not on site Friday');
  let now = await tool(db, t);
  eq([now.state, now.holder_id, now.folder_id], ['lost_pending', WORKER, f], 'who had it stays recorded');
  await refused(issue(db, STAFF, { tool_id: t, holder_id: WORKER2, folder_id: f }), 'NOT_AVAILABLE');
  await refused(handover(db, STAFF, { tool_id: t, holder_id: WORKER2 }), 'NOT_ISSUED');
  await refused(ret(db, STAFF, { tool_id: t }), 'NOT_ISSUED');
  await refused(lost(db, STAFF, t), 'BAD_STATE', 'reported twice');
  await decide(db, OWNER, rep.record_id, false, 'it is at the other site');
  now = await tool(db, t);
  eq([now.state, now.holder_id, now.folder_id, new Date(now.since).getTime()], ['issued', WORKER, f, new Date(before.since).getTime()], 'exactly as before');
  eq((await rpc(db, STAFF, 'tl_tool', [t])).days, 5, 'still out 5 days, not since the report');
  rep = await lost(db, STAFF, t, 'gone');
  await decide(db, OWNER, rep.record_id, true, 'police report filed');
  now = await tool(db, t);
  eq([now.state, now.holder_id], ['lost', WORKER]);
  await refused(reverse(db, OWNER, rep.record_id), 'BAD_STATE', 'a confirmed loss is not reversed — it is Found');
  await refused(found(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g }) }), 'NOT_LOST');
  await found(db, STAFF, { tool_id: t, condition: 'missing_parts', note: 'in the truck' });
  eq([(await tool(db, t)).state, (await tool(db, t)).holder_id], ['repair', null]);
  const t2 = await one1(db, STAFF, { item_id: g });
  await decide(db, OWNER, (await lost(db, STAFF, t2)).record_id, true);
  await found(db, STAFF, { tool_id: t2 });
  eq((await tool(db, t2)).state, 'available', 'found in good condition');
});
await test('a rejected Lost report of a warehouse or Under-repair tool puts it back there too', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  for (const cond of ['good', 'needs_repair']) {
    const t = await one1(db, STAFF, { item_id: g, condition: cond });
    const want = (await tool(db, t)).state;
    await decide(db, OWNER, (await lost(db, STAFF, t)).record_id, false, 'counted again');
    eq((await tool(db, t)).state, want);
  }
});
await test('only the main owner decides; the office withdraws its own request (same as a rejection); others cannot', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  const rep = await lost(db, STAFF, t);
  for (const who of [STAFF, BUYER]) await refused(decide(db, who, rep.record_id, true), 'OWNER_ONLY', who);
  await refused(decide(db, EXPOWNER, rep.record_id, true), 'TOOLS_OFF', 'another scope');
  await refused(reverse(db, BUYER, rep.record_id, 'not mine'), 'NOT_YOURS');
  await refused(reverse(db, STAFF, rep.record_id, ''), 'REASON_REQUIRED');
  await reverse(db, STAFF, rep.record_id, 'it turned up next day');
  eq([(await tool(db, t)).state, (await tool(db, t)).holder_id], ['issued', WORKER]);
  eq((await one(db, `select status from tl_records where id = $1`, [rep.record_id])).status, 'withdrawn');
  const t2 = await one1(db, STAFF, { item_id: g, condition: 'needs_repair' });
  const rq = await retire(db, BUYER, t2);
  await reverse(db, OWNER, rq.record_id, 'repair it');               // the main owner may withdraw anyone's
  eq((await tool(db, t2)).state, 'repair');
  eq((await all(db, `select kind from tl_events where kind <> 'switched' order by id`)).map(r => r.kind), ['withdrawn', 'withdrawn']);
});

// ── F. Requests: one tool fills a line once (Q14, rev 2–3) ─────────────
await test('a warehouse tool NOT bought for the line fills it; a return and a handover keep it filled; reversing that issue reopens it by one', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const t = await one1(db, STAFF, { item_id: g });
  eq(await still(db, rq.line), 2);
  const is = await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
  eq([is.fills_request, is.bought_for_request], [true, false]);
  eq(await still(db, rq.line), 1);
  const shown = await rpc(db, BUYER, 'tl_line_tools', [`{${rq.line}}`]);
  eq([shown[rq.line].tools.map(x => [x.label, x.counted]), num(shown[rq.line].filled), num(shown[rq.line].portions[rq.portion])],
     [[['TOOL-0001', true]], 1, 1], 'the shopping list: issued, filled 1 in its weekly portion');
  for (const who of [WORKER, LEADER, PMSTAFF]) eq(await rpc(db, who, 'tl_line_tools', [`{${rq.line}}`]), {}, who + ' reads no tools');
  await handover(db, STAFF, { tool_id: t, holder_id: WORKER2 });
  eq(await still(db, rq.line), 1, 'a handover keeps it filled');
  const back = await ret(db, STAFF, { tool_id: t });
  eq(await still(db, rq.line), 1, 'a return keeps it filled');
  await refused(reverse(db, STAFF, is.record_id), 'LATER_RECORDS');
  await reverse(db, STAFF, back.record_id);
  await reverse(db, STAFF, (await one(db, `select id from tl_records where tool_id = $1 and kind = 'handover'`, [t])).id);
  await reverse(db, STAFF, is.record_id, 'issued to the wrong request');
  eq(await still(db, rq.line), 2, 'reopened by exactly that tool');
  eq([num((await one(db, `select pr_line_bought($1) b`, [rq.line])).b), num((await one(db, `select pr_line_from_tools($1) b`, [rq.line])).b)], [0, 0],
     'the line\'s figure too');
  eq((await tool(db, t)).state, 'available');
});
await test('a tool BOUGHT for the line and issued for it counts once; reversing that issue keeps the line filled through its purchase (rev 3)', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 1 });
  const pp = await projectBuy(db, f, 'Grinder', 1, { requestLine: rq.line });
  eq(await still(db, rq.line), 0, 'bought');
  const t = await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 });
  const is = await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
  eq([is.fills_request, is.bought_for_request], [false, true]);
  eq(await still(db, rq.line), 0, 'still 0 — never below');
  eq(num((await one(db, `select pr_line_bought($1) b`, [rq.line])).b), 1, 'filled once, not twice');
  eq(num((await one(db, `select count(*) n from tl_covers`)).n), 0);
  const shown = await rpc(db, BUYER, 'tl_line_tools', [`{${rq.line}}`]);
  eq([shown[rq.line].tools.map(x => [x.label, x.holder_name, x.counted]), num(shown[rq.line].filled), shown[rq.line].portions],
     [[['TOOL-0001', 'Mark', false]], 0, {}], 'issued, but counted through its purchase');
  await reverse(db, STAFF, is.record_id, 'not yet handed out');
  eq(await still(db, rq.line), 0, 'stays filled through the purchase');
  eq(num((await one(db, `select pr_line_bought($1) b`, [rq.line])).b), 1);
});
await test('a line bought 3 for a request of 2 (1 extra): its first 2 tools count through the purchase; the extra cannot fill the line again', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const pp = await projectBuy(db, f, 'Grinder', 3, { requestLine: rq.line, extra: true });
  eq(await still(db, rq.line), 0);
  const r = await register(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1, count: 3 });
  const go = (x, line) => issue(db, STAFF, { tool_id: x.tool_id, holder_id: WORKER, folder_id: f, request_line_id: line });
  eq([(await go(r.tools[0], rq.line)).fills_request, (await go(r.tools[1], rq.line)).fills_request], [false, false]);
  await refused(go(r.tools[2], rq.line), 'REQUEST_EXCEEDED', 'the extra would count twice');
  eq(num((await one(db, `select pr_line_bought($1) b`, [rq.line])).b), 2, 'filled 2, never 3');
  await go(r.tools[2], null);                                      // issued without a request: fine
  const other = await request(db, f, { item: g, quantity: 1 });
  const t4 = await one1(db, STAFF, { item_id: g });
  eq((await go({ tool_id: t4 }, other.line)).fills_request, true, 'a tool not bought for that line counts on its own');
});
await test('the request link: a TOOL line of that project, open, of the same item and unit', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder'), d = await item(db, 'Drill');
  const f = await folder(db, 'House'), f2 = await folder(db, 'Shop');
  const t = await one1(db, STAFF, { item_id: g });
  const go = (line, folderId = f) => issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: folderId, request_line_id: line });
  await refused(go((await request(db, f, { kind: 'material', unit: 'pc' })).line), 'NOT_A_TOOL_LINE');
  await refused(go((await request(db, f2, { item: g })).line), 'BAD_REQUEST_LINK');
  await refused(go((await request(db, f, { item: d })).line), 'ITEM_MISMATCH');
  await refused(go((await request(db, f, { unit: 'set' })).line), 'UNIT_MISMATCH');
  const closed = await request(db, f, { item: g });
  await db.query(`update pr_lines set status = 'cancelled' where id = $1`, [closed.line]);
  await refused(go(closed.line), 'LINE_CLOSED');
  await refused(go('not-a-uuid'), 'BAD_REQUEST_LINK');
  eq((await tool(db, t)).state, 'available', 'nothing was issued');
  const open = await request(db, f, { item: null, quantity: 1 });      // a line naming no catalogue item: any grinder
  await go(open.line);
  eq(await still(db, open.line), 0);
});
await test('Request lines to fill: open tool lines of the project with what is still to fill', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  await request(db, f, { kind: 'material', unit: 'bag', description: 'Cement' });
  const lines = await rpc(db, STAFF, 'tl_request_lines', [f]);
  eq(lines.map(l => [l.description, num(l.still_to_buy)]), [['Grinder', 2]]);
  eq(lines[0].line_id, rq.line);
});

// ── G. Reversals, history and retries ─────────────────────────────────
await test('reverse: only the tool\'s latest record, by whoever recorded it or an owner; a registration reversed → cancelled and the line freed', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const wp = await warehouseBuy(db, 'Grinder', 1);
  const t = await one1(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1 });
  const is = await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f });
  await refused(reverse(db, STAFF, (await one(db, `select id from tl_records where tool_id = $1 and kind = 'register'`, [t])).id), 'LATER_RECORDS');
  await refused(reverse(db, BUYER, is.record_id), 'NOT_YOURS');
  await reverse(db, OWNER, is.record_id, 'an owner may');
  await refused(reverse(db, STAFF, is.record_id), 'BAD_STATE', 'twice');
  await reverse(db, STAFF, await latestRec(db, t), 'registered from the wrong line');
  eq((await tool(db, t)).state, 'cancelled');
  await register(db, STAFF, { item_id: g, purchase_id: wp, line_no: 1 });   // the line's place is free again
});
await test('history cannot be edited: events, request fills, records and tools are never deleted or changed directly', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 1 });
  const t = await one1(db, STAFF, { item_id: g });
  await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
  for (const sql of [`update tl_events set reason = 'x'`, `delete from tl_events`, `update tl_covers set quantity = 2`,
                     `delete from tl_covers`, `delete from tl_records`, `delete from tl_tools`]) {
    await refused(db.query(sql), 'HISTORY_IMMUTABLE', sql);
  }
});
await test('the same press twice records once (the first answer, replayed); a cancelled operation id is refused', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const id = op();
  const a = await register(db, STAFF, { item_id: g, count: 2 }, id);
  const b = await register(db, STAFF, { item_id: g, count: 5 }, id);       // a changed form under the same id
  eq([b.replayed, b.tools.length], [true, 2]);
  eq(num((await one(db, `select count(*) n from tl_tools`)).n), 2);
  const iid = op();
  await issue(db, STAFF, { tool_id: a.tools[0].tool_id, holder_id: WORKER, folder_id: f }, iid);
  await issue(db, STAFF, { tool_id: a.tools[0].tool_id, holder_id: WORKER, folder_id: f }, iid);
  eq(num((await one(db, `select count(*) n from tl_records where kind = 'issue'`)).n), 1);
  const cid = op();
  await as(db, STAFF);
  eq((await one(db, `select pur_op_cancel($1) r`, [cid])).r, 'cancelled');
  await refused(issue(db, STAFF, { tool_id: a.tools[1].tool_id, holder_id: WORKER, folder_id: f }, cid), 'OP_CANCELLED');
  eq((await tool(db, a.tools[1].tool_id)).state, 'available');
});

// ── H. Reading ────────────────────────────────────────────────────────
await test('the Tools screen: tools, tools out longest first with days, what waits for the owner; one tool\'s whole history', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const t1 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER, details: 'Makita' });
  const t2 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER2 });
  await db.query(`update tl_tools set since = now() - interval '9 days' where id = $1`, [t2]);
  await lost(db, STAFF, await one1(db, STAFF, { item_id: g }));
  const ov = await rpc(db, STAFF, 'tl_overview', []);
  eq(ov.out.map(x => [x.label, x.holder_name, x.folder_name, x.days]), [['TOOL-0002', 'Rey', 'House', 9], ['TOOL-0001', 'Mark', 'House', 0]]);
  eq(ov.pending.map(p => [p.kind, p.label]), [['lost', 'TOOL-0003']]);
  eq(ov.tools.map(x => x.state), ['issued', 'issued', 'lost_pending']);
  const one_ = await rpc(db, STAFF, 'tl_tool', [t1]);
  eq([one_.details, one_.item_name, one_.records.length, one_.records[0].kind, one_.records[0].latest], ['Makita', 'Grinder', 1, 'register', true]);
});
await test('choices: tool items only; everyone active in the company, the crew with their teams; projects with completed marked', async () => {
  const db = await fresh();
  await item(db, 'Grinder'); await item(db, 'Cement', 'bag', 'material');
  const team = (await one(db, `insert into pr_teams (owner_id, name) values ($1, 'Masons') returning id`, [OWNER])).id;
  await db.query(`insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values ($1, $2, $3, true)`, [OWNER, team, LEADER]);
  await folder(db, 'House'); await folder(db, 'Done', { completed: true });
  const ch = await rpc(db, STAFF, 'tl_choices', []);
  eq(ch.items.map(i => i.name), ['Grinder']);
  eq(ch.people.map(p => [p.name, p.role, p.teams]), [['admin', 'owner', []], ['admin-exp', 'owner', []], ['Ana', 'staff', []], ['Juan', 'staff', []],
    ['Lito', 'teamLeader', ['Masons']], ['Mark', 'worker', []], ['Pia', 'staff', []], ['Rey', 'worker', []]],
    'everyone active in the company (T1 = C); no client, partner, deactivated account or other company');
  eq(ch.projects.map(p => [p.name, p.completed]), [['Done', true], ['House', false]]);
});
await test('tools out on a project and its Additional Works jobs, for Mark as Complete; empty while off or for an account that cannot record', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const aw = await folder(db, 'Garage', { parent: f });
  await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await one1(db, STAFF, { item_id: g, at: aw, holder_id: WORKER2 });
  await one1(db, STAFF, { item_id: g, at: await folder(db, 'Shop'), holder_id: WORKER2 });
  const out = await rpc(db, OWNER, 'tl_project_out', [f]);
  eq(out.map(x => [x.label, x.holder_name, x.folder_name]), [['TOOL-0001', 'Mark', 'House'], ['TOOL-0002', 'Rey', 'House — Garage']]);
  eq(await rpc(db, PMSTAFF, 'tl_project_out', [f]), []);
  await rpc(db, OWNER, 'tl_set_enabled', [false]);
  eq(await rpc(db, OWNER, 'tl_project_out', [f]), []);
});
await test('no money anywhere: a whole flow writes no expense, payroll or payment, and no answer carries a peso amount', async () => {
  const db = await fresh();
  const g = await item(db, 'Grinder');
  const f = await folder(db, 'House');
  const rq = await request(db, f, { item: g, quantity: 2 });
  const pp = await projectBuy(db, f, 'Grinder', 1, { requestLine: rq.line });
  const before = await money(db);
  const t = await one1(db, STAFF, { item_id: g, purchase_id: pp, line_no: 1 });
  await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
  await handover(db, STAFF, { tool_id: t, holder_id: WORKER2 });
  await ret(db, STAFF, { tool_id: t, condition: 'damaged' });
  const t2 = await one1(db, STAFF, { item_id: g, at: f, holder_id: WORKER });
  await decide(db, OWNER, (await lost(db, STAFF, t2)).record_id, true);
  eq(await money(db), before);
  const texts = [j(await rpc(db, STAFF, 'tl_overview', [])), j(await rpc(db, STAFF, 'tl_tool', [t])), j(await rpc(db, STAFF, 'tl_choices', [])),
                 j(await rpc(db, STAFF, 'tl_request_lines', [f])), j(await rpc(db, OWNER, 'tl_project_out', [f]))];
  for (const s of texts) assert(!/amount|price|cost|gross|₱|peso/i.test(s), 'money in an answer: ' + s.slice(0, 200));
});

// ── I. What 0107 changes elsewhere, and who may call what ─────────────
await test('stk_overview is 0104\'s, word for word, but for leaving tool lines out of Receiving', async () => {
  const mine = fnText(M107, 'stk_overview');
  const theirs = fnText(M104, 'stk_overview');
  eq(mine.replace("\n                    and not tl_tool_line(l)", ''), theirs);
  assert(mine.includes('and not tl_tool_line(l)'), 'the one change');
  const fresh_ = fnText(M107, 'pr_item_in_use');
  eq(fresh_.replace("\n      or exists (select 1 from tl_tools t where t.item_id = p_item)", ''), fnText(M104, 'pr_item_in_use'));
});
await test('covered = purchases + stock + tools, everywhere 0097 counts Still to buy', async () => {
  eq(fnText(M107, 'pr_portion_bought').includes('pr_portion_purchased(p_portion) + pr_portion_from_stock(p_portion) + pr_portion_from_tools(p_portion)'), true);
  eq(fnText(M107, 'pr_line_bought').includes('pr_line_purchased(p_line) + pr_line_from_stock(p_line) + pr_line_from_tools(p_line)'), true);
});
await test('grants: every tl_ operation and reader is for signed-in users only; every helper for no one', async () => {
  const db = await fresh();
  const can = async (role, fn) => (await one(db, `select has_function_privilege($1, $2, 'execute') x`, [role, fn])).x;
  const open = ['tl_status()', 'tl_set_enabled(boolean)', 'tl_register(uuid,jsonb)', 'tl_issue(uuid,jsonb)', 'tl_handover(uuid,jsonb)',
                'tl_return(uuid,jsonb)', 'tl_repaired(uuid,uuid,text)', 'tl_report_lost(uuid,uuid,text)', 'tl_request_retire(uuid,uuid,text)',
                'tl_found(uuid,jsonb)', 'tl_decide(uuid,uuid,boolean,text)', 'tl_reverse(uuid,uuid,text)', 'tl_overview()', 'tl_tool(uuid)',
                'tl_choices()', 'tl_request_lines(uuid)', 'tl_project_out(uuid)', 'tl_line_tools(uuid[])', 'stk_overview()'];
  for (const fn of open) {
    eq([await can('authenticated', fn), await can('anon', fn)], [true, false], fn);
  }
  const names = (await all(db, `select p.oid::regprocedure::text f
                                  from pg_proc p where p.proname like 'tl\\_%' or p.proname in ('pr_portion_from_tools', 'pr_line_from_tools')`)).map(r => r.f);
  const internal = names.filter(n => !open.some(o => o.split('(')[0] === n.split('(')[0]));
  assert(internal.length >= 25, 'helpers found: ' + internal.length);
  for (const fn of internal) eq([await can('authenticated', fn), await can('anon', fn)], [false, false], fn);
});

// ── J. The live acceptance script ─────────────────────────────────────
const ACCEPT = read(path.join(ROOT, 'supabase/tests/3a_acceptance.sql'));
// Supabase's auth.uid() reads the JWT claims, as the script sets them; live
// profiles have created_at, and the main owner is the oldest owner account.
async function acceptancePrep(db) {
  await db.exec(`create or replace function auth.uid() returns uuid language sql stable as
                   $$ select coalesce(nullif(current_setting('test.uid', true), ''),
                                      nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
                 alter table profiles add column if not exists created_at timestamptz not null default now();
                 update profiles set created_at = now() + interval '1 hour' where id <> '${OWNER}';
                 select set_config('test.uid', '', false);`);
}
async function acceptanceDb() {
  const db = await fresh({ on: false });
  await folder(db, 'Barlin');
  await request(db, await folder(db, 'Prado'), { quantity: 1, kind: 'material', unit: 'bag', description: 'Cement' });
  await acceptancePrep(db);
  return db;
}
await test('the live acceptance script (3a_acceptance.sql) passes as written, tools off, and leaves nothing behind', async () => {
  const db = await acceptanceDb();
  const count = () => one(db, `select (select count(*) from tl_tools) t, (select count(*) from tl_records) r, (select count(*) from tl_settings) s,
                                      (select count(*) from pr_catalog_items) i, (select count(*) from pur_ops) o`);
  const before = await count();
  const res = await db.exec(ACCEPT);
  assert(res.some(x => (x.rows || []).some(r => r.result === '3a acceptance: all checks passed')), 'the success row');
  eq(await count(), before, 'all rolled back');
});
await test('the acceptance script fails when it should: tools already on, a function open to anon, a helper open, no person check, a tool item taken as stock, no opening photo check', async () => {
  for (const [why, spoil, want] of [
    ['tools already switched on', async (db) => { await as(db, OWNER); await db.query(`select tl_set_enabled(true)`); await as(db, ''); }, 'A1'],
    ['tl_tool open to anon', (db) => db.exec(`grant execute on function tl_tool(uuid) to anon`), 'B1'],
    ['tl_write open to signed-in users', (db) => db.exec(`grant execute on function tl_write(uuid, tl_tools, text, text, jsonb, jsonb) to authenticated`), 'B2'],
    ['a project registration without a person accepted', (db) => {
      const fn = fnText(M107, 'tl_person');
      const a = "  if p_person is null then\n    raise exception 'PERSON_REQUIRED' using errcode = 'P0001';\n  end if;\n";
      assert(fn.split(a).length === 2, 'the person check is in tl_person once');
      return db.exec(fn.replace(a, ''));
    }, 'D1'],
    ['a tool item taken as stock', (db) => db.exec(`drop trigger tl_no_tool_stock on stk_records`), 'D9'],
    ['an opening register without a photo accepted', (db) => {
      const fn = fnText(M107, 'tl_register');
      const a = "  if v_purchase is null and v_photo is null then\n    raise exception 'PHOTO_REQUIRED' using errcode = 'P0001';\n  end if;\n";
      assert(fn.split(a).length === 2, 'the photo check is in tl_register once');
      return db.exec(fn.replace(a, ''));
    }, 'D1b'],
  ]) {
    const db = await acceptanceDb();
    await spoil(db);
    await refused(db.exec(ACCEPT), want, why);
  }
});

// ── K. The pilot's guarded clean-up (3a_pilot_cleanup.sql) ──────────
const CLEAN = read(path.join(ROOT, 'supabase/tests/3a_pilot_cleanup.sql'));
async function stubs(db) {
  await db.exec(`
    create table if not exists construction_projects (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete set null);
    create table if not exists wp_tasks (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id), work_folder_id uuid references folders(id));
    create table if not exists wp_blockers (id uuid primary key default gen_random_uuid(), request_id uuid references pr_requests(id));
    create table if not exists overhead_expenses (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade,
      billing_period_id uuid references projects(id) on delete set null, amount numeric);
    create table if not exists reimbursements (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
    create table if not exists labor_contracts (id uuid primary key default gen_random_uuid(), folder_id uuid references folders(id) on delete cascade);
    create table if not exists pr_line_conflicts (id uuid primary key default gen_random_uuid(), line_id uuid references pr_lines(id));
    create table if not exists pr_item_refs (id uuid primary key default gen_random_uuid(), catalog_item_id uuid references pr_catalog_items(id),
      folder_id uuid references folders(id) on delete cascade);
    create table if not exists pr_gallery_photos (id uuid primary key default gen_random_uuid(), catalog_item_id uuid references pr_catalog_items(id));`);
}
const cleanup = (db, real = false) => {
  if (!real) return db.exec(CLEAN);
  const run = CLEAN.replace(/^  v_dry boolean := true;$/m, '  v_dry boolean := false;');
  assert(run !== CLEAN, 'the setting line is in the file');
  return db.exec(run);
};
async function period(db, folderId, budget = 100000) {
  const d = new Date(TODAY + 'T00:00:00Z');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const id = (await one(db, `insert into projects (owner_id, folder_id, month, year, funding_type, billing_number)
                              values ($1, $2, $3, $4, 'progress', 1) returning id`, [OWNER, folderId, months[d.getUTCMonth()], d.getUTCFullYear()])).id;
  await db.query(`insert into project_budgets values ($1, $2, $3)`, [id, OWNER, budget]);
  return id;
}
async function snapshot(db) {
  return one(db, `select (select count(*) from folders) folders, (select count(*) from projects) periods,
                         (select count(*) from pr_catalog_items) items, (select count(*) from purchases) purchases,
                         (select count(*) from expenses) exp_n, (select coalesce(sum(amount), 0) from expenses) exp_sum,
                         (select count(*) from pr_requests) requests, (select count(*) from tl_tools) tools, (select count(*) from tl_records) tool_recs,
                         (select count(*) from tl_covers) covers, (select count(*) from tl_events) events`);
}
// A whole ZZ pilot (Q24) beside real data: real tools on a real project first.
async function pilot() {
  const db = await fresh();
  await stubs(db);
  const real = await folder(db, 'House'); await period(db, real);
  const drill = await item(db, 'Drill');
  const realReq = await request(db, real, { item: drill, quantity: 1, description: 'Drill' });
  const realPur = await projectBuy(db, real, 'Drill', 1, { requestLine: realReq.line });
  const realTool = await one1(db, STAFF, { item_id: drill, purchase_id: realPur, line_no: 1 });
  await issue(db, STAFF, { tool_id: realTool, holder_id: WORKER, folder_id: real, request_line_id: realReq.line });
  const real2 = await one1(db, STAFF, { item_id: drill, at: real, holder_id: WORKER2 });
  const A = await folder(db, 'ZZ 3a pilot A'); await period(db, A);
  const job = await folder(db, 'ZZ 3a pilot A — extra room', { parent: A });
  const B = await folder(db, 'ZZ 3a pilot B'); await period(db, B);
  const g = await item(db, 'ZZ 3a grinder');
  const req = await request(db, A, { item: g, quantity: 2, description: 'ZZ 3a grinder' });
  const pur = await projectBuy(db, A, 'ZZ 3a grinder', 1, { requestLine: req.line });
  const t1 = await one1(db, STAFF, { item_id: g, purchase_id: pur, line_no: 1 });
  await issue(db, STAFF, { tool_id: t1, holder_id: WORKER, folder_id: A, request_line_id: req.line });
  await handover(db, STAFF, { tool_id: t1, holder_id: WORKER2, folder_id: job });
  const back = await ret(db, STAFF, { tool_id: t1, condition: 'damaged' });
  await decide(db, OWNER, back.retire_record_id, false, 'repair');
  const t2 = await one1(db, STAFF, { item_id: g });
  await issue(db, STAFF, { tool_id: t2, holder_id: LEADER, folder_id: B, request_line_id: null });
  await decide(db, OWNER, (await lost(db, STAFF, t2)).record_id, false, 'on site');
  const t3 = await one1(db, STAFF, { item_id: g, at: A, holder_id: WORKER, condition: 'missing_parts' });
  await issue(db, STAFF, { tool_id: await one1(db, STAFF, { item_id: g }), holder_id: WORKER, folder_id: A, request_line_id: req.line });
  await as(db, '');
  return { db, real, A, B, job, g, drill, req, realReq, realTool, real2, t1, t2, t3, pur };
}
await test('the pilot clean-up: the dry run changes nothing; the real run removes only ZZ — real tools, purchases, expenses and requests stay; guards back on', async () => {
  const p = await pilot();
  const db = p.db;
  const before = await snapshot(db);
  const realBefore = await all(db, `select id, number, state, holder_id from tl_tools where id in ($1, $2) order by number`, [p.realTool, p.real2]);
  const stillReal = await still(db, p.realReq.line);
  await refused(cleanup(db), 'DRY RUN OK', 'the dry run');
  eq(await snapshot(db), before, 'nothing changed');
  await cleanup(db, true);
  eq(num((await one(db, `select count(*) n from folders where name like 'ZZ 3a%'`)).n), 0);
  eq(num((await one(db, `select count(*) n from pr_catalog_items where name like 'ZZ 3a%'`)).n), 0);
  eq(await all(db, `select id, number, state, holder_id from tl_tools order by number`), realBefore, 'the real tools, numbers and holders kept');
  eq(num((await one(db, `select count(*) n from tl_records`)).n), 3, 'their 3 records');
  eq(await still(db, p.realReq.line), stillReal, 'the real request as it was');
  eq(num((await one(db, `select count(*) n from purchases`)).n), 1, 'the real purchase stays');
  eq(num((await one(db, `select count(*) n from tl_events where kind = 'switched'`)).n), 1, 'the switch\'s history stays');
  eq(num((await one(db, `select count(*) n from pg_trigger where tgname in ('tl_events_no_change', 'tl_covers_no_change',
      'tl_records_no_delete', 'tl_tools_no_delete') and tgenabled = 'O'`)).n), 4, 'guards back on');
  await refused(db.query(`delete from tl_tools`), 'HISTORY_IMMUTABLE', 'and they hold');
  await refused(cleanup(db), 'no project named', 'a second run finds nothing');
});
await test('the clean-up stops (and changes nothing) when ZZ and real tools are mixed', async () => {
  for (const [why, spoil, want] of [
    ['a ZZ tool handed over onto a real project', (p) => handover(p.db, STAFF, { tool_id: p.t2, holder_id: WORKER, folder_id: p.real }), 'a ZZ tool was recorded on a real project'],
    ['a real tool issued on a ZZ project', async (p) => { await ret(p.db, STAFF, { tool_id: p.real2 });
      await issue(p.db, STAFF, { tool_id: p.real2, holder_id: WORKER, folder_id: p.A }); }, 'a real tool was recorded on a ZZ project'],
    ['a real tool filling a ZZ request', async (p) => {
      const t = await one1(p.db, STAFF, { item_id: p.drill });
      const r2 = await request(p.db, p.A, { quantity: 1, description: 'Any tool' });
      await issue(p.db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: p.A, request_line_id: r2.line }); }, 'a real tool was recorded on a ZZ project'],
    ['a ZZ tool registered as a real item from a ZZ purchase', async (p) => {
      const zp = await projectBuy(p.db, p.A, 'ZZ 3a level', 1);
      await register(p.db, STAFF, { item_id: p.drill, purchase_id: zp, line_no: 1 }); }, 'registered as a real catalogue item'],
  ]) {
    const p = await pilot();
    await spoil(p);
    await as(p.db, '');
    const before = await snapshot(p.db);
    await refused(cleanup(p.db, true), want, why);
    eq(await snapshot(p.db), before, why + ': nothing changed');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Modify:** `package.json`

```diff
diff --git a/package.json b/package.json
index f9bc084..55720a6 100644
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/3a_tools.pglite.mjs && node supabase/tests/3a_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0107 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0107 && node supabase/tests/2a3_server.pglite.mjs --with-0107 && node supabase/tests/2a4_payments.pglite.mjs --with-0107 && node supabase/tests/2b_stock.pglite.mjs --with-0107 && node supabase/tests/2c_cost.pglite.mjs --with-0107 && node supabase/tests/2bb_phone.pglite.mjs --with-0107 && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**Modify:** `docs/DATABASE_SCHEMA.md`

```diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
index c8fe4c9..9b79e35 100644
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -1196,6 +1196,33 @@ Rows (`stk_cost_rows`): the receiving project is funded like a purchase (`pur_fu
 
 Redefined: from 0104 `stk_take` (returns the holder; within a delivery, goods not yet the place's own leave first), `stk_check_record`, `stk_move` (holder on every row; a return takes the issue's goods as their cost now stands; then `stk_cost_requests`; answer + `cost_moves`), `stk_decide` (+ `stk_cost_losses`), `stk_reverse` (`COST_MOVED` while an approved cost move rides on the record; pending ones withdrawn), `stk_record_json` (`costs` — states for everyone who reads stock, `value` / `estimate` keys for owner accounts only); from 0096 `pur_guard_expense_row` and `pur_guard_delete` (a project with live stock records or open cost moves, or a billing period carrying cost-move rows: `STOCK_LIVE`). Guard `stk_guard_cost_basis` (after insert on `purchase_history`, kinds corrected / unit_checked / refunded — every 2A path that stores a purchase again, an approved change request included): a purchase line's price or quantity cannot change while approved cost moves value its lot (`STOCK_COST_IN_USE`), and neither can where the purchase's cost sits — its rows' billing periods and Cover (`STOCK_COST_FUNDING`; reverse those moves first). Locks: the lot's purchase first (as every purchase write), then the item and the projects charged in one sorted pass; a count's loss and a purchase correction meet on the lot row.
 
+## Tools (0107) — WorkMate Stage 3a
+
+Every real tool, numbered, and who answers for it — **no money**: a tool's cost stays where its purchase put it (a project's Spent, or company stock cost). A catalogue item of kind `tool` is tracked only here, never as quantity stock. Dormant until the main owner switches tools on (`tl_set_enabled`). Answers: `docs/superpowers/specs/2026-10-28-workmate-stage3-tools-questions.md` (all A).
+
+| Table | What it holds |
+|---|---|
+| `tl_settings` | `owner_id`, `enabled` — the company's tools switch (main owner only) |
+| `tl_tools` | `number` (TOOL-0001…, per company, never reused), `item_id` (kind `tool`), `purchase_id` + `line_no` (the purchase line it came from, or none — the opening register), `details` (brand / model / serial), `photo_path` (`tools/<company>/<yyyy-mm>/<uuid>.jpg` in `uploads`), `state` (`available`, `issued`, `repair`, `lost_pending`, `lost`, `retire_pending`, `retired`, `cancelled`), `condition` (`good`, `needs_repair`, `missing_parts`, `damaged`), `holder_id` + `folder_id` (who has it and on which project — an issued tool always has both; while lost, who had it last), `since` (when the current state began). Never deleted |
+| `tl_records` | One action on one tool: `kind` (`register`, `issue`, `handover`, `return`, `repaired`, `lost`, `found`, `retire`), `status` (`done`; Lost / Retire also `pending`, `rejected`, `withdrawn`), `before` / `after` (the tool's custody around it), `holder_id` / `folder_id` (the custody it gave or ended), `request_line_id`, `condition`, `photo_path`, `note`, the decision and the reversal with their reasons. Never deleted |
+| `tl_covers` | What an issue filled on a tool request line when the tool was **not** bought for it (`request_line_id`, `portion_id`, `quantity`); counts while its issue stands. Never changed |
+| `tl_events` | Append-only: the switch, confirmations, rejections, withdrawals, reversals |
+
+| Function | Who | What |
+|---|---|---|
+| `tl_register(op, body)` | office | 1–50 tools of one tool item, at the warehouse or with a **named person** on a project (`PERSON_REQUIRED`); from a purchase line never more than it bought (`MORE_THAN_BOUGHT`), never a line already received as stock (`LINE_IS_STOCK`) |
+| `tl_issue(op, body)` | office | An `available` tool to a person on a project that is not completed; optionally for a tool request line — it fills the line only if the tool was not bought for it (`tl_bought_for`) |
+| `tl_handover(op, body)` | office | Person to person (and project to project), never through the warehouse — only a tool in good condition (`NEEDS_REPAIR`) |
+| `tl_return(op, body)` | office | With its condition: good → available; needs repair / missing parts → repair; damaged → repair + a pending Retire |
+| `tl_repaired`, `tl_found` | office | Repaired: under repair → available, or an issued tool not in good condition → good, with the same person, project and days out; Found: lost → available or repair |
+| `tl_report_lost`, `tl_request_retire` | office | Wait for the main owner; the tool cannot be issued, handed over or returned meanwhile |
+| `tl_decide(op, record, approve, note)` | main owner | Confirm → lost / retired; reject (reason) → exactly where it was before (Retire: Under repair) |
+| `tl_reverse(op, record, reason)` | recorder or owner | Withdraw a pending one, or reverse the tool's latest record (`LATER_RECORDS` otherwise); reversing a registration cancels the tool |
+| `tl_overview`, `tl_tool`, `tl_choices`, `tl_request_lines` | office | The Tools screens |
+| `tl_project_out(folder)`, `tl_line_tools(lines)` | owner / office / buyers | Tools still out on a project and its jobs (Mark as Complete); tools issued for request lines (the shopping list). Empty while off |
+
+Covered (every Still to buy): `pr_line_bought` = purchases + stock + tools. A return or a handover keeps a line filled; reversing an issue reopens it only if that issue counted on its own.
+
 ## PM profit sharing (0098)
 
 An internal owner/partner allocation per PM project - **outside the money model** (never a payout, invoice or accounting entry). Spec `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`; plan `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`. `project_id` is a `construction_projects.id` (never a `folders.id`). The three tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`: nothing reads or writes them directly. Read through `pm_sharing_read` (owner-role accounts of the company); write through `pm_set_sharing` (main owner only).
```

**Modify:** `CLAUDE.md`

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
index 663b9cf..a5567c8 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -163,6 +163,17 @@ Profit   = Earned − Spent
   (`STOCK_COST_IN_USE`), and neither can where the purchase's cost sits — its billing periods and Cover: a correction,
   re-fund or approved change request that would move its rows waits until those moves are reversed (`STOCK_COST_FUNDING`). Values are for owner accounts only: staff see the "Stock cost move" row and its state, never its
   pesos, and it is left out of their subtotals (`_hideStockCost`). Pesos for stock live only in `js/stock-cost-admin.js`.
+- **Tools (0107, WorkMate 3a) are custody only — no money.** A catalogue item of kind `tool` is tracked as numbered tools
+  (TOOL-0001…, never reused), never as quantity stock (`TOOL_ITEM` / `TOOL_LINE`). A tool's cost stays where its purchase
+  put it — no value per tool, no depreciation, no charge for using one, no cost move. Nothing in tools reads or writes a
+  peso, an `expenses` row or Spent. **A tool at a project always has a named responsible person** (anyone active in the
+  company); one there that needs repair or is missing parts stays with that person but is not handed over until Repaired.
+  Lost and Retire wait for
+  the main owner, and a rejection puts the tool back where it was (Retire: Under repair). In request figures a tool counts
+  **once**: covered = purchases + stock + tools issued for the line that were **not** bought for it (`pr_line_bought`); a
+  return or handover keeps it filled, reversing an issue reopens it only if that issue counted on its own. Records are never
+  edited — reversed with a reason while they are the tool's latest. Only `js/tools-admin.js` calls the `tl_*` operations.
+  Dormant until the main owner switches tools on.
 
 Full reasoning: [docs/OVERHEAD_MODULE.md](docs/OVERHEAD_MODULE.md).
 
```


- [ ] **Step 1: Apply the files above** in Dacs Web. Create blocks as given; Modify blocks with `git apply --ignore-whitespace`. Then put the two CRLF files back to CRLF everywhere:

```bash
node -e "for (const f of ['supabase/migrations/README.md','docs/DATABASE_SCHEMA.md']) { const fs=require('fs'); const s=fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'); fs.writeFileSync(f, s.replace(/\n/g,'\r\n')); }"
```

- [ ] **Step 2: Tests.** `npm test` → every suite passes (**41**, 1,323 checks — Task 1 changes no screen). `npm run test:sql` → every suite passes (**43**, 1,306 checks), including the new `3a_tools.pglite.mjs` (**45**) and `3a_concurrency.mjs` (**8**, real PostgreSQL), and the seven `--with-0107` re-runs (2a1 45, 2a2 44, 2a3 23, 2a4 48, 2b_stock 38, 2c_cost 29, 2bb_phone 16).
- [ ] **Step 3: Stop for the user** to review and commit. Do not push yet.

### Task 2: Dacs Web — Requests → Tools, Mark as Complete, the shopping list

**Interfaces consumed:** Task 1's `tl_*` functions (above). **Produced:** `window.ToolsAdmin` (`render`, and the pure helpers `tests/tools-admin.test.js` loads), `window.currentToolsOn` / `window.currentToolsMainOwner` (set at sign-in from `tl_status`), `RequestsAdmin.views.reqTools`.

**Modify:** `js/admin.js`

```diff
diff --git a/js/admin.js b/js/admin.js
index b251500..0fc42a9 100644
--- a/js/admin.js
+++ b/js/admin.js
@@ -98,6 +98,17 @@ function checkAuthState() {
                     window.currentStockOn = !!(stk && stk.enabled);
                     window.currentStockMainOwner = !!(stk && stk.is_main_owner);
                 } catch (_) { /* tab stays hidden */ }
+
+                // Tools (0107): the same rule — on once the main owner switches
+                // them on (the ZZ pilot, then launch); until then only the main
+                // owner sees the tab, with the switch. Before 0107: hidden.
+                window.currentToolsOn = false;
+                window.currentToolsMainOwner = false;
+                try {
+                    const { data: tl } = await window.sbClient.rpc('tl_status');
+                    window.currentToolsOn = !!(tl && tl.enabled);
+                    window.currentToolsMainOwner = !!(tl && tl.is_main_owner);
+                } catch (_) { /* tab stays hidden */ }
             } catch (e) {
                 console.warn('Could not fetch user role:', e);
                 await auth.signOut();
@@ -2291,12 +2302,14 @@ const PRIMARY_NAV = [
     // Owner + staff. Quantities only — no price, amount or cost anywhere —
     // EXCEPT Purchasing (0097): buyers only (window.currentCanBuy), with prices.
     // Stock (0104) is quantities only, for owner + office staff allowed
-    // Expenses, once switched on (window.currentStockOn).
+    // Expenses, once switched on (window.currentStockOn). Tools (0107): the
+    // same accounts, no money at all, once switched on (window.currentToolsOn).
     { id: 'requests', label: 'Requests', sub: 'Materials & Tools', defaultView: 'reqQueue',
       modules: [
         { view: 'reqQueue',    label: 'Queue',          icon: 'inbox' },
         { view: 'reqPurchasing', label: 'Purchasing',   icon: 'shopping-cart' },
         { view: 'reqStock',    label: 'Stock',          icon: 'warehouse' },
+        { view: 'reqTools',    label: 'Tools',          icon: 'wrench' },
         { view: 'reqBatches',  label: 'Weekly batches', icon: 'calendar-days' },
         { view: 'reqTeams',    label: 'Teams',          icon: 'users' },
         { view: 'reqCatalog',  label: 'Catalogue',      icon: 'package-search' },
@@ -2398,6 +2411,12 @@ function _stockOnly() {
     const focus = _activeFocus();
     return !!((window.currentStockOn || window.currentStockMainOwner) && focus && !focus.includes('requests'));
 }
+// Tools (0107), the same exception and the same accounts (tl_status).
+const _TOOLS_VIEWS = ['reqTools'];
+function _toolsOnly() {
+    const focus = _activeFocus();
+    return !!((window.currentToolsOn || window.currentToolsMainOwner) && focus && !focus.includes('requests'));
+}
 // All views reachable inside the focused module(s) — used by the switchView guard.
 window.focusAllowedViews = function () {
     if (!Array.isArray(currentAllowedModules) || !currentAllowedModules.length) return [];
@@ -2409,6 +2428,7 @@ window.focusAllowedViews = function () {
     });
     if (_purchasingOnly()) _PURCHASING_VIEWS.forEach(v => views.push(v));
     if (_stockOnly()) _STOCK_VIEWS.forEach(v => views.push(v));
+    if (_toolsOnly()) _TOOLS_VIEWS.forEach(v => views.push(v));
     return views;
 };
 // Landing view for the first focused module (e.g. 'pm' → 'pmProjects').
@@ -2460,6 +2480,8 @@ function _visibleNav() {
                 // main owner, who switches it on there. The server refuses
                 // accounts without Expenses.
                 if (!window.currentStockOn && !window.currentStockMainOwner) hidden.push('reqStock');
+                // Tools (0107): the same, with the tools switch.
+                if (!window.currentToolsOn && !window.currentToolsMainOwner) hidden.push('reqTools');
                 if (hidden.length) return { ...p, modules: p.modules.filter(m => !hidden.includes(m.view)) };
             }
             if (p.id === 'construction' && window.currentStockOn) {
@@ -2482,18 +2504,19 @@ function _visibleNav() {
     // list matches nothing (avoids an empty menu).
     // An account allowed to buy whose focus lacks Requests keeps a Requests
     // tab holding Purchasing only (Q3 = B; the server checks every call), and
-    // one allowed to record stock keeps Stock in it (0104) — never the rest
-    // of Requests.
+    // one allowed to record stock keeps Stock in it (0104), and Tools (0107)
+    // — never the rest of Requests.
     const focus = _activeFocus();
     if (focus) {
         const buyOnly = _purchasingOnly();
         const stockOnly = _stockOnly();
-        const extra = (buyOnly ? _PURCHASING_VIEWS : []).concat(stockOnly ? _STOCK_VIEWS : []);
+        const toolsOnly = _toolsOnly();
+        const extra = (buyOnly ? _PURCHASING_VIEWS : []).concat(stockOnly ? _STOCK_VIEWS : [], toolsOnly ? _TOOLS_VIEWS : []);
         const narrowed = nav
             .filter(p => focus.includes(p.id) || (extra.length && p.id === 'requests'))
             .map(p => (extra.length && p.id === 'requests')
-                ? { ...p, sub: buyOnly && stockOnly ? 'Purchasing & Stock' : (buyOnly ? 'Purchasing' : 'Stock'),
-                    defaultView: buyOnly ? 'reqPurchasing' : 'reqStock',
+                ? { ...p, sub: [buyOnly && 'Purchasing', stockOnly && 'Stock', toolsOnly && 'Tools'].filter(Boolean).join(' & '),
+                    defaultView: buyOnly ? 'reqPurchasing' : (stockOnly ? 'reqStock' : 'reqTools'),
                     modules: p.modules.filter(m => extra.includes(m.view)) }
                 : p);
         if (narrowed.length) nav = narrowed;
```

**Modify:** `js/expenses-module.js`

```diff
diff --git a/js/expenses-module.js b/js/expenses-module.js
index 723357b..0656805 100644
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -7535,11 +7535,27 @@ function _folderName(id) {
     const f = expFolders.find(x => x.id === id);
     return (f && f.name) || 'this project';
 }
+// Tools (0107, Q20): completing is never blocked, but the confirm names the
+// tools still out on the project and its Additional Works jobs — they stay
+// in Requests → Tools → Out until returned or handed over.
+async function _toolsOutNote(id) {
+    if (!window.currentToolsOn) return '';
+    let out = [];
+    try {
+        const { data, error } = await window.sbClient.rpc('tl_project_out', { p_folder: id });
+        if (!error && Array.isArray(data)) out = data;
+    } catch (_) { out = []; }
+    if (!out.length) return '';
+    return '\n\n' + out.length + (out.length === 1 ? ' tool is' : ' tools are') + ' still out on this project: '
+        + out.map(t => t.label + ' (' + t.holder_name + ')').join(', ')
+        + '. They stay in Requests → Tools → Out until returned or handed over.';
+}
 async function markFolderComplete(id) {
     if (window.currentUserRole === 'staff') return;
     const ok = await showConfirm(
         'Mark "' + _folderName(id) + '" as complete? It leaves the project selector and moves into the '
-        + 'Completed section. Nothing is deleted, its costs still count, and you can re-open it any time.',
+        + 'Completed section. Nothing is deleted, its costs still count, and you can re-open it any time.'
+        + await _toolsOutNote(id),
         { title: 'Mark as Complete', confirm: 'Mark Complete', tone: 'ok' });
     if (!ok) return;
     try {
```

**Modify:** `js/purchasing-admin-list.js`

```diff
diff --git a/js/purchasing-admin-list.js b/js/purchasing-admin-list.js
index 4b1fed3..3856861 100644
--- a/js/purchasing-admin-list.js
+++ b/js/purchasing-admin-list.js
@@ -50,6 +50,7 @@
         return '<div class="pur-stats">' +
             stat('Needed', l.needed) +
             (Number(l.from_stock) > 0 ? stat('From stock', l.from_stock) : '') +
+            (l._tools && Number(l._tools.filled) > 0 ? stat('Tools issued', l._tools.filled) : '') +
             stat('Bought', l.bought) +
             stat('Still to buy', l.still_to_buy, 'is-key') +
             (Number(l.extra) > 0 ? stat('Extra', l.extra) : '') +
@@ -67,6 +68,7 @@
             '<div class="pur-pcell"><span class="pur-plabel">To buy</span>' +
               '<span class="pur-portion-qty">' + esc(PA.qty(p.quantity - p.pending_reduction)) + ' needed · ' +
               (Number(p.from_stock) > 0 ? esc(PA.qty(p.from_stock)) + ' from stock · ' : '') +
+              (Number(p._tools) > 0 ? esc(PA.qty(p._tools)) + ' tools issued · ' : '') +
               esc(PA.qty(p.bought)) + ' bought · <strong>' + esc(PA.qty(p.still_to_buy)) + ' still to buy</strong></span></div>' +
             '<div class="pur-pcell"><span class="pur-plabel">Buyer</span>' +
               '<span class="pur-portion-who' + (p.buyer_id ? '' : ' is-open') + '">' + esc(who) + '</span></div>' +
@@ -104,6 +106,12 @@
                         ? ' <button type="button" class="att-btn att-btn--sm" data-issue="' + esc(l.line_id) + '">Issue from stock…</button>' : '') +
                       '</div>'
                     : '') +
+                  // 0107 (Q14): each tool issued for this line — one bought for it
+                  // counts through its purchase, once.
+                  (l._tools && l._tools.tools.length
+                    ? '<div class="pur-instock"><i data-lucide="wrench"></i> Issued: ' + l._tools.tools.map(t => '<strong>' + esc(t.label) + '</strong> (' +
+                      esc(t.holder_name) + (t.counted ? '' : ', bought for this') + ')').join(', ') + '</div>'
+                    : '') +
                 '</div>' +
                 figures(l) +
               '</div>' +
@@ -134,6 +142,15 @@
             lines = await RA.rpc('pur_shopping_list', { p_batch: ui.batchId || null, p_folder: ui.folderId || null, p_scope: 'open' });
         } catch (e) { RA.fail(host, e); return; }
         lines = lines || [];
+        // 0107 (Q14): the tools issued for these lines, while tools are on.
+        let tools = {};
+        if (root.currentToolsOn && lines.length) {
+            try { tools = (await RA.rpc('tl_line_tools', { p_lines: lines.map(l => l.line_id) })) || {}; } catch (_) { tools = {}; }
+        }
+        lines.forEach(l => {
+            l._tools = tools[l.line_id] || null;
+            (l.portions || []).forEach(p => { p._tools = l._tools && l._tools.portions ? Number(l._tools.portions[p.id] || 0) : 0; });
+        });
         const projects = [];
         lines.forEach(l => { if (!projects.some(p => p.id === l.project_id)) projects.push({ id: l.project_id, name: l.project_name }); });
         const shown = PA.filterList(lines, { text: ui.text, mineOnly: ui.mine, unassignedOnly: ui.unassigned, urgentOnly: ui.urgent, userId: me.userId });
```

**Create:** `js/tools-admin.js`

```js
// ════════════════════════════════════════════════════════════════════
// Requests → Tools (WorkMate Stage 3a, migration 0107).
//
// Every real tool, numbered TOOL-0001…, and who has it. Four tabs:
//   Tools             — every tool and its state; open one for its history;
//   Out               — tools issued, longest out first, with days held;
//   To register       — purchase lines of tools not registered yet;
//   Waiting for owner — Lost reports and Retire requests the main owner decides.
// Actions: Register tools, and per tool Issue, Hand over, Return (with its
// condition), Repaired, Ask to retire, Report lost, Found. A tool at a
// project always has a named responsible person. Mistakes are reversed
// with a reason (never edited), while they are the tool's latest record.
//
// NO MONEY: no peso amount is read or shown here — a tool's cost stays where
// its purchase put it. Owner and office staff allowed Expenses use it, once
// the main owner switches tools on; every rule is the server's (0107) and
// this file only previews and explains. Each form sends one operation id,
// kept across retries of the same form, so a double press records once.
// Photos go to uploads/tools/<company>/<yyyy-mm>/<uuid>.jpg (owner/staff).
//
// Works in a browser (window.ToolsAdmin) and in Node for
// tests/tools-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    // ── Words ───────────────────────────────────────────────────────

    const STATE_LABEL = {
        available: ['Available', 'done'],
        issued: ['Issued', 'working'],
        repair: ['Under repair', 'abandoned'],
        lost_pending: ['Lost — waiting for the owner', 'abandoned'],
        lost: ['Lost', 'abandoned'],
        retire_pending: ['Retire — waiting for the owner', 'abandoned'],
        retired: ['Retired', 'cancelled'],
        cancelled: ['Cancelled', 'cancelled'],
    };

    const KIND_LABEL = {
        register: 'Registered',
        issue: 'Issued',
        handover: 'Handed over',
        return: 'Returned',
        repaired: 'Repaired',
        lost: 'Reported lost',
        found: 'Found',
        retire: 'Retire request',
    };

    // The server's conditions (tl_condition). Damaged only on a return or when found.
    const CONDITIONS = [
        ['good', 'Good'], ['needs_repair', 'Needs repair'], ['missing_parts', 'Missing parts'], ['damaged', 'Damaged beyond repair'],
    ];
    function conditionLabel(c) {
        const hit = CONDITIONS.find(([k]) => k === c);
        return hit ? hit[1] : (c || '');
    }

    function daysText(n) {
        const d = Number(n);
        if (!isFinite(d) || d <= 0) return 'today';
        return d === 1 ? '1 day' : d + ' days';
    }

    // Where a tool is and who answers for it, in words.
    function whereText(t) {
        if (t.state === 'issued') return t.holder_name + ' · ' + t.folder_name + ' · ' + daysText(t.days) +
            (t.condition && t.condition !== 'good' ? ' · ' + conditionLabel(t.condition) + ' — not usable until repaired' : '');
        if ((t.state === 'lost' || t.state === 'lost_pending') && t.holder_name) return 'Last with ' + t.holder_name + (t.folder_name ? ' · ' + t.folder_name : '');
        if (t.state === 'available') return 'Warehouse';
        if (t.state === 'repair') return 'Warehouse · ' + conditionLabel(t.condition);
        return '';
    }

    // A record in one line.
    function recordText(r) {
        const st = r.status === 'pending' ? ' (waiting for the owner)' : r.status === 'rejected' ? ' (rejected)' : r.status === 'withdrawn' ? ' (withdrawn)' : '';
        switch (r.kind) {
            case 'register': return 'Registered' + (r.holder_name ? ' with ' + r.holder_name + ' · ' + r.folder_name : ' at the warehouse') +
                (r.condition && r.condition !== 'good' ? ' · ' + conditionLabel(r.condition) : '');
            case 'issue': return 'Issued to ' + r.holder_name + ' · ' + r.folder_name;
            case 'handover': return 'Handed over' + (r.from_holder_name ? ' from ' + r.from_holder_name : '') + ' to ' + r.holder_name + ' · ' + r.folder_name;
            case 'return': return 'Returned by ' + r.holder_name + ' · ' + conditionLabel(r.condition);
            case 'repaired': return r.holder_name ? 'Repaired — still with ' + r.holder_name + ' · ' + r.folder_name : 'Repaired — available again';
            case 'lost': return 'Reported lost' + (r.holder_name ? ' (last with ' + r.holder_name + ')' : '') + st;
            case 'found': return 'Found · ' + conditionLabel(r.condition);
            case 'retire': return 'Retire' + st;
            default: return r.kind;
        }
    }

    // What the office may do with a tool in this state (the server's rules).
    function actionsFor(t) {
        switch (t.state) {
            case 'available': return ['issue', 'lost'];
            // Needing repair at its project (rev 3): stays with its person, no handover until repaired.
            case 'issued': return t.condition && t.condition !== 'good' ? ['repaired', 'return', 'lost'] : ['handover', 'return', 'lost'];
            case 'repair': return ['repaired', 'retire', 'lost'];
            case 'lost': return ['found'];
            default: return [];
        }
    }

    // Withdraw (pending: whoever recorded it, or the main owner) or reverse
    // (the tool's latest done record, not a decided loss / retirement:
    // whoever recorded it, or an owner) — tl_reverse's rule.
    function canReverse(r, me) {
        if (r.reversed || r.status === 'rejected' || r.status === 'withdrawn') return false;
        if (r.status === 'pending') return r.recorded_by === me.userId || me.isMainOwner;
        if (r.kind === 'lost' || r.kind === 'retire' || !r.latest) return false;
        return r.recorded_by === me.userId || me.isOwner;
    }

    // tools/<company>/<yyyy-mm>/<uuid>.jpg — month from LOCAL parts (PH,
    // UTC+8), the shape tl_photo accepts.
    function photoPath(ownerId, now, id) {
        if (!ownerId) throw new Error('No company account to file the photo under — sign in again.');
        const d = now || new Date();
        return 'tools/' + String(ownerId).toLowerCase() + '/' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '/' +
            String(id).toLowerCase() + '.jpg';
    }

    // Form checks, as the server's.
    // st: { itemId, count, at ('warehouse' or a folder id), holderId, condition, details,
    //       fromLine (registering from a purchase line), hasPhoto }
    function registerProblems(st) {
        const out = [];
        if (!st.itemId) out.push('BAD_ITEM');
        const n = Number(st.count);
        if (!/^\d+$/.test(String(st.count || '').trim()) || n < 1 || n > 50) out.push('BAD_QUANTITY');
        if (!st.at) out.push('BAD_PROJECT');
        if (!CONDITIONS.some(([k]) => k === st.condition)) out.push('BAD_CONDITION');
        // Damaged beyond repair: at the warehouse, where the owner decides (rev 2).
        if (st.condition === 'damaged' && st.at && st.at !== 'warehouse') out.push('DAMAGED_AT_PROJECT');
        else if (st.at && st.at !== 'warehouse' && !st.holderId) out.push('PERSON_REQUIRED');
        // The opening register keeps a photo of each tool (Q7, rev 2).
        if (!st.fromLine && !st.hasPhoto) out.push('PHOTO_REQUIRED');
        if (String(st.details || '').trim().length > 200) out.push('BAD_NOTE');
        return out;
    }
    // st: { holderId, folderId }
    function issueProblems(st) {
        const out = [];
        if (!st.holderId) out.push('PERSON_REQUIRED');
        if (!st.folderId) out.push('BAD_PROJECT');
        return out;
    }

    // People as options: "Mark (Masons)", "Ana (office)". Anyone active in the company may hold a tool (T1 = C).
    const ROLE_LABEL = { teamLeader: 'team leader', staff: 'office', owner: 'owner' };
    function personLabel(p) {
        return p.name + (p.teams && p.teams.length ? ' (' + p.teams.join(', ') + ')' : ROLE_LABEL[p.role] ? ' (' + ROLE_LABEL[p.role] + ')' : '');
    }

    // Projects to pick: not completed — and the tool's own project, kept even if completed.
    function projectOptions(projects, keepId) {
        return projects.filter(p => !p.completed || p.folder_id === keepId)
            .map(p => ({ value: p.folder_id, label: p.name + (p.completed ? ' (completed)' : '') }));
    }

    // The request lines an issue may fill: a tool line of this project naming
    // this tool's item, or naming none.
    function requestOptions(lines, itemId) {
        return lines.filter(l => Number(l.still_to_buy) > 0 && (!l.catalog_item_id || l.catalog_item_id === itemId))
            .map(l => ({ value: l.line_id, label: l.description + (l.spec ? ' — ' + l.spec : '') + ' · ' + l.requester_name +
                                                 ' · still ' + Number(l.still_to_buy) + ' ' + l.unit }));
    }

    // ── Errors in words ─────────────────────────────────────────────

    const ERRORS = {
        TOOLS_OFF: 'Tools are not switched on yet. The main owner switches them on.',
        NOT_A_TOOL: 'That catalogue item is not a tool. Pick a tool item (Catalogue → Kind: Tool).',
        BAD_ITEM: 'Pick an active tool item.',
        BAD_QUANTITY: 'Register 1 to 50 tools at a time.',
        PERSON_REQUIRED: 'A tool at a project always has a named responsible person. Pick who has it.',
        BAD_PERSON: 'Pick someone active in this company — a worker, team leader, office staff or owner.',
        BAD_PROJECT: 'Pick one of your projects.',
        PROJECT_COMPLETED: 'That project is completed. Pick a project still in progress.',
        BAD_PLACE: 'From this purchase line, tools start at the warehouse — or, for a project purchase, with someone on that project.',
        BAD_CONDITION: 'Pick the tool\'s condition.',
        DAMAGED_AT_PROJECT: 'A tool damaged beyond repair is registered at the warehouse, where the main owner decides whether to retire it.',
        PHOTO_REQUIRED: 'The opening register needs a photo of the tool.',
        BAD_PHOTO: 'That photo could not be used. Choose it again.',
        LINE_IS_STOCK: 'This purchase line was already received as stock. Reverse that first (Requests → Stock), then register its tools.',
        MORE_THAN_BOUGHT: 'That is more tools than this purchase line bought.',
        TOOL_ITEM: 'A tool is not counted as stock — register it here under Tools.',
        TOOL_LINE: 'Tools were registered from this purchase line, so it is never stock.',
        TOOLS_IN_USE: 'Tools were registered from this purchase. Cancel those registrations first, or keep the line and enough quantity.',
        NOT_AVAILABLE: 'Only an Available tool can be issued. Return it, repair it, or wait for the owner\'s decision first.',
        NOT_ISSUED: 'That tool is not issued to anyone right now.',
        NEEDS_REPAIR: 'That tool needs repair first. Mark it Repaired where it is, or have it returned.',
        NOT_IN_REPAIR: 'That tool is not under repair.',
        NOT_LOST: 'That tool is not marked lost.',
        SAME_HOLDER: 'That person already has it, on that project.',
        NOT_A_TOOL_LINE: 'That request line is for a material, not a tool.',
        BAD_REQUEST_LINK: 'That request belongs to another project.',
        ITEM_MISMATCH: 'That request line is for a different tool.',
        UNIT_MISMATCH: 'That request line uses another unit.',
        LINE_CLOSED: 'That request line was cancelled.',
        REQUEST_EXCEEDED: 'That request line is already filled. Issue the tool without a request.',
        LATER_RECORDS: 'Something happened to this tool after that record. Reverse the later records first.',
        NOT_YOURS: 'Only the person who recorded this, or an owner, can do that.',
        OWNER_ONLY: 'Only the main owner can do that.',
        NOT_ALLOWED: 'Only the main owner can do that.',
        NOT_OFFICE: 'Only owner and office accounts can record tools.',
        BAD_STATE: 'This was already decided, withdrawn or reversed. Reload the page.',
        REASON_REQUIRED: 'Please give a reason.',
        BAD_NOTE: 'That note is too long.',
        NOT_FOUND: 'That was not found. Reload the page.',
        BAD_OP: 'Something went wrong. Close the form and try again.',
        OP_CANCELLED: 'This was cancelled — nothing was recorded. Try again.',
        BAD_SWITCH: 'Something went wrong. Reload the page.',
        ITEM_IN_USE: 'That catalogue item is used by tools, requests or stock, so its kind and unit cannot change.',
        PGRST202: 'Tools are not installed on the server yet.',
    };
    const HINTED = ['MORE_THAN_BOUGHT', 'TOOLS_IN_USE'];

    function errorMessage(error) {
        const text = String((error && (error.message || error.code || error.error_description)) || (typeof error === 'string' ? error : '') || '');
        if (error && error.code === 'PGRST202') return ERRORS.PGRST202;
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) {
                return ERRORS[code] + (HINTED.includes(code) && error && error.hint ? ' (' + error.hint + ')' : '');
            }
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    const pure = { STATE_LABEL, KIND_LABEL, CONDITIONS, conditionLabel, daysText, whereText, recordText, actionsFor, canReverse,
                   photoPath, registerProblems, issueProblems, personLabel, projectOptions, requestOptions, ERRORS, errorMessage };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser ─────────────────────────────────────────────────────

    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const ui = { tab: 'tools', toolId: null };
    let cache = { choices: null, status: null };

    const newOp = () => (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

    // Who is looking, from the server (tl_status).
    function me() {
        const s = cache.status || {};
        return { userId: s.user_id, isOwner: !!s.is_owner, isMainOwner: !!s.is_main_owner, canRecord: !!s.can_record };
    }

    function pill(text, tone) { return '<span class="att-pill att-pill--' + tone + '">' + esc(text) + '</span>'; }
    function statePill(state) { const s = STATE_LABEL[state] || [state, 'cancelled']; return pill(s[0], s[1]); }

    function notice(error, title) {
        const plain = typeof error === 'string' && !/^[A-Z][A-Z_]+$/.test(error);
        RA.modal({ title: title || 'Not done', body: '<p>' + esc(plain ? error : errorMessage(error)) + '</p>', submitLabel: 'OK', onSubmit: () => {} });
    }

    async function choices() {
        if (!cache.choices) cache.choices = await RA.rpc('tl_choices');
        return cache.choices;
    }

    function options(list, selected, blank) {
        return (blank ? '<option value="">' + esc(blank) + '</option>' : '') +
            list.map(o => '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
    }
    function peopleOptions(people, selected) {
        return options(people.map(p => ({ value: p.id, label: personLabel(p) })), selected, 'Who has it…');
    }
    function conditionOptions(allowDamaged, selected) {
        return CONDITIONS.filter(([k]) => allowDamaged || k !== 'damaged')
            .map(([k, l]) => '<option value="' + k + '"' + (k === (selected || 'good') ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
    }

    // A form that sends one operation id however many times it is submitted.
    function sendOnce(fn) {
        const opId = newOp();
        return (...args) => fn(opId, ...args);
    }

    // The photo a form picked, uploaded once (kept across retries of the form).
    function photoOnce() {
        let done = null;
        return async (file) => {
            if (!file) return null;
            if (done && done.file === file) return done.path;
            const blob = await root.DacsReceipts.compressToBlob(file);
            const path = photoPath(root.currentDataUserId, new Date(), newOp());
            const { error } = await root.sbClient.storage.from('uploads').upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
            if (error) throw new Error('Couldn\'t upload the photo: ' + (error.message || error));
            done = { file, path };
            return path;
        };
    }
    const photoField = '<label class="att-label">Photo (optional)<input class="att-input" type="file" name="photo" accept="image/*"></label>';

    // ── Forms ───────────────────────────────────────────────────────

    // Register tools. preset: { line } — a purchase line from "To register".
    async function openRegister(preset, onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const line = preset && preset.line;
        const send = sendOnce((opId, body) => RA.rpc('tl_register', { p_op: opId, p_body: body }));
        const upload = photoOnce();
        const left = line ? Math.max(0, Math.floor(Number(line.quantity)) - Number(line.registered)) : 1;
        const places = line && line.destination === 'warehouse' ? [{ value: 'warehouse', label: 'Warehouse' }]
            : [{ value: 'warehouse', label: 'Warehouse' }].concat(projectOptions(ch.projects)
                .filter(p => !line || p.value === line.folder_id).map(p => ({ value: p.value, label: 'With someone at ' + p.label })));
        RA.modal({
            title: 'Register tools',
            sub: line ? 'From ' + line.item_name + ' · ' + Number(line.quantity) + ' ' + line.unit + ' bought ' + RA.formatDay(line.purchase_date) +
                        ' · ' + line.registered + ' registered. Its cost stays where the purchase put it.'
                      : 'Tools the company already owns, or bought before. Each one gets its own number (TOOL-0001…).',
            body: '<div class="stk-form">' +
                '<label class="att-label">Tool<select class="att-input" name="item"><option value="">Pick a tool…</option>' +
                  ch.items.map(i => '<option value="' + esc(i.item_id) + '"' + (line && line.suggested_item_id === i.item_id ? ' selected' : '') + '>' +
                    esc(i.name + (i.spec ? ' — ' + i.spec : '')) + '</option>').join('') + '</select></label>' +
                '<div class="stk-grid2">' +
                  '<label class="att-label">How many<input class="att-input" name="count" inputmode="numeric" value="' + esc(String(left || 1)) + '"></label>' +
                  '<label class="att-label">Condition<select class="att-input" name="condition">' + conditionOptions(true) + '</select></label>' +
                '</div>' +
                '<label class="att-label">Where is it now<select class="att-input" name="at">' + options(places, 'warehouse') + '</select></label>' +
                '<label class="att-label" data-person hidden>Responsible person<select class="att-input" name="holder">' + peopleOptions(ch.people, null) + '</select></label>' +
                '<p class="req-muted" data-cond-note></p>' +
                '<label class="att-label">Brand / model / serial (optional)<input class="att-input" name="details" maxlength="200"></label>' +
                (line ? photoField
                      : '<label class="att-label">Photo of the tool<input class="att-input" type="file" name="photo" accept="image/*"></label>' +
                        '<p class="req-muted">Needed for the opening register. Several identical tools registered together share it.</p>') +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Register',
            errorMessage,
            onOpen: (form) => {
                const n = form.querySelector('[data-cond-note]');
                const sync = () => {
                    form.querySelector('[data-person]').hidden = form.at.value === 'warehouse';
                    n.textContent = form.condition.value === 'damaged' ? 'At the warehouse, under repair — and the main owner is asked to retire it.'
                        : form.condition.value === 'good' ? '' : 'Under repair until you mark it Repaired (at the warehouse).';
                };
                form.at.addEventListener('change', sync);
                form.condition.addEventListener('change', sync);
                sync();
            },
            onSubmit: async (form) => {
                const st = { itemId: form.item.value, count: form.count.value, at: form.at.value,
                             holderId: form.at.value === 'warehouse' ? '' : form.holder.value, condition: form.condition.value, details: form.details.value,
                             fromLine: !!line, hasPhoto: !!form.photo.files[0] };
                const problems = registerProblems(st);
                if (problems.length) throw new Error(problems[0]);
                const body = { item_id: st.itemId, count: String(Number(st.count)), at: st.at, holder_id: st.holderId || null,
                               condition: st.condition, details: st.details.trim(), note: form.note.value.trim(),
                               photo_path: await upload(form.photo.files[0]) };
                if (line) { body.purchase_id = line.purchase_id; body.line_no = String(line.line_no); }
                await send(body);
            },
            onDone,
        });
    }

    async function openIssue(t, onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, body) => RA.rpc('tl_issue', { p_op: opId, p_body: body }));
        const upload = photoOnce();
        let lines = [];
        RA.modal({
            title: 'Issue ' + t.label,
            sub: t.item_name + (t.details ? ' · ' + t.details : '') + '. The person named answers for it until it is returned or handed over.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Responsible person<select class="att-input" name="holder">' + peopleOptions(ch.people, null) + '</select></label>' +
                '<label class="att-label">Project<select class="att-input" name="folder">' + options(projectOptions(ch.projects), null, 'Pick a project…') + '</select></label>' +
                '<label class="att-label">Fills a request (optional)<select class="att-input" name="line"><option value="">No request</option></select></label>' +
                '<p class="req-muted" data-line-note></p>' +
                photoField +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Issue',
            errorMessage,
            onOpen: (form) => {
                const note = form.querySelector('[data-line-note]');
                form.folder.addEventListener('change', async () => {
                    lines = [];
                    note.textContent = '';
                    if (form.folder.value) {
                        try { lines = await RA.rpc('tl_request_lines', { p_folder: form.folder.value }); } catch (e) { note.textContent = errorMessage(e); }
                    }
                    form.line.innerHTML = options(requestOptions(lines, t.item_id), null, 'No request');
                });
            },
            onSubmit: async (form) => {
                const problems = issueProblems({ holderId: form.holder.value, folderId: form.folder.value });
                if (problems.length) throw new Error(problems[0]);
                await send({ tool_id: t.id, holder_id: form.holder.value, folder_id: form.folder.value, request_line_id: form.line.value || null,
                             note: form.note.value.trim(), photo_path: await upload(form.photo.files[0]) });
            },
            onDone,
        });
    }

    async function openHandover(t, onDone) {
        let ch;
        try { ch = await choices(); } catch (e) { return notice(e); }
        const send = sendOnce((opId, body) => RA.rpc('tl_handover', { p_op: opId, p_body: body }));
        RA.modal({
            title: 'Hand over ' + t.label,
            sub: 'Now with ' + t.holder_name + ' · ' + t.folder_name + '. Straight to the next person — no trip back to the warehouse.',
            body: '<div class="stk-form">' +
                '<label class="att-label">To<select class="att-input" name="holder">' +
                  peopleOptions(ch.people.filter(p => p.id !== t.holder_id), null) + '</select></label>' +
                '<label class="att-label">Project<select class="att-input" name="folder">' + options(projectOptions(ch.projects, t.folder_id), t.folder_id) + '</select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Hand over',
            errorMessage,
            onSubmit: async (form) => {
                const problems = issueProblems({ holderId: form.holder.value, folderId: form.folder.value });
                if (problems.length) throw new Error(problems[0]);
                await send({ tool_id: t.id, holder_id: form.holder.value, folder_id: form.folder.value, note: form.note.value.trim() });
            },
            onDone,
        });
    }

    function openReturn(t, onDone) {
        const send = sendOnce((opId, body) => RA.rpc('tl_return', { p_op: opId, p_body: body }));
        const upload = photoOnce();
        RA.modal({
            title: 'Return ' + t.label,
            sub: 'From ' + t.holder_name + ' · ' + t.folder_name + '. A tool that is not in good condition cannot be issued until it is repaired.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Condition<select class="att-input" name="condition">' + conditionOptions(true) + '</select></label>' +
                '<p class="req-muted" data-cond-note></p>' +
                photoField +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Return',
            errorMessage,
            onOpen: (form) => {
                const n = form.querySelector('[data-cond-note]');
                const sync = () => {
                    n.textContent = form.condition.value === 'good' ? 'Back to the warehouse, available.'
                        : form.condition.value === 'damaged' ? 'Under repair, and the main owner is asked to retire it.'
                        : 'Under repair until you mark it Repaired.';
                };
                form.condition.addEventListener('change', sync);
                sync();
            },
            onSubmit: async (form) => {
                await send({ tool_id: t.id, condition: form.condition.value, note: form.note.value.trim(), photo_path: await upload(form.photo.files[0]) });
            },
            onDone,
        });
    }

    function openFound(t, onDone) {
        const send = sendOnce((opId, body) => RA.rpc('tl_found', { p_op: opId, p_body: body }));
        RA.modal({
            title: 'Found ' + t.label,
            sub: 'It comes back to the warehouse: available if good, otherwise under repair.',
            body: '<div class="stk-form">' +
                '<label class="att-label">Condition<select class="att-input" name="condition">' + conditionOptions(true) + '</select></label>' +
                '<label class="att-label">Note (optional)<input class="att-input" name="note" maxlength="300"></label></div>',
            submitLabel: 'Found',
            errorMessage,
            onSubmit: async (form) => { await send({ tool_id: t.id, condition: form.condition.value, note: form.note.value.trim() }); },
            onDone,
        });
    }

    // Repaired (note), Ask to retire (reason) or Report lost (reason).
    function openSimple(t, act, onDone) {
        const cfg = {
            repaired: ['Repaired', t.state === 'issued' ? 'It stays with ' + t.holder_name + ' · ' + t.folder_name + ', now in good condition — it can be handed over.'
                                                        : 'It is available again, in good condition.', 'Note (optional)', false,
                       (op, text) => RA.rpc('tl_repaired', { p_op: op, p_tool: t.id, p_note: text })],
            retire: ['Ask to retire ' + t.label, 'The main owner decides. Until then it cannot be issued.', 'Reason', true,
                     (op, text) => RA.rpc('tl_request_retire', { p_op: op, p_tool: t.id, p_reason: text })],
            lost: ['Report ' + t.label + ' lost', (t.holder_name ? 'Last with ' + t.holder_name + '. ' : '') +
                       'The main owner decides; until then it cannot be issued, handed over or returned.', 'What happened', true,
                   (op, text) => RA.rpc('tl_report_lost', { p_op: op, p_tool: t.id, p_reason: text })],
        }[act];
        const send = sendOnce(cfg[4]);
        RA.modal({
            title: cfg[0], sub: cfg[1], warn: act !== 'repaired',
            body: '<div class="stk-form"><label class="att-label">' + cfg[2] + '<input class="att-input" name="text" maxlength="500"></label></div>',
            submitLabel: act === 'repaired' ? 'Repaired' : 'Send to the owner',
            errorMessage,
            onSubmit: async (form) => {
                if (cfg[3] && !form.text.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.text.value.trim());
            },
            onDone,
        });
    }

    function openReverse(r, onDone) {
        const pending = r.status === 'pending';
        const send = sendOnce((opId, reason) => RA.rpc('tl_reverse', { p_op: opId, p_record: r.id, p_reason: reason }));
        RA.modal({
            title: pending ? 'Withdraw' : 'Reverse',
            sub: r.label + ': ' + recordText(r) + (pending ? '. The tool goes back to where it was.'
                : r.kind === 'register' ? '. The tool is cancelled; its number is never used again.'
                : '. The record stays, marked reversed; the tool goes back to where it was before it.'),
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Reason<input class="att-input" name="reason" maxlength="500"></label></div>',
            submitLabel: pending ? 'Withdraw' : 'Reverse',
            errorMessage,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.reason.value.trim());
            },
            onDone,
        });
    }

    function openDecide(r, approve, onDone) {
        const send = sendOnce((opId, note) => RA.rpc('tl_decide', { p_op: opId, p_record: r.id, p_approve: approve, p_note: note }));
        const outcome = r.kind === 'lost'
            ? (approve ? 'It is marked lost; who had it stays recorded. If it turns up, record Found.' : 'It goes back exactly where it was before the report.')
            : (approve ? 'It is retired for good; its number is never used again.' : 'It stays under repair — repair it, or ask again.');
        RA.modal({
            title: (approve ? 'Confirm' : 'Reject') + ' — ' + r.label,
            sub: recordText(r) + (r.note ? ' · ' + r.note : '') + '. ' + outcome,
            warn: !approve,
            body: '<div class="stk-form"><label class="att-label">' + (approve ? 'Note (optional)' : 'Reason') + '<input class="att-input" name="note" maxlength="500"></label></div>',
            submitLabel: approve ? 'Confirm' : 'Reject',
            errorMessage,
            onSubmit: async (form) => {
                if (!approve && !form.note.value.trim()) throw new Error('REASON_REQUIRED');
                await send(form.note.value.trim());
            },
            onDone,
        });
    }

    // ── Screens ─────────────────────────────────────────────────────

    function tabs(ov) {
        const n = (x) => x && x.length ? ' (' + x.length + ')' : '';
        const t = (id, label) => '<button type="button" class="att-seg-btn' + (ui.tab === id ? ' is-on' : '') + '" data-tab="' + id + '">' + label + '</button>';
        return '<div class="att-seg" role="tablist" aria-label="Tools">' +
            t('tools', 'Tools') + t('out', 'Out' + n(ov && ov.out)) + t('register', 'To register' + n(ov && ov.to_register)) +
            t('pending', 'Waiting for owner' + n(ov && ov.pending)) + '</div>';
    }

    function toolCard(t) {
        return '<div class="att-card stk-item tl-tool" data-tool="' + esc(t.id) + '"><div class="att-card-body">' +
            '<div class="stk-item-head"><strong>' + esc(t.label) + '</strong> ' + esc(t.item_name) +
              (t.details ? ' <span class="req-muted">' + esc(t.details) + '</span>' : '') +
              '<span class="tl-state">' + statePill(t.state) + '</span></div>' +
            (whereText(t) ? '<div class="stk-places">' + esc(whereText(t)) + '</div>' : '') +
            '</div></div>';
    }

    function outRow(t) {
        const broken = t.condition && t.condition !== 'good';
        return '<div class="stk-rec" data-tool-row="' + esc(t.id) + '">' +
            '<div class="stk-rec-main"><strong>' + esc(t.label) + '</strong> ' + esc(t.item_name) +
              (broken ? ' ' + pill(conditionLabel(t.condition) + ' — not usable', 'abandoned') : '') +
              '<div>' + esc(t.holder_name) + ' · ' + esc(t.folder_name) + '</div>' +
              '<div class="req-muted">Out ' + esc(daysText(t.days)) + '</div></div>' +
            '<div class="stk-rec-acts">' +
              (broken ? '<button type="button" class="att-btn att-btn--sm" data-out-act="repaired">Repaired…</button>'
                      : '<button type="button" class="att-btn att-btn--sm" data-out-act="handover">Hand over…</button>') +
              '<button type="button" class="att-btn att-btn--sm" data-out-act="return">Return…</button></div></div>';
    }

    function lineCard(l) {
        return '<div class="att-card stk-line"><div class="att-card-body">' +
            '<div><strong>' + esc(l.item_name) + '</strong> · ' + esc(String(Number(l.quantity))) + ' ' + esc(l.unit) +
              ' <span class="req-muted">bought ' + esc(RA.formatDay(l.purchase_date)) +
              (l.destination === 'warehouse' ? ' for the warehouse' : ' for ' + esc(l.folder_name || 'a project')) + '</span></div>' +
            '<div class="req-muted">Registered ' + esc(String(l.registered)) + ' of ' + esc(String(Math.floor(Number(l.quantity)))) + '</div>' +
            '<div class="stk-line-acts" data-line="' + esc(l.purchase_id + ':' + l.line_no) + '">' +
              '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-line-act="register">Register…</button></div>' +
            '</div></div>';
    }

    function recordRow(r, m) {
        return '<div class="stk-rec' + (r.reversed ? ' is-reversed' : '') + '" data-record="' + esc(r.id) + '">' +
            '<div class="stk-rec-main"><strong>' + esc(r.label ? r.label + ' · ' : '') + esc(KIND_LABEL[r.kind] || r.kind) + '</strong>' +
              (r.status === 'pending' ? ' ' + pill('Waiting for the owner', 'abandoned') : r.status === 'rejected' ? ' ' + pill('Rejected', 'cancelled')
                : r.status === 'withdrawn' ? ' ' + pill('Withdrawn', 'cancelled') : r.reversed ? ' ' + pill('Reversed', 'cancelled') : '') +
              '<div>' + esc(recordText(r)) + '</div>' +
              (r.request_description ? '<div class="req-muted">Request: ' + esc(r.request_description) +
                (r.fills_request ? '' : ' (bought for it — counted through its purchase)') + '</div>' : '') +
              (r.note ? '<div class="req-muted">Note: ' + esc(r.note) + '</div>' : '') +
              (r.photo_path ? '<img class="tl-photo" alt="Photo" data-sign-bucket="uploads" data-sign-path="' + esc(r.photo_path) + '">' : '') +
              '<div class="req-muted">' + esc(r.recorded_by_name) + ' · ' + esc(RA.cutoffLabel(r.recorded_at)) +
                (r.decided_by_name ? ' · ' + esc(r.status === 'rejected' ? 'rejected' : r.status === 'withdrawn' ? 'withdrawn' : 'confirmed') + ' by ' +
                  esc(r.decided_by_name) + (r.decision_note ? ': ' + esc(r.decision_note) : '') : '') +
                (r.reversed ? ' · reversed by ' + esc(r.reversed_by_name) + ': ' + esc(r.reverse_reason) : '') + '</div>' +
            '</div>' +
            '<div class="stk-rec-acts">' +
              (r.status === 'pending' && m.isMainOwner ? '<button type="button" class="att-btn att-btn--sm att-btn--primary" data-rec-act="confirm">Confirm</button>' +
                '<button type="button" class="att-btn att-btn--sm" data-rec-act="reject">Reject</button>' : '') +
              (canReverse(r, m) ? '<button type="button" class="att-btn att-btn--sm" data-rec-act="reverse">' + (r.status === 'pending' ? 'Withdraw' : 'Reverse') + '</button>' : '') +
            '</div></div>';
    }

    function wireRecords(scope, records, reload) {
        scope.querySelectorAll('[data-rec-act]').forEach(b => b.addEventListener('click', () => {
            const r = records.find(x => x.id === b.closest('[data-record]').dataset.record);
            if (!r) return;
            if (b.dataset.recAct === 'confirm') return openDecide(r, true, reload);
            if (b.dataset.recAct === 'reject') return openDecide(r, false, reload);
            return openReverse(r, reload);
        }));
    }

    const ACTION_LABEL = { issue: 'Issue…', handover: 'Hand over…', return: 'Return…', repaired: 'Repaired…', retire: 'Ask to retire…',
                           lost: 'Report lost…', found: 'Found…' };
    function runAction(act, t, reload) {
        if (act === 'issue') return openIssue(t, reload);
        if (act === 'handover') return openHandover(t, reload);
        if (act === 'return') return openReturn(t, reload);
        if (act === 'found') return openFound(t, reload);
        return openSimple(t, act, reload);
    }

    async function renderTool(body, toolId, reload) {
        body.innerHTML = '<div class="att-empty">Loading…</div>';
        let t;
        try { t = await RA.rpc('tl_tool', { p_tool: toolId }); } catch (e) { RA.fail(body, e); return; }
        const m = me();
        body.innerHTML =
            '<button type="button" class="att-btn att-btn--sm" data-back>← All tools</button>' +
            '<h3 class="stk-h">' + esc(t.label) + ' · ' + esc(t.item_name) + ' ' + statePill(t.state) + '</h3>' +
            (t.photo_path ? '<img class="tl-photo tl-photo--lg" alt="' + esc(t.label) + '" data-sign-bucket="uploads" data-sign-path="' + esc(t.photo_path) + '">' : '') +
            '<div class="req-muted">' + esc([t.details, whereText(t), t.purchase_id ? 'Bought ' + RA.formatDay(t.purchase_date) : 'Opening register'].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="stk-actions" style="margin-top:12px">' + actionsFor(t).map((a, i) =>
              '<button type="button" class="att-btn att-btn--sm' + (i === 0 ? ' att-btn--primary' : '') + '" data-tool-act="' + a + '">' + ACTION_LABEL[a] + '</button>').join('') + '</div>' +
            '<h3 class="stk-h">History</h3>' +
            '<div class="stk-recs">' + (t.records.map(r => recordRow(Object.assign({ label: '' }, r), m)).join('') || '<div class="att-empty">Nothing yet.</div>') + '</div>';
        body.querySelector('[data-back]').addEventListener('click', () => { ui.toolId = null; reload(); });
        body.querySelectorAll('[data-tool-act]').forEach(b => b.addEventListener('click', () => runAction(b.dataset.toolAct, t, reload)));
        wireRecords(body, t.records.map(r => Object.assign({ label: t.label }, r)), reload);
        RA.signImages(body);
    }

    async function render(host) {
        host.innerHTML = '<div class="att-stack stk-tab req-detail"><div class="att-empty">Loading…</div></div>';
        let status;
        try { status = await RA.rpc('tl_status'); } catch (e) { RA.fail(host, e); return; }
        cache.status = status;
        if (!status || !status.enabled) return renderOff(host, status);
        const reload = () => render(host);
        cache.choices = null;
        let ov = null;
        if (!(ui.tab === 'tools' && ui.toolId)) {
            try { ov = await RA.rpc('tl_overview'); } catch (e) { RA.fail(host, e); return; }
        }
        host.innerHTML =
            '<div class="att-stack stk-tab req-detail">' +
              RA.head('Tools', 'Every tool by number, and who answers for it. No prices here — a tool\'s cost stays with its purchase.', tabs(ov)) +
              '<div class="stk-actions"><button type="button" class="att-btn att-btn--primary" data-register><i data-lucide="plus"></i> Register tools</button></div>' +
              '<div data-body></div>' +
              (status.is_main_owner ? '<div class="stk-switch-off"><button type="button" class="att-btn att-btn--sm att-btn--ghost" data-switch-off>Switch tools off…</button></div>' : '') +
            '</div>';
        host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            if (ui.tab === b.dataset.tab && !ui.toolId) return;
            ui.tab = b.dataset.tab; ui.toolId = null;
            render(host);
        }));
        host.querySelector('[data-register]').addEventListener('click', () => openRegister(null, reload));
        const off = host.querySelector('[data-switch-off]');
        if (off) off.addEventListener('click', () => openSwitchOff());
        const body = host.querySelector('[data-body]');
        const m = me();
        if (ui.tab === 'tools' && ui.toolId) { await renderTool(body, ui.toolId, reload); RA.icons(); return; }
        const openTool = (id) => { ui.tab = 'tools'; ui.toolId = id; render(host); };
        if (ui.tab === 'out') {
            body.innerHTML = ov.out.length ? '<div class="stk-recs">' + ov.out.map(outRow).join('') + '</div>'
                : '<div class="att-empty">No tool is out.</div>';
            body.querySelectorAll('[data-out-act]').forEach(b => b.addEventListener('click', () => {
                const t = ov.out.find(x => x.id === b.closest('[data-tool-row]').dataset.toolRow);
                if (t) runAction(b.dataset.outAct, t, reload);
            }));
        } else if (ui.tab === 'register') {
            body.innerHTML = ov.to_register.length ? ov.to_register.map(lineCard).join('')
                : '<div class="att-empty">No purchase of tools is waiting to be registered.</div>';
            body.querySelectorAll('[data-line-act]').forEach(b => b.addEventListener('click', () => {
                const key = b.closest('[data-line]').dataset.line;
                const l = ov.to_register.find(x => x.purchase_id + ':' + x.line_no === key);
                if (l) openRegister({ line: l }, reload);
            }));
        } else if (ui.tab === 'pending') {
            body.innerHTML = (ov.pending.length ? '<div class="stk-recs">' + ov.pending.map(r => recordRow(r, m)).join('') + '</div>'
                : '<div class="att-empty">Nothing is waiting for the owner.</div>') +
                (m.isMainOwner ? '' : '<p class="req-muted">Only the main owner confirms or rejects a Lost report or a Retire request.</p>');
            wireRecords(body, ov.pending, reload);
            RA.signImages(body);
        } else {
            body.innerHTML = ov.tools.length ? ov.tools.map(toolCard).join('')
                : '<div class="att-empty">No tools yet. Register the tools the company owns, or a purchase of tools.</div>';
            body.querySelectorAll('[data-tool]').forEach(c => c.addEventListener('click', () => openTool(c.dataset.tool)));
        }
        RA.icons();
    }

    // Switch tools off again: the ZZ pilot failed. Records stay; nothing is undone.
    function openSwitchOff() {
        return RA.modal({
            title: 'Switch tools off',
            sub: 'Type OFF to confirm. Only if the pilot failed.',
            warn: true,
            body: '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
                'Every tool and record stays as it is — nothing is undone or deleted. Recording stops, and the Tools tab goes for everyone but you.</div></div>' +
                '<div class="stk-form"><label class="att-label">Type OFF<input class="att-input" name="word" autocomplete="off"></label></div>',
            submitLabel: 'Switch off',
            errorMessage,
            onSubmit: async (form) => {
                if (form.word.value.trim() !== 'OFF') throw new Error('Type OFF to confirm.');
                await RA.rpc('tl_set_enabled', { p_on: false });
                root.currentToolsOn = false;
            },
            onDone: () => root.location.reload(),
        });
    }

    // Until switched on: nobody sees the tab except the main owner, who sees the switch.
    function renderOff(host, status) {
        if (!status || !status.is_main_owner) {
            host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="lock"></i><div>' +
                esc(ERRORS.TOOLS_OFF) + '</div></div></div>';
            RA.icons();
            return;
        }
        host.innerHTML =
            '<div class="att-stack stk-tab">' +
              RA.head('Tools', 'Not switched on yet.', '') +
              '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
                'Switch tools on for the <strong>ZZ pilot</strong>, then keep them on (launch) — or switch them off again if the pilot fails. ' +
                'Once on, the office registers tools and records who has each one here.</div></div>' +
              '<button type="button" class="att-btn att-btn--warn" data-switch>Switch tools on…</button>' +
            '</div>';
        host.querySelector('[data-switch]').addEventListener('click', () => RA.modal({
            title: 'Switch tools on',
            sub: 'Type TOOLS to confirm.',
            warn: true,
            body: '<div class="stk-form"><label class="att-label">Type TOOLS<input class="att-input" name="word" autocomplete="off"></label></div>',
            submitLabel: 'Switch on',
            errorMessage,
            onSubmit: async (form) => {
                if (form.word.value.trim() !== 'TOOLS') throw new Error('Type TOOLS to confirm.');
                await RA.rpc('tl_set_enabled', { p_on: true });
                root.currentToolsOn = true;
            },
            onDone: () => root.location.reload(),
        }));
        RA.icons();
    }

    root.ToolsAdmin = Object.assign({}, pure, { render });
    RA.views.reqTools = render;
})(typeof window !== 'undefined' ? window : globalThis);
```

**Modify:** `tests/purchasing-admin.test.js`

```diff
diff --git a/tests/purchasing-admin.test.js b/tests/purchasing-admin.test.js
index 670332a..d81db77 100644
--- a/tests/purchasing-admin.test.js
+++ b/tests/purchasing-admin.test.js
@@ -152,7 +152,9 @@ test('the screens call only purchasing RPCs and write no table directly', () =>
     'pur_cash_give', 'pur_cash_dispute', 'pur_cash_clear_dispute', 'pur_cash_void_issue', 'pur_cash_report_return',
     'pur_cash_withdraw_return', 'pur_cash_decide_return', 'pur_cash_void_return', 'pur_cash_count', 'pur_cash_void_count',
     'pur_set_own_money', 'pur_repay_buyer', 'pur_void_repayment', 'pur_purchase_payments', 'pur_credits', 'pur_my_cash',
-    'pur_cash_tracker', 'pur_cash_buyer', 'pur_overpaid', 'pur_cash_report']);
+    'pur_cash_tracker', 'pur_cash_buyer', 'pur_overpaid', 'pur_cash_report',
+    // 3a (0107): the tools issued for shopping-list lines — names and numbers, no money; empty while tools are off.
+    'tl_line_tools']);
   for (const f of ['purchasing-admin-core', 'purchasing-admin-list', 'purchasing-admin-record', 'purchasing-admin-purchases',
                    'purchasing-admin-pay', 'purchasing-admin-cash']) {
     const src = read('js/' + f + '.js');
```

**Modify:** `tests/stock-admin.test.js`

```diff
diff --git a/tests/stock-admin.test.js b/tests/stock-admin.test.js
index e799bdd..8140c4b 100644
--- a/tests/stock-admin.test.js
+++ b/tests/stock-admin.test.js
@@ -202,7 +202,7 @@ test('Requests → Stock: in the nav, the view list and the page; hidden until s
   ok(/if \(!window\.currentStockOn && !window\.currentStockMainOwner\) hidden\.push\('reqStock'\);/.test(admin), 'hidden until on');
   ok(/const \{ data: stk \} = await window\.sbClient\.rpc\('stk_status'\);/.test(admin), 'the server says (before 0104: hidden)');
   ok(/window\.currentStockOn = !!\(stk && stk\.enabled\);/.test(admin) && /window\.currentStockMainOwner = !!\(stk && stk\.is_main_owner\);/.test(admin));
-  ok(/const REQ_VIEWS\s+= \[[^\]]*'reqStock'\]/.test(html), 'REQ_VIEWS');
+  ok(/const REQ_VIEWS\s+= \[[^\]]*'reqStock'[^\]]*\]/.test(html), 'REQ_VIEWS');
   ok(/<div id="reqStockView"\s+class="content-view" style="display: none;"><\/div>/.test(html), 'the page');
   ok(/reqStock:\s+'Stock',/.test(html), 'the title');
   const core = html.indexOf('js/requests-admin-core.js'), stock = html.indexOf('<script src="js/stock-admin.js?v=');
```

**Modify:** `tests/storage-access.test.js`

```diff
diff --git a/tests/storage-access.test.js b/tests/storage-access.test.js
index 05b57ca..ef3b361 100644
--- a/tests/storage-access.test.js
+++ b/tests/storage-access.test.js
@@ -76,6 +76,8 @@ const FOLDERS = {
   purchases: 'buyer',
   // 0102 (R13): a petty-cash return photo — the main owner and the buyer who uploaded it.
   pettyCash: 'pettyCash',
+  // 0107 (3a): tool photos — the office only (owner / staff), the generic rule.
+  tools: 'admin',
 };
 const OWNER_ONLY_SQL = "('quotations', 'reimbursementReceipts')";
 const CLIENT_PROJECT_SQL = "('weeklyBillReceipts', 'procurementReceipts', 'accomplishmentReports', 'projectTerms')";
```

**Create:** `tests/tools-admin.test.js`

```js
// ════════════════════════════════════════════════════════════════════
// TOOLS SCREENS (0107, 3a):  run with  node tests/tools-admin.test.js
//
// Zero dependencies. Loads the REAL js/tools-admin.js (its pure half) and
// reads the screens' source:
//   1. The words and checks agree with the server: every refusal has a
//      sentence, every state and record kind a label, the forms refuse what
//      the server would refuse, a photo path is one the server accepts.
//   2. No money: the screens read no table and show no peso amount.
//   3. Wiring: Requests → Tools is hidden until tools are switched on (the
//      main owner sees the switch); Mark as Complete names the tools still
//      out; the shopping list shows tools issued; every write is sent once.
// ════════════════════════════════════════════════════════════════════
'use strict';
const ta = require('../js/tools-admin.js');
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const SQL = read('supabase/migrations/0107_tools.sql');
const JS = read('js/tools-admin.js');
const BROWSER = JS.slice(JS.indexOf('// ── Browser'));

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(c, m) { if (!c) throw new Error(m); }
function eq(a, b, label) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((label || '') + ' expected ' + y + ', got ' + x);
}
const ME = { userId: 'u1', isOwner: false, isMainOwner: false, canRecord: true };
const OWNER = { userId: 'o1', isOwner: true, isMainOwner: true, canRecord: true };

console.log('\ntools: the words agree with the server');

test('every refusal 0107 can send has a sentence (and the helpers\' it reaches)', () => {
  const codes = [...new Set([...SQL.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))]
    .filter(c => c !== 'HISTORY_IMMUTABLE');               // a trigger on direct table writes, never an RPC answer
  ok(codes.length >= 30, 'codes read: ' + codes.length);
  for (const c of codes) ok(ta.ERRORS[c], c + ' has no sentence');
  // Reached through pur_actor_owner, pur_main_owner, pur_op_begin, pur_note, pur_reason, stk_line, stk_reader.
  for (const c of ['NOT_OFFICE', 'NOT_ALLOWED', 'BAD_OP', 'OP_CANCELLED', 'BAD_NOTE', 'REASON_REQUIRED', 'NOT_FOUND', 'ITEM_IN_USE']) ok(ta.ERRORS[c], c);
  eq(ta.errorMessage({ message: 'MORE_THAN_BOUGHT', hint: 'Still to register from this line: 1.' }),
     ta.ERRORS.MORE_THAN_BOUGHT + ' (Still to register from this line: 1.)', 'the hint says how many are left');
  eq(ta.errorMessage({ code: 'PGRST202', message: 'Could not find' }), ta.ERRORS.PGRST202);
  ok(/^Something went wrong: /.test(ta.errorMessage({ message: 'weird' })));
});

test('every state and record kind of 0107 has a label; the conditions are the server\'s', () => {
  const states = SQL.match(/state text not null check \(state in \(([^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  eq(Object.keys(ta.STATE_LABEL).sort(), states.sort(), 'states');
  const kinds = SQL.match(/kind text not null check \(kind in \('register'[^)]*\)\)/)[0].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  eq(Object.keys(ta.KIND_LABEL).sort(), kinds.sort(), 'record kinds');
  const conds = SQL.match(/condition text not null default 'good' check \(condition in \(([^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  eq(ta.CONDITIONS.map(c => c[0]), conds, 'conditions, in the server\'s order');
});

test('what can be done to a tool follows its state, as the server allows', () => {
  eq(ta.actionsFor({ state: 'available' }), ['issue', 'lost']);
  eq(ta.actionsFor({ state: 'issued' }), ['handover', 'return', 'lost']);
  eq(ta.actionsFor({ state: 'issued', condition: 'good' }), ['handover', 'return', 'lost']);
  for (const c of ['needs_repair', 'missing_parts']) {
    eq(ta.actionsFor({ state: 'issued', condition: c }), ['repaired', 'return', 'lost'], c + ' at its project: no handover until repaired (rev 3)');
  }
  eq(ta.actionsFor({ state: 'repair' }), ['repaired', 'retire', 'lost']);
  eq(ta.actionsFor({ state: 'lost' }), ['found']);
  for (const s of ['lost_pending', 'retire_pending', 'retired', 'cancelled']) eq(ta.actionsFor({ state: s }), [], s + ': nothing — waiting or final');
  // The server's own guards, operation by operation.
  const guard = (fn) => SQL.slice(SQL.indexOf('create or replace function ' + fn + '('), SQL.indexOf('$$;', SQL.indexOf('create or replace function ' + fn + '(')));
  ok(/if t\.state <> 'available' then\s+raise exception 'NOT_AVAILABLE'/.test(guard('tl_issue')), 'issue: available only');
  ok(/if t\.state <> 'issued' then\s+raise exception 'NOT_ISSUED'/.test(guard('tl_handover')), 'handover: issued only');
  ok(/if t\.condition <> 'good' then\s+raise exception 'NEEDS_REPAIR'/.test(guard('tl_handover')), 'handover: in good condition only (rev 3)');
  ok(/if t\.state <> 'issued' then\s+raise exception 'NOT_ISSUED'/.test(guard('tl_return')), 'return: issued only');
  ok(/if not \(t\.state = 'repair' or \(t\.state = 'issued' and t\.condition <> 'good'\)\) then\s+raise exception 'NOT_IN_REPAIR'/.test(guard('tl_repaired')),
     'repaired: under repair, or issued and not in good condition (rev 3)');
  ok(/if t\.state <> 'repair' then\s+raise exception 'NOT_IN_REPAIR'/.test(guard('tl_request_retire')), 'retire: repair only');
  ok(/if t\.state not in \('available', 'issued', 'repair'\) then\s+raise exception 'BAD_STATE'/.test(guard('tl_report_lost')), 'lost: these three');
  ok(/if t\.state <> 'lost' then\s+raise exception 'NOT_LOST'/.test(guard('tl_found')), 'found: lost only');
});

test('the Out list: a tool needing repair at its project offers Repaired, never Hand over (rev 3)', () => {
  const out = BROWSER.slice(BROWSER.indexOf('function outRow'), BROWSER.indexOf('function lineCard'));
  ok(/const broken = t\.condition && t\.condition !== 'good';/.test(out), 'not in good condition');
  ok(/\(broken \? '<button type="button" class="att-btn att-btn--sm" data-out-act="repaired">Repaired…<\/button>'\s*: '<button type="button" class="att-btn att-btn--sm" data-out-act="handover">Hand over…<\/button>'\)/.test(out),
     'Repaired… instead of Hand over…');
  ok(/data-out-act="return">Return…<\/button>/.test(out), 'Return… always');
  ok(/\(broken \? ' ' \+ pill\(conditionLabel\(t\.condition\) \+ ' — not usable', 'abandoned'\) : ''\)/.test(out), 'marked not usable');
  ok(/if \(t\) runAction\(b\.dataset\.outAct, t, reload\);/.test(BROWSER) && /return openSimple\(t, act, reload\);/.test(BROWSER),
     'the button opens the same Repaired form as the tool page');
});

test('who may withdraw or reverse (tl_reverse): matches the server', () => {
  const r = (x) => Object.assign({ status: 'done', kind: 'issue', latest: true, recorded_by: 'u1', reversed: false }, x);
  ok(ta.canReverse(r({}), ME), 'my latest record');
  ok(!ta.canReverse(r({ recorded_by: 'x' }), ME), 'someone else\'s — not for staff');
  ok(ta.canReverse(r({ recorded_by: 'x' }), { userId: 'o2', isOwner: true }), 'an owner may');
  ok(!ta.canReverse(r({ latest: false }), ME), 'only the latest (LATER_RECORDS)');
  ok(!ta.canReverse(r({ reversed: true }), ME) && !ta.canReverse(r({ status: 'rejected' }), ME) && !ta.canReverse(r({ status: 'withdrawn' }), ME));
  ok(!ta.canReverse(r({ kind: 'lost' }), OWNER) && !ta.canReverse(r({ kind: 'retire' }), OWNER), 'a decided loss / retirement: never');
  ok(ta.canReverse(r({ status: 'pending', kind: 'lost' }), ME), 'withdraw my own request');
  ok(!ta.canReverse(r({ status: 'pending', kind: 'lost', recorded_by: 'x' }), ME), 'not someone else\'s');
  ok(ta.canReverse(r({ status: 'pending', kind: 'retire', recorded_by: 'x' }), OWNER), 'the main owner may withdraw anyone\'s');
  const rev = SQL.slice(SQL.indexOf('create or replace function tl_reverse('));
  ok(/if auth\.uid\(\) <> r\.recorded_by and not pur_is_main_owner\(\) then\s+raise exception 'NOT_YOURS'/.test(rev), 'server: pending');
  ok(/if auth\.uid\(\) <> r\.recorded_by and not is_owner\(\) then\s+raise exception 'NOT_YOURS'/.test(rev), 'server: done');
  ok(/if tl_latest\(t\.id\) <> r\.id then\s+raise exception 'LATER_RECORDS'/.test(rev), 'server: latest only');
});

test('a photo path is exactly the shape the server accepts (tl_photo), month by the local calendar', () => {
  const owner = '00000000-0000-0000-0000-00000000000A';
  const id = '11111111-2222-4333-8444-555555555555';
  const p = ta.photoPath(owner, new Date(2026, 9, 31, 23, 30), id);
  eq(p, 'tools/00000000-0000-0000-0000-00000000000a/2026-10/' + id + '.jpg');
  const re = SQL.match(/if p !~ \('\^tools\/' \|\| p_owner::text \|\| '([^']+)'\) then/)[1];
  ok(new RegExp('^tools/' + owner.toLowerCase() + re).test(p), 'matches the server\'s pattern');
  let threw = false; try { ta.photoPath(null, new Date(), id); } catch (_) { threw = true; }
  ok(threw, 'no company: refused before uploading');
});

test('register and issue forms refuse what the server would refuse — a person at a project, a photo for the opening register, damaged at the warehouse (rev 2)', () => {
  const base = { itemId: 'i', count: '1', at: 'warehouse', holderId: '', condition: 'good', details: '', fromLine: false, hasPhoto: true };
  eq(ta.registerProblems(base), []);
  eq(ta.registerProblems({ ...base, at: 'f1' }), ['PERSON_REQUIRED']);
  eq(ta.registerProblems({ ...base, at: 'f1', holderId: 'w' }), []);
  eq(ta.registerProblems({ ...base, itemId: '' }), ['BAD_ITEM']);
  for (const c of ['0', '51', '1.5', 'two', '']) eq(ta.registerProblems({ ...base, count: c }), ['BAD_QUANTITY'], c);
  eq(ta.registerProblems({ ...base, condition: 'broken' }), ['BAD_CONDITION']);
  eq(ta.registerProblems({ ...base, condition: 'damaged' }), [], 'damaged: at the warehouse');
  eq(ta.registerProblems({ ...base, condition: 'damaged', at: 'f1', holderId: 'w' }), ['DAMAGED_AT_PROJECT'], 'never at a project');
  eq(ta.registerProblems({ ...base, hasPhoto: false }), ['PHOTO_REQUIRED'], 'the opening register needs its photo');
  eq(ta.registerProblems({ ...base, hasPhoto: false, fromLine: true }), [], 'from a purchase line: optional');
  eq(ta.registerProblems({ ...base, details: 'x'.repeat(201) }), ['BAD_NOTE']);
  eq(ta.issueProblems({ holderId: '', folderId: 'f' }), ['PERSON_REQUIRED']);
  eq(ta.issueProblems({ holderId: 'w', folderId: '' }), ['BAD_PROJECT']);
  ok(/if v_count < 1 or v_count > 50 then/.test(SQL), 'server: 1–50');
  ok(/if v_cond = 'damaged' then\s+raise exception 'DAMAGED_AT_PROJECT'/.test(SQL), 'server: damaged only at the warehouse');
  ok(/if v_purchase is null and v_photo is null then\s+raise exception 'PHOTO_REQUIRED'/.test(SQL), 'server: the opening register\'s photo');
});

test('pickers: completed projects only where the tool already is; requests of this tool or none; people with their teams', () => {
  const projects = [{ folder_id: 'a', name: 'House', completed: false }, { folder_id: 'b', name: 'Old', completed: true }];
  eq(ta.projectOptions(projects).map(o => o.value), ['a']);
  eq(ta.projectOptions(projects, 'b').map(o => o.label), ['House', 'Old (completed)']);
  const lines = [{ line_id: 'l1', description: 'Grinder', catalog_item_id: 'g', still_to_buy: 1, unit: 'pc', requester_name: 'Mark' },
                 { line_id: 'l2', description: 'Drill', catalog_item_id: 'd', still_to_buy: 1, unit: 'pc', requester_name: 'Mark' },
                 { line_id: 'l3', description: 'Any grinder', catalog_item_id: null, still_to_buy: 2, unit: 'pc', requester_name: 'Rey' },
                 { line_id: 'l4', description: 'Grinder', catalog_item_id: 'g', still_to_buy: 0, unit: 'pc', requester_name: 'Rey' }];
  eq(ta.requestOptions(lines, 'g').map(o => o.value), ['l1', 'l3'], 'its item or none, with something still to fill');
  eq(ta.personLabel({ name: 'Lito', role: 'teamLeader', teams: ['Masons'] }), 'Lito (Masons)');
  eq(ta.personLabel({ name: 'Ben', role: 'teamLeader', teams: [] }), 'Ben (team leader)');
  eq(ta.personLabel({ name: 'Ana', role: 'staff', teams: [] }), 'Ana (office)', 'office staff may hold a tool (T1 = C)');
  eq(ta.personLabel({ name: 'admin', role: 'owner' }), 'admin (owner)');
  eq(ta.personLabel({ name: 'Mark', role: 'worker', teams: [] }), 'Mark');
});

test('records and places in words', () => {
  eq(ta.recordText({ kind: 'handover', from_holder_name: 'Mark', holder_name: 'Rey', folder_name: 'House' }), 'Handed over from Mark to Rey · House');
  eq(ta.recordText({ kind: 'return', holder_name: 'Rey', condition: 'missing_parts' }), 'Returned by Rey · Missing parts');
  eq(ta.recordText({ kind: 'lost', holder_name: 'Rey', status: 'pending' }), 'Reported lost (last with Rey) (waiting for the owner)');
  eq(ta.recordText({ kind: 'register', condition: 'good' }), 'Registered at the warehouse');
  eq(ta.whereText({ state: 'issued', holder_name: 'Mark', folder_name: 'House', days: 9 }), 'Mark · House · 9 days');
  eq(ta.whereText({ state: 'repair', condition: 'needs_repair' }), 'Warehouse · Needs repair');
  eq(ta.whereText({ state: 'issued', holder_name: 'Mark', folder_name: 'House', days: 2, condition: 'missing_parts' }),
     'Mark · House · 2 days · Missing parts — not usable until repaired');
  eq(ta.recordText({ kind: 'repaired', holder_name: 'Mark', folder_name: 'House' }), 'Repaired — still with Mark · House');
  eq(ta.recordText({ kind: 'repaired' }), 'Repaired — available again');
  eq([ta.daysText(0), ta.daysText(1), ta.daysText(12)], ['today', '1 day', '12 days']);
});

console.log('\ntools: no money');

test('the Tools screens read no table, call only 0107\'s functions, and show no peso amount', () => {
  ok(!/\.from\((?!'uploads'\))/.test(JS), 'no direct table read (only the uploads bucket for photos)');
  ok(!/₱|peso|amount|price|toFixed\(2\)/i.test(JS.replace(/\/\/[^\n]*/g, '').replace(/No prices here/, '')), 'no money on screen');
  const called = [...new Set([...BROWSER.matchAll(/RA\.rpc\('([a-z_]+)'/g)].map(m => m[1]))].sort();
  const granted = [...SQL.matchAll(/grant execute on function ([a-z_]+)\(/g)].map(m => m[1]);
  for (const f of called) ok(granted.includes(f), f + ' is not a granted 0107 function');
  eq(called, ['tl_choices', 'tl_decide', 'tl_found', 'tl_handover', 'tl_issue', 'tl_overview', 'tl_register', 'tl_repaired',
              'tl_report_lost', 'tl_request_lines', 'tl_request_retire', 'tl_return', 'tl_reverse', 'tl_set_enabled', 'tl_status', 'tl_tool']);
  ok(!/amount|price|gross|cost_/.test(SQL.slice(SQL.indexOf('-- ════ 7. Reading'), SQL.indexOf('-- 0104\'s Stock screen'))), 'the readers send no money');
});

test('every write is sent once: one operation id per form, kept across retries — and its photo uploaded once', () => {
  const writes = ['tl_register', 'tl_issue', 'tl_handover', 'tl_return', 'tl_found', 'tl_reverse', 'tl_decide'];
  for (const w of writes) {
    ok(new RegExp("sendOnce\\(\\(opId[^)]*\\) => RA\\.rpc\\('" + w + "'").test(BROWSER), w + ' goes through sendOnce');
    ok((BROWSER.match(new RegExp("RA\\.rpc\\('" + w + "'", 'g')) || []).length === 1, w + ' is called in one place');
  }
  for (const w of ['tl_repaired', 'tl_request_retire', 'tl_report_lost']) ok(new RegExp("\\(op, text\\) => RA\\.rpc\\('" + w + "', \\{ p_op: op").test(BROWSER), w + ': the form\'s one id');
  ok(/const send = sendOnce\(cfg\[4\]\);/.test(BROWSER), '…through sendOnce');
  ok(/function sendOnce\(fn\) \{\s+const opId = newOp\(\);\s+return \(\.\.\.args\) => fn\(opId, \.\.\.args\);/.test(BROWSER), 'the id is made once per form');
  ok(/if \(done && done\.file === file\) return done\.path;/.test(BROWSER), 'a retried form does not upload the photo again');
  ok(/upload\(path, blob, \{ upsert: false, contentType: 'image\/jpeg' \}\)/.test(BROWSER), 'never overwrites a photo');
});

console.log('\ntools: wiring');

test('Requests → Tools: in the nav, the view list and the page; hidden until tools are on, except from the main owner', () => {
  const admin = read('js/admin.js');
  const html = read('admin.html');
  ok(/\{ view: 'reqTools',\s+label: 'Tools',\s+icon: 'wrench' \}/.test(admin), 'PRIMARY_NAV entry');
  ok(/if \(!window\.currentToolsOn && !window\.currentToolsMainOwner\) hidden\.push\('reqTools'\);/.test(admin), 'hidden until on');
  ok(/const \{ data: tl \} = await window\.sbClient\.rpc\('tl_status'\);/.test(admin), 'the server says (before 0107: hidden)');
  ok(/window\.currentToolsOn = !!\(tl && tl\.enabled\);/.test(admin) && /window\.currentToolsMainOwner = !!\(tl && tl\.is_main_owner\);/.test(admin));
  ok(/const REQ_VIEWS\s+= \[[^\]]*'reqTools'[^\]]*\]/.test(html), 'REQ_VIEWS');
  ok(/<div id="reqToolsView"\s+class="content-view" style="display: none;"><\/div>/.test(html), 'the page');
  ok(/reqTools:\s+'Tools',/.test(html), 'the title');
  const core = html.indexOf('js/requests-admin-core.js'), tools = html.indexOf('<script src="js/tools-admin.js?v=');
  ok(core > 0 && tools > core && tools > html.indexOf('js/receipt-storage.js'), 'loaded after Requests and the photo helper');
  ok(/RA\.views\.reqTools = render;/.test(JS), 'the view is registered');
  ok(/if \(!status \|\| !status\.enabled\) return renderOff\(host, status\);/.test(BROWSER), 'off: nothing but the switch');
  ok(/form\.word\.value\.trim\(\) !== 'TOOLS'/.test(BROWSER), 'on: TOOLS typed');
  ok(/form\.word\.value\.trim\(\) !== 'OFF'/.test(BROWSER) && /RA\.rpc\('tl_set_enabled', \{ p_on: false \}\)/.test(BROWSER), 'off again: OFF typed (a failed pilot)');
  ok(/\(status\.is_main_owner \? '<div class="stk-switch-off"><button[^']*data-switch-off>Switch tools off…<\/button><\/div>' : ''\)/.test(BROWSER),
     'the off switch is the main owner\'s only');
  ok(/v_owner uuid := pur_main_owner\(\);/.test(SQL.slice(SQL.indexOf('function tl_set_enabled'), SQL.indexOf('function tl_set_enabled') + 300)), 'the server checks it is the main owner');
});

test('a focused account the server lets record gets Requests → Tools beside Stock and Purchasing — and nothing else of Requests', () => {
  const vm = require('vm');
  const src = read('js/admin.js');
  const slice = src.slice(src.indexOf('const PRIMARY_NAV = ['), src.indexOf('function findPrimaryForView('));
  const run = ({ role = 'staff', modules = ['expenses'], buyer = false, stock = false, tools = false, mainOwner = false }) => {
    const sb = { window: { currentCanBuy: buyer, currentStockOn: stock, currentStockMainOwner: mainOwner,
                           currentToolsOn: tools, currentToolsMainOwner: mainOwner },
                 currentUserRole: role, currentAllowedModules: modules };
    vm.createContext(sb);
    vm.runInContext(slice + '\nthis.__nav = _visibleNav(); this.__views = window.focusAllowedViews();', sb);
    const req = sb.__nav.find(p => p.id === 'requests');
    return { req: req ? { sub: req.sub, def: req.defaultView, views: req.modules.map(m => m.view) } : null, views: sb.__views };
  };
  eq(run({ tools: true }).req, { sub: 'Tools', def: 'reqTools', views: ['reqTools'] }, 'tools on: Requests holding Tools alone');
  eq(run({ tools: true, stock: true }).req, { sub: 'Stock & Tools', def: 'reqStock', views: ['reqStock', 'reqTools'] });
  eq(run({ tools: true, stock: true, buyer: true }).req,
     { sub: 'Purchasing & Stock & Tools', def: 'reqPurchasing', views: ['reqPurchasing', 'reqStock', 'reqTools', 'reqPurchase'] });
  eq(run({ stock: true, buyer: true }).req, { sub: 'Purchasing & Stock', def: 'reqPurchasing', views: ['reqPurchasing', 'reqStock', 'reqPurchase'] },
     'tools off: exactly as before');
  ok(!run({ stock: true }).views.includes('reqTools'), 'off: the guard keeps Tools out');
  ok(run({ tools: true }).views.includes('reqTools') && !run({ tools: true }).views.includes('reqQueue'), 'on: Tools in, nothing else of Requests');
  eq(run({ role: 'worker', modules: ['construction'], tools: true }).req, null, 'never a worker');
  eq(run({ role: 'owner', modules: ['expenses'], mainOwner: true }).req.views.includes('reqTools'), true, 'the main owner reaches the switch');
  const full = run({ modules: ['requests'], tools: false }).req;
  ok(full.views.includes('reqQueue') && !full.views.includes('reqTools'), 'focused on Requests: Tools only once on');
});

test('Mark as Complete names the tools still out — never blocks (Q20)', () => {
  const exp = read('js/expenses-module.js');
  const mark = exp.slice(exp.indexOf('async function markFolderComplete'), exp.indexOf('async function reopenFolder'));
  ok(/\+ await _toolsOutNote\(id\),/.test(mark), 'the note joins the confirm message');
  const note = exp.slice(exp.indexOf('async function _toolsOutNote'), exp.indexOf('async function markFolderComplete'));
  ok(/if \(!window\.currentToolsOn\) return '';/.test(note), 'nothing while tools are off');
  ok(/rpc\('tl_project_out', \{ p_folder: id \}\)/.test(note), 'the server lists them (the project and its jobs)');
  ok(/catch \(_\) \{ out = \[\]; \}/.test(note), 'a failed read never blocks completing');
  ok(!/return;|throw/.test(note.replace(/return '';/g, '').replace(/return '\\n\\n'/, '')), 'no way to stop the completion');
  ok(/document\.getElementById\('deleteConfirmMsg'\)\.textContent = message;/.test(exp), 'shown as text (names cannot inject markup)');
  ok(/t\.folder_id in \(select f\.id from folders f where f\.owner_id = v_owner\s+and \(f\.id = p_folder or f\.parent_folder_id = p_folder\)\)/.test(SQL), 'server: the project and its Additional Works');
});

test('the shopping list shows tools issued for a line (bought for it, or counted on their own) and what they filled', () => {
  const list = read('js/purchasing-admin-list.js');
  ok(/if \(root\.currentToolsOn && lines\.length\) \{\s+try \{ tools = \(await RA\.rpc\('tl_line_tools', \{ p_lines: lines\.map\(l => l\.line_id\) \}\)\) \|\| \{\}; \} catch \(_\) \{ tools = \{\}; \}/.test(list),
     'asked only while tools are on; a failure shows nothing');
  ok(/stat\('Tools issued', l\._tools\.filled\)/.test(list), 'the line\'s figure');
  ok(/' tools issued · '/.test(list), 'each weekly portion\'s');
  ok(/\(t\.counted \? '' : ', bought for this'\)/.test(list), 'a tool bought for the line says so (counted through its purchase)');
  ok(/esc\(t\.label\)/.test(list) && /esc\(t\.holder_name\)/.test(list), 'escaped');
});

test('tool photos: their own folder, office only, in the storage map', () => {
  const st = read('tests/storage-access.test.js');
  ok(/tools: 'admin',/.test(st), 'classified');
  ok(/const path = photoPath\(root\.currentDataUserId, new Date\(\), newOp\(\)\);/.test(BROWSER), 'the company the server checks against');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Modify:** `css/purchasing-admin.css`

```diff
diff --git a/css/purchasing-admin.css b/css/purchasing-admin.css
index ee079b7..b947232 100644
--- a/css/purchasing-admin.css
+++ b/css/purchasing-admin.css
@@ -154,6 +154,11 @@
 .stk-rec.is-reversed .stk-rec-main { color: var(--att-muted); }
 .stk-rec-acts, .stk-line-acts { display: flex; flex-wrap: wrap; gap: 6px; }
 .stk-line-acts { margin-top: 8px; }
+/* ── Tools (0107, 3a) — js/tools-admin.js. No money ── */
+.tl-state { margin-left: auto; }
+.tl-photo { display: block; max-width: 160px; max-height: 120px; margin: 6px 0; border-radius: 10px;
+  border: 1px solid var(--att-line); object-fit: cover; cursor: zoom-in; }
+.tl-photo--lg { max-width: 260px; max-height: 200px; margin: 10px 0; }
 /* 2C (0105): a record's cost moves, under it. */
 .stk-cost { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 4px; padding-top: 6px; border-top: 1px dashed var(--att-line); }
 .stk-cost-acts { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
```

**Modify:** `admin.html`

```diff
diff --git a/admin.html b/admin.html
index a14bcff..7cc73ec 100644
--- a/admin.html
+++ b/admin.html
@@ -22,7 +22,7 @@
     <link rel="stylesheet" href="css/reimbursement-module.css">
     <link rel="stylesheet" href="css/attendance-admin.css">
     <link rel="stylesheet" href="css/requests-admin.css?v=20261012a">
-    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261027a">
+    <link rel="stylesheet" href="css/purchasing-admin.css?v=20261028a">
     <link rel="stylesheet" href="css/workplan-admin.css?v=20261014a">
     <!-- Warranty Retention Register + Fund Styles -->
     <link rel="stylesheet" href="css/warranty-fund.css?v=20260803f">
@@ -2659,6 +2659,9 @@
         <!-- Stock (WorkMate Stage 2B-a, 0104) — js/stock-admin.js. Quantities only;
              hidden until the main owner switches stock on. -->
         <div id="reqStockView"      class="content-view" style="display: none;"></div>
+        <!-- Tools (WorkMate Stage 3a, 0107) — js/tools-admin.js. No money;
+             hidden until the main owner switches tools on. -->
+        <div id="reqToolsView"      class="content-view" style="display: none;"></div>
         <!-- Work Plan (WorkMate My Work, 0093/0094) — rendered by js/workplan-admin-*.js.
              wpMeeting and wpTask are drill-downs from the Board and Meetings. -->
         <div id="wpBoardView" class="content-view" style="display: none;"></div>
@@ -5438,6 +5441,7 @@
 <script src="js/purchasing-admin-cash.js?v=20261023b"></script>
 <script src="js/stock-admin.js?v=20261028a"></script>
 <script src="js/stock-cost-admin.js?v=20261026a"></script>
+<script src="js/tools-admin.js?v=20261028a"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261014a"></script>
 <script src="js/workplan-admin-board.js?v=20261014a"></script>
@@ -6310,7 +6314,7 @@
     const PM_VIEWS   = ['pmProjects','pmWorkspace'];
     const QUOTE_VIEWS = ['quoteList','quoteEditor','quoteRevision'];
     const ATT_VIEWS   = ['attToday','attWorkers','attWorker','attProjects','attReports','attRewards'];
-    const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqHistory','reqProjects','reqPurchasing','reqPurchase','reqStock'];
+    const REQ_VIEWS   = ['reqQueue','reqDetail','reqBatches','reqTeams','reqCatalog','reqHistory','reqProjects','reqPurchasing','reqPurchase','reqStock','reqTools'];
     const WP_VIEWS    = ['wpBoard','wpMeetings','wpMeeting','wpTask'];
     const TITLES = {
         dashboard:        'Dashboard',
@@ -6359,6 +6363,7 @@
         reqPurchasing:    'Purchasing',
         reqPurchase:      'Purchase',
         reqStock:         'Stock',
+        reqTools:         'Tools',
         wpBoard:          'Work Plan',
         wpMeetings:       'Meetings',
         wpMeeting:        'Meeting',
```

**Modify:** `package.json`

```diff
diff --git a/package.json b/package.json
index 55720a6..071a369 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "scripts": {
-    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js && node tests/stock-cost-admin.test.js",
+    "test": "node tests/money-math.test.js && node tests/reimbursement.test.js && node tests/quotation.test.js && node tests/quotation-pdf-import.test.js && node tests/shim-fromrow.test.js && node tests/shim-docref.test.js && node tests/shim-omit.test.js && node tests/folder-completion.test.js && node tests/attendance.test.js && node tests/billing-allocation.test.js && node tests/app-updates.test.js && node tests/storage-access.test.js && node tests/app-streams.test.js && node tests/booking.test.js && node tests/workmate-requests.test.js && node tests/workmate-requests-office.test.js && node tests/requests-admin.test.js && node tests/shim-addmany.test.js && node tests/receipt-storage.test.js && node tests/receipt-save-paths.test.js && node tests/receipt-print-popups.test.js && node tests/workmate-history.test.js && node tests/project-control-staff.test.js && node tests/workmate-workplan.test.js && node tests/workmate-office-server.test.js && node tests/workplan-admin.test.js && node tests/ai-worker.test.js && node tests/workplan-screens.test.js && node tests/purchase-server.test.js && node tests/purchase-screens.test.js && node tests/expense-split-rows.test.js && node tests/staff-payroll-period.test.js && node tests/purchasing-admin.test.js && node tests/purchasing-server.test.js && node tests/pm-sharing.test.js && node tests/cash-advance.test.js && node tests/purchasing-phone-server.test.js && node tests/signin-eligibility.test.js && node tests/purchasing-payments-server.test.js && node tests/purchasing-payments-screens.test.js && node tests/stock-admin.test.js && node tests/stock-cost-admin.test.js && node tests/tools-admin.test.js",
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
```

**Modify:** `docs/ARCHITECTURE.md`

```diff
diff --git a/docs/ARCHITECTURE.md b/docs/ARCHITECTURE.md
index f2a7ed1..5f063db 100644
--- a/docs/ARCHITECTURE.md
+++ b/docs/ARCHITECTURE.md
@@ -134,6 +134,7 @@ Also note: **`projects` means billing period**, not project. Read it that way ev
 | Requests | `requests-admin-core.js`, `requests-admin-queue.js`, `requests-admin-detail.js`, `requests-admin-setup.js`, `requests-admin-history.js`, `requests-admin-gallery.js` | The office half of **DAC'S WorkMate Requests** (`0085` tables, `0086` office RPCs). Workers and team leaders request materials and tools in the phone app; owner and staff process them here: the **queue** (urgent first, then by weekly batch — Saturday 12:00 noon Manila cutoff), one request's **detail** (mark portions arranged, move an unarranged portion to another batch, resolve a worker's reduction of arranged quantity as *order reduced* or *kept as surplus*, change or cancel an item with a reason, resolve an offline-edit conflict, match an unlisted item to the catalogue, private photos via signed URLs, full history), **weekly batches** (only purchasing/delivery dates change), **teams** (a leader needs the Team Leader role *and* the assignment), the **catalogue** (deactivate, never delete; since `0092` an item used in any request keeps its **kind and unit** — the form locks both and the server refuses `ITEM_IN_USE`) and **projects** (*Allow requests*). Since `0090` (Stage 1b, Find Previous Item): catalogue **aliases** and **brand** (search aids, not identity), a per-project **Item history** switch (separate from *Allow requests*, survives completion), and the **Item history** view — search items with their dated history, add or retire a **historical reference** (creates no expense, stock or purchase), and manage reviewed **product photos** in the private `item-gallery` bucket (`<company>/<item>/<uuid>.jpg`, re-encoded in the browser, three-tick checklist, cover, retire — never deleted); **Photos to review** publishes a COPY of a worker's private request photo or keeps it private. A request line shows the Request Again source (`ref_label`). **Every write is an RPC** — the browser holds no write policy. **No money anywhere**: quantities only, so staff see all of it. A project or Additional Works job with requests **cannot be deleted** (`deleteFolder` / `deleteChild` ask `pr_folder_request_count` first) — complete it instead. Pure helpers are guarded by `tests/requests-admin.test.js`; the migration by `tests/workmate-requests-office.test.js`. Workers and team leaders can no longer sign in to this portal (`ADMIN_ROLES`) |
 | Purchasing | `purchasing-admin-core.js`, `purchasing-admin-list.js`, `purchasing-admin-record.js`, `purchasing-admin-purchases.js`, `css/purchasing-admin.css` | WorkMate Stage 2A-2 (`0097`): **Requests → Purchasing**, for accounts the server lets buy (owner, admin accounts allowed Expenses, staff with the **Buyer** switch — set by the owner in Users → Navigator). An account focused on Expenses but not Requests still gets a Requests tab holding Purchasing alone (`_purchasingOnly` in `admin.js`). The **shopping list** (Needed · Bought · Still to buy per weekly-batch portion, who is buying each — "I'll buy this", assign, release, mark arranged), **Record purchase** (one receipt, many lines and projects, linked to their request portions — optionally picked per weekly portion, and then only those are covered — extras with a reason, substitutes with a reason and an office check, Unplanned lines, delivery fees / discounts, receipt photos in the buyer-only `purchases/` folder, kept in the form state so a redraw keeps them and a replacement is uploaded), **Purchases** (one purchase: covers, unit / substitute check, correct, void, history; receipts open through an authenticated download, never a signed link) and **Owner approvals** (staff changes only the owner may make, shown field by field — as asked vs asked for — and not approvable once the purchase changed). Shows prices — the one Requests screen that does. Every write is a `pur_*` RPC through the same recording operation as Expenses / Project Control (0096). Project Control's edit and void send owner-only staff changes for approval, and read the purchase behind a row through `pur_entry_row` (`expenses-module.js`) — purchase tables are buyers-only. Pure helpers: `tests/purchasing-admin.test.js`; migration: `tests/purchasing-server.test.js` + `npm run test:sql` |
 | Stock | `stock-admin.js`, `stock-cost-admin.js`, `css/purchasing-admin.css` (`stk-*`) | WorkMate Stage 2B-a (`0104`): **Requests → Stock**, quantities only, for owner and office staff allowed Expenses (Buyer staff included). Hidden until the main owner switches stock on (`stk_status`; the main owner sees the switch). An account focused on other sections (`allowed_modules` without Requests) that the server lets record stock still gets a Requests tab holding Stock (`_stockOnly` in `admin.js`, menu and view guard — beside Purchasing for a buyer). Tabs: **Stock** (items by place; one item's lots, each delivery with the day it was received — the issuing order, oldest received first — and history), **Receiving** (warehouse purchases awaiting delivery or a catalogue match), **Waiting for owner** (counts and opening stock the main owner confirms), **History** (reverse / withdraw). Forms: Issue / move, Record leftovers, Count, Opening stock, Match, Received, Not delivered — each sends one operation id. The shopping list shows "In warehouse" and, once stock is on, "Issue from stock" (`StockAdmin.openIssue`). Once stock is on, the old "Add to inventory" tick (Add Expense) and the old Inventory screen are hidden — the server refuses both. Pure helpers: `tests/stock-admin.test.js`; migration: `npm run test:sql` (`2b_stock`, `2b_concurrency`). **Cost moves (2C, `0105`)**: each record lists its cost moves as states ("Cost assignment pending", "Cost transferred"…); `stock-cost-admin.js` holds every peso — the main owner's Approve / Reject / Reverse cost and a recorder's Ask again, the cards in Purchasing → **Owner approvals** (and Stock → Waiting for owner), and Purchasing → **Company stock** (owner accounts). Approved cost moves are ordinary expense rows (`stkCostMoveId`): Project Control and Expenses tag them "Stock cost move", never edit or delete them, and hide their amount from staff (`_hideStockCost`). Tests: `tests/stock-cost-admin.test.js`; `npm run test:sql` (`2c_cost`, `2c_concurrency`) |
+| Tools | `tools-admin.js`, `css/purchasing-admin.css` (`tl-*`, reusing `stk-*`) | WorkMate Stage 3a (`0107`): **Requests → Tools**, no money at all, for owner and office staff allowed Expenses. Hidden until the main owner switches tools on (`tl_status`; the main owner sees the switch, and "Switch tools off…" for a failed pilot); an account focused elsewhere that the server lets record gets Tools in its Requests tab (`_toolsOnly` in `admin.js`). Tabs: **Tools** (every tool by number; one tool's history and its actions by state), **Out** (issued, longest first, days held), **To register** (purchase lines of tools), **Waiting for owner** (Lost / Retire — the main owner confirms or rejects). Forms: Register (at the warehouse, or with a named person on a project — required), Issue (optionally filling a tool request line), Hand over, Return with condition, Repaired, Ask to retire, Report lost, Found, Reverse / Withdraw — each sends one operation id; photos go to `uploads/tools/<company>/`. Also: **Mark as Complete** (`markFolderComplete` in `expenses-module.js`) names the tools still out (`tl_project_out`, never blocks), and the shopping list shows tools issued per line (`tl_line_tools`). Tests: `tests/tools-admin.test.js`; `npm run test:sql` (`3a_tools`, `3a_concurrency`, and the 2A–2C suites `--with-0107`) |
 | Work Plan | `workplan-admin-core.js`, `workplan-admin-form.js`, `workplan-admin-board.js`, `workplan-admin-task.js`, `workplan-admin-meetings.js` | The office half of **DAC'S WorkMate My Work** (`0093`, `0094`; plan `docs/superpowers/plans/2026-10-13-workmate-stage1c2-work-plan-office.md`). Owner and staff turn **meeting notes** into tasks — **AI drafts** through the `dacs-ai` worker (gated by `ai_authorize`, `0095`) or by hand — and review each in the **task form**: an AI name is filled in only on one exact match, otherwise the field reads *Needs your choice* and Save refuses. **Publish** sends tasks and shared notes to chosen people (default: everyone assigned in that meeting). The **Board** groups tasks under the office lists (check, blocked, not acknowledged 24 h, overdue, live, drafts/proposals, completed). One **task** shows who read which version, problems (cleared by the office with a note), photos (private `task-photos`), history, and approve / send back / reopen / cancel-decline. On a published task the **server raises the version** for any people, team or date change, and for wording unless marked a minor spelling correction (`0094`). Edits keep links and helpers the office did not remove, including links to tasks completed long ago. Unsaved meeting notes, shared notes and recipients survive redraws. **No money** — staff see all of it. Tests: `tests/workplan-admin.test.js`, `tests/workmate-office-server.test.js`, `tests/ai-worker.test.js`; live: `supabase/tests/1c2_acceptance.sql`, `1c2_ai_gate.sql` |
 
 **Project Control is compiled React.** See the build trap in §8.
```


- [ ] **Step 1: Apply the files above** in Dacs Web (Create blocks as given; Modify blocks with `git apply --ignore-whitespace` — `admin.html` keeps the user's own edit).
- [ ] **Step 2: Tests.** `npm test` → every suite passes (**42**, 1,339 checks), including the new `tools-admin.test.js` (**16**). `node --check` on `js/tools-admin.js`, `js/admin.js`, `js/expenses-module.js`, `js/purchasing-admin-list.js`.
- [ ] **Step 3: Browser check before committing** (the owner account, on a local copy — `admin.html` opened from the working tree, signed in to the live project): Requests shows **no Tools tab for staff** and, for the main owner, **Tools → "Not switched on yet"** with the switch. *Do not press it* (0107 is not live yet: the tab says "Tools are not installed on the server yet."). Project Control → Mark as Complete unchanged while tools are off.
- [ ] **Step 4: Stop for the user** to review and commit.

### Task 3: Live — 0107 with tools off, checked, the web pushed

- [ ] **Step 1: Before applying, check live** (MCP `execute_sql`, read-only): `stk_overview`, `pr_item_in_use`, `pr_portion_bought` and `pr_line_bought` still match 0104's bodies (`md5(replace(prosrc, chr(13), ''))`); no `tl_*` table or function exists; stock is on; note the counts of `purchases`, `purchase_lines`, `stk_records`, `pr_requests`, and `select count(*), sum(amount) from expenses`.
- [ ] **Step 2: The user applies the committed 0107** (Task 1 committed first): the whole file, unchanged, once, in the Supabase SQL editor.
- [ ] **Step 3: Verify the live database ourselves** (read-only): every function body of 0107 matches the file; the grants as in `3a_acceptance.sql` section B; the triggers `tl_no_tool_stock` (on `stk_matches`, `stk_lots`, `stk_records`), `tl_guard_line` (deferred, on `purchase_lines`), `tl_guard_void`, and the four history guards exist and are enabled; tools are off; Step 1's counts and expense sum unchanged.
- [ ] **Step 4: Live acceptance.** Run `supabase/tests/3a_acceptance.sql` through MCP `execute_sql`. Expect `3a acceptance: all checks passed`. It rolls itself back; afterwards check `tl_tools`, `tl_records`, `tl_settings` are empty and no `ZZ 3a acceptance` item exists.
- [ ] **Step 5: The user pushes Dacs Web** (Tasks 1–2). Check the live site serves the committed `js/tools-admin.js`, `js/admin.js`, `js/expenses-module.js` and `js/purchasing-admin-list.js`. Nothing changes for anyone while tools are off; the main owner sees Requests → **Tools** with the switch.
- [ ] **Step 6: Execution notes** in this plan; memory updated. Tools are still off. Next: Task 4, when the user chooses.

### Task 4: The ZZ pilot (Q24), the clean-up, the launch decision

Only when the user says to start. About an hour on Dacs Web; no real tool is registered during it. **Only the user switches tools on.**

- [ ] **Step 1: Before (MCP, read-only):** the counts of `tl_tools`, `tl_records`, `purchases`, `pr_requests`, `select count(*), sum(amount) from expenses`; no folder or item named `ZZ 3a…`.
- [ ] **Step 2: The user switches tools on** — Dacs Web as the main owner → Requests → Tools → **Switch tools on…**, type TOOLS.
- [ ] **Step 3: Set up (owner, Dacs Web).** Projects **`ZZ 3a pilot A`** (one billing period, *Allow requests* on) with an Additional Works job **`ZZ 3a pilot A — extra room`**, and **`ZZ 3a pilot B`** (one billing period). Catalogue items, kind **Tool**: **`ZZ 3a grinder`** (pc) and **`ZZ 3a drill`** (pc). On the test phone as **W-0007**: a request for `ZZ 3a pilot A`: `ZZ 3a grinder` **2 pc**; the office puts it in this week's batch.
- [ ] **Step 4: Pilot checks** (Dacs Web; record each in *Execution notes*).

| # | Check | Expect |
|---|---|---|
| T1 | Register: `ZZ 3a drill`, 2, warehouse, one photo, "ZZ Makita" | TOOL-0001 and TOOL-0002, Available; the photo shows on the tool |
| T2 | Register `ZZ 3a drill` at `ZZ 3a pilot A` **without a person**; then at the warehouse **without a photo** | Refused: "A tool at a project always has a named responsible person."; then "The opening register needs a photo of the tool." Nothing registered |
| T3 | Buy for the request (staff@, Purchasing): `ZZ 3a grinder` **1 pc** on pilot A, linked to W-0007's line | Shopping list: Bought 1, Still to buy 1. Tools → **To register**: the grinder line, 0 of 1 |
| T4 | Register from it (To register → Register…) | TOOL-0003, Available; the line leaves To register |
| T5 | Issue TOOL-0003 to W-0007 on pilot A, **Fills request** = the grinder line | Shopping list: "Issued: TOOL-0003 (…, bought for this)"; Still to buy **still 1** (counted once) |
| T6 | Issue TOOL-0001 (a drill, warehouse) to a leader on pilot A for the **same** line? | Not offered (the line is a grinder); issue it without a request instead |
| T7 | Register a warehouse grinder (opening, 1, with a photo) → TOOL-0004; issue it on pilot A for the grinder line | Fills it on its own: Tools issued 1, **Still to buy 0** |
| T8 | Hand over TOOL-0004 to another worker on `ZZ 3a pilot A — extra room` | Out: the new person and job, "today"; the line still filled |
| T9 | Return TOOL-0004 **good**; reverse that return; reverse the handover; reverse the issue | Each reversal needs a reason; the issue's reversal **reopens the line by 1** (Still to buy 1); TOOL-0004 Available |
| T10 | Reverse TOOL-0003's issue (bought for the line) | The line **stays filled through its purchase** (Still to buy unchanged) |
| T11 | Issue TOOL-0002 to W-0007 on pilot B; return it **damaged beyond repair** | Under repair + **Retire — waiting for the owner**; Issue not offered |
| T12 | Owner: **Reject** the Retire ("new motor") | TOOL-0002 **Under repair** (never Available); then **Repaired…** → Available |
| T13 | Issue TOOL-0001 to W-0007 on pilot B; **Report lost…** | Lost — waiting for the owner; no Issue / Hand over / Return |
| T14 | Owner: **Reject** ("it is on site") | Back **exactly**: issued to W-0007 on pilot B, the same days out |
| T15 | Report lost again; owner **Confirms**; then **Found…** (missing parts) | Lost (last with W-0007) → Under repair |
| T16 | Issue TOOL-0003 to W-0007 on pilot A (no request); return it **needs repair**; **Ask to retire…**; the office **withdraws** it | Under repair again (never Available without Repaired) |
| T17 | Issue TOOL-0004 to W-0007 on `ZZ 3a pilot A — extra room`; Project Control → `ZZ 3a pilot A` → **Mark as Complete** | The confirm names it ("1 tool is still out on this project: TOOL-0004 (…)" — the job counts); **Cancel** (do not complete) |
| T18 | Try to reverse TOOL-0004's registration; then register one more drill (TOOL-0005, with a photo) and reverse its registration | First refused: "Something happened to this tool after that record…"; second: TOOL-0005 Cancelled, no longer listed |
| T19 | staff@ on Dacs Web: Requests → Tools; issue TOOL-0005… (any available ZZ tool) **to staff@ itself** on pilot B, then return it good | Everything works; no peso anywhere; staff@ listed as "(office)" and can hold the tool (T1 = C). A worker account: no Tools tab |
| T19b | Register `ZZ 3a grinder`, 1, at `ZZ 3a pilot B` with W-0007, **Missing parts**, with a photo (rev 3) | Out: "Missing parts — not usable", buttons **Repaired… / Return…** (no Hand over). Try handing it over from its tool page: not offered |
| T19c | **Repaired…** on it; then **Hand over…** to another worker | Still with W-0007 on pilot B, the same days out; then handed over |
| T20 | Register `ZZ 3a drill`, 1, **damaged beyond repair**, with a photo — first at pilot A with a person, then at the warehouse | At pilot A refused ("…registered at the warehouse…"); at the warehouse TOOL-0006 **Retire — waiting for the owner** (Under repair underneath); owner **Confirms** → Retired |
| T21 | `client_errors` since Step 2 | Nothing new |

- [ ] **Step 5: Clean-up (the user, SQL editor).** Open `supabase/tests/3a_pilot_cleanup.sql`; run it **as is** (dry run): expect a red **DRY RUN OK** listing what it would remove, and nothing changed. If it says **GUARD: …**, stop and send the message. Then change `v_dry boolean := true;` to `false;` and run again: **CLEAN-UP DONE**.
- [ ] **Step 6: Check (MCP, read-only):** no folder, item, tool or purchase named `ZZ 3a…`; Step 1's counts and expense sum back exactly; the four tools history guards on. Photo files of T1 stay in Storage (delete by hand only if wanted).
- [ ] **Step 7: The user decides.** **Launch:** keep tools on and tell the office (register the company's tools, then record every issue). **Not yet:** Requests → Tools → **Switch tools off…**, type OFF.
- [ ] **Step 8: Execution notes**; memory updated.

---

## Self-review (against the answers)

| Answer | Where |
|---|---|
| Q1 two plans; Q2 3a now, 3b with 0E | This plan is 3a: server + Dacs Web; nothing for the phone (T17). |
| Q3 every tool item numbered | `tl_register` refuses a non-tool item (`NOT_A_TOOL`); `tl_choices` offers tool items only. |
| Q4 automatic numbers, never reused; brand / model / serial | `tl_tools.number` under the company lock (T3), `unique (owner_id, number)`; `details`. Tests: "numbers…", concurrency 2. |
| Q5 no money | No peso column or read; tests: "no money anywhere", the web suite's no-money scan, acceptance D8. |
| Q6 never quantity stock; Receiving without tool lines | `tl_no_tool_stock` (TOOL_ITEM / TOOL_LINE), `stk_overview` filter, `LINE_IS_STOCK`. Tests: section C; 2B suites `--with-0107`. |
| Q7 opening register, photo, condition, where; a person at a project (rev 2) | `tl_register` (T4); `PERSON_REQUIRED`. Tests: "at a project a tool always has a named responsible person…". |
| Q8 from a purchase line, never more; a person at a project (rev 2) | `tl_register` with `purchase_id` / `line_no` (T5); "Tools to register" (T6). |
| Q9 a project's tool is the company's; cost stays | No cost move anywhere; the tool returns to the warehouse like any other. |
| Q10 one state; a person always at a project (rev 2) | `tl_tools.state` + table checks (an issued tool has both a holder and a project); `tl_person`. |
| Q11 office records (team leaders in 3b) | `tl_actor` (T2). Tests: "who records…". |
| Q12 no acceptance step | No pending state on issue; "report a problem" comes with the phone (3b). |
| Q13 a project required, a request optional | `tl_issue` (`tl_project`, `tl_request_line`). |
| Q14 one tool fills a line once (rev 2–3) | `pr_*_bought` + `tl_covers` + `tl_bought_for` (T9). Tests: section F, concurrency 5; pilot T5, T7, T9, T10. |
| Q15 handover person to person | `tl_handover` (T11). Tests: "handover…"; concurrency 7. |
| Q16 condition on return; Retire waits; rejection → Under repair (rev 2) | `tl_return`, `tl_request_retire`, `tl_decide` (T7). Tests: section E; pilot T11–T12, T16. |
| Q17 Lost waits; rejection → exactly back; Found (rev 2) | `tl_report_lost`, `tl_decide`, `tl_found` (T8). Tests: section E; concurrency 6; pilot T13–T15. |
| Q18 never edited | `tl_reverse` (T10); history guards. Tests: section G. |
| Q19 no due dates; Tools out with days | `tl_overview.out` sorted by `since`; `tl_days`. |
| Q20 completing not blocked; the tools out named | `tl_project_out` + `_toolsOutNote` (T12). Tests: H and the web suite; pilot T17. |
| Q21 who sees what | Office: everything (no money in it). Workers / leaders: 3b. |
| Q22 lost answers on the phone | 3b; every write already takes an operation id (`pur_op_begin`), and a cancelled id is refused (tested). |
| Q23 the switch: on for the pilot, then kept or off (rev 2) | `tl_set_enabled` (main owner), TOOLS / OFF typed (T18). Tests: A; web wiring. |
| Q24 the pilot and its clean-up | Task 4; `3a_pilot_cleanup.sql` (T20), tested on a whole simulated pilot. |
| Deferred | Outside-job lending of tools (with outside-job release of materials); the Item history switch and office staff on the phone are separate follow-ups. |

**Placeholders:** none. **Names:** every function the screens call is granted in 0107 and listed in the web suite; every refusal code 0107 can send has a sentence (tested).

## Proof

Built in a scratch clone of Dacs Web on `d00b0eb`: Task 1 = `7fbdd14`, Task 2 = `93982b5` (revision 2 was `547c770` / `1a5c053`; revision 1 `cebd791` / `e92404d`) (each commit's suites green on its own).

- **Server (Task 1):** `3a_tools.pglite.mjs` — 45 tests: the switch and who (A); registering — numbers, the named person (anyone active in the company, never a client, partner, deactivated account or another company — T1 = C), items, the opening register's photo, a tool already damaged beyond repair, a tool registered at a project needing repair or missing parts (kept with its person, no handover until Repaired there — both conditions, refused before and handed over after; a return always allowed; a repair reversed), photo paths, purchase lines, "Tools to register" (B); never stock — TOOL_ITEM, TOOL_LINE, LINE_IS_STOCK, the purchase guards, ITEM_IN_USE (C); custody — issue, handover, return by condition, repaired (D); the owner — Retire and Lost confirmed, rejected (exactly back, to the millisecond and the days out), withdrawn, who decides (E); one tool fills a line once — not bought for it, bought for it, a line with an extra, the request link rules, request lines to fill, the shopping list's view and who may read it (F); reversals, history immutability, retries and a cancelled id (G); the readers, choices, tools out (with Additional Works), no money anywhere (H); what 0107 redefines word for word and the grants (I); the live acceptance script — passes and changes nothing, and fails on six spoiled databases (J); the clean-up — a whole pilot beside real data: the dry run changes nothing, the real run leaves only real data with the guards back on, and four spoiled pilots are stopped with nothing changed (K). `3a_concurrency.mjs` — 8 two-session tests on real PostgreSQL, 15 rounds each, no deadlock: the same tool issued twice; numbers; the last place on a purchase line; a correction against a registration; the last place on a request line (two tools; a purchase against a tool); the owner against a withdrawal; a handover against a return (one unbroken history).
- **Nothing else changed:** the 2A purchasing, payments and phone suites, 2B stock, 2C cost moves and 2B-b phone suites each re-run with 0107 on top (`--with-0107`): 243 checks, all as before.
- **Screens (Task 2):** `tools-admin.test.js` — 16 tests: every refusal 0107 can send has a sentence; every state, record kind and condition is the server's; actions by state (a tool needing repair at its project offers Repaired, never Hand over — on its page and in the Out list) and who may reverse match the server's code; the photo path is the shape `tl_photo` accepts; the forms refuse what the server would; no table read, no money, only granted functions; one operation id per form and the photo uploaded once; the nav run as code (Tools hidden until on, beside Stock and Purchasing for a focused account, never for a worker); Mark as Complete never blocked; the shopping list; the storage map.
- **Breakage run: 100 / 101 caught** — each rule broken on purpose, one at a time (75 in 0107, 6 in the clean-up, 4 in the acceptance script, 16 in the screens and their wiring), and a suite must fail; every file restored and compared byte for byte afterwards. Revision 3 added 6 breaks: a tool needing repair handed over, Repaired sending such a tool to the warehouse, Repaired restarting its days out, a good issued tool "repaired", and the screens offering Hand over for it (tool page and Out list). The full run of all 101 missed two besides the lock below — each a gap in the tests, closed and then caught: the acceptance script's photo check (D1b) could be deleted unnoticed (now a sixth spoiled database: an opening register accepted without a photo, which the script must stop at D1b; revision 2's run had counted this break as caught — it was not truly detected, which the full re-run exposed), and the Out list's "Repaired… instead of Hand over…" was not checked (the browser half is not run by the tests — now a source check). Revision 2 added 18 breaks, all caught: a damaged tool registered at a project, registered damaged with no Retire request, the opening register without a photo, a photo demanded from a purchase line too, a client allowed to hold a tool, office staff refused, an office account named like a worker, the picker leaving the office out, the acceptance script not checking the photo, and the screens' versions of these. Revision 1's first run missed four, each closed with a test and then caught: a rejected Lost report restoring a new "since" (the test compared times to the second — now to the millisecond, and the days out); a reversed issue still counted in the **line's** figure (only the portion's was checked); the shopping list's tools read by any account (now a worker, a team leader and a PM-only account read nothing); and a **purchase** racing a tool issue for the last place on a request line (new two-session test 8). **The one not caught** — removing the `pr_line:` lock from `tl_issue` — is redundant protection, not a gap: the request line's own row lock and its portions' already keep a purchase and a tool issue apart (test 8 passes either way); the lock is kept because purchases and stock take it in that order.
- **Not tested here:** the screens in a real browser (Task 2 Step 3 and the pilot), and the live database (Task 3's acceptance script). The live database was not changed; read-only queries only (tables, columns, counts).

## Rehearsal

The plan was applied **from its own text** to fresh clones of Dacs Web at `d00b0eb` (`_rehearse3a.py`: every Create block written as given, every Modify block through `git apply --ignore-whitespace`, then Step 1's CRLF restore) and every file compared with the tested build:

- **Plain:** all 27 files byte-identical to `93982b5`; Task 1 alone (16 files) byte-identical to `7fbdd14`; nothing stray.
- **With the user's own uncommitted one-space `admin.html` edit made first:** the same — `admin.html` = the tested file plus that edit.
