# WorkMate Stage 3b-a: tools on the phone (server side), the Team Leader switch, temporary passwords — tested plan

**Status (5 Nov 2026):** Revision 2. **Task 1 is done: the patch is in the working tree, not committed, and waiting for your review.** Nothing else has happened: `0111` isn't applied, the function isn't deployed, nothing is pushed, and no role or password has changed. Each later task waits for your go-ahead, and T0 has its own approval.

**Goal:** the server and Dacs Web work behind tools on the phone, plus the Team Leader switch and the temporary password. **It doesn't reach the crew.** The phone screens are 3b-b. Messenger stays official until the owner approves the switch-over date.

**Spec:** the 3b-a scope with the owner's answers of 4 November; the [Stage 3 Tools sheet](../specs/2026-10-28-workmate-stage3-tools-questions.md); the 3b/0E plan, revision 9.

**Repo:** Dacs Web. The base is `main` at `4b3c832`.

## Global constraints
- No money. Nothing reads or writes a peso, an expense, payroll or Spent.
- `npm run build` is never run. The next migration number is `0111`.
- The user commits and pushes. No delete on live through tools.
- `min_app_version` stays 0, and the old Attendance app gets no update. `attendance-signin` and the `profiles` columns don't change, because the old app relies on them.
- No role change, password reset, account, team or tool on a real account or for a real tool comes from this work.
- Labor contracts and payroll are not read. Linked Labor and the Buyer-switch finding stay separate.

---

## The owner's answers built in

| Answer | Where it is |
|---|---|
| Q1: enter the tool number and confirm its identity. Lookup limited to eligible tools in our company, with no unrelated custody or history | `tl_team_find` answers only for an Available tool of this company, with number, name and details. Unknown, held, under repair, retired or another company's: one refusal, `TOOL_NOT_AVAILABLE`. Only someone leading a team now can ask |
| Q2: photos stay out | A photo sent by a phone is ignored. The `tools/` folder stays office-only, so no new storage rule |
| Q2: request linking included, with the existing fill-once rules | `tl_team_issue` calls 0107's own `tl_issue`, so its fill-once rules run unchanged. A leader can link only lines they can already see: their own requests and their teams'. Any other line is `REQUEST_NEEDS_OFFICE` and records nothing |
| Q3: temporary password main owner only; authorizes no reset | The Edge Function refuses every other account. No real account is reset by this plan |
| Q2b: Team Leader switch, main owner only, with both fixes | `wk_set_team_leader`, and the fixes in `pr_office_teams` and `pr_office_set_leader` |

---

## What gets built

**Migration `0111_workmate_tools_phone.sql`:**
- **Tables:** `tl_problems`, `wk_role_events`, `wk_password_events`. Row security on, no policy, no password column. Reports can only be closed once, and the two logs are append-only.
- **A worker:** `tl_my_tools`, `tl_my_tool`, `tl_report_problem`.
- **A leader, now:** `tl_team_tools`, `tl_team_tool`, `tl_team_find`, `tl_team_choices`, `tl_team_request_lines`, `tl_team_my_records`, `tl_team_issue`, `tl_team_handover`, `tl_team_return`, `tl_team_reverse`.
- **The office:** `tl_problems`, `tl_close_problem`.
- **The main owner:** `wk_me`, `wk_set_team_leader`, `wk_worker_log`.
- **The worker's phone, for 3b-b:** `wk_password_state`, `wk_password_changed`.
- **Four functions redefined:** `tl_actor`, `profiles_guard`, `pr_office_teams`, `pr_office_set_leader`.

**How a leader's action works:** the server answers a retry first, with that person's own earlier answer. Then it checks that everyone involved is a current member of a team the caller leads now. Then it calls 0107's own function under the same operation id. So every existing tool rule applies without a second copy of it.

**Edge Function `admin-set-worker-password`:** main owner only; one active worker or team leader of this company. It records the attempt, changes the password, then records the result. It returns the password once, and never stores or logs it.

**Dacs Web:**
- **Attendance → Workers:** "Make Team Leader" or "Remove Team Leader", and "Set temporary password", for the main owner only. "Leads a team on site" becomes "Can lead a team".
- **Requests → Teams:** a named leader without the role or with a switched-off account reads "No valid leader", says why, and counts in "need a leader". The office can clear a mark, including on a turned-off team.
- **Requests → Tools:** a Problems tab with a count, closed with a note.
- **Users → Edit:** worker accounts show the role locked, with a note saying where to change it.

---

