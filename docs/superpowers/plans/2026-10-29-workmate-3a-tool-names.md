# WorkMate 3a follow-ups TF1 + TF2 — telling tool holders apart, and where a waiting tool is (server + Dacs Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two small fixes the 3a ZZ pilot found. **TF1** — the office can tell two crew members with the same name apart wherever Tools names a person: "John Tapales (W-0005)" and "John Tapales (W-0007)". **TF2** — a tool waiting for the owner to approve its retirement says where it is and in what condition ("Warehouse · Damaged beyond repair"), and a tool reported lost from the warehouse says "Last at the warehouse".

**Architecture:** Every person Tools names comes from one server function, `tl_person_name` (0107). Migration **0108** redefines that one function so a named worker or team leader carries the worker number the crew and Attendance already use; nothing else on the server changes. On Dacs Web, `js/tools-admin.js` sets the team or role apart with " · " (no brackets inside brackets) and gains the missing places in `whereText`; Mark as Complete's note and the shopping list's "Issued:" say "TOOL-0004 with John Tapales (W-0007)".

**Tech stack:** PostgreSQL / Supabase (SQL), vanilla JS and Node tests, PGlite.

**Spec:** the findings **TF1** and **TF2** in the 3a plan's [Execution notes (29 October 2026)](2026-10-28-workmate-stage3a-tools.md) — the ZZ tools pilot; built on [3a](2026-10-28-workmate-stage3a-tools.md) (0107, live, tools **on** since 29 Oct).

**Repo:** **Dacs Web** only (base `067d412`). Task 1 = server, Task 2 = screens, Task 3 = live. WorkMate is untouched.

**Status:** Revision 1, 29 October 2026 — **approved by the user on 29 October 2026, rulings R1–R7 included** ("Proceed with Task 1 only … Don't apply 0108 live or push yet"). When approved, nothing was applied live and nothing was in the real repo. The code below was built and tested first in a scratch clone (one commit per task, every suite green after each), each new rule was broken on purpose to prove a test catches it (see *Proof*), and the plan was re-applied to fresh clones from its own text and compared byte for byte (see *Rehearsal*). The rulings R1–R7 are this plan's own decisions where the findings left a detail open.

## Global Constraints

- **No money.** Tools reads and writes no peso amount; nothing here touches expenses, Spent, Earned or Profit (CLAUDE.md, *Tools (0107)*).
- **Only `js/tools-admin.js` calls the `tl_*` operations**; Project Control (`tl_project_out`) and the shopping list (`tl_line_tools`) keep their one reader each.
- **A function change is a migration file**: **0108** (highest on disk is 0107), applied by the user in the Supabase SQL editor from the committed file — never an SQL-editor one-off.
- **Never `npm run build`.** Prove with `node --check`, `npm test` and `npm run test:sql`.
- **`admin.html` keeps the user's own uncommitted one-space edit**; Task 2 changes only three cache-busters in it.
- **CRLF files:** `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are CRLF. Task 1's Step 1 restores CRLF after applying (the diffs are shown with LF).
- **Out of scope — kept separate:** Stage 3b (tools on the phone, with 0E), office staff's stock access on the phone, and the Item history switch.

## Rulings (review these)

| # | Ruling |
|---|---|
| **R1** | **The number comes from the server.** 0108 redefines 0107's `tl_person_name` — the one function every Tools screen names people through: the responsible-person lists (Register, Issue, Hand over), the Out list, a tool's page and history, the shopping list's "Issued:" and Mark as Complete's note. One place, so they cannot disagree. *Not taken:* the web reading worker numbers through Requests' `pr_office_people` — that fixes the picker only, because the Out list, the history, the shopping list and the note carry names, not ids. |
| **R2** | **"John Tapales (W-0007)" — always, for every named worker and team leader**, not only when two share a name (a name can be shared tomorrow, and one rule reads the same everywhere). It is the number the crew, Attendance and Requests use, in Work Plan's "(W-0007)" form. A crew member with no name already reads "W-0007" and is not doubled. Office and owner accounts are unchanged (they have no worker number; live, none of the three does). |
| **R3** | **The picker sets the team or role apart with " · "**: "John Tapales (W-0007) · Team test", "staff · office" — no brackets inside brackets. |
| **R4** | **"with" between a tool and its person** where the number would nest brackets: Mark as Complete — "1 tool is still out on this project: TOOL-0004 with John Tapales (W-0007). They stay in Requests → Tools → Out…"; the shopping list — "Issued: **TOOL-0004** with John Tapales (W-0007), bought for this; **TOOL-0006** with Mark Frias (W-0021)" (tools now set apart by semicolons). |
| **R5** | **TF2 — every waiting tool says where it is.** Waiting for a Retire → "Warehouse · *its condition*" (a Retire is only ever asked for a tool Under repair — `tl_request_retire` refuses anything else — so it is always at the warehouse). Lost, or waiting for a Lost, with no holder (reported missing from the warehouse) → "Last at the warehouse" — the same gap, found while fixing TF2. Retired and cancelled stay blank. The tool's page and the Tools list both show it. |
| **R6** | **Nothing else changes names.** Requests, Purchasing and Work Plan keep `pr_person_name` / `pur_person_name`, untouched. The phone (0.9.0) calls no `tl_*` function. |
| **R7** | **Either order is safe live.** Without 0108 the screens simply show names without numbers. The plan applies 0108 first, then pushes. |

Live facts (29 Oct, read-only): 10 active crew (8 workers, 2 team leaders), every one named and numbered; one shared name ("John Tapales" ×2, W-0005 and W-0007); 3 active office / owner accounts, none with a worker number. Tools are on; no real tool is registered yet (checked again when this revision was finished: `tl_tools` 0 rows).

## File structure

| File | Task | Change |
|---|---|---|
| `supabase/migrations/0108_tools_crew_numbers.sql` | 1 | **New** — `tl_person_name` with the crew's worker number |
| `supabase/tests/3a_tools.pglite.mjs` | 1 | `--with-0108`: the whole suite on top of 0108, and section L (the names) |
| `package.json` | 1 | `test:sql` runs `3a_tools.pglite.mjs --with-0108` |
| `supabase/migrations/README.md`, `docs/DATABASE_SCHEMA.md` (CRLF) | 1 | 0108 described; next number 0109 |
| `js/tools-admin.js` | 2 | `whereText` (TF2), `personLabel` (" · ") |
| `js/expenses-module.js` | 2 | Mark as Complete's note: "TOOL-0004 with …" |
| `js/purchasing-admin-list.js` | 2 | The shopping list's "Issued:": "TOOL-0004 with …", semicolons |
| `admin.html` | 2 | Cache-busters of the three scripts → `20261029a` (keeps the user's edit) |
| `tests/tools-admin.test.js` | 2 | The labels, the places, the two wordings |

---

### Task 1: Server — 0108, its tests, the docs

**Interfaces:**
- Produces: `tl_person_name(uuid) → text` — a worker or team leader with a display name: `display_name || ' (W-' || lpad(worker_no, 4, '0') || ')'` (when it has a number); otherwise exactly 0107's result. Same grants (nobody calls it directly).

**Files:**
- Create: `supabase/migrations/0108_tools_crew_numbers.sql`
- Modify: `supabase/tests/3a_tools.pglite.mjs`
- Modify: `package.json`
- Modify: `supabase/migrations/README.md`
- Modify: `docs/DATABASE_SCHEMA.md`

**Create:** `supabase/migrations/0108_tools_crew_numbers.sql`

```sql
-- 0108 — WorkMate Stage 3a follow-up TF1: crew names in Tools carry their
-- worker number.
--
-- Plan: docs/superpowers/plans/2026-10-29-workmate-3a-tool-names.md.
--
-- ── WHY. Two active workers share the name "John Tapales" (W-0005 and
--    W-0007), and the Tools screens named a holder by name alone — the
--    responsible-person list, the Out list, a tool's page and history, the
--    shopping list's "Issued:" and Mark as Complete's tools-out note — so the
--    office could not tell them apart (found in the 3a ZZ pilot, 29 Oct).
--    Every one of those names comes from tl_person_name (0107), so this one
--    function changes them all: a worker or team leader with a display name
--    now reads "John Tapales (W-0007)". One with no display name already reads
--    "W-0007" (pr_person_name) and is not doubled; office and owner accounts
--    have no worker number and are unchanged. Requests, Purchasing and Work
--    Plan keep their own names (pr_person_name / pur_person_name, untouched).
--
-- ── SAFE. CREATE OR REPLACE keeps the function's grants (nobody may call it
--    directly; only 0107's security-definer readers do). No table, policy or
--    data changes; no money anywhere.

