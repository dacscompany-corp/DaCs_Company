# Project Management staff entry permissions — proposed implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task only after owner review. This document authorizes no implementation or live change.

Date: 9 November 2026

**Status:** Draft for owner review. Repository inspection only; no live database audit or scratch implementation has been performed. Test cases below are required work, not passing results.

**Goal:** Preserve staff's Project Management Daily Expenses work and necessary payment amounts while enforcing restrictions on project deletion, contract changes and confidential totals in both the server and the screens.

**Architecture:** Keep existing PM records and money calculations. Staff uses narrow server functions returning permitted fields, rather than full project, bill and contract rows. Owner and client/partner paths retain their existing behavior. Replace broad staff table/storage access only after the restricted entry path is ready and tested.

**Tech stack:** Plain HTML and JavaScript, the existing Supabase compatibility shim, PostgreSQL RLS and authenticated server functions; no build step.

**Spec:** Owner instructions in this chat on 9 November 2026: staff@ records Daily Expenses in Project Management; preserve that workflow and entry amounts; propose restrictions separately; identify other affected workflows before changing permissions. Repository rules: AGENTS.md, CLAUDE.md and docs/ARCHITECTURE.md.

## Global constraints

- Planning only. Do not edit application code, create/apply a migration, change roles, commit, push or run a live write under this instruction.
- This is separate from Linked Labor's browser check, cleanup and phone release. No changes to Linked Labor, WorkMate, attendance, rewards or the Messenger switch-over.
- Preserve all real records and current money calculations. A permission change creates no cost, payment, bill, contract change or reclassification.
- Never run `npm run build`. Preserve the owner's uncommitted admin.html whitespace edit and all other working-tree changes.
- PM uses construction_projects and weekly_bills; PC uses folders/projects/payroll. Do not substitute their IDs, grant rules or payment paths.
- Buyer privileges in Purchasing do not authorize PM contract values, management fees, profit or project balances.
- No blanket revocation from the authenticated database role: owners, staff, clients and partners share it. Adjust policies and function checks by actual caller and project/company.
- Migration number is highest on disk plus one at implementation time. Highest inspected now is 0113; 0114 is provisional, not reserved.

## Evidence and current behavior

| Surface | Inspected source | Consequence |
|---|---|---|
| Project list/open/edit/delete | js/pm-admin.js: _pmLoadProjects, _pmRenderProjectCards, pmOpenProject, pmOpenProjectById, pmDeleteProject, _pmDeleteProjectCascade | Project browsing currently receives complete construction_projects rows. Delete loops through children before deleting the project: restricting just the parent is insufficient. |
| Daily Expenses loading | _pmLoadWeekBuilder, _pmWeekSyncDraft, pmWeekViewBill | Loads weekly bills and reopens saved days for editing; old total-only bills are synthesized into entry lines. |
| Daily Expenses saving | pmWeekSave, _pmWeekTotals, _pmWeekRecompute | Browser sends entries plus labor/materials/overhead, management fee and grand total. Staff cannot retain this unrestricted write path while those fields are confidential. |
| Contract allocation | _pmLoadLaborContracts, _pmLoadOutsourceContracts, pmWeekContractHint, pmWeekOutsourceHint, pmWeekContractCheckChanged | Entry needs contract selection and possibly splitting, but currently obtains full contracts including caps/history. Both Labor and Out Source paths matter. |
| Contract operations and documents | pmLc*/pmOc*, pmLcxWorkerAgreement, pmPrintAllContracts, _pmContractFilesViewer | Edit, Raise cap, Merge, Delete, ledger and document routes must be guarded individually, including direct function calls. |
| RLS | 0002_rls.sql cproj_admin and PM child *_admin policies; 0015_pm_labor_contracts.sql pm_lc_admin | Broad owner-or-staff table access exists in repository migrations. A live policy inventory is required before treating these as current live definitions. |
| Company boundary | 0098_pm_profit_sharing.sql pm_project_companies, pm_caller_company; 0099 verified mapping | Reuse trusted project-company mapping. Do not infer company from project creator/email/name or let staff create mappings. |
| Upload access | uploads_can_read/uploads_can_write, latest inspected definition in 0110_pm_sharing_items.sql; storage.objects policies | A broad staff branch and uploader-readback branch can allow contract files even after screens hide them. Storage requires its own review. |
| Nav and secondary consumers | admin.html PM workspace; js/admin.js PRIMARY_NAV and _FOCUS_SUBVIEWS; js/pm-report-print.js; js/client-management-app.js | Direct routes, printing, focused owner accounts and both client/partner portals require regression coverage. |

