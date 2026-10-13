# WorkMate — Stage 1c-2 Work Plan Office MVP terms

Date: 13 October 2026

Status: **Draft for review.** This document records the recommended conditions for revising and building the office Work Plan MVP. Creating it does not approve the implementation plan, start the build, apply migrations or deploy services.

## Purpose

Revise the Stage 1c-2 implementation plan to address the six issues identified in review, then use **Option 1: a fresh helper agent builds each step, and the controller reviews it before the next step begins**. Finish with a combined browser check of the complete office workflow.

The MVP covers the Dacs Web office screens for owner and staff. Phone My Work and My proposals remain Stage 1c-3 work.

## 1. Required plan revisions

| Issue | Required MVP behaviour | Evidence needed |
|---|---|---|
| Public AI service can be repeatedly called | Validate a signed-in, active office account on the server before running AI. Define and enforce request limits and input-size limits, alongside the model allow-list and answer-length caps. Preserve authorized access to the existing budget summary. Browser origin checks alone are insufficient. | Unauthorized, inactive, oversized and excessive requests are refused before an AI call. Authorized drafting and budget summaries still work. Record the chosen limits in the revised plan. |
| Small summary model is deprecated | Replace `@cf/meta/llama-3.1-8b-instruct` with a currently supported summary model. Verify availability before deployment. Keep meeting drafting on the approved Llama 3.3 70B model if it remains supported. | Confirm the selected model identifiers against current Cloudflare documentation and verify both features after deployment. |
| AI matching guesses a work or person | Match projects, Additional Works, teams and people only when the match is unique. An unknown Additional Works name must not become Main Contract. Duplicate names require an explicit choice or a unique worker number. | Tests cover unknown Additional Works and duplicate project, team and worker names. The form visibly requires unresolved choices to be reviewed. |
| Significant edits can retain old acknowledgements | Changes to instructions, assignments or planned dates require a new task version and acknowledgement. Detect these changes automatically; do not depend on an unchecked checkbox. Preserve the agreed distinction for minor spelling corrections without allowing date or assignment changes to bypass versioning. | Tests demonstrate the required version change and that old acknowledgements do not count for the revised version. Verify the boundary on the server as well as in the form. |
| Meeting edits disappear when the screen redraws | Preserve unsaved original notes, shared notes and recipient selections when adding or editing a task, saving notes or completing AI drafting. AI drafting must not overwrite reviewed text. | Browser checks confirm edits survive these actions and failed AI requests. |
| Older dependencies disappear on full save | Preserve every existing dependency when editing a task, including links to tasks completed more than 30 days ago. Removing a link must be an explicit office action. | A test and browser check show an older dependency survives an unrelated edit and disappears only when deliberately removed. |

Revise the affected code examples, test cases, deployment steps and expected results in the implementation plan before building. Tests must check the behaviour above, not only the presence of particular strings in source files.

Any required server change must use a new migration numbered above the highest migration on disk. Do not edit an already applied migration or rely on an unrecorded SQL-editor change. Recheck migration numbers before creating files.

## 2. MVP feature scope

- **Work Plan navigation:** a top-level section with Board and Meetings, including permitted drill-down views for accounts granted this module.
- **Task form and Board:** create and edit tasks, select project and Main Contract/Additional Works, team or individual responsibility, helpers, planned dates and dependencies. Display the agreed office groups and alerts.
- **Task detail:** current acknowledgement status, blockers, photos, history and office decisions: Publish, Approve, Send back, Reopen and Cancel/Decline.
- **Meetings:** save original notes, draft tasks with AI or by hand, review each suggestion in the form, select recipients and publish reviewed tasks with shared notes.
- **Proposal lookup:** a read-only function returning only the caller's own proposal outcomes and cancellation/decline reasons, without office-only fields.

AI suggestions stay in the open browser session until the office saves a reviewed task. Reloading may discard unsaved AI suggestions; it must not discard tasks or original notes already saved to the server. The page must explain this limitation.

Manual creation and publication must work when AI is unavailable. AI never publishes, clears blockers, approves completion or changes live assignments by itself.

## 3. Roles and business boundaries

