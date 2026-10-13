# WorkMate — Stage 1c-1 verification MVP terms

Date: 12 October 2026

Status: **Draft for review.** Creating this document does not run tests, change the application or database, approve new behaviour, or authorize building 1c-2.

## Purpose

Check that the My Work server is ready for the next planning step while existing Requests and Item History continue to work.

“This MVP” covers the verification steps recommended in the review. The office Work Plan screen (1c-2) and phone My Work screen (1c-3) remain separate work.

## 1. First priority — recheck existing features

Run these existing acceptance scripts against the intended environment:

- `supabase/tests/1a_acceptance.sql` — Requests.
- `supabase/tests/1b_acceptance.sql` — Item History.

Use the scripts' test accounts and self-rolling-back transactions. Preserve real requests, history, worker accounts and photos. Confirm rollback completed and no test records remain.

Record the environment, date, script version, result and any failure. If a check fails, distinguish a real regression from a test/setup problem, resolve it, and repeat the affected check.

**Pass condition:** both scripts pass in the intended environment. “No old functions were changed” is not a substitute for running them. Local static tests support, but do not replace, database acceptance checks.

## 2. Simultaneous-use checks

Use two independent sessions to test the four situations named in the execution notes:

| Situation | Required result |
|---|---|
| Two people save task dependencies at the same time | Saves finish or return a clear, recoverable conflict. No circular or cross-project dependency is accepted. |
| One person cancels a task while another links a task that waits for it | A task cannot be cancelled while a valid dependent task still waits for it; the final result remains consistent. |
| One person clears a blocker while another attaches a photo | Operations finish consistently or return a clear, recoverable conflict. No stuck transaction or incorrectly linked photo. |
| Two people publish overlapping task lists in opposite orders | Publishing finishes consistently or returns a clear, recoverable conflict. No duplicate publication or partly published result from a failed operation. |

Also confirm that moving a draft to another project is refused while another task depends on it.

Record both sessions' actions and final saved state. A single-user test does not prove simultaneous-use safety. Repeat an affected scenario after a fix.

**Pass condition:** these scenarios preserve the task rules without indefinite mutual waiting or partial results.

## 3. Clarify offline and access behaviour

Carry these expectations into the next office and phone plans:

- **Reading and starting are separate.** The worker deliberately acknowledges the current instructions before Start. The phone must not acknowledge automatically on their behalf.
- **Changed instructions must be shown.** An old offline acknowledgement cannot count as reading a new version. When synchronization reveals a revision, show the current instructions and ask for a new acknowledgement before accepting Start.
- **Offline actions remain pending until accepted.** Distinguish a queued action from a server-confirmed action.
- **Deactivation blocks new server access and actions.** Do not promise that a disconnected phone instantly loses information already downloaded.
- **Unfinished tasks remain visible to the office.** Deactivation must not erase history or hide unfinished work. The office must be able to identify and reassign affected tasks using the planned task-management controls.
- **History visibility needs a clear boundary.** The office retains acknowledgement/proposal history. Workers need their own acknowledgement status. Specify how a leader sees the receipt/status of their own proposal for review; this document does not approve additional visibility.

Verify the server-side acknowledgement and inactive-account rules now using controlled test records.

**Pass condition for planning 1c-2:** server rules are checked, offline limitations are documented, and unresolved worker-facing choices are identified.

Actual phone cache, revised-instruction display and queued-action behaviour require end-to-end checks in 1c-3/1c-4. Mark them **not yet tested** until the phone implementation exists. Building the phone is not part of this verification scope.

## 4. Evidence and handover

Deliver a short verification record containing:

- Results of the 1a/1b acceptance checks.
- Results and final states for each simultaneous-use scenario.
- Results of server acknowledgement and inactive-account checks.
- Any failure, fix and successful repeat check.
- Confirmation that temporary test data was rolled back or removed.
- Clear separation of checks passed, failed and not yet performed.
- Offline expectations and decisions still needing the user's review.

Existing passing local checks may be reused if relevant files have not changed. Repeat affected checks after changes; run required repository checks if a fix touches application or money code.

## 5. Scope limits

This scope excludes:

- Building the office Work Plan screen, AI drafting or phone My Work screen.
- Purchasing, petty cash, stock movements or project cost transfers.
- Applying another migration, changing production permissions, committing, pushing or deploying.
- Changes to Attendance, payroll, invoices or the project's money calculations.

If a check reveals a defect, record its cause and proposed fix. These terms alone do not authorize new business rules or an unrelated feature expansion.

## 6. Completion and next step

This scope is complete when the required server, regression and simultaneous-use checks pass, evidence is recorded, temporary test data is cleared, and offline expectations are documented with remaining phone checks explicitly deferred.

Next: prepare **a reviewable 1c-2 implementation plan** for the office Work Plan section. Completing verification does not automatically approve or start that build.

## References

- [Stage 1c-1 server plan and execution notes](../plans/2026-10-12-workmate-stage1c1-my-work-server.md)
- [Meetings & Work Plan design](2026-09-30-workmate-meetings-work-plan-design.md)
- [Stage 1c decisions](2026-10-12-workmate-stage1c-questions.md)
