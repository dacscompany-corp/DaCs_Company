# WorkMate Linked Labor, part B: My agreements on the phone — plan for review

Date: 8 November 2026

Written for: the owner, and whoever applies, reviews and pilots it.

**Status:** Revision 2, for review. **Built and tested in a scratch copy of WorkMate only.** Nothing is committed, built into an APK, installed or published. **Release timing is pending, and it is the owner's to choose.**

**Needs part A live first:** the phone calls 0113's `ll_my_agreements`. Part A is `2026-11-08-workmate-linked-labor-a-server-web.md`. The design is `docs/superpowers/specs/2026-11-07-workmate-linked-labor-design.md`.

**What changed in revision 2 (the owner's review, 8 Nov):** **every amount is hidden the moment a fresh read starts.**
- This covers opening the screen, coming back to the app and pulling down. Revision 1 kept the last figures on screen while it asked the server again.
- The list and the detail now show "Checking your agreements… / Sinusuri ang mga kasunduan mo…" until the server answers.
- After a failure they show why. After an unlink they say the agreement isn't shown any more.
- **No old figure is visible while checking, or after a failure.** New tests cover reopening with no signal and coming back to an open detail after an unlink.

---

## What the worker sees

**A "My agreements" card on Home.**
- It appears only after this session's check finds at least one agreement linked to their account.
- **No amount is shown on Home.**
- With no signal there's no card, because nothing is saved. The card also steps aside while a fresh check runs.

**The list.** For each agreement:
- the project (and "Additional Works of …")
- the scope and trade
- "Overall project progress: 42.5%", or "Progress not recorded yet"
- "Daily basis", "Ended 3 Nov 2026" and "Project completed" chips
- **fixed:** Agreed / Paid so far / Balance, or "Over by"
- **daily:** Paid so far only

**The detail:**
- the works
- each payment as date · method · amount
- the footnote: "Payments are the company's records. Progress is the whole project's, not your own work." (in English and Tagalog)

**Online only (Q2):** the amounts live only in the screen controller's memory, for one account. They are **cleared** when:
- **a fresh read starts**: "Checking your agreements…" shows until the answer
- a refresh fails ("Needs signal to show your agreements. Nothing is saved on this phone.")
- the server refuses (switched off, not a worker)
- an agreement drops off the server's list
- another account opens Home
- the person logs out

## Global constraints

- **No SQLite, preferences or file holds any Linked Labor data** (a test greps the code for them).
- One server call: `ll_my_agreements()`, no parameters. **It's refused on the phone unless the sign-in is this account's** (`AUTH_REQUIRED`), so a shared phone never shows the last user's money.
- No change to Attendance, Tools, Requests, My Work, the password prompt or any permission.
- Version **0.11.0 (1013)**. Built and published **only on the owner's approval**. Once the first crew install day happens, the 0E publish pause (rule 14) applies: no publish until a week after the switch-over, unless the owner approves an exception.
- The user commits and pushes.

## Files (patch `ll_b.patch`, 16 files)

| File | What |
|---|---|
| `lib/agreements/domain/my_agreement.dart` (new) | `MyAgreement`, `AgreementPayment`, `AgreementsFailure` (no signal, not allowed, wrong sign-in, update needed, unexpected) |
| `lib/agreements/data/agreements_remote.dart` (new) | `SupabaseAgreementsRemote`: the one read, refused unless the sign-in is this account |
| `lib/agreements/agreements_services.dart` (new) | the optional service, built in `main.dart` |
| `lib/agreements/ui/agreements_controller.dart` (new) | online-only state; **clears before every read**, and in every case above; only the latest read counts |
| `lib/agreements/ui/agreements_card.dart`, `agreements_screen.dart`, `agreements_copy.dart` (new) | the Home card, the list and detail screens (with the "Checking…" state), English + Tagalog words |
| `lib/main.dart`, `lib/app.dart`, `lib/ui/home_shell.dart` | wiring. Home makes the controller for this worker, refreshes it on resume, disposes it on logout, and **makes a new one if another account opens the same Home** |
| `pubspec.yaml` | 0.11.0+1013 |
| `test/agreements/*` (4 new), `test/ui/home_agreements_test.dart` (new) | below |

## Tasks

| # | Task | Who | Approval |
|---|---|---|---|
| T1 | **Apply the patch** to the WorkMate working tree. Run `flutter analyze` and `flutter test` on the real tree | Me | **This review** |
| T2 | **Commit and push.** Nothing reaches a phone: no APK is built | The user | The user |
| T3 | **Build a signed 1013 APK**, unpublished, and check its signature and version | Me | **Its own approval**, after part A's 0113 is live and its web is pushed |
| T4 | **ZZ pilot on the test phone** with W-0005 / W-0007, using part A's ZZ contracts. It covers the card, list and detail; no signal; reopening with no signal; unlinking while the detail is open, then coming back to the app; another account; logout | Both | **Its own approval** |
| T5 | **Publish 1013** | The user | **Its own approval**, and the 0E publish pause if installs have started |

## How it was tested (scratch, 8 Nov, revision 2)

**`flutter analyze`: no issues. `flutter test`: 1,158 of 1,158** (1,126 before Linked Labor + 32 new).

**Model (2):** fixed, Additional Works, daily and over-cap read as sent; a daily agreement never carries an agreed total or balance, whatever arrives.

**Controller (9, plus the 2 checks below):**
- a good read shows this account's agreements, with the time
- **a fresh read hides the old amounts before it starts, and they stay hidden when it fails** (new)
- **no signal clears the amounts**
- a refused account clears them
- an unlinked agreement disappears
- a phone signed in as someone else shows nothing
- `clear()` and logout drop everything, and a late answer can't bring it back
- only the latest read counts

Also checked: Linked Labor's code holds no database, preferences or file, and failure codes read as the server says them.

**Screens (11):**
- the Home card only after a read finds agreements, and never an amount
- fixed figures and the project's progress
- Additional Works names its main project and shows its own progress
- daily shows Paid so far only, with the Ended and Completed chips
- "Over by", and no progress is never 100%
- the detail's works and payments
- no signal: every ₱ leaves the screen
- an open agreement that gets unlinked shows no amount
- a switched-off account sees why
- **reopened with no signal: no ₱ while checking ("Checking your agreements"), and none after** (new)
- **an open detail shows no ₱ while checking, doesn't say "gone" before the answer, and says so after an unlink** (new)

**Contract (2):** only `ll_my_agreements`, no parameters; refused before asking when signed out or signed in as someone else.

**Home, the real Home screen (6):**
- the card opens the screen
- no card with no signal, and nothing else on Home changes
- another account on the same Home never sees the last account's agreements
- no service, no card
- **reopening My agreements with no signal: no old figure while checking, and none after** (new)
- **back in the app with a detail open, after an unlink: no old figure while checking, and none after** (new). The app goes to the background and comes back; the agreement was unlinked meanwhile.

**Deliberate breaks: 5 of 5 caught:**
- Home keeps the last account's agreements
- a failed read says nothing about why
- the phone asks without checking whose sign-in it is
- **a fresh read leaves the old amounts on screen while checking** (new)
- **an open detail says "gone" before the server has answered** (new)

Revision 1's break "a failed refresh keeps the old amounts" is no longer a rule of its own, because every read now clears first. The clearing on failure stays as a safety line, but no test can tell it apart, so that break was replaced by "says nothing about why".

## Not tested yet: the pilot covers these

- a real phone, real signal loss, and a real account switch
- the server's real answers (part A's live functions)
- Tagalog wording on a small screen

## Not in this part

- a saved offline copy (Q2 = A)
- notifications
- receipts or "I got paid"
- any other account's agreement
- Project Management contracts
