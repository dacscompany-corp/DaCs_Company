# WorkMate Stage 1c-2 — Work Plan Office (Dacs Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2 (13 October 2026)** — revised to the user's terms
[`docs/superpowers/specs/2026-10-13-workmate-stage1c2-work-plan-office-mvp-terms.md`](../specs/2026-10-13-workmate-stage1c2-work-plan-office-mvp-terms.md):
AI requests now pass a server-side account/size/limit gate (0095); the retired Llama 3.1 8B model is replaced; AI names are matched only when unique; task versions change automatically on the server (0094); unsaved meeting edits survive redraws; older dependencies survive edits. Revision 1 is superseded.

**Revision 3 (13 October 2026)** — the user's second review: a failed AI request redraws the meeting screen so every button works again; a save or publish forgets only the edits it actually saved (text typed while it runs is kept); Requests and Item History are re-tested against the active-only office check (their acceptance scripts plus a check of every office function, active and inactive); the AI limits are tested at every boundary, including two simultaneous requests. "Per day" limits are a **rolling 24-hour window** (the last 24 hours from now), never a calendar day.

**Revision 4 (13 October 2026)** — the user's third review: unsaved meeting edits live in ONE object per meeting that is never replaced (a finished save removes only values still equal to what it sent), proven by running the real meeting screen in Node; each screen load takes a ticket and only the newest ticket for the still-selected meeting or task may draw; the office-permission test now fails on every unexpected outcome, separates the internal helper from callable functions, reads controlled records, and checks each "covered by" claim; the AI-limit concurrency test records the exact ids of every usage row it causes before committing and deletes only those, proving that an unrelated usage row survives. Correction: the office check gates **43** functions (42 callable + 1 internal helper), not 44.

**Revision 5 (13 October 2026)** — the user's fourth review: `pr_is_office()` is internal (0086 revokes it; `0086_verify.sql` line 357 asserts signed-in users cannot call it; live check 13 October 2026: not callable by `authenticated`, `anon` or `public`). `1c2_office_active.sql` no longer calls it directly — office access is proven only through the callable functions — and instead asserts it stays private; 0094 re-states the revoke and a static test forbids granting it or calling it from that script.

**Goal:** A **Work Plan** section in Dacs Web where owner and staff turn meeting notes into tasks (AI-drafted or by hand), publish them with shared notes to chosen people, and run the office lists — waiting for your check, blocked, not acknowledged after 24 hours, overdue — plus a read-only lookup so a team leader can later see what happened to their own proposals.

**Architecture:** Plain HTML + vanilla JS, no build step, following the Requests office screens (`js/requests-admin-*.js`): one core file with **pure helpers** (exported to Node and tested behaviourally) and browser helpers, then one file per screen, registered in `PRIMARY_NAV` / `switchView`. Every read and write is a SECURITY DEFINER RPC (0093 `wp_office_*`, 0086 `pr_office_people` / `pr_office_teams`, new 0094/0095). **0094** makes office checks require an active account, adds `wp_my_proposals()`, and replaces `wp_office_save_task` so people / team / date changes always raise the task version. **0095** adds `ai_authorize()`: the `dacs-ai` Cloudflare worker forwards the caller's Supabase session to it and runs nothing unless the account, feature, input size and request limits pass. The worker — not the browser — picks the model.

**Tech Stack:** Vanilla JS (IIFE modules on `window`), Supabase JS client (`window.sbClient`), shared `att-*` / `req-*` CSS, Cloudflare Workers AI + Workers rate-limit binding, Supabase Postgres (plpgsql), Node zero-dependency tests (Node 24).

**Spec:** `docs/superpowers/specs/2026-09-30-workmate-meetings-work-plan-design.md` — §2 flow, §3 roles, §4 AI drafting, §5 language, §6 publishing and revisions ("Important changes to instructions, assignments, project or dates require acknowledgement again… Minor spelling corrections do not"), §8 blockers, §9 completion, §12 Dacs Web views, §13 checks, **§15 decisions** (incl. *Leader's own proposals*). MVP terms: `docs/superpowers/specs/2026-10-13-workmate-stage1c2-work-plan-office-mvp-terms.md`. Server live: `supabase/migrations/0093_workmate_my_work.sql`.

## Global Constraints

- **Repo:** `C:\Users\John Aerol Tapales\Documents\Dacs Web`. Paths are relative to it.
- **NEVER `git commit` / `git push`.** The user commits. Every task ends "Stop — no commit".
- **NEVER run `npm run build`.** No build step exists.
- **No implementer applies a migration, runs SQL against the database, or deploys the worker.** Dry runs, applies and the worker deploy are user/controller steps (end of Tasks 1 and 3; Task 8).
- **Migrations 0094 and 0095.** Highest on disk today is `0093_workmate_my_work.sql`. Before creating a file run `ls supabase/migrations | sort | tail -3`; if anything above 0093 exists, renumber both (and every reference in this plan) to highest + 1 and + 2. **Never edit 0093** — a test fingerprints it.
- **No money anywhere** in the Work Plan files (no price, amount, cost, peso, ₱). Staff use all of it. Work Plan creates no purchase, attendance, payroll, invoice or accounting entry and does not touch Spent / Earned / Profit.
- **Projects and Additional Works are `folders` ids** (never `construction_projects` ids; never billing periods).
- **Full save:** `wp_office_save_task(p_task, p_data)` replaces every field — always send the complete form: `meeting_id`, `folder_id`, `work_id`, `team_id`, `responsible_id`, `helper_ids` **as `[]` never null**, `depends_on` as `[]`, `title`, `instructions`, `planned_start`, `planned_end`, `source_passage`, `office_flags` as `[]`, optional `minor_text_only`, `change_note`. A published task keeps its project and work (`BAD_DESTINATION`).
- **Versions (0094):** on a published task the server raises the version for any change of responsible person, helpers, team or planned dates — always; and for a change of title or instructions unless `minor_text_only` is true. `minor_text_only` never covers people, team or dates.
- **AI (0095 + worker):** only signed-in, **active** accounts; `work_plan_draft` = owner or staff (module-focused accounts need `workplan` in `allowed_modules`); `budget_summary` = owner (module-focused: `expenses`); `health_briefing` = owner (module-focused: `expenses`) — the Project Control AI Health Assistant (`js/ai-assistant.js`), added by the Task 3 review ruling: ≤ 12,000 characters, 20 per 10 minutes and 100 per rolling 24 hours, ≤ 600 tokens. Limits: drafts 10 per person per 10 minutes and 50 per rolling 24 hours; summaries 20 per 10 minutes and 100 per rolling 24 hours; 300 AI requests per company per rolling 24 hours (a rolling window counts the last 24 hours from the moment of the request — never a calendar day); input ≤ 40,000 characters (drafts) / 4,000 (summaries); meeting notes ≤ 20,000 characters; request body ≤ 64 KB; ≤ 4 messages; answer ≤ 2,000 tokens (drafts) / 700 (summaries); per-address flood guard 30 requests per 60 s. Model for both: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Llama 3.1 8B was retired by Cloudflare on 30 May 2026). AI only suggests; it never publishes, clears problems, approves, or changes a live task.
- **`pr_is_office()` is shared.** 0094 makes it require an active account (Task 1 review ruling: this covers every office RPC that calls it; the role-only storage helpers `pr_office_gallery_path_ok` (0090) / `wp_office_task_path_ok` (0093) and the 0085 direct-read policies are a recorded follow-up, outside this plan). Checked live on 13 October 2026: it gates 43 functions (42 callable, 1 internal helper) — Requests (0085–0088), Item History (0090–0092) and Work Plan (0093) — and no access policy. So every 0094 dry run and the final checks re-run `supabase/tests/0086_verify.sql` and `supabase/tests/1a_acceptance.sql` (Requests), `supabase/tests/1b_acceptance.sql` (Item History), `supabase/tests/1c_acceptance.sql` (Work Plan) and `supabase/tests/1c2_office_active.sql` (every office function, active and inactive). Live accounts on 13 October 2026: owner 2 active, staff 1 active, no other status — re-checked on apply day (Task 8 Step 2).
- **AI matching:** a project, Additional Works, team or person is filled in only when **exactly one** name matches (a person also by a unique W-number). Otherwise the field shows **Needs your choice** and the form refuses to save until the office chooses. An unnamed or unknown Additional Works never becomes Main Contract.
- **Dates:** a planned date is a calendar day (`YYYY-MM-DD`) — never pass it through a time zone. Manila today = `new Date(Date.now() + 8 h).toISOString().slice(0, 10)` (the offset makes it safe; same as `requests-admin-queue.js`).
- **Navigation checklist (CLAUDE.md):** `PRIMARY_NAV`, **`_FOCUS_SUBVIEWS`**, `WP_VIEWS` in `admin.html` in sync with `switchView`, `_visibleNav()` (owner + staff by default; module-focused accounts only with `workplan` — no code change needed), markup + `<script>` tags, `docs/ARCHITECTURE.md` §4.
- **Load order:** `js/requests-admin-core.js` before `js/workplan-admin-core.js`.
- **Line endings:** JS/CSS/SQL/HTML/TOML files LF. `supabase/migrations/README.md` and `docs/DATABASE_SCHEMA.md` are **CRLF** — edit only with Python bytes. Never write files through PowerShell text output.
- **Cache busting:** new `<script>` / `<link>` tags use `?v=20261013a`; the changed `js/ai-summary.js` tag gets `?v=20261013a`.
- **Evidence:** record actual test output (counts included) in the verification record; expected counts in this plan are not evidence.

## Review findings this revision answers (MVP terms §1)

| Issue | Where fixed | Behavioural evidence |
|---|---|---|
| Public AI service | Task 3: `ai_authorize()` (0095), worker gate, flood guard, size caps, per-feature model + token caps; `ai-summary.js` sends the session | `tests/ai-worker.test.js` (worker with mocks: refusals happen before any AI call); `supabase/tests/1c2_ai_gate.sql` (inactive, wrong role, module-focused, oversized, per-person and per-company limits); Task 8 live calls |
| Deprecated 8B model | Task 3: both features on Llama 3.3 70B fp8-fast; availability checked with `npx wrangler ai models` before deploy | worker test (no 8B id anywhere); Task 8 summary + draft after deploy |
| AI guesses a work or person | Task 2 `resolveDraft` (unique matches only, `CHOOSE` sentinel, confirm boxes), `taskProblem` → `NEEDS_CHOICE`; Task 5 form marks the fields | `tests/workplan-admin.test.js` (unknown AW, missing work, duplicate project / team / worker names, W-number); Task 8 browser |
| Edits keep old acknowledgements | Task 1: `wp_office_save_task` replaced (0094); Task 2 `revisionChanges` mirrors it; Task 5 form shows it | `supabase/tests/1c2_acceptance.sql` (minor text keeps the version; text, dates, people raise it; old acknowledgement refused as stale; Start needs the new one); JS tests; Task 8 browser |
| Meeting edits lost on redraw | Task 2 `meetingFields` / `meetingUnsaved`; Task 7 `pending` state, confirm before replacing shared notes or unadded suggestions, leave-page warning | JS tests; Task 8 browser |
| Older dependency dropped | Task 2 `keepSelections`; Task 5 fetches links not on the Board and always shows them | JS test; `1c2_acceptance.sql` (Board omits the 40-day-old task, the link survives saves, goes only when sent empty); Task 8 browser |

## Second review (13 October 2026) — corrections in revision 3

| Finding | Fix | Evidence |
|---|---|---|
| A failed AI retry left **Review and add** and **Use as shared notes** dead | Task 7: a failed draft records its error and redraws the whole meeting screen (every button wired again; unsaved edits come back from `pending`) | Task 8 browser step 3 |
| Typing during a save was cleared when it finished | Task 2 `settlePending(pending, sent)`: after Save notes, AI drafting, New meeting or Publish, only the values that were sent are forgotten; anything typed meanwhile stays. A late result never redraws a different meeting | `tests/workplan-admin.test.js`; Task 8 browser step 3 |
| `pr_is_office()` is shared with Requests and Item History | Task 1 `supabase/tests/1c2_office_active.sql` (rewritten in revision 4, see below); `0086_verify`, `1a`, `1b` and `1c` acceptance re-run with 0094 in the dry run and after applying | Task 1 Step 9; Task 8 Step 3 |
| Quota rules only partly exercised | Task 3: `1c2_ai_gate.sql` covers each feature's 10-minute and rolling 24-hour limits at the exact boundary, rows just inside and just outside the window, features counted separately, the company limit at 300/301, and old-row removal; `1c2_ai_gate_concurrency.mjs` (two real connections) proves two simultaneous requests at a person and a company boundary never both pass, and that an abandoned request gives its slot back (cleanup by recorded ids — revision 4) | Task 3 Step 12; Task 8 Step 3 (pending) |
| "No current account is affected" needed evidence | Live check 13 October 2026: owner 2 active, staff 1 active, nothing else; repeated before applying | Task 8 Step 2 |

## Third review (13 October 2026) — corrections in revision 4

| Finding | Fix | Evidence (local now / live pending) |
|---|---|---|
| Edits typed during AI drafting could still be lost: `settle` replaced the edits object, while the input handlers kept writing to the old one | Task 2 `settlePending` now removes saved keys **in place** and returns the same object; Task 7 never reassigns `pending[id]` | `tests/workplan-admin.test.js` (same object); `tests/workplan-screens.test.js` runs the real meeting screen: notes typed after Save finished but before the AI answered survive an AI **success** and an AI **failure**; Task 8 browser |
| A slow, older meeting load could draw over a newer one | Task 2 `loadTickets()`; Task 6 (task) and Task 7 (meeting) take a ticket per load and draw content or an error only if it is still the newest ticket **and** the same meeting/task is still selected | `tests/workplan-screens.test.js`: open A, switch to B, A answers (or fails) last → B stays; same for tasks; Task 8 browser |
| Permission test treated unexpected errors as passes | Task 1 `1c2_office_active.sql` rewritten: an inventory of all 43 functions (kind, refusal style, covering regression script) must match the live database exactly; the internal helper must not be callable; 16 reads run against controlled records and must return them for the active owner and staff; the inactive account must get exactly `OFFICE_ONLY` (raising reads with real record ids, and every write) or exactly `[]` (filtering reads). No `when others` passes anything. Active-account writes are proven by `0086_verify`, `1a`, `1b`, `1c` acceptance, all re-run with 0094 | `tests/workmate-office-server.test.js` checks every "covered by" claim against the named script (all 43 verified locally); live dry run pending |
| `1c2_office_active.sql` called the internal `pr_is_office()` as a signed-in user — it would fail with permission denied and contradict `0086_verify.sql` (revision 5) | Both direct calls removed; office access is shown only through the callable functions (controlled-record reads for active accounts, exact refusals for the inactive one); a new check, run as the database owner, asserts `pr_is_office()` is callable by none of `authenticated`, `anon`, `public`; 0094 adds `revoke all on function pr_is_office() from public, anon, authenticated` (unchanged permissions, stated explicitly) | `tests/workmate-office-server.test.js`: 0094 never grants it, revokes it, and the script never calls it; live dry run pending |
| AI-limit cleanup deleted by value (`input_chars = 39999`) | `1c2_ai_gate_concurrency.mjs` records each row's exact id (`RETURNING`, or `currval` in the inserting session) in the ledger **before** its transaction commits; cleanup and recovery (`--cleanup`, or the generated `.superpowers/1c2_ai_gate_recovery.sql`) delete only those ids. A control row (same account, size and time) and every earlier usage row of the test accounts must survive cleanup. `1c2_ai_gate_cleanup.sql` is removed | static test (no value-based delete); live run pending (Task 8) |

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0094_workmate_work_plan_office.sql` (Task 1) | Active-only `pr_is_office()`; `wp_my_proposals()`; `wp_office_save_task` with automatic versions |
| `supabase/tests/1c2_acceptance.sql` (Task 1) | Live behaviour of 0094, self-rolling-back |
| `supabase/tests/1c2_office_active.sql` (Task 1) | Inventory of the 43 office functions checked against the live database; reads on controlled records (active owner/staff get them); inactive staff refused by every callable function |
| `tests/workmate-office-server.test.js` (Tasks 1, 3) | Static safety of 0094/0095 (grants, definer, guards kept, 0093 untouched) |
| `js/workplan-admin-core.js` (Task 2) | Pure helpers + browser helpers + view registry |
| `js/requests-admin-core.js` (Task 2) | `modal()` takes an optional `errorMessage` translator |
| `tests/workplan-admin.test.js` (Tasks 2, 4) | Behaviour of the pure helpers; nav focus behaviour; wiring; RPC grants; no money |
| `supabase/migrations/0095_ai_request_gate.sql`, `supabase/tests/1c2_ai_gate.sql` (Task 3) | `ai_requests`, `ai_authorize()`; live behaviour at every limit |
| `supabase/tests/1c2_ai_gate_concurrency.mjs` (Task 3) | Two simultaneous requests at a limit (two real connections); deletes only the exact row ids it recorded; proves unrelated rows survive |
| `cloudflare-worker/worker.js`, `wrangler.toml`, `SETUP.md`, `.gitignore`, `js/ai-summary.js`, `tests/ai-worker.test.js` (Task 3) | The gated worker, its tracked config, the summary sending the session, worker behaviour tests |
| `js/admin.js`, `admin.html`, `css/workplan-admin.css`, `docs/ARCHITECTURE.md` (Task 4) | Navigation, views, scripts, styles, module map |
| `js/workplan-admin-form.js`, `js/workplan-admin-board.js` (Task 5) | Task form; Board |
| `js/workplan-admin-task.js` (Task 6) | One task: people/acknowledgements, problems, photos, history, decisions |
| `js/workplan-admin-meetings.js` (Task 7) | Meetings list, meeting editor (unsaved edits kept), AI drafts, publish |
| `tests/workplan-screens.test.js` (Task 7) | Runs the real meeting and task screens in Node: edits typed during AI drafting survive; a late, older load never draws |
| `docs/superpowers/specs/2026-10-13-workmate-stage1c2-verification-record.md` (Task 8) | Evidence |
| `package.json` (Tasks 1–3, 7) | The four new suites in `npm test` |

---

### Task 1: Migration 0094 — active office accounts, a leader's own proposals, automatic task versions

**Files:**
- Create: `supabase/migrations/0094_workmate_work_plan_office.sql`, `supabase/tests/1c2_acceptance.sql`, `supabase/tests/1c2_office_active.sql`, `tests/workmate-office-server.test.js`
- Modify: `package.json`, `supabase/migrations/README.md` (CRLF), `docs/DATABASE_SCHEMA.md` (CRLF)

**Interfaces:**
- Consumes (0093/0086/0085): `wp_tasks`, `wp_task_people`, `wp_events`, `wp_dependencies`, `wp_log(owner, task, meeting, kind, note, detail)`, `wp_work_valid`, `wp_person_ok`, `wp_depends_on`, `wp_task_doc`, `pr_is_current_member`, `pr_is_requester()`, `attendance_data_owner()`, `data_owner_id()`, `is_owner()`, `is_staff()`.
- Produces:
  - `pr_is_office() returns boolean` — owner or staff **and** `profiles.status` active (null = active).
  - `wp_my_proposals() returns jsonb` — `[{id, title, project_name, work_name, proposed_at, status: 'sent'|'published'|'declined'|'cancelled', reason, decided_at}]`, newest first, last 90 days, caller's own only.
  - `wp_office_save_task(uuid, jsonb) returns jsonb` — same signature and checks as 0093, plus `minor_text_only` and automatic versioning; a revision's history note is `Changed: <list>` (+ ` — <change_note>`), list order `instructions, people, team, planned dates`; a minor correction's note is `Minor spelling correction` (+ note).

- [ ] **Step 1: Write the failing static test**

Create `tests/workmate-office-server.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// WORKMATE OFFICE SERVER (0094, 0095) STATIC TESTS:
//   node tests/workmate-office-server.test.js
//
// Zero dependencies. Guards the SHAPE of the 1c-2 migrations: grants,
// SECURITY DEFINER + pinned search_path, the 0093 guards kept in the
// replaced wp_office_save_task, and that 0093 itself is untouched.
// BEHAVIOUR is proven live by supabase/tests/1c2_acceptance.sql (0094)
// and supabase/tests/1c2_ai_gate.sql (0095).
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : ''; };
const strip = (s) => s.replace(/--.*$/gm, '');
const M94 = read('supabase/migrations/0094_workmate_work_plan_office.sql');
const C94 = strip(M94);

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const fnBlock = (code, name) => (code.match(new RegExp('create or replace function ' + name + '\\s*\\([\\s\\S]*?\\n\\$\\$;', 'i')) || [''])[0];

console.log('\nworkmate office server (0094)');

test('0093 is untouched (applied migrations are never edited)', () => {
  const sha = crypto.createHash('sha256').update(read('supabase/migrations/0093_workmate_my_work.sql')).digest('hex');
  assert(sha === '367a0b2db5f040e18fc74fb49839b7de606e2c5bb0fbd9719f4f942a32c943b4', '0093 changed: ' + sha);
});

test('0094 exists, sets a lock timeout, holds no money', () => {
  assert(M94.length > 0, 'missing 0094_workmate_work_plan_office.sql');
  assert(/set local lock_timeout = '5s';/.test(C94), 'no lock timeout');
  assert(!/\b[a-z_]*(price|amount|cost|peso)[a-z_]*\b/i.test(C94), 'a money word appears');
});

test('office checks require an active account', () => {
  const f = fnBlock(C94, 'pr_is_office');
  assert(f && /security definer/i.test(f) && /set search_path = public/i.test(f), 'pr_is_office definer + search_path');
  assert(/is_owner\(\) or is_staff\(\)/.test(f) && /coalesce\(p\.status, 'active'\) = 'active'/.test(f), 'role AND active status');
});

test('wp_my_proposals: own proposals, own company, 90 days, four outcomes, no office-only fields', () => {
  const f = fnBlock(C94, 'wp_my_proposals');
  assert(f && /security definer/i.test(f) && /set search_path = public/i.test(f), 'definer + search_path');
  assert(/not pr_is_requester\(\) then\s+raise exception 'NOT_A_REQUESTER'/.test(f), 'requester check');
  assert(/t\.proposed_by = auth\.uid\(\)/.test(f) && /t\.owner_id = attendance_data_owner\(\)/.test(f) && /interval '90 days'/.test(f), 'scope');
  for (const s of ["'sent'", "'published'", "'declined'", "'cancelled'"]) assert(f.includes(s), s);
  assert(/e\.kind = 'cancelled'/.test(f) && /'reason'/.test(f), 'reason from the cancel event');
  for (const x of ['source_passage', 'office_flags', 'instructions', "'acks'", 'responsible']) assert(!f.includes(x), x + ' returned');
});

test('wp_office_save_task keeps every 0093 guard', () => {
  const f = fnBlock(C94, 'wp_office_save_task');
  assert(f, 'wp_office_save_task not replaced');
  for (const code of ['OFFICE_ONLY', 'BAD_OPERATION', 'TITLE_REQUIRED', 'BAD_DATES', 'NOT_FOUND', 'TASK_CLOSED', 'BAD_DESTINATION',
                      'BAD_TEAM', 'BAD_PERSON', 'NO_RESPONSIBLE', 'BAD_DEPENDENCY', 'DEPENDENCY_CYCLE'])
    assert(f.includes("'" + code + "'"), 'lost guard ' + code);
  assert(/for no key update/.test(f) && /'wp_deps:'/.test(f), 'row lock + per-project dependency lock kept');
  assert(/security definer/i.test(f) && /set search_path = public/i.test(f), 'definer + search_path');
});

test('wp_office_save_task versions automatically; minor text never covers people, team or dates', () => {
  const f = fnBlock(C94, 'wp_office_save_task');
  assert(/v_minor := coalesce\(\(p_data ->> 'minor_text_only'\)::boolean, false\);/.test(f), 'minor flag parsed');
  assert(/v_revised := t\.status <> 'draft'\s+and \(v_important or cardinality\(v_changes\) > 0 or \(v_text and not v_minor\)\);/.test(f),
    'revision rule');
  for (const k of ["'people'", "'team'", "'planned dates'", "'instructions'"]) assert(f.includes(k), 'change kind ' + k);
});

test('pr_is_office() stays internal: 0094 revokes it, grants it to no one, and no test calls it as a user', () => {
  assert(C94.includes('revoke all on function pr_is_office() from public, anon, authenticated;'), '0094 restates the revoke');
  assert(!/grant\s+execute\s+on\s+function\s+pr_is_office/i.test(C94), '0094 must not grant pr_is_office');
  const oa = strip(read('supabase/tests/1c2_office_active.sql'));
  assert(oa.length > 0, 'missing 1c2_office_active.sql');
  assert(!/(assert|perform|select|return)\s+(not\s+)?pr_is_office\s*\(\)/i.test(oa), '1c2_office_active.sql calls pr_is_office() directly');
  assert(oa.includes("has_function_privilege('authenticated', 'public.pr_is_office()', 'execute')"), 'the script checks it stays private');
});

test('0094 functions callable when signed in, never by anon', () => {
  for (const sig of ['wp_my_proposals()', 'wp_office_save_task(uuid, jsonb)']) {
    assert(C94.includes('revoke all on function ' + sig + ' from public, anon;'), 'revoke ' + sig);
    assert(C94.includes('grant execute on function ' + sig + ' to authenticated;'), 'grant ' + sig);
  }
});

test('every office-function claim in 1c2_office_active.sql is real (43 rows, each called by the script it names)', () => {
  const oa = read('supabase/tests/1c2_office_active.sql');
  const rows = [...oa.matchAll(/\('(\w+)',\s*'(read|write|internal)',\s*'(raises|filters)',\s*'(\w+)'\)/g)];
  assert(rows.length === 43, 'inventory rows: ' + rows.length);
  assert(rows.filter(r => r[2] === 'read').length === 16 && rows.filter(r => r[2] === 'internal').length === 1, 'kinds');
  for (const [, fn, , , by] of rows) {
    const script = strip(read('supabase/tests/' + by + '.sql'));
    assert(script.length > 0, fn + ': missing script ' + by + '.sql');
    assert(new RegExp('\\b' + fn + '\\s*\\(').test(script), fn + ' is not called in ' + by + '.sql');
  }
  assert(!/when\s+others\s+then\s+null/i.test(oa) && !/when\s+insufficient_privilege/i.test(oa), 'no error may be swallowed');
});

// ── Task 3 appends the 0095 tests above this line ──

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/workmate-office-server.test.js`
Expected: the 0093 fingerprint test passes; the others FAIL ("missing 0094…"); exit code 1.

- [ ] **Step 3: Create the migration**

Create `supabase/migrations/0094_workmate_work_plan_office.sql` (LF). The `wp_office_save_task` body is 0093's with the marked additions (`v_minor`, `v_text`, `v_changes`, `v_old_resp`, `v_old_helpers`, `v_note`, `v_instructions`, the change detection and the event note); every check is unchanged.

```sql
-- 0094 — WorkMate Stage 1c-2: the office Work Plan server changes.
--
-- Three changes, all outside the money model (no money anywhere):
--
-- ── 1. Only ACTIVE office accounts pass the office check. pr_is_office()
--    (0086) looked only at the role, so a deactivated owner or staff account
--    still passed every office RPC that calls it (Requests, Item History,
--    Work Plan). It now also requires profiles.status = 'active' (null
--    counts as active, as everywhere). NOT covered here (recorded
--    follow-up): the role-only storage helpers pr_office_gallery_path_ok
--    (0090) and wp_office_task_path_ok (0093) and the 0085 direct-read
--    policies still check the role only.
--
-- ── 2. A team leader's own proposals. wp_my_proposals() lists the
--    caller's proposals with Sent (still an office draft), Published,
--    Declined (cancelled before publishing) or Cancelled (after
--    publishing) and the office's reason. Spec §15 "Leader's own
--    proposals" (13 October 2026). Never office-only fields, never another
--    person's proposals.
--
-- ── 3. Automatic task versions. wp_office_save_task (0093) raised the
--    version only when the office ticked "important". Spec §6: important
--    changes to instructions, assignments or dates need everyone to read
--    the task again; minor spelling corrections do not. Now, on a published
--    task, a change of the responsible person, helpers, team or planned
--    dates ALWAYS raises the version; a change of title or instructions
--    raises it unless the office marks it minor_text_only — a mark that
--    never covers people, team or dates. Acknowledgements are per version,
--    so earlier ones stay as history and no longer count. 0093 is not
--    edited; only this function is replaced.

set local lock_timeout = '5s';

-- ════ 1. Active office accounts only ═════════════════════════════════

create or replace function pr_is_office() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((is_owner() or is_staff())
                  and exists (select 1 from profiles p
                               where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'), false)
$$;

-- Internal, as in 0086: only SECURITY DEFINER office functions call it.
-- (create or replace keeps its permissions; restated so it can never drift.)
revoke all on function pr_is_office() from public, anon, authenticated;

-- ════ 2. A leader's own proposals ════════════════════════════════════

create index if not exists wp_tasks_proposed_by on wp_tasks (proposed_by) where proposed_by is not null;

create or replace function wp_my_proposals() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not pr_is_requester() then
    raise exception 'NOT_A_REQUESTER' using errcode = 'P0001';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', t.id, 'title', t.title, 'project_name', f.name,
                   'work_name', case when t.work_folder_id = t.folder_id then 'Main Contract' else w.name end,
                   'proposed_at', t.created_at,
                   'status', case when t.status = 'draft' then 'sent'
                                  when t.status = 'cancelled' and t.published_at is null then 'declined'
                                  when t.status = 'cancelled' then 'cancelled'
                                  else 'published' end,
                   'reason', case when t.status = 'cancelled' then
                               (select e.note from wp_events e
                                 where e.task_id = t.id and e.kind = 'cancelled' order by e.id desc limit 1) end,
                   'decided_at', case when t.status = 'draft' then null
                                      when t.status = 'cancelled' then
                                        (select max(e.created_at) from wp_events e where e.task_id = t.id and e.kind = 'cancelled')
                                      else t.published_at end)
                   order by t.created_at desc), '[]'::jsonb)
            from wp_tasks t
            join folders f on f.id = t.folder_id
            join folders w on w.id = t.work_folder_id
           where t.proposed_by = auth.uid()
             and t.owner_id = attendance_data_owner()
             and t.created_at > now() - interval '90 days');
end;
$$;

revoke all on function wp_my_proposals() from public, anon;
grant execute on function wp_my_proposals() to authenticated;

-- ════ 3. Task save with automatic versions ═══════════════════════════

