# WorkMate Stage 1c-1 — verification record

Terms: [2026-10-12-workmate-stage1c1-verification-mvp-terms.md](2026-10-12-workmate-stage1c1-verification-mvp-terms.md)
Environment: Supabase project `hqbgduyonlbbsvjuapre` (DaCs_Company, **production**), migration 0093 applied 2026-10-12 ~16:34 Manila.

Status: **Complete (12 October 2026).** §1, §2 and §3 (server) passed; temporary data removed and independently confirmed. Phone-side checks are explicitly **not yet tested** (1c-3/1c-4).

## §1 Existing features (1a / 1b)

| Check | When (Manila) | Script | How run | Result |
|---|---|---|---|---|
| 1a acceptance — Requests | 2026-10-12 ~16:52 | `supabase/tests/1a_acceptance.sql` (md5 `a2187ac9017c9037c34816a9880a49f0`), comment lines removed, SQL unchanged | Supabase MCP `execute_sql` (uses a temp table, which the SQL editor breaks) | ✅ `1a acceptance: all checks passed` |
| 1b acceptance — Item History | 2026-10-12 ~16:53 | `supabase/tests/1b_acceptance.sql` (md5 `cefaa31810e7cd3aa43568dccb16891c`), comment lines removed, SQL unchanged | Supabase MCP `execute_sql` | ✅ `1b acceptance: all checks passed` |
| Leftovers after both | 2026-10-12 16:54 | read-only query | MCP | ✅ 0 ZZ folders, teams, items, fixed-op requests, references, test request photos, wp tasks |

Both scripts are self-rolling-back. No failure, no retry.

## §3 Server acknowledgement and inactive-account rules

| Check | Evidence | Result |
|---|---|---|
| Read before Start; outdated read answered as stale | `supabase/tests/1c_acceptance.sql` steps 2, 5, 12 (dry run, user, SQL editor, before apply) | ✅ passed |
| Inactive accounts | `supabase/tests/1c_inactive_account.sql` (md5 `888b8ab9da30c868544f0e3d8d0d6db9`, 276 lines), reviewed and strengthened before running; run by the user in the SQL editor 2026-10-12 ~17:00 | ✅ `1c inactive-account checks: all passed` |
| Restoration after the inactive test | Separate query 2026-10-12 17:00:43 Manila | ✅ W-0007, W-0019, W-0021 all `active`; 0 `ZZ 1c inactive` folders/teams/tasks; 0 `wp_tasks`; 0 `task-photos` objects |

What the inactive-account test proves (inside one transaction that ends in rollback; W-0019 and W-0021 inactive only inside it):
- An inactive worker is refused every My Work read and action (`NOT_A_REQUESTER`), and the **storage rule** refuses their own photo and any new upload; an inactive leader loses the team view, the leader check, proposals and the team photo.
- An active helper is unaffected; a helper who neither uploaded nor is responsible cannot read the photo.
- The office still sees the unfinished task (status, blocker, acknowledgement history) and the photo; it cannot keep the inactive person (`BAD_PERSON`) and can reassign.
- Reassigning as an **important revision** raises the version: the new responsible person's helper-time acknowledgement no longer counts (`NOT_ACKNOWLEDGED`; re-sending the old version → stale) until they read the new version; then Start works and they can read the task photo.
- The removed person stays in the task history.

**Not yet tested (phone, 1c-3/1c-4):** actual photo downloads in the app; what a deactivated phone keeps offline (it keeps what it already saved until the app clears it); queued offline actions; showing revised instructions.

## §2 Simultaneous use

Method: two real database connections (plus an observer) from the user's PC against production — `supabase/tests/1c_concurrency.mjs` (md5 `0f18e5d8e333d85ab14590705ea36639`), reviewed before running. Option A (Supabase branch) was checked and rejected: Supabase's migration history lists only 6 of 93 migrations (most were applied in the SQL editor), so a branch would not match production.

Safety as run: only throwaway rows with exact pre-generated ids (ledger written before creation), names prefixed "ZZ 1c conc"; no storage file committed (Supabase blocks direct deletes of `storage.objects`, so the photo upload lived only inside a rolled-back connection); limits 20 s/statement, 10 s/lock wait, 60 s idle-in-transaction, 120 s whole run; TLS verified against the Supabase CA; the connection string read from an environment variable, never printed or saved by the script. Recovery: `--cleanup` (ledger) or `supabase/tests/1c_concurrency_cleanup.sql` (prefix) — the recovery SQL was run once beforehand by the user and returned all zeros (clean baseline).

Run: user, 2026-10-12 ~17:23 Manila. Result: **7 of 7 scenarios passed** (saved results: `.superpowers/1c_concurrency_results.json`, git-ignored).

| Scenario | Two sessions' actions | Result / final state |
|---|---|---|
| S1 | A saves A1→B1 (open); B saves B1→A1 | B **waited**, then `DEPENDENCY_CYCLE`; only A1→B1 saved ✅ |
| S2a | A links C2a→D2a (open); B cancels D2a | B **waited**, then `HAS_DEPENDENTS`; D2a still a draft, link kept ✅ |
| S2b | B cancels D2b (open); A links C2b→D2b | A **waited**, then `BAD_DEPENDENCY`; D2b cancelled, nothing links to it ✅ |
| S3a | Worker attaches a photo to a blocker (open); office clears it | office **did not wait**, both succeeded; blocker cleared; no storage row left ✅ |
| S3b | Office clears a blocker (open); worker attaches a photo to it | worker **did not wait**, both succeeded; blocker cleared; no storage row left ✅ |
| S4 | A publishes [X4, Y4] (open); B publishes [Y4, X4] | B **waited**, then published nothing again; each task published once at version 1 ✅ |
| S5 | A links G5→M5 (open); B moves draft M5 to project 2 | B **waited**, then `BAD_DEPENDENCY`; M5 stays in project 1 ✅ |

No deadlock (40P01), lock timeout (55P03) or statement timeout (57014) in any scenario. Every conflict was either a wait followed by a named error code, or no conflict at all; nothing half-saved.

Cleanup: the script's own leftover check — `{"folders":0,"teams":0,"tasks":0,"blockers":0,"links":0,"photos":0}`, ledger removed. Independent check (MCP, 2026-10-12 17:24:34 Manila): 0 "ZZ 1c conc" folders/teams; 0 rows in `wp_tasks`, `wp_blockers`, `wp_dependencies`, `wp_events`, `wp_ops`; 0 `task-photos` objects; 0 open test connections.

**Follow-up (security):** while running the test the user's database password appeared in the chat transcript (pasted terminal output). Action: reset the database password in Supabase (nothing in the repo uses it; apps use API keys) and clear the terminal. **Done — the user confirmed the password was reset (2026-10-13).**

## Open decisions (for the user)

- How a team leader sees the status of their own proposal (sent / published / declined) — not visible to them today (proposals are drafts; worker history hides "proposed").
- Definition used for "clear, recoverable conflict" in §2: both finish, or one gets a named error code; nothing half-saved; no deadlock error (40P01) and no wait past the time limit.
