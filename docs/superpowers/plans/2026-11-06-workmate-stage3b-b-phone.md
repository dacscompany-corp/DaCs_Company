# WorkMate Stage 3b-b: tools on the phone and the password prompt — plan for review

**Status (7 Nov 2026):** Revision 5. **3b-b is done. The pilot passed on 7 Nov, and the owner published 1012 at 16:27.** Live is back at its starting point, apart from the pilot's rows in the password and role logs, which stay as history. **The crew isn't moved:** Messenger stays official until the owner approves the switch-over date. What happened is in *Revision 5* below. Revisions 1 to 4 are kept as the record of how the patch was built and reviewed.

**Goal:** WorkMate **0.10.0 (1012)**, the phone screens for what 3b-a put on the server:
- **My tools** for every worker and team leader
- **Report a problem** on a tool
- **Team tools** for team leaders: issue, hand over, return, and undo their own latest record
- **The password prompt**: a worker given a temporary password sets their own

**It doesn't move the crew.** Messenger stays official until the owner approves the switch-over date.

**Base:** the Dacs WorkMate repo, `main` at `7c8d86e` (0.9.0+1011, published 28 Oct). The server side is 3b-a: `0111` is live and its acceptance passed on 5 Nov. **No migration and no server change.** Dacs Web gets one new file, the pilot's clean-up script, in Task 5.

---

## Already decided, not asked again

| Decision | Source |
|---|---|
| Workers see their own tools and each one's history while they had it. Leaders see their teams' members' tools. No pesos anywhere | Tools sheet Q21 |
| A worker records nothing but "I don't have this" or "It's broken", which changes no tool, holder or record | Tools sheet Q12; `tl_report_problem` |
| Every tool action is saved with its operation id before it is sent. After a lost answer it can be sent again unchanged, checked or cancelled, and never sent twice or by itself | Tools sheet Q22 (the stock rule) |
| A leader issues by typing the tool number and confirming the tool. A request line they can already see can be linked; any other line goes to the office. No photos from the phone | The owner's 3b-a scope answers Q1 and Q2 (4 Nov); `tl_team_find`, `REQUEST_NEEDS_OFFICE` |
| My tools is reached from a card on Home. The bottom bar keeps its five tabs | Roadmap Part 2 |
| A worker changes a temporary password on first sign-in | Roadmap Q3 |
| No publish from the first install day to the end of the first week after the switch, without the owner's approval | Roadmap Q11 |

---

## Question P1: the password prompt with no signal — ANSWERED A (6 Nov)

The owner chose A, and asked for tests that the prompt returns when signal comes back, and that attendance stays reachable when the password change fails.

A temporary password is owed when the server's records say so (`wk_password_state`). Setting a new password needs signal, and so does asking the server.

- **A (R):** **Forced while there is signal; never in the way of attendance.**
  - After sign-in, the prompt comes before Home and can't be skipped.
  - If there's no signal, either when asking or when saving, the worker can continue to Home and Time In. The prompt comes back the next time the app opens with signal.
- **B:** No Home until the password is changed, even with no signal. **I advise against this.** A worker on weak site signal couldn't Time In, which is the kind of lockout this rollout must never cause again.

---

## Revision 5: the pilot passed, and 1012 is published (7 Nov)

### Before the pilot (6–7 Nov)
- **0112:** applied on live by the owner and verified on 6 Nov at 18:50. Checked again on 7 Nov at 14:40, just before the install: the same function bodies and permissions, and nothing else had changed.
- **Both repos committed and pushed on 6 Nov:** Dacs Web `6a04ef8` and WorkMate `052e4af`.
- **CI then failed on a 2A-2 purchasing test, not on 0112.**
  - **Cause:** on the in-memory test database, two request parts made in the same millisecond can list in either order.
  - **Fix:** a test-only change (`4edb7ec`) gives each part a strictly later time. A new check on real PostgreSQL found **no ties observed in 200 runs**.
  - CI passed.
- **The pilot's clean-up script and its 4 tests are `724d877`**, and CI passed. 12 of 12 deliberate breaks were caught.
  - **The ZZ team is removed, not kept switched off.** W-0005's leadership and both memberships end first, then the team is deleted, all in the same run.
  - This replaces "the ZZ team is turned off" in the pilot section below.