create or replace function wp_office_save_task(p_task uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid := data_owner_id();
  v_new boolean := p_task is null;
  t wp_tasks;
  v_id uuid;
  v_meeting uuid;
  v_folder uuid;
  v_work uuid;
  v_team uuid;
  v_resp uuid;
  v_start date;
  v_end date;
  v_helpers uuid[];
  v_deps uuid[];
  v_one uuid;
  v_title text;
  v_instructions text;
  v_flags jsonb;
  v_important boolean;
  v_minor boolean;
  v_revised boolean;
  v_text boolean := false;
  v_changes text[] := '{}';
  v_old_resp uuid;
  v_old_helpers uuid[];
  v_note text;
begin
  if not pr_is_office() then
    raise exception 'OFFICE_ONLY' using errcode = 'P0001';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  v_flags := coalesce(p_data -> 'office_flags', '[]'::jsonb);
  if jsonb_typeof(v_flags) <> 'array' then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end if;
  begin
    v_meeting := nullif(p_data ->> 'meeting_id', '')::uuid;
    v_folder := nullif(p_data ->> 'folder_id', '')::uuid;
    v_work := coalesce(nullif(p_data ->> 'work_id', '')::uuid, v_folder);
    v_team := nullif(p_data ->> 'team_id', '')::uuid;
    v_resp := nullif(p_data ->> 'responsible_id', '')::uuid;
    v_start := nullif(p_data ->> 'planned_start', '')::date;
    v_end := nullif(p_data ->> 'planned_end', '')::date;
    v_helpers := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'helper_ids', '[]'::jsonb)) x);
    v_deps := array(select distinct x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'depends_on', '[]'::jsonb)) x);
    v_important := coalesce((p_data ->> 'important')::boolean, false);
    v_minor := coalesce((p_data ->> 'minor_text_only')::boolean, false);
  exception when others then
    raise exception 'BAD_OPERATION' using errcode = 'P0001';
  end;
  v_title := btrim(coalesce(p_data ->> 'title', ''));
  v_instructions := coalesce(p_data ->> 'instructions', '');
  if v_title = '' then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_start is not null and v_end is not null and v_end < v_start then
    raise exception 'BAD_DATES' using errcode = 'P0001';
  end if;

  if not v_new then
    select * into t from wp_tasks where id = p_task and owner_id = v_owner for no key update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0001';
    end if;
    if t.status in ('completed', 'cancelled') then
      raise exception 'TASK_CLOSED' using errcode = 'P0001';
    end if;
    if t.status <> 'draft' and (v_folder is distinct from t.folder_id or v_work is distinct from t.work_folder_id) then
      raise exception 'BAD_DESTINATION' using errcode = 'P0001';
    end if;
    if v_folder is distinct from t.folder_id then
      -- Same per-project key the dependency path uses, old and new project
      -- in a fixed order, so a concurrent link to this task cannot slip in.
      foreach v_one in array (select array_agg(f order by f) from unnest(array[t.folder_id, v_folder]) f where f is not null) loop
        perform pg_advisory_xact_lock(hashtext('wp_deps:' || v_one::text));
      end loop;
      if exists (select 1 from wp_dependencies x join wp_tasks d on d.id = x.task_id
                  where x.depends_on = t.id and d.status <> 'cancelled') then
        raise exception 'BAD_DEPENDENCY' using errcode = 'P0001';
      end if;
    end if;
  end if;
  if (v_new or t.status = 'draft') and (v_folder is null or not wp_work_valid(v_owner, v_folder, v_work)) then
    raise exception 'BAD_DESTINATION' using errcode = 'P0001';
  end if;
  if v_meeting is not null and not exists (select 1 from wp_meetings m where m.id = v_meeting and m.owner_id = v_owner) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_team is not null and not exists (select 1 from pr_teams tm where tm.id = v_team and tm.owner_id = v_owner and tm.active) then
    raise exception 'BAD_TEAM' using errcode = 'P0001';
  end if;
  if v_resp is not null and (not wp_person_ok(v_resp, v_owner)
                              or (v_team is not null and not pr_is_current_member(v_team, v_resp))) then
    raise exception 'BAD_PERSON' using errcode = 'P0001';
  end if;
  foreach v_one in array v_helpers loop
    if v_one = v_resp or not wp_person_ok(v_one, v_owner)
       or (v_team is not null and not pr_is_current_member(v_team, v_one)) then
      raise exception 'BAD_PERSON' using errcode = 'P0001';
    end if;
  end loop;
  if not v_new and t.status <> 'draft' and v_resp is null then
    raise exception 'NO_RESPONSIBLE' using errcode = 'P0001';
  end if;

  if v_new then
    insert into wp_tasks (owner_id, meeting_id, folder_id, work_folder_id, team_id, title, instructions,
                          planned_start, planned_end, source_passage, office_flags, created_by)
    values (v_owner, v_meeting, v_folder, v_work, v_team, v_title, v_instructions,
            v_start, v_end, coalesce(p_data ->> 'source_passage', ''), v_flags, v_uid)
    returning id into v_id;
    perform wp_log(v_owner, v_id, v_meeting, 'drafted', '', '{}'::jsonb);
  else
    v_id := t.id;
    v_note := btrim(coalesce(p_data ->> 'change_note', ''));
    if t.status <> 'draft' then
      -- What changed since the version people read (spec §6). People, team
      -- and dates always need a new reading; wording does unless minor.
      select p.person_id into v_old_resp from wp_task_people p
       where p.task_id = t.id and p.role = 'responsible' and p.removed_at is null;
      v_old_helpers := array(select p.person_id from wp_task_people p
                              where p.task_id = t.id and p.role = 'helper' and p.removed_at is null);
      v_text := v_title is distinct from t.title or v_instructions is distinct from t.instructions;
      if v_resp is distinct from v_old_resp or not (v_helpers @> v_old_helpers and v_old_helpers @> v_helpers) then
        v_changes := v_changes || 'people'::text;
      end if;
      if v_team is distinct from t.team_id then
        v_changes := v_changes || 'team'::text;
      end if;
      if v_start is distinct from t.planned_start or v_end is distinct from t.planned_end then
        v_changes := v_changes || 'planned dates'::text;
      end if;
    end if;
    v_revised := t.status <> 'draft'
                 and (v_important or cardinality(v_changes) > 0 or (v_text and not v_minor));
    if v_revised and v_text then
      v_changes := array['instructions'::text] || v_changes;
    end if;
    if v_revised then
      v_note := case when cardinality(v_changes) > 0 then 'Changed: ' || array_to_string(v_changes, ', ')
                     else 'Important change' end
                || case when v_note <> '' then ' — ' || v_note else '' end;
    elsif t.status <> 'draft' and v_text then
      v_note := 'Minor spelling correction' || case when v_note <> '' then ' — ' || v_note else '' end;
    end if;
    update wp_tasks
       set meeting_id = v_meeting, folder_id = v_folder, work_folder_id = v_work, team_id = v_team, title = v_title,
           instructions = v_instructions, planned_start = v_start, planned_end = v_end,
           source_passage = coalesce(p_data ->> 'source_passage', ''), office_flags = v_flags,
           version = case when v_revised then t.version + 1 else t.version end,
           version_at = case when v_revised then now() else t.version_at end,
           updated_at = now()
     where id = v_id;
    perform wp_log(v_owner, v_id, v_meeting, case when v_revised then 'revised' else 'edited' end,
                   v_note, jsonb_build_object('changes', to_jsonb(v_changes)));
  end if;

  -- People: end rows no longer wanted, add new ones; history is kept.
  update wp_task_people
     set removed_at = now()
   where task_id = v_id and removed_at is null
     and not ((role = 'responsible' and person_id is not distinct from v_resp)
              or (role = 'helper' and person_id = any (v_helpers)));
  if v_resp is not null then
    insert into wp_task_people (owner_id, task_id, person_id, role)
    select v_owner, v_id, v_resp, 'responsible'
     where not exists (select 1 from wp_task_people p
                        where p.task_id = v_id and p.person_id = v_resp and p.role = 'responsible' and p.removed_at is null);
  end if;
  insert into wp_task_people (owner_id, task_id, person_id, role)
  select v_owner, v_id, h, 'helper'
    from unnest(v_helpers) h
   where not exists (select 1 from wp_task_people p
                      where p.task_id = v_id and p.person_id = h and p.role = 'helper' and p.removed_at is null);

  -- Dependencies: same project, no cycles. One project at a time, so two
  -- staff linking A→B and B→A at once cannot both succeed.
  perform pg_advisory_xact_lock(hashtext('wp_deps:' || v_folder::text));
  foreach v_one in array v_deps loop
    if not exists (select 1 from wp_tasks d
                    where d.id = v_one and d.owner_id = v_owner and d.folder_id = v_folder and d.status <> 'cancelled') then
      raise exception 'BAD_DEPENDENCY' using errcode = 'P0001';
    end if;
    if v_one = v_id or wp_depends_on(v_one, v_id) then
      raise exception 'DEPENDENCY_CYCLE' using errcode = 'P0001';
    end if;
  end loop;
  delete from wp_dependencies where task_id = v_id and not (depends_on = any (v_deps));
  insert into wp_dependencies (owner_id, task_id, depends_on)
  select v_owner, v_id, d from unnest(v_deps) d
  on conflict do nothing;

  return jsonb_build_object('task', wp_task_doc(v_id, v_uid, true));
end;
$$;

revoke all on function wp_office_save_task(uuid, jsonb) from public, anon;
grant execute on function wp_office_save_task(uuid, jsonb) to authenticated;
```

- [ ] **Step 4: Create the acceptance script**

Create `supabase/tests/1c2_acceptance.sql` (LF):

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-2 acceptance — migration 0094 (live behaviour).
--
-- Self-wrapped in begin / rollback: nothing persists. Builds its own
-- "ZZ 1c2" project and team. Editor-safe (set_config 'v1c2.*', no temp
-- objects). Accounts: W-0007 and W-0019 (active workers), W-0021 (active
-- teamLeader), an active staff account — one owner. Success ends with
-- the row '1c2 acceptance: all checks passed'.
--   A. a leader's own proposals          C. older dependencies are kept
--   B. automatic task versions           D. inactive office accounts refused
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_w7 uuid; v_w19 uuid; v_w21 uuid; v_owner uuid; v_staff uuid; v_p uuid; v_team uuid;
begin
  select id into v_w7  from profiles where worker_no = 7  and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w19 from profiles where worker_no = 19 and role = 'worker'     and coalesce(status, 'active') = 'active';
  select id into v_w21 from profiles where worker_no = 21 and role = 'teamLeader' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null and v_w19 is not null and v_w21 is not null,
    'W-0007, W-0019 (workers) and W-0021 (teamLeader) must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select coalesce(owner_id, id) from profiles where id = v_w19) = v_owner
     and (select coalesce(owner_id, id) from profiles where id = v_w21) = v_owner, 'one owner';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  assert v_staff is not null, 'need an active staff account';
  insert into folders (owner_id, name) values (v_owner, 'ZZ 1c2 project') returning id into v_p;
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1c2 team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values
    (v_owner, v_team, v_w21, true), (v_owner, v_team, v_w7, false), (v_owner, v_team, v_w19, false);
  perform set_config('v1c2.w7', v_w7::text, true);
  perform set_config('v1c2.w19', v_w19::text, true);
  perform set_config('v1c2.w21', v_w21::text, true);
  perform set_config('v1c2.staff', v_staff::text, true);
  perform set_config('v1c2.p', v_p::text, true);
  perform set_config('v1c2.team', v_team::text, true);
end $$;

set local role authenticated;

-- ═══ A. A leader's own proposals ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w21'), 'role', 'authenticated')::text, true);
do $$
declare
  r jsonb;
begin
  r := wp_propose_task(gen_random_uuid(), current_setting('v1c2.team')::uuid, current_setting('v1c2.p')::uuid, null,
                       'ZZ 1c2 scaffolding', 'Kailangan ng scaffolding');
  perform set_config('v1c2.a', r ->> 'task_id', true);
  r := wp_propose_task(gen_random_uuid(), current_setting('v1c2.team')::uuid, current_setting('v1c2.p')::uuid, null,
                       'ZZ 1c2 extra outlets', '');
  perform set_config('v1c2.b', r ->> 'task_id', true);
  assert (select count(*) from jsonb_array_elements(wp_my_proposals()) x
           where x ->> 'id' in (current_setting('v1c2.a'), current_setting('v1c2.b')) and x ->> 'status' = 'sent') = 2,
    'A1 both proposals read Sent';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w7'), 'role', 'authenticated')::text, true);
do $$
begin
  assert not exists (select 1 from jsonb_array_elements(wp_my_proposals()) x
                      where x ->> 'id' in (current_setting('v1c2.a'), current_setting('v1c2.b'))),
    'A2 a colleague never sees another person''s proposals';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  perform wp_office_save_task(current_setting('v1c2.a')::uuid, jsonb_build_object(
    'folder_id', current_setting('v1c2.p'), 'work_id', current_setting('v1c2.p'), 'team_id', current_setting('v1c2.team'),
    'title', 'ZZ 1c2 scaffolding', 'responsible_id', current_setting('v1c2.w7'), 'helper_ids', '[]'::jsonb, 'depends_on', '[]'::jsonb));
  perform wp_office_publish(null, array[current_setting('v1c2.a')::uuid], null, null, null);
  perform wp_office_cancel(current_setting('v1c2.b')::uuid, 'Not this week');
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w21'), 'role', 'authenticated')::text, true);
do $$
declare
  x jsonb; y jsonb;
begin
  select e into x from jsonb_array_elements(wp_my_proposals()) e where e ->> 'id' = current_setting('v1c2.a');
  select e into y from jsonb_array_elements(wp_my_proposals()) e where e ->> 'id' = current_setting('v1c2.b');
  assert x ->> 'status' = 'published' and x ->> 'decided_at' is not null, 'A3 published: ' || x::text;
  assert y ->> 'status' = 'declined' and y ->> 'reason' = 'Not this week' and y ->> 'decided_at' is not null, 'A4 declined + reason: ' || y::text;
  assert not (x ? 'source_passage') and not (x ? 'office_flags') and not (x ? 'instructions') and not (x ? 'acks'), 'A5 no office-only fields';
  assert x ->> 'work_name' = 'Main Contract' and x ->> 'project_name' = 'ZZ 1c2 project', 'A6 project and work named';
end $$;

-- ═══ B. Automatic task versions ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_base jsonb; v_t uuid;
begin
  v_base := jsonb_build_object('folder_id', current_setting('v1c2.p'), 'work_id', current_setting('v1c2.p'),
    'team_id', current_setting('v1c2.team'), 'title', 'ZZ 1c2 plaster', 'instructions', 'Plaster the wall',
    'responsible_id', current_setting('v1c2.w7'), 'helper_ids', '[]'::jsonb, 'depends_on', '[]'::jsonb,
    'planned_start', '2026-10-19', 'planned_end', '2026-10-21');
  v_t := (wp_office_save_task(null, v_base) -> 'task' ->> 'id')::uuid;
  perform wp_office_publish(null, array[v_t], null, null, null);
  assert (wp_office_task(v_t) ->> 'version')::int = 1, 'B0 published at version 1';
  perform set_config('v1c2.t', v_t::text, true);
  perform set_config('v1c2.base', v_base::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w7'), 'role', 'authenticated')::text, true);
do $$ begin perform wp_acknowledge(gen_random_uuid(), current_setting('v1c2.t')::uuid, 1); end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t uuid := current_setting('v1c2.t')::uuid;
  v_base jsonb := current_setting('v1c2.base')::jsonb;
  d jsonb; h jsonb;
begin
  -- B1 a spelling correction marked minor keeps the version and the reading
  v_base := v_base || '{"instructions": "Plaster the wall."}';
  d := wp_office_save_task(v_t, v_base || '{"minor_text_only": true}') -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 1, 'B1 minor text keeps version 1, got ' || (d ->> 'version');
  assert (select (a ->> 'acked')::boolean from jsonb_array_elements(wp_office_task(v_t) -> 'acks') a
           where a ->> 'person_id' = current_setting('v1c2.w7')), 'B1 W-0007''s reading still counts';
  assert h ->> 'kind' = 'edited' and h ->> 'note' like 'Minor spelling correction%', 'B1 history: ' || h::text;

  -- B2 the same kind of wording change NOT marked minor needs a new reading
  v_base := v_base || '{"instructions": "Plaster the wall, then smooth finish."}';
  d := wp_office_save_task(v_t, v_base) -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 2, 'B2 wording change raises the version, got ' || (d ->> 'version');
  assert not (select (a ->> 'acked')::boolean from jsonb_array_elements(wp_office_task(v_t) -> 'acks') a
               where a ->> 'person_id' = current_setting('v1c2.w7')), 'B2 the version-1 reading no longer counts';
  assert h ->> 'kind' = 'revised' and h ->> 'note' = 'Changed: instructions', 'B2 history: ' || h::text;
  perform set_config('v1c2.base', v_base::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.w7'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t uuid := current_setting('v1c2.t')::uuid;
begin
  begin perform wp_start_work(gen_random_uuid(), v_t); raise exception 'no error';
  exception when others then assert sqlerrm = 'NOT_ACKNOWLEDGED', 'B3 Start needs the new version read, got ' || sqlerrm; end;
  assert (wp_acknowledge(gen_random_uuid(), v_t, 1) ->> 'stale')::boolean, 'B3 re-sending the old version is stale';
  perform wp_acknowledge(gen_random_uuid(), v_t, 2);
  assert wp_start_work(gen_random_uuid(), v_t) -> 'task' ->> 'status' = 'in_progress', 'B3 starts after reading version 2';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_t uuid := current_setting('v1c2.t')::uuid;
  v_base jsonb := current_setting('v1c2.base')::jsonb;
  d jsonb; h jsonb;
begin
  -- B4 a date change cannot hide behind "minor"
  v_base := v_base || '{"planned_end": "2026-10-23"}';
  d := wp_office_save_task(v_t, v_base || '{"minor_text_only": true, "change_note": "rain"}') -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 3 and h ->> 'note' = 'Changed: planned dates — rain', 'B4 dates: ' || h::text;

  -- B5 adding a helper cannot hide behind "minor"
  v_base := v_base || jsonb_build_object('helper_ids', jsonb_build_array(current_setting('v1c2.w19')));
  d := wp_office_save_task(v_t, v_base || '{"minor_text_only": true}') -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 4 and h ->> 'note' = 'Changed: people', 'B5 people: ' || h::text;

  -- B6 several changes at once are listed in a fixed order
  v_base := v_base || jsonb_build_object('title', 'ZZ 1c2 plaster and finish', 'planned_start', '2026-10-20',
                                         'responsible_id', current_setting('v1c2.w19'), 'helper_ids', jsonb_build_array(current_setting('v1c2.w7')));
  d := wp_office_save_task(v_t, v_base) -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 5 and h ->> 'note' = 'Changed: instructions, people, planned dates', 'B6 list: ' || h::text;

  -- B7 saving with nothing changed keeps the version
  d := wp_office_save_task(v_t, v_base) -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 5 and h ->> 'kind' = 'edited', 'B7 no change: ' || h::text;

  -- B8 the old explicit "important" still forces a new version
  d := wp_office_save_task(v_t, v_base || '{"important": true}') -> 'task';
  h := d -> 'history' -> (jsonb_array_length(d -> 'history') - 1);
  assert (d ->> 'version')::int = 6 and h ->> 'note' = 'Important change', 'B8 important: ' || h::text;
  perform set_config('v1c2.base', v_base::text, true);
end $$;

-- ═══ C. Older dependencies are kept ═══
do $$
declare
  v_d uuid;
begin
  v_d := (wp_office_save_task(null, jsonb_build_object('folder_id', current_setting('v1c2.p'), 'work_id', current_setting('v1c2.p'),
           'title', 'ZZ 1c2 older work', 'responsible_id', current_setting('v1c2.w7'),
           'helper_ids', '[]'::jsonb, 'depends_on', '[]'::jsonb)) -> 'task' ->> 'id')::uuid;
  perform wp_office_publish(null, array[v_d], null, null, null);
  perform set_config('v1c2.d', v_d::text, true);
end $$;

reset role;
update wp_tasks set status = 'completed', completed_at = now() - interval '40 days' where id = current_setting('v1c2.d')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);

do $$
declare
  v_t uuid := current_setting('v1c2.t')::uuid;
  v_d text := current_setting('v1c2.d');
  v_base jsonb := current_setting('v1c2.base')::jsonb;
  d jsonb;
begin
  assert not exists (select 1 from jsonb_array_elements(wp_office_board(current_setting('v1c2.p')::uuid)) x where x ->> 'id' = v_d),
    'C1 the Board leaves out tasks completed more than 30 days ago (so the form must fetch them)';
  v_base := v_base || jsonb_build_object('depends_on', jsonb_build_array(v_d));
  d := wp_office_save_task(v_t, v_base) -> 'task';
  assert d -> 'depends_on' ? v_d and (d ->> 'version')::int = 6, 'C2 a link to an older completed task saves, no new version';
  d := wp_office_save_task(v_t, v_base || '{"instructions": "Plaster the wall, then smooth finish!", "minor_text_only": true}') -> 'task';
  assert d -> 'depends_on' ? v_d, 'C3 an unrelated edit that sends the link keeps it';
  d := wp_office_save_task(v_t, v_base || '{"depends_on": []}') -> 'task';
  assert not (d -> 'depends_on' ? v_d), 'C4 the link goes only when the office removes it';
end $$;

-- ═══ D. Inactive office accounts are refused ═══
reset role;
update profiles set status = 'inactive' where id = current_setting('v1c2.staff')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('v1c2.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform wp_office_board(null); raise exception 'no error';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'D1 an inactive staff account is not office, got ' || sqlerrm; end;
  begin perform wp_office_task(current_setting('v1c2.t')::uuid); raise exception 'no error';
  exception when others then assert sqlerrm = 'OFFICE_ONLY', 'D2 got ' || sqlerrm; end;
end $$;

-- ═══ Permissions ═══
reset role;
do $$
begin
  assert has_function_privilege('authenticated', 'public.wp_my_proposals()', 'execute'), 'P1';
  assert not has_function_privilege('anon', 'public.wp_my_proposals()', 'execute'), 'P2';
  assert not has_function_privilege('anon', 'public.wp_office_save_task(uuid, jsonb)', 'execute'), 'P3';
end $$;

select '1c2 acceptance: all checks passed' as result;

rollback;
```

- [ ] **Step 4a: Create the office-check script (Requests, Item History, Work Plan)**

Create `supabase/tests/1c2_office_active.sql` (LF):

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-2 — the active-only office check (migration 0094) across EVERY
-- function that calls pr_is_office(): Requests (0085–0088), Item History
-- (0090–0092) and Work Plan (0093/0094) — 43 on 13 October 2026.
--
-- Self-wrapped in begin / rollback: nothing persists. Editor-safe (no temp
-- objects). Every outcome is checked explicitly: an unexpected answer or
-- error is a FAILURE, never a pass.
--   0. Inventory: the live functions that call pr_is_office() must be
--      exactly the list below — kind (read / write / internal), how it
--      refuses a non-office account (raises OFFICE_ONLY / filters to
--      nothing) and the regression script that proves its behaviour for
--      active accounts. A new or changed function fails here until listed.
--      tests/workmate-office-server.test.js checks each "covered by" claim.
--   1. The internal helper (wp_office_task_row) is callable by neither
--      signed-in users nor anon, and pr_is_office() itself stays internal
--      (0086) — this script never calls it as a user; office access is
--      shown only through the callable functions.
--   2. Controlled records (a ZZ project, team, item, request, photo,
--      reference, meeting and task): every read function, as the active
--      owner and as the active staff account, returns them.
--   3. The same staff account made inactive inside this transaction:
--      raising reads (called with the real record ids) and every write
--      (called with NULL arguments) → exactly OFFICE_ONLY; filtering reads
--      → exactly '[]'.
-- Active-account WRITE behaviour is proven by the scripts named in the
-- inventory (0086_verify, 1a, 1b and 1c acceptance), re-run with 0094.
-- A read check that fails because a function's output has a different
-- shape is fixed against that function's real output — never loosened.
-- Success ends with '1c2 office check: all passed (42 callable, 1 internal)'.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

-- ═══ 0. Inventory, and 1. the internal helper ═══
do $$
declare
  v_inv jsonb;
  v_bad text;
begin
  with inventory(fn, kind, gate, covered_by) as (values
    ('pr_folder_request_count',      'read',      'raises',  '0086_verify'),
    ('pr_office_add_gallery_photo',  'write',     'raises',  '1b_acceptance'),
    ('pr_office_add_member',         'write',     'raises',  '0086_verify'),
    ('pr_office_add_ref',            'write',     'raises',  '1b_acceptance'),
    ('pr_office_batches',            'read',      'raises',  '0086_verify'),
    ('pr_office_cancel_line',        'write',     'raises',  '1a_acceptance'),
    ('pr_office_catalog',            'read',      'filters', '1b_acceptance'),
    ('pr_office_change_quantity',    'write',     'raises',  '0086_verify'),
    ('pr_office_history_item',       'read',      'raises',  '1b_acceptance'),
    ('pr_office_history_search',     'read',      'raises',  '1b_acceptance'),
    ('pr_office_keep_private',       'write',     'raises',  '1b_acceptance'),
    ('pr_office_match_item',         'write',     'raises',  '1a_acceptance'),
    ('pr_office_move_portion',       'write',     'raises',  '0086_verify'),
    ('pr_office_people',             'read',      'filters', '0086_verify'),
    ('pr_office_photo_queue',        'read',      'filters', '1b_acceptance'),
    ('pr_office_projects',           'read',      'filters', '1b_acceptance'),
    ('pr_office_publish_photo',      'write',     'raises',  '1b_acceptance'),
    ('pr_office_queue',              'read',      'filters', '1a_acceptance'),
    ('pr_office_remove_member',      'write',     'raises',  '0086_verify'),
    ('pr_office_request',            'read',      'raises',  '0086_verify'),
    ('pr_office_resolve_conflict',   'write',     'raises',  '0086_verify'),
    ('pr_office_resolve_reduction',  'write',     'raises',  '0086_verify'),
    ('pr_office_retire_photo',       'write',     'raises',  '1b_acceptance'),
    ('pr_office_retire_ref',         'write',     'raises',  '1b_acceptance'),
    ('pr_office_save_item',          'write',     'raises',  '1b_acceptance'),
    ('pr_office_save_team',          'write',     'raises',  '0086_verify'),
    ('pr_office_set_allow_history',  'write',     'raises',  '1b_acceptance'),
    ('pr_office_set_allow_requests', 'write',     'raises',  '0086_verify'),
    ('pr_office_set_arranged',       'write',     'raises',  '1a_acceptance'),
    ('pr_office_set_batch_dates',    'write',     'raises',  '1a_acceptance'),
    ('pr_office_set_cover',          'write',     'raises',  '1b_acceptance'),
    ('pr_office_set_leader',         'write',     'raises',  '0086_verify'),
    ('pr_office_teams',              'read',      'filters', '0086_verify'),
    ('wp_office_board',              'read',      'raises',  '1c_acceptance'),
    ('wp_office_clear_blocker',      'write',     'raises',  '1c_acceptance'),
    ('wp_office_destinations',       'read',      'filters', '1c_acceptance'),
    ('wp_office_meeting',            'read',      'raises',  '1c_acceptance'),
    ('wp_office_meetings',           'read',      'filters', '1c_acceptance'),
    ('wp_office_publish',            'write',     'raises',  '1c_acceptance'),
    ('wp_office_save_meeting',       'write',     'raises',  '1c_acceptance'),
    ('wp_office_save_task',          'write',     'raises',  '1c_acceptance'),
    ('wp_office_task',               'read',      'raises',  '1c_acceptance'),
    ('wp_office_task_row',           'internal',  'raises',  '1c_acceptance')
  )
  select jsonb_agg(jsonb_build_object('fn', fn, 'kind', kind, 'gate', gate, 'covered_by', covered_by)) into v_inv from inventory;

  select string_agg(coalesce(i.fn, l.fn) || ': ' ||
           case when i.fn is null then 'calls pr_is_office() but is not in the inventory'
                when l.fn is null then 'listed but not found'
                when l.anon then 'callable by anon'
                when (i.kind = 'internal') = l.callable then 'callable = ' || l.callable || ' for a ' || i.kind || ' function'
                else 'refuses by ' || l.gate || ', listed as ' || i.gate end, '; ')
    into v_bad
    from jsonb_to_recordset(v_inv) as i(fn text, kind text, gate text, covered_by text)
    full join (select p.proname::text as fn,
                      has_function_privilege('authenticated', p.oid, 'execute') as callable,
                      has_function_privilege('anon', p.oid, 'execute') as anon,
                      case when p.prosrc ~* 'if\s+not\s+pr_is_office\(\)\s+then\s+raise\s+exception\s+''OFFICE_ONLY'''
                           then 'raises' else 'filters' end as gate
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosrc ilike '%pr_is_office()%' and p.proname <> 'pr_is_office') l
      on l.fn = i.fn
   where i.fn is null or l.fn is null or l.anon or (i.kind = 'internal') = l.callable or i.gate <> l.gate;
  assert v_bad is null, '0/1 inventory mismatch: ' || v_bad;
  -- The office check itself stays internal (0086): no client may call it.
  assert not has_function_privilege('authenticated', 'public.pr_is_office()', 'execute')
     and not has_function_privilege('anon', 'public.pr_is_office()', 'execute')
     and not has_function_privilege('public', 'public.pr_is_office()', 'execute'), '1 pr_is_office() must stay internal';
  perform set_config('voa.inventory', v_inv::text, true);
end $$;

-- ═══ Controlled records (as the database owner) ═══
do $$
declare
  v_w7 uuid; v_owner uuid; v_staff uuid; v_p uuid; v_team uuid; v_item uuid; v_batch uuid;
  v_req uuid; v_line uuid; v_path text; v_photo uuid; v_ref uuid;
begin
  select id into v_w7 from profiles where worker_no = 7 and role = 'worker' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null, 'W-0007 must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select role from profiles where id = v_owner) = 'owner'
     and coalesce((select status from profiles where id = v_owner), 'active') = 'active', 'W-0007''s owner must be an active owner';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  assert v_staff is not null, 'need an active staff account of that owner';

  insert into folders (owner_id, name) values (v_owner, 'ZZ 1c2 oa project') returning id into v_p;
  insert into pr_project_settings (folder_id, owner_id, allow_requests, allow_history) values (v_p, v_owner, true, true);
  insert into pr_teams (owner_id, name) values (v_owner, 'ZZ 1c2 oa team') returning id into v_team;
  insert into pr_team_members (owner_id, team_id, worker_id, is_leader) values (v_owner, v_team, v_w7, false);
  insert into pr_catalog_items (owner_id, kind, name, spec, unit, category)
  values (v_owner, 'material', 'ZZ 1c2 oa outlet', '2-gang', 'pc', 'electrical') returning id into v_item;
  v_batch := pr_batch_for(v_owner, now());
  insert into pr_requests (owner_id, requester_id, folder_id, work_folder_id, client_op_id)
  values (v_owner, v_w7, v_p, v_p, gen_random_uuid()) returning id into v_req;
  insert into pr_lines (owner_id, request_id, position, kind, catalog_item_id, description, unit)
  values (v_owner, v_req, 0, 'material', v_item, 'ZZ 1c2 oa outlet line', 'pc') returning id into v_line;
  insert into pr_line_portions (owner_id, line_id, batch_id, quantity) values (v_owner, v_line, v_batch, 2);
  v_path := v_w7 || '/' || v_req || '/' || gen_random_uuid() || '.jpg';
  insert into storage.objects (bucket_id, name, owner) values ('request-photos', v_path, v_w7);
  insert into pr_photos (owner_id, request_id, line_id, storage_path, uploaded_by)
  values (v_owner, v_req, v_line, v_path, v_w7) returning id into v_photo;
  insert into pr_item_refs (owner_id, catalog_item_id, folder_id, work_folder_id, description, ref_date, date_precision, created_by)
  values (v_owner, v_item, v_p, v_p, 'ZZ 1c2 oa reference', '2026-10-01', 'exact', v_owner) returning id into v_ref;

  perform set_config('voa.w7', v_w7::text, true);       perform set_config('voa.owner', v_owner::text, true);
  perform set_config('voa.staff', v_staff::text, true); perform set_config('voa.p', v_p::text, true);
  perform set_config('voa.team', v_team::text, true);   perform set_config('voa.item', v_item::text, true);
  perform set_config('voa.batch', v_batch::text, true); perform set_config('voa.req', v_req::text, true);
  perform set_config('voa.photo', v_photo::text, true); perform set_config('voa.ref', v_ref::text, true);
end $$;

-- A meeting and a task, made through the office functions by the active staff account.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('voa.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  v_m uuid; v_t uuid;
begin
  v_m := (wp_office_save_meeting(null, 'ZZ 1c2 oa meeting', current_date, 'office notes') ->> 'meeting_id')::uuid;
  v_t := (wp_office_save_task(null, jsonb_build_object('meeting_id', v_m, 'folder_id', current_setting('voa.p'),
           'work_id', current_setting('voa.p'), 'title', 'ZZ 1c2 oa task', 'helper_ids', '[]'::jsonb, 'depends_on', '[]'::jsonb))
          -> 'task' ->> 'id')::uuid;
  perform set_config('voa.m', v_m::text, true);
  perform set_config('voa.t', v_t::text, true);
end $$;

-- ═══ 2. Active owner and active staff: every read returns the controlled records ═══
do $$
declare
  who text;
  p uuid := current_setting('voa.p')::uuid;
  has text;
begin
  assert (select count(*) from jsonb_to_recordset(current_setting('voa.inventory')::jsonb) as x(fn text, kind text)
           where kind = 'read') = 16, '2 this section checks 16 reads; the inventory now lists a different number — add the check';
  foreach who in array array[current_setting('voa.owner'), current_setting('voa.staff')] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    has := ' must return it for ' || who;
    assert pr_office_people()::text        like '%' || current_setting('voa.w7')    || '%', '2 pr_office_people: W-0007' || has;
    assert pr_office_teams()::text         like '%' || current_setting('voa.team')  || '%', '2 pr_office_teams: the team' || has;
    assert pr_office_catalog()::text       like '%' || current_setting('voa.item')  || '%', '2 pr_office_catalog: the item' || has;
    assert pr_office_projects()::text      like '%' || current_setting('voa.p')     || '%', '2 pr_office_projects: the project' || has;
    assert pr_office_queue('open')::text   like '%' || current_setting('voa.req')   || '%', '2 pr_office_queue: the request' || has;
    assert pr_office_photo_queue()::text   like '%' || current_setting('voa.photo') || '%', '2 pr_office_photo_queue: the photo' || has;
    assert wp_office_destinations()::text  like '%' || current_setting('voa.p')     || '%', '2 wp_office_destinations: the project' || has;
    assert wp_office_meetings()::text      like '%' || current_setting('voa.m')     || '%', '2 wp_office_meetings: the meeting' || has;
    assert pr_folder_request_count(p) = 1, '2 pr_folder_request_count: exactly the one request' || has;
    assert pr_office_batches()::text       like '%' || current_setting('voa.batch') || '%', '2 pr_office_batches: the batch' || has;
    assert pr_office_history_item(current_setting('voa.item')::uuid, null)::text like '%' || current_setting('voa.item') || '%',
      '2 pr_office_history_item: the item' || has;
    assert pr_office_history_search('ZZ 1c2 oa outlet', null, null, null, null, null, 50, 0)::text like '%' || current_setting('voa.item') || '%',
      '2 pr_office_history_search: the item' || has;
    assert pr_office_request(current_setting('voa.req')::uuid)::text like '%' || current_setting('voa.req') || '%',
      '2 pr_office_request: the request' || has;
    assert wp_office_board(p)::text        like '%' || current_setting('voa.t')     || '%', '2 wp_office_board: the task' || has;
    assert wp_office_meeting(current_setting('voa.m')::uuid)::text like '%' || current_setting('voa.m') || '%', '2 wp_office_meeting' || has;
    assert wp_office_task(current_setting('voa.t')::uuid)::text    like '%' || current_setting('voa.t') || '%', '2 wp_office_task' || has;
  end loop;
end $$;

-- ═══ 3. The same staff account, inactive: refused by every callable function ═══
reset role;
update profiles set status = 'inactive' where id = current_setting('voa.staff')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('voa.staff'), 'role', 'authenticated')::text, true);
do $$
declare
  f record;
  v_out text;
  v_bad text := '';
  v_seen text[] := '{}';
  v_expected text[];
begin
  -- 3a. Filtering reads: exactly '[]' — none of the controlled records.
  for f in select * from (values
      ('pr_office_people',       pr_office_people()::text),
      ('pr_office_teams',        pr_office_teams()::text),
      ('pr_office_catalog',      pr_office_catalog()::text),
      ('pr_office_projects',     pr_office_projects()::text),
      ('pr_office_queue',        pr_office_queue('open')::text),
      ('pr_office_photo_queue',  pr_office_photo_queue()::text),
      ('wp_office_destinations', wp_office_destinations()::text),
      ('wp_office_meetings',     wp_office_meetings()::text)) as x(fn, out) loop
    v_seen := v_seen || f.fn;
    if f.out is distinct from '[]' then v_bad := v_bad || ' ' || f.fn || ' returned ' || left(coalesce(f.out, 'null'), 60); end if;
  end loop;

  -- 3b. Raising reads, called with the real record ids: exactly OFFICE_ONLY.
  for f in select * from (values
      ('pr_folder_request_count',  format('select pr_folder_request_count(%L::uuid)::text', current_setting('voa.p'))),
      ('pr_office_batches',        'select pr_office_batches()::text'),
      ('pr_office_history_item',   format('select pr_office_history_item(%L::uuid, null)::text', current_setting('voa.item'))),
      ('pr_office_history_search', 'select pr_office_history_search(''ZZ 1c2 oa outlet'', null, null, null, null, null, 50, 0)::text'),
      ('pr_office_request',        format('select pr_office_request(%L::uuid)::text', current_setting('voa.req'))),
      ('wp_office_board',          format('select wp_office_board(%L::uuid)::text', current_setting('voa.p'))),
      ('wp_office_meeting',        format('select wp_office_meeting(%L::uuid)::text', current_setting('voa.m'))),
      ('wp_office_task',           format('select wp_office_task(%L::uuid)::text', current_setting('voa.t')))) as x(fn, sql) loop
    v_seen := v_seen || f.fn;
    begin
      execute f.sql into v_out;
      v_bad := v_bad || ' ' || f.fn || ' answered';
    exception when others then
      if sqlerrm <> 'OFFICE_ONLY' then v_bad := v_bad || ' ' || f.fn || ' (' || sqlerrm || ')'; end if;
    end;
  end loop;

  -- 3c. Every write, called with NULL arguments: exactly OFFICE_ONLY (the
  --     office check comes first; any other outcome is a failure).
  for f in select x.fn,
                  (select string_agg('null::' || format_type(t, null), ', ' order by i)
                     from unnest(p.proargtypes::oid[]) with ordinality as a(t, i)) as nulls
             from jsonb_to_recordset(current_setting('voa.inventory')::jsonb) as x(fn text, kind text)
             join pg_proc p on p.proname = x.fn
             join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
            where x.kind = 'write'
            order by x.fn loop
    v_seen := v_seen || f.fn;
    begin
      execute format('select public.%I(%s)::text', f.fn, coalesce(f.nulls, '')) into v_out;
      v_bad := v_bad || ' ' || f.fn || ' answered';
    exception when others then
      if sqlerrm <> 'OFFICE_ONLY' then v_bad := v_bad || ' ' || f.fn || ' (' || sqlerrm || ')'; end if;
    end;
  end loop;

  assert v_bad = '', '3 an inactive office account got through:' || v_bad;
  select array_agg(fn order by fn) into v_expected
    from jsonb_to_recordset(current_setting('voa.inventory')::jsonb) as x(fn text, kind text) where kind <> 'internal';
  assert (select array_agg(x order by x) from unnest(v_seen) x) = v_expected,
    '3 every callable office function was checked exactly once; checked: ' || array_to_string(v_seen, ', ');
