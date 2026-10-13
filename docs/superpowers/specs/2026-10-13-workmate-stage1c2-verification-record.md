# WorkMate Stage 1c-2 — verification record

Plan: [2026-10-13-workmate-stage1c2-work-plan-office.md](../plans/2026-10-13-workmate-stage1c2-work-plan-office.md) (rev 5)
Terms: [2026-10-13-workmate-stage1c2-work-plan-office-mvp-terms.md](2026-10-13-workmate-stage1c2-work-plan-office-mvp-terms.md)
Environment: Supabase project `hqbgduyonlbbsvjuapre` (DaCs_Company, **production**); Cloudflare worker `dacs-ai` on account `tjohnaerol@gmail.com` (subdomain `dacsbuilding.workers.dev`); browser checks on `admin.html` served locally (127.0.0.1:5501).

Status: **Live and browser-checked (14 October 2026, ~01:30–02:55 Manila).** Two checks are deferred to 1c-3 (they need a worker reporting from the phone), and three optional network checks were not run; see §6.

## §1 Local checks (Task 8 Step 1)

- `node --check` on every changed JS file plus `node --input-type=module --check < cloudflare-worker/worker.js` returned clean.
- `npm test` exited 0: 28 suites, 0 failed (money-math 239, workplan-admin 31, workmate-office-server 14, ai-worker 14, workplan-screens 6, workmate-workplan 41, all others unchanged).
- The final whole-branch review (opus) found no Critical issues. Five small fixes were applied before going live: stale cache tags; worker `answerText` handling an object answer; publishing only the shown drafts; a guard against drafting twice; and the W-number vs name conflict. A browser-check round then added: the "Task title" label and the Board group count.

## §2 Migrations