- **The release file:** 0.10.0 (1012).
  - **Size:** 42.0 MB.
  - **SHA-256:** `4FF248E566EF9033DB82522CF54BD558F816442BD70328B598ADCC89F08C82EF`.
  - **Signing:** the same certificate as 1011 (`3b63f66a…`).
  - **Built from:** `052e4af`, with the working tree clean.

### Task 5: the pilot, 7 Nov 14:40–16:26: PASS
On the owner's test phone, with the test accounts W-0005 and W-0007 only. Each step was checked on live, read-only, before the next.

| Step | Result |
|---|---|
| 3. Install | **Every unsent list was empty first:** WorkMate's Home, My Work, History and Requests → Pending sync, and the old app's Home and History. Then 1012 was installed over 1011 with `adb install -r` at 14:50, keeping the phone's data |
| 4. W-0007's prompt | **It appeared by itself**, because W-0007's 5 Nov reset was still open. <br>**With no signal:** Save showed "No signal right now", then **Continue for now**. Home and Time In stayed reachable; nothing was timed in. <br>**With signal back:** the prompt returned within a minute. <br>**Save:** **one** "changed" row, by W-0007, linked to that reset |
| 5. W-0005's temporary password | **Set by the main owner:** rows "requested" and "temporary set". **Then W-0005's own change, linked to that reset.** W-0005 had no session, attendance or team, so the reset ended nothing |
| 6. Team Leader switch | **One role row:** worker → Team Leader, by the main owner |
| 7. ZZ set-up | The project `ZZ 3b pilot`, the item `ZZ 3b pilot hammer`, the team `ZZ 3b pilot team` (W-0005 leads, W-0007 is a member), and TOOL-0001 registered at the warehouse with a photo. **The new-folder form requires a budget, so ₱0 was entered.** The folder's budget and 70/20/10 policy rows are removed along with the folder |
| 8. Tool flows | **The leader:** issue, hand over, return as needs repair, **undo their own record with a reason**. <br>**The worker:** My tools, and **"It's broken"**, which the office closed. <br>**The office, on the web:** issue, return as missing parts, repaired. <br>**Lost answer:** in airplane mode the phone said "Not sure this was recorded". **Check** answered "Not recorded yet", and **Send again recorded once.** **Cancel recorded nothing** (a cancelled operation id). <br>**Damaged return:** it waited for the owner, the owner **rejected** it, and the tool went to Under repair. <br>**13 records in all, each recorded once, all on the ZZ project, none linked to a request** |
| 9. Clean-up | **The dry run gave exactly the expected counts; then the real run.** <br>**Remove Team Leader** was accepted afterwards; the server refuses it while W-0005 still leads a team. <br>The **2 named photo files** were deleted by name. Storage left an empty-folder placeholder, which is kept. <br>The phone was signed back in as W-0007 |
| 10. After-check | **Live is back at the starting point:** <br>- W-0005 and W-0007 are plain workers with no open reset; Team Leaders 2. <br>- Tools are on, with none registered; no ZZ data is left. <br>- 15 projects, 6 items, 2 teams with 4 members. <br>- 601 expenses (₱3,178,554.74), 47 purchases, 17 requests, 68 attendance records (none that day). <br>- Functions 514, columns 1,709, policies 194. <br>- **No app errors.** <br>**The logs keep the pilot's rows as history:** the password log has 6 rows, the role log 2 (on and off) |

**Not covered:**
- the optional "I don't have this" report
- a photo from the phone, which is ignored by design (the office attached one on the web)

### Task 6: published, 7 Nov 16:27
- **Published by the main owner from Dacs Web.** The release record's SHA-256 matches the reviewed file above, at 44,014,859 bytes.
- **`min_app_version` stays 0**, so the old app isn't forced.
- **Who gets 1012:** phones already on WorkMate, which today means the buyer and staff accounts. The crew stays on the old app and Messenger.