## Files
- **New:** `supabase/migrations/0111_workmate_tools_phone.sql`, `supabase/functions/admin-set-worker-password/index.ts` and `password-core.mjs`, `supabase/tests/3b_tools_phone.pglite.mjs`, `3b_concurrency.mjs`, `3b_acceptance.sql`, `3b_rollback.sql`, `tests/worker-password.test.js`, `tests/workmate-3b-web.test.js`, this plan.
- **Changed:** `js/attendance-admin.js`, `js/requests-admin-setup.js`, `js/tools-admin.js`, `js/user-navigator.js`, `js/supabase-config.js`, `admin.html` (three version numbers and one note, with the owner's one-space edit kept out), `package.json`, `tests/tools-admin.test.js`, `supabase/tests/3a_tools.pglite.mjs`, `CLAUDE.md`, `docs/DATABASE_SCHEMA.md`, `docs/ARCHITECTURE.md`, `supabase/migrations/README.md`.
- **Not touched:** `supabase/functions/attendance-signin`, `js/portal-app.compiled.js`, the portal HTML files, the money code.

The full change is the patch `3b_a.patch`, sent with this plan.

---

## What was tested in scratch
Nothing here touched the live database.

| Check | Result |
|---|---|
| New server suite, real migrations on a local database (`3b_tools_phone`) | **45 of 45** |
| Two sessions at once on real PostgreSQL (`3b_concurrency`) | **9 of 9**, no deadlocks |
| The existing Tools suite with `0111` on top, so the office's rules didn't change | **48 of 48** |
| Temporary-password rules and source (`worker-password`) | **13 of 13** |
| Office screens, code and source (`workmate-3b-web`) | **15 of 15** |
| The real password function's code under Node, with a fake client | **29 of 29** |
| The real screens in real Chrome, with a fake server: Workers, Teams, Tools | **40 of 40**, and the Teams wording check 13 of 13 |
| The whole of `npm test`, on a clean copy | **passes**, 1,544 checks |
| The whole of `npm run test:sql`, on a clean copy | **passes**, 53 suites and 1,575 checks |
| Deliberate breaks | **71 of 71 caught.** The first run caught 67. The other 4 were gaps in my tests, not the code: two flags that only matter inside one transaction, and two breaks hidden by the guard's second layer. I tightened those tests, and the unchanged code still passes |
| The live functions this builds on (read-only) | **All match the files:** 32 tool, purchase and guard functions and 22 team and work functions. None of the new names is in use |
| Unsent attendance, with the server scripted | WorkMate's real queue **4 of 4**; the old app's real queue tests **13 of 13** and session tests **6 of 6** |

**On your real working tree (5 Nov, Task 1):**
- Every file the patch touches is byte-identical to the tested copy, apart from your one-space line in `admin.html`.
- `npm test` passes with 1,546 checks. The 2 more than the clean copy read APK files that exist only on your machine.
- `npm run test:sql` passes with 53 suites and 1,575 checks.
- Every changed JavaScript file passes `node --check`.

**Not tested yet, and why:**
- **The Edge Function on Supabase's own servers.** This machine has no Deno, so I ran its real code under Node with a fake client. Step T0 runs it for real.
- **The password reset on a real phone.** No phone is attached, and I hold no service key or test-account password. Step T0 does this.
- **The Users → Edit change in a browser.** It's covered by source checks only, so the acceptance step looks at it.

---

## The password reset and unsent attendance: what's known

| Question | Answer | How I know |
|---|---|---|
| Does an admin password change sign the worker out? | **Yes, from every session.** | The source of your sign-in server's exact version, v2.197.0: `adminUserUpdate` calls `UpdatePassword(tx, nil)`, which calls `Logout`. Not yet seen on a real phone |
| Does a phone stop at once? | **Probably not.** Its current access can keep working until it expires, about an hour at most; then it can't renew. | How sign-in tokens work. Not yet seen on a real phone |
| WorkMate: does an unsent Time In survive? | **Yes.** The record and its photo stay, nothing sends while signed out, another worker signing in never sends it, and the same worker's next sign-in sends it once, in order. | Real `SubmissionSync` and `AttendanceDb`, 4 of 4 scenarios, with the server scripted |
| Old app: does it survive? | **It should.** Nothing on sign-out clears the queue, a session-expired answer retries, and it sends only that worker's rows. A 15-minute sweep sends after the next sign-in. | Its real `SubmissionQueueTest` 13 of 13 and `SessionGateTest` 6 of 6, plus reading the code. The whole path hasn't been run on a phone |

---

## Task T0: test the reset on a test phone, with its own approval

**This is a separate approval.** Approving Tasks 1 to 3 doesn't approve T0. I ask for it only after those tasks are done and the readiness check below is complete, and nothing is reset before you answer. The request covers **one reset, of W-0007** (one of your own test accounts). No real worker is involved.

**It has to be a genuine working day, at a site where you're really working.** The attendance rows T0 adds to W-0007 stay, so each one must be true: the real site, your real start, and a Time Out when you really finish. If there's no such day, T0 waits.

You do the phone steps, and I read the server.

### Readiness check: it resets nothing and records nothing

| Step | Who | What | Ready when |
|---|---|---|---|
| R1 | You | Name the working day and the site | You'll really be working there. W-0007 has no Time In yet that day, because a worker gets one a day |
| R2 | You | On the test phone, with signal: check the version under Android Settings → Apps → DAC'S WorkMate, because the app doesn't show it. Check Profile shows W-0007. Location on, camera allowed, automatic date and time on | Version 0.9.0 or newer. Today's minimum is build 1011, and an older build's Time In is refused and waits on the phone |
| R3 | You | Still with signal, start Time In, check the site is on the list, then go back before taking the photo. Nothing is recorded until the last step | The site is listed. Offline, the app offers only the list it last saved |
| R4 | You | Say which phones have the old app, DACs Attendance, signed in as W-0007, and whether any other account has used either app on the test phone | Every phone is named and is yours. If someone else uses one, T0 waits. If another of your test accounts used the phone, tell me: its records can't be seen from W-0007's screens |
| R5 | You | List the unsent records on each of those phones, from the table below | Each place reads "nothing waiting", or each item is listed with its date |
| R6 | You | Have a second device with signal at the site, where you can sign in as the main owner | It opens Attendance → Workers. The test phone is in airplane mode for T0.3 |
| R7 | Me | Read W-0007's sessions and attendance, that the chosen site is on and not hidden, the version minimums and the attendance baseline | Written down for T0.1 |
| R8 | Me | Send you the T0 request: the day, site, phones, unsent list and baseline | You answer. T0.1 starts only on your yes |

**If anything is waiting:** no reset. Keep the phone on signal so it can send, and I read the server to confirm it arrived once. If it doesn't arrive, T0 waits until that's understood. Nothing is ever cleared from a phone to get past this check.

**Where to look.** Each screen shows only the signed-in worker's records.

| App | Where | What it shows |
|---|---|---|
| WorkMate | Home, today's card | "Not sent yet", for today |
| WorkMate | Home, at the top | "Your Time In on … was not accepted": the server refused it for good, so it isn't waiting, but list it |
| WorkMate | My attendance → Month | "Not sent yet" on this month's days only |
| WorkMate | Home, the Requests and My Work cards | "… waiting for signal", "… draft not sent" |
| WorkMate | The home-screen widget, if placed | "QUEUED · WILL UPLOAD", for any day |
| Old app | Dashboard | "Not sent yet", for today only |
| Old app | The home-screen widget, if placed | "QUEUED · WILL UPLOAD", for any day |

W-0007 has no Buyer switch, so WorkMate shouldn't hold any purchases for it. If a purchase shows as waiting, list it too.

**What the old app can't show:** its History screen shows nothing as unsent, so an earlier day's record appears only on the widget, and a refused record appears nowhere. On a phone with the old app, place its widget, leave the phone on signal for at least 20 minutes so its 15-minute sweep can run, then read it.

**What the server shows today (5 Nov, read-only):**
- W-0007 has **four sign-ins, and a reset ends all of them.** The old app's keeps refreshing, most recently on 4 Nov at 21:37, so it's on a phone that's switched on. WorkMate's last refreshed on 30 Oct at 11:10. The other two, from 22 and 28 Oct, never refreshed after signing in.
- W-0007 has 8 attendance rows. One has been open since 2 Oct. It doesn't block a new day's Time In, and I'm leaving it as it is.
- The new rows count in W-0007's weekly reward evaluation, like any attendance. Its 13 reward rows are all disqualified at ₱0, with five days required, so T0 can't qualify a week. Eligibility isn't touched.

### The test, after your yes

| Step | Who | What | Pass |
|---|---|---|---|
| T0.1 | Me | Read W-0007's sessions and attendance count again | Same as R7 |
| T0.2 | You | When you really start work at the site: airplane mode on, then Time In with a photo in WorkMate | Home shows "Not sent yet" |
| T0.3 | You | On the second device, on Attendance → Workers, set a temporary password for W-0007 | Password shown once. A wrong number was refused first |
| T0.4 | Me | Read the sessions and `wk_password_events` | Sessions 0; `requested` then `temporary_set`; no password anywhere |
| T0.5 | You | Airplane mode off, and open WorkMate | Write down what happens: does it send on its existing access, or ask you to sign in? |
| T0.6 | You | Sign in with the temporary password, if asked | Signed in, same worker |
| T0.7 | Me | Read W-0007's attendance | **Exactly one** new row, with the shutter time and photo |
| T0.8 | You | Sign out, try the old password, then sign in with the temporary one | Old password refused, temporary one works. The waiting record isn't sent again |
| T0.9 | You | Open the old app on any phone from R4 | Write down what happens: it should ask you to sign in and lose nothing. Don't sign in there yet |
| T0.10 | You | When you really finish work: Time Out in WorkMate | The same row is completed, so no record is left open |
| T0.11 | You | Change the password back in WorkMate's Profile, then sign in to the old app with it | Both sign in. "Must change" stays marked for W-0007 until WorkMate 1012, which is harmless |
| T0.12 | Me | Report the results and re-check the attendance baseline | The 68 unchanged, new rows listed |

**The old app's own unsent test is a further approval.** It needs a second genuine working day, because a worker gets one Time In a day, and a second reset. It repeats T0.2 to T0.10 in the old app, without T0.9. If the old app isn't on a phone, I record that this path stays untested.

**If a record is lost or sent twice:** stop. No live acceptance is proposed, and no temporary password is set for anyone else until that's understood.

---

## Tasks

**Task 1: apply to the real tree. Done 5 Nov, not committed.** `3b_a.patch` is in your working tree, and your one-space `admin.html` edit is still there, outside the patch. You review, then commit. Pushing comes after Task 2, so the live web never asks for functions that aren't there yet.

**Task 2: the migration (yours, when you say so).** You apply `0111` in the Supabase SQL editor. I verify it on live: the functions, grants and tables exist, the four redefined functions match, and no account changed. Nothing changes for anyone yet: no phone calls these functions, and the role and password buttons aren't on the live web until Task 3.

**Task 3: the function and the web (yours, when you say so).**
- Deploy `admin-set-worker-password` with both files, by you or through the Supabase tool on your OK.
- You commit and push the web. I confirm the live files match the commit and CI passes.
- You look at Attendance → Workers, Requests → Teams, Requests → Tools and Users → Edit while signed in as the main owner.

**Task 4: T0, with its own approval**, above.

**Task 5: propose live acceptance (a separate approval).** After T0 passes I'd propose:
- Running `3b_acceptance.sql` on live. It's wrapped in `begin` and `rollback`, so W-0005's role and every ZZ row vanish when it ends.
- A short ZZ check through the screens if you want one, with any real role change on W-0005 needing your approval then.

**Task 6: notes.** Execution notes in this plan and the 3b/0E plan.

**If something goes wrong:** run `supabase/tests/3b_rollback.sql`. It restores the four redefined functions exactly as they were, and deletes nothing. Any role already changed stays changed, and any password already set stays set. Revert the web commit.

---

## Found and not changed
- **The same Role dropdown fails for staff and engineer accounts** on Users → Edit. You approved the change for worker accounts only.
- **The Buyer switch's server check** is recorded as its own finding.
- **A worker can ignore "must change" in the old app,** which can't be updated. Only WorkMate will ask.
- **A leader's request links stop at what they can see.** A member's "Just me" request is private from their leader today, so the phone can't link it, and the office issues that tool on the web.

---

## Self-review against your conditions

| You asked for | Where |
|---|---|
| Enter the number and confirm identity; eligible tools in our company; no unrelated custody or history | `tl_team_find`; suite section C, including another company and every other state; break tests |
| Photos out | `tl_team_issue` passes none; suite section D |
| Request linking with existing fill-once rules, or refuse and direct to the office | Suite section F; `REQUEST_NEEDS_OFFICE`; race test 3 |
| Temporary password main owner only; no real reset | `password-core.mjs`; 29 runs of the real function; nothing in this plan resets a real account |
| Test reset effects and unsent attendance on a test account first | The table above; T0 comes before any acceptance proposal, and what hasn't run is stated |
| Build and test in scratch, then send for review | This plan |
| Task 1 only: apply, keep your `admin.html` edit, run the checks, stop before committing | Status line; Task 1 |
| No `0111`, deploy, push, role change or reset yet | Status line; Tasks 2 and 3 wait |
| T0 is a separate approval; confirm the phone and list its unsent records before requesting the reset | Task T0, the readiness check |
| T0 on a genuine working day and site, because its rows stay | Task T0; R1, T0.2 and T0.10 |