end $$;

reset role;
select '1c2 office check: all passed (42 callable, 1 internal)' as result;

rollback;
```

- [ ] **Step 5: Add the test to `npm test`**

In `package.json`, append ` && node tests/workmate-office-server.test.js` to the end of the `"test"` script string (after `node tests/workmate-workplan.test.js`). Edit tool; nothing else.

- [ ] **Step 6: Update the two CRLF docs with Python**

Save as a scratch file outside the repo and run with `python -I <file>` from the repo root:

```python
import re
p = 'supabase/migrations/README.md'
s = open(p, 'rb').read().decode('utf-8')
s, n = re.subn(r"\(\*\*\d{4}\*\* — highest on disk is\s+`[^`]+`\)",
               "(**0095** — highest on disk is\r\n  `0094_workmate_work_plan_office.sql`)", s, count=1)
assert n == 1, 'next-number line not found'
anchor = s.index('**0093 (WorkMate Stage 1c-1')
end = s.index('\r\n', anchor)
para = ("\r\n\r\n**0094 (WorkMate Stage 1c-2 — office Work Plan server)** (1) `pr_is_office()` now also requires an active "
        "profile, so a deactivated owner/staff account loses every office RPC that calls it (Requests, Item History, Work Plan) "
        "— the role-only storage helpers `pr_office_gallery_path_ok` / `wp_office_task_path_ok` and the 0085 direct-read "
        "policies are a recorded follow-up; (2) adds the "
        "read-only worker RPC `wp_my_proposals()` — the caller's own proposals from the last 90 days as `sent` / `published` / "
        "`declined` / `cancelled` with the office's reason, never office-only fields; (3) replaces `wp_office_save_task` so a "
        "published task's version rises automatically for any change of responsible person, helpers, team or planned dates, "
        "and for a wording change unless `minor_text_only` (which never covers people, team or dates). 0093 is not edited. "
        "No money. Dry-run with `supabase/tests/1c2_acceptance.sql` and `supabase/tests/1c2_office_active.sql` (both "
        "self-wrapped, editor-safe).")
s = s[:end] + para + s[end:]
open(p, 'wb').write(s.encode('utf-8'))

p = 'docs/DATABASE_SCHEMA.md'
s = open(p, 'rb').read().decode('utf-8')
anchor = s.index('| `wp_propose_task(op, team, folder, work, title, details)`')
end = s.index('\r\n', anchor)
row = ("\r\n| `wp_my_proposals()` (0094) | worker | The caller's own proposals (last 90 days): `sent` / `published` / "
       "`declined` / `cancelled`, the office's reason, when decided — no office-only fields |"
       "\r\n| `wp_office_save_task` (replaced in 0094) | office | Full save; on a published task people / team / planned-date "
       "changes always raise `version`, wording changes unless `minor_text_only`; history note `Changed: …` |")
s = s[:end] + row + s[end:]
open(p, 'wb').write(s.encode('utf-8'))
print('docs updated')
```

Expected: `docs updated`. Check CRLF kept: `python -I -c "import sys;[print(f, open(f,'rb').read().count(b'\n')==open(f,'rb').read().count(b'\r\n')) for f in sys.argv[1:]]" supabase/migrations/README.md docs/DATABASE_SCHEMA.md` → `True` twice.

- [ ] **Step 7: Run the tests**

Run: `node tests/workmate-office-server.test.js` → all pass, exit 0. Run: `npm test` → all suites green.

- [ ] **Step 8: Stop — no commit.** Report to the controller (files, test output).

- [ ] **Step 9 (controller + user, after review): dry run 0094**

Controller builds, with Python bytes (no BOM, LF), two files in Downloads, each `b'begin;\n\n' + migration.rstrip(b'\n') + b'\n\n' + script` (the script's own `begin` only warns; its `rollback` undoes the migration too):
- `0094_dry_run.sql` with `supabase/tests/1c2_acceptance.sql` → expected `1c2 acceptance: all checks passed`;
- `0094_office_dry_run.sql` with `supabase/tests/1c2_office_active.sql` → expected `1c2 office check: all passed (42 callable, 1 internal)`.

The user runs both in the SQL editor. A failing read check caused by a different output shape is corrected against the function's real output and re-run — never loosened into a pass. Then, with the user's go-ahead, the controller runs the regressions with 0094 through MCP `execute_sql` (three of them use a temporary table, which the SQL editor breaks), each `begin;` + 0094 + the script as one call, a single transaction ending in rollback: `supabase/tests/0086_verify.sql` → `pr office verify: all checks passed`; `1a_acceptance.sql` → `1a acceptance: all checks passed`; `1b_acceptance.sql` → `1b acceptance: all checks passed`; `1c_acceptance.sql` → `1c acceptance: all checks passed`. Any failure goes back to Step 3 before Task 2 starts. (Apply waits for Task 8.)

---

### Task 2: Work Plan core — pure helpers, browser helpers, behavioural tests

**Files:**
- Create: `js/workplan-admin-core.js`, `tests/workplan-admin.test.js`
- Modify: `js/requests-admin-core.js` (one line in `modal`), `package.json`

**Interfaces:**
- Consumes (`js/requests-admin-core.js`): Node `require('./requests-admin-core.js')` → `formatDay`, `formatManila`, `workerNo`; browser `window.RequestsAdmin` → also `esc`, `icons`, `rpc`, `modal`, `head`, `signImages`.
- Produces `window.WorkPlanAdmin` (`WP`):
  - pure: `STATUS_LABEL`, `statusLabel(t)`, `statusPill(t)`, `plannedLabel(t)`, `boardGroups(tasks) → [{key,title,tasks}]`, `alertCounts(tasks) → {check,blocked,unacked,overdue,proposals}`, `filterBoard(tasks,{folder,text})`, `CHOOSE` (`'?'`), `taskProblem(v) → code|null`, `buildTaskPayload(v)`, `docToForm(doc) → v`, `revisionChanges(doc, v) → {changes: string[], text: boolean}`, `keepSelections(original, shown, ticked) → string[]`, `meetingFields(meeting, pending) → {title, held_on, notes, shared, recip, people, change}`, `meetingUnsaved(meeting, pending) → boolean`, `settlePending(pending, sent) → the same object` (removes, in place, only the keys whose value still equals what was sent), `loadTickets() → {take(), isLatest(ticket)}`, `blockerKind`, `eventText(ev)`, `ERRORS`, `errorMessage(e)`, `NOTES_MAX` (20000), `draftMessages(notes, ctx)`, `parseDraft(text)`, `resolveDraft(task, ctx) → {values, flags}`, `todayManila()`, `formatDay`, `formatManila`, `workerNo`.
  - browser: `esc`, `icons`, `rpc`, `head`, `signImages`, `fail(host, e)`, `modal(opts)`, `aiDraft(notes, ctx)`, `AI_WORKER_URL`, `state {taskId, meetingId}`, `views {}`, `openTask(id)`, `openMeeting(id)`; global `window.initWorkPlanModule(view)`.
  - Form values `v`: `{meeting_id, folder_id, work_id, team_id, responsible_id, helper_ids[], depends_on[], title, instructions, planned_start, planned_end, source_passage, office_flags[], checks[], minor_text_only, change_note}`; ids are strings; `''` = none; `CHOOSE` = the office must still choose; `checks` ⊆ `['helpers','dates']` = confirmations still missing.
  - AI context `ctx`: `{projects: [{folder_id, name, works: [{work_id, name}]}], people: [{id, name, worker_no}], teams: [{id, name}], heldOn}`.
  - Worker request: `POST AI_WORKER_URL`, header `Authorization: Bearer <session access_token>`, body `{feature: 'work_plan_draft', messages, temperature: 0.2}`; error body `{error: {code, message}}` with codes `AI_NOT_SIGNED_IN | AI_NOT_ALLOWED | AI_TOO_LARGE | AI_RATE_LIMITED | AI_BAD_REQUEST | AI_GATE_UNAVAILABLE | AI_FAILED` (Task 3).

- [ ] **Step 1: Write the failing test file**

Create `tests/workplan-admin.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// WORK PLAN ADMIN TESTS:  node tests/workplan-admin.test.js
//
// Zero dependencies. Loads the REAL js/workplan-admin-core.js (pure half)
// and checks BEHAVIOUR: task states and the office lists, the full-save
// payload, what needs a new version, keeping selections the office did
// not remove, unsaved meeting edits, AI drafts (prompt rules, parsing,
// unique-only matching), error sentences. Then guards across every Work
// Plan file: every RPC is granted to signed-in users, no money.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const wp = require('../js/workplan-admin-core.js');
const ROOT = path.join(__dirname, '..');
const src = (rel) => { const p = path.join(ROOT, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; };

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || '') + ' expected ' + b + ', got ' + a);
}
const task = (o) => Object.assign({ id: 't', status: 'not_started', title: 'Wall prep', project_name: 'Barlin', work_name: 'Main Contract',
  folder_id: 'F1', team_name: null, responsible: { id: 'w19', name: 'Juan' }, helpers: [], blocked: false, sent_back: false,
  overdue: false, not_acknowledged_24h: false, office_flags: [], proposed_by: null, planned_start: null, planned_end: null }, o);
const C = wp.CHOOSE;

console.log('\nworkplan-admin: states and the office lists');

test('statusLabel and statusPill; a leader\'s draft reads "Proposal"', () => {
  eq(wp.statusLabel(task({ status: 'draft' })), 'Draft');
  eq(wp.statusLabel(task({ status: 'draft', proposed_by: 'Mario' })), 'Proposal');
  eq(wp.statusLabel(task({ status: 'leader_checked' })), 'Leader checked');
  eq(wp.statusPill(task({ status: 'completed' })), 'att-pill--done');
  eq(wp.statusPill(task({ status: 'draft', proposed_by: 'Mario' })), 'att-pill--pm');
});

test('plannedLabel reads calendar days without shifting them', () => {
  eq(wp.plannedLabel(task({ planned_start: '2026-10-19', planned_end: '2026-10-21' })), 'Mon 19 Oct – Wed 21 Oct');
  eq(wp.plannedLabel(task({ planned_end: '2026-10-21' })), 'By Wed 21 Oct');
  eq(wp.plannedLabel(task({ planned_start: '2026-10-19' })), 'From Mon 19 Oct');
  eq(wp.plannedLabel(task({ planned_start: '2026-10-19', planned_end: '2026-10-19' })), 'Mon 19 Oct');
  eq(wp.plannedLabel(task({})), '—');
});

test('boardGroups: one heading per task, first match wins, in the office order', () => {
  const g = wp.boardGroups([
    task({ id: 'done', status: 'completed' }),
    task({ id: 'chk', status: 'reported_done', blocked: true }),
    task({ id: 'blk', status: 'in_progress', blocked: true, overdue: true }),
    task({ id: 'ack', status: 'not_started', not_acknowledged_24h: true, overdue: true }),
    task({ id: 'ovd', status: 'in_progress', overdue: true }),
    task({ id: 'act', status: 'not_started' }),
    task({ id: 'drf', status: 'draft' }),
  ]);
  eq(g.map(x => x.key), ['check', 'blocked', 'unacked', 'overdue', 'active', 'drafts', 'done']);
  eq(g.map(x => x.tasks.map(t => t.id)), [['chk'], ['blk'], ['ack'], ['ovd'], ['act'], ['drf'], ['done']]);
});

test('alertCounts counts live tasks only (spec §15 office lists)', () => {
  eq(wp.alertCounts([
    task({ status: 'in_progress', blocked: true, overdue: true }),
    task({ status: 'not_started', not_acknowledged_24h: true }),
    task({ status: 'reported_done' }),
    task({ status: 'draft', proposed_by: 'Mario' }),
    task({ status: 'completed', overdue: true, blocked: true }),
  ]), { check: 1, blocked: 1, unacked: 1, overdue: 1, proposals: 1 });
});

test('filterBoard by project and by text (title, project, people)', () => {
  const all = [task({ id: 'a', folder_id: 'F1', title: 'Wall prep' }),
               task({ id: 'b', folder_id: 'F2', title: 'Electrical', helpers: [{ id: 'w7', name: 'Pedro' }] })];
  eq(wp.filterBoard(all, { folder: 'F2' }).map(t => t.id), ['b']);
  eq(wp.filterBoard(all, { text: 'pedro' }).map(t => t.id), ['b']);
  eq(wp.filterBoard(all, { text: '  WALL ' }).map(t => t.id), ['a']);
  eq(wp.filterBoard(all, {}).length, 2);
});

console.log('\nworkplan-admin: the task form');

const base = { title: 'X', folder_id: 'F1', work_id: 'F1', team_id: '', responsible_id: '', helper_ids: [], planned_start: '', planned_end: '', checks: [] };

test('taskProblem mirrors the server and refuses unresolved choices', () => {
  eq(wp.taskProblem(base), null);
  eq(wp.taskProblem(Object.assign({}, base, { title: '  ' })), 'TITLE_REQUIRED');
  eq(wp.taskProblem(Object.assign({}, base, { folder_id: '' })), 'BAD_DESTINATION');
  eq(wp.taskProblem(Object.assign({}, base, { work_id: '' })), 'BAD_DESTINATION', 'work is never defaulted');
  eq(wp.taskProblem(Object.assign({}, base, { planned_start: '2026-10-21', planned_end: '2026-10-19' })), 'BAD_DATES');
  eq(wp.taskProblem(Object.assign({}, base, { planned_start: '21/10/2026' })), 'BAD_DATES');
  eq(wp.taskProblem(Object.assign({}, base, { responsible_id: 'w7', helper_ids: ['w7'] })), 'BAD_PERSON');
  for (const k of ['folder_id', 'work_id', 'team_id', 'responsible_id'])
    eq(wp.taskProblem(Object.assign({}, base, { [k]: C })), 'NEEDS_CHOICE', k);
  eq(wp.taskProblem(Object.assign({}, base, { checks: ['helpers'] })), 'NEEDS_CHOICE', 'unconfirmed helpers');
});

test('buildTaskPayload is a FULL save: arrays never null, empty ids left out, no default work, minor flag', () => {
  const p = wp.buildTaskPayload({ meeting_id: 'M', folder_id: 'F1', work_id: 'AW1', team_id: '', responsible_id: 'w19',
    helper_ids: ['w7', 'w7', ''], depends_on: [], title: ' Wall ', instructions: ' plaster ', planned_start: '', planned_end: '2026-10-21',
    source_passage: 'p', office_flags: ['x'], checks: [], minor_text_only: false, change_note: '' });
  eq(p, { folder_id: 'F1', work_id: 'AW1', title: 'Wall', instructions: 'plaster', helper_ids: ['w7'], depends_on: [],
          office_flags: ['x'], source_passage: 'p', meeting_id: 'M', responsible_id: 'w19', planned_end: '2026-10-21' });
  const q = wp.buildTaskPayload(Object.assign({}, base, { minor_text_only: true, change_note: ' typo ' }));
  eq([q.minor_text_only, q.change_note, q.helper_ids, q.office_flags, q.depends_on], [true, 'typo', [], [], []]);
  ok(!('checks' in q) && !('important' in q), 'no form-only keys sent');
});

test('docToForm then buildTaskPayload keeps every field of an office task', () => {
  const doc = { meeting_id: 'M', folder_id: 'F1', work_id: 'AW', team_id: 'T', responsible: { id: 'w19' },
    helpers: [{ id: 'w7' }], depends_on: ['d1'], title: 'Wall', instructions: 'i', planned_start: '2026-10-19',
    planned_end: null, source_passage: 's', office_flags: ['f'] };
  const p = wp.buildTaskPayload(wp.docToForm(doc));
  eq([p.meeting_id, p.folder_id, p.work_id, p.team_id, p.responsible_id, p.helper_ids, p.depends_on, p.planned_start, p.planned_end, p.office_flags],
     ['M', 'F1', 'AW', 'T', 'w19', ['w7'], ['d1'], '2026-10-19', undefined, ['f']]);
});

console.log('\nworkplan-admin: what needs a new version (mirrors 0094)');

const pub = { status: 'not_started', title: 'Wall', instructions: 'Plaster', team_id: 'T', responsible: { id: 'w19' },
              helpers: [{ id: 'w7' }, { id: 'w8' }], planned_start: '2026-10-19', planned_end: '2026-10-21' };
const form = (o) => Object.assign(wp.docToForm(pub), o);

test('revisionChanges: nothing, wording only, and each always-new-version change', () => {
  eq(wp.revisionChanges(pub, form({})), { changes: [], text: false });
  eq(wp.revisionChanges(pub, form({ instructions: ' Plaster ' })), { changes: [], text: false }, 'spaces only');
  eq(wp.revisionChanges(pub, form({ instructions: 'Plaster.' })), { changes: [], text: true });
  eq(wp.revisionChanges(pub, form({ helper_ids: ['w8', 'w7'] })), { changes: [], text: false }, 'helper order');
  eq(wp.revisionChanges(pub, form({ helper_ids: ['w7'] })).changes, ['people']);
  eq(wp.revisionChanges(pub, form({ responsible_id: 'w8', helper_ids: ['w7'] })).changes, ['people']);
  eq(wp.revisionChanges(pub, form({ team_id: '' })).changes, ['team']);
  eq(wp.revisionChanges(pub, form({ planned_end: '2026-10-23' })).changes, ['planned dates']);
  eq(wp.revisionChanges(pub, form({ title: 'Wall 2', helper_ids: [], planned_start: '' })), { changes: ['people', 'planned dates'], text: true });
  eq(wp.revisionChanges(Object.assign({}, pub, { status: 'draft' }), form({ planned_end: '' })), { changes: [], text: false }, 'drafts never');
});

test('keepSelections keeps what the office did not remove', () => {
  eq(wp.keepSelections(['old', 'a', 'b'], ['a', 'b', 'c'], ['b', 'c']), ['old', 'b', 'c'], 'older link not shown survives');
  eq(wp.keepSelections(['a'], ['a'], []), [], 'unticked on screen = removed');
  eq(wp.keepSelections([], ['a'], ['a', 'a']), ['a']);
});

console.log('\nworkplan-admin: unsaved meeting edits');

const meeting = { title: 'Mon meeting', held_on: '2026-10-12', original_notes: 'notes',
                  versions: [{ version: 2, shared_notes: 'v2 shared' }, { version: 1, shared_notes: 'v1' }] };

test('meetingFields: unsaved edits win over the server copy; newest shared notes', () => {
  eq(wp.meetingFields(meeting), { title: 'Mon meeting', held_on: '2026-10-12', notes: 'notes', shared: 'v2 shared',
                                  recip: 'default', people: [], change: '' });
  const f = wp.meetingFields(meeting, { notes: 'typed', shared: 'my shared', recip: 'choose', people: ['w7'] });
  eq([f.title, f.notes, f.shared, f.recip, f.people], ['Mon meeting', 'typed', 'my shared', 'choose', ['w7']]);
  eq(wp.meetingFields({}).shared, '');
});

test('meetingUnsaved notices any edit that differs from the server', () => {
  eq(wp.meetingUnsaved(meeting, {}), false);
  eq(wp.meetingUnsaved(meeting, { notes: 'notes' }), false, 'same text is not unsaved');
  eq(wp.meetingUnsaved(meeting, { notes: 'notes!' }), true);
  eq(wp.meetingUnsaved(meeting, { people: ['w7'] }), true);
  eq(wp.meetingUnsaved({}, { notes: 'x' }), true, 'a new meeting');
});

test('settlePending forgets only what was saved, in the SAME object the input handlers write to', () => {
  const p = { notes: 'abc', shared: 'x' };
  ok(wp.settlePending(p, { notes: 'abc', title: 'T' }) === p, 'returns the same object');
  eq(p, { shared: 'x' });
  const q = { notes: 'abc, typed while saving' };
  wp.settlePending(q, { notes: 'abc' });
  eq(q, { notes: 'abc, typed while saving' });
  const r = { people: ['w7', 'w19'], recip: 'choose' };
  wp.settlePending(r, { people: ['w7', 'w19'], recip: 'choose', shared: '' });
  eq(r, {});
  const u = { people: ['w7'] };
  wp.settlePending(u, { people: ['w7', 'w19'] });
  eq(u, { people: ['w7'] }, 'changed during publish');
  eq(wp.settlePending(undefined, { notes: 'x' }), undefined);
  // What revision 3 got wrong: an input handler still holding the object
  // must keep writing to the one the screen draws from.
  const held = { notes: 'saved' };
  wp.settlePending(held, { notes: 'saved' });
  held.notes = 'typed after the save';
  eq(wp.meetingFields({ original_notes: 'saved' }, held).notes, 'typed after the save');
});

test('loadTickets: only the newest load may draw', () => {
  const t = wp.loadTickets();
  const a = t.take(), b = t.take();
  eq([t.isLatest(a), t.isLatest(b)], [false, true]);
  eq(wp.loadTickets().isLatest(a), false, 'each screen has its own tickets');
});

console.log('\nworkplan-admin: AI drafts');

const ctx = {
  projects: [{ folder_id: 'F1', name: 'Barlin Residence', works: [{ work_id: 'AW1', name: 'Barlin Additional Works' }] },
             { folder_id: 'F2', name: 'Castro Residence', works: [] }, { folder_id: 'F3', name: 'Castro Residence', works: [] }],
  people: [{ id: 'w7', name: 'Pedro Santos', worker_no: 7 }, { id: 'w19', name: 'Juan Cruz', worker_no: 19 },
           { id: 'w23', name: 'Juan Cruz', worker_no: 23 }],
  teams: [{ id: 'T1', name: 'Team test' }, { id: 'T2', name: 'Team A' }, { id: 'T3', name: 'Team A' }],
  heldOn: '2026-10-12',
};
const draftOf = (o) => wp.parseDraft(JSON.stringify({ tasks: [Object.assign({ title: 'Work' }, o)] })).tasks[0];

test('draftMessages carries the lists and the rules (no inventing, exact names, language, no money)', () => {
  const m = wp.draftMessages('Bukas, wall prep sa Barlin.', ctx);
  ok(m.length === 2 && m[0].role === 'system' && m[1].role === 'user', 'system + user');
  for (const s of ['Barlin Residence', 'Barlin Additional Works', 'Pedro Santos (W-0007)', 'Team test', 'Never invent',
                   'EXACTLY', 'Taglish', 'money', '"tasks"', 'source_passage', 'Main Contract'])
    ok(m[0].content.includes(s), 'system prompt lacks: ' + s);
  ok(m[1].content.includes('Bukas, wall prep sa Barlin.') && m[1].content.includes('2026-10-12'), 'notes + date in the user message');
});

test('parseDraft finds the JSON inside prose, cleans fields, keeps only real dates', () => {
  const d = wp.parseDraft('Here you go:\n{"tasks":[{"title":" Wall prep ","project":"Barlin Residence","planned_start":"2026-10-19",' +
    '"planned_end":"next week","helpers":["Pedro Santos",""],"flags":[],"waits_for":null}],"shared_notes":"Monday start"}\nThanks!');
  eq(d.tasks.length, 1);
  eq([d.tasks[0].title, d.tasks[0].planned_start, d.tasks[0].planned_end, d.tasks[0].raw_end, d.tasks[0].helpers, d.tasks[0].waits_for],
     ['Wall prep', '2026-10-19', null, 'next week', ['Pedro Santos'], []]);
  eq(d.shared_notes, 'Monday start');
  const n = wp.parseDraft('{"tasks":[{"title":"X","planned_start":null,"planned_end":"null"}]}');
  eq([n.tasks[0].raw_start, n.tasks[0].raw_end], ['', '']);
  eq(wp.parseDraft('{"tasks":[{"title":""}],"shared_notes":""}').tasks.length, 0, 'untitled tasks dropped');
});

test('parseDraft refuses an unreadable answer', () => {
  for (const bad of ['', 'no json here', '{"tasks": [', '{"tasks":[}']) {
    let threw = '';
    try { wp.parseDraft(bad); } catch (e) { threw = e.message; }
    eq(threw, 'AI_UNREADABLE', JSON.stringify(bad));
  }
});

test('resolveDraft fills a field only on one exact match (names, or a unique W-number)', () => {
  const r = wp.resolveDraft(draftOf({ project: 'barlin residence', work: 'Barlin Additional Works', team: 'Team test',
    responsible: 'W-0019', helpers: ['Pedro Santos (W-0007)'], source_passage: 'Si Juan ang electrical', flags: ['check wording'] }), ctx);
  eq([r.values.folder_id, r.values.work_id, r.values.team_id, r.values.responsible_id, r.values.helper_ids, r.values.checks],
     ['F1', 'AW1', 'T1', 'w19', ['w7'], []]);
  eq(r.values.source_passage, 'Si Juan ang electrical');
  ok(r.flags.includes('check wording') && r.values.office_flags === r.flags, 'AI flags kept as office flags');
  eq(wp.taskProblem(r.values), null, 'fully resolved draft can be saved');
  eq(wp.resolveDraft(draftOf({ project: 'Barlin Residence', work: 'Main Contract', responsible: 'Pedro Santos' }), ctx).values.work_id, 'F1',
     'Main Contract only when the AI says so');
});

test('resolveDraft never turns an unknown or missing Additional Works into Main Contract', () => {
  const unknown = wp.resolveDraft(draftOf({ project: 'Barlin Residence', work: 'Garage extension', responsible: 'Pedro Santos' }), ctx);
  eq([unknown.values.folder_id, unknown.values.work_id], ['F1', C]);
  ok(unknown.flags.includes('Additional Works not recognised: "Garage extension"'), JSON.stringify(unknown.flags));
  eq(wp.taskProblem(unknown.values), 'NEEDS_CHOICE');
  const missing = wp.resolveDraft(draftOf({ project: 'Barlin Residence', responsible: 'Pedro Santos' }), ctx);
  eq(missing.values.work_id, C);
  ok(missing.flags.includes('Main Contract or Additional Works not given — choose one'), JSON.stringify(missing.flags));
});

test('resolveDraft: duplicate project, team and worker names need an explicit choice', () => {
  const r = wp.resolveDraft(draftOf({ project: 'Castro Residence', work: 'Main Contract', team: 'Team A', responsible: 'Juan Cruz' }), ctx);
  eq([r.values.folder_id, r.values.work_id, r.values.team_id, r.values.responsible_id], [C, C, C, C]);
  for (const f of ['Project "Castro Residence" matches 2 names — choose one', 'Team "Team A" matches 2 names — choose one',
                   'Person "Juan Cruz" matches 2 names — choose one'])
    ok(r.flags.includes(f), 'missing flag: ' + f + ' in ' + JSON.stringify(r.flags));
  eq(wp.taskProblem(Object.assign({}, r.values, { title: 'Work' })), 'NEEDS_CHOICE');
  eq(wp.resolveDraft(draftOf({ responsible: 'Juan Cruz (W-0023)' }), ctx).values.responsible_id, 'w23', 'a unique W-number decides');
  const clash = wp.resolveDraft(draftOf({ responsible: 'Pedro Santos (W-0023)' }), ctx);
  eq(clash.values.responsible_id, C, 'a name and a W-number that disagree are not guessed');
  ok(clash.flags.includes('Person "Pedro Santos (W-0023)" matches 2 names — choose one'), 'flag explains: ' + JSON.stringify(clash.flags));
});

test('resolveDraft: unknown helpers and unclear dates must be confirmed; waits-for and materials become flags', () => {
  const r = wp.resolveDraft(draftOf({ project: 'Barlin Residence', work: 'Main Contract', responsible: 'Pedro Santos',
    helpers: ['Kuya Ben', 'Pedro Santos'], planned_start: 'Monday', waits_for: ['wall prep'], materials: ['THHN 3.5', 'conduit'] }), ctx);
  eq(r.values.helper_ids, [], 'the responsible person is never also a helper');
  eq(r.values.checks, ['helpers', 'dates']);
  for (const f of ['Person not recognised: "Kuya Ben"', 'Start date unclear: "Monday"',
                   'Waits for: wall prep — link it after both are drafts', 'Materials mentioned: THHN 3.5, conduit'])
    ok(r.flags.includes(f), 'missing flag: ' + f);
  eq(wp.taskProblem(r.values), 'NEEDS_CHOICE');
  eq(wp.taskProblem(Object.assign({}, r.values, { checks: [] })), null, 'confirmed → can be saved');
  const none = wp.resolveDraft(draftOf({}), ctx);
  ok(none.flags.includes('No project given — choose one') && none.flags.includes('No responsible person given — choose one'), 'missing names flagged');
});

console.log('\nworkplan-admin: history and errors');

test('eventText adds the note', () => {
  eq(wp.eventText({ kind: 'sent_back', note: 'Kulang ang palitada' }), 'Sent back — Kulang ang palitada');
  eq(wp.eventText({ kind: 'revised', note: 'Changed: planned dates' }), 'Revised — everyone on the task must read it again — Changed: planned dates');
  eq(wp.eventText({ kind: 'published', note: '' }), 'Published');
  eq(wp.eventText({ kind: 'mystery', note: '' }), 'mystery');
});

test('errorMessage maps every Work Plan and AI code, and never a code inside another', () => {
  for (const code of ['TITLE_REQUIRED', 'BAD_DESTINATION', 'BAD_PERSON', 'NO_RESPONSIBLE', 'DEPENDENCY_CYCLE', 'HAS_DEPENDENTS',
                      'TASK_CLOSED', 'TASK_BLOCKED', 'BAD_STATE', 'REASON_REQUIRED', 'NOTE_REQUIRED', 'NEEDS_CHOICE',
                      'NOTES_TOO_LONG', 'AI_UNREADABLE', 'AI_FAILED', 'AI_NOT_SIGNED_IN', 'AI_NOT_ALLOWED', 'AI_TOO_LARGE', 'AI_RATE_LIMITED'])
    eq(wp.errorMessage({ message: code }), wp.ERRORS[code], code);
  ok(wp.errorMessage({ message: 'XBAD_STATEX' }).startsWith('Something went wrong'), 'no partial match');
});

test('the shared modal shows Work Plan sentences (requests-admin-core modal takes errorMessage)', () => {
  ok(/\(opts\.errorMessage \|\| errorMessage\)\(err\)/.test(src('js/requests-admin-core.js')), 'modal must use opts.errorMessage');
});

console.log('\nworkplan-admin: guards across every Work Plan file');