### Found during the pilot, not changed
- **W-0007 is also in a real team, led by W-0021.** While W-0007 held the ZZ tool, that leader could have seen it in Team tools, but only on 1012, which no other phone had at the time.
- **A leader can't issue by typing a number alone.** They must press **Find** and tick **"This is the tool in my hand"**. That's working as designed. Worth showing at each install.
- **The 3a pilot's 5 photo files are still in Storage under `tools/…/2026-10`.** Their rows were removed on 29 Oct. They're a separate decision.
- **The gaps in the log numbers** (password row 3, role row 1) were used up by the 5 Nov live acceptance run, which rolls back by design. Nothing is missing.

### Still open (each a separate decision)
- T0's valid-record test on a genuine working day and site.
- The switch-over date.
- Who installs (Q9), who maintains teams (Q2), and additional worker accounts (Q10).
- The 3a leftover photos.

---

## Revision 4: the password change is bound to the prompt's account

**The owner's review (6 Nov):**
- Keep 0112 and the prompt over Home.
- Bind the password-change request itself to the account that opened the prompt.
- Add a regression test: open A's prompt, switch to B, then press Save. B's password and reset state must stay intact.

**What was still open in revision 3:**
- The prompt saved the new password through Supabase's ordinary change, and **Supabase changes the password of whoever is signed in when the request leaves.**
- So if B signed in while A's prompt was still on screen, Save would have changed **B's** password. A's confirmation would then have been refused, leaving B with a password typed for A.

**The fix: one function, `PasswordPromptServices.boundChange`.**
- **The check is in the same step as the request.** It reads who is signed in in the same step as making the request, and refuses anyone but the prompt's account **before anything is sent**. Supabase's `updateUser` takes the signed-in token first, before waiting on anything, so nothing can sign another account in between. That was checked in the installed library (gotrue 2.27).
- **The answer is checked too:** it must name the same account.
- **A refusal reads "Please log in again."**, never as a password problem.
- **The prompt always passes its own account.** Profile's own change is unchanged.

**The regression test you asked for, on the real Home screen:**
1. A's prompt is open.
2. B signs in on the phone.
3. Save is pressed.

The result: "Please log in again."
- **B's password unchanged; B's reset still open; no change recorded for B.**
- A's password and reset are unchanged too.
- Nothing was confirmed, and no note was left.

**Also tested:**
- The same at the prompt's level.
- **The check and the request are one step:** the change is never reached with another account signed in.
- An answer naming another account is refused.
- **On the real Supabase client:** signed in as A, exactly one password request leaves, carrying A's token. Signed in as B, A's change is refused and **no request leaves**.

**Deliberate breaks, all 4 caught:**
1. The old unbound change.
2. No check before the request.
3. The check made only after the request has gone.
4. The answer's account not checked.

**Results:**