- Owner and staff may use Work Plan. PM-only accounts require an explicit Work Plan grant in `allowed_modules`.
- Workers and team leaders use the later phone screens; they do not gain access to the office portal.
- A leader sees only their own proposals through the new lookup. Declining an unpublished proposal uses cancellation with a required reason that the proposer can read.
- Worker-visible tasks and shared notes must exclude restricted money and private personnel information. Office review remains necessary; AI redaction alone is insufficient.
- Every assigned person acknowledges the actual current version. A leader's check does not replace final office approval.
- Only the office clears blockers, with a note. Material delivery alone does not clear a blocker or create an inventory movement.
- Work Plan does not create purchases, attendance entries, payroll, invoices or accounting entries, and does not alter Spent, Earned or Profit.
- Projects and Additional Works use `folders` identifiers. Do not substitute `construction_projects` identifiers or treat billing periods as projects.

## 4. Option 1 — implementation and review

After the revised implementation plan is approved:

1. The controller confirms the step's scope, interfaces, affected files and acceptance checks.
2. A fresh helper agent implements that step and runs its applicable checks.
3. The controller reviews the complete change against these terms, the design and repository instructions. Check every affected save, render, print and export path where applicable.
4. Resolve findings and repeat affected checks before accepting the step. A green source-shape test alone does not establish correct browser or database behaviour.
5. Record the accepted result and carry the reviewed interfaces into the next step. Continue with a fresh helper agent.

Use this process for implementation Tasks 1–7, adjusted for the required revisions. Task 8 remains the controller/user integration stage for database application, worker deployment and the combined browser check.

Do not request a separate user approval for every routine implementation step after build approval. Escalate unresolved business choices or scope changes with a concrete proposed result.

Do not commit, push, apply migrations or deploy from an implementer step. Keep the existing plan's user-controlled application and deployment arrangement. Never run `npm run build`.

## 5. Final combined verification

Run the relevant local suites and syntax checks on the final combined files. Run `npm test`, including the new suites; money changes, if any become necessary, must satisfy the repository's money tests. Record actual results rather than treating expected test counts as evidence.

Dry-run new migrations with controlled, self-rolling-back acceptance checks before the user applies them. Verify the applied functions and permissions, then verify the deployed AI service. Document the final deployment order and dependencies.

Check the complete office workflow in `admin.html`:

- Owner creates, edits and publishes a manual task without AI.
- Meeting notes produce suggestions; unknown or ambiguous matches require review before saving.
- Shared-note edits and selected recipients survive task edits and page redraws, then publish to the intended people.
- A significant published-task revision changes its version and leaves previous acknowledgements historical.
- An older completed dependency survives an unrelated task edit.
- Available blocker and completion scenarios exercise required notes/reasons, approval, send-back, reopening and cancellation. Use controlled fixtures where the unfinished phone screens cannot supply the action.
- Staff can use the module without restricted amounts. A PM-only account cannot open it; an account explicitly granted Work Plan can open its detail views.
- Existing Requests, Item History and AI budget summary still work, including Requests popups affected by the shared-modal change.
- AI failure preserves notes and reviewed work; manual drafting remains usable. Unauthorized and excessive AI requests are refused.

Phone acknowledgement, offline synchronization, My Work and My proposals UI checks remain deferred to Stage 1c-3/1c-4. Do not report them as verified by an office browser check.

## 6. Completion and evidence

The office MVP is complete when the six review issues are resolved, each implementation step has passed controller review, applicable local and database checks pass, and the combined browser workflow has passed in the intended environment.

Keep a verification record with the environment, date, reviewed changes, test results, browser results, failures and fixes, and any checks still deferred. Identify test fixtures before cleanup; roll back or cancel them as appropriate while preserving history and real records.

The existing scratch results—5/5 proposal source checks and 18/18 core checks after the planned popup change—are preliminary evidence only. They do not establish live database permissions, deployed AI behaviour or complete browser behaviour.

## References

- [Stage 1c-2 implementation plan](../plans/2026-10-13-workmate-stage1c2-work-plan-office.md)
- [Meetings and Work Plan design](2026-09-30-workmate-meetings-work-plan-design.md)
- [Stage 1c-1 verification record](2026-10-12-workmate-stage1c1-verification-record.md)
- [Repository architecture](../../ARCHITECTURE.md)
- [Cloudflare model deprecation notice](https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/)