const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => /^workplan-admin-.*\.js$/.test(f));
const granted = new Set();
for (const m of ['supabase/migrations/0086_workmate_requests_office.sql', 'supabase/migrations/0093_workmate_my_work.sql',
                 'supabase/migrations/0094_workmate_work_plan_office.sql']) {
  for (const g of src(m).matchAll(/grant execute on function (\w+)\(/g)) granted.add(g[1]);
}

test('every RPC the Work Plan screens call is granted to signed-in users', () => {
  ok(files.length >= 1, 'no workplan-admin files found');
  for (const f of files) {
    for (const c of src('js/' + f).matchAll(/rpc\('(\w+)'/g)) ok(granted.has(c[1]), f + ' calls ' + c[1] + ', which is not granted');
  }
});

test('no money in the Work Plan files', () => {
  for (const rel of files.map(f => 'js/' + f).concat(['css/workplan-admin.css'])) {
    ok(!/peso|₱|\bamount\b|\bprice\b|\bcost\b/i.test(src(rel)), rel + ' mentions money');
  }
});

// ── Task 4 appends its tests above this line ──

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/workplan-admin.test.js` → FAIL `Cannot find module '../js/workplan-admin-core.js'`; exit code 1.

- [ ] **Step 3: Let the shared modal take a translator**

In `js/requests-admin-core.js`, inside `modal(opts)`'s submit handler, change

```js
                errorBox.textContent = errorMessage(err);
```

to

```js
                errorBox.textContent = (opts.errorMessage || errorMessage)(err);
```

Change nothing else in that file.

- [ ] **Step 4: Create the core**

Create `js/workplan-admin-core.js` (LF):

```js
// ════════════════════════════════════════════════════════════════════
// Work Plan (WorkMate My Work, 0093/0094) — shared core for the office.
//
// The office (owner + staff) turns meeting notes into tasks, publishes
// them with shared notes, and checks the work:
//   js/workplan-admin-form.js     — the task form (create / edit)
//   js/workplan-admin-board.js    — the Board: the office lists
//   js/workplan-admin-task.js     — one task: people, problems, photos, decisions
//   js/workplan-admin-meetings.js — meetings, AI drafts, publishing
// Every change goes through an office RPC; nothing here writes a table.
// NO MONEY anywhere. AI only suggests: names are filled in only on ONE
// exact match, and the office reviews every draft before saving.
//
// Reuses js/requests-admin-core.js (load it first). Works in a browser
// (window.WorkPlanAdmin, window.initWorkPlanModule) and in Node for
// tests/workplan-admin.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    const IN_NODE = typeof module !== 'undefined' && module.exports;
    const RAP = IN_NODE ? require('./requests-admin-core.js') : root.RequestsAdmin;
    if (!RAP) return;

    // ── Task states ─────────────────────────────────────────────────

    const STATUS_LABEL = {
        draft: 'Draft', not_started: 'Not started', in_progress: 'In progress', reported_done: 'Reported done',
        leader_checked: 'Leader checked', completed: 'Completed', cancelled: 'Cancelled',
    };
    const STATUS_PILL = {
        draft: 'att-pill--none', not_started: 'att-pill--hidden', in_progress: 'att-pill--working',
        reported_done: 'att-pill--pc', leader_checked: 'att-pill--pc', completed: 'att-pill--done', cancelled: 'att-pill--hidden',
    };
    const LIVE = ['not_started', 'in_progress', 'reported_done', 'leader_checked'];

    // A draft a team leader proposed reads "Proposal" until the office acts.
    function statusLabel(t) {
        if (t.status === 'draft' && t.proposed_by) return 'Proposal';
        return STATUS_LABEL[t.status] || String(t.status || '');
    }
    function statusPill(t) {
        if (t.status === 'draft' && t.proposed_by) return 'att-pill--pm';
        return STATUS_PILL[t.status] || 'att-pill--none';
    }

    // Planned days are calendar days: read their parts, never a time zone.
    function plannedLabel(t) {
        const s = t.planned_start ? RAP.formatDay(t.planned_start) : '';
        const e = t.planned_end ? RAP.formatDay(t.planned_end) : '';
        if (s && e) return s === e ? s : s + ' – ' + e;
        if (e) return 'By ' + e;
        if (s) return 'From ' + s;
        return '—';
    }

    // ── The office lists (spec §15) ─────────────────────────────────

    // One heading per task; the first that matches wins, in this order.
    const GROUPS = [
        { key: 'check',   title: 'Waiting for your check',          test: t => t.status === 'reported_done' || t.status === 'leader_checked' },
        { key: 'blocked', title: 'Blocked',                         test: t => !!t.blocked && (t.status === 'not_started' || t.status === 'in_progress') },
        { key: 'unacked', title: 'Not acknowledged after 24 hours', test: t => !!t.not_acknowledged_24h },
        { key: 'overdue', title: 'Overdue',                         test: t => !!t.overdue },
        { key: 'active',  title: 'Not started and in progress',     test: t => t.status === 'not_started' || t.status === 'in_progress' },
        { key: 'drafts',  title: 'Drafts and proposals',            test: t => t.status === 'draft' },
        { key: 'done',    title: 'Completed in the last 30 days',   test: t => t.status === 'completed' },
    ];

    function boardGroups(tasks) {
        const out = GROUPS.map(g => ({ key: g.key, title: g.title, tasks: [] }));
        (tasks || []).forEach(t => {
            const i = GROUPS.findIndex(g => g.test(t));
            if (i >= 0) out[i].tasks.push(t);
        });
        return out.filter(g => g.tasks.length);
    }

    function alertCounts(tasks) {
        const all = tasks || [];
        const live = all.filter(t => LIVE.includes(t.status));
        return {
            check: live.filter(t => t.status === 'reported_done' || t.status === 'leader_checked').length,
            blocked: live.filter(t => t.blocked).length,
            unacked: live.filter(t => t.not_acknowledged_24h).length,
            overdue: live.filter(t => t.overdue).length,
            proposals: all.filter(t => t.status === 'draft' && t.proposed_by).length,
        };
    }

    function norm(s) {
        return String(s === null || s === undefined ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function filterBoard(tasks, opts) {
        const o = opts || {};
        const text = norm(o.text);
        return (tasks || []).filter(t => {
            if (o.folder && t.folder_id !== o.folder) return false;
            if (!text) return true;
            const hay = [t.title, t.project_name, t.work_name, t.team_name, t.responsible && t.responsible.name]
                .concat((t.helpers || []).map(h => h.name)).join(' ');
            return norm(hay).includes(text);
        });
    }

    // ── The task form ───────────────────────────────────────────────

    const DAY = /^\d{4}-\d{2}-\d{2}$/;

    // A field the office must still choose (an AI name that matched no
    // name, or more than one). Never sent to the server.
    const CHOOSE = '?';
    const CHOICE_FIELDS = ['folder_id', 'work_id', 'team_id', 'responsible_id'];

    // The server's own checks, so the office hears about them before Save.
    function taskProblem(v) {
        if (CHOICE_FIELDS.some(k => v[k] === CHOOSE) || (v.checks || []).length) return 'NEEDS_CHOICE';
        if (!String(v.title || '').trim()) return 'TITLE_REQUIRED';
        if (!v.folder_id || !v.work_id) return 'BAD_DESTINATION';
        if ((v.planned_start && !DAY.test(v.planned_start)) || (v.planned_end && !DAY.test(v.planned_end))) return 'BAD_DATES';
        if (v.planned_start && v.planned_end && v.planned_end < v.planned_start) return 'BAD_DATES';
        if (v.responsible_id && (v.helper_ids || []).includes(v.responsible_id)) return 'BAD_PERSON';
        return null;
    }

    const uniq = a => Array.from(new Set((a || []).filter(Boolean)));

    // wp_office_save_task is a FULL save: every field, arrays never null.
    function buildTaskPayload(v) {
        const out = {
            folder_id: v.folder_id,
            work_id: v.work_id,
            title: String(v.title || '').trim(),
            instructions: String(v.instructions || '').trim(),
            helper_ids: uniq(v.helper_ids),
            depends_on: uniq(v.depends_on),
            office_flags: Array.isArray(v.office_flags) ? v.office_flags.slice() : [],
            source_passage: String(v.source_passage || ''),
        };
        ['meeting_id', 'team_id', 'responsible_id', 'planned_start', 'planned_end'].forEach(k => { if (v[k]) out[k] = v[k]; });
        if (v.minor_text_only) out.minor_text_only = true;
        const note = String(v.change_note || '').trim();
        if (note) out.change_note = note;
        return out;
    }

    function docToForm(d) {
        return {
            meeting_id: d.meeting_id || '', folder_id: d.folder_id || '', work_id: d.work_id || '', team_id: d.team_id || '',
            responsible_id: d.responsible ? d.responsible.id : '',
            helper_ids: (d.helpers || []).map(h => h.id), depends_on: (d.depends_on || []).slice(),
            title: d.title || '', instructions: d.instructions || '',
            planned_start: d.planned_start || '', planned_end: d.planned_end || '',
            source_passage: d.source_passage || '',
            office_flags: Array.isArray(d.office_flags) ? d.office_flags.slice() : [],
            checks: [],
        };
    }

    // What saving would change for the people on a PUBLISHED task — the
    // same rule as wp_office_save_task (0094): people, team and planned
    // dates always need a new reading; wording (`text`) does unless the
    // office marks it a minor spelling correction.
    function revisionChanges(doc, v) {
        if (!doc || doc.status === 'draft') return { changes: [], text: false };
        const sameSet = (a, b) => {
            const x = uniq(a).sort(), y = uniq(b).sort();
            return x.length === y.length && x.every((e, i) => e === y[i]);
        };
        const changes = [];
        if ((v.responsible_id || '') !== (doc.responsible ? doc.responsible.id : '')
            || !sameSet(v.helper_ids, (doc.helpers || []).map(h => h.id))) changes.push('people');
        if ((v.team_id || '') !== (doc.team_id || '')) changes.push('team');
        if ((v.planned_start || '') !== (doc.planned_start || '') || (v.planned_end || '') !== (doc.planned_end || '')) changes.push('planned dates');
        const text = String(v.title || '').trim() !== String(doc.title || '')
                  || String(v.instructions || '').trim() !== String(doc.instructions || '');
        return { changes, text };
    }

    // A full save sends every link. Anything the office did not see on
    // screen stays; only what it unticked goes.
    function keepSelections(original, shown, ticked) {
        const seen = new Set(shown || []);
        return uniq((original || []).filter(id => !seen.has(id)).concat(ticked || []));
    }

    // ── Unsaved meeting edits ───────────────────────────────────────

    // The screen's fields: the server copy, overlaid with what the office
    // typed but has not saved yet (survives redraws, not a reload).
    function meetingFields(m, pending) {
        const s = m || {};
        const latest = (s.versions || [])[0] || null;   // newest first
        return Object.assign({ title: s.title || '', held_on: s.held_on || '', notes: s.original_notes || '',
                               shared: latest ? latest.shared_notes || '' : '', recip: 'default', people: [], change: '' },
                             pending || {});
    }

    function meetingUnsaved(m, pending) {
        const saved = meetingFields(m);
        return Object.keys(pending || {}).some(k => JSON.stringify(pending[k]) !== JSON.stringify(saved[k]));
    }

    // After a save or publish: forget only the edits that were sent, IN
    // PLACE. The screen's input handlers keep writing to this same object,
    // so text typed while the save ran — or after it, while the AI is
    // still drafting — is never lost. Returns the same object.
    function settlePending(pending, sent) {
        if (!pending) return pending;
        Object.keys(sent || {}).forEach(k => {
            if (k in pending && JSON.stringify(pending[k]) === JSON.stringify(sent[k])) delete pending[k];
        });
        return pending;
    }

    // Each screen load takes a ticket; only the newest ticket may draw, so a
    // slow answer for a meeting or task the office has left never replaces
    // the one now open.
    function loadTickets() {
        let last = 0;
        return { take: () => ++last, isLatest: ticket => ticket === last };
    }

    // ── History and problems ────────────────────────────────────────

    const BLOCKER_KIND = { materials: 'Materials', tool: 'Tool', preparation: 'Preparation', other: 'Other' };
    function blockerKind(k) { return BLOCKER_KIND[k] || String(k || ''); }

    const EVENT_TEXT = {
        drafted: 'Drafted', proposed: 'Proposed by a team leader', edited: 'Edited',
        revised: 'Revised — everyone on the task must read it again', published: 'Published',
        acknowledged: 'Read it ("I\'ve read this")', started: 'Started work', progress: 'Progress',
        blocker_reported: 'Reported a problem', blocker_cleared: 'Problem cleared', reported_done: 'Reported done',
        leader_checked: 'Leader checked', sent_back: 'Sent back', approved: 'Approved — completed', reopened: 'Reopened',
        cancelled: 'Cancelled', photo_attached: 'Added a photo', meeting_created: 'Meeting created',
        notes_published: 'Shared notes published',
    };
    function eventText(ev) {
        const base = EVENT_TEXT[ev && ev.kind] || String((ev && ev.kind) || '');
        return ev && ev.note ? base + ' — ' + ev.note : base;
    }

    // ── Error codes → sentences ─────────────────────────────────────

    const ERRORS = {
        OFFICE_ONLY: 'Only active office accounts (owner or staff) can do this.',
        NOT_FOUND: 'This task or meeting no longer exists, or belongs to another company. Reload the page.',
        TITLE_REQUIRED: 'Give it a title.',
        BAD_DATES: 'Check the dates: use real days, and the end cannot be before the start.',
        BAD_DESTINATION: 'Choose an open project, then Main Contract or one of its own Additional Works. A published task keeps its project.',
        BAD_TEAM: 'Choose an active team of your company, or no team.',
        BAD_PERSON: 'Choose active workers or team leaders (from the task\'s team, if it has one). The responsible person cannot also be a helper.',
        NO_RESPONSIBLE: 'Choose the responsible person first.',
        BAD_DEPENDENCY: 'A task can only wait for another task of the same project. Remove that link first.',
        DEPENDENCY_CYCLE: 'That would make tasks wait for each other in a circle.',
        HAS_DEPENDENTS: 'Another task still waits for this one. Remove that link first.',
        TASK_CLOSED: 'This task is completed or cancelled and can no longer be edited.',
        TASK_BLOCKED: 'This task still has an open problem or an unfinished earlier task. Clear it first.',
        BAD_STATE: 'This task has moved on since you opened it. Reload the page.',
        REASON_REQUIRED: 'Write a short reason. It is saved in the task\'s history.',
        NOTE_REQUIRED: 'Write a short note about what was checked.',
        BAD_OPERATION: 'Part of the form could not be read. Reload and try again.',
        // Browser-side
        NEEDS_CHOICE: 'Choose every field marked "Needs your choice", and tick the boxes confirming you checked the helpers or dates. The AI could not match them.',
        NO_NOTES: 'Type or paste the meeting notes first.',
        NOTES_TOO_LONG: 'The notes are too long for the AI (20,000 characters at most). Split them, or add tasks by hand.',
        NO_RECIPIENTS: 'Choose at least one person to receive the notes.',
        AI_UNREADABLE: 'The AI answer could not be read. Try again, or add the tasks by hand.',
        AI_FAILED: 'The AI did not answer. Try again, or add the tasks by hand.',
        // From the AI worker
        AI_NOT_SIGNED_IN: 'Your sign-in has expired. Reload the page and sign in again to use the AI.',
        AI_NOT_ALLOWED: 'This account cannot use AI drafting. Add the tasks by hand.',
        AI_TOO_LARGE: 'Too much text for the AI. Shorten the notes, or add tasks by hand.',
        AI_RATE_LIMITED: 'AI limit reached (per person: 10 drafts in 10 minutes, 50 in any 24 hours). Add tasks by hand, or try again later.',
    };

    function errorMessage(error) {
        const text = String((error && (error.message || error.error_description || error.error)) || (typeof error === 'string' ? error : '') || '');
        for (const code of Object.keys(ERRORS)) {
            if (new RegExp('(^|[^A-Z_])' + code + '($|[^A-Z_])').test(text)) return ERRORS[code];
        }
        return 'Something went wrong: ' + (text || 'unknown error');
    }

    // ── AI drafts (spec §4, §5) ─────────────────────────────────────

    const NOTES_MAX = 20000;

    const DRAFT_RULES = [
        'You turn construction meeting notes into DRAFT tasks for DAC\'s Building Design Services (Philippines). Office staff review every draft before any worker sees it.',
        'Answer with ONLY one JSON object, no other text, in exactly this shape:',
        '{"tasks":[{"title":"","instructions":"","project":"","work":"","team":"","responsible":"","helpers":[],"planned_start":null,"planned_end":null,"waits_for":[],"materials":[],"source_passage":"","flags":[]}],"shared_notes":""}',
        'Rules:',
        '- One task per distinct piece of work for one project. "work" is "Main Contract" or the name of one of that project\'s Additional Works. If the notes do not say which, leave "work" empty and add a flag.',
        '- Copy project, Additional Works, team and person names EXACTLY from the lists below. If a name in the notes is not in the lists, is unclear, or could be more than one entry, leave the field empty and explain in "flags".',
        '- Never invent dates, quantities, names, projects or deadlines. Give planned_start / planned_end only when the notes state them, as YYYY-MM-DD; otherwise null, and add a flag when the timing is vague (for example "next week").',
        '- "waits_for": short descriptions of earlier work that must finish first. "materials": materials or tools the task needs, as written in the notes.',
        '- "source_passage": the exact sentence or sentences from the notes this task comes from.',
        '- Write "title", "instructions" and "shared_notes" in the language of the notes: mostly Tagalog gives clear Tagalog; mixed gives natural Taglish; English gives English. Keep the facts unchanged.',
        '- "shared_notes": a short summary of the meeting that is safe for workers to read. Leave out money, prices, pay, salaries, penalties and private or personal matters.',
    ];

    function draftMessages(notes, ctx) {
        const c = ctx || {};
        const projects = (c.projects || []).map(p => '- ' + p.name +
            ((p.works || []).length ? ' [Additional Works: ' + p.works.map(w => w.name).join('; ') + ']' : '')).join('\n');
        const people = (c.people || []).map(p => '- ' + p.name + (RAP.workerNo(p.worker_no) ? ' (' + RAP.workerNo(p.worker_no) + ')' : '')).join('\n');
        const teams = (c.teams || []).map(t => '- ' + t.name).join('\n');
        return [
            { role: 'system', content: DRAFT_RULES.join('\n') + '\n\nProjects:\n' + (projects || '- (none)') +
                '\n\nPeople:\n' + (people || '- (none)') + '\n\nTeams:\n' + (teams || '- (none)') },
            { role: 'user', content: 'Meeting held on ' + (c.heldOn || '') + '. Notes:\n' + String(notes || '') },
        ];
    }

    function clean(x, max) {
        const s = String(x === null || x === undefined ? '' : x).trim();
        return (s.toLowerCase() === 'null' ? '' : s).slice(0, max);
    }
    function cleanList(x) {
        return Array.isArray(x) ? x.map(y => clean(y, 200)).filter(Boolean) : [];
    }

    function parseDraft(text) {
        const s = String(text || '');
        const a = s.indexOf('{');
        const b = s.lastIndexOf('}');
        if (a < 0 || b <= a) throw new Error('AI_UNREADABLE');
        let obj;
        try { obj = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('AI_UNREADABLE'); }
        const day = x => (DAY.test(String(x || '')) ? String(x) : null);
        const tasks = (Array.isArray(obj && obj.tasks) ? obj.tasks : []).slice(0, 30).map(t => ({
            title: clean(t.title, 200), instructions: clean(t.instructions, 4000),
            project: clean(t.project, 200), work: clean(t.work, 200), team: clean(t.team, 200),
            responsible: clean(t.responsible, 200), helpers: cleanList(t.helpers),
            planned_start: day(t.planned_start), planned_end: day(t.planned_end),
            raw_start: clean(t.planned_start, 40), raw_end: clean(t.planned_end, 40),
            waits_for: cleanList(t.waits_for), materials: cleanList(t.materials),
            source_passage: clean(t.source_passage, 2000), flags: cleanList(t.flags),
        })).filter(t => t.title);
        return { tasks, shared_notes: clean(obj && obj.shared_notes, 4000) };
    }

    // Every entry whose name is exactly this one (case and spaces aside).
    function hits(list, name) {
        const n = norm(name);
        return n ? (list || []).filter(x => norm(x.name) === n) : [];
    }
    // A person by a W-number that matches exactly one account; otherwise
    // by name (with any "(W-0007)" taken out).
    function personHits(people, hint) {
        const raw = String(hint || '');
        const m = /\bW-?0*(\d{1,6})\b/i.exec(raw);
        const name = raw.replace(/\(?\s*\bW-?\d{1,6}\b\s*\)?/gi, '').trim();
        if (m) {
            const byNo = (people || []).filter(x => Number(x.worker_no) === Number(m[1]));
            if (byNo.length === 1) {
                // A name that points to someone else must not be overridden by the number: ask the office.
                const named = name ? hits(people, name) : [];
                return named.length && !named.includes(byNo[0]) ? byNo.concat(named) : byNo;
            }
        }
        return hits(people, name || raw);
    }
    function unmatched(what, raw, count) {
        return count > 1 ? what + ' "' + raw + '" matches ' + count + ' names — choose one'
                         : what + ' not recognised: "' + raw + '"';
    }

    // AI names → the company's real ids, ONLY on one exact match. Anything
    // else is left as CHOOSE (the form refuses to save until the office
    // picks) and explained in a flag (spec §4: flag, never guess). An
    // unnamed or unknown Additional Works never becomes Main Contract.
    function resolveDraft(t, ctx) {
        const c = ctx || {};
        const flags = t.flags.slice();
        const checks = [];
        const v = {
            folder_id: CHOOSE, work_id: CHOOSE, team_id: '', responsible_id: CHOOSE, helper_ids: [], depends_on: [],
            title: t.title, instructions: t.instructions, planned_start: t.planned_start || '', planned_end: t.planned_end || '',
            source_passage: t.source_passage,
        };

        const proj = hits(c.projects, t.project);
        if (!t.project) flags.push('No project given — choose one');
        else if (proj.length !== 1) flags.push(unmatched('Project', t.project, proj.length));
        else v.folder_id = proj[0].folder_id;

        if (v.folder_id !== CHOOSE) {
            if (norm(t.work) === 'main contract') v.work_id = v.folder_id;
            else if (!t.work) flags.push('Main Contract or Additional Works not given — choose one');
            else {
                const w = hits(proj[0].works, t.work);
                if (w.length === 1) v.work_id = w[0].work_id;
                else flags.push(unmatched('Additional Works', t.work, w.length));
            }
        }

        if (t.team) {
            const tm = hits(c.teams, t.team);
            if (tm.length === 1) v.team_id = tm[0].id;
            else { v.team_id = CHOOSE; flags.push(unmatched('Team', t.team, tm.length)); }
        }

        if (!t.responsible) flags.push('No responsible person given — choose one');
        else {
            const r = personHits(c.people, t.responsible);
            if (r.length === 1) v.responsible_id = r[0].id;
            else flags.push(unmatched('Person', t.responsible, r.length));
        }

        t.helpers.forEach(h => {
            const r = personHits(c.people, h);
            if (r.length !== 1) {
                flags.push(unmatched('Person', h, r.length));
                if (!checks.includes('helpers')) checks.push('helpers');
            } else if (r[0].id !== v.responsible_id && !v.helper_ids.includes(r[0].id)) {
                v.helper_ids.push(r[0].id);
            }
        });

        if (t.raw_start && !t.planned_start) flags.push('Start date unclear: "' + t.raw_start + '"');
        if (t.raw_end && !t.planned_end) flags.push('End date unclear: "' + t.raw_end + '"');
        if ((t.raw_start && !t.planned_start) || (t.raw_end && !t.planned_end)) checks.push('dates');
        t.waits_for.forEach(w => flags.push('Waits for: ' + w + ' — link it after both are drafts'));
        if (t.materials.length) flags.push('Materials mentioned: ' + t.materials.join(', '));

        v.office_flags = flags;
        v.checks = checks;
        return { values: v, flags };
    }

    // Today in Manila as 'YYYY-MM-DD': the +8 h offset makes the UTC slice
    // the Manila calendar day (same as js/requests-admin-queue.js).
    function todayManila() {
        return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    const pure = { STATUS_LABEL, statusLabel, statusPill, plannedLabel, boardGroups, alertCounts, filterBoard,
                   CHOOSE, taskProblem, buildTaskPayload, docToForm, revisionChanges, keepSelections,
                   meetingFields, meetingUnsaved, settlePending, loadTickets, blockerKind, eventText, ERRORS, errorMessage,
                   NOTES_MAX, draftMessages, parseDraft, resolveDraft, todayManila,
                   formatDay: RAP.formatDay, formatManila: RAP.formatManila, workerNo: RAP.workerNo };

    if (IN_NODE) {
        module.exports = pure;
        return;
    }

    // ── Browser helpers ─────────────────────────────────────────────

    const AI_WORKER_URL = 'https://dacs-ai.dacsbuilding.workers.dev';

    function fail(host, error) {
        host.innerHTML = '<div class="att-stack"><div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' +
            RAP.esc(errorMessage(error)) + '</div></div></div>';
        RAP.icons();
    }

    function modal(opts) {
        return RAP.modal(Object.assign({ errorMessage }, opts));
    }

    // The worker checks the signed-in account, size and limits on the
    // server (ai_authorize, 0095) and picks the model itself.
    async function aiDraft(notes, ctx) {
        if (!String(notes || '').trim()) throw new Error('NO_NOTES');
        if (String(notes).length > NOTES_MAX) throw new Error('NOTES_TOO_LONG');
        const { data } = await root.sbClient.auth.getSession();
        const token = data && data.session ? data.session.access_token : '';
        if (!token) throw new Error('AI_NOT_SIGNED_IN');
        let res, body;
        try {
            res = await fetch(AI_WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ feature: 'work_plan_draft', messages: draftMessages(notes, ctx), temperature: 0.2 }),
            });
            body = await res.json();
        } catch (e) {
            throw new Error('AI_FAILED');
        }
        if (!res.ok) {
            const code = body && body.error && body.error.code;
            throw new Error(code && ERRORS[code] ? code : 'AI_FAILED');
        }
        const text = body && body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message.content : '';
        return parseDraft(text);
    }

    const state = { taskId: null, meetingId: null };
    const views = {};

    function openTask(id) { state.taskId = id; root.switchView('wpTask'); }
    function openMeeting(id) { state.meetingId = id; root.switchView('wpMeeting'); }

    root.WorkPlanAdmin = Object.assign({}, pure, {
        esc: RAP.esc, icons: RAP.icons, rpc: RAP.rpc, head: RAP.head, signImages: RAP.signImages,
        fail, modal, aiDraft, AI_WORKER_URL, state, views, openTask, openMeeting,
    });

    root.initWorkPlanModule = function (view) {
        const host = document.getElementById(view + 'View');
        const render = views[view];
        if (host && render) render(host);
    };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: Add the test to `npm test`**

In `package.json`, append ` && node tests/workplan-admin.test.js` to the end of the `"test"` script string. Edit tool; nothing else.

- [ ] **Step 6: Run the tests**

Run: `node tests/workplan-admin.test.js` → all pass, exit 0.
Run: `node --check js/workplan-admin-core.js && node --check js/requests-admin-core.js` → no output.
Run: `npm test` → all suites green (including `requests-admin`: the modal keeps its old behaviour when no `errorMessage` is passed).

- [ ] **Step 7: Stop — no commit.** Report to the controller.

---

### Task 3: AI gate — migration 0095, the worker, the budget summary

**Files:**
- Create: `supabase/migrations/0095_ai_request_gate.sql`, `supabase/tests/1c2_ai_gate.sql`, `supabase/tests/1c2_ai_gate_concurrency.mjs`, `tests/ai-worker.test.js`
- Modify: `cloudflare-worker/worker.js`, `cloudflare-worker/wrangler.toml`, `cloudflare-worker/SETUP.md`, `.gitignore`, `js/ai-summary.js`, `admin.html` (one script tag), `tests/workmate-office-server.test.js` (append above its marker), `package.json`, `supabase/migrations/README.md` (CRLF), `docs/DATABASE_SCHEMA.md` (CRLF)

**Interfaces:**
- Consumes: `profiles` (`role`, `status`, `allowed_modules` jsonb), `data_owner_id()`; Task 2's request shape (`feature: 'work_plan_draft'`, bearer token, `{error: {code}}` replies).
- Produces:
  - `ai_authorize(p_feature text, p_chars integer) returns jsonb` → `{ok: true, feature}`; raises `AI_NOT_SIGNED_IN`, `AI_NOT_ALLOWED`, `AI_TOO_LARGE`, `AI_RATE_LIMITED`. Table `ai_requests` (no client access).
  - Worker contract: `POST` with `Authorization: Bearer <Supabase access token>`, body `{feature: 'budget_summary'|'work_plan_draft', messages: [{role: 'system'|'user', content}] (1–4), temperature?, max_tokens?}` → `200 {choices: [{message: {role, content}}]}` or `{error: {code, message}}` with 400 `AI_BAD_REQUEST`, 401 `AI_NOT_SIGNED_IN`, 403 `AI_NOT_ALLOWED`, 413 `AI_TOO_LARGE`, 429 `AI_RATE_LIMITED`, 502 `AI_FAILED`, 503 `AI_GATE_UNAVAILABLE`. Any `model` in the body is ignored.

- [ ] **Step 1: Write the failing tests**

Create `tests/ai-worker.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// AI WORKER TESTS:  node tests/ai-worker.test.js
//
// Runs the REAL cloudflare-worker/worker.js in Node with a fake Workers AI,
// a fake rate limiter and a fake Supabase ai_authorize(). Proves every
// refusal happens BEFORE any AI call, that the worker (not the browser)
// picks the model and caps the answer, and that both portal features send
// what the worker requires. Live limits: supabase/tests/1c2_ai_gate.sql.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WORKER = src('cloudflare-worker/worker.js');
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error((label || '') + ' expected ' + b + ', got ' + a);
}

function setup(o) {
  const opt = o || {};
  const calls = { gate: [], ai: [], limiter: 0 };
  const fetchImpl = async (url, init) => {
    calls.gate.push({ url, init });
    if (opt.gateThrows) throw new Error('network down');
    const g = opt.gate || { status: 200, body: { ok: true } };
    return new Response(JSON.stringify(g.body), { status: g.status, headers: { 'Content-Type': 'application/json' } });
  };
  const mod = { exports: {} };
  new Function('module', 'fetch', WORKER.replace('export default', 'module.exports ='))(mod, fetchImpl);
  const env = {
    SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key',
    AI: { run: async (model, input) => {
      calls.ai.push({ model, input });
      if (opt.aiThrows) throw new Error('model error');
      return opt.aiResult || { response: 'hello' };
    } },
    PREAUTH_LIMITER: { limit: async () => { calls.limiter++; return { success: !opt.limited }; } },
  };
  const run = (body, headers, method) => mod.exports.fetch(new Request('https://dacs-ai.example/', {
    method: method || 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://dacs-company.vercel.app' }, headers || {}),
    body: method === 'OPTIONS' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  }), env);
  return { run, calls };
}
const AUTH = { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln' };
const draft = (extra) => Object.assign({ feature: 'work_plan_draft',
  messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'notes' }] }, extra || {});
const summary = (extra) => Object.assign({ feature: 'budget_summary', messages: [{ role: 'user', content: 'budget' }] }, extra || {});
async function expectRefused(res, status, code) {
  eq(res.status, status, 'status');
  eq((await res.json()).error.code, code, 'code');
}

(async () => {
  console.log('\nai worker: refused before any AI call');

  await test('no session token: 401, nothing else runs', async () => {
    const { run, calls } = setup();
    await expectRefused(await run(draft()), 401, 'AI_NOT_SIGNED_IN');
    eq([calls.limiter, calls.gate.length, calls.ai.length], [0, 0, 0]);
  });

  await test('flood guard: 429 before the database or AI', async () => {
    const { run, calls } = setup({ limited: true });
    await expectRefused(await run(draft(), AUTH), 429, 'AI_RATE_LIMITED');
    eq([calls.gate.length, calls.ai.length], [0, 0]);
  });

  await test('body over 64 KB: 413 before the database or AI', async () => {
    const { run, calls } = setup();
    await expectRefused(await run(draft({ messages: [{ role: 'user', content: 'x'.repeat(70000) }] }), AUTH), 413, 'AI_TOO_LARGE');
    eq([calls.gate.length, calls.ai.length], [0, 0]);
  });

  await test('feature input cap: a 4,001-character summary is refused before the database', async () => {
    const { run, calls } = setup();
    await expectRefused(await run(summary({ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }), AUTH), 413, 'AI_TOO_LARGE');
    eq(calls.gate.length, 0);
  });

  await test('malformed requests: bad JSON, unknown feature, too many or wrong messages', async () => {
    for (const body of ['{not json', { messages: [{ role: 'user', content: 'x' }] }, draft({ feature: 'chat' }),
                        draft({ messages: [] }), draft({ messages: Array(5).fill({ role: 'user', content: 'x' }) }),
                        draft({ messages: [{ role: 'assistant', content: 'x' }] }), draft({ messages: [{ role: 'user', content: 5 }] })]) {
      const { run, calls } = setup();
      await expectRefused(await run(body, AUTH), 400, 'AI_BAD_REQUEST');
      eq([calls.gate.length, calls.ai.length], [0, 0], JSON.stringify(body).slice(0, 60));
    }
  });

  await test('the database gate decides: each refusal maps to its status and runs no AI', async () => {
    const cases = [
      [{ status: 400, body: { code: 'P0001', message: 'AI_RATE_LIMITED' } }, 429, 'AI_RATE_LIMITED'],
      [{ status: 400, body: { code: 'P0001', message: 'AI_NOT_ALLOWED' } }, 403, 'AI_NOT_ALLOWED'],
      [{ status: 400, body: { code: 'P0001', message: 'AI_TOO_LARGE' } }, 413, 'AI_TOO_LARGE'],
      [{ status: 400, body: { code: 'P0001', message: 'AI_NOT_SIGNED_IN' } }, 401, 'AI_NOT_SIGNED_IN'],
      [{ status: 401, body: { message: 'JWT expired' } }, 401, 'AI_NOT_SIGNED_IN'],
      [{ status: 403, body: { message: 'permission denied for function ai_authorize' } }, 403, 'AI_NOT_ALLOWED'],
      [{ status: 400, body: { message: 'something unexpected' } }, 403, 'AI_NOT_ALLOWED'],
      [{ status: 503, body: { message: 'down' } }, 503, 'AI_GATE_UNAVAILABLE'],
    ];
    for (const [gate, status, code] of cases) {
      const { run, calls } = setup({ gate });
      await expectRefused(await run(draft(), AUTH), status, code);
      eq(calls.ai.length, 0, code + ' ran the AI');
    }
    const down = setup({ gateThrows: true });
    await expectRefused(await down.run(draft(), AUTH), 503, 'AI_GATE_UNAVAILABLE');
    eq(down.calls.ai.length, 0);
  });

  console.log('\nai worker: allowed requests');

  await test('the gate is called as the caller, with the counted characters', async () => {
    const { run, calls } = setup();
    eq((await run(draft(), AUTH)).status, 200);
    eq(calls.gate.length, 1);
    eq(calls.gate[0].url, 'https://example.supabase.co/rest/v1/rpc/ai_authorize');
    eq([calls.gate[0].init.headers.apikey, calls.gate[0].init.headers.Authorization], ['anon-key', AUTH.Authorization]);
    eq(JSON.parse(calls.gate[0].init.body), { p_feature: 'work_plan_draft', p_chars: 10 });
  });

  await test('the worker picks the model and caps the answer; a requested model is ignored', async () => {
    const d = setup();
    const res = await d.run(draft({ model: '@cf/some/expensive-model', max_tokens: 99999, temperature: 5 }), AUTH);
    eq(await res.json(), { choices: [{ message: { role: 'assistant', content: 'hello' } }] });
    eq([d.calls.ai[0].model, d.calls.ai[0].input.max_tokens, d.calls.ai[0].input.temperature], [MODEL, 2000, 1]);
    const s = setup();
    await s.run(summary(), AUTH);
    eq([s.calls.ai[0].model, s.calls.ai[0].input.max_tokens, s.calls.ai[0].input.temperature], [MODEL, 700, 0.4]);
  });

  await test('answers in either Workers AI shape; an AI error is a 502', async () => {
    const c = setup({ aiResult: { choices: [{ message: { content: 'from choices' } }] } });
    eq((await (await c.run(summary(), AUTH)).json()).choices[0].message.content, 'from choices');
    const e = setup({ aiThrows: true });
    await expectRefused(await e.run(summary(), AUTH), 502, 'AI_FAILED');
  });

  await test('an already-parsed object answer comes back as its JSON string; max_tokens is at least 1', async () => {
    const o = setup({ aiResult: { response: { tasks: [{ title: 'Wall prep' }] } } });
    const res = await o.run(draft({ max_tokens: -5 }), AUTH);
    eq((await res.json()).choices[0].message.content, '{"tasks":[{"title":"Wall prep"}]}');
    ok(o.calls.ai[0].input.max_tokens >= 1, 'max_tokens must reach the model as at least 1, got ' + o.calls.ai[0].input.max_tokens);
  });

  await test('health briefing: its own caps (600 tokens, 12,000 characters)', async () => {
    const h = setup();
    await h.run({ feature: 'health_briefing', messages: [{ role: 'user', content: 'brief' }], max_tokens: 5000 }, AUTH);
    eq([h.calls.ai[0].model, h.calls.ai[0].input.max_tokens], [MODEL, 600]);
    eq(JSON.parse(h.calls.gate[0].init.body).p_feature, 'health_briefing');
    const big = setup();
    await expectRefused(await big.run({ feature: 'health_briefing', messages: [{ role: 'user', content: 'x'.repeat(12001) }] }, AUTH), 413, 'AI_TOO_LARGE');
    eq(big.calls.gate.length, 0);
  });

  await test('CORS lets the portal send the session header', async () => {
    const { run } = setup();
    const res = await run(null, {}, 'OPTIONS');
    ok(/Authorization/.test(res.headers.get('Access-Control-Allow-Headers')), 'Authorization not allowed');
    eq(res.headers.get('Access-Control-Allow-Origin'), 'https://dacs-company.vercel.app');
  });

  console.log('\nai worker: configuration and callers');

  await test('no retired model anywhere; config carries the flood guard and the public Supabase values', async () => {
    for (const f of ['cloudflare-worker/worker.js', 'js/ai-summary.js', 'js/ai-assistant.js', 'js/workplan-admin-core.js', 'cloudflare-worker/SETUP.md'])
      ok(!src(f).includes('llama-3.1-8b'), f + ' still names the retired 8B model');
    const toml = src('cloudflare-worker/wrangler.toml');
    ok(/\[\[ratelimits\]\]\s*\nname = "PREAUTH_LIMITER"\s*\nnamespace_id = "1095"/.test(toml), 'PREAUTH_LIMITER binding');
    ok(/limit = 30\s*\n\s*period = 60/.test(toml), 'flood guard 30 per 60 s');
    const key = /const SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(src('js/supabase-config.js'))[1];
    const url = /const SUPABASE_URL\s*=\s*'([^']+)'/.exec(src('js/supabase-config.js'))[1];
    ok(toml.includes('SUPABASE_ANON_KEY = "' + key + '"') && toml.includes('SUPABASE_URL = "' + url + '"'), 'Supabase values match supabase-config.js');
    ok(src('.gitignore').includes('!cloudflare-worker/wrangler.toml'), 'wrangler.toml must be tracked');
  });

  await test('all three portal features send the session and their feature name', async () => {
    const s = src('js/ai-summary.js');
    ok(/Authorization: 'Bearer ' \+ session\.access_token/.test(s) && /feature: 'budget_summary'/.test(s), 'ai-summary.js');
    const a = src('js/ai-assistant.js');
    ok(/Authorization: 'Bearer ' \+ session\.access_token/.test(a) && /feature: 'health_briefing'/.test(a), 'ai-assistant.js');
    const w = src('js/workplan-admin-core.js');
    ok(/Authorization: 'Bearer ' \+ token/.test(w) && /feature: 'work_plan_draft'/.test(w), 'workplan-admin-core.js');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
```

Insert into `tests/workmate-office-server.test.js` above `// ── Task 3 appends the 0095 tests above this line ──`:

```js
console.log('\nai request gate (0095)');
const M95 = read('supabase/migrations/0095_ai_request_gate.sql');
const C95 = strip(M95);

test('0095 exists, sets a lock timeout, holds no money', () => {
  assert(M95.length > 0, 'missing 0095_ai_request_gate.sql');
  assert(/set local lock_timeout = '5s';/.test(C95), 'no lock timeout');
  assert(!/\b[a-z_]*(price|amount|cost|peso)[a-z_]*\b/i.test(C95), 'a money word appears');
});

test('ai_requests is closed to clients (RLS on, no policy, no grants)', () => {
  assert(/alter table ai_requests enable row level security;/.test(C95), 'RLS');
  assert(!/create policy/i.test(C95), 'no policy may exist');
  assert(/revoke all on table ai_requests from anon, authenticated;/.test(C95), 'table revoked');
  assert(!/(text|input|prompt|content|notes)\s+text/i.test((C95.match(/create table if not exists ai_requests \([\s\S]*?\);/) || [''])[0]), 'never stores the text');
});

test('ai_authorize: signed in, active, role and module per feature, size, limits, serialised', () => {
  const f = fnBlock(C95, 'ai_authorize');
  assert(f && /security definer/i.test(f) && /set search_path = public/i.test(f), 'definer + search_path');
  assert(/coalesce\(v_p\.status, 'active'\) <> 'active'/.test(f), 'active only');
  assert(/p_feature = 'work_plan_draft' and v_p\.role in \('owner', 'staff'\)/.test(f), 'draft roles');
  assert(/p_feature = 'budget_summary' and v_p\.role = 'owner'/.test(f), 'summary role');
  assert(/v_p\.allowed_modules \? v_module/.test(f), 'module focus');
  assert(/v_max_chars := 40000; v_per_10min := 10; v_per_day := 50;/.test(f), 'draft limits');
  assert(/v_max_chars := 4000; v_per_10min := 20; v_per_day := 100;/.test(f), 'summary limits');
  assert(/>= 300 then/.test(f), 'company limit');
  assert(/'ai_req_user:'/.test(f) && /'ai_req_owner:'/.test(f), 'advisory locks');
  for (const code of ['AI_NOT_SIGNED_IN', 'AI_NOT_ALLOWED', 'AI_TOO_LARGE', 'AI_RATE_LIMITED']) assert(f.includes("'" + code + "'"), code);
});

test('the AI-gate concurrency test verifies TLS, hides the secret and deletes only recorded ids', () => {
  const m = read('supabase/tests/1c2_ai_gate_concurrency.mjs');
  assert(m.length > 0, 'missing 1c2_ai_gate_concurrency.mjs');
  assert(m.includes('rejectUnauthorized: true') && !m.includes('rejectUnauthorized: ' + 'false'), 'TLS must be verified');
  assert(/process\.env\.DACS_DB_URL/.test(m) && /const redact = /.test(m), 'secret from the environment, redacted');
  const deletes = [...m.matchAll(/delete from ai_requests where ([^'`]+)/g)].map(x => x[1]);
  assert(deletes.length >= 2 && deletes.every(w => /^id = any\(\$1::bigint\[\]\)|^id = \$1::bigint|^id in \(/.test(w)),
    'every delete is by recorded id: ' + JSON.stringify(deletes));
  assert(!/input_chars\s*=\s*\d/.test(m) && !/39999/.test(m), 'no deletion by value');
  assert(m.includes("currval('ai_requests_id_seq')") && /returning id/.test(m), 'ids read back before commit');
  for (const g of ['G0 ', 'G1 ', 'G2 ', 'G3 ']) assert(m.includes(g), g.trim());
  assert(!fs.existsSync(path.join(ROOT, 'supabase/tests/1c2_ai_gate_cleanup.sql')), 'no value-based recovery script');
});