Relevant supporting files: js/supabase-config.js REG entries for constructionProjects and its children; docs/PROJECT_MANAGEMENT_MVP.md; docs/DATABASE_SCHEMA.md; tests/helpers/pm-admin-sandbox.js; tests/pm-sharing.test.js and tests/pm-sharing-items.test.js.

## Proposed permission boundary

All changes in this table are proposals until the plan is approved.

| Capability | Proposed staff behavior | Owner behavior |
|---|---|---|
| Find/open a project | Names, location, status and ID needed to select the job; open Daily Expenses directly | Existing views |
| Daily Expenses line entry | Preserve details, dates, days, quantity/unit, categories, entered amount and receipt attachments | Existing behavior |
| Choose a contract | Safe labels: contract ID, recorded person, scope, category and daily/fixed basis; no agreed amount, balance, paid percentage, signatures or files | Existing contract details |
| Split a payment | Preserve attributable entry amounts. Server calculates any allocation depending on hidden caps; return allocated payment legs only | Existing behavior |
| Project creation/edit/delete | Refused on server; remove actions from staff screens | Existing authorized operations |
| Contract create/edit/cap/merge/delete/files | Refused on server and screen, including Labor and Out Source | Existing authorized operations |
| Confidential figures | No management fee/rate, client contract value, budget, bill grand total, remaining cash, receivables, profit, cap or balance in responses, DOM, errors, prints or exports | Existing behavior |
| Stored entry amounts | Visible where necessary to enter/check the day's work, without billing summaries or financial dashboard | Existing behavior |
| Project-wide charts, statements and client bills | Owner-only by default; any required staff receipt print must be a separate limited output | Existing behavior |
| Other operational PM tabs | Inventory first. Do not silently remove necessary work or leave a broad backdoor | Existing behavior |

Staff can still infer some spending from the payment lines they are authorized to see. The promise is to withhold confidential fields and contract totals, not to make arithmetic on legitimate entry data impossible. A cap refusal is also a possible probing channel; use a generic message and no amount/remaining-limit disclosure. Do not claim the limit is mathematically undiscoverable.

## Workflows needing owner confirmation before enforcement

Only Daily Expenses entry has been confirmed. Resolve these in one review rather than assuming the whole PM section is unused:

| Workflow | Current coupling | Proposed starting position |
|---|---|---|
| Updating saved/sent or paid days | _pmWeekSyncDraft reopens existing bills, and pmWeekSave updates them | Preserve viewing permitted line data. Confirm whether staff may update sent/part-paid/paid days; do not silently remove editing or enable it for new cases. |
| Removing entries/deleting bills | Removing a line before Save differs from deleting an entire saved bill | Keep unsaved-line removal. Recommend owner-only whole-bill deletion; agree on corrections to saved lines before implementing. |
| Save & send to client | Current Save creates a Submitted bill, not a separate staff draft | Preserve current submission behavior with server-computed totals unless owner explicitly chooses an approval step. Do not introduce an approval workflow as a hidden side effect. |
| Receipt/invoice/SOA printing | Current category statements and bill prints can include totals and management fee | Recommend owner-only statements/client invoices. Confirm whether staff needs a limited payment receipt; do not expose contract/billing totals to provide it. |
| Procurement and revolving funds | Separate screens and tables with amounts and writes | Ask whether staff uses these. If yes, define permitted entry amounts/actions before replacing their broad policies. Purchasing Buyer access is a different authorization. |
| Progress, reports, milestones, daily logs, walkthroughs | Operational actions may share project reads/navigation with confidential reports | Identify actual staff needs; supply permitted progress/status separately where needed. Do not grant financial reports merely to preserve an operational task. |
| Categories, receipt inbox, alerts | Category management, intake/review and notifications can depend on full project/bill data | Preserve necessary selection/entry fields; owner-only configuration if it changes financial rules. Check email/push payloads for hidden totals. |

Until these decisions are recorded, this plan is ready for design review but not for a live permission cutover.

## Review focus