| Check | Result |
|---|---|
| WorkMate, the whole suite | **1,126 pass** (6 more than revision 3: 3 at the prompt, 1 on Home, 2 on the real client) |
| `flutter analyze` / debug APK | **No issues / builds** |
| The 16 earlier phone breaks, again (the prompt's file changed) | **16 of 16 still caught**, plus the 4 new ones: **20 of 20** on the phone |
| 0112 and its Dacs Web tests | **Unchanged since revision 3**: the same patch file, so its results stand (npm test 1,545; 54 suites, 1,634 checks) |
| The patches | **Both apply cleanly**: the phone patch (the same 33 files) at WorkMate `7c8d86e`, and 0112 at Dacs Web `b680167`. `3b_b_phone_v2_to_v3.diff` shows what changed since revision 3: two app files, `password_prompt.dart` and one line in `home_shell.dart` |

---

## Revision 3: a password change confirms its own account and reset

**The owner's review (6 Nov):**
- Keep the prompt over Home.
- The change's confirmation must apply only to the account and reset it belongs to.
- If the API can't tell which reset, propose the smallest safe change.
- Test a lost confirmation followed by a second reset, and an account switch while a confirmation is pending. In both, the outstanding prompt is kept and attendance stays reachable.

### What was wrong in revision 2
- 0111's `wk_password_changed()` names no reset: **it closes whatever reset is open when it arrives.** The phone's "changed here, confirm later" note named only the account.
- So a confirmation that was lost and sent after the owner reset the password again would close the second reset. The worker would keep the office's temporary password and never be asked.
- The order of the rows can't decide it either: a confirmation and a second reset written at the same moment can land either way round.
- **So the current API cannot tell which reset a confirmation belongs to.**

### The smallest safe change: migration `0112` (proposed, not applied)
- **`wk_password_events.reset_id`**, nullable. A "changed" row names the reset it answers, and only "changed" rows carry one.
- **`wk_password_state()`** gives the same `must_change` as before, plus `reset_id`, the open reset.
- **`wk_password_changed_for(reset)`** records the change only while that reset is the caller's open one, once. Anything else records nothing: an older reset, another account's, or none.
- **0111's `wk_password_changed()` is unchanged**, and 1012 never calls it. Its old rows still close every reset before them.
- **Additive only:** one column, one rewritten reader, one internal helper and one action. No money, no policy, and nothing the old Attendance app reads.
- **The way back:** `3b_b_rollback.sql` restores 0111's reader exactly and deletes nothing.
- **Live, checked read-only on 6 Nov:** only W-0007 has password events (one reset, no change). Its "must change" is true under 0111's rule and under 0112's, so **applying 0112 changes no worker's state.**
- **Order:** 0112 must be live before any phone runs 1012, which means before the pilot. Each step has its own approval.

### The phone (revised patch)
- **Each "changed here" note names its account and its reset.** It is confirmed for that reset only, with that account signed in.
- **Every call is refused on the phone** (`AUTH_REQUIRED`) unless its account is the one signed in. A shared phone never asks or confirms for one account with another's sign-in.
- **After any confirmation, the phone asks the server what is owed now.** Whether it recorded the change, or found it already recorded or replaced by a newer reset, a newer reset's prompt is kept.
- **No reset named** (a server without 0112): nothing is asked and nothing confirmed.
- **The prompt stays over Home.** The only app file that changed since revision 2 is `lib/profile/password_prompt.dart`; `3b_b_phone_v1_to_v2.diff` shows exactly what changed.

### The two scenarios you asked for

**A lost confirmation, then a second reset** (unit test and Home test):
1. The worker changes the password, and the confirmation is lost.
2. Time In opens.
3. The owner resets again, and the worker signs in again with no signal. Nothing is asked, and Time In opens.
4. Signal comes back. The late confirmation goes for its own reset and **closes nothing**: the second reset stays open and its **prompt is kept**.
5. A failed change there can be continued past, and Time In opens.
6. With signal the prompt returns. The second change closes the second reset.

**An account switch while a confirmation is pending** (unit test and Home test):
1. Account A changes the password, and its confirmation is lost.
2. Account B signs in with no signal. Time In opens.
3. With signal, **B's own prompt is kept**. A's note was never sent with B's sign-in and stays with A.
4. B's failed change can be continued past, and Time In opens.
5. A signs back in. **A's own reset is confirmed**, A is asked nothing, and B's reset stays owed.

The unit tests also cover:
- a confirmation that did arrive but whose answer was lost (sent again, it records nothing more)
- a prompt left from another account (refused, and its note stays)
- an account reset again while away (its old confirmation closes nothing)
- a server without 0112

### Results

| Check | Result |
|---|---|
| WorkMate, the whole suite | **1,120 pass** (1,013 before 3b-b; 107 new) |
| `flutter analyze` / debug APK | **No issues / builds** |
| The prompt's unit tests / Home tests / the calls | **14 / 18 / 8**, all pass |
| The real Supabase client, signed in | Sends `wk_password_changed_for` with exactly `{"p_reset": …}`; refuses another account; never calls 0111's `wk_password_changed` |
| The phone's 17 calls | **Match** the `0106`, `0107`, `0111` and `0112` files |
| Deliberate breaks, phone | **16 of 16 caught**: the 5 new ones below, and the 11 from revision 2 again |
| The 3b suite, without 0112 / with 0112 | **46 / 55 pass**. With 0112, every earlier test passes again, including the live acceptance script |
| The race suite, real PostgreSQL | **12 / 12**, with two new checks: one reset confirmed twice at once records one row, and a confirmation racing a second reset leaves the second owed |
| Deliberate breaks, 0112 | **4 of 4 caught**, below |
| Dacs Web `npm test` / `npm run test:sql` | **1,545 checks pass / 54 suites, 1,634 checks pass**, in UTC as CI runs them. That's one more suite than before (the 3b suite with 0112), and 57 more checks |
| The patches | Both apply cleanly: WorkMate at `7c8d86e`, Dacs Web at `b680167` |

**The new phone breaks, all caught:**
1. Notes confirmed for whichever account is signed in.
2. The state not asked again after a confirmation, which drops a newer reset's prompt.
3. No account check before asking or confirming.
4. Confirming with 0111's `wk_password_changed`.
5. A late note confirmed for whichever reset is open now. That's the bug this fixes.

**The 0112 breaks, all caught:**
1. A confirmation recording for a reset that is no longer open, as 0111 does.
2. The open reset decided by the order of the rows alone. The race suite caught it too.
3. No lock. The race suite caught it.
4. The internal helper opened to signed-in accounts.

**Found and fixed while building:** two of my domain tests compared timestamps to fixed values from the first capture. They now read the time from the captured answer itself.

---

## Revision 2: what was built and tested in scratch

**The patch:** `3b_b_phone.patch` — 33 files, 5,404 lines added, 4 changed. It applies cleanly to WorkMate `main` at `7c8d86e`.
- **New:** `lib/tools/` (16 files), `lib/profile/password_prompt.dart`, `lib/profile/set_own_password_screen.dart`, and 10 test files.
- **Changed:** `lib/ui/home_shell.dart` (the card, the Tools screen, the prompt), `lib/main.dart` (wiring), `lib/app.dart` (passes tools to Home), `lib/profile/account_services.dart` (the prompt's services, optional), `pubspec.yaml` (0.10.0+1012).
- **Untouched:** the stock code, attendance, Requests, My Work, the buyer screens, and the server.

### One change from revision 1
**The password prompt opens over Home, not as a step between Terms and Home.** `app_controller.dart` is unchanged. The reason is attendance: if the prompt became due while a Time In was in progress, for example the moment signal came back, replacing Home would have thrown that Time In away. Over Home, it waits until the Time In ends. A Time In tapped on the home-screen widget also comes first, and the prompt returns after it.

### How the prompt behaves (P1 = A)
- **Owed, with signal:** a full screen, "Set your own password". Back doesn't close it, and there is no way past it while nothing has failed.
- **No signal when asking:** Home, as normal. It asks again when the app comes back to the front, when a background send reaches the server, and every 2 minutes while there is no answer.
- **The change fails because of what was typed** (too short, not matching, the same password): the worker fixes it. There is no way past.
- **The change fails for any other reason** (no signal, a server fault, a lost sign-in): "Continue for now" takes them to Home and Time In.
  - After no signal, it is asked again as soon as the server answers again.
  - After a server fault, it isn't asked again for 15 minutes, so a broken server doesn't nag every 2 minutes.
- **Saved:** the change is recorded once. If the record can't be sent, the phone keeps a note and sends it later. The worker isn't asked again.
- **"Not you? Log out"** is there for shared phones. The change stays owed.

### Tests

| Check | Result |
|---|---|
| The existing suite, before any change | **1,013 pass**, analyze clean |
| New tests | **96**: tool data 15, the sender 31, the saved copy 6, the screens 15, the calls 4, the prompt 9, Home 16 |
| The whole suite, after | **1,109 pass** |
| `flutter analyze` | **No issues** |
| A debug APK | **Builds** |
| The server's answers in the tests | **Captured from the real `0111`** on a local database, not written by hand |
| The calls the phone makes | **17 functions and their parameters match** the `0106`, `0107` and `0111` files and the live database (read-only). Signed-out accounts are refused |
| Deliberate breaks | **11 of 11 caught**, below |

**What you asked to be tested:**
- **The prompt returns when signal comes back:** no signal at sign-in, then a background send reaches the server, and the prompt opens. The same happens on coming back to the app, and after "Continue for now" once the server answers.
- **Attendance stays reachable, including when the change fails:**
  - Time In opens after no signal at sign-in.
  - Time In opens after the change fails for no signal, and after it fails by a server fault.
  - A Time In in progress is never interrupted: the prompt waits for it to end.
- **Lost answers on tool actions:**
  - **Sender tests, for each of the five actions** (issue, hand over, return, undo, report a problem):
    - Recorded but the answer lost: Send again is answered, and the action is recorded once.
    - Check is read-only: it never sends anything.
    - Lost before it arrived: Cancel settles it for good, and a late copy is refused.
  - **Screen tests, one per action:**
    - A report sent again.
    - An issue settled by Check.
    - A handover cancelled and changed.
    - A return whose form was left: it waits at the top of Tools, nothing new starts meanwhile, and Send again works from there.
    - An undo cancelled.

**Deliberate breaks, all caught by the new tests:**
1. The prompt shown while the server can't answer.
2. The prompt never coming back after Continue for now.
3. No Continue for now.
4. The prompt opening over a Time In.
5. A background send not asking again.
6. A lost answer dropped.
7. Send again with a new operation id.
8. A form not locking after a lost answer.
9. The card shown with tools off.
10. NOT_YOUR_TOOL read as NOT_YOURS.
11. An issue sent without the leader confirming the tool.

**Found while building, and fixed before the patch:** the Issue screen's Find button had no width limit beside the number field, which crashed that screen's layout. The screen tests caught it.

### Not tested yet: the pilot covers these
- **Writes against the live server, on a real phone.** Writes were tested against fakes that use the captured answers. Live was only read.
- **The release build and its signing.** Only a debug APK was built.
- **The update screen offering 1012.** That's Task 6.

---

## Global constraints

- **No money.** The phone shows only what `0111` returns: no peso, purchase, office note or photo.
- **Attendance is never blocked.** Nothing in 3b-b stands between a worker and Time In or Time Out.
- **The server decides.** Team tools show only for the Team Leader role, and the phone still takes `NOT_LEADER` and `NOT_YOUR_TEAM` as the answer.
- **Lost answers follow the stock rule** (Q22). Tools keep their own saved list, apart from stock's.
- `min_app_version` stays 0. The old Attendance app gets no update, and `attendance-signin` doesn't change.
- **The user commits and pushes.** Publishing 1012 needs the owner's approval.
- English, with the Tagalog line underneath, on the key labels and every message, as in stock.
- No Linked Labor screen. No automatic account, team or link.

---

## What the phone shows

### Home: a My tools card
- Shown to every worker and team leader **once the server has answered**, for example "2 tools · 1 problem reported". Tapping it opens the Tools screen.
- **Tools switched off** (`TOOLS_OFF`): no card.
- **No tools:** the card says so, because the crew sees tools from the first day (Q4).
- **Buyers' screens:** unchanged. Buyers hold no tools here (`NOT_A_REQUESTER`).

### The Tools screen

**Mine** (everyone): the tools they hold now (`tl_my_tools`).
- Each shows its number (TOOL-0001), name, details, project, how many days they've had it, and its condition.
- A tool reported lost reads "Reported lost — waiting for the owner".
- Open problem reports show on the tool.
- Tapping a tool shows its history while they had it (`tl_my_tool`).

**Report a problem** (on a tool they hold):
- "I don't have this" or "It's broken", with an optional note, then Send.
- The same report twice is answered "Already reported — the office will check it" (`ALREADY_REPORTED`).

**Team** (leaders only): their team members' tools, grouped by person (`tl_team_tools`). Tapping one opens Hand over and Return.
- **Issue a tool:**
  1. Type the number. The phone shows the tool's name and details to confirm (`tl_team_find`). Anything not available gets one answer: "Not available to issue — check the number, or ask the office."
  2. Choose the person and the project (`tl_team_choices`).
  3. Optionally link a request line, with lines bought for this tool listed first (`tl_team_request_lines`).
  4. Add an optional note, then Send.
- **Hand over:** choose the new person, keep or change the project, add a note, then Send. Both people must be in their teams.
- **Return:** choose Good, Needs repair, Missing parts or **Damaged beyond repair**. A damaged return asks the owner to retire the tool, and reads "Waiting for the owner".
- **My records** (`tl_team_my_records`): their recent issues, handovers and returns. **Undo** shows only on the ones the server says they can still reverse, and it needs a reason (`tl_team_reverse`).

**A saved copy for weak signal:**
- Each list is saved on the phone, for that account, after a good read. Offline it shows "Saved copy from 7:42 AM".
- Writes need signal.
- Another account signing in on the same phone sees none of it, as with My Work.

**Lost answers:**
- A "Not sure this was recorded" panel sits at the top, with Send again, Check and Cancel it, worded as in stock.
- While one is unsure, that account can't send a new tool record. Stock and tools don't block each other.

### The password prompt
1. **When it's asked:** after sign-in and after Terms, the app asks the server whether a change is owed. It asks again on each open until it gets an answer.
2. **What the worker sees:** if a change is owed, a full screen titled "Set your own password", with Profile's fields and checks (8 or more characters, typed twice).
3. **What's saved:** Supabase saves the new password. Then the phone records the change (`wk_password_changed`).
4. **If recording it fails:** the phone keeps a note and records it the next time it can, without asking the worker again.
5. **No signal:** P1.

---

## How it's built

| Where | What |
|---|---|
| `lib/tools/data/` | **New.** Server calls (each `0111` function, with exactly its parameters), the saved copy per account, and the saved-before-send store and sender |
| `lib/tools/domain/` | **New.** The tool, record, choice and request-line models, read from `0111`'s exact answers; every refusal code with its wording |
| `lib/tools/ui/` | **New.** The card, the Tools screen with Mine, Team and My records, the issue flow, the hand over, return and report sheets, and the wording |
| `lib/auth/` and `lib/profile/` | **New:** the "change owed" check and the Set your own password screen, reusing Profile's password rules |
| `lib/app.dart` | Passes tools to Home. (Revision 1 put the password step here and in `app_controller.dart`; it is in `home_shell.dart` instead, see revision 2) |
| `lib/ui/home_shell.dart` | The My tools card on Home, opening the Tools screen, and the password prompt over Home |
| `lib/main.dart`, `pubspec.yaml` | Wiring, and 0.10.0+1012 |

**The sender is a copy of stock's, renamed for tools.** That keeps the published stock code untouched; the shared rules are proven by porting stock's own tests to it.

---

## Tests, before the patch is sent for review

- **Server answers:** the models read the exact JSON `0111` returns. The samples come from the 3b-a suite's real answers.
- **Every refusal** `0111` and `0107` can give a leader or worker has wording, and an unknown one reads "Something went wrong".
- **The sender:** saved before sending; a lost answer stays unsure; Send again is byte for byte; Check and Cancel; blocked while unsure; another account never sends it.
- **The saved copy:** kept per account, and wiped for anyone else.
- **The password step:** forced with signal, the P1 answer with none, recorded once, and the note retried.
- **Screens:** the card on and off, Mine, report a problem, Team for leaders only, the issue flow, hand over, every return condition, My records and Undo with a reason, the lost-answer panel, and the password screen.
- **Calls match the server:** a test lists every function name and parameter the app sends, and I check that list against `0111` and the live definitions, read-only.
- **Nothing else broke:** the app's whole existing suite (attendance included, as the roadmap requires), `flutter analyze` clean, and a debug APK builds.

---

## Tasks

| Task | What | Stops for |
|---|---|---|
| T1 | Tools data and domain, with tests | **Built in scratch** |
| T2 | Tools screens, with tests | **Built in scratch** |
| T3 | The password step, with tests | **Built in scratch** |
| T4 | 0.10.0+1012, the whole suite, analyze, a debug APK; **the tested patch is sent for review** | **Done.** Committed and pushed 6 Nov (WorkMate `052e4af`) |
| T4b | Migration `0112` and its tests in Dacs Web: one patch, reviewed with T4 | **Done.** Applied by the owner on 6 Nov and verified; committed and pushed (`6a04ef8`) |
| T5 | The pilot on the test phone (below) | **Passed, 7 Nov 14:40–16:26.** Results in *Revision 5* |
| T6 | Publish 1012 | **Published by the owner, 7 Nov 16:27** |
| T7 | Notes in this plan and the roadmap | **This revision**, and roadmap revision 13 |

---

## The pilot (Task 5): each step needs its own approval when it comes

It uses only the owner's test accounts, W-0005 and W-0007, and ZZ data.

**What it needs first:**
- **Migration `0112` applied on live**, with its own approval, before 1012 runs on any phone.
- **W-0005 as leader:**
  - The owner no longer has its password, so it needs a **temporary password**: a reset that needs the owner's approval. It would also test the prompt on a real phone.
  - It needs the **Team Leader role through the switch**, again on the owner's approval.
- **W-0007:** its record still says a change is owed, so **its first sign-in on 1012 shows the prompt**, and it gets a new password. The server refuses the current one.
- **A ZZ team** led by W-0005 with W-0007 in it, and **a ZZ tool** registered by the office. Tools are already switched on.

**What it checks:**
- My tools on the worker's phone, and a problem report reaching Requests → Tools.
- The leader issues by number, hands over, returns in each condition, and undoes their own latest record.
- A damaged return waits for the owner, and the owner rejects it.
- A lost answer: airplane mode during Send, then Check, Send again and Cancel.
- Another account on the same phone sees nothing of the first.

**Clean-up:**
- A guarded script, `3b_pilot_cleanup.sql`, adapted from 3a's and tested first.
- Then W-0005's role is switched back and the ZZ team is turned off.
- The role and password logs are append-only, so their pilot rows stay as history.

---

## Publishing (Task 6)

- 1012 becomes **required for phones already on WorkMate**, which today means buyers. Crew phones get it by hand at install (roadmap Part 3).
- Publishing needs the owner's approval, and the pause in Q11 applies from the first install day.

---

## Not in this version
- A leader recording lost or retired tools. The office does that on the web.
- Photos on the phone.
- Tools in the buyers' screens.
- Linked Labor.

## Found and not changed, carried from 3b-a
- **The old app ignores "must change",** and can't be updated. Only WorkMate asks.
- **Live tool records are ordered by time, with a random id breaking a tie.** This is a separate ordering issue. The phone shows the server's order and Undo as the server allows it.

---

## Self-review against your instructions

| You asked for | Where |
|---|---|
| Move on to the 3b-b phone screens once CI passes | CI passed 13:12, 6 Nov; this plan |
| Identify only what is still open | One question, P1; everything else is in *Already decided* |
| No publish, role change or reset without approval | Tasks T5 and T6; the pilot's list |
| Attendance never blocked; Messenger stays official | Global constraints; P1's recommendation |
| Build and test in scratch, then send for review | Tasks T1 to T4 |
| P1 = A; one tested patch for review | Revision 2; `3b_b_phone.patch` |
| Test that the prompt returns when signal comes back | Revision 2, *What you asked to be tested* |
| Test that attendance stays reachable, including when the change fails | Revision 2, *What you asked to be tested* |
| Lost-answer checks for the tool actions | Revision 2: all five actions, in the sender and on the screens |
| Publishing 1012, resetting either test account and W-0005's role stay separate pilot decisions | Status; Tasks T5 and T6 |
| Keep the prompt over Home | Revision 3 |
| The confirmation applies only to its account and reset; the smallest safe change if the API can't tell | Revision 3: migration `0112`, proposed and not applied |
| Test a lost confirmation followed by a second reset | Revision 3, *The two scenarios* |
| Test an account switch while a confirmation is pending | Revision 3, *The two scenarios* |
| In both, the outstanding prompt is kept and attendance stays reachable | Revision 3, each scenario's steps |
| Send the revised patch and results together, before applying | Revision 3; the two patches |
| Keep 0112 and the prompt over Home | Revision 4 |
| Bind the password-change request itself to the account that opened the prompt | Revision 4: `boundChange` |
| Regression test: A's prompt, switch to B, Save — B's password and reset state intact | Revision 4, on Home, at the prompt and on the real client |
| Run the affected checks; send the updated phone patch with 0112 for one review | Revision 4, *Results*; the two patches |
