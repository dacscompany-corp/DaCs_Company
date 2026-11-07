# WorkMate: tools on the phone (Stage 3b) and moving the crew (Stage 0E) — roadmap

Date: 4 November 2026

**Status:** Revision 13. **3b-a and 3b-b are done.** WorkMate **0.10.0 (1012)** passed its pilot on 7 Nov, and the owner published it at 16:27.
- **Nothing has reached the crew.** They stay on the old app and Messenger.
- **Attendance:** still 68 records, with none added or changed by this work. The photo baseline is still 86.
- **Answered:** Q1 to Q8 and Q11. **Pending:** who maintains teams (Q2), who installs (Q9) and additional worker accounts (Q10).
- **Where the details are:** the 3b-a plan, with its closeout, is `2026-11-04-workmate-stage3b-a-server-web.md`. The 3b-b plan, with its pilot results, is `2026-11-06-workmate-stage3b-b-phone.md` (revision 5).
- **Next is 0E, Part 2 onwards.** Each step is its own approval: T0's valid-record test on a genuine working day, installing phone by phone, the parallel run, then the switch-over date the owner approves.

**What changed in revision 13 (7 Nov):** 3b-b is closed.
- **0112 is live:** a password change confirms only the reset it answers.
- **The pilot passed on the test phone with W-0005 and W-0007:**
  - the password prompt, with and without signal
  - the tool flows
  - lost answers recorded once
  - the guarded clean-up
- **Live is back at its starting point,** apart from the pilot's rows in the password and role logs, which stay as history.
- **1012 is published,** with `min_app_version` still 0. **Rule 14's publish pause hasn't started,** because no crew phone has been installed yet. Once the first install day comes, any further publish needs the owner's approval.
- **Found and not changed:** a leader must Find a tool and confirm it's in their hand before issuing it (worth showing at each install). The 3a pilot's 5 photo files are still in Storage, as a separate decision.

**What changed in revision 12 (6 Nov):** 3b-a is closed. Live acceptance passed on 5 Nov, and live was the same before and after the run. A CI failure came from a timing tie in the test database, and its fix changes tests only. The timestamp tie in how live tool records are ordered is recorded in the 3b-a plan as a separate ordering issue, and isn't changed. On real PostgreSQL there were no ties observed in 200 runs; the live database hasn't been measured.

**What changed in revision 11 (5 Nov):** T0's results and the incident are in the 3b-a plan. A reset doesn't cut a phone off straight away, so the rollout's rule of checking a worker's phone for unsent records before their reset matters more. Storage clean-up deletes named files only, never a folder.