test('ai_authorize callable when signed in, never by anon', () => {
  assert(C95.includes('revoke all on function ai_authorize(text, integer) from public, anon;'), 'revoke');
  assert(C95.includes('grant execute on function ai_authorize(text, integer) to authenticated;'), 'grant');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node tests/ai-worker.test.js` → many FAIL (old worker has no gate); exit 1.
Run: `node tests/workmate-office-server.test.js` → the five 0095 tests FAIL; exit 1.

- [ ] **Step 3: Create migration 0095**

Create `supabase/migrations/0095_ai_request_gate.sql` (LF):

```sql
-- 0095 — AI request gate for the dacs-ai Cloudflare worker.
--
-- ── WHY. The worker was public: any page or script could make it run
--    Workers AI. Now every request carries the caller's Supabase session
--    and the worker calls ai_authorize() AS THAT CALLER before running a
--    model. It runs nothing unless this function allows the request:
--      * signed in, and the profile is active;
--      * the feature is allowed for the account —
--          work_plan_draft: owner or staff; a module-focused account
--                           (allowed_modules) needs 'workplan';
--          budget_summary:  owner (staff never see the summary, which
--                           shows amounts); module-focused needs 'expenses';
--      * the input (characters the worker counted) fits the feature:
--          drafts 40,000, summaries 4,000;
--      * within the limits — per person per feature: drafts 10 per 10
--        minutes and 50 per rolling 24 hours, summaries 20 per 10 minutes
--        and 100 per rolling 24 hours; per company: 300 AI requests per
--        rolling 24 hours. "Rolling" = the 24 hours before this request,
--        never a calendar day.
--    Each allowed request is recorded in ai_requests (who, which feature,
--    how many characters, when — never the text); rows older than 30 days
--    are removed as people use it. A refused request records nothing.
--
-- ── Outside the money model. No client reads or writes ai_requests.

set local lock_timeout = '5s';

create table if not exists ai_requests (
  id bigserial primary key,
  owner_id uuid not null references profiles(id),
  user_id uuid not null references profiles(id),
  feature text not null check (feature in ('budget_summary', 'work_plan_draft')),
  input_chars integer not null check (input_chars > 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_requests_user_recent on ai_requests (user_id, feature, created_at);
create index if not exists ai_requests_owner_recent on ai_requests (owner_id, created_at);
alter table ai_requests enable row level security;
-- No policies: only ai_authorize() (SECURITY DEFINER) reads or writes it.
revoke all on table ai_requests from anon, authenticated;
revoke all on sequence ai_requests_id_seq from anon, authenticated;

create or replace function ai_authorize(p_feature text, p_chars integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_p profiles;
  v_owner uuid;
  v_module text;
  v_max_chars integer;
  v_per_10min integer;
  v_per_day integer;
begin
  if v_uid is null then
    raise exception 'AI_NOT_SIGNED_IN' using errcode = 'P0001';
  end if;
  select * into v_p from profiles where id = v_uid;
  if not found or coalesce(v_p.status, 'active') <> 'active' then
    raise exception 'AI_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_feature = 'work_plan_draft' and v_p.role in ('owner', 'staff') then
    v_module := 'workplan'; v_max_chars := 40000; v_per_10min := 10; v_per_day := 50;
  elsif p_feature = 'budget_summary' and v_p.role = 'owner' then
    v_module := 'expenses'; v_max_chars := 4000; v_per_10min := 20; v_per_day := 100;
  else
    raise exception 'AI_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  -- A module-focused account (allowed_modules, e.g. admin-pm@ = ["pm"])
  -- may use only the AI of the sections it was granted.
  if jsonb_typeof(v_p.allowed_modules) = 'array' and jsonb_array_length(v_p.allowed_modules) > 0
     and not (v_p.allowed_modules ? v_module) then
    raise exception 'AI_NOT_ALLOWED' using errcode = 'P0001';
  end if;
  if p_chars is null or p_chars < 1 or p_chars > v_max_chars then
    raise exception 'AI_TOO_LARGE' using errcode = 'P0001';
  end if;
  v_owner := data_owner_id();
  -- One person, then one company, at a time: two requests at once cannot
  -- both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('ai_req_user:' || v_uid::text));
  perform pg_advisory_xact_lock(hashtext('ai_req_owner:' || v_owner::text));
  if (select count(*) from ai_requests r
       where r.user_id = v_uid and r.feature = p_feature and r.created_at > now() - interval '10 minutes') >= v_per_10min
     or (select count(*) from ai_requests r
          where r.user_id = v_uid and r.feature = p_feature and r.created_at > now() - interval '24 hours') >= v_per_day
     or (select count(*) from ai_requests r
          where r.owner_id = v_owner and r.created_at > now() - interval '24 hours') >= 300 then
    raise exception 'AI_RATE_LIMITED' using errcode = 'P0001';
  end if;
  delete from ai_requests where user_id = v_uid and created_at < now() - interval '30 days';
  insert into ai_requests (owner_id, user_id, feature, input_chars) values (v_owner, v_uid, p_feature, p_chars);
  return jsonb_build_object('ok', true, 'feature', p_feature);
end;
$$;

revoke all on function ai_authorize(text, integer) from public, anon;
grant execute on function ai_authorize(text, integer) to authenticated;
```

- [ ] **Step 4: Create the gate acceptance script**

Create `supabase/tests/1c2_ai_gate.sql` (LF):

```sql
-- ════════════════════════════════════════════════════════════════════
-- Stage 1c-2 acceptance — the AI request gate (migration 0095).
--
-- Self-wrapped in begin / rollback: nothing persists (the test empties
-- and refills ai_requests only inside its own transaction). Editor-safe.
-- Accounts: W-0007 (active worker), its owner, an active staff account of
-- that owner, and — if one exists — a module-focused owner account without
-- 'workplan' (admin-pm@). Every limit is checked at its exact boundary;
-- "24 hours" is a rolling window (rows 23 hours old count, 25 hours old do
-- not). Two SIMULTANEOUS requests at a limit need two connections:
-- supabase/tests/1c2_ai_gate_concurrency.mjs.
-- Success ends with '1c2 AI gate: all checks passed'.
-- ════════════════════════════════════════════════════════════════════

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  v_w7 uuid; v_owner uuid; v_staff uuid; v_pm uuid;
begin
  select id into v_w7 from profiles where worker_no = 7 and role = 'worker' and coalesce(status, 'active') = 'active';
  assert v_w7 is not null, 'W-0007 must exist and be active';
  v_owner := (select coalesce(owner_id, id) from profiles where id = v_w7);
  assert (select role from profiles where id = v_owner) = 'owner', 'W-0007 belongs to an owner account';
  select id into v_staff from profiles where role = 'staff' and owner_id = v_owner and coalesce(status, 'active') = 'active' limit 1;
  assert v_staff is not null, 'need an active staff account';
  select id into v_pm from profiles
   where role = 'owner' and jsonb_typeof(allowed_modules) = 'array' and allowed_modules ? 'pm'
     and not allowed_modules ? 'workplan' limit 1;
  delete from ai_requests where owner_id in (v_owner, coalesce(v_pm, v_owner)) or user_id in (v_owner, v_staff, v_w7);
  perform set_config('vai.w7', v_w7::text, true);
  perform set_config('vai.owner', v_owner::text, true);
  perform set_config('vai.staff', v_staff::text, true);
  perform set_config('vai.pm', coalesce(v_pm::text, ''), true);
end $$;

-- ═══ 1. Permissions ═══
do $$
begin
  assert has_function_privilege('authenticated', 'public.ai_authorize(text, integer)', 'execute'), '1a callable when signed in';
  assert not has_function_privilege('anon', 'public.ai_authorize(text, integer)', 'execute'), '1b never anon';
  assert not has_table_privilege('authenticated', 'public.ai_requests', 'select'), '1c no client reads';
  assert not has_table_privilege('authenticated', 'public.ai_requests', 'insert'), '1d no client writes';
end $$;

set local role authenticated;

-- ═══ 2. No session ═══
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_SIGNED_IN', '2 no session, got ' || sqlerrm; end;
end $$;

-- ═══ 3. Wrong account or feature ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.w7'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '3a a worker cannot draft, got ' || sqlerrm; end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('budget_summary', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '3b staff never get the money summary, got ' || sqlerrm; end;
  begin perform ai_authorize('chat', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '3c unknown feature, got ' || sqlerrm; end;
  begin perform ai_authorize('work_plan_draft', 40001); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_TOO_LARGE', '3d over 40,000 characters, got ' || sqlerrm; end;
  begin perform ai_authorize('work_plan_draft', 0); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_TOO_LARGE', '3e empty, got ' || sqlerrm; end;
end $$;

-- ═══ 4. Per-person limit: 10 drafts in 10 minutes ═══
do $$
begin
  for i in 1..10 loop
    assert (ai_authorize('work_plan_draft', 100) ->> 'ok')::boolean, '4a request ' || i || ' allowed';
  end loop;
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '4b the 11th is refused, got ' || sqlerrm; end;
end $$;

-- ═══ 5. The owner's summary; a module-focused account without Work Plan ═══
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (ai_authorize('budget_summary', 900) ->> 'ok')::boolean, '5a the owner''s budget summary is allowed';
  assert (ai_authorize('work_plan_draft', 900) ->> 'ok')::boolean, '5b the owner may draft';
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', coalesce(nullif(current_setting('vai.pm'), ''), current_setting('vai.owner')), 'role', 'authenticated')::text, true);
do $$
begin
  if current_setting('vai.pm') <> '' then
    begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
    exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '5c a PM-only account cannot draft, got ' || sqlerrm; end;
    begin perform ai_authorize('budget_summary', 100); raise exception 'no error';
    exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '5d a PM-only account cannot summarise, got ' || sqlerrm; end;
  else
    raise notice '5c/5d skipped: no module-focused owner account without workplan';
  end if;
end $$;

-- ═══ 6. Inactive account ═══
reset role;
update profiles set status = 'inactive' where id = current_setting('vai.staff')::uuid;
delete from ai_requests where user_id = current_setting('vai.staff')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_NOT_ALLOWED', '6 an inactive account is refused, got ' || sqlerrm; end;
end $$;

-- ═══ 7. Company limit: 300 in any 24 hours, at the boundary ═══
reset role;
update profiles set status = 'active' where id = current_setting('vai.staff')::uuid;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.w7')::uuid, 'work_plan_draft', 10, now() - interval '25 hours'
  from generate_series(1, 400);
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.w7')::uuid, 'work_plan_draft', 10, now() - interval '23 hours'
  from generate_series(1, 299);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (ai_authorize('work_plan_draft', 100) ->> 'ok')::boolean, '7a the 300th in 24 hours is allowed (25-hour-old rows do not count)';
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '7b the 301st is refused, got ' || sqlerrm; end;
end $$;

-- ═══ 8. Drafts: 50 per person in any 24 hours, at the boundary ═══
reset role;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.staff')::uuid, 'work_plan_draft', 10, now() - interval '25 hours'
  from generate_series(1, 60);
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.staff')::uuid, 'work_plan_draft', 10, now() - interval '23 hours'
  from generate_series(1, 48);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (ai_authorize('work_plan_draft', 100) ->> 'ok')::boolean, '8a the 49th draft in 24 hours is allowed';
  assert (ai_authorize('work_plan_draft', 100) ->> 'ok')::boolean, '8b the 50th draft in 24 hours is allowed';
  begin perform ai_authorize('work_plan_draft', 100); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '8c the 51st is refused (only 3 in 10 minutes), got ' || sqlerrm; end;
end $$;

-- ═══ 9. Summaries: 20 per person in 10 minutes, 100 in any 24 hours; size; features apart ═══
reset role;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  begin perform ai_authorize('budget_summary', 4001); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_TOO_LARGE', '9a a summary over 4,000 characters, got ' || sqlerrm; end;
  for i in 1..20 loop
    assert (ai_authorize('budget_summary', 900) ->> 'ok')::boolean, '9b summary ' || i || ' allowed';
  end loop;
  begin perform ai_authorize('budget_summary', 900); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '9c the 21st summary in 10 minutes is refused, got ' || sqlerrm; end;
  assert (ai_authorize('work_plan_draft', 900) ->> 'ok')::boolean, '9d the summary limit does not block drafting';
end $$;

reset role;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.owner')::uuid, 'budget_summary', 900, now() - interval '25 hours'
  from generate_series(1, 30);
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
select current_setting('vai.owner')::uuid, current_setting('vai.owner')::uuid, 'budget_summary', 900, now() - interval '23 hours'
  from generate_series(1, 99);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.owner'), 'role', 'authenticated')::text, true);
do $$
begin
  assert (ai_authorize('budget_summary', 900) ->> 'ok')::boolean, '9e the 100th summary in 24 hours is allowed';
  begin perform ai_authorize('budget_summary', 900); raise exception 'no error';
  exception when others then assert sqlerrm = 'AI_RATE_LIMITED', '9f the 101st is refused, got ' || sqlerrm; end;
end $$;

-- ═══ 10. Rows older than 30 days are removed as the person uses the AI ═══
reset role;
delete from ai_requests where owner_id = current_setting('vai.owner')::uuid;
insert into ai_requests (owner_id, user_id, feature, input_chars, created_at)
values (current_setting('vai.owner')::uuid, current_setting('vai.staff')::uuid, 'work_plan_draft', 10, now() - interval '31 days');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vai.staff'), 'role', 'authenticated')::text, true);
do $$ begin perform ai_authorize('work_plan_draft', 100); end $$;
reset role;
do $$
begin
  assert not exists (select 1 from ai_requests where user_id = current_setting('vai.staff')::uuid and created_at < now() - interval '30 days'),
    '10 rows older than 30 days are removed';
end $$;

reset role;
select '1c2 AI gate: all checks passed' as result;

rollback;
```

- [ ] **Step 4a: Create the two-connection boundary test**

Create `supabase/tests/1c2_ai_gate_concurrency.mjs` (LF):

```js
// ════════════════════════════════════════════════════════════════════
// Stage 1c-2 — the AI request gate (migration 0095) under SIMULTANEOUS
// requests, with two real database connections plus an observer.
//
// WHAT IT DOES. Puts an account (or the company) exactly one request
// below a limit with COMMITTED rows. Connection A takes the last slot and
// keeps its transaction open; connection B asks at the same moment. Pass =
// B waits (it can never slip past), then is refused when A commits — or
// allowed when A rolls back (an abandoned request gives its slot back);
// never a deadlock (40P01) or a timeout.
//   G1 person, 10-minute drafting limit — A commits    → B refused
//   G2 person, 10-minute drafting limit — A rolls back → B allowed
//   G3 company, rolling 24-hour limit — the owner (A) and the staff
//      account (B) ask for the 300th slot at once     → B refused
//   G0 cleanup removed only what this run recorded
//
// SAFETY.
// - It deletes ONLY rows whose exact ids it recorded. Every usage row it
//   causes is inserted inside a transaction; its id is read back (RETURNING,
//   or currval of the id sequence in the session that inserted it) and
//   written to the ledger BEFORE that transaction commits. Cleanup and
//   recovery delete exactly those ids — nothing is matched by value, time
//   or account.
// - A control row (same account, size and time as the test rows — what a
//   value-based delete would also have hit) is recorded separately. After
//   cleanup the run proves it survived, and that every usage row the test
//   accounts had before the run survived; then it removes the control row
//   by its own id.
// - Time limits: 20 s per statement, 10 s per lock wait, 60 s idle in a
//   transaction, 120 s for the whole run (then it stops and cleans up).
// - If the process dies: node supabase/tests/1c2_ai_gate_concurrency.mjs
//   --cleanup (reads the ledger), or run the generated
//   .superpowers/1c2_ai_gate_recovery.sql (the same exact ids) in the SQL
//   editor. Until cleaned, the recorded rows count against the staff
//   account's and the company's AI limits.
// - The connection string is read from an environment variable and is
//   never printed, saved or reported (error text is redacted).
//
// RUN: the same setup as supabase/tests/1c_concurrency.mjs (DACS_DB_URL,
// PG_DIR, PG_CA; the SESSION pooler), after 0095 is applied:
//   node supabase/tests/1c2_ai_gate_concurrency.mjs
//   Remove-Item Env:DACS_DB_URL
// ════════════════════════════════════════════════════════════════════
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER = path.join(ROOT, '.superpowers', '1c2_ai_gate_ledger.json');
const RECOVERY = path.join(ROOT, '.superpowers', '1c2_ai_gate_recovery.sql');
const RESULTS = path.join(ROOT, '.superpowers', '1c2_ai_gate_results.json');
const DB_URL = process.env.DACS_DB_URL;
const PG_DIR = process.env.PG_DIR;
const PG_CA = process.env.PG_CA;
const CLEANUP_ONLY = process.argv.includes('--cleanup');
const CHARS = 100;

if (!DB_URL || !PG_DIR || !PG_CA) {
  console.error('Set DACS_DB_URL, PG_DIR and PG_CA first (see supabase/tests/1c_concurrency.mjs).');
  process.exit(2);
}
const CA = fs.readFileSync(PG_CA, 'utf8');
const { Client } = createRequire(path.join(PG_DIR, 'index.js'))('pg');

// Never let the secret reach the screen or a file.
const SECRETS = [DB_URL];
try { const u = new URL(DB_URL); if (u.password) SECRETS.push(decodeURIComponent(u.password), u.password); } catch { /* not a URL */ }
const redact = s => SECRETS.reduce((t, x) => (x ? String(t).split(x).join('***') : t), String(s));
const log = (...a) => console.log(...a.map(redact));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(name) {
  return new Client({
    connectionString: DB_URL,
    application_name: '1c2_ai_gate_' + name,
    statement_timeout: 20000,
    lock_timeout: 10000,
    idle_in_transaction_session_timeout: 60000,
    query_timeout: 25000,
    ssl: { ca: CA, rejectUnauthorized: true },
  });
}

// ── Ledger: exact ids, written before the row they name is committed ──
function saveLedger(l) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
  const ids = l.rows.concat(l.control ? [l.control] : []).map(x => String(BigInt(x)));
  fs.writeFileSync(RECOVERY,
    '-- Recovery for supabase/tests/1c2_ai_gate_concurrency.mjs: deletes exactly the rows it recorded.\n' +
    'begin;\n' +
    (ids.length ? 'delete from ai_requests where id in (' + ids.join(', ') + ');\n' : '') +
    'select count(*) as recorded_rows_left from ai_requests where id in (' + (ids.length ? ids.join(', ') : 'null') + ');\n' +
    'commit;\n');
}
function remember(l, id) { l.rows.push(String(id)); saveLedger(l); }
const removed = [];

async function accounts(C) {
  const one = async (sql, p) => (await C.query(sql, p)).rows[0];
  const w7 = (await one(`select id from profiles where worker_no = 7 and role = 'worker' and coalesce(status,'active') = 'active'`))?.id;
  if (!w7) throw new Error('W-0007 must exist and be active');
  const owner = (await one(
    `select p.id from profiles w join profiles p on p.id = coalesce(w.owner_id, w.id)
      where w.id = $1 and p.role = 'owner' and coalesce(p.status,'active') = 'active'
        and coalesce(case when jsonb_typeof(p.allowed_modules) = 'array' and jsonb_array_length(p.allowed_modules) > 0
                          then p.allowed_modules ? 'workplan' end, true)`, [w7]))?.id;
  if (!owner) throw new Error('the owner of W-0007 must be an active owner allowed to draft');
  const staff = (await one(`select id from profiles where role = 'staff' and owner_id = $1 and coalesce(status,'active') = 'active' limit 1`, [owner]))?.id;
  if (!staff) throw new Error('need an active staff account of the owner');
  return { w7, owner, staff };
}

// Delete exactly the recorded rows and prove they are gone.
async function cleanup(C, l) {
  if (l.rows.length) {
    await C.query('delete from ai_requests where id = any($1::bigint[])', [l.rows]);
    const left = (await C.query('select count(*)::int as n from ai_requests where id = any($1::bigint[])', [l.rows])).rows[0].n;
    if (left) throw new Error(left + ' recorded rows are still there');
    removed.push(...l.rows);
  }
  l.rows = [];
  saveLedger(l);
}

const count = async (C, where, params) => (await C.query('select count(*)::int as n from ai_requests where ' + where, params)).rows[0].n;
const personRecent = (C, uid) => count(C, `user_id = $1 and feature = 'work_plan_draft' and created_at > now() - interval '10 minutes'`, [uid]);
const personDay = (C, uid) => count(C, `user_id = $1 and feature = 'work_plan_draft' and created_at > now() - interval '24 hours'`, [uid]);
const companyDay = (C, owner) => count(C, `owner_id = $1 and created_at > now() - interval '24 hours'`, [owner]);

// Insert n rows in one transaction; their ids reach the ledger before commit.
async function addRows(C, l, owner, uid, n) {
  if (n <= 0) return;
  await C.query('begin');
  try {
    const r = await C.query(`insert into ai_requests (owner_id, user_id, feature, input_chars)
                             select $1, $2, 'work_plan_draft', $3 from generate_series(1, $4::int) returning id`, [owner, uid, CHARS, n]);
    r.rows.forEach(x => l.rows.push(String(x.id)));
    saveLedger(l);
    await C.query('commit');
  } catch (e) {
    await C.query('rollback').catch(() => {});
    throw e;
  }
}

// The staff account exactly one draft below its 10-minute limit.
async function personBelow(C, l, a) {
  await cleanup(C, l);
  const used = await personRecent(C, a.staff);
  if (used > 9) throw new Error('the staff account used AI drafting in the last 10 minutes; wait 10 minutes and run again');
  if (await personDay(C, a.staff) + (9 - used) + 2 > 50) throw new Error('the staff account is near its 24-hour drafting limit; run again later');
  if (await companyDay(C, a.owner) + (9 - used) + 2 > 300) throw new Error('the company is near its 24-hour AI limit; run again later');
  await addRows(C, l, a.owner, a.staff, 9 - used);
}

// The company exactly one request below its 24-hour limit, with rows of
// neither racer (W-0007), so only the company limit decides.
async function companyBelow(C, l, a) {
  await cleanup(C, l);
  const used = await companyDay(C, a.owner);
  if (used > 299) throw new Error('the company used 300 AI requests in the last 24 hours; run again later');
  for (const uid of [a.owner, a.staff]) {
    if (await personRecent(C, uid) > 8 || await personDay(C, uid) > 48) throw new Error('a test account is near its own drafting limit; run again later');
  }
  await addRows(C, l, a.owner, a.w7, 299 - used);
}

async function begin(client, uid) {
  await client.query('begin');
  await client.query('set local role authenticated');
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
}
const run = (client, sql, params) =>
  client.query(sql, params).then(r => ({ ok: true, rows: r.rows }), e => ({ ok: false, message: e.message, code: e.code }));

// The row ai_authorize() just inserted in THIS session, recorded before commit.
async function rememberOwnRow(client, l) {
  await client.query('reset role');
  const id = (await client.query(`select currval('ai_requests_id_seq')::text as id`)).rows[0].id;
  remember(l, id);
}

// Did B's call wait on a lock, or finish on its own? (watched from C)
async function watch(C, pid, promise, ms = 3000) {
  let settled = false;
  promise.then(() => { settled = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (settled) return 'finished';
    const r = await C.query('select wait_event_type from pg_stat_activity where pid = $1', [pid]);
    if (r.rows[0]?.wait_event_type === 'Lock') return 'waiting';
    await sleep(100);
  }
  return settled ? 'finished' : 'unknown';
}

const AUTH = `select ai_authorize('work_plan_draft', ${CHARS}) as r`;
const badLock = res => !res.ok && (res.code === '40P01' || res.code === '55P03' || res.code === '57014');

const results = [];
function record(name, checks) {
  const pass = checks.every(c => c.ok);
  results.push({ name, pass, checks });
  log((pass ? 'PASS ' : 'FAIL ') + name);
  for (const c of checks) log('   ' + (c.ok ? 'ok   ' : 'FAIL ') + c.what + (c.ok ? '' : ' — got ' + c.got));
}
const chk = (what, ok, got) => ({ what, ok: !!ok, got: got === undefined ? '' : JSON.stringify(got) });

// A takes the last slot and holds its transaction; B asks at the same moment.
async function race(A, B, C, pidB, uidA, uidB, endA, l) {
  await begin(A, uidA);
  const a1 = await run(A, AUTH);
  if (a1.ok) await rememberOwnRow(A, l);
  await begin(B, uidB);
  const pB = run(B, AUTH);
  const state = await watch(C, pidB, pB);
  await A.query(endA);
  const b1 = await pB;
  if (b1.ok) { await rememberOwnRow(B, l); await B.query('commit'); } else await B.query('rollback');
  return { a1, state, b1 };
}

async function scenarios(A, B, C, pidB, l, a) {
  const reset = async () => { await A.query('rollback').catch(() => {}); await B.query('rollback').catch(() => {}); };

  try {
    await personBelow(C, l, a);
    const { a1, state, b1 } = await race(A, B, C, pidB, a.staff, a.staff, 'commit', l);
    const n = await personRecent(C, a.staff);
    record('G1 person 10-minute limit — A takes the last slot and commits while B asks', [
      chk('A takes the 10th slot', a1.ok, a1),
      chk('B waited for A', state === 'waiting', state),
      chk('B is refused AI_RATE_LIMITED', !b1.ok && b1.message === 'AI_RATE_LIMITED', b1),
      chk('exactly 10 drafts in 10 minutes', n === 10, n),
      chk('no deadlock or timeout', !badLock(a1) && !badLock(b1), [a1.code, b1.code]),
    ]);
  } catch (e) { await reset(); record('G1 person 10-minute limit', [chk('ran', false, redact(e.message))]); }

  try {
    await personBelow(C, l, a);
    const { a1, state, b1 } = await race(A, B, C, pidB, a.staff, a.staff, 'rollback', l);
    const n = await personRecent(C, a.staff);
    record('G2 person 10-minute limit — A takes the last slot and rolls back while B asks', [
      chk('A takes the 10th slot', a1.ok, a1),
      chk('B waited for A', state === 'waiting', state),
      chk('B is allowed once A gave the slot back', b1.ok, b1),
      chk('exactly 10 drafts in 10 minutes', n === 10, n),
      chk('no deadlock or timeout', !badLock(a1) && !badLock(b1), [a1.code, b1.code]),
    ]);
  } catch (e) { await reset(); record('G2 person 10-minute limit, rollback', [chk('ran', false, redact(e.message))]); }

  try {
    await companyBelow(C, l, a);
    const { a1, state, b1 } = await race(A, B, C, pidB, a.owner, a.staff, 'commit', l);
    const n = await companyDay(C, a.owner);
    record('G3 company 24-hour limit — the owner and the staff account ask for the 300th slot at once', [
      chk('the owner takes the 300th slot', a1.ok, a1),
      chk('the staff request waited', state === 'waiting', state),
      chk('the staff request is refused AI_RATE_LIMITED', !b1.ok && b1.message === 'AI_RATE_LIMITED', b1),
      chk('exactly 300 requests in 24 hours', n === 300, n),
      chk('no deadlock or timeout', !badLock(a1) && !badLock(b1), [a1.code, b1.code]),
    ]);
  } catch (e) { await reset(); record('G3 company 24-hour limit', [chk('ran', false, redact(e.message))]); }
}

async function main() {
  const C = connect('observer');
  const A = connect('a');
  const B = connect('b');
  let ledger = null;
  let exitCode = 1;
  let cleanupFailed = false;
  const opened = new Set();
  const open = async (client) => { await client.connect(); opened.add(client); };
  const kill = setTimeout(() => { log('TIME LIMIT (120 s) reached — stopping; cleanup follows.'); finish(); }, 120000);
  let finishing = false;
  async function finish() {
    if (finishing) return;
    finishing = true;
    try {
      // Close A and B first: that rolls back anything they still hold.
      await Promise.allSettled([A, B].filter(c => opened.has(c)).map(c => c.end()));
      if (ledger) {
        await cleanup(C, ledger);                        // exactly the recorded ids
        if (ledger.control) {
          if (!CLEANUP_ONLY) {
            const has = async ids => (await C.query('select count(*)::int as n from ai_requests where id = any($1::bigint[])', [ids])).rows[0].n;
            const control = await has([ledger.control]);
            const earlier = await has(ledger.preexisting.length ? ledger.preexisting : ['0']);
            record('G0 cleanup removes only the rows this run recorded', [
              chk('the control row (same account, size and time) survived', control === 1, control),
              chk('every earlier usage row of the test accounts survived', earlier === ledger.preexisting.length,
                  { survived: earlier, expected: ledger.preexisting.length }),
            ]);
          }
          await C.query('delete from ai_requests where id = $1::bigint', [ledger.control]);   // ours, by its own id
          removed.push(ledger.control);
          ledger.control = null;
          saveLedger(ledger);
        }
        fs.rmSync(LEDGER, { force: true });
        fs.rmSync(RECOVERY, { force: true });
        log('Removed exactly these recorded rows: ' + (removed.join(', ') || 'none'));
      }
    } catch (e) {
      log('CLEANUP FAILED: ' + e.message + ' — the ledger is kept; run: node supabase/tests/1c2_ai_gate_concurrency.mjs --cleanup' +
          ' (or .superpowers/1c2_ai_gate_recovery.sql in the SQL editor)');
      cleanupFailed = true;
    } finally {
      clearTimeout(kill);
      if (CLEANUP_ONLY) exitCode = cleanupFailed ? 1 : 0;
      else {
        const failed = results.filter(r => !r.pass).length;
        log(`\n${results.length - failed} of ${results.length} checks passed.`);
        exitCode = !cleanupFailed && results.length === 4 && failed === 0 ? 0 : 1;
      }
      fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
      fs.writeFileSync(RESULTS, redact(JSON.stringify({ at: new Date().toISOString(), removed, results }, null, 2)));
      if (opened.has(C)) await Promise.allSettled([C.end()]);
      process.exit(exitCode);
    }
  }
  process.on('SIGINT', () => { log('Interrupted — cleaning up.'); finish(); });

  try {
    await open(C);
    if (CLEANUP_ONLY) {
      if (!fs.existsSync(LEDGER)) log('No ledger file — nothing recorded to clean.');
      else ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
      return await finish();
    }
    if (fs.existsSync(LEDGER)) throw new Error('A ledger from an earlier run exists — run with --cleanup first.');
    await open(A);
    await open(B);
    const pidB = (await B.query('select pg_backend_pid() as p')).rows[0].p;
    const a = await accounts(C);
    // Usage rows the test accounts already had (last 29 days): all must survive.
    const preexisting = (await C.query(
      `select id::text from ai_requests where user_id = any($1::uuid[]) and created_at > now() - interval '29 days'`,
      [[a.owner, a.staff, a.w7]])).rows.map(r => r.id);
    ledger = { created: new Date().toISOString(), rows: [], control: null, preexisting };
    saveLedger(ledger);
    // The control row: same account, size and time as the test's rows.
    await C.query('begin');
    const ctl = await C.query(`insert into ai_requests (owner_id, user_id, feature, input_chars)
                               values ($1, $2, 'work_plan_draft', $3) returning id::text`, [a.owner, a.staff, CHARS]);
    ledger.control = ctl.rows[0].id;
    saveLedger(ledger);                                  // recorded BEFORE commit
    await C.query('commit');
    await scenarios(A, B, C, pidB, ledger, a);
  } catch (e) {
    log('STOPPED: ' + e.message);
    await C.query('rollback').catch(() => {});
  }
  await finish();
}

main();
```

There is no separate recovery file in the repository: the run writes `.superpowers/1c2_ai_gate_recovery.sql` (git-ignored) with the exact recorded ids whenever its ledger changes.

- [ ] **Step 5: Rewrite the worker**

Replace the whole of `cloudflare-worker/worker.js` with (LF):

```js
/**
 * DAC's Portal — AI proxy (Cloudflare Worker, Workers AI)
 * ----------------------------------------------------------------
 * Runs Cloudflare Workers AI for two portal features:
 *   budget_summary  — Project Control AI budget summary (js/ai-summary.js)
 *   health_briefing — Project Control AI health briefing (js/ai-assistant.js)
 *   work_plan_draft — Work Plan meeting drafts (js/workplan-admin-core.js)
 *
 * Every request must carry the caller's Supabase session. Before any
 * model runs, the worker (1) refuses a missing token, (2) applies a cheap
 * per-address flood guard, (3) refuses oversized or malformed requests,
 * then (4) calls ai_authorize() (migration 0095) AS THE CALLER, which
 * checks the account is active and allowed this feature, the input size
 * and the per-person / per-company limits, and records the request. The
 * model and the answer length are chosen HERE per feature; any model the
 * browser names is ignored. CORS only stops other websites' pages; it is
 * not the security.
 *
 * Config (wrangler.toml): [ai] binding AI; [vars] SUPABASE_URL and
 * SUPABASE_ANON_KEY (public, the same as js/supabase-config.js); the
 * PREAUTH_LIMITER rate-limit binding. Deploy: npx wrangler deploy
 */

// Only allow requests from these origins (add your live URL when you deploy).
const ALLOWED_ORIGINS = [
  'http://127.0.0.1:5501',
  'http://localhost:5501',
  'https://dacs-company.vercel.app',   // production (Vercel)
];

// Llama 3.3 70B fp8-fast for both features. Llama 3.1 8B was retired by
// Cloudflare on 30 May 2026. Check `npx wrangler ai models` before
// changing a model; the Llama models answer in a `response` field.
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FEATURES = {
  budget_summary:  { model: MODEL, maxTokens: 700,  maxChars: 4000 },
  health_briefing: { model: MODEL, maxTokens: 600,  maxChars: 12000 },
  work_plan_draft: { model: MODEL, maxTokens: 2000, maxChars: 40000 },
};
const MAX_BODY_BYTES = 65536;
const MAX_MESSAGES = 4;

// ai_authorize() refusals → HTTP status. Anything unexpected fails closed.
const GATE_STATUS = { AI_NOT_SIGNED_IN: 401, AI_NOT_ALLOWED: 403, AI_TOO_LARGE: 413, AI_RATE_LIMITED: 429 };
const MESSAGES = {
  AI_NOT_SIGNED_IN: 'Sign in again to use the AI.',
  AI_NOT_ALLOWED: 'This account cannot use this AI feature.',
  AI_TOO_LARGE: 'Too much text for the AI. Shorten it and try again.',
  AI_RATE_LIMITED: 'AI limit reached. Try again later.',
  AI_BAD_REQUEST: 'The AI request could not be read.',
  AI_GATE_UNAVAILABLE: 'The AI is not available right now. Try again.',
  AI_FAILED: 'The AI did not answer. Try again.',
};

function corsHeaders(origin) {
  // Allow the explicit list plus any Vercel deployment (production + previews).
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
  const allow = ok ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin') || '');

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405, headers: cors });
    }

    // 1. A session token, before anything else runs.
    const auth = /^Bearer ([A-Za-z0-9._~+\/=-]+)$/.exec(request.headers.get('Authorization') || '');
    if (!auth) return fail('AI_NOT_SIGNED_IN', 401, cors);

    // 2. Flood guard per connecting address (approximate by design; the
    //    real per-account limits are in ai_authorize()).
    if (env.PREAUTH_LIMITER) {
      const { success } = await env.PREAUTH_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!success) return fail('AI_RATE_LIMITED', 429, cors);
    }

    // 3. Size and shape, before the database.
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) return fail('AI_TOO_LARGE', 413, cors);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return fail('AI_TOO_LARGE', 413, cors);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail('AI_BAD_REQUEST', 400, cors);
    }
    const feature = body && Object.prototype.hasOwnProperty.call(FEATURES, body.feature) ? FEATURES[body.feature] : null;
    const messages = body && body.messages;
    if (!feature || !Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES
        || !messages.every(m => m && (m.role === 'system' || m.role === 'user') && typeof m.content === 'string')) {
      return fail('AI_BAD_REQUEST', 400, cors);
    }
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    if (chars > feature.maxChars) return fail('AI_TOO_LARGE', 413, cors);

    // 4. The account, feature, size and limits — decided and recorded by
    //    the database, as the caller.
    let gate;
    try {
      gate = await fetch(env.SUPABASE_URL + '/rest/v1/rpc/ai_authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + auth[1] },
        body: JSON.stringify({ p_feature: body.feature, p_chars: chars }),
      });
    } catch {
      return fail('AI_GATE_UNAVAILABLE', 503, cors);
    }
    if (!gate.ok) {
      let info = null;
      try { info = await gate.json(); } catch { info = null; }
      const code = (/AI_[A-Z_]+/.exec(String((info && info.message) || '')) || [])[0];
      if (code && GATE_STATUS[code]) return fail(code, GATE_STATUS[code], cors);
      if (gate.status === 401) return fail('AI_NOT_SIGNED_IN', 401, cors);
      if (gate.status >= 500) return fail('AI_GATE_UNAVAILABLE', 503, cors);
      return fail('AI_NOT_ALLOWED', 403, cors);
    }

    if (!env.AI) return fail('AI_FAILED', 502, cors);
    try {
      const result = await env.AI.run(feature.model, {
        messages,
        temperature: Math.min(Math.max(Number(body.temperature ?? 0.4) || 0, 0), 1),
        max_tokens: Math.max(1, Math.min(Number(body.max_tokens) || feature.maxTokens, feature.maxTokens)),
      });
      // OpenAI-shaped response so the portal reads choices[0].message.content.
      return json({ choices: [{ message: { role: 'assistant', content: answerText(result) } }] }, 200, cors);
    } catch (err) {
      console.error('Workers AI error: ' + (err && err.message ? err.message : String(err)));
      return fail('AI_FAILED', 502, cors);
    }
  },
};