1. Old open tabs and direct requests must not bypass new restrictions or partially delete a project.
2. Client/partner read policies, partner signature gates and focused owner access must continue working, without becoming alternative staff access paths.
3. Hidden management fees and contract amounts must never be accepted from a forged staff payload or returned through errors, files or derived labels.
4. Two staff/owner edits of one day, a lost response and a retry must not overwrite another save or create another bill/payment.
5. Legacy bills, split payments and Labor/Out Source/Overhead categories must retain exact amounts and existing funding/billing behavior.

## Task 1 — Finish the access inventory and confirm the matrix

**Files:** this plan; docs/PROJECT_MANAGEMENT_MVP.md (future dated permission section only).

**Produces:** approved action matrix and a complete table/function/storage/consumer inventory; no permission changes.

- [ ] Enumerate every PM read/write in pm-admin.js and related modules, shim registry, storage paths, receipt inbox, notifications, prints and exports. Include any callable security-definer function or view that can return underlying PM data.
- [ ] Read live definitions and grants when the owner's connection is available. Record mismatches with repository migrations, including legacy permissive policies and profile/client-email routes. No live writes.
- [ ] List all references from non-PM modules before restricting tables. Include PC's reader of PM entries when tagged to a PC contract, client/partner portals and sharing/cash-advance functions.
- [ ] Confirm the workflows table above with the owner; record the result without changing permissions.
- [ ] Select the exact entry allowlist and category semantics from current production code. Treat old total-only bills explicitly; do not fabricate missing overhead or receipts.

## Task 2 — Restricted staff server API, tested in scratch

**Create:** next-numbered `supabase/migrations/NNNN_pm_staff_entry_access.sql`; `supabase/tests/pm_staff_access.pglite.mjs`; `supabase/tests/pm_staff_access_concurrency.mjs`.

**Modify later:** package.json SQL test list, docs/DATABASE_SCHEMA.md, supabase/migrations/README.md.

**Proposed interfaces** (final signatures must incorporate Task 1 decisions before coding):

- `pm_staff_projects()` returns project `{id,name,client_name,location,status}` only, using trusted company mapping and active staff/PM access checks. No client email, terms, rate, value or aggregates.
- `pm_staff_day(p_project uuid,p_date date)` returns `{bill_id,revision,entries,contract_options}`. Entries contain permitted recorded line fields and receipt references only; contract options contain `{id,worker_name,scope,category,pay_basis}` only. No bill/contract totals or management rate. Date is a PH-local calendar date.
- `pm_staff_save_day(p_project uuid,p_bill uuid,p_date date,p_revision bigint,p_operation uuid,p_entries jsonb)` atomically validates/writes the allowed daily entries, calculates existing bill fields on the server and returns only `{bill_id,revision}`. Never trust a caller's fee, status, agreed amount, company or project mapping.
- Any split-preview endpoint accepts the selected contract IDs and proposed payment amount, returns only payment legs, and is revalidated in the save transaction; it does not reserve money or leak caps.
- New revision/idempotency data requires actual columns or tables and documentation. Keep operation identity and exact payload together; same operation with a different payload is refused. A retry never produces a second bill.

- [ ] Write failing tests first for staff direct SELECT/INSERT/UPDATE/DELETE, unauthorized function calls and forged IDs/fields. Assert both refusals and unchanged rows.
- [ ] Implement server checks for active caller, company mapping and module restriction; validate receipt paths, category/contract compatibility, numbers and length limits. Cross-project/cross-company contract selection is refused.
- [ ] Reproduce the existing PM calculation and split behavior with parity tests before using it for staff writes. No new wage, cap, fee or billing formula.
- [ ] Use row locks and explicit revisions for saved-day edits. Define one day identity consistently with legacy data; report pre-existing duplicate days rather than silently merging/deleting them.
- [ ] Lock affected contracts in stable order for simultaneous drawdowns. Test concurrent owner cap changes, competing staff saves, stale revisions, lost replies and replayed operation IDs with different payloads.
- [ ] Replace broad staff PM policies with role/company-aware policies and safe functions. Preserve client and partner policies only for their intended roles; a staff profile with a matching email must not bypass the restriction.
- [ ] Refuse staff writes to parent projects, all contract-changing routes and child deletes used by the old cascade. Cover pm_labor_contracts and related document changes, not only construction_projects DELETE.
- [ ] Review shared payment_requests separately by project/flow; preserve legitimate non-PM and client payment behavior. Do not revoke a shared table globally.
- [ ] Check owner, focused owner, staff, inactive staff, another company, worker, client and partner; also test direct database/API requests and secondary functions, not only the UI.