create or replace function tl_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when p.role in ('worker', 'teamLeader')
              then pr_person_name(p.id)
                   || case when nullif(btrim(p.display_name), '') is not null and p.worker_no is not null
                           then ' (W-' || lpad(p.worker_no::text, 4, '0') || ')' else '' end
              else pur_person_name(p.id) end
    from profiles p where p.id = p_id
$$;

revoke all on function tl_person_name(uuid) from public, anon, authenticated;

-- Check (read-only): the crew with their numbers, the office unchanged.
-- select role, tl_person_name(id) from profiles
--  where role in ('worker', 'teamLeader', 'staff', 'owner') and coalesce(status, 'active') = 'active' order by 2;
```

**Modify:** `supabase/tests/3a_tools.pglite.mjs`

```diff
diff --git a/supabase/tests/3a_tools.pglite.mjs b/supabase/tests/3a_tools.pglite.mjs
index 7e05a2f..25a2b0a 100644
--- a/supabase/tests/3a_tools.pglite.mjs
+++ b/supabase/tests/3a_tools.pglite.mjs
@@ -6,6 +6,8 @@
 // memory) over the 2B-b suite's tables. Nothing here talks to the live
 // database; supabase/tests/3a_acceptance.sql repeats the key cases there,
 // rolled back.
+// --with-0108: and 0108 (crew names with their worker numbers, TF1) on top —
+// every test here holds, and section L checks the names.
 // ════════════════════════════════════════════════════════════════════
 import { PGlite } from '@electric-sql/pglite';
 import fs from 'node:fs';
@@ -30,6 +32,8 @@ const M104 = mig('0104_stock.sql');
 const M105 = mig('0105_stock_cost_moves.sql');
 const M106 = mig('0106_workmate_phone_stock.sql');
 const M107 = mig('0107_tools.sql');
+const WITH_0108 = process.argv.includes('--with-0108');
+const M108 = WITH_0108 ? mig('0108_tools_crew_numbers.sql') : '';
 const M85 = mig('0085_workmate_requests.sql');
 const M51 = mig('0051_attendance_worker_owner.sql');
 const REQUESTS_0085 = `
@@ -127,6 +131,7 @@ async function fresh(opts = {}) {
   await db.exec(REQUESTS_0085);
   await db.exec(M106);
   await db.exec(M107);
+  if (M108) await db.exec(M108);
   await db.exec(`insert into profiles (id, role, owner_id, status, allowed_modules, email, display_name) values
     ('${OWNER}', 'owner', null, 'active', null, 'admin@dacs.test', null),
     ('${STAFF}', 'staff', '${OWNER}', 'active', null, 'staff@dacs.test', 'Ana'),
@@ -1068,5 +1073,57 @@ await test('the clean-up stops (and changes nothing) when ZZ and real tools are
   }
 });
 