// Llama models answer in `response`; OpenAI-style models in `choices`.
function answerText(result) {
  if (!result) return '';
  if (result.response && typeof result.response === 'object') return JSON.stringify(result.response);
  if (typeof result.response === 'string') return result.response;
  if (result.result && typeof result.result.response === 'string') return result.result.response;
  const msg = result.choices && result.choices[0] && result.choices[0].message;
  return msg && typeof msg.content === 'string' ? msg.content : '';
}

function fail(code, status, cors) {
  return json({ error: { code, message: MESSAGES[code] } }, status, cors);
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
```

- [ ] **Step 6: Worker config, tracked**

Replace the whole of `cloudflare-worker/wrangler.toml` with (LF) — copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` **character for character** from the two `const` lines at `js/supabase-config.js:16-17` (the test compares them):

```toml
name = "dacs-ai"
main = "worker.js"
compatibility_date = "2024-11-01"

# Cloudflare Workers AI — on-platform models, no external API, no key.
[ai]
binding = "AI"

# Public project values, the same as js/supabase-config.js (not secrets).
# The worker calls ai_authorize() (migration 0095) with the caller's session.
[vars]
SUPABASE_URL = "<copy the SUPABASE_URL string from js/supabase-config.js:16>"
SUPABASE_ANON_KEY = "<copy the SUPABASE_ANON_KEY string from js/supabase-config.js:17>"

# Flood guard per connecting address, before any database call (needs
# Wrangler 4.36+). The real per-account limits are in ai_authorize().
[[ratelimits]]
name = "PREAUTH_LIMITER"
namespace_id = "1095"
  [ratelimits.simple]
  limit = 30
  period = 60
```

(The two `<copy …>` values are filled from the named lines; nothing else in the block changes. The test fails until both match exactly.)

In `.gitignore`, directly after the line `!.gitattributes`, add:

```
!cloudflare-worker/wrangler.toml
```

- [ ] **Step 7: The budget summary sends the session**

In `js/ai-summary.js`, replace

```js
      var res = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      });
```

with

```js
      // The AI worker serves signed-in, active owner accounts only
      // (ai_authorize, migration 0095): send the session.
      var session = window.sbClient ? (await window.sbClient.auth.getSession()).data.session : null;
      if (!session) throw new Error('Your sign-in has expired. Reload the page and sign in again.');
      var res = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ feature: 'budget_summary', messages: [{ role: 'user', content: prompt }] }),
      });
```

In `admin.html`, change `<script src="js/ai-summary.js"></script>` to `<script src="js/ai-summary.js?v=20261013a"></script>`. (`ai-summary.js` is loaded only by `admin.html`; the client and partner portals do not use it.)

- [ ] **Step 8: Rewrite the setup notes**

Replace the whole of `cloudflare-worker/SETUP.md` with (LF):

````markdown
# DAC's AI worker (`dacs-ai`) — setup

The portal's AI features call this Cloudflare Worker:

| Feature | Caller | Who may use it | Answer cap |
|---|---|---|---|
| `budget_summary` — Project Control AI budget summary | `js/ai-summary.js` | active **owner** accounts (module-focused: `expenses`) | 700 tokens, input 4,000 characters |
| `work_plan_draft` — Work Plan meeting drafts | `js/workplan-admin-core.js` | active **owner or staff** (module-focused: `workplan`) | 2,000 tokens, input 40,000 characters |
| `health_briefing` — Project Control AI health briefing | `js/ai-assistant.js` | active **owner** accounts (module-focused: `expenses`) | 600 tokens, input 12,000 characters |

All three features (`work_plan_draft`, `budget_summary`, `health_briefing`) use **Cloudflare Workers AI** model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Llama 3.1 8B was retired on 30 May 2026). No external AI provider, no API key, no secret.

```
Portal (signed in) → dacs-ai worker → ai_authorize() in Supabase (as the caller) → Workers AI → answer
```

## How requests are checked

1. No `Authorization: Bearer <Supabase session>` header → refused (401).
2. Flood guard: 30 requests per 60 s per connecting address (`PREAUTH_LIMITER`).
3. Body ≤ 64 KB, 1–4 messages (`system`/`user`), input within the feature's size.
4. `ai_authorize()` (migration 0095), run as the caller: active account, allowed feature, size, and limits — per person drafts 10 per 10 minutes and 50 per rolling 24 hours, summaries 20 per 10 minutes and 100 per rolling 24 hours, briefings 20 per 10 minutes and 100 per rolling 24 hours; per company 300 per rolling 24 hours ("rolling" = the 24 hours before the request, not a calendar day). Each allowed request is recorded in `ai_requests` (never the text).

The worker chooses the model and the answer length; a `model` sent by the browser is ignored.

## Deploy

Order: **apply migration 0095 first** (without it every AI request is refused). In a terminal inside the `cloudflare-worker` folder:

```powershell
npx wrangler --version                                  # must be 4.36 or newer (rate-limit binding)
npx wrangler login                                      # first time only
npx wrangler ai models --json | findstr "llama-3.3-70b-instruct-fp8-fast"   # the model must be listed
npx wrangler deploy
```

The worker URL is `https://dacs-ai.dacsbuilding.workers.dev` (`AI_WORKER_URL` in `js/ai-summary.js`, `js/ai-assistant.js` and `js/workplan-admin-core.js`).

## Configuration

`wrangler.toml` (tracked in git): the `[ai]` binding, `[vars]` `SUPABASE_URL` / `SUPABASE_ANON_KEY` (public values, the same as `js/supabase-config.js`), and the `PREAUTH_LIMITER` binding. `ALLOWED_ORIGINS` in `worker.js` lists the local dev server and the live site; any `*.vercel.app` preview is also allowed.

## Privacy

Meeting notes sent for drafting go to Workers AI on Cloudflare (approved, WorkMate spec §15). The office reviews every draft before anything reaches workers.
````

- [ ] **Step 9: Add the worker test to `npm test`; update the CRLF docs**

In `package.json`, append ` && node tests/ai-worker.test.js` to the end of the `"test"` script string.

Run with `python -I <scratch file>` from the repo root:

```python
import re
p = 'supabase/migrations/README.md'
s = open(p, 'rb').read().decode('utf-8')
s, n = re.subn(r"\(\*\*\d{4}\*\* — highest on disk is\s+`[^`]+`\)",
               "(**0096** — highest on disk is\r\n  `0095_ai_request_gate.sql`)", s, count=1)
assert n == 1, 'next-number line not found'
anchor = s.index('**0094 (WorkMate Stage 1c-2')
end = s.index('\r\n', anchor)
para = ("\r\n\r\n**0095 (AI request gate)** adds `ai_requests` (who / feature / characters / when — never the text; no client "
        "access) and `ai_authorize(feature, chars)`, which the `dacs-ai` Cloudflare worker calls as the signed-in caller before "
        "running any model: active account; `work_plan_draft` for owner/staff (module-focused: `workplan`), `budget_summary` "
        "for owner (module-focused: `expenses`); input ≤ 40,000 / 4,000 characters; per person 10 per 10 min and 50 per rolling "
        "24 h (drafts), 20 and 100 (summaries); per company 300 per rolling 24 h (never a calendar day). Apply before deploying "
        "the worker. Dry-run with `supabase/tests/1c2_ai_gate.sql` (self-wrapped, editor-safe); simultaneous requests: "
        "`supabase/tests/1c2_ai_gate_concurrency.mjs` (two connections, after applying).")
s = s[:end] + para + s[end:]
open(p, 'wb').write(s.encode('utf-8'))

p = 'docs/DATABASE_SCHEMA.md'
s = open(p, 'rb').read().decode('utf-8')
s = s.rstrip('\r\n') + ("\r\n\r\n## AI request gate (0095)\r\n\r\n"
     "| Object | Purpose |\r\n|---|---|\r\n"
     "| `ai_requests` (`owner_id`, `user_id`, `feature` `budget_summary`/`work_plan_draft`, `input_chars`, `created_at`) | "
     "One row per allowed AI request; never the text; RLS on with no policy (no client access); rows older than 30 days removed |\r\n"
     "| `ai_authorize(p_feature, p_chars)` | Called by the `dacs-ai` worker as the caller: active account, feature allowed for the "
     "role and `allowed_modules`, size, per-person and per-company limits; raises `AI_NOT_SIGNED_IN` / `AI_NOT_ALLOWED` / "
     "`AI_TOO_LARGE` / `AI_RATE_LIMITED` |\r\n")
open(p, 'wb').write(s.encode('utf-8'))
print('docs updated')
```

Expected `docs updated`; re-run the CRLF check from Task 1 Step 6 → `True` twice.

- [ ] **Step 10: Run the tests**

Run: `node tests/ai-worker.test.js` → all pass, exit 0. Run: `node tests/workmate-office-server.test.js` → all pass. Run: `node --input-type=module --check < cloudflare-worker/worker.js` and `node --check supabase/tests/1c2_ai_gate_concurrency.mjs` → no output. Run: `node --check js/ai-summary.js` → no output. Run: `npm test` → green.

- [ ] **Step 11: Stop — no commit.** Report to the controller.

- [ ] **Step 12 (controller + user, after review): dry run 0095**

Controller builds `Downloads\0095_dry_run.sql` (Python bytes, no BOM, LF): `b'begin;\n\n' + migration.rstrip(b'\n') + b'\n\n' + gate_acceptance`. The user runs it in the SQL editor → expected `1c2 AI gate: all checks passed` (a NOTICE about 5c/5d being skipped is acceptable only if no module-focused account exists; today `admin-pm@` exists, so both run). The two-connection test needs committed rows, so it runs after applying (Task 8 Step 3) — pending. Apply and deploy wait for Task 8.

---

### Task 4: Navigation, views, styles, module map

**Files:**
- Modify: `js/admin.js`, `admin.html`, `docs/ARCHITECTURE.md`, `tests/workplan-admin.test.js` (above its marker)
- Create: `css/workplan-admin.css`

**Interfaces:**
- Consumes: Task 2's `window.initWorkPlanModule(view)`.
- Produces: views `wpBoard`, `wpMeetings` (secondary row), `wpMeeting`, `wpTask` (hidden drill-downs); hosts `#wpBoardView`, `#wpMeetingsView`, `#wpMeetingView`, `#wpTaskView`; script tags for the five Work Plan files (Tasks 5–7 create four of them); CSS classes `wp-*`.

- [ ] **Step 1: Write the failing tests**

Insert above `// ── Task 4 appends its tests above this line ──` in `tests/workplan-admin.test.js`:

```js
console.log('\nworkplan-admin: navigation');

// Runs the real PRIMARY_NAV, _FOCUS_SUBVIEWS and focusAllowedViews from
// js/admin.js for a module-focused account.
function focusViews(modules) {
  const s = src('js/admin.js');
  const a = s.indexOf('const PRIMARY_NAV');
  const b = s.indexOf('// Landing view for the first focused module');
  ok(a > 0 && b > a, 'nav slice markers not found in js/admin.js');
  const win = {};
  new Function('window', 'currentAllowedModules', s.slice(a, b))(win, modules);
  return win.focusAllowedViews();
}

test('a module-focused account granted Work Plan can open every Work Plan view, drill-downs included', () => {
  const v = focusViews(['workplan']);
  for (const x of ['wpBoard', 'wpMeetings', 'wpMeeting', 'wpTask']) ok(v.includes(x), x + ' blocked: ' + JSON.stringify(v));
});

test('a PM-only account cannot open any Work Plan view', () => {
  const v = focusViews(['pm']);
  for (const x of ['wpBoard', 'wpMeetings', 'wpMeeting', 'wpTask']) ok(!v.includes(x), x + ' reachable by a PM-only account');
});

test('PRIMARY_NAV shows Board and Meetings; Meeting and Task are hidden drill-downs', () => {
  const m = src('js/admin.js').match(/\{ id: 'workplan', label: 'Work Plan'[\s\S]*?\n    \},/);
  ok(m, 'workplan entry missing');
  ok(/defaultView: 'wpBoard'/.test(m[0]), 'default view');
  for (const v of ['wpBoard', 'wpMeetings']) ok(new RegExp("view: '" + v + "'(?![^}]*hidden)").test(m[0]), v + ' visible');
  for (const v of ['wpMeeting', 'wpTask']) ok(new RegExp("view: '" + v + "'[^}]*hidden: true").test(m[0]), v + ' hidden');
});

test('admin.html: view hosts, WP_VIEWS in switchView, titles, init, scripts in order', () => {
  const h = src('admin.html');
  for (const v of ['wpBoard', 'wpMeetings', 'wpMeeting', 'wpTask']) {
    ok(h.includes('<div id="' + v + 'View" class="content-view" style="display: none;"></div>'), v + ' host');
    ok(new RegExp(v + ":\\s+'").test(h), v + ' title');
  }
  ok(/const WP_VIEWS\s+= \['wpBoard','wpMeetings','wpMeeting','wpTask'\];/.test(h), 'WP_VIEWS');
  ok(/if \(WP_VIEWS\.includes\(view\)\s+&& typeof initWorkPlanModule === 'function'\) initWorkPlanModule\(view\);/.test(h), 'init dispatch');
  ok(h.includes('<link rel="stylesheet" href="css/workplan-admin.css?v=20261013a">'), 'stylesheet');
  const order = ['js/requests-admin-core.js', 'js/workplan-admin-core.js', 'js/workplan-admin-form.js', 'js/workplan-admin-board.js',
                 'js/workplan-admin-task.js', 'js/workplan-admin-meetings.js'].map(s => h.indexOf('<script src="' + s));
  ok(order.every(i => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), 'scripts present and in order: ' + order);
});

test('ARCHITECTURE.md module map names the Work Plan files', () => {
  ok(/\| Work Plan \| `workplan-admin-core\.js`/.test(src('docs/ARCHITECTURE.md')), 'module map row');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/workplan-admin.test.js` → the granted-account, PRIMARY_NAV, admin.html and ARCHITECTURE tests FAIL (the PM-only test already passes — nothing exists yet); exit 1.

- [ ] **Step 3: Add the navigation entry**

In `js/admin.js`, directly after the closing `},` of the `{ id: 'requests', ... }` entry in `PRIMARY_NAV`, insert:

```js
    // WorkMate My Work (0093/0094, Stage 1c): the office turns meeting notes
    // into tasks (AI or by hand), publishes them with shared notes, and
    // checks the work. Owner + staff — no money anywhere. A module-focused
    // account gets it only with 'workplan' in allowed_modules.
    { id: 'workplan', label: 'Work Plan', sub: 'Meetings & Tasks', defaultView: 'wpBoard',
      modules: [
        { view: 'wpBoard',    label: 'Board',    icon: 'clipboard-list' },
        { view: 'wpMeetings', label: 'Meetings', icon: 'book-open' },
        // Drill-downs: routable and highlighted under Work Plan, but not
        // buttons in the secondary row (like reqDetail).
        { view: 'wpMeeting',  label: 'Meeting',  icon: 'book-open', hidden: true },
        { view: 'wpTask',     label: 'Task',     icon: 'clipboard-check', hidden: true },
      ]
    },
```

In `_FOCUS_SUBVIEWS`, after `requests: ['reqDetail'],` add:

```js
    // Drill-downs from the Board / Meetings into one meeting or task.
    workplan: ['wpMeeting', 'wpTask'],
```

`_visibleNav()` needs no change: owner and staff see every section by default, and a module-focused account sees only its granted ids.

- [ ] **Step 4: Wire `admin.html`**

1. After `<link rel="stylesheet" href="css/requests-admin.css?v=20261012a">` add:
   ```html
       <link rel="stylesheet" href="css/workplan-admin.css?v=20261013a">
   ```
2. After `<div id="reqProjectsView"   class="content-view" style="display: none;"></div>` add:
   ```html
           <!-- Work Plan (WorkMate My Work, 0093/0094) — rendered by js/workplan-admin-*.js.
                wpMeeting and wpTask are drill-downs from the Board and Meetings. -->
           <div id="wpBoardView" class="content-view" style="display: none;"></div>
           <div id="wpMeetingsView" class="content-view" style="display: none;"></div>
           <div id="wpMeetingView" class="content-view" style="display: none;"></div>
           <div id="wpTaskView" class="content-view" style="display: none;"></div>
   ```
3. After `<script src="js/requests-admin-gallery.js?v=20261012a"></script>` add:
   ```html
   <script src="js/workplan-admin-core.js?v=20261013a"></script>
   <script src="js/workplan-admin-form.js?v=20261013a"></script>
   <script src="js/workplan-admin-board.js?v=20261013a"></script>
   <script src="js/workplan-admin-task.js?v=20261013a"></script>
   <script src="js/workplan-admin-meetings.js?v=20261013a"></script>
   ```
4. In the switchView patch, after `const REQ_VIEWS   = [...]` add:
   ```js
       const WP_VIEWS    = ['wpBoard','wpMeetings','wpMeeting','wpTask'];
   ```
5. In `TITLES`, after `reqProjects:      'Projects open to requests',` add:
   ```js
           wpBoard:          'Work Plan',
           wpMeetings:       'Meetings',
           wpMeeting:        'Meeting',
           wpTask:           'Task',
   ```
6. After `if (REQ_VIEWS.includes(view)   && typeof initRequestsModule === 'function') initRequestsModule(view);` add:
   ```js
           if (WP_VIEWS.includes(view)    && typeof initWorkPlanModule === 'function') initWorkPlanModule(view);
   ```
7. Cache tags: both files below changed on this branch, so bump their tags — `js/admin.js?v=20261009b` → `js/admin.js?v=20261013a` and `js/requests-admin-core.js?v=20261012a` → `js/requests-admin-core.js?v=20261013a`.

- [ ] **Step 5: Create the stylesheet**

Create `css/workplan-admin.css` (LF):

```css
/* ════════════════════════════════════════════════════════════════════
   Work Plan (WorkMate My Work, 1c-2) — small additions on top of the
   attendance (att-*) and Requests (req-*) styles the screens reuse.
   ════════════════════════════════════════════════════════════════════ */
.wp-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px 14px;
             max-height: 220px; overflow: auto; padding: 4px 0; }
.wp-checks[hidden] { display: none; }
.wp-text { white-space: pre-wrap; margin: 4px 0 0; }
.wp-passage { margin: 6px 0 0; padding: 8px 12px; border-left: 3px solid var(--att-line, #d9d6cf);
              color: var(--att-ink-2, #444); font-style: italic; white-space: pre-wrap; }
.wp-flags { margin: 6px 0 0; padding-left: 18px; color: #8a5a00; }
.wp-chip { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .02em;
           padding: 2px 8px; border-radius: 999px; margin-left: 6px; }
.wp-chip--red { background: #fde8e6; color: #b42318; }
.wp-chip--gold { background: #fff4d6; color: #8a5a00; }
.wp-confirm { margin-top: 6px; font-weight: 600; color: #b42318; }
.wp-list { list-style: none; margin: 0; padding: 0; }
.wp-list li, .wp-row { padding: 8px 0; border-top: 1px solid var(--att-line-soft, #eeece8); }
.wp-list li:first-child, .wp-row:first-child { border-top: 0; }
.wp-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.wp-row.is-added { opacity: .6; }
.wp-recipients { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.wp-recipients legend { font-size: 12.5px; font-weight: 600; margin-bottom: 4px; color: var(--att-ink-2, #444); }
.wp-photo { display: grid; gap: 4px; width: 96px; align-content: start; }
@media (max-width: 640px) { .wp-row { flex-direction: column; } }
```

- [ ] **Step 6: Add the module-map row**

In `docs/ARCHITECTURE.md` (LF), directly after the line that starts with `| Requests | \`requests-admin-core.js\``, insert:

```
| Work Plan | `workplan-admin-core.js`, `workplan-admin-form.js`, `workplan-admin-board.js`, `workplan-admin-task.js`, `workplan-admin-meetings.js` | The office half of **DAC'S WorkMate My Work** (`0093`, `0094`; plan `docs/superpowers/plans/2026-10-13-workmate-stage1c2-work-plan-office.md`). Owner and staff turn **meeting notes** into tasks — **AI drafts** through the `dacs-ai` worker (gated by `ai_authorize`, `0095`) or by hand — and review each in the **task form**: an AI name is filled in only on one exact match, otherwise the field reads *Needs your choice* and Save refuses. **Publish** sends tasks and shared notes to chosen people (default: everyone assigned in that meeting). The **Board** groups tasks under the office lists (check, blocked, not acknowledged 24 h, overdue, live, drafts/proposals, completed). One **task** shows who read which version, problems (cleared by the office with a note), photos (private `task-photos`), history, and approve / send back / reopen / cancel-decline. On a published task the **server raises the version** for any people, team or date change, and for wording unless marked a minor spelling correction (`0094`). Edits keep links and helpers the office did not remove, including links to tasks completed long ago. Unsaved meeting notes, shared notes and recipients survive redraws. **No money** — staff see all of it. Tests: `tests/workplan-admin.test.js`, `tests/workmate-office-server.test.js`, `tests/ai-worker.test.js`; live: `supabase/tests/1c2_acceptance.sql`, `1c2_ai_gate.sql` |
```

- [ ] **Step 7: Run the tests**

Run: `node tests/workplan-admin.test.js` → all pass. Run: `node --check js/admin.js` → no output. Run: `npm test` → green.

- [ ] **Step 8: Stop — no commit.** Report to the controller. (The four new `<script>` tags 404 until Tasks 5–7 create the files; harmless.)

---

### Task 5: The task form and the Board

**Files:**
- Create: `js/workplan-admin-form.js`, `js/workplan-admin-board.js`

**Interfaces:**
- Consumes (Task 2): `WP.esc`, `WP.rpc`, `WP.modal`, `WP.icons`, `WP.head`, `WP.fail`, `WP.CHOOSE`, `WP.errorMessage`, `WP.taskProblem`, `WP.buildTaskPayload`, `WP.docToForm`, `WP.revisionChanges`, `WP.keepSelections`, `WP.workerNo`, `WP.statusLabel`, `WP.statusPill`, `WP.plannedLabel`, `WP.boardGroups`, `WP.alertCounts`, `WP.filterBoard`, `WP.openTask`, `WP.views`. RPCs: `wp_office_destinations`, `pr_office_people`, `pr_office_teams`, `wp_office_board`, `wp_office_task`, `wp_office_save_task`.
- Produces: `WP.loadLookups(force) → Promise<{projects, people, teams}>` (teams active only); `WP.openTaskForm(opts)` with `opts = {taskId?, doc?: officeTaskDoc, values?: Partial<v> (e.g. resolveDraft(...).values), meetingId?, onDone?: (savedDoc) => void}`; `WP.views.wpBoard`.

- [ ] **Step 1: Create the task form**

Create `js/workplan-admin-form.js` (LF):