## Task 3 — Staff entry screen and file boundary

**Modify:** js/pm-admin.js, admin.html, js/admin.js as needed, js/supabase-config.js only if required for real new fields; shared print/notification consumers found by Task 1.

**Create:** js/pm-staff-entry.js and tests/pm-staff-access.test.js. Reuse tests/helpers/pm-admin-sandbox.js.

**Produces:** staff Project Management opens permitted project selection and Daily Expenses, using only the restricted API. Owner path remains unchanged.

- [ ] Write failing behavioral tests for project list/open, direct workspace tab requests and every hidden action. Calling an owner handler from the console must stop before child writes/uploads; server refusals remain authoritative.
- [ ] Route staff away from full-project metrics, full-bill loads and full-contract loads. Do not put confidential rows into global caches or DOM attributes and merely hide their labels.
- [ ] Preserve manual details, quantity/days, payment amounts, relevant categories, contract selection, split legs and permitted receipts. Draft input survives a refused or stale save.
- [ ] Keep private fee/total calculation off the staff client. Preserve owner/client rendering and both portal HTML files if a shared HTML change is needed.
- [ ] Clear staff entry state on account change/sign-out; stale async replies cannot populate another account's screen. Keep retry payloads/account identity bound through uploads and save.
- [ ] Inventory contract/terms/receipt files and current URL behavior. Place PM-specific Storage checks BEFORE broad staff or uploader-readback branches; preserve authorized weeklyBillReceipts while denying laborContractFiles/projectTerms and other confidential files as the approved matrix requires.
- [ ] Include Storage SELECT, INSERT, UPDATE, DELETE, listing and signed-link creation. Existing issued/public URLs cannot be declared revoked without verifying their serving behavior; document any remaining exposure and proposed remedy for review.
- [ ] Guard print/export, context-menu/drilldown, notifications and category statements. Use only limited outputs explicitly approved in Task 1.
- [ ] Real browser checks: staff entry workflow; owner full view; focused owner; direct tab URL/console invocation; offline read failure; account switch; inaccessible files. Use synthetic data with guarded exact-ID cleanup.

## Task 4 — Verification and reviewed cutover

**Create:** `supabase/tests/pm_staff_access_acceptance.sql` and a read-only after-check. Add rollback instructions that name the protection lost by rollback.

- [ ] Run npm test, syntax-check changed/all relevant JavaScript, the new server/concurrency suites and the full SQL suite on the combined scratch build. Include PM sharing/items, PC money/staff and client/partner regression tests. Never npm run build.
- [ ] Deliberately remove a representative role guard, company guard, hidden-field filter, forbidden-write check, Storage guard and replay check; each corresponding behavioral test must fail. Restore every file before final proof.
- [ ] Confirm unchanged real financial/contract records with read-only baselines; do not use a production snapshot as deletion authority.
- [ ] Rehearse the final migration and web pair on a fresh copy, including the owner's admin.html edit. Record exact tested files and results; do not substitute planned counts for actual results.
- [ ] Present one combined review package: matrix, patch, migration, tests, impacted workflows and deployment/rollback instructions.
- [ ] Plan a coordinated server/web cutover after approval. Prefer the server restriction first during a short announced entry pause, then web deployment. Old tabs must fail closed without making a partial save/delete; explain the temporary entry interruption before approving the window.
- [ ] Never use a fallback that restores broad reads or skips server protections. If legacy tabs cannot safely fail closed, design and review a versioned transition before deploying.
- [ ] Only with separate live approval: read baseline, apply migration, verify, deploy matching web, hard-refresh office tabs and run owner/staff checks. No real project deletion or contract mutation as an acceptance test.
- [ ] Record post-deployment errors and test cleanup results. A security rollback must not silently restore broad staff access; prefer disabling staff PM entry temporarily while keeping owner access available.

## Self-review and current limits

- The plan preserves the confirmed Daily Expenses requirement and identifies unconfirmed edits, printing, sending, procurement/fund and operational work explicitly.
- Server enforcement covers more than hidden buttons: table policies, callable functions, shared policies, Storage and response fields.
- No work on Linked Labor or its live browser check is required by this plan.
- No application changes, migration or live queries were made while preparing this document. Current live grants, unlisted consumers and URL revocation remain verification work in Task 1/3.
- The interface list is a proposal for review, not an already built API. Implementation must not begin until the workflow decisions and final matrix are approved.