| Step | When (Manila) | How | Result |
|---|---|---|---|
| 0094 dry run + office dry run | 2026-10-13 | user, SQL editor | ✅ `1c2 acceptance: all checks passed`; `1c2 office check: all passed (42 callable, 1 internal)` |
| 0094 applied | 2026-10-13 ~15:46 | user, SQL editor | ✅ Success |
| Regressions after 0094 | 2026-10-13 | MCP `execute_sql` | ✅ `0086_verify`, 1a, 1b, 1c, `1c2_acceptance`, `1c2_office_active` all passed |
| Account check before 0095 | 2026-10-14 ~01:33 | MCP (read-only) | ✅ owner/active 2, staff/active 1 |
| 0095 dry run (`Downloads/0095_dry_run.sql`) | 2026-10-14 01:32 | user, SQL editor | ✅ `1c2 AI gate: all checks passed`; MCP confirmed nothing was left behind |
| 0095 applied | 2026-10-14 ~01:35 | user, SQL editor | ✅ |
| Live verify query (Task 8 Step 3) | 2026-10-14 | MCP (read-only) | ✅ all 11 checks true (gate, table, RLS, anon refused, signed-in allowed, table closed to clients, `health_briefing` present, office active-only, office check private, auto versions); `ai_requests` empty |
| `1c2_ai_gate.sql` against live | — | MCP run declined by the user at the permission prompt; not retried | The dry run had already passed the identical checks against the identical function |
| `1c2_ai_gate_concurrency.mjs` (two connections) | — | **not run** | pending (optional; user's PC with `DACS_DB_URL`) |

## §3 Worker deploy (Task 8 Steps 4–5)

- Wrangler 4.150.0. The first login was the wrong Cloudflare account: `dacsapplication@gmail.com`, subdomain `dacscompany.workers.dev`, where `deployments list` returned "does not exist" (10007). It was caught before deploying. A re-login with `--browser=false` as `tjohnaerol@gmail.com` showed the June deployment history of `dacs-ai`.
- The model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` is listed.
- `npx wrangler deploy` at 2026-10-14 ~01:55 created version `2879dfb1-727d-48f7-ad75-9645e2d756ba`. Bindings: `env.AI`, `env.PREAUTH_LIMITER` (30/60 s), `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

Checks run with curl:

| Check | Result |
|---|---|
| Request with no session | ✅ `AI_NOT_SIGNED_IN` |
| Made-up bearer token | ✅ `AI_NOT_SIGNED_IN` (no AI ran) |
| 70 KB body | ✅ `AI_TOO_LARGE` |
| CORS preflight from `https://dacs-company.vercel.app` | ✅ allowed, including the `Authorization` header |

## §4 Browser checks (Task 8 Step 6)

| # | Check | Result |
|---|---|---|
| 1 | Manual task → draft → edit → publish | ✅ Not started, version 1, "Has not read version 1"; history Drafted / Edited / Published |
| 2 | AI suggestions (Taglish notes) | ✅ W-0007 matched exactly. "John Tapales" (two workers) flagged "matches 2 names — choose one". "Kuya Ben" not recognised. The tiles item flagged for no person and no work. Save refused with NEEDS_CHOICE until a choice was made; after choosing W-0005 it saved and showed "Added as draft". Note: "Additional Works – Gazebo" was mapped by the AI to the only real AW, "Barlin Additional Works" — not Main Contract, but with no flag. |
| 3 | Unsaved edits survive | ✅ an unsaved notes line, shared notes and a Choose-people tick all survived an "Add task by hand" save. Publish: v1 went to John Tapales (W-0007), and an accidental second publish (v2) went to everyone assigned. Both drafts were published (MCP-confirmed). |
| 4 | Revisions | ✅ A spelling fix with "Only a spelling correction" ticked kept the version ("Edited — Minor spelling correction"). Wording changes without the tick and a planned-end change each raised the version ("Changed: instructions" / "Changed: planned dates"). Three early saves were unticked by mistake (the box sits below the fold). |
| 7 | Staff account | ✅ Work Plan visible, no amounts, no AI summary button in Project Control. Staff AI drafting works; the Draft button is disabled while a draft runs. |
| 8 | PM-only account (`admin-pm@`) | ✅ only Project Management in the menu; `switchView('wpBoard')` from the console was blocked |
| 9 | Regressions | ✅ Owner AI budget summary works (×3). Health briefing works when called from the console (see §6). Requests "Cancel item" with an empty reason shows Requests' own sentence. Item History search works. |
| 11 | Clean-up | ✅ all 3 test tasks were cancelled with reason "test" (MCP-confirmed); 0 active `wp_tasks` company-wide. The meeting "ZZ 1c2 browser meeting." remains (meetings are not deleted; history is kept). |

AI log after the checks (MCP): `budget_summary` owner 3, `health_briefing` owner 1, `work_plan_draft` owner 1 + staff 1. No text is stored.

## §5 Rulings made during execution

See the controller ledger. The main ones:
- **Office-function count.** 43 functions use the office check: 42 callable plus 1 internal.
- **`health_briefing` added as a third AI feature.** `js/ai-assistant.js` was a third AI caller.
- **Narrow `.gitignore` rule.** Only `supabase/tests/*.mjs` is now tracked.
- **Deploy order.** Apply 0095 *before* the worker deploy, as the plan says. An earlier controller note said the opposite and was corrected.
- **Final-review fixes.** The five listed in §1.
- **Two items dropped.**
  - The trimmed-instructions mismatch: both sides compare the same pair, so it cannot occur.
  - The `required` attribute on reason boxes: it would hide the server's sentence.

## §6 Not tested / follow-ups

**Deferred to 1c-3 (need phone screens):**
- Step 5, an older dependency (a link to a task completed more than 30 days ago).
- Step 6, approve / send back / clear a problem / reopen / decline a proposal.

Both need a worker's report or live fixtures. The server side is covered by `1c_acceptance.sql` and `1c2_acceptance.sql`.

**Not run (optional), with what covers each instead:**

| Check | Covered by |
|---|---|
| Slow 3G / offline typing during save and AI | the `tests/workplan-screens.test.js` mutation tests |
| Quick switching between meetings (3b) | same as above |
| The 11-drafts burst limit (10) | the 0095 dry run (4a/4b) |
| The two-connection gate test | not covered elsewhere (listed in §2 as pending) |

**Follow-ups:**
- **The AI Health Assistant has no button.** Pre-existing: the "Needs attention… View details →" banner is in an unreachable branch of `portal-app.compiled.js` (line ~907) since the folder-selector redesign. Re-add it or retire the feature.
- **Deactivated office accounts.** The role-only storage helpers (`pr_office_gallery_path_ok`, `wp_office_task_path_ok`) and the 0085 direct-read policies still don't require an active account.
- **Revision box placement.** The spelling-correction box is easy to miss below the fold.
- **NEEDS_CHOICE message.** It should name the blocking field, and the error should clear when a field changes.
- **AI work matching.** Flag when the AI's work differs from the notes' wording (the "Gazebo" case).
- **Revision history wording.** It says "instructions" for a title-only change (server text, 0094).
- **Deferred minors.** Approve offered while blocked, recipients not pre-filled on re-publish, linked purchase request not shown on a problem, and the others in the ledger.
- **Accepted risk.** A signed-in owner or staff member can send any prompt under a feature label, bounded by the per-person and per-company limits.
- **Retired Groq secret.** The old worker's `GROQ_API_KEY` secret (if still set) is unused and can be deleted from the Cloudflare dashboard.