```js
// ════════════════════════════════════════════════════════════════════
// Work Plan → the task form (create / edit). Owner + staff.
//
// One form for every screen: a new standalone task, a draft from a
// meeting, an AI suggestion to review, or editing a task. It always sends
// the FULL task (wp_office_save_task replaces every field), so:
//   * a field the AI could not match reads "Needs your choice" and Save
//     refuses until the office picks (NEEDS_CHOICE);
//   * every helper and every "waits for" link the task already has stays
//     on screen and is kept unless the office unticks it — including a
//     link to a task completed long ago (not on the Board, fetched here);
//   * the task's own project, work and team stay selectable even when
//     closed or inactive, so an edit never silently changes them;
//   * on a published task the form shows, before saving, whether people
//     must read it again. The server decides (0094): people, team and
//     dates always; wording unless "only a spelling correction".
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;
    const CHOOSE = WP.CHOOSE;

    let cache = null;
    async function loadLookups(force) {
        if (cache && !force) return cache;
        const [projects, people, teams] = await Promise.all([
            WP.rpc('wp_office_destinations'), WP.rpc('pr_office_people'), WP.rpc('pr_office_teams'),
        ]);
        cache = { projects: projects || [], people: people || [], teams: (teams || []).filter(t => t.active) };
        return cache;
    }

    // Keep the task's own project, work and team selectable.
    function withCurrent(L, doc) {
        if (!doc) return L;
        const projects = L.projects.slice();
        let i = projects.findIndex(x => x.folder_id === doc.folder_id);
        if (i < 0) {
            projects.push({ folder_id: doc.folder_id, name: doc.project_name + ' (closed)', works: [] });
            i = projects.length - 1;
        }
        if (doc.work_id && doc.work_id !== doc.folder_id && !(projects[i].works || []).some(w => w.work_id === doc.work_id)) {
            projects[i] = Object.assign({}, projects[i], {
                works: (projects[i].works || []).concat([{ work_id: doc.work_id, name: doc.work_name + ' (closed)' }]),
            });
        }
        const teams = L.teams.slice();
        if (doc.team_id && !teams.some(t => t.id === doc.team_id)) {
            teams.push({ id: doc.team_id, name: (doc.team_name || 'Team') + ' (inactive)', members: [] });
        }
        return { projects, people: L.people, teams };
    }

    function personLabel(p) {
        return p.name + (WP.workerNo(p.worker_no) ? ' · ' + WP.workerNo(p.worker_no) : '');
    }
    function opt(value, label, selected) {
        return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }
    function chooseOpt() {
        return '<option value="' + CHOOSE + '" selected>Needs your choice…</option>';
    }
    function check(name, value, label, on) {
        return '<label class="req-toggle"><input type="checkbox" name="' + name + '" value="' + esc(value) + '"' +
            (on ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }
    function field(id, label, inner, unresolved) {
        return '<div class="att-field att-span"><label for="' + id + '">' + esc(label) +
            (unresolved ? ' <span class="wp-chip wp-chip--red" data-needs>Needs your choice</span>' : '') +
            '</label>' + inner + '</div>';
    }
    function confirmBox(key, text) {
        return '<label class="req-toggle wp-confirm"><input type="checkbox" name="check_' + key + '"> ' + esc(text) + '</label>';
    }

    function formHtml(v, L, published) {
        const checks = v.checks || [];
        return field('wpfFolder', 'Project',
                '<select class="att-input" id="wpfFolder" name="folder"' + (published ? ' disabled' : '') + '>' +
                (v.folder_id === CHOOSE ? chooseOpt() : '<option value="">Choose a project…</option>') +
                L.projects.map(p => opt(p.folder_id, p.name, v.folder_id)).join('') + '</select>' +
                (published ? '<span class="att-hint-inline">A published task keeps its project.</span>' : ''),
                v.folder_id === CHOOSE) +
            field('wpfWork', 'Main Contract or Additional Works',
                '<select class="att-input" id="wpfWork" name="work"' + (published ? ' disabled' : '') + '></select>',
                v.work_id === CHOOSE) +
            field('wpfTeam', 'Team',
                '<select class="att-input" id="wpfTeam" name="team">' + (v.team_id === CHOOSE ? chooseOpt() : '') +
                '<option value="">No team (individual task)</option>' +
                L.teams.map(t => opt(t.id, t.name, v.team_id)).join('') + '</select>', v.team_id === CHOOSE) +
            field('wpfResp', 'Responsible person', '<select class="att-input" id="wpfResp" name="responsible"></select>',
                v.responsible_id === CHOOSE) +
            '<div class="att-field att-span"><span class="att-hint-inline">Helpers</span><div class="wp-checks" data-helpers></div>' +
              (checks.includes('helpers') ? confirmBox('helpers', 'I have checked the helpers (the AI named someone it could not match)') : '') +
            '</div>' +
            field('wpfTitle', 'Task title', '<input class="att-input" id="wpfTitle" name="title" maxlength="200" value="' + esc(v.title) + '">') +
            field('wpfInstr', 'Instructions', '<textarea class="att-input" id="wpfInstr" name="instructions" rows="4">' + esc(v.instructions) + '</textarea>') +
            field('wpfStart', 'Planned start', '<input class="att-input" type="date" id="wpfStart" name="planned_start" value="' + esc(v.planned_start) + '">') +
            field('wpfEnd', 'Planned end', '<input class="att-input" type="date" id="wpfEnd" name="planned_end" value="' + esc(v.planned_end) + '">') +
            (checks.includes('dates')
                ? '<div class="att-field att-span">' + confirmBox('dates', 'I have checked the dates (the notes were unclear)') + '</div>' : '') +
            '<div class="att-field att-span"><span class="att-hint-inline">Waits for (tasks of the same project; untick to remove a link)</span>' +
              '<div class="wp-checks" data-deps></div></div>' +
            ((v.office_flags || []).length
                ? '<div class="att-info att-info--warn att-span"><i data-lucide="flag"></i><div><strong>To check:</strong>' +
                  '<ul class="wp-flags">' + v.office_flags.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
                  '<label class="req-toggle"><input type="checkbox" name="clear_flags"> All checked — clear these notes</label></div></div>'
                : '') +
            (v.source_passage
                ? '<div class="att-field att-span"><span class="att-hint-inline">From the meeting notes</span>' +
                  '<blockquote class="wp-passage">' + esc(v.source_passage) + '</blockquote></div>'
                : '') +
            (published
                ? '<div class="att-field att-span" data-revision aria-live="polite"></div>' +
                  field('wpfChange', 'What changed (optional, shown in the history)',
                        '<input class="att-input" id="wpfChange" name="change_note" maxlength="300">')
                : '');
    }

    function read(form, v) {
        const el = n => form.querySelector('[name="' + n + '"]');
        const val = n => (el(n) ? el(n).value : '');
        const all = n => Array.from(form.querySelectorAll('[name="' + n + '"]'));
        const resp = val('responsible');
        const clear = el('clear_flags');
        const minor = el('minor_text_only');
        return {
            meeting_id: v.meeting_id, folder_id: val('folder'), work_id: val('work'), team_id: val('team'),
            responsible_id: resp,
            helper_ids: WP.keepSelections(v.helper_ids, all('helper').map(b => b.value),
                                          all('helper').filter(b => b.checked).map(b => b.value)).filter(id => id !== resp),
            depends_on: WP.keepSelections(v.depends_on, all('dep').map(b => b.value),
                                          all('dep').filter(b => b.checked).map(b => b.value)),
            title: val('title'), instructions: val('instructions'),
            planned_start: val('planned_start'), planned_end: val('planned_end'),
            source_passage: v.source_passage,
            office_flags: clear && clear.checked ? [] : v.office_flags,
            checks: (v.checks || []).filter(k => !(el('check_' + k) && el('check_' + k).checked)),
            minor_text_only: !!(minor && minor.checked),
            change_note: val('change_note'),
        };
    }

    function wire(form, v, L, o) {
        const sel = n => form.querySelector('[name="' + n + '"]');
        const ticked = n => Array.from(form.querySelectorAll('[name="' + n + '"]')).filter(b => b.checked).map(b => b.value);
        const workMustChoose = v.work_id === CHOOSE;
        const names = {};
        L.people.forEach(p => { names[p.id] = personLabel(p); });
        if (o.doc) {
            if (o.doc.responsible && !names[o.doc.responsible.id]) names[o.doc.responsible.id] = o.doc.responsible.name + ' (not available — choose again)';
            (o.doc.helpers || []).forEach(h => { if (!names[h.id]) names[h.id] = h.name + ' (not available — untick)'; });
        }

        function fillWorks() {
            const p = L.projects.find(x => x.folder_id === sel('folder').value);
            const works = p ? [{ work_id: p.folder_id, name: 'Main Contract' }].concat(p.works || []) : [];
            const current = v.work_id === CHOOSE ? CHOOSE : (v.work_id || (p ? p.folder_id : ''));
            sel('work').innerHTML = (current === CHOOSE ? chooseOpt() : '') + works.map(w => opt(w.work_id, w.name, current)).join('');
        }
        function pool() {
            const team = L.teams.find(t => t.id === sel('team').value);
            return team ? L.people.filter(p => (team.members || []).some(m => m.worker_id === p.id)) : L.people;
        }
        const labelFor = (id, ps) => (names[id] || 'Unknown person') + (ps.some(p => p.id === id) ? '' : ' — not in this team');

        let helpersDrawn = false;
        function fillPeople() {
            const ps = pool();
            const respEl = sel('responsible');
            const resp = respEl.options.length ? respEl.value : v.responsible_id;
            const ids = ps.map(p => p.id);
            if (resp && resp !== CHOOSE && !ids.includes(resp)) ids.push(resp);   // never drop the current person silently
            respEl.innerHTML = (resp === CHOOSE ? chooseOpt() : '') +
                '<option value="">No one yet (choose before publishing)</option>' +
                ids.map(id => opt(id, labelFor(id, ps), resp)).join('');
            const chosen = respEl.value;
            const keep = helpersDrawn ? ticked('helper') : v.helper_ids;
            const helperIds = ps.map(p => p.id);
            v.helper_ids.concat(keep).forEach(id => { if (!helperIds.includes(id)) helperIds.push(id); });
            form.querySelector('[data-helpers]').innerHTML =
                helperIds.filter(id => id !== chosen).map(id => check('helper', id, labelFor(id, ps), keep.includes(id))).join('') ||
                '<span class="req-muted">No one else to add.</span>';
            helpersDrawn = true;
        }

        let depsDrawn = false;
        function fillDeps() {
            const keep = depsDrawn ? ticked('dep') : v.depends_on;
            const ids = o.others.filter(t => t.folder_id === sel('folder').value).map(t => t.id);
            v.depends_on.concat(keep).forEach(id => { if (!ids.includes(id)) ids.push(id); });
            form.querySelector('[data-deps]').innerHTML = ids.map(id => {
                const t = o.depInfo[id];
                const label = t ? t.title + ' · ' + WP.statusLabel(t) + (o.others.some(x => x.id === id) ? '' : ' (completed earlier)')
                                : 'A task that is no longer available';
                return check('dep', id, label, keep.includes(id));
            }).join('') || '<span class="req-muted">No other task in this project.</span>';
            depsDrawn = true;
        }

        let lastRevision = '';
        function showRevision() {
            const box = form.querySelector('[data-revision]');
            if (!box) return;
            const r = WP.revisionChanges(o.doc, read(form, v));
            const key = r.changes.join(',') + '|' + r.text;
            if (key === lastRevision) return;
            lastRevision = key;
            const minor = form.querySelector('[name="minor_text_only"]');
            const wasMinor = !!(minor && minor.checked);
            if (r.changes.length) {
                box.innerHTML = '<div class="att-info att-info--warn"><i data-lucide="refresh-cw"></i><div>Saving makes a ' +
                    '<strong>new version</strong>: everyone on the task must read it again. Changed: ' +
                    esc((r.text ? ['instructions'] : []).concat(r.changes).join(', ')) + '.</div></div>';
            } else if (r.text) {
                box.innerHTML = '<div class="att-info"><i data-lucide="refresh-cw"></i><div>Saving the new wording makes a ' +
                    '<strong>new version</strong> that everyone must read again.' +
                    '<label class="req-toggle"><input type="checkbox" name="minor_text_only"' + (wasMinor ? ' checked' : '') + '>' +
                    ' Only a spelling correction — keep the current version</label></div></div>';
            } else {
                box.innerHTML = '<div class="req-muted">Nothing changed yet that needs a new reading.</div>';
            }
            WP.icons();
        }

        fillWorks(); fillPeople(); fillDeps(); showRevision();
        sel('folder').addEventListener('change', () => { v.work_id = workMustChoose ? CHOOSE : ''; fillWorks(); fillDeps(); });
        sel('team').addEventListener('change', fillPeople);
        sel('responsible').addEventListener('change', fillPeople);
        form.addEventListener('change', e => {
            const chip = e.target.closest('.att-field') && e.target.closest('.att-field').querySelector('[data-needs]');
            if (chip && e.target.tagName === 'SELECT' && e.target.value !== CHOOSE) chip.remove();
            showRevision();
        });
        form.addEventListener('input', showRevision);
    }

    // opts: { taskId, doc, values, meetingId, onDone(savedDoc) }
    async function openTaskForm(opts) {
        const o = opts || {};
        let L, board;
        const depInfo = {};
        try {
            [L, board] = await Promise.all([loadLookups(true), WP.rpc('wp_office_board', { p_folder: null })]);
            (board || []).forEach(t => { depInfo[t.id] = t; });
            // A link to a task completed more than 30 days ago is not on the
            // Board: fetch it so the form shows it and keeps it.
            const missing = ((o.doc && o.doc.depends_on) || []).filter(id => !depInfo[id]);
            (await Promise.all(missing.map(id => WP.rpc('wp_office_task', { p_task: id })))).forEach(t => { depInfo[t.id] = t; });
        } catch (e) { root.alert(WP.errorMessage(e)); return; }
        const v = Object.assign({ meeting_id: o.meetingId || '', folder_id: '', work_id: '', team_id: '', responsible_id: '',
            helper_ids: [], depends_on: [], title: '', instructions: '', planned_start: '', planned_end: '',
            source_passage: '', office_flags: [], checks: [] }, o.doc ? WP.docToForm(o.doc) : {}, o.values || {});
        const published = !!o.doc && o.doc.status !== 'draft';
        const look = withCurrent(L, o.doc);
        const others = (board || []).filter(t => t.id !== o.taskId && t.status !== 'cancelled');
        let saved = null;
        WP.modal({
            title: o.taskId ? 'Edit task' : 'New task',
            sub: o.taskId ? '' : 'Saved as a draft. Workers see it only after you publish.',
            submitLabel: o.taskId ? 'Save' : 'Save as draft',
            body: formHtml(v, look, published),
            onOpen: form => wire(form, v, look, { doc: o.doc, others, depInfo }),
            onSubmit: async form => {
                const values = read(form, v);
                const problem = WP.taskProblem(values);
                if (problem) throw new Error(problem);
                const r = await WP.rpc('wp_office_save_task', { p_task: o.taskId || null, p_data: WP.buildTaskPayload(values) });
                saved = r && r.task;
            },
            onDone: () => { if (o.onDone) o.onDone(saved); },
        });
    }

    WP.loadLookups = loadLookups;
    WP.openTaskForm = openTaskForm;
})(window);
```

- [ ] **Step 2: Create the Board**

Create `js/workplan-admin-board.js` (LF):

```js
// ════════════════════════════════════════════════════════════════════
// Work Plan → Board (WorkMate My Work, 0093). Owner + staff.
//
// Every task of the company (or one project) under the office lists
// (spec §15): waiting for your check, blocked, not acknowledged after 24
// hours, overdue, not started / in progress, drafts and proposals,
// completed in the last 30 days. A row opens the task. "New task" adds a
// standalone draft (no meeting).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;

    // Survives navigation within the session, not a reload.
    const ui = { folder: '', text: '' };

    function chip(text, tone) {
        return '<span class="wp-chip wp-chip--' + tone + '">' + esc(text) + '</span>';
    }

    function rowHtml(t) {
        const live = ['not_started', 'in_progress', 'reported_done', 'leader_checked'].includes(t.status);
        const chips = [];
        if (live && t.blocked) chips.push(chip('Blocked', 'red'));
        if (t.status === 'in_progress' && t.sent_back) chips.push(chip('Sent back', 'gold'));
        if (t.overdue) chips.push(chip('Overdue', 'red'));
        if (t.not_acknowledged_24h) chips.push(chip('Not read after 24 h', 'gold'));
        if ((t.office_flags || []).length) chips.push(chip(t.office_flags.length + ' to check', 'gold'));
        const helpers = (t.helpers || []).length;
        const people = t.responsible
            ? esc(t.responsible.name) + (helpers ? '<div class="req-muted">+' + helpers + ' helper' + (helpers === 1 ? '' : 's') + '</div>' : '')
            : '<span class="req-muted">No one yet</span>';
        return '<tr tabindex="0" data-id="' + esc(t.id) + '">' +
            '<td><strong>' + esc(t.title) + '</strong><div class="req-muted">' + esc(t.project_name) + ' · ' + esc(t.work_name) + '</div></td>' +
            '<td>' + people + '</td>' +
            '<td>' + esc(WP.plannedLabel(t)) + '</td>' +
            '<td><div class="req-status"><span class="att-pill ' + WP.statusPill(t) + '">' + esc(WP.statusLabel(t)) + '</span>' +
              chips.join('') + '</div></td>' +
            '<td class="req-go"><i data-lucide="chevron-right"></i></td>' +
            '</tr>';
    }

    function summaryHtml(list) {
        const c = WP.alertCounts(list);
        const s = (n, text, tone) => n ? '<span class="req-sum req-sum--' + tone + '"><strong>' + n + '</strong> ' + text + '</span>' : '';
        return '<div class="req-summary">' +
            '<span class="req-sum req-sum--plain"><strong>' + list.length + '</strong> task' + (list.length === 1 ? '' : 's') + '</span>' +
            s(c.check, 'waiting for your check', 'gold') +
            s(c.blocked, 'blocked', 'red') +
            s(c.unacked, 'not acknowledged after 24 hours', 'gold') +
            s(c.overdue, 'overdue', 'red') +
            s(c.proposals, c.proposals === 1 ? 'proposal' : 'proposals', 'green') +
            '</div>';
    }

    function draw(host, all) {
        const list = WP.filterBoard(all, { folder: ui.folder, text: ui.text });
        host.querySelector('[data-summary]').innerHTML = summaryHtml(list);
        host.querySelector('[data-count]').textContent = list.length !== all.length ? 'Showing ' + list.length + ' of ' + all.length : '';
        const groups = WP.boardGroups(list);
        host.querySelector('[data-groups]').innerHTML = groups.length
            ? groups.map(g =>
                '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">' + esc(g.title) +
                ' <span class="req-muted">· ' + g.tasks.length + (g.tasks.length === 1 ? ' task' : ' tasks') + '</span></div></div></div>' +
                '<div class="att-card-body" style="padding:0"><div class="req-table-wrap"><table class="att-table req-table"><thead><tr>' +
                '<th>Task</th><th>People</th><th>Planned</th><th>Status</th><th class="req-go"><span class="req-sr">Open</span></th>' +
                '</tr></thead><tbody>' + g.tasks.map(rowHtml).join('') + '</tbody></table></div></div></div>').join('')
            : '<div class="att-card"><div class="att-empty">' +
              (all.length ? 'No task matches these filters.' : 'No tasks yet. Start from a meeting, or add a task.') + '</div></div>';
        WP.icons();
    }

    async function renderBoard(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading tasks…</div></div>';
        let all, projects;
        try {
            [all, projects] = await Promise.all([WP.rpc('wp_office_board', { p_folder: null }), WP.rpc('wp_office_destinations')]);
        } catch (e) { WP.fail(host, e); return; }
        all = all || [];
        projects = projects || [];
        if (ui.folder && !projects.some(p => p.folder_id === ui.folder)) ui.folder = '';

        host.innerHTML = '<div class="att-stack">' +
            WP.head('Work Plan', 'Tasks from meetings and the office. Workers see their own tasks in DAC\'S WorkMate (My Work).',
                '<button class="att-btn" type="button" data-meetings><i data-lucide="book-open"></i> Meetings</button>' +
                '<button class="att-btn att-btn--primary" type="button" data-new><i data-lucide="plus"></i> New task</button>') +
            '<div data-summary></div>' +
            '<div class="att-toolbar">' +
              '<select class="att-filter" data-folder aria-label="Project"><option value="">All projects</option>' +
                projects.map(p => '<option value="' + esc(p.folder_id) + '"' + (p.folder_id === ui.folder ? ' selected' : '') + '>' +
                  esc(p.name) + '</option>').join('') + '</select>' +
              '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                '<input class="att-search" type="search" data-text aria-label="Search" placeholder="Search task, project, person…" value="' +
                esc(ui.text) + '"></div>' +
              '<span class="req-count" data-count aria-live="polite"></span>' +
            '</div>' +
            '<div data-groups></div>' +
            '</div>';
        draw(host, all);

        host.querySelector('[data-folder]').addEventListener('change', e => { ui.folder = e.target.value; draw(host, all); });
        host.querySelector('[data-text]').addEventListener('input', e => { ui.text = e.target.value; draw(host, all); });
        host.querySelector('[data-meetings]').addEventListener('click', () => root.switchView('wpMeetings'));
        host.querySelector('[data-new]').addEventListener('click', () =>
            WP.openTaskForm({ values: ui.folder ? { folder_id: ui.folder } : {}, onDone: () => renderBoard(host) }));
        const groups = host.querySelector('[data-groups]');
        groups.addEventListener('click', e => {
            const tr = e.target.closest('tr[data-id]');
            if (tr) WP.openTask(tr.dataset.id);
        });
        groups.addEventListener('keydown', e => {
            const tr = e.target.closest('tr[data-id]');
            if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); WP.openTask(tr.dataset.id); }
        });
        WP.icons();
    }

    WP.views.wpBoard = renderBoard;
})(window);
```

- [ ] **Step 3: Check syntax and the guards**

Run: `node --check js/workplan-admin-form.js && node --check js/workplan-admin-board.js` → no output.
Run: `node tests/workplan-admin.test.js` → all pass (the RPC and no-money guards now scan these files). Run: `npm test` → green.

- [ ] **Step 4: Stop — no commit.** Report to the controller.

---

### Task 6: One task — people, problems, photos, history, decisions

**Files:**
- Create: `js/workplan-admin-task.js`

**Interfaces:**
- Consumes (Tasks 2, 5): `WP.state.taskId`, `WP.loadTickets`, `WP.rpc`, `WP.modal`, `WP.esc`, `WP.head`, `WP.fail`, `WP.icons`, `WP.signImages`, `WP.statusLabel`, `WP.statusPill`, `WP.plannedLabel`, `WP.STATUS_LABEL`, `WP.blockerKind`, `WP.eventText`, `WP.formatManila`, `WP.openTask`, `WP.openMeeting`, `WP.openTaskForm`. RPCs: `wp_office_task`, `wp_office_publish`, `wp_office_approve`, `wp_office_send_back`, `wp_office_reopen`, `wp_office_cancel`, `wp_office_clear_blocker`.
- Produces: `WP.views.wpTask`.

- [ ] **Step 1: Create the task screen**

Create `js/workplan-admin-task.js` (LF):

```js
// ════════════════════════════════════════════════════════════════════
// Work Plan → one task (WorkMate My Work, 0093). Owner + staff.
//
// Who is on it and who has read the CURRENT version; open problems (the
// office clears them, with a note, after checking — delivered materials
// never clear a problem by themselves, spec §8); what it waits for;
// photos (private task-photos, signed links); the history (a revision
// says what changed); and the decisions: publish a draft, approve
// reported work, send back, reopen, cancel or decline a proposal (a
// reason is required where the server asks). A leader's check never
// replaces the office approval.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;
    const tickets = WP.loadTickets();   // only the newest task load may draw

    function card(title, body) {
        return '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">' + esc(title) +
            '</div></div></div><div class="att-card-body">' + body + '</div></div>';
    }
    function btn(act, label, cls) {
        return '<button class="att-btn' + (cls ? ' ' + cls : '') + '" type="button" data-act="' + act + '">' + esc(label) + '</button>';
    }

    function actionsHtml(t) {
        const out = [];
        if (t.status === 'reported_done' || t.status === 'leader_checked') {
            out.push(btn('approve', 'Approve — completed', 'att-btn--primary'));
            out.push(btn('send_back', 'Send back'));
        }
        if (t.status === 'draft') out.push(btn('publish', 'Publish', 'att-btn--primary'));
        if (t.status === 'completed') out.push(btn('reopen', 'Reopen'));
        if (t.status !== 'completed' && t.status !== 'cancelled') {
            out.push(btn('edit', 'Edit'));
            out.push(btn('cancel', t.status === 'draft' && t.proposed_by ? 'Decline' : 'Cancel task', 'att-btn--warn'));
        }
        return out.join('');
    }

    function peopleHtml(t) {
        const acks = t.acks || [];
        const team = t.team_name ? 'Team: ' + esc(t.team_name) : 'Individual task (no team)';
        if (!acks.length) return '<div class="req-muted">No one assigned yet — edit the task to choose the responsible person.</div>' +
            '<div class="req-muted">' + team + '</div>';
        return '<ul class="wp-list">' + acks.map(a =>
            '<li><strong>' + esc(a.name) + '</strong> <span class="req-muted">' + (a.role === 'responsible' ? 'Responsible' : 'Helper') + '</span> ' +
            (t.status === 'draft' ? '' : a.acked
                ? '<span class="att-pill att-pill--done">Read version ' + esc(t.version) + '</span>'
                : '<span class="att-pill att-pill--working">Has not read version ' + esc(t.version) + '</span>') +
            '</li>').join('') + '</ul><div class="req-muted">' + team + '</div>';
    }

    function problemsHtml(t) {
        const blockers = t.blockers || [];
        const waits = t.waiting_for || [];
        if (!blockers.length && !waits.length) return '<div class="req-muted">Nothing is holding this task.</div>';
        return blockers.map(b =>
                '<div class="wp-row"><div><strong>' + esc(WP.blockerKind(b.kind)) + '</strong> — ' + esc(b.description) +
                '<div class="req-muted">' + esc(b.reported_by) + ' · ' + esc(WP.formatManila(b.reported_at)) + '</div></div>' +
                '<button class="att-btn" type="button" data-clear="' + esc(b.id) + '">Clear…</button></div>').join('') +
            waits.map(w =>
                '<div class="wp-row"><div>Waits for <strong>' + esc(w.title) + '</strong> <span class="req-muted">(' +
                esc(WP.STATUS_LABEL[w.status] || w.status) + ')</span></div>' +
                '<button class="att-link" type="button" data-open="' + esc(w.task_id) + '">Open</button></div>').join('');
    }

    function photosHtml(t) {
        const photos = t.photos || [];
        if (!photos.length) return '<div class="req-muted">No photos.</div>';
        return '<div class="req-photos">' + photos.map(p =>
            '<div class="wp-photo"><img class="req-photo" alt="Task photo" data-sign-bucket="task-photos" data-sign-path="' + esc(p.path) + '">' +
            '<div class="req-muted">' + esc(WP.formatManila(p.created_at)) + (p.blocker_id ? ' · problem photo' : '') +
            '</div></div>').join('') + '</div>';
    }

    function historyHtml(t) {
        const events = (t.history || []).slice().reverse();
        if (!events.length) return '<div class="req-muted">No history yet.</div>';
        return '<ul class="wp-list">' + events.map(e =>
            '<li><div class="req-muted">' + esc(WP.formatManila(e.at)) + ' · ' + esc(e.by) + '</div><div>' + esc(WP.eventText(e)) +
            '</div></li>').join('') + '</ul>';
    }

    function textModal(o) {
        WP.modal({
            title: o.title, sub: o.sub, warn: !!o.warn, submitLabel: o.submitLabel,
            body: '<div class="att-field att-span"><label for="wpReason">' + esc(o.label) + '</label>' +
                  '<textarea class="att-input" id="wpReason" name="reason" rows="3" maxlength="500"></textarea></div>',
            onSubmit: form => o.call(form.reason.value.trim()),
            onDone: o.onDone,
        });
    }

    function wire(host, t, rerender) {
        host.querySelector('[data-back]').addEventListener('click', () => root.switchView('wpBoard'));
        const meeting = host.querySelector('[data-meeting]');
        if (meeting) meeting.addEventListener('click', () => WP.openMeeting(t.meeting_id));
        host.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => WP.openTask(b.dataset.open)));
        host.querySelectorAll('[data-clear]').forEach(b => b.addEventListener('click', () => textModal({
            title: 'Clear this problem', sub: 'Only after checking the materials, tool or preparation really are ready for this task.',
            label: 'What was checked', submitLabel: 'Clear problem', onDone: rerender,
            call: note => WP.rpc('wp_office_clear_blocker', { p_blocker: b.dataset.clear, p_note: note }),
        })));
        host.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
            const id = t.id;
            switch (b.dataset.act) {
                case 'edit':
                    WP.openTaskForm({ taskId: id, doc: t, onDone: rerender });
                    break;
                case 'publish':
                    WP.modal({
                        title: 'Publish this task?', sub: 'Everyone on it sees it in My Work and must read it.', submitLabel: 'Publish',
                        body: '', onDone: rerender,
                        onSubmit: () => WP.rpc('wp_office_publish', { p_meeting: null, p_tasks: [id], p_shared_notes: null,
                                                                      p_recipients: null, p_change_note: null }),
                    });
                    break;
                case 'approve':
                    textModal({ title: 'Approve as completed', sub: 'Tasks that wait for this one can then start.',
                        label: 'Note (optional)', submitLabel: 'Approve', onDone: rerender,
                        call: note => WP.rpc('wp_office_approve', { p_task: id, p_note: note }) });
                    break;
                case 'send_back':
                    textModal({ title: 'Send back', sub: 'The task returns to In progress, marked Sent back.',
                        label: 'What needs fixing (the workers see this)', submitLabel: 'Send back', onDone: rerender,
                        call: reason => WP.rpc('wp_office_send_back', { p_task: id, p_reason: reason }) });
                    break;
                case 'reopen':
                    textModal({ title: 'Reopen this task', sub: 'Tasks that wait for it are held again until it is approved.',
                        label: 'Why (the workers see this)', submitLabel: 'Reopen', onDone: rerender,
                        call: reason => WP.rpc('wp_office_reopen', { p_task: id, p_reason: reason }) });
                    break;
                case 'cancel':
                    textModal({ title: t.status === 'draft' && t.proposed_by ? 'Decline this proposal' : 'Cancel this task', warn: true,
                        sub: t.proposed_by ? 'The team leader who proposed it sees this reason.' : 'It leaves the Board; its history stays.',
                        label: 'Reason', submitLabel: t.status === 'draft' && t.proposed_by ? 'Decline' : 'Cancel task', onDone: rerender,
                        call: reason => WP.rpc('wp_office_cancel', { p_task: id, p_reason: reason }) });
                    break;
            }
        }));
    }

    async function renderTask(host) {
        const id = WP.state.taskId;
        if (!id) { root.switchView('wpBoard'); return; }
        const ticket = tickets.take();
        const current = () => tickets.isLatest(ticket) && WP.state.taskId === id;
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the task…</div></div>';
        let t;
        try { t = await WP.rpc('wp_office_task', { p_task: id }); } catch (e) { if (current()) WP.fail(host, e); return; }
        if (!current()) return;   // an older load answered late: draw nothing
        const live = ['not_started', 'in_progress', 'reported_done', 'leader_checked'].includes(t.status);
        const sub = t.project_name + ' · ' + t.work_name + (t.planned_start || t.planned_end ? ' · ' + WP.plannedLabel(t) : '');
        host.innerHTML = '<div class="att-stack">' +
            '<div class="req-actions"><button class="att-btn" type="button" data-back><i data-lucide="arrow-left"></i> Work Plan</button>' +
              (t.meeting_id ? '<button class="att-btn" type="button" data-meeting><i data-lucide="book-open"></i> Its meeting</button>' : '') +
            '</div>' +
            WP.head(t.title, sub, actionsHtml(t)) +
            '<div class="req-summary"><span class="att-pill ' + WP.statusPill(t) + '">' + esc(WP.statusLabel(t)) + '</span>' +
              (live && t.blocked ? '<span class="wp-chip wp-chip--red">Blocked</span>' : '') +
              (t.status === 'in_progress' && t.sent_back ? '<span class="wp-chip wp-chip--gold">Sent back</span>' : '') +
              (t.version ? '<span class="req-muted">Version ' + esc(t.version) + '</span>' : '') +
            '</div>' +
            ((t.office_flags || []).length
                ? '<div class="att-info att-info--warn"><i data-lucide="flag"></i><div><strong>To check before publishing:</strong>' +
                  '<ul class="wp-flags">' + t.office_flags.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></div></div>'
                : '') +
            card('Instructions', t.instructions ? '<p class="wp-text">' + esc(t.instructions) + '</p>' : '<div class="req-muted">No instructions.</div>') +
            card('People', peopleHtml(t)) +
            card('Problems and waiting', problemsHtml(t)) +
            card('Photos', photosHtml(t)) +
            (t.source_passage ? card('From the meeting notes', '<blockquote class="wp-passage">' + esc(t.source_passage) + '</blockquote>') : '') +
            card('History', historyHtml(t)) +
            '</div>';
        wire(host, t, () => renderTask(host));
        WP.signImages(host);
        WP.icons();
    }

    WP.views.wpTask = renderTask;
})(window);
```

- [ ] **Step 2: Check syntax and the guards**

Run: `node --check js/workplan-admin-task.js` → no output. Run: `node tests/workplan-admin.test.js` → all pass. Run: `npm test` → green.

- [ ] **Step 3: Stop — no commit.** Report to the controller.

---

### Task 7: Meetings — list, editor (unsaved edits kept), AI drafts, publish