+// ── L. 0108 (TF1): the crew by name and worker number, everywhere Tools names a person ──
+if (WITH_0108) {
+  const numbered = async () => {
+    const db = await fresh();
+    await db.exec(`update profiles set worker_no = 7 where id = '${WORKER}';
+                   update profiles set worker_no = 21 where id = '${LEADER}';
+                   update profiles set worker_no = 5 where id = '${OWNER}';
+                   insert into profiles (id, role, owner_id, status, display_name, worker_no)
+                     values ('00000000-0000-0000-0000-0000000000d9', 'worker', '${OWNER}', 'active', '  ', 9);`);
+    return db;
+  };
+  await test('0108: a named worker or team leader reads "Name (W-0007)"; one with no name stays "W-0009"; office and owner unchanged', async () => {
+    const db = await numbered();
+    const ch = await rpc(db, STAFF, 'tl_choices', []);
+    eq(ch.people.map(p => p.name), ['admin', 'admin-exp', 'Ana', 'Juan', 'Lito (W-0021)', 'Mark (W-0007)', 'Pia', 'Rey', 'W-0009'],
+       'a number on an owner account is not shown; a worker with no number keeps the name alone');
+  });
+  await test('0108: the numbered name is on the tool, its records, the Out list, Mark as Complete and the shopping list', async () => {
+    const db = await numbered();
+    const g = await item(db, 'Grinder');
+    const f = await folder(db, 'House');
+    const rq = await request(db, f, { item: g, quantity: 1, description: 'Grinder' });
+    const t = await one1(db, STAFF, { item_id: g });
+    await issue(db, STAFF, { tool_id: t, holder_id: WORKER, folder_id: f, request_line_id: rq.line });
+    await handover(db, STAFF, { tool_id: t, holder_id: LEADER, folder_id: f });
+    const one_ = await rpc(db, STAFF, 'tl_tool', [t]);
+    eq(one_.holder_name, 'Lito (W-0021)');
+    eq(one_.records.filter(r => r.kind !== 'register').map(r => [r.kind, r.holder_name, r.from_holder_name]),
+       [['handover', 'Lito (W-0021)', 'Mark (W-0007)'], ['issue', 'Mark (W-0007)', null]]);
+    eq((await rpc(db, STAFF, 'tl_overview', [])).out.map(x => x.holder_name), ['Lito (W-0021)']);
+    eq((await rpc(db, OWNER, 'tl_project_out', [f])).map(x => x.holder_name), ['Lito (W-0021)']);
+    eq((await rpc(db, BUYER, 'tl_line_tools', [`{${rq.line}}`]))[rq.line].tools.map(x => x.holder_name), ['Mark (W-0007)'],
+       'the shopping list names whom it was issued to for the line');
+  });
+  await test('0108 changes tl_person_name alone, and only for the crew; nobody may call it', async () => {
+    const mine = fnText(M108, 'tl_person_name');
+    const theirs = fnText(M107, 'tl_person_name');
+    eq(mine.replace(`
+                   || case when nullif(btrim(p.display_name), '') is not null and p.worker_no is not null
+                           then ' (W-' || lpad(p.worker_no::text, 4, '0') || ')' else '' end`, '')
+           .replace(`case when p.role in ('worker', 'teamLeader')
+              then pr_person_name(p.id)
+              else`, `case when p.role in ('worker', 'teamLeader') then pr_person_name(p.id) else`),
+       theirs);
+    eq((M108.match(/create or replace function/g) || []).length, 1, 'one function');
+    const db = await fresh();
+    for (const role of ['authenticated', 'anon']) {
+      eq((await one(db, `select has_function_privilege($1, 'tl_person_name(uuid)', 'execute') x`, [role])).x, false, role);
+    }
+  });
+}
+
 console.log('\n' + passed + ' passed, ' + failed + ' failed');
 if (failed) { console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
```

**Modify:** `package.json`

```diff
diff --git a/package.json b/package.json
index 071a369..c1c36e0 100644
--- a/package.json
+++ b/package.json
@@ -4,7 +4,7 @@
     "build": "node -e \"console.error('\\n*** BUILD DISABLED (2026-07-03) ***\\njs/portal-app.compiled.js IS the source of truth — edit it directly.\\nThe stale JSX source was deleted on 2026-07-28; there is nothing to build from.\\nSee README.md section 13.\\n'); process.exit(1)\"",
     "build:watch": "npm run build",
     "build:prod": "npm run build",
-    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/3a_tools.pglite.mjs && node supabase/tests/3a_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0107 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0107 && node supabase/tests/2a3_server.pglite.mjs --with-0107 && node supabase/tests/2a4_payments.pglite.mjs --with-0107 && node supabase/tests/2b_stock.pglite.mjs --with-0107 && node supabase/tests/2c_cost.pglite.mjs --with-0107 && node supabase/tests/2bb_phone.pglite.mjs --with-0107 && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
+    "test:sql": "npm --prefix supabase/tests install --no-package-lock --no-audit --no-fund && node supabase/tests/2a1_purchase.pglite.mjs && node supabase/tests/2a1_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0097 && node supabase/tests/2a2_purchasing.pglite.mjs && node supabase/tests/2a2_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0101 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0101 && node supabase/tests/2a3_server.pglite.mjs && node supabase/tests/2a3_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0102 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0102 && node supabase/tests/2a3_server.pglite.mjs --with-0102 && node supabase/tests/2a4_payments.pglite.mjs && node supabase/tests/2a4_payments.pglite.mjs --with-0103 && node supabase/tests/2a4_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0104 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0104 && node supabase/tests/2a3_server.pglite.mjs --with-0104 && node supabase/tests/2a4_payments.pglite.mjs --with-0104 && node supabase/tests/2b_stock.pglite.mjs && node supabase/tests/2b_concurrency.mjs && node supabase/tests/2b_stock.pglite.mjs --with-0105 && node supabase/tests/2a1_purchase.pglite.mjs --with-0105 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0105 && node supabase/tests/2a3_server.pglite.mjs --with-0105 && node supabase/tests/2a4_payments.pglite.mjs --with-0105 && node supabase/tests/2c_cost.pglite.mjs && node supabase/tests/2c_concurrency.mjs && node supabase/tests/2bb_phone.pglite.mjs && node supabase/tests/2bb_concurrency.mjs && node supabase/tests/3a_tools.pglite.mjs && node supabase/tests/3a_concurrency.mjs && node supabase/tests/2a1_purchase.pglite.mjs --with-0107 && node supabase/tests/2a2_purchasing.pglite.mjs --with-0107 && node supabase/tests/2a3_server.pglite.mjs --with-0107 && node supabase/tests/2a4_payments.pglite.mjs --with-0107 && node supabase/tests/2b_stock.pglite.mjs --with-0107 && node supabase/tests/2c_cost.pglite.mjs --with-0107 && node supabase/tests/2bb_phone.pglite.mjs --with-0107 && node supabase/tests/3a_tools.pglite.mjs --with-0108 && node supabase/tests/pm_sharing.pglite.mjs && node supabase/tests/pm_sharing_concurrency.mjs && node supabase/tests/pm_cash_advances.pglite.mjs && node supabase/tests/pm_cash_advances_concurrency.mjs"
   },
   "devDependencies": {
     "esbuild": "^0.28.0",
```

**Modify:** `supabase/migrations/README.md`

````diff
diff --git a/supabase/migrations/README.md b/supabase/migrations/README.md
index 3e4910b..34a5dc3 100644
--- a/supabase/migrations/README.md
+++ b/supabase/migrations/README.md
@@ -6,8 +6,8 @@
 one-offs — that habit is why `0020_schema_drift_catchup.sql`, `0025` and the drift they
 capture exist. Write the migration, apply the migration, commit the migration.
 
-- **Next number = highest existing + 1** (**0108** — highest on disk is
-  `0107_tools.sql`). Sort the folder before you pick; don't
+- **Next number = highest existing + 1** (**0109** — highest on disk is
+  `0108_tools_crew_numbers.sql`). Sort the folder before you pick; don't
   trust this line if it looks stale. Duplicate numbers are how we got into trouble.
 - **`0075` and `0076` are TAKEN but not on `main`.** They belong to the abandoned
   project cost-plan branch (`project_cost_plans`, then its `%` columns) and **both
@@ -200,6 +200,8 @@ file creates the policy only when it is missing, so applying it live changes not
 
 **0107 (WorkMate Stage 3a — tools: a numbered register, custody, condition-aware returns; OUTSIDE the money model)** adds five private tables (RLS on, no policies — reads and writes only through its functions): `tl_settings` (the company's tools switch, main owner only; every write is refused `TOOLS_OFF` until it is on — first for the ZZ pilot, then kept on or switched off), `tl_tools` (one real tool: `number` per company — TOOL-0001…, never reused; its catalogue item, which must be of kind `tool`; the purchase line it came from, if any; brand / model / serial; one photo under `uploads/tools/<company>/`; `state` available / issued / repair / lost_pending / lost / retire_pending / retired / cancelled; `condition`; `holder_id` + `folder_id` — an issued tool always has both: **a tool at a project always has a named responsible person**), `tl_records` (one action on one tool, with the tool's custody `before` and `after` it: register, issue, handover, return, repaired, lost, found, retire; Lost and Retire wait for the **main owner** — confirm → `after`, reject or withdraw → `before`, so a rejected Lost report puts the tool exactly back and a rejected Retire leaves it Under repair; a mistake is reversed with a reason while it is the tool's latest record, never edited), `tl_covers` (what an issue filled on a tool request line when the tool was NOT bought for it) and the append-only `tl_events`. Redefines 0104's `pr_portion_bought` / `pr_line_bought` as purchases + stock + tools (`pr_*_from_tools`), so every Still to buy counts a tool issued for the line once — a tool bought for the line counts through its purchase only (`tl_bought_for`); 0104's `stk_overview` (Receiving leaves out tool lines — `tl_tool_line`) and `pr_item_in_use` (tools fix an item's kind and unit). Triggers: a tool item is never quantity stock (`tl_no_tool_stock` on `stk_matches` / `stk_lots` / `stk_records` — `TOOL_ITEM`; a line with tools registered from it — `TOOL_LINE`); a purchase line keeps at least the tools registered from it, checked at the end of the transaction because a correction re-inserts every line (`tl_guard_line`, deferred — `TOOLS_IN_USE`), and such a purchase is never voided (`tl_guard_void`). Callable: `tl_register`, `tl_issue`, `tl_handover`, `tl_return`, `tl_repaired`, `tl_report_lost`, `tl_request_retire`, `tl_found`, `tl_decide` (main owner), `tl_reverse`, `tl_overview`, `tl_tool`, `tl_choices`, `tl_request_lines`, `tl_project_out` (Project Control's Mark as Complete), `tl_line_tools` (the shopping list), `tl_status`, `tl_set_enabled` (main owner). Who: owner and office staff allowed Expenses (stock's rule); workers and team leaders record nothing in 3a. **Writes and reads no peso amount**; nothing touches expenses, Spent, Earned or Profit. Requires 0104 (and 0105/0106 on the live order). Prove with `npm run test:sql` (`3a_tools.pglite.mjs`, `3a_concurrency.mjs`, and the 2A / 2B / 2C / 2B-b suites re-run `--with-0107`) and `node tests/tools-admin.test.js`; live: `supabase/tests/3a_acceptance.sql` (self-wrapped, rolls back).
 
+**0108 (WorkMate Stage 3a follow-up TF1 — crew names in Tools with their worker numbers)** redefines 0107's `tl_person_name` alone: a worker or team leader with a display name reads "Name (W-0007)" wherever Tools names a person — the responsible-person lists, the Out list, a tool's page and history, the shopping list's "Issued:" and Mark as Complete's note — because two crew members may share a name (the 3a pilot found two "John Tapales"). One with no display name already reads "W-0007" and is not doubled; office and owner accounts are unchanged. Requests, Purchasing and Work Plan names are untouched. No table, grant or data change; no money. Requires 0107. Prove with `npm run test:sql` (`3a_tools.pglite.mjs --with-0108`).
+
 Get the truth before relying on this line:
 
 ```sql
````

**Modify:** `docs/DATABASE_SCHEMA.md`

```diff
diff --git a/docs/DATABASE_SCHEMA.md b/docs/DATABASE_SCHEMA.md
index 9b79e35..1577385 100644
--- a/docs/DATABASE_SCHEMA.md
+++ b/docs/DATABASE_SCHEMA.md
@@ -1223,6 +1223,8 @@ Every real tool, numbered, and who answers for it — **no money**: a tool's cos
 
 Covered (every Still to buy): `pr_line_bought` = purchases + stock + tools. A return or a handover keeps a line filled; reversing an issue reopens it only if that issue counted on its own.
 
+Names: every person on these screens comes from `tl_person_name` — since **0108** the crew as "Name (W-0007)" (two crew members may share a name), or "W-0007" with no name; office and owner accounts by their name or e-mail.
+
 ## PM profit sharing (0098)
 
 An internal owner/partner allocation per PM project - **outside the money model** (never a payout, invoice or accounting entry). Spec `docs/superpowers/specs/2026-10-18-pm-profit-sharing-mvp-terms.md`; plan `docs/superpowers/plans/2026-10-18-pm-profit-sharing.md`. `project_id` is a `construction_projects.id` (never a `folders.id`). The three tables have **RLS on, no policies, and all privileges revoked** from `anon`/`authenticated`: nothing reads or writes them directly. Read through `pm_sharing_read` (owner-role accounts of the company); write through `pm_set_sharing` (main owner only).
```

- [ ] **Step 1: Apply the files above** in Dacs Web. Create blocks as given; Modify blocks with `git apply --ignore-whitespace`. Then put the two CRLF files back to CRLF everywhere:

```bash
node -e "for (const f of ['supabase/migrations/README.md','docs/DATABASE_SCHEMA.md']) { const fs=require('fs'); const s=fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n'); fs.writeFileSync(f, s.replace(/\n/g,'\r\n')); }"
```

- [ ] **Step 2: Tests.** `npm run test:sql` → every suite passes (**44** suites, **1,354** tests, none failed — before this plan 43 / 1,306, plus the new run's 48), including `3a_tools.pglite.mjs` (**45**, unchanged) and the new `3a_tools.pglite.mjs --with-0108` (**48**: all 45 on top of 0108, plus section L). `npm test` → every suite passes (**42**; `workmate-workplan.test.js` checks the README's next number).
- [ ] **Step 3: Stop for the user** to review and commit. Do not push.

### Task 2: Screens — numbered names in their places, a waiting tool's place

**Interfaces:**
- Consumes: Task 1's names (the screens work without them too — R7).
- Produces: `ToolsAdmin.whereText(tool)` — adds `retire_pending` → "Warehouse · *condition*", `lost` / `lost_pending` without a holder → "Last at the warehouse"; `ToolsAdmin.personLabel(p)` → "*name* · *team(s) or role*".

**Files:**
- Modify: `js/tools-admin.js`
- Modify: `js/expenses-module.js`
- Modify: `js/purchasing-admin-list.js`
- Modify: `admin.html`
- Modify: `tests/tools-admin.test.js`

**Modify:** `js/tools-admin.js`

```diff
diff --git a/js/tools-admin.js b/js/tools-admin.js
index 7b42e6d..aa868aa 100644
--- a/js/tools-admin.js
+++ b/js/tools-admin.js
@@ -68,8 +68,10 @@
         if (t.state === 'issued') return t.holder_name + ' · ' + t.folder_name + ' · ' + daysText(t.days) +
             (t.condition && t.condition !== 'good' ? ' · ' + conditionLabel(t.condition) + ' — not usable until repaired' : '');
         if ((t.state === 'lost' || t.state === 'lost_pending') && t.holder_name) return 'Last with ' + t.holder_name + (t.folder_name ? ' · ' + t.folder_name : '');
+        if (t.state === 'lost' || t.state === 'lost_pending') return 'Last at the warehouse';
         if (t.state === 'available') return 'Warehouse';
-        if (t.state === 'repair') return 'Warehouse · ' + conditionLabel(t.condition);
+        // A Retire waits on a tool Under repair — still at the warehouse, in its condition (TF2).
+        if (t.state === 'repair' || t.state === 'retire_pending') return 'Warehouse · ' + conditionLabel(t.condition);
         return '';
     }
 
@@ -147,10 +149,11 @@
         return out;
     }
 
-    // People as options: "Mark (Masons)", "Ana (office)". Anyone active in the company may hold a tool (T1 = C).
+    // People as options: "Mark (W-0007) · Masons", "Ana · office" — the crew's worker number comes with
+    // the name (0108, TF1). Anyone active in the company may hold a tool (T1 = C).
     const ROLE_LABEL = { teamLeader: 'team leader', staff: 'office', owner: 'owner' };
     function personLabel(p) {
-        return p.name + (p.teams && p.teams.length ? ' (' + p.teams.join(', ') + ')' : ROLE_LABEL[p.role] ? ' (' + ROLE_LABEL[p.role] + ')' : '');
+        return p.name + (p.teams && p.teams.length ? ' · ' + p.teams.join(', ') : ROLE_LABEL[p.role] ? ' · ' + ROLE_LABEL[p.role] : '');
     }
 
     // Projects to pick: not completed — and the tool's own project, kept even if completed.
```

**Modify:** `js/expenses-module.js`

```diff
diff --git a/js/expenses-module.js b/js/expenses-module.js
index 0656805..0cc9a8a 100644
--- a/js/expenses-module.js
+++ b/js/expenses-module.js
@@ -7547,7 +7547,7 @@ async function _toolsOutNote(id) {
     } catch (_) { out = []; }
     if (!out.length) return '';
     return '\n\n' + out.length + (out.length === 1 ? ' tool is' : ' tools are') + ' still out on this project: '
-        + out.map(t => t.label + ' (' + t.holder_name + ')').join(', ')
+        + out.map(t => t.label + ' with ' + t.holder_name).join(', ')
         + '. They stay in Requests → Tools → Out until returned or handed over.';
 }
 async function markFolderComplete(id) {
```

**Modify:** `js/purchasing-admin-list.js`

```diff
diff --git a/js/purchasing-admin-list.js b/js/purchasing-admin-list.js
index 3856861..2aeaeda 100644
--- a/js/purchasing-admin-list.js
+++ b/js/purchasing-admin-list.js
@@ -109,8 +109,8 @@
                   // 0107 (Q14): each tool issued for this line — one bought for it
                   // counts through its purchase, once.
                   (l._tools && l._tools.tools.length
-                    ? '<div class="pur-instock"><i data-lucide="wrench"></i> Issued: ' + l._tools.tools.map(t => '<strong>' + esc(t.label) + '</strong> (' +
-                      esc(t.holder_name) + (t.counted ? '' : ', bought for this') + ')').join(', ') + '</div>'
+                    ? '<div class="pur-instock"><i data-lucide="wrench"></i> Issued: ' + l._tools.tools.map(t => '<strong>' + esc(t.label) + '</strong> with ' +
+                      esc(t.holder_name) + (t.counted ? '' : ', bought for this')).join('; ') + '</div>'
                     : '') +
                 '</div>' +
                 figures(l) +
```

**Modify:** `admin.html`

```diff
diff --git a/admin.html b/admin.html
index 7cc73ec..224ef1f 100644
--- a/admin.html
+++ b/admin.html
@@ -5419,7 +5419,7 @@
 <script src="js/print-utils.js"></script>
 <script src="js/receipt-storage.js?v=20261016a"></script>
 <script src="js/expense-split-rows.js?v=20261028a"></script>
-<script src="js/expenses-module.js?v=20261026a"></script>
+<script src="js/expenses-module.js?v=20261029a"></script>
 <script src="js/overhead-module.js"></script>
 <script src="js/reimbursement-module.js"></script>
 <script src="js/construction-module.js"></script>
@@ -5434,14 +5434,14 @@
 <script src="js/requests-admin-history.js?v=20261012a"></script>
 <script src="js/requests-admin-gallery.js?v=20261012a"></script>
 <script src="js/purchasing-admin-core.js?v=20261026a"></script>
-<script src="js/purchasing-admin-list.js?v=20261026a"></script>
+<script src="js/purchasing-admin-list.js?v=20261029a"></script>
 <script src="js/purchasing-admin-record.js?v=20261022b"></script>
 <script src="js/purchasing-admin-purchases.js?v=20261026a"></script>
 <script src="js/purchasing-admin-pay.js?v=20261023a"></script>
 <script src="js/purchasing-admin-cash.js?v=20261023b"></script>
 <script src="js/stock-admin.js?v=20261028a"></script>
 <script src="js/stock-cost-admin.js?v=20261026a"></script>
-<script src="js/tools-admin.js?v=20261028a"></script>
+<script src="js/tools-admin.js?v=20261029a"></script>
 <script src="js/workplan-admin-core.js?v=20261013a"></script>
 <script src="js/workplan-admin-form.js?v=20261014a"></script>
 <script src="js/workplan-admin-board.js?v=20261014a"></script>
```

**Modify:** `tests/tools-admin.test.js`

```diff
diff --git a/tests/tools-admin.test.js b/tests/tools-admin.test.js
index 54884c9..3cedae1 100644
--- a/tests/tools-admin.test.js
+++ b/tests/tools-admin.test.js
@@ -149,11 +149,13 @@ test('pickers: completed projects only where the tool already is; requests of th
                  { line_id: 'l3', description: 'Any grinder', catalog_item_id: null, still_to_buy: 2, unit: 'pc', requester_name: 'Rey' },
                  { line_id: 'l4', description: 'Grinder', catalog_item_id: 'g', still_to_buy: 0, unit: 'pc', requester_name: 'Rey' }];
   eq(ta.requestOptions(lines, 'g').map(o => o.value), ['l1', 'l3'], 'its item or none, with something still to fill');
-  eq(ta.personLabel({ name: 'Lito', role: 'teamLeader', teams: ['Masons'] }), 'Lito (Masons)');
-  eq(ta.personLabel({ name: 'Ben', role: 'teamLeader', teams: [] }), 'Ben (team leader)');
-  eq(ta.personLabel({ name: 'Ana', role: 'staff', teams: [] }), 'Ana (office)', 'office staff may hold a tool (T1 = C)');
-  eq(ta.personLabel({ name: 'admin', role: 'owner' }), 'admin (owner)');
+  eq(ta.personLabel({ name: 'Lito', role: 'teamLeader', teams: ['Masons'] }), 'Lito · Masons');
+  eq(ta.personLabel({ name: 'Ben', role: 'teamLeader', teams: [] }), 'Ben · team leader');
+  eq(ta.personLabel({ name: 'Ana', role: 'staff', teams: [] }), 'Ana · office', 'office staff may hold a tool (T1 = C)');
+  eq(ta.personLabel({ name: 'admin', role: 'owner' }), 'admin · owner');
   eq(ta.personLabel({ name: 'Mark', role: 'worker', teams: [] }), 'Mark');
+  eq(ta.personLabel({ name: 'John Tapales (W-0007)', role: 'worker', teams: ['Team test'] }), 'John Tapales (W-0007) · Team test',
+     'two crew with one name told apart by the number the server adds (0108, TF1) — no brackets inside brackets');
 });
 
 test('records and places in words', () => {
@@ -163,6 +165,11 @@ test('records and places in words', () => {
   eq(ta.recordText({ kind: 'register', condition: 'good' }), 'Registered at the warehouse');
   eq(ta.whereText({ state: 'issued', holder_name: 'Mark', folder_name: 'House', days: 9 }), 'Mark · House · 9 days');
   eq(ta.whereText({ state: 'repair', condition: 'needs_repair' }), 'Warehouse · Needs repair');
+  eq(ta.whereText({ state: 'retire_pending', condition: 'damaged' }), 'Warehouse · Damaged beyond repair', 'waiting for a Retire: its place and condition (TF2)');
+  eq(ta.whereText({ state: 'lost_pending', condition: 'good' }), 'Last at the warehouse', 'reported lost from the warehouse');
+  eq(ta.whereText({ state: 'lost', condition: 'missing_parts' }), 'Last at the warehouse');
+  eq(ta.whereText({ state: 'lost', holder_name: 'Rey', folder_name: 'House' }), 'Last with Rey · House');
+  eq([ta.whereText({ state: 'retired' }), ta.whereText({ state: 'cancelled' })], ['', ''], 'nothing to say once retired or cancelled');
   eq(ta.whereText({ state: 'issued', holder_name: 'Mark', folder_name: 'House', days: 2, condition: 'missing_parts' }),
      'Mark · House · 2 days · Missing parts — not usable until repaired');
   eq(ta.recordText({ kind: 'repaired', holder_name: 'Mark', folder_name: 'House' }), 'Repaired — still with Mark · House');
@@ -254,6 +261,7 @@ test('Mark as Complete names the tools still out — never blocks (Q20)', () =>
   ok(/if \(!window\.currentToolsOn\) return '';/.test(note), 'nothing while tools are off');
   ok(/rpc\('tl_project_out', \{ p_folder: id \}\)/.test(note), 'the server lists them (the project and its jobs)');
   ok(/catch \(_\) \{ out = \[\]; \}/.test(note), 'a failed read never blocks completing');
+  ok(/out\.map\(t => t\.label \+ ' with ' \+ t\.holder_name\)\.join\(', '\)/.test(note), '"TOOL-0004 with John Tapales (W-0007)" — no brackets inside brackets');
   ok(!/return;|throw/.test(note.replace(/return '';/g, '').replace(/return '\\n\\n'/, '')), 'no way to stop the completion');
   ok(/document\.getElementById\('deleteConfirmMsg'\)\.textContent = message;/.test(exp), 'shown as text (names cannot inject markup)');
   ok(/t\.folder_id in \(select f\.id from folders f where f\.owner_id = v_owner\s+and \(f\.id = p_folder or f\.parent_folder_id = p_folder\)\)/.test(SQL), 'server: the project and its Additional Works');
@@ -267,6 +275,8 @@ test('the shopping list shows tools issued for a line (bought for it, or counted
   ok(/' tools issued · '/.test(list), 'each weekly portion\'s');
   ok(/\(t\.counted \? '' : ', bought for this'\)/.test(list), 'a tool bought for the line says so (counted through its purchase)');
   ok(/esc\(t\.label\)/.test(list) && /esc\(t\.holder_name\)/.test(list), 'escaped');
+  ok(/'<\/strong> with ' \+\s+esc\(t\.holder_name\) \+ \(t\.counted \? '' : ', bought for this'\)\)\.join\('; '\)/.test(list),
+     '"TOOL-0004 with John Tapales (W-0007), bought for this" — tools set apart by semicolons');
 });
 
 test('tool photos: their own folder, office only, in the storage map', () => {
```

- [ ] **Step 1: Apply the files above** in Dacs Web (Modify blocks with `git apply --ignore-whitespace` — `admin.html` keeps the user's own edit).
- [ ] **Step 2: Tests.** `node --check` on `js/tools-admin.js`, `js/expenses-module.js`, `js/purchasing-admin-list.js`. `npm test` → every suite passes (**42**), the money suite included (the one `expenses-module.js` change is a sentence in Mark as Complete's confirm).
- [ ] **Step 3: Stop for the user** to review and commit. Do not push.

### Task 3: Live — 0108, the web pushed, checked

- [ ] **Step 1: Before (MCP, read-only):** `tl_person_name`'s live body still matches 0107's (`md5(replace(prosrc, chr(13), ''))` = `7bb8a46fac8821a64f6912e7695bb8c6` — so it read on 29 Oct); tools are on; note `select role, tl_person_name(id) from profiles where role in ('worker','teamLeader','staff','owner') and coalesce(status,'active') = 'active'`.
- [ ] **Step 2: The user applies the committed 0108** — the whole file, unchanged, once, in the Supabase SQL editor.
- [ ] **Step 3: Verify (read-only):** the live body matches 0108's (`ac3f2d7e47c051f522f19c56047ce662`); `has_function_privilege` false for `authenticated` and `anon`; the names query now reads every named crew member with their number — the two "John Tapales" as (W-0005) and (W-0007) — and the office accounts exactly as in Step 1; no other function changed (0107's other bodies still match).
- [ ] **Step 4: The user pushes Dacs Web** (Tasks 1–2). Check the live site serves the committed `js/tools-admin.js`, `js/expenses-module.js`, `js/purchasing-admin-list.js` and `admin.html` with `?v=20261029a`.
- [ ] **Step 5: Browser check (owner, then staff@) — nothing saved:**

| # | Check | Expect |
|---|---|---|
| B1 | Requests → Tools → **Register tools** → place "With someone at …" → open **Responsible person**; then **Cancel** | "John Tapales (W-0005)" and "John Tapales (W-0007) · Team test" — told apart; office accounts "… · office" / "… · owner" |
| B2 | Any tool page or the **Out** list, if the office has issued a real tool by then | The holder reads "Name (W-00nn) · project · days" |
| B3 | `client_errors` since the push | Nothing new |

TF2's words show only on a tool waiting for a Retire or reported lost from the warehouse; with no such real tool there is nothing to look at, and the screens' test covers them (no ZZ data is made for this).

- [ ] **Step 6: Execution notes** in this plan; memory updated.

---

## Self-review

| Finding | Where |
|---|---|
| TF1 — two "John Tapales" in the person lists | 0108 `tl_person_name` (R1, R2) — every Tools name at once; the picker's " · " (R3); the two wordings (R4). Tests: section L (names in choices, tool, records, Out, Mark as Complete, shopping list; nameless not doubled; office / owner unchanged; one function, grants unchanged); `tools-admin.test.js` (labels, wordings). |
| TF2 — a tool waiting for Retire shows no place or condition | `whereText` (R5), and the same gap for Lost from the warehouse. Tests: `tools-admin.test.js` "records and places in words". |
| Kept separate | Stage 3b, office stock on the phone, the Item history switch — not touched. |

**Placeholders:** none. **Names:** `tl_person_name`, `whereText`, `personLabel`, `_toolsOutNote` exist today with these names; no new function is called by the screens.

## Proof

Built in a scratch clone of Dacs Web on `067d412`: Task 1 = `474922e`, Task 2 = `f7ef8d2` (each commit's suites green on its own: `npm test` 42 suites at each; `npm run test:sql` on `f7ef8d2` — Task 2 changes no server or test-runner file).

- **Server (Task 1):** `3a_tools.pglite.mjs` — 45 tests as before; with `--with-0108`, the same 45 on top of 0108 (the existing names have no worker number, so they read as before) plus section L — 3 tests: the people list ("Lito (W-0021)", "Mark (W-0007)", a nameless "W-0009" not doubled, an owner account with a number left alone, office unchanged); the numbered name on the tool, its records (to and from), the Out list, Mark as Complete and the shopping list (which names whom the tool was issued to for the line); 0108 differs from 0107 in that one clause only, is one function, and nobody may call it. `npm run test:sql` **44** suites, **1,354** tests, none failed — before this plan 43 / 1,306, plus the new run's 48.
- **Screens (Task 2):** `tools-admin.test.js` — 16 tests, with the new checks: the labels with " · " and a numbered crew name; Retire-waiting, Lost-from-the-warehouse, Lost-with-a-holder, retired and cancelled places; the two "with" wordings and the semicolons. `npm test` 42 suites green, money included.
- **Breakage run: 15 / 15 caught** — each rule broken on purpose, one at a time, and a suite must fail: no number at all; the number doubled on a nameless worker; a number on office or owner accounts; the number without "W-"; the function made callable; a second function slipped into 0108; the waiting-for-Retire place removed; Lost from the warehouse blank again; a place shown for a retired tool; the picker's team and the office label back in brackets; Mark as Complete back in brackets; the shopping list's tools joined by commas or back in brackets; the README's next number not moved on. Every file restored and compared afterwards. **Not caught by a test, by design:** the three cache-busters (no test reads them; Step 4 checks them on the live site).
- **Not tested here:** the screens in a real browser (Task 3 Step 5), and the live database (Task 3 Step 3). The live database was not changed; read-only queries only.

## Rehearsal

The plan was applied **from its own text** to fresh clones of Dacs Web at `067d412` (`_tf_rehearse.py`: every Create block written as given, every Modify block through `git apply --ignore-whitespace`, then Task 1 Step 1's CRLF restore) and every file compared with the tested build:

- **Plain:** Task 1 alone (5 files) byte-identical to `474922e`; Tasks 1–2 (10 files) byte-identical to `f7ef8d2`; nothing stray.
- **With the user's own uncommitted one-space `admin.html` edit made first:** the same — `admin.html` = the tested file plus that edit.

## Execution notes (29 October 2026)

- **Review:** revision 1 approved by the user on 29 Oct, rulings R1–R7 included ("Proceed with Task 1 only … Don't apply 0108 live or push yet").
- **Task 1:** applied to the real repo from this plan's text (`_apply_tf_t1.py`): the 5 files byte-identical to `474922e`, the CRLF files restored, `admin.html` (the user's own edit) untouched; this plan copied in. `npm test` **42 suites / 1,341 tests**, none failed (two more than in scratch: `app-updates` reads the real APK folder); `3a_tools.pglite.mjs` **45**, `--with-0108` **48**. `npm run test:sql` on the real repo: **44 suites / 1,354 tests**, none failed (as in scratch: the 43 / 1,306 before plus the new `--with-0108` run's 48).
- **0108 went live earlier than the approved sequence.** The plan has Task 3 apply 0108 after Tasks 1–2 are committed (Task 3 Step 2: "the committed 0108"), and the approval said not to apply it yet; **the user applied it in the Supabase SQL editor at about 14:15, before Task 1 was committed** — the file applied is the one in the working tree, byte-identical to the tested build. **Verified at once (MCP, read-only)** — Task 3 Step 3 brought forward:
  - `tl_person_name`'s live body = 0108's (`ac3f2d7e47c051f522f19c56047ce662`); still `security definer`, `search_path=public`; not executable by `authenticated` or `anon`.
  - The other 50 functions 0107 created or redefined are unchanged (each body's md5 equals its 0107 value, taken after 0107 went live).
  - Names: every active crew member reads "Name (W-00nn)" — the two "John Tapales" now **John Tapales (W-0005)** and **John Tapales (W-0007)**; the office and owner accounts unchanged ("admin", "Admin Project Management", "staff"); Requests' names (`pr_person_name`) unchanged.
  - Tools still **on**; `tl_tools` 0 rows (no real tool registered yet); expenses 585 / ₱3,097,177.74, unchanged.
  - `client_errors` in the 45 minutes before: one Cloudflare Turnstile error (300030) on the admin sign-in at 13:53 — before 0108 and unrelated.
  - **Effect until Task 2 is pushed** (R7 — safe, only untidy): the live screens use Task 1's names with the old punctuation — the picker "John Tapales (W-0007) (Team test)", Mark as Complete "TOOL-0004 (John Tapales (W-0007))", the shopping list "TOOL-0004 (John Tapales (W-0007), bought for this)".
  - **Still to do from Task 3:** the user commits Task 1 (so the live function matches a committed file); Task 2; then Steps 4–6 (push, browser check, notes). Steps 1–3 are done (Step 1's "before" value was read earlier the same day: `7bb8a46fac8821a64f6912e7695bb8c6`, 0107's).