**What changed in revision 10 (the owner's choice, 5 Nov):** the person running T0 is a developer with no genuine working day or site, so T0 is now a refusal-path test that leaves no attendance record. The valid-record test stays pending for a genuine working day. The W-0007 reset still needs separate approval.

**What changed in revision 9 (the owner's instruction, 5 Nov):** Task 1 only. `0111`, the function, the push, role changes and resets all still wait. T0 is a separate approval. Before asking for the W-0007 reset, I confirm the test phone is ready and list its unsent records. T0 has to happen on a genuine working day at a real site, because its attendance rows stay.

**What changed in revision 8 (the owner's answers, 4 Nov 21:08):** a leader issues by entering the tool number, limited to eligible tools in the company, with no unrelated custody or history. Photos stay out of the phone, and request linking is in, under the existing fill-once rules. The temporary password is main owner only and authorizes no reset on a real account. A password reset is now known from the sign-in server's source to sign a worker out of every session, and the plan tests it on a test phone (step T0) before any live acceptance is proposed.

**What changed in revision 7 (the owner's answers, 4 Nov 20:55):** Q2 and Q2b are A, Q3 to Q7 are A, and Q8 is B. Q3's answer authorizes no reset: each worker's still needs the owner's approval. Linked Labor account linking is main owner only. Part 1 no longer depends on open answers, and Parts 2 to 5 now carry these answers. Part 4 checks the old app before any temporary password, because a reset is expected to sign that worker out on every phone.

**What changed in revision 6 (the owner's message, 4 Nov 16:58):** the publish pause (rule 14, Q11) is kept, with exceptions only on the owner's approval. Messenger stays available if an update or connection prevents attendance. Anyone without a confirmed account keeps reporting through Messenger (rule 15). Linked Labor stays separate with no release timing chosen, so the earlier wording about when it reaches phones is gone. The terms are recorded as approved, apart from two items for that stage's own plan. The Buyer-switch discrepancy is recorded as a separate finding and isn't changed here.

**What changed in revision 5 (the owner's message, 4 Nov 16:49):** the plan now accounts for the approved Linked Labor MVP terms. Added rules 10 to 13 and the section *Linked Labor and this plan*. Teams are now optional in Q2 and Part 3, and the Monday check no longer compares with an assignment list. Parts 3 and 4 no longer imply an assignment roster. Part 1 now includes the Team Leader switch, kept main owner only, with separate fixes for invalid leaders and inactive teams. **Corrected:** Q2b said the switch uses the Buyer switch's test, but that test is wider than main owner. Proposed: rule 14 and Q11, because every WorkMate publish forces every crew phone to update.

**What changed in revision 4 (the owner's message, 4 Nov 16:08):** added what promoting or demoting really changes. Q2b now lists what the switch must do. The Users screen's Role dropdown is recorded as refused by the server. The misleading no-leader wording was corrected as a separate web change. Q10 records that no account is created and no payroll name is matched.

**What changed in revision 3 (the user's answers, 4 Nov 15:58):** W-0005 and W-0007 are the owner's test accounts and are outside the rollout. W-0019 and W-0021 are real workers, with their accounts and history preserved. Teams follow the job, so the plan proposes an office routine rather than fixed teams. The rollout covers all real workers across sites, with no fixed rollout site, and who installs is undecided. New question Q10.

**What changed in revision 2 (the user's corrections, 4 Nov):** Messenger stays official until the user approves the date. Reward eligibility is not changed and no password is reset without approval, so Q6's option C is withdrawn. Legitimate new attendance records created during the rollout are preserved too.

**Decisions this rests on:**
- The [Stage 3 Tools sheet](../specs/2026-10-28-workmate-stage3-tools-questions.md), answered 28 October, all A. 3b launches with 0E.
- The [Linked Labor MVP terms](../specs/2026-11-04-workmate-linked-labor-contracts-mvp-terms.md), approved by the owner on 4 November, including §8's editing rules, the Project Control-only boundary and owner-controlled linking. Additional Works progress and offline-cache behaviour still need concrete proposals in that stage's own plan.
- The user, 4 November: *"The crew currently reports attendance through Messenger chat. Keep Messenger attendance going until WorkMate is ready and we explicitly agree on the switch-over date. Preserve all existing attendance records. Prepare the plan for review, including installing WorkMate on each phone and checking that each worker can sign in and record attendance."*

**How it is split:** two code plans and one rollout, each with its own review. As in Stages 2 to 4, each code plan is built and tested in a scratch copy first, and the plan is written from that tested code.

| Part | What | Repo | Reaches the crew |
|---|---|---|---|
| **3b-a** | Server functions for workers and team leaders, and the office's view of reported problems | Dacs Web | No. Live on its own, with no effect on anyone |
| **3b-b** | WorkMate **0.10.0 (1012)**: My Tools and Team tools | Dacs WorkMate | Only buyers' phones, until the rollout |
| **0E** | Installing WorkMate on each phone, checking each worker, a parallel run, then the agreed date | Mostly no code | Yes, phone by phone |
| **Linked Labor** | A **separate stage** with its own scratch-tested plan and review. Nothing in it is built here | Dacs Web, Dacs WorkMate | Not through this plan |

---

## The rules for all of this

1. **Messenger stays the official attendance record** until WorkMate is ready **and the user approves the switch-over date.** Nothing switches automatically, and no step removes Messenger. After the date, it stays available if an update or connection prevents someone's attendance.
2. **All attendance is preserved, existing records and legitimate new ones created during the rollout alike.** Nothing in this work edits or deletes one. WorkMate only adds new records.
3. **Baseline, 4 Nov 15:18:** 68 attendance records (fingerprint `b8399ca427ebd1f33985a32f469ac341`, last Time In 21 Oct 14:23), 125 attendance photos, 106 weekly reward rows. I re-check the 68 after every stage, and add each stage's new records to what is checked from then on.
4. **No update to the old Attendance app, and `min_app_version` stays 0.** Raising it is what locked the crew out from 26 Sep to 2 Oct.
5. **Tools carry no pesos,** on any screen, for anyone (Stage 3 rule).
6. **The user commits and pushes.** Scratch first, review before applying, and no deletes on live through tools.
7. **Reward eligibility is not changed by this work,** in any phase. The reward rules stay exactly as they are.
8. **No password is reset without the user's approval, worker by worker.** Q3's answer authorizes none, and nothing in this roadmap resets one by itself.
9. **W-0019 and W-0021 are real workers, whose accounts and history are preserved.** Their old test records stay. New tests and pilots don't use their accounts, and no contract is linked to them automatically.
10. **A labor contract's responsible leader doesn't automatically get the Team Leader app role.** Job title, pay type, scope, paying helpers and payroll's typed "Team Lead" label are not evidence. The role changes only through the main-owner switch, if approved (Q2b).
11. **Contracts need no helper roster and no project-assignment process.** This rollout doesn't create either.
12. **Payroll names are not a worker list.** Nothing in this work creates an account, links an account to a contract, or matches a name automatically.
13. **Teams are optional, and separate from labor agreements.** A contract doesn't create, need or change a team. A team gives nobody access to an agreement, and an agreement gives nobody team powers.
14. **Publish pause (Q11): from the first install day until the end of the first week after the switch, no WorkMate version is published. Any exception needs the user's approval.** Every publish is required on every phone.
15. **Anyone without a confirmed account keeps reporting through Messenger,** before and after the date. Nothing creates an account for them or stops accepting their attendance automatically.
16. **Not part of this:** building Linked Labor or choosing its release timing, the Buyer-switch finding (recorded separately), staff access to indirect pay and the 15 Oct decision (pending the user), invoice numbering (pending the accountant), the 1,000-row question, Stage 4 findings 2 to 5.

---

## What the check found (4 Nov)

Read before planning, so the plan doesn't promise what can't be done.

| Found | What it means |
|---|---|
| **The crew reports through Messenger.** Time-ins fell from 27 a week in late September to 0 since 26 Oct. | There is no old-app routine to protect, and no project end to wait for. The move can happen when WorkMate is ready. |
| **The old app can't be updated on those phones:** their version has no updater, and no Attendance update was ever published. | The old roadmap's "Switch to WorkMate" card is **dropped**. It could never reach them. WorkMate is installed by hand. |
| **The two apps are separate** (`com.dacs.attendance`, `com.dacs.workmate`) and can sit on one phone. | Installing WorkMate leaves the old app and anything saved in it alone. |
| **A second Time In is refused** by the server (`ALREADY_TIMED_IN`). | Someone using both apps can't create a duplicate open record. |
| **The APK has a public link:** `app-releases/workmate/<version>.apk`, about 31 MB. WorkMate needs Android 7 or newer. | It can be sent by link, including through Messenger. Anyone with the link can download the app, but signing in still needs an account. |
| **Workers can't get a password reset from the office.** Dacs Web has no such button, and a reset email only helps if that mailbox is real. Most crew last signed in around 14 Sep, so passwords may be forgotten. | A real risk on install day. See Q3. |
| **Every tool function is office-only** (`tl_actor`), and there is no "My Tools" or "report a problem" on the server. | 3b needs server work before any phone screen. |
| **Only 2 test teams exist,** per the user. Real workers W-0019 and W-0021 are in them, and leader W-0017 is in none. Teams have no link to a project, and the Teams screen already handles members, one leader per team, and turning a team off. | Team membership follows the job, so the office needs a routine, not a fixed list. Teams stay optional. See Q2. |
| **No worker-to-project assignment exists in the system, and none is being added.** A worker can pick any site that's switched on. Attendance is on for 4 of the 11 configured sites and off for 7. | A worker at a site that's off can't Time In there until the office switches it on. Part 3 checks this. |
| **Payroll names are typed labels, not a worker list.** Of 17 names paid in the last 60 days, 1 matches an active account exactly. | "All real workers" may be more than the 8 accounts, but only the owner can say who. See Q10. |
| **A labor contract holds a typed name and no account link** (`labor_contracts.worker_name`). A crew contract records only the responsible person, not the helpers. | 3b and 0E don't read or change contracts. No record can tell us who the helpers are. See *Linked Labor and this plan*. |
| **Every WorkMate publish is required.** It raises `min_workmate_version` at once (0079, 0082). Attendance from an older phone is then refused, and waits on the phone until it updates. Today's minimum is 1011. | Any later release would force every crew phone to update. See rule 14 and Q11. |
| **The office can't change an existing worker's role.** The Team Leader role is chosen when an account is created. Users → Edit shows a Role dropdown, but `profiles_guard` (0019) refuses the change for owner and staff alike, so the save fails with a general error. Only W-0017 and W-0021 hold the role. | If a job's leader is anyone else, the office can't make them leader. See Q2b. |
| **A team with no leader can send requests,** which the local test confirmed. The Teams screen said it couldn't. **The wording is corrected as a separate web change, not part of this plan.** | A team request can go in with no leader to see it. The office still receives it, and can approve the team's reported work directly. The routine checks that "need a leader" reads 0. |
| **A leader's view depends on the team being active and on who leads it now.** `pr_is_current_leader` needs an active team. Turning a team off hides its requests from its leader and stops the leader checking its work. A new leader of a reused team sees that team's old requests. | The routine uses a new team per job, and closes open items before turning one off. |
| **0 tools are registered,** and the catalogue has 3 active items. | "My Tools" would be empty on day one unless the office registers tools first. See Q5. |
| **Requests are on for 1 project of 10** (Barlin). | Requests stay closed elsewhere until someone turns them on. See Q4. |
| **Time In doesn't require being inside the site's fence** (`require_geofence` is off); it records the location. 11 sites are configured. | The site list needs checking before install day. This plan doesn't change the setting. |
| **The weekly ₱500 reward reads Time In only:** every required Monday to Friday, on time. It is a reported figure and moves no money. | A full on-time week in WorkMate can qualify, even during the parallel run. This plan doesn't change that (rule 7). |

**Accounts, from the live data and the user's Q1 answer. Worker numbers only here; names are given to the user directly.**

| Account | Role | Last Time In | Team today |
|---|---|---|---|
| W-0013 | Worker | 25 Sep | None |
| W-0015 | Worker | 14 Oct | None |
| W-0017 | Team leader | 25 Sep | None |
| W-0019 | Worker | 15 Sep | Team pilot B (test) |
| W-0021 | Team leader | Never | Team pilot B, Team test (test) |
| W-0023 | Worker | 24 Sep | None |
| W-0025 | Worker | 5 Oct | None |
| W-0027 | Worker | 1 Oct | None |
| W-0005 | Owner's test account, **outside the rollout** | Never | None |
| W-0007 | Owner's test account and test phone, **outside the rollout** | 21 Oct | Team test |

---

## Part 1: 3b-a, server and Dacs Web

**Already decided in the Stage 3 sheet, not asked again:**
- **Workers** see their own tools ("My Tools") and each tool's history while they held it. They record nothing except "report a problem" ("I don't have this", "it's broken"). There is no acceptance step.
- **Team leaders** see the tools of their teams' members, and issue and return only for those members. A handover needs **both** people in their teams. The server checks the team, not just the role.
- **The office** still sees and records everything on the web.
- **A lost answer** is saved with its operation id, and can be sent again, checked or cancelled. One tool is never issued twice.

**What gets built:**
- **Migration 0111:** functions for "my tools", "my team's tools" and "report a problem". Leaders can issue, hand over, return and reverse their own latest record under the team check, using the same operation-id pattern as stock. A leader finds a tool to issue by entering its number. A request line they can already see can be linked, under the existing fill-once rules; any other line sends them to the office. No photos on the phone.
- **A problem-report record,** which the Tools tab in Dacs Web shows to the office with its state.
- **The temporary-password step** (Q3), which authorizes no reset by itself.
- **The Team Leader switch and its fixes for invalid leaders and inactive teams** (Q2b).

The full scope is in `scope_3b_a.md`, and the tested plan is `2026-11-04-workmate-stage3b-a-server-web.md`.

**Before any live acceptance is proposed:** step T0 of that plan resets W-0007 on the test phone with an unsent Time In waiting that the server will refuse, so no attendance record is created. It has its own approval. The valid-record test stays pending for a genuine working day, and the old app's own unsent test stays pending with a further approval.

**Tests must prove:**
- A worker sees only their own tools.
- A leader is refused for anyone outside their teams, and for a handover where one person is outside.
- A leader removed from a team loses access at once.
- No function returns a peso.
- Tools still never touch an expense row or Spent.
- A retried operation records once.
- Only the main owner can use the switch. Staff, the other owner-role account and direct updates are refused, and nobody can change their own role.
- A role can't be turned off while its holder leads an active team, and every change is logged.
- A named leader without the role, or with a deactivated account, counts as no leader.
- A leader mark on a turned-off team can be cleared, and can't return when the team is turned back on.
- No 3b-a function reads or writes `labor_contracts`, `payroll` or `profiles.position`.

**Done when:** live, with the acceptance test passing and the crew unaffected. **Met on 5 Nov.**

## Part 2: 3b-b, WorkMate 0.10.0 (1012)

**What gets built:**
- **My Tools** for everyone, reached from a card on Home. The bottom bar already has five tabs, so this adds none.
- **Team tools** for team leaders, with issue, handover and return.
- **Report a problem** on each tool.
- **A saved copy** for weak signal, and the same send-again, check or cancel screens as stock.
- **A forced change of a temporary password** after sign-in (Q3).

**Not in this version:** any Linked Labor screen. Tools stay free of pesos.

**Pilot:** a ZZ tool on the test phone, including a lost answer, a leader outside the team being refused, and clean-up afterward. It uses only the owner's two test accounts, W-0007 and W-0005. Testing a leader needs W-0005 to hold the Team Leader role. The main owner would set that with the switch, on the user's approval when the pilot is planned.

**Publishing:** it becomes required for phones already on WorkMate, which today means buyers. Crew phones get it by hand in Part 3.

**Done when:** the pilot passes and the version is published. Attendance in WorkMate is regression-tested in the app's existing suite.

## Part 3: Getting ready for install day

These need the office, with little or no code:
- **The install list:** the accounts the owner confirms (Q1, Q10). It doesn't come from payroll or contracts.
- Any teams the office chooses to use, entered through the routine in Q2, if approved. A worker or crew with no team can still be installed and checked. The 2 test teams are turned off only on the user's word.
- Existing tools registered in Dacs Web before install day, with a checked count, each with a named holder (Q5).
- The sites where the crew is actually working, as the office knows today, checked in Attendance: switched on, shown, and on the right schedule. This reads site settings only. **No assignment roster is created or required.** Repeat it when the crew reaches a site that hasn't been checked.
- The temporary-password step ready (Q3). No password is reset until the user approves it for that worker.
- Requests stay on for Barlin only, and My Work stays empty until tasks are assigned (Q4).
- W-0019 and W-0021 told beforehand that they'll see old cancelled test requests in My requests (Q8). No record changes.
- A phone check sheet (below), and a short Tagalog message for the crew explaining that **Messenger continues as usual**.

## Part 4: Installing and checking each phone

Do this for each account on the install list, on a normal working day, wherever that worker is actually working. **There is no fixed rollout site, and who installs is undecided (Q9). Messenger reporting continues throughout.** The phone check changes no contract, role, team or account link.

**On each phone:**
1. **Old app, if present:** open it with signal and look for "Not sent yet". If it shows anything, wait for it to send and note it on the sheet. **Don't uninstall it.**
2. **Check the phone:** Android 7 or newer, with about 100 MB free. An iPhone or a too-old Android gets written down and stops here.
3. **Install:** open the link, allow "install unknown apps" for that one step, and install.
4. **Sign in** with that worker's own account, with the worker holding the phone. If they've forgotten their password, the user decides whether to approve a temporary password for that worker, **only after step 1.** A reset signs them out of every session, so the old app's unsent records come first.
5. **Accept the terms** if asked, and change any temporary password.
6. **Allow camera and location** when asked.
7. **Time In** in WorkMate with a photo, at the site where the worker really is, on a real working day.
8. **The office confirms** in Attendance → Today on site: right person, right site, photo present. I confirm on the server that it came from version 1012.
9. **Time Out** at the end of that same day.
10. **My Tools opens** and matches what the office registered. Leaders also check Team tools.

**On two phones only:** one Time In with no signal, to confirm it sends once the signal returns. Two phones prove it; it needn't be repeated on all of them.

**These check Time-ins are real records, kept for good.** That's why they happen on a real working day at the real site. If a check goes wrong, the record stays and gets a note. It is never deleted.

**Phone check sheet (one row per account):**

| Account | Phone and Android | Shared phone? | Old app "Not sent yet" | Installed | Version | Signed in | Terms | Camera and location | Time In | Office saw it | Time Out | My Tools | Offline | Date, checked by |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

"Shared phone?" only records whether more than one person signs in on that phone, so the office can check whose Time In it is. The Linked Labor plan can read the answer when it proposes its offline-cache rules.

**Done when:** every account on the install list has a full row, or a written reason and a decision. **I re-check the 68 records and add the new ones.**

## Part 5: Parallel run

Workers on the install list record in **both** for 5 working days, Monday to Friday (Q6). Anyone else keeps reporting through Messenger only. **Messenger stays official.** Each day the office compares the two for those on the list and writes down any difference.

**Done when:** workers on the install list have recorded in WorkMate on every working day of the period, with every difference explained and none caused by the app. Then I report the results and propose a date.

## Part 6: The switch-over date

**Nothing happens until the user approves a specific date, in writing, in this conversation.** Reaching this step only makes that decision possible.

**I'd propose a Monday,** because the reward week runs Monday to Friday and a mid-week start can't qualify.

**On the date:**
- A message tells workers with a confirmed account that WorkMate is now their record.
- Anyone without a confirmed account keeps reporting through Messenger, and the office keeps reading it for them. Nothing stops accepting their attendance.
- The office checks Today on site that morning.
- No server setting changes, and `min_app_version` stays 0.

**If an update, a connection, WorkMate or the server prevents someone's attendance:** they report through Messenger that same day, and nothing is lost. The office adds those days by note, and we decide what to do next.

**The first week:** a daily check by me, covering errors, records and anyone on the install list who is missing.

## Part 7: After the switch

- **The old app:** after two clean weeks, remove it phone by phone, only where "Not sent yet" is empty. Nothing requires removing it sooner.
- **Close-out:** a final check of the 68 records, the rollout's new records and the notes, then 0E is marked done.
- **Messenger afterward:** it stays available for anyone without a confirmed account, and for anyone an update or connection stops from recording.
- **Later, separately:** turning on Requests for more projects, and whatever else is decided from Q4.

---

## What promoting or demoting someone changes

**How this was checked:** 53 checks on an in-memory copy of the real migrations (`scratchpad/leader_perm/leader_perm.pglite.mjs`, all passed). The 22 live functions involved are identical to the files tested. I also searched the live functions and policies, the edge functions, the web code and both phone apps for anything that treats the two roles differently. Nothing live was changed or tested.

**Two separate things:** the Team Leader **role** only makes someone eligible. Being **named leader of a team** gives the powers, one team at a time.

| | Role on, not named | Named leader of a team | Role off |
|---|---|---|---|
| See that team's requests and their photos | No | Yes, including requests sent before they led | Stops at once |
| Name another member on a request | No | Yes | Stops at once |
| Check the team's reported work | No | Yes, unless it's their own work | Stops at once |
| Propose work for the team | No | Yes | Stops at once |
| "My proposals" button on the phone | Shown, with no team to propose for | Shown | Hidden once the phone refreshes its profile, which happens when the app starts with signal. The server refuses in the meantime |
| Can be picked as leader on the Teams screen | Yes | Already leader | No |

**Never changes with the role:** Time In and Time Out, weekly reward eligibility, sign-in on both apps, worker number, their own requests, work assigned to them personally, and tool custody. Workers and team leaders see no prices today, either way. **The role also gives no access to any labor agreement.** Under the approved terms, only an account explicitly linked to an agreement would see that agreement's money, whatever its role.

**Existing team assignments:**
- **Memberships stay** in both directions. Nobody joins or leaves a team because of a role change.
- **Leadership never moves by itself.** Promoting someone doesn't make them leader of any team they're in.
- **When a team gets a new leader,** the previous one loses its requests at once, and the new one sees its old requests too. This is why the routine uses a new team per job.
- **Today:** W-0021 leads Team test and is a plain member of Team pilot B. W-0017 holds the role and is in no team.

**Gaps found, both left unchanged until 3b-a (Q2b items 5 and 6 fix them):**
- **"Led by" can be wrong.** If a named leader loses the role or their account is deactivated, the Teams screen still reads "Led by" them and doesn't count the team as needing a leader, yet they have no powers. Deactivation can cause this on the live system today, though no team is affected now.
- **A leader mark on a turned-off team can't be cleared by the office** (`BAD_TEAM`), so it could come back when the team is turned on again.

## Linked Labor and this plan

**It is a separate stage.** It gets its own scratch-tested plan. 3b and 0E don't build it, and neither has to wait for it. Approved Tools behaviour doesn't change. **Its release timing isn't chosen.**

**Two items stay open in that stage's own plan:** concrete proposals for Additional Works progress and sensitive offline-cache behaviour (§11). They don't hold up 3b or 0E.

**What this plan takes from the terms:** rules 10 to 13, plus these consequences.

| Point | What it means here |
|---|---|
| **Helpers aren't recorded, by design** | Contracts can't supply the install list. A helper is on it only if the owner names them and they have an account (Q10). |
| **People with no confirmed account** | They can't record in WorkMate, so they keep reporting through Messenger (rule 15). |
| **Tools need an account to hold them** (`tl_person`) | A helper with no account can't hold a tool on record, so it stays with someone who has one. |
| **A crew's responsible person and Team tools** | They get Team tools only if the main owner gives them the role **and** the office names them leader of a team. A contract alone gives neither. |
| **Workers seeing pesos** | The terms add one narrow exception: an account's own linked agreement. Nothing in 3b or 0E uses it, and My Tools stays peso-free. That stage's plan updates the project rules when it's built. |
| **Who can do what** | The Team Leader switch is main owner only. Linking a contract to an account is also main owner only, under the terms (§5), and staff keep entering typed names. They are separate permissions. |
| **Phone releases** | Linked Labor's release timing isn't chosen here. The publish pause covers every WorkMate version, whatever it contains (rule 14). |
| **Project Management contracts** | They're outside the approved boundary. Someone whose agreements are all on Project Management contracts would see no agreement in WorkMate. Their attendance and tools aren't affected. |

## Questions

"(R)" is my recommendation. Answered questions keep their options for the record.

**Q1. Who is in the rollout? ANSWERED 4 Nov.** W-0005 and W-0007 are the owner's, used for testing, and are outside the rollout. W-0019 and W-0021 are real workers; the owner used their accounts for testing. Their accounts and history are preserved. The rollout covers all real workers (W-0013, W-0015, W-0017, W-0019, W-0021, W-0023, W-0025, W-0027, plus anyone from Q10).

**Q2. How does the office keep team assignments current? ANSWERED A, 4 Nov.** The existing teams are test setups, membership changes with the job, and nothing is inferred from names or helper positions. **Who maintains teams is pending.**
- **A (R):** An optional routine on the existing Requests → Teams screen, open to owner and staff accounts, with no new data. **A job or crew doesn't need a team.** The office uses one when it wants a leader to see a team's requests and check its work, and later its tools.
  1. **When the office wants a team, it makes a new one for that job or crew.** Name it after the job, not a person. Don't reuse a team for a different job, because its new leader would see the old job's requests.
  2. **The same day,** the office adds the people and picks the leader. One person can be in more than one team.
  3. **When someone moves,** the office removes them from the old team and adds them to the new one. The history stays, and they still see their own past requests.
  4. **When the job ends,** the office closes the team's open requests and work, then turns the team off. Nothing is deleted.
  5. **Every Monday,** the office reviews the active teams, updates anyone it knows has moved, and deals with any team showing "need a leader". There is no assignment list to compare against.
  - A worker with no team can still Time In, send a "Just me" request, and (once 3b is built) see their own tools. Attendance doesn't read teams at all. When teams change, a tool stays with its named person until a handover is recorded.
  - **Teams stay separate from labor agreements.** Saving or linking a contract never creates or changes a team. Leading a team gives no view of anyone's agreement. A contract's responsible leader isn't a team leader unless the office makes them one.
  - The 2 test teams are turned off only on the owner's word.
- B: Tie each team to a project in the database. This helps only if every team maps to one project, and it needs a migration.
- C: Skip teams at launch. The office records all tools, and leaders get Team tools later.

**Q2b. Who can hold the Team Leader role? ANSWERED A, 4 Nov: the switch, main owner only.**
- **A (R):** A small Team Leader on/off switch for existing workers, built in 3b-a.
  1. **Main owner only:** owner role, no `owner_id`, active, the same test as PM sharing (`pm_main_owner_id`), through one server function. `profiles_guard` allows that function alone, so staff, the other owner-role account, direct updates and the Users form stay refused. Nobody can change their own role.
  2. **A log:** append-only, recording who changed whom, when, and from what to what.
  3. **Turning off:** refused while the person is named leader of an active team, until the office picks another leader.
  4. **Nothing automatic:** it never joins, removes or names anyone, and never reads a labor contract.
  5. **Fix for invalid leaders:** a named leader without the role, or with a deactivated account, counts as no leader on the Teams screen and in "need a leader". The office sees why, and can clear the mark or pick someone else. This also closes today's deactivation gap.
  6. **Fix for inactive teams:** the office can clear a leader mark on a turned-off team, and turning the role off clears that person's marks on turned-off teams in the same step. An old mark can't return when a team is turned back on. Naming a new leader still needs an active team.
  7. **Screens that mislead today:** replace the Role dropdown for worker accounts on Users → Edit, which can't save a change, and change "Leads a team on site" on Attendance → Workers to "Can lead a team", because that line shows for the role alone.
  8. **Tests:** bring the local permission checks into `npm run test:sql`.
- B: No build. Only W-0017 and W-0021 can lead for now, and other crews run without a leader, so the office checks their work.

**Q3. What happens if a worker has forgotten their password? ANSWERED A, 4 Nov. This authorizes no reset: each worker's still needs the owner's approval.** The office has no reset today, and the service key can't be used from a browser. **Main owner only** (the owner, 4 Nov).
- **A (R):** Add a small, owner-only "Set temporary password" for worker accounts, through a server function and recorded in a log. The worker changes it on first sign-in. It's built in 3b-a, and **no password is reset until the user approves it for that worker.**
- B: Use reset emails. This only works if those mailboxes are real, and you'd need to confirm they are.
- C: Create new accounts for those workers. I advise against this, because it splits their attendance history.

**Q4. What can the crew see at first? ANSWERED A, 4 Nov.** WorkMate also has My Work and Requests.
- **A (R):** Everything stays visible, but only what's needed is switched on: attendance and tools first. Requests stay on for Barlin only, and My Work is empty until tasks are assigned. You turn on more when you're ready, project by project.
- B: Turn on Requests for every open project from the first day.

**Q5. When are existing tools registered? ANSWERED A, 4 Nov.**
- **A (R):** Before install day, so My Tools is right from the first opening. The office does a checked count, per the Stage 3 rule.
- B: After the switch. My Tools starts empty, and the office fills it in gradually.

**Q6. How long is the parallel run? ANSWERED A, 4 Nov: 5 working days.** The reward rules stay exactly as they are in every option (rule 7).
- **A (R):** 5 working days, Monday to Friday.
- B: 10 working days, for more confidence and more double-reporting.

**Q7. Should Messenger attendance history be brought into the system? ANSWERED A, 4 Nov: no.**
- **A (R):** No. The chat stays the record for those weeks, and attendance records only start from real Time-ins.
- B: Yes, as a separate typed-in record. This is more work and needs its own decision on rewards.

**Q8. The pilot's cancelled test requests (R7). ANSWERED B, 4 Nov: tell those two workers beforehand.** After moving, W-0019 and W-0021 will see old cancelled test requests in My requests.
- **A (R):** Leave them as history. They clearly read "Cancelled", and no code is needed.
- B: Tell those two workers beforehand. No change to the records.

**Q9. Who installs, and where? PARTLY ANSWERED.** The owner: WorkMate is for all real workers across the sites. Sites depend on assignments and project permissions, so there is no fixed rollout site. **Who handles installation is still undecided.** No date is being set here.

**Q10. Who else needs a worker account? PENDING.** Suggestions from payroll and labor contracts went to the owner directly on 4 Nov, grouped for confirmation. They are not an authoritative list. **No account is created, no name is matched to anyone, and no account is linked to a contract.**
- The owner says who needs WorkMate. Creating an account goes through the existing form in Attendance → Workers, and only on the owner's word.
- Until then, and for anyone never confirmed, they keep reporting through Messenger (rule 15).

**Q11. When can another WorkMate version go out during the rollout? ANSWERED 4 Nov.** The owner keeps the pause (rule 14): no publish from the first install day until the end of the first week after the switch, and any exception needs the owner's approval. Messenger stays available if an update or connection prevents attendance. Linked Labor's release timing isn't chosen.

---

## Self-review against your instructions

| You asked for | Where |
|---|---|
| Use Messenger as the current workflow | Rule 1; *What the check found*; Parts 4 and 5 |
| Keep Messenger official until ready and you approve the date | Rule 1; Part 6 |
| Preserve all attendance, including legitimate new records from the rollout | Rules 2 and 3; re-checked after every stage; Part 4's note on check records |
| Don't change reward eligibility or reset passwords | Rules 7 and 8 |
| Test accounts and real workers per your Q1 answer | Q1; rule 9; the accounts table; Part 2's pilot |
| Don't infer teams; propose how the office maintains them | Q2 |
| All real workers, no fixed site, installer undecided | Q9; Q10; Parts 3 and 4 |
| Check what promoting or demoting changes, including team assignments | "What promoting or demoting someone changes"; Q2b |
| Routine and switch stay proposals | Status line; Q2; Q2b |
| No automatic accounts or payroll matching | Rule 12; Q10; Part 3's install list |
| Account for the approved Linked Labor terms | *Linked Labor and this plan*; the split table |
| A contract's leader doesn't automatically get the Team Leader role | Rule 10; Q2; Q2b item 4 |
| No helper roster or mandatory project assignment | Rule 11; Parts 3 and 4; Q2 step 5 |
| Payroll names aren't an authoritative list | Rule 12; *What the check found*; Q10 |
| Teams optional and separate from labor agreements | Rule 13; Q2; Part 3 |
| Switch main owner only, with fixes for invalid leaders and inactive teams | Q2b items 1, 5 and 6; Part 1 |
| Who installs, who maintains teams, additional accounts stay pending | Status line; Q2; Q9; Q10 |
| Answers recorded: Q2, Q2b and Q3 to Q7 A, Q8 B | Q2 to Q8; Parts 1 to 5 |
| No reset authorized by the Q3 answer | Rule 8; Q3; Part 3; Part 4 step 4 |
| Linked Labor linking main owner only | *Linked Labor and this plan*; the terms §5 |
| Enter the tool number, eligible tools only, no unrelated custody | Part 1; the 3b-a plan |
| Photos out; request linking in, with fill-once rules | Part 1; the 3b-a plan |
| Temporary password main owner only, no real reset | Q3; rule 8; the 3b-a plan |
| Test reset effects and unsent attendance on a test account before proposing live acceptance | Part 1; the 3b-a plan's T0 |
| Build and test in scratch, then send the plan | Status line; the 3b-a plan |
| Task 1 only; no `0111`, deploy, push, role change or reset yet | Status line; the 3b-a plan |
| T0 a separate approval, after confirming the phone and listing its unsent records | Part 1; the 3b-a plan's T0 |
| T0 is a refusal-path test only; the valid-record test stays pending for a genuine working day | Part 1; the 3b-a plan's T0 |
| Publish pause kept, exceptions on your approval | Rule 14; Q11 |
| Messenger available if an update or connection prevents attendance | Rule 1; Parts 6 and 7; Q11 |
| No confirmed account: Messenger continues, nothing automatic | Rule 15; Parts 5 and 6; Q10 |
| Linked Labor separate, no release timing chosen | The split table; *Linked Labor and this plan*; rule 16 |
| Buyer-switch discrepancy recorded separately, not changed | Rule 16; the separate finding |
| Install WorkMate on each phone | Part 4, steps 1 to 3; the account table |
| Check each worker can sign in and record attendance | Part 4, steps 4 to 9; the phone check sheet |
| 0E + 3b planned together | Parts 1 to 7 |
| The plan sent for review first | This document; nothing built or applied |

**Not verified yet, on purpose:**
- Whether the crew's phones meet Android 7 and have space. Install day finds out, and Part 4 says what to do.
- Whether old-app phones still hold unsent records. Step 1 checks, phone by phone.
- Whether the worker addresses are real mailboxes (Q3).
- Who the helpers are. No record holds this, by design, so only the owner can say (Q10).
- How a temporary password behaves on a real phone. The sign-in server's source says every session is logged out, and both apps' queue tests pass. Step T0 of the 3b-a plan confirms it on the test phone.