**Files:**
- Create: `js/workplan-admin-meetings.js`, `tests/workplan-screens.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes (Tasks 2, 5): `WP.state.meetingId`, `WP.rpc`, `WP.modal`, `WP.esc`, `WP.head`, `WP.fail`, `WP.icons`, `WP.formatDay`, `WP.formatManila`, `WP.todayManila`, `WP.workerNo`, `WP.statusLabel`, `WP.statusPill`, `WP.errorMessage`, `WP.NOTES_MAX`, `WP.meetingFields`, `WP.meetingUnsaved`, `WP.settlePending`, `WP.loadTickets`, `WP.aiDraft`, `WP.resolveDraft`, `WP.loadLookups`, `WP.openTaskForm`, `WP.openTask`, `WP.openMeeting`. RPCs: `wp_office_meetings`, `wp_office_meeting`, `wp_office_save_meeting`, `wp_office_publish`.
- Produces: `WP.views.wpMeetings`, `WP.views.wpMeeting`.

- [ ] **Step 1: Create the meetings screens**

Create `js/workplan-admin-meetings.js` (LF):

```js
// ════════════════════════════════════════════════════════════════════
// Work Plan → Meetings (WorkMate My Work, 0093). Owner + staff.
//
// A meeting holds the office's ORIGINAL notes (never shown to workers).
// "Draft tasks with AI" saves the notes, sends them to the dacs-ai worker
// and lists suggestions; each opens the task form pre-filled, with every
// name it could not match exactly left as "Needs your choice" (spec §4).
// Nothing reaches workers until Publish: the meeting's drafts become live
// tasks and the shared notes go to the chosen people (default: everyone
// assigned a task from this meeting).
//
// Unsaved edits — notes, shared notes, recipients, change note — live in
// `pending` and survive every redraw (adding or editing a task, saving
// notes, AI drafting, a failed AI request). A save or publish forgets only
// the values it actually sent, so text typed while it runs is kept
// (settlePending — in place, so the input handlers' object is never
// swapped out). A slow, older load never draws over the meeting now open
// (loadTickets). AI never overwrites what the office typed: replacing
// shared notes or unadded suggestions asks first. A failed AI request
// redraws the screen with the error, so every button works again. A late
// result never redraws a different meeting. AI suggestions live only in
// this browser tab; leaving the page with unsaved edits asks first.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const WP = root.WorkPlanAdmin;
    if (!WP) return;
    const esc = WP.esc;

    const suggestions = {};   // meetingId → { shared_notes, items: [{ task, resolved, added }] }
    const pending = {};       // meetingId (or 'new') → unsaved edits
    const loaded = {};        // meetingId (or 'new') → the meeting as last loaded
    const DRAFTING_HTML = '<div class="req-muted">Saving the notes and drafting… this can take up to a minute. You can keep typing; nothing is lost.</div>';
    const drafting = {};      // meetingId → true while a draft request is running (one at a time)
    const aiErrors = {};      // meetingId → the last AI failure, shown until the next attempt
    const tickets = WP.loadTickets();   // only the newest meeting load may draw

    root.addEventListener('beforeunload', e => {
        const dirty = Object.keys(pending).some(id => WP.meetingUnsaved(loaded[id] || {}, pending[id]));
        const unadded = Object.keys(suggestions).some(id => suggestions[id].items.some(it => !it.added));
        if (dirty || unadded) { e.preventDefault(); e.returnValue = ''; }
    });

    // Forget only what was saved. pending[id] is never replaced: the input
    // handlers hold this object, so anything typed since stays.
    function settle(id, sent) {
        WP.settlePending(pending[id], sent);
    }

    function card(title, body, sub, tools) {
        return '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">' + esc(title) + '</div>' +
            (sub ? '<div class="att-card-sub">' + esc(sub) + '</div>' : '') + '</div>' +
            (tools ? '<div class="att-card-tools">' + tools + '</div>' : '') + '</div><div class="att-card-body">' + body + '</div></div>';
    }

    function confirm(title, sub, label, run) {
        WP.modal({ title, sub, submitLabel: label, body: '', onSubmit: async () => {}, onDone: run });
    }

    // ── Meetings list ───────────────────────────────────────────────

    async function renderMeetings(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading meetings…</div></div>';
        let list;
        try { list = await WP.rpc('wp_office_meetings'); } catch (e) { WP.fail(host, e); return; }
        list = list || [];
        const rows = list.map(m =>
            '<tr tabindex="0" data-id="' + esc(m.id) + '">' +
            '<td>' + esc(WP.formatDay(m.held_on)) + '</td>' +
            '<td><strong>' + esc(m.title) + '</strong></td>' +
            '<td>' + (m.current_version
                ? '<span class="att-pill att-pill--done">Published · version ' + esc(m.current_version) + '</span>'
                : '<span class="att-pill att-pill--none">Not published</span>') + '</td>' +
            '<td>' + esc(m.draft_count) + ' draft' + (m.draft_count === 1 ? '' : 's') + ' · ' + esc(m.task_count) + ' task' +
              (m.task_count === 1 ? '' : 's') + '</td>' +
            '<td class="req-go"><i data-lucide="chevron-right"></i></td></tr>').join('');
        host.innerHTML = '<div class="att-stack">' +
            WP.head('Meetings', 'Type or paste the notes, let the AI suggest tasks, check each one, then publish.',
                '<button class="att-btn" type="button" data-board><i data-lucide="clipboard-list"></i> Board</button>' +
                '<button class="att-btn att-btn--primary" type="button" data-new><i data-lucide="plus"></i> New meeting</button>') +
            '<div class="att-card"><div class="att-card-body" style="padding:0">' +
            (list.length
                ? '<div class="req-table-wrap"><table class="att-table req-table"><thead><tr><th>Held on</th><th>Meeting</th>' +
                  '<th>Shared notes</th><th>Tasks</th><th class="req-go"><span class="req-sr">Open</span></th></tr></thead>' +
                  '<tbody data-rows>' + rows + '</tbody></table></div>'
                : '<div class="att-empty">No meetings yet.</div>') +
            '</div></div></div>';
        host.querySelector('[data-board]').addEventListener('click', () => root.switchView('wpBoard'));
        host.querySelector('[data-new]').addEventListener('click', () => WP.openMeeting(null));
        const body = host.querySelector('[data-rows]');
        if (body) {
            body.addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) WP.openMeeting(tr.dataset.id); });
            body.addEventListener('keydown', e => {
                const tr = e.target.closest('tr[data-id]');
                if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); WP.openMeeting(tr.dataset.id); }
            });
        }
        WP.icons();
    }

    // ── One meeting ─────────────────────────────────────────────────

    function notesFields(f) {
        return '<div class="att-field att-span"><label for="wpmTitle">Meeting</label>' +
              '<input class="att-input" id="wpmTitle" data-title maxlength="200" value="' + esc(f.title) + '"></div>' +
            '<div class="att-field att-span"><label for="wpmDate">Held on</label>' +
              '<input class="att-input" type="date" id="wpmDate" data-date value="' + esc(f.held_on) + '"></div>' +
            '<div class="att-field att-span"><label for="wpmNotes">Original notes <span class="att-hint-inline">(office only — never shown to workers)</span></label>' +
              '<textarea class="att-input" id="wpmNotes" data-notes rows="10">' + esc(f.notes) + '</textarea></div>';
    }

    // Exactly what is on screen (the same values `pending` holds), so a
    // finished save can tell what was sent from what was typed since.
    function readNotes(host) {
        return {
            title: host.querySelector('[data-title]').value,
            held_on: host.querySelector('[data-date]').value,
            notes: host.querySelector('[data-notes]').value,
        };
    }

    async function saveNotes(id, f) {
        const r = await WP.rpc('wp_office_save_meeting', { p_meeting: id || null, p_title: f.title.trim(), p_held_on: f.held_on || null,
                                                            p_original_notes: f.notes });
        return r.meeting_id;
    }

    // Record every edit as it is typed, so a redraw can put it back.
    function track(host, id) {
        const p = pending[id] || (pending[id] = {});
        const bind = (selector, key, ev) => {
            const el = host.querySelector(selector);
            if (el) el.addEventListener(ev || 'input', () => { p[key] = el.value; });
        };
        bind('[data-title]', 'title');
        bind('[data-date]', 'held_on', 'change');
        bind('[data-notes]', 'notes');
        bind('[data-shared]', 'shared');
        bind('[data-change]', 'change');
        const recips = host.querySelector('[data-recips]');
        host.querySelectorAll('[name="wpmRecip"]').forEach(r => r.addEventListener('change', () => {
            p.recip = r.value;
            if (recips) recips.hidden = r.value !== 'choose';
        }));
        host.querySelectorAll('[name="wpmPerson"]').forEach(b => b.addEventListener('change', () => {
            p.people = Array.from(host.querySelectorAll('[name="wpmPerson"]')).filter(x => x.checked).map(x => x.value);
        }));
        return p;
    }

    function renderNew(host) {
        loaded.new = { held_on: WP.todayManila() };
        const f = WP.meetingFields(loaded.new, pending.new);
        host.innerHTML = '<div class="att-stack">' +
            '<div class="req-actions"><button class="att-btn" type="button" data-back><i data-lucide="arrow-left"></i> Meetings</button></div>' +
            WP.head('New meeting', 'Save the notes first; then draft tasks with AI or add them by hand.') +
            card('Notes', notesFields(f) +
                '<div class="req-actions"><button class="att-btn att-btn--primary" type="button" data-save>Save meeting</button></div>') +
            '</div>';
        track(host, 'new');
        host.querySelector('[data-back]').addEventListener('click', () => root.switchView('wpMeetings'));
        host.querySelector('[data-save]').addEventListener('click', async e => {
            e.target.disabled = true;
            const sent = readNotes(host);
            try {
                const newId = await saveNotes(null, sent);
                const rest = pending.new ? WP.settlePending(pending.new, sent) : {};   // typed while saving: carried over
                delete pending.new;
                if (Object.keys(rest).length) pending[newId] = rest;
                if (WP.state.meetingId === null) {                    // still on this screen
                    WP.state.meetingId = newId;
                    renderMeeting(host);
                }
            } catch (err) { root.alert(WP.errorMessage(err)); e.target.disabled = false; }
        });
        WP.icons();
    }

    function suggestionsHtml(s, error) {
        const note = '<div class="req-muted">Suggestions stay only in this browser tab until you add them as drafts. ' +
            'Reloading the page discards suggestions you have not added; saved notes and draft tasks stay.</div>';
        const failed = error ? '<div class="att-info att-info--warn"><i data-lucide="alert-triangle"></i><div>' + esc(error) +
            '</div></div>' : '';
        if (!s) return failed + '<div class="req-muted">No AI suggestions yet. You can also add tasks by hand below.</div>' + note;
        return failed + note +
            (s.shared_notes
                ? '<div class="wp-row"><div><strong>Suggested shared notes</strong><p class="wp-text">' + esc(s.shared_notes) + '</p></div>' +
                  '<button class="att-btn" type="button" data-use-notes>Use as shared notes</button></div>'
                : '') +
            (s.items.length
                ? s.items.map((it, i) =>
                    '<div class="wp-row' + (it.added ? ' is-added' : '') + '"><div><strong>' + esc(it.task.title) + '</strong>' +
                    '<div class="req-muted">' + esc([it.task.project || 'No project', it.task.work,
                        it.task.responsible ? 'Responsible: ' + it.task.responsible : ''].filter(Boolean).join(' · ')) + '</div>' +
                    (it.resolved.flags.length ? '<ul class="wp-flags">' + it.resolved.flags.map(f => '<li>' + esc(f) + '</li>').join('') + '</ul>' : '') +
                    (it.task.source_passage ? '<blockquote class="wp-passage">' + esc(it.task.source_passage) + '</blockquote>' : '') +
                    '</div>' +
                    (it.added
                        ? '<span class="att-pill att-pill--done">Added as draft</span>'
                        : '<button class="att-btn att-btn--primary" type="button" data-ai-add="' + i + '">Review and add…</button>') +
                    '</div>').join('')
                : '<div class="req-muted">The AI found no tasks in these notes.</div>');
    }

    function tasksHtml(m) {
        const tasks = m.tasks || [];
        if (!tasks.length) return '<div class="req-muted">No tasks yet.</div>';
        return tasks.map(t =>
            '<div class="wp-row"><div><strong>' + esc(t.title) + '</strong><div class="req-muted">' +
            esc(t.project_name + ' · ' + t.work_name + (t.responsible ? ' · ' + t.responsible.name : ' · no responsible person yet')) + '</div></div>' +
            '<div><span class="att-pill ' + WP.statusPill(t) + '">' + esc(WP.statusLabel(t)) + '</span> ' +
            '<button class="att-link" type="button" data-task="' + esc(t.id) + '">Open</button></div></div>').join('');
    }

    function publishHtml(m, f, L) {
        const drafts = (m.tasks || []).filter(t => t.status === 'draft');
        return '<div class="att-field att-span"><label for="wpmShared">Shared notes <span class="att-hint-inline">(workers read this — no prices, pay or private matters; check it yourself, the AI is not enough)</span></label>' +
              '<textarea class="att-input" id="wpmShared" data-shared rows="6">' + esc(f.shared) + '</textarea></div>' +
            '<fieldset class="wp-recipients att-span"><legend>Who receives the notes</legend>' +
              '<label class="req-toggle"><input type="radio" name="wpmRecip" value="default"' + (f.recip !== 'choose' ? ' checked' : '') + '>' +
                ' Everyone assigned a task from this meeting</label>' +
              '<label class="req-toggle"><input type="radio" name="wpmRecip" value="choose"' + (f.recip === 'choose' ? ' checked' : '') + '>' +
                ' Choose people</label>' +
              '<div class="wp-checks" data-recips' + (f.recip === 'choose' ? '' : ' hidden') + '>' + L.people.map(p =>
                '<label class="req-toggle"><input type="checkbox" name="wpmPerson" value="' + esc(p.id) + '"' +
                (f.people.includes(p.id) ? ' checked' : '') + '> ' +
                esc(p.name + (WP.workerNo(p.worker_no) ? ' · ' + WP.workerNo(p.worker_no) : '')) + '</label>').join('') + '</div>' +
            '</fieldset>' +
            (m.current_version
                ? '<div class="att-field att-span"><label for="wpmChange">What changed <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="wpmChange" data-change maxlength="300" value="' + esc(f.change) + '"></div>'
                : '') +
            '<div class="req-muted">' + (drafts.length
                ? drafts.length + ' draft task' + (drafts.length === 1 ? '' : 's') + ' will be published with the notes. Each needs a responsible person.'
                : 'No draft tasks — this publishes the notes only.') + '</div>' +
            '<div class="req-actions"><button class="att-btn att-btn--primary" type="button" data-publish>Publish…</button></div>';
    }

    function versionsHtml(m) {
        const versions = m.versions || [];
        if (!versions.length) return '<div class="req-muted">Not published yet.</div>';
        return '<ul class="wp-list">' + versions.map(v =>
            '<li><strong>Version ' + esc(v.version) + '</strong> <span class="req-muted">' + esc(WP.formatManila(v.published_at)) + ' · ' +
            esc(v.published_by) + '</span>' + (v.change_note ? '<div>' + esc(v.change_note) + '</div>' : '') +
            '<div class="req-muted">To: ' + esc((v.recipients || []).map(r => r.name).join(', ') || 'no one') + '</div></li>').join('') + '</ul>';
    }

    async function renderMeeting(host) {
        const id = WP.state.meetingId;
        const ticket = tickets.take();            // a newer load — another meeting, or New meeting — wins
        if (!id) { renderNew(host); return; }
        const current = () => tickets.isLatest(ticket) && WP.state.meetingId === id;
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the meeting…</div></div>';
        let m, L;
        try { [m, L] = await Promise.all([WP.rpc('wp_office_meeting', { p_meeting: id }), WP.loadLookups(true)]); }
        catch (e) { if (current()) WP.fail(host, e); return; }
        if (!current()) return;                   // an older load answered late: draw nothing
        loaded[id] = m;
        const f = WP.meetingFields(m, pending[id]);
        // Only redraw if this meeting is still the one open.
        const rerender = () => { if (WP.state.meetingId === id) renderMeeting(host); };
        const s = suggestions[id];

        host.innerHTML = '<div class="att-stack">' +
            '<div class="req-actions"><button class="att-btn" type="button" data-back><i data-lucide="arrow-left"></i> Meetings</button></div>' +
            WP.head(m.title, WP.formatDay(m.held_on) + (m.current_version
                ? ' · shared notes published (version ' + m.current_version + ')' : ' · not published yet')) +
            card('Notes', notesFields(f) +
                '<div class="req-actions"><button class="att-btn" type="button" data-save>Save notes</button></div>') +
            card('AI drafts', '<div data-ai>' + (drafting[id] ? DRAFTING_HTML : suggestionsHtml(s, aiErrors[id])) + '</div>',
                'Saves the notes, then sends them to Cloudflare\'s AI to suggest tasks. Nothing reaches workers until you review and publish.',
                '<button class="att-btn att-btn--primary" type="button" data-ai-run' + (drafting[id] ? ' disabled' : '') + '><i data-lucide="sparkles"></i> ' +
                (s ? 'Draft again' : 'Draft tasks with AI') + '</button>') +
            card('Tasks from this meeting', tasksHtml(m), '',
                '<button class="att-btn" type="button" data-add><i data-lucide="plus"></i> Add task by hand</button>') +
            card('Publish', publishHtml(m, f, L)) +
            card('Published versions', versionsHtml(m)) +
            '</div>';
        const p = track(host, id);

        host.querySelector('[data-back]').addEventListener('click', () => root.switchView('wpMeetings'));
        host.querySelector('[data-save]').addEventListener('click', async e => {
            e.target.disabled = true;
            const sent = readNotes(host);
            try { await saveNotes(id, sent); settle(id, sent); rerender(); }
            catch (err) { root.alert(WP.errorMessage(err)); e.target.disabled = false; }
        });

        const runDraft = async (button) => {
            const sent = readNotes(host);
            if (!sent.notes.trim()) { root.alert(WP.errorMessage(new Error('NO_NOTES'))); return; }
            if (sent.notes.length > WP.NOTES_MAX) { root.alert(WP.errorMessage(new Error('NOTES_TOO_LONG'))); return; }
            if (drafting[id]) return;
            drafting[id] = true;
            button.disabled = true;
            delete aiErrors[id];
            host.querySelector('[data-ai]').innerHTML = DRAFTING_HTML;
            try {
                await saveNotes(id, sent);
                settle(id, sent);
                const ctx = { projects: L.projects, people: L.people, teams: L.teams, heldOn: sent.held_on };
                const d = await WP.aiDraft(sent.notes, ctx);
                suggestions[id] = { shared_notes: d.shared_notes,
                                    items: d.tasks.map(t => ({ task: t, resolved: WP.resolveDraft(t, ctx), added: false })) };
            } catch (err) {
                // Earlier suggestions stay; the redraw shows why and wires every button again.
                aiErrors[id] = WP.errorMessage(err);
            } finally {
                delete drafting[id];
            }
            rerender();
        };
        host.querySelector('[data-ai-run]').addEventListener('click', e => {
            const button = e.currentTarget;
            if (s && s.items.some(it => !it.added)) {
                confirm('Draft again?', 'The suggestions you have not added yet will be replaced. Added drafts and your notes stay.',
                        'Draft again', () => runDraft(button));
            } else {
                runDraft(button);
            }
        });

        const useNotes = host.querySelector('[data-use-notes]');
        if (useNotes) useNotes.addEventListener('click', () => {
            const box = host.querySelector('[data-shared]');
            const apply = () => { box.value = s.shared_notes; p.shared = box.value; };
            if (box.value.trim() && box.value !== s.shared_notes) {
                confirm('Replace your shared notes?', 'What you wrote in Shared notes will be replaced by the AI suggestion.', 'Replace', apply);
            } else {
                apply();
            }
        });
        host.querySelectorAll('[data-ai-add]').forEach(b => b.addEventListener('click', () => {
            const it = s.items[Number(b.dataset.aiAdd)];
            WP.openTaskForm({ meetingId: id, values: it.resolved.values, onDone: () => { it.added = true; rerender(); } });
        }));
        host.querySelector('[data-add]').addEventListener('click', () => WP.openTaskForm({ meetingId: id, onDone: rerender }));
        host.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => WP.openTask(b.dataset.task)));

        host.querySelector('[data-publish]').addEventListener('click', () => {
            const choose = host.querySelector('[name="wpmRecip"]:checked').value === 'choose';
            const people = Array.from(host.querySelectorAll('[name="wpmPerson"]')).filter(x => x.checked).map(x => x.value);
            const changeEl = host.querySelector('[data-change]');
            // What this publish sends — afterwards only these are forgotten.
            const sent = { shared: host.querySelector('[data-shared]').value, recip: choose ? 'choose' : 'default', people,
                           change: changeEl ? changeEl.value : '' };
            WP.modal({
                title: 'Publish to workers?',
                sub: 'Draft tasks become live in My Work; the shared notes go to ' +
                     (choose ? people.length + ' chosen ' + (people.length === 1 ? 'person' : 'people') : 'everyone assigned a task from this meeting') + '.',
                submitLabel: 'Publish', body: '',
                onSubmit: async () => {
                    if (choose && !people.length) throw new Error('NO_RECIPIENTS');
                    await WP.rpc('wp_office_publish', { p_meeting: id, p_tasks: (m.tasks || []).filter(t => t.status === 'draft').map(t => t.id), p_shared_notes: sent.shared,
                                                        p_recipients: choose ? people : null, p_change_note: sent.change.trim() });
                },
                onDone: () => { settle(id, sent); rerender(); },
            });
        });
        WP.icons();
    }

    WP.views.wpMeetings = renderMeetings;
    WP.views.wpMeeting = renderMeeting;
})(window);
```

- [ ] **Step 2: Write the screen tests**

Create `tests/workplan-screens.test.js`:

```js
// ════════════════════════════════════════════════════════════════════
// WORK PLAN SCREEN TESTS:  node tests/workplan-screens.test.js
//
// Runs the REAL js/workplan-admin-meetings.js and js/workplan-admin-task.js
// in Node against a small stand-in page (zero dependencies) and a scripted
// server whose answers the test releases one at a time. Proves:
//   * notes typed after Save finishes but before the AI answers survive
//     an AI success and an AI failure;
//   * opening meeting A, switching to B, then A answering last (or
//     failing last) leaves B on screen; the same for tasks.
// The stand-in page records what is drawn; it does not parse HTML, so
// button wiring after a redraw is checked in the browser (Task 8).
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../js/workplan-admin-core.js');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

// One stand-in element per selector; a redraw (host.innerHTML) starts fresh ones.
function fakeEl() {
  const on = {};
  return {
    value: '', disabled: false, hidden: false, checked: false, innerHTML: '', dataset: {},
    addEventListener(type, fn) { (on[type] = on[type] || []).push(fn); },
    fire(type) {
      const ev = { target: this, currentTarget: this, preventDefault() {} };
      return Promise.all((on[type] || []).map(fn => fn(ev)));
    },
    closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  };
}
function fakeHost() {
  let html = '';
  let els = {};
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); els = {}; },
    querySelector(sel) { return els[sel] || (els[sel] = fakeEl()); },
    querySelectorAll() { return []; },
  };
}

function makeWP(rpc) {
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return Object.assign({}, core, {
    esc, icons() {}, signImages() {}, modal() {},
    head: (title, sub, actions) => '<h1>' + esc(title) + '</h1>' + (actions || ''),
    fail: (host, e) => { host.innerHTML = 'FAILED: ' + core.errorMessage(e); },
    rpc,
    loadLookups: async () => ({ projects: [], people: [], teams: [] }),
    openTaskForm() {}, openTask() {}, openMeeting() {},
    state: { taskId: null, meetingId: null }, views: {},
  });
}
function loadScreens(WP) {
  const win = { WorkPlanAdmin: WP, addEventListener() {}, alert() {}, switchView() {} };
  for (const f of ['js/workplan-admin-task.js', 'js/workplan-admin-meetings.js']) {
    new Function('window', fs.readFileSync(path.join(ROOT, f), 'utf8'))(win);
  }
  return WP.views;
}
const meetingDoc = (id, title, notes) => ({ id, title, held_on: '2026-10-12', original_notes: notes || '',
                                            current_version: 0, versions: [], tasks: [] });
const taskDoc = (id, title) => ({ id, title, project_name: 'ZZ project', work_name: 'Main Contract', status: 'not_started',
                                  version: 1, acks: [], blockers: [], waiting_for: [], photos: [], history: [], office_flags: [], helpers: [] });

// Type notes, press "Draft tasks with AI", let the save finish, type more
// while the AI is still working, then let the AI answer.
async function typeWhileAiDrafts(outcome) {
  let serverNotes = '';
  const saves = [];
  const WP = makeWP(async (name, args) => {
    if (name === 'wp_office_meeting') return meetingDoc('M', 'Monday meeting', serverNotes);
    if (name === 'wp_office_save_meeting') {
      const d = deferred();
      saves.push(d);
      await d.promise;
      serverNotes = args.p_original_notes;
      return { meeting_id: 'M' };
    }
    throw new Error('unexpected rpc ' + name);
  });
  const ai = deferred();
  WP.aiDraft = () => ai.promise;
  const views = loadScreens(WP);
  const host = fakeHost();
  WP.state.meetingId = 'M';
  await views.wpMeeting(host);
  const notes = host.querySelector('[data-notes]');
  notes.value = 'Wall prep Monday';
  await notes.fire('input');
  host.querySelector('[data-ai-run]').fire('click');
  await flush();
  ok(saves.length === 1, 'Draft tasks with AI saves the notes first');
  saves[0].resolve();
  await flush();
  ok(serverNotes === 'Wall prep Monday', 'the notes were saved before the AI answered');
  notes.value = 'Wall prep Monday. Electrical Tuesday';   // typed after Save finished, before the AI answers
  await notes.fire('input');
  if (outcome === 'success') ai.resolve({ tasks: [], shared_notes: '' });
  else ai.reject(new Error('AI_FAILED'));
  await flush();
  return host;
}

(async () => {
  console.log('\nworkplan screens: edits typed during AI drafting');

  await test('notes typed after Save, before the AI answers, survive an AI success', async () => {
    const host = await typeWhileAiDrafts('success');
    ok(host.innerHTML.includes('Wall prep Monday. Electrical Tuesday'), 'the newer notes are back on screen after the redraw');
    ok(host.innerHTML.includes('The AI found no tasks in these notes.'), 'the AI result is shown');
  });

  await test('notes typed after Save, before the AI answers, survive an AI failure', async () => {
    const host = await typeWhileAiDrafts('failure');
    ok(host.innerHTML.includes('Wall prep Monday. Electrical Tuesday'), 'the newer notes are back on screen after the redraw');
    ok(host.innerHTML.includes(core.ERRORS.AI_FAILED), 'the failure is shown');
  });

  console.log('\nworkplan screens: a late, older load never draws');

  async function switchAtoB(view, rpcName, key, doc, failA) {
    const loads = {};
    const WP = makeWP((name, args) => {
      if (name === rpcName) { const d = deferred(); loads[args[key]] = d; return d.promise; }
      return Promise.reject(new Error('unexpected rpc ' + name));
    });
    const views = loadScreens(WP);
    const host = fakeHost();
    const field = view === 'wpMeeting' ? 'meetingId' : 'taskId';
    WP.state[field] = 'A';
    const pA = views[view](host);
    WP.state[field] = 'B';
    const pB = views[view](host);
    await flush();
    loads.B.resolve(doc('B', 'Screen B'));
    await pB;
    await flush();
    ok(host.innerHTML.includes('Screen B'), 'B is drawn');
    if (failA) loads.A.reject(new Error('NOT_FOUND')); else loads.A.resolve(doc('A', 'Screen A'));
    await pA;
    await flush();
    ok(host.innerHTML.includes('Screen B'), 'B is still on screen');
    ok(!host.innerHTML.includes('Screen A') && !host.innerHTML.includes('FAILED'), 'nothing from A was drawn');
  }

  await test('meetings: open A, switch to B, A answers last → B stays', () =>
    switchAtoB('wpMeeting', 'wp_office_meeting', 'p_meeting', meetingDoc, false));
  await test('meetings: open A, switch to B, A fails last → B stays, no error drawn', () =>
    switchAtoB('wpMeeting', 'wp_office_meeting', 'p_meeting', meetingDoc, true));
  await test('tasks: open A, switch to B, A answers last → B stays', () =>
    switchAtoB('wpTask', 'wp_office_task', 'p_task', taskDoc, false));
  await test('tasks: open A, switch to B, A fails last → B stays, no error drawn', () =>
    switchAtoB('wpTask', 'wp_office_task', 'p_task', taskDoc, true));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
```

In `package.json`, append ` && node tests/workplan-screens.test.js` to the end of the `"test"` script string.

- [ ] **Step 3: Check syntax and the guards**

Run: `node --check js/workplan-admin-meetings.js` → no output. Run: `node tests/workplan-screens.test.js` → all pass. Run: `node tests/workplan-admin.test.js` → all pass. Run: `npm test` → green.

- [ ] **Step 4: Stop — no commit.** Report to the controller.

---

### Task 8: Apply, deploy, combined browser check, verification record (controller + user)

No implementer.

- [ ] **Step 1: Final local checks (controller)**

Run `npm test` and `node --check` on every changed JS file (`js/workplan-admin-*.js`, `js/requests-admin-core.js`, `js/ai-summary.js`, `js/admin.js`) and `node --input-type=module --check < cloudflare-worker/worker.js`. Record the actual output (suite names and pass counts) in the verification record.

- [ ] **Step 2: Dry runs (user), then apply (user)**

First, the live account check (controller, MCP):

```sql
select role, coalesce(status, '(null)') as status, count(*) from profiles where role in ('owner', 'staff') group by 1, 2 order by 1, 2;
```

Expected as on 13 October 2026: `owner / active / 2`, `staff / active / 1`, nothing else. Any owner or staff account that is not active loses Requests, Item History and Work Plan the moment 0094 is applied — stop and ask the user before applying.

If code changed since the Task 1/3 dry runs, rebuild and re-run `0094_dry_run.sql`, `0094_office_dry_run.sql` and `0095_dry_run.sql`, and the MCP `0086_verify` / `1a` / `1b` / `1c` regressions with 0094 → all pass. Then the user runs, in order, `supabase/migrations/0094_workmate_work_plan_office.sql` and `supabase/migrations/0095_ai_request_gate.sql` alone → "Success. No rows returned".

- [ ] **Step 3: Verify live (controller, MCP `execute_sql`)**

```sql
select to_regprocedure('public.wp_my_proposals()') is not null as proposals,
       to_regprocedure('public.ai_authorize(text, integer)') is not null as gate,
       to_regclass('public.ai_requests') is not null as gate_table,
       (select relrowsecurity from pg_class where oid = 'public.ai_requests'::regclass) as gate_rls,
       not has_function_privilege('anon', 'public.ai_authorize(text, integer)', 'execute') as gate_anon_refused,
       not has_table_privilege('authenticated', 'public.ai_requests', 'select') as gate_table_closed,
       pg_get_functiondef('public.pr_is_office()'::regprocedure) like '%status%' as office_active_only,
       not has_function_privilege('authenticated', 'public.pr_is_office()', 'execute') as office_check_private,
       pg_get_functiondef('public.wp_office_save_task(uuid, jsonb)'::regprocedure) like '%minor_text_only%' as auto_versions;
```

All `true`. Then through MCP, each ending in its pass row:
- `supabase/tests/1c2_acceptance.sql`, `supabase/tests/1c2_ai_gate.sql`;
- `supabase/tests/1c2_office_active.sql` → `1c2 office check: all passed (42 callable, 1 internal)`;
- `supabase/tests/0086_verify.sql` and `supabase/tests/1a_acceptance.sql` (Requests), `supabase/tests/1b_acceptance.sql` (Item History) — the live office check is now active-only;
- the 1c-1 regression `supabase/tests/1c_acceptance.sql` (it saves with `important`, which 0094 still honours).

Then the user runs `node supabase/tests/1c2_ai_gate_concurrency.mjs` (setup as for `1c_concurrency.mjs`; clear `DACS_DB_URL` afterwards) → `4 of 4 checks passed` (G0 cleanup + G1–G3) and the line `Removed exactly these recorded rows: …`. The controller independently confirms through MCP that none of those ids exists any more (`select count(*) from ai_requests where id in (<the listed ids>)` → 0) and that the results file `.superpowers/1c2_ai_gate_results.json` lists the same ids. Record the output (without the connection string).

- [ ] **Step 4: Deploy the worker (user)**

In `cloudflare-worker`: `npx wrangler --version` (≥ 4.36), `npx wrangler ai models --json | findstr "llama-3.3-70b-instruct-fp8-fast"` (listed — if not, stop and re-plan the model), `npx wrangler deploy`.

- [ ] **Step 5: Deployed AI service checks (controller guides, user runs in PowerShell)**

1. No session: `curl.exe -s -X POST https://dacs-ai.dacsbuilding.workers.dev -H "Content-Type: application/json" -d "{\"feature\":\"work_plan_draft\",\"messages\":[{\"role\":\"user\",\"content\":\"x\"}]}"` → `AI_NOT_SIGNED_IN`.
2. A made-up token (`-H "Authorization: Bearer abc.def.ghi"`) → `AI_NOT_SIGNED_IN` (Supabase rejects it; no AI ran).
3. Too large: a body over 64 KB with the made-up token → `AI_TOO_LARGE`.
4. Signed-in limits and roles are proven by `1c2_ai_gate.sql`; in the browser (Step 6) the owner's summary and a staff draft must work, and a burst of 11 drafts by one account must show the limit sentence on the 11th.

- [ ] **Step 6: Combined browser check — `admin.html` served locally (127.0.0.1:5501), owner account unless stated**

Record each result (pass/fail, notes) in the verification record.

1. **Manual task without AI:** Work Plan → Board → **New task** → Barlin Residence, Main Contract, a team, responsible, one helper, title, planned days → **Save as draft** → under *Drafts and proposals*. Open → **Edit** (instructions) → Save → **Publish** → *Not started and in progress*; People shows "Has not read version 1".
2. **AI suggestions:** Meetings → **New meeting** → paste test notes in Taglish naming Barlin Residence, W-0007, an Additional Works name that does not exist, and a name shared by two workers (if none exists, a name not in the list) → **Save meeting** → **Draft tasks with AI**. Each unmatched field shows **Needs your choice**; **Save as draft** is refused with the NEEDS_CHOICE sentence until chosen; an unknown AW never shows Main Contract pre-selected.
3. **Unsaved edits survive:** type in Original notes (do not save) and in Shared notes, choose **Choose people** + tick W-0007 → **Add task by hand** and save a task → all edits still there; **Save notes** → shared notes and recipients still there. **Typing during a save:** DevTools → Network → *Slow 3G*, click **Save notes** and keep typing in Original notes before it finishes → the extra words are still there afterwards (and saved by the next Save notes); the same in Shared notes while a publish runs. **Typing while the AI drafts:** *Slow 3G*, **Draft tasks with AI**, wait until the notes are saved (the button area says it is drafting), then type more in Original notes → after the AI answers, the extra words are still there; repeat with *Offline* after the save so the AI fails → the extra words are still there. **Failed AI:** with suggestions on screen, go *Offline* and **Draft again** → error sentence, notes and earlier suggestions still there; back online, **Review and add…** and **Use as shared notes** still work. **Use as shared notes** over typed text asks before replacing. Then **Publish…** → *Published versions* shows "To: W-0007's name".
3b. **Switching quickly:** *Slow 3G*; open meeting A from Meetings and at once go back and open meeting B → B stays on screen when A's answer arrives; the same with two tasks from the Board.
4. **Revision:** on the published task from 1, **Edit** → fix one letter in the title → form says a new version is needed, tick "Only a spelling correction" → Save → version unchanged, history "Edited — Minor spelling correction". **Edit** → change the planned end → form says "Changed: planned dates" (no minor option) → Save → version +1, People "Has not read version 2", history "Revised — … — Changed: planned dates".
5. **Older dependency:** controlled fixture via MCP — a published "ZZ 1c2 browser older" task in Barlin set to `completed`, `completed_at = now() - interval '40 days'`, linked from a "ZZ 1c2 browser" task. In the browser, **Edit** that task → the link shows ticked "(completed earlier)" → change the instructions → Save → link still present (MCP check `wp_dependencies`). **Edit** → untick → Save → link gone.
6. **Decisions:** on fixtures (phone screens are not built): **Cancel task** without reason → reason sentence; with reason → leaves Board. Via MCP, give a fixture task a blocker and a `reported_done` state as in `1c_acceptance.sql`; in the browser **Clear…** needs a note; **Send back** needs a reason; **Approve** → Completed; **Reopen** needs a reason. A proposal made via MCP as W-0021 shows "Proposal"; **Decline** with a reason → gone from Board, and (MCP, as W-0021) `wp_my_proposals()` shows `declined` + the reason.
7. **Staff account:** Work Plan visible and works; no amounts anywhere in it; AI drafting works for staff; the Project Control AI summary button stays hidden for staff.
8. **PM-only account (`admin-pm@`):** no Work Plan section; typing a Work Plan view is blocked. Temporarily grant `["pm","workplan"]` (MCP update, restored after) → Board, Meetings, one meeting and one task all open.
9. **Regression:** Requests queue → open a request → a popup action shows its usual Requests error sentences (shared modal change); Item History search and one item open, as owner and as staff; Project Control **AI budget summary** works for the owner. (Requests and Item History database behaviour under the active-only office check is proven by Step 3, not by these screens.)
10. **AI failure and limits:** with the worker reachable, the limit sentence appears once 10 drafts fall inside 10 minutes (earlier drafts in the session, including failed ones, count); manual **Add task by hand** still works.
11. **Clean-up:** cancel every "ZZ 1c2 browser" and test task with reason "test" (history stays); remove the temporary module grant; MCP check that no "ZZ 1c2" fixture remains live.

Phone acknowledgement, offline sync, My Work and My proposals screens are **not** verified here — they are Stage 1c-3 / 1c-4. An inactive office account is proven refused by the database (Step 3); its browser behaviour is not separately tested.

- [ ] **Step 7: Verification record and close-out**

Create `docs/superpowers/specs/2026-10-13-workmate-stage1c2-verification-record.md` (environment, date, the dry-run / acceptance / MCP results, `npm test` output, each browser step's result, failures and fixes, deferred checks). Append "Execution notes" to this plan. Update memory `workmate-stage1c-my-work.md` and its `MEMORY.md` line. Tell the user to commit and push.

**Deployment order and dependencies:** (1) 0094 — independent, backward compatible (`important` still honoured); (2) 0095 — must precede the worker; (3) worker deploy — after 0095, needs Wrangler ≥ 4.36; (4) commit + push the web files (Vercel) — the new `ai-summary.js` needs the new worker, and the old `ai-summary.js` stops working once the new worker is live, so push right after the deploy and the browser check. The Work Plan screens need 0093 + 0094 live; AI drafting needs 0095 + the worker.

---

## Execution notes (14 October 2026)

- **How it was built:** Tasks 1–7 were built by subagents and reviewed after each task, followed by a final whole-branch review. **Verification:** [2026-10-13-workmate-stage1c2-verification-record.md](../specs/2026-10-13-workmate-stage1c2-verification-record.md).
- **Changes from this plan:**
  - A third AI feature, `health_briefing` (`js/ai-assistant.js`).
  - The final-review fixes: cache tags; `answerText` handling an object answer, with a minimum `max_tokens`; publish sending the shown draft ids; the drafting guard; the `personHits` name/number conflict.
  - Browser-check tweaks: the "Task title" label and the Board group count.
  - The code blocks above were re-synced to the files on disk.
- **Deploy:**
  - 0094 applied on 13 Oct and 0095 on 14 Oct.
  - The worker was deployed from the Cloudflare account that owns `dacsbuilding.workers.dev` (`tjohnaerol@gmail.com`). The first Wrangler login was a different account; `wrangler deployments list` caught it before anything was deployed.
- **Deferred to 1c-3:** Step 6 items 5–6 (they need phone reports). Items 3's network sub-checks, 3b and 10 were not run; see the record §6.
